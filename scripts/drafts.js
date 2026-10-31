import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy, confirmAction } from "./common.js";
import { fillIcons, makeIcon } from "./icons.js";
import { DRAFT_PAGE_SIZE, MAX_PAGE, SESSION_KEY } from "./config.js";

const EXCERPT_LENGTH = 160;
const list = document.getElementById("draft-list");
const status = document.getElementById("draft-status");
const login = document.getElementById("draft-login");
const refresh = document.getElementById("draft-refresh");
const search = document.getElementById("draft-query");
const pagination = document.getElementById("draft-pagination");
let requestNumber = 0;
let currentPage = 1;
let pageCount = 1;
let deleting = false;
let loading = false;
let displayedToken = null;
const searchButton = document.getElementById("draft-search").querySelector("button");

// 从地址读取搜索词与页码，刷新和前进后退时保持同一组草稿
function readRoute() {
    const parameters = new URLSearchParams(window.location.search);
    currentPage = Number(parameters.get("page"));
    if (!Number.isInteger(currentPage) || currentPage < 1 || currentPage > MAX_PAGE) {
        currentPage = 1;
    }
    search.value = parameters.get("q") || "";
}

// 取得当前有效凭证，所有异步结果都必须与它再次比较
function currentToken() {
    const session = readSession();
    if (session) {
        return session.token;
    }
    return null;
}

// 生成分页地址，保留搜索条件，不把草稿内容放进 URL
function pageAddress(page) {
    const parameters = new URLSearchParams();
    if (search.value.trim()) {
        parameters.set("q", search.value.trim());
    }
    parameters.set("page", String(page));
    return "/drafts.html?" + parameters.toString();
}

// 原生链接负责继续编辑，只有本页翻页和搜索才更新历史并重读列表
function navigate(address, replace) {
    if (replace) {
        window.history.replaceState(null, "", address);
    } else {
        window.history.pushState(null, "", address);
    }
    readRoute();
    loadDrafts();
}

// 按加载与删除状态统一禁止重复操作，列表仍保持原位供用户辨认
function updateControls() {
    const busy = loading || deleting;
    list.inert = busy;
    list.setAttribute("aria-busy", String(loading));
    refresh.disabled = busy;
    setBusy(refresh, loading);
    searchButton.disabled = busy;
    for (const button of list.querySelectorAll("button")) {
        button.disabled = busy;
    }
    const previous = document.getElementById("draft-previous");
    const next = document.getElementById("draft-next");
    updatePageLink(previous, currentPage - 1, !busy && currentPage > 1);
    updatePageLink(next, currentPage + 1, !busy && currentPage < pageCount);
    document.getElementById("draft-page").textContent = currentPage + " / " + pageCount;
    pagination.hidden = pageCount <= 1 || !displayedToken;
}

// 首尾页取消链接和键盘停靠，避免无效翻页仍触发请求
function updatePageLink(link, page, available) {
    link.setAttribute("aria-disabled", String(!available));
    if (available) {
        link.href = pageAddress(page);
        link.removeAttribute("tabindex");
    } else {
        link.removeAttribute("href");
        link.tabIndex = -1;
    }
}

// 以纯文字创建元素，标题和 Markdown 摘要均不作为 HTML 执行
function textElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

// 一条草稿使用编辑资料式列表，不套用首页的封面卡片和互动计数
function makeDraft(note, token) {
    let title = note.title;
    if (!title.trim()) {
        title = "无标题草稿";
    }
    const row = document.createElement("article");
    row.className = "draft-row";
    row.dataset.draftId = note.id;
    const address = "/publish.html?id=" + encodeURIComponent(note.id);
    const cover = document.createElement("a");
    cover.className = "draft-cover";
    cover.href = address;
    cover.setAttribute("aria-label", "继续编辑：" + title);
    cover.appendChild(makeIcon("article"));
    if (note.images.length > 0) {
        const image = document.createElement("img");
        image.alt = "";
        image.loading = "lazy";
        // 图片失效时恢复文档图标，仍保留可用的编辑入口
        image.addEventListener("error", function replaceDraftCover() {
            cover.replaceChildren(makeIcon("article"));
        }, { once: true });
        image.src = note.images[0].url;
        cover.replaceChildren(image);
    }
    const info = textElement("div", "draft-info", "");
    const heading = document.createElement("h2");
    const link = document.createElement("a");
    link.href = address;
    link.textContent = title;
    heading.appendChild(link);
    const compactBody = note.contentMarkdown.replace(/\s+/g, " ");
    let excerpt = compactBody.trim();
    if (!excerpt) {
        excerpt = "暂无正文";
    }
    excerpt = excerpt.slice(0, EXCERPT_LENGTH);
    const summary = textElement("p", "draft-excerpt", excerpt);
    const meta = textElement("div", "draft-meta", "");
    const time = document.createElement("time");
    const updatedAt = note.updatedAt || note.createdAt;
    time.dateTime = updatedAt;
    const date = new Date(updatedAt);
    time.textContent = "更新于 " + date.toLocaleString("zh-CN");
    meta.append(time, textElement("span", "", note.contentMarkdown.length + " 字"), textElement("span", "", note.images.length + " 张图片"));
    info.append(heading, summary, meta);
    const actions = textElement("div", "draft-actions", "");
    const edit = textElement("a", "draft-edit", "继续编辑");
    edit.href = address;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.append(makeIcon("trash"), document.createTextNode("删除"));
    remove.setAttribute("aria-label", "删除草稿：" + title);
    // 保存渲染时的账号，切换账号后旧按钮不能删除同 ID 的内容
    remove.addEventListener("click", function requestDraftDelete() {
        deleteDraft(note, token);
    });
    actions.append(edit, remove);
    row.append(cover, info, actions);
    return row;
}

// 只读取本人草稿，搜索和分页在服务器完成，旧请求或旧账号响应不能写回界面
async function loadDrafts() {
    requestNumber = requestNumber + 1;
    const currentRequest = requestNumber;
    const token = currentToken();
    if (displayedToken !== token) {
        list.replaceChildren();
        document.getElementById("draft-owner").textContent = "";
    }
    document.getElementById("draft-total").textContent = "";
    login.hidden = Boolean(token);
    loading = true;
    updateControls();
    // 等待状态由刷新图标和列表表示，避免加载文字短暂出现后把内容顶动
    showMessage(status, "", false);
    if (!token) {
        displayedToken = null;
        loading = false;
        list.replaceChildren();
        pageCount = 1;
        showMessage(status, "登录后查看本人草稿", false);
        updateControls();
        return;
    }
    try {
        const user = await requestApi("/me", "GET", null, token);
        if (currentRequest !== requestNumber) {
            return;
        }
        if (currentToken() !== token) {
            loadDrafts();
            return;
        }
        const parameters = new URLSearchParams();
        parameters.set("status", "DRAFT");
        parameters.set("page", String(currentPage));
        parameters.set("pageSize", String(DRAFT_PAGE_SIZE));
        if (search.value.trim()) {
            parameters.set("q", search.value.trim());
        }
        const result = await requestApi("/me/notes?" + parameters.toString(), "GET", null, token);
        if (currentRequest !== requestNumber) {
            return;
        }
        if (currentToken() !== token) {
            loadDrafts();
            return;
        }
        pageCount = Math.max(1, Math.ceil(result.total / DRAFT_PAGE_SIZE));
        if (currentPage > pageCount) {
            navigate(pageAddress(pageCount), true);
            return;
        }
        displayedToken = token;
        document.getElementById("draft-owner").textContent = user.displayName + "（" + user.username + "）";
        document.getElementById("draft-total").textContent = "共 " + result.total + " 篇";
        list.replaceChildren();
        for (const note of result.items) {
            list.appendChild(makeDraft(note, token));
        }
        let message = "";
        if (!result.items.length) {
            message = "还没有草稿";
            if (search.value.trim()) {
                message = "没有找到匹配的草稿";
            }
        }
        showMessage(status, message, false);
    } catch (error) {
        if (currentRequest !== requestNumber) {
            return;
        }
        if (currentToken() !== token) {
            loadDrafts();
            return;
        }
        list.replaceChildren();
        displayedToken = null;
        document.getElementById("draft-owner").textContent = "";
        if (error.status === 401) {
            clearSession();
            login.hidden = false;
        }
        showMessage(status, "草稿读取失败：" + error.message, true);
    } finally {
        if (currentRequest === requestNumber) {
            loading = false;
            updateControls();
        }
    }
}

// 删除只针对用户确认的草稿，结果未知时查询实际状态，不自动重复发送删除
async function deleteDraft(note, token) {
    if (deleting || loading) {
        return;
    }
    deleting = true;
    updateControls();
    try {
        const title = note.title || "无标题草稿";
        const confirmed = await confirmAction("删除草稿《" + title + "》？正文无法恢复，图片素材不会一并删除");
        if (!confirmed) {
            return;
        }
        if (currentToken() !== token || displayedToken !== token) {
            throw new Error("登录账号已变化，请刷新后再操作");
        }
        // 打开另一个编辑页后草稿可能已经发布，删除前重新确认真实状态
        const latest = await requestApi("/notes/" + encodeURIComponent(note.id), "GET", null, token);
        const session = readSession();
        const user = await requestApi("/me", "GET", null, token);
        if (!session || currentToken() !== token || latest.status !== "DRAFT" || latest.author.username !== user.username) {
            throw new Error("草稿状态或登录账号已变化，请刷新后核对");
        }
        await requestApi("/notes/" + encodeURIComponent(note.id), "DELETE", null, token);
        if (currentToken() === token) {
            showToast("草稿已删除");
        }
    } catch (error) {
        if (currentToken() === token) {
            if (error.status === 401) {
                clearSession();
            }
            if (error.uncertain || error.status === 404) {
                showToast("已重新读取草稿列表，请核对删除结果", true);
            } else {
                showToast(error.message, true);
            }
        }
    } finally {
        deleting = false;
        loadDrafts();
    }
}

// 搜索总是从第一页开始，清空搜索框后可回到全部草稿
function searchDrafts(event) {
    event.preventDefault();
    if (!deleting) {
        navigate(pageAddress(1), false);
    }
}

// 草稿分页只更新本页列表，继续编辑链接仍使用浏览器原生跳转
function changePage(event) {
    const link = event.target.closest("a[href]");
    if (!link || loading || deleting || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
    }
    event.preventDefault();
    navigate(link.href, false);
}

// 另一个标签页变更登录状态时立即清除旧草稿，再读取当前账号
function sessionChanged(event) {
    if (event.key && event.key !== SESSION_KEY) {
        return;
    }
    list.replaceChildren();
    displayedToken = null;
    document.getElementById("draft-owner").textContent = "";
    loadDrafts();
}

// 前进后退恢复对应搜索和分页，不创建多余历史记录
function restoreRoute() {
    readRoute();
    loadDrafts();
}

// 从编辑页返回时浏览器可能恢复旧列表，重新读取才能看见刚刚保存的正文
function restorePage(event) {
    if (event.persisted) {
        loadDrafts();
    }
}

fillIcons();
readRoute();
document.getElementById("draft-search").addEventListener("submit", searchDrafts);
refresh.addEventListener("click", loadDrafts);
pagination.addEventListener("click", changePage);
window.addEventListener("popstate", restoreRoute);
window.addEventListener("storage", sessionChanged);
window.addEventListener("pageshow", restorePage);
loadDrafts();
