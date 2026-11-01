import { requestApi } from "./api.js";
import { makeIcon } from "./icons.js";
import { PEOPLE_PAGE_SIZE, MAX_PAGE } from "./config.js";

let dialog = null;
let heading;
let list;
let status;
let previous;
let next;
let label;
let retry;
let mode = "followers";
let username = "";
let page = 1;
let pageCount = 1;
let requestNumber = 0;
let loading = false;

// 创建纯文字节点，作者昵称和简介不能作为 HTML 执行
function textElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

// 创建有可访问名称的图标按钮，handler 为具体操作函数
function iconButton(icon, title, handler) {
    const button = textElement("button", "people-button", "");
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.appendChild(makeIcon(icon));
    button.addEventListener("click", handler);
    return button;
}

// 粉丝和关注名单共用窗口，分页和错误状态保持一致
function buildDialog() {
    dialog = document.createElement("dialog");
    dialog.className = "people-dialog";
    dialog.setAttribute("aria-labelledby", "people-title");
    heading = textElement("h2", "", "");
    heading.id = "people-title";
    const header = textElement("div", "people-heading", "");
    header.append(heading, iconButton("close", "关闭作者名单", closeDialog));
    status = textElement("p", "people-status", "");
    status.setAttribute("role", "status");
    list = textElement("div", "people-list", "");
    retry = textElement("button", "people-button", "重新读取");
    retry.type = "button";
    retry.addEventListener("click", loadPeople);
    const pager = textElement("nav", "people-pagination", "");
    pager.setAttribute("aria-label", "作者名单分页");
    previous = iconButton("previous", "上一页作者", previousPage);
    next = iconButton("next", "下一页作者", nextPage);
    label = textElement("span", "", "");
    pager.append(previous, label, next);
    dialog.append(header, status, retry, list, pager);
    dialog.addEventListener("close", invalidateRequest);
    document.body.appendChild(dialog);
}

// 打开 followers 或 following 名单，target 为主页用户名
export function openPeople(kind, target) {
    if (!dialog) {
        buildDialog();
    }
    mode = kind;
    username = target;
    page = 1;
    pageCount = 1;
    list.replaceChildren();
    if (mode === "followers") {
        heading.textContent = "@" + username + " 的粉丝";
    } else if (mode === "following") {
        heading.textContent = "@" + username + " 关注的人";
    }
    if (!dialog.open) {
        dialog.showModal();
    }
    loadPeople();
}

// 只更新窗口中的名单，编号防止上一次打开的慢响应覆盖新结果
async function loadPeople() {
    requestNumber = requestNumber + 1;
    const currentRequest = requestNumber;
    loading = true;
    retry.hidden = true;
    status.textContent = "正在读取作者";
    list.inert = true;
    updatePager();
    const parameters = new URLSearchParams();
    parameters.set("page", String(page));
    parameters.set("pageSize", String(PEOPLE_PAGE_SIZE));
    const path = "/users/" + encodeURIComponent(username) + "/" + mode;
    try {
        const result = await requestApi(path + "?" + parameters.toString(), "GET", null, null);
        if (currentRequest !== requestNumber || !dialog.open) {
            return;
        }
        pageCount = Math.min(MAX_PAGE, Math.max(1, Math.ceil(result.total / PEOPLE_PAGE_SIZE)));
        if (page > pageCount) {
            page = pageCount;
            loadPeople();
            return;
        }
        list.replaceChildren();
        for (const user of result.items) {
            list.appendChild(makePerson(user));
        }
        status.textContent = "共 " + result.total + " 位作者";
        if (result.items.length === 0) {
            status.textContent = "暂无符合条件的作者";
        }
    } catch (error) {
        if (currentRequest === requestNumber && dialog.open) {
            list.replaceChildren();
            pageCount = 1;
            status.textContent = "读取失败：" + error.message;
            retry.hidden = false;
        }
    } finally {
        if (currentRequest === requestNumber) {
            loading = false;
            list.inert = false;
            updatePager();
        }
    }
}

// 作者行直接链接真实主页，头像失败时保留昵称首字
function makePerson(user) {
    const link = textElement("a", "person-row", "");
    link.href = "/profile.html?u=" + encodeURIComponent(user.username);
    const avatar = textElement("span", "person-avatar", user.displayName.slice(0, 1));
    avatar.setAttribute("aria-hidden", "true");
    if (user.avatarUrl) {
        const image = document.createElement("img");
        image.alt = "";
        // 失效头像不影响作者身份文字和跳转
        image.addEventListener("error", function restoreLetter() {
            avatar.textContent = user.displayName.slice(0, 1);
        }, { once: true });
        image.src = user.avatarUrl;
        avatar.replaceChildren(image);
    }
    const info = textElement("div", "person-info", "");
    info.append(textElement("strong", "", user.displayName), textElement("span", "", "@" + user.username));
    if (user.bio) {
        info.appendChild(textElement("p", "", user.bio));
    }
    link.append(avatar, info, makeIcon("next"));
    return link;
}

// 读取期间暂停翻页，首尾页保留明确禁用状态
function updatePager() {
    label.textContent = page + " / " + pageCount;
    previous.disabled = loading || page <= 1;
    next.disabled = loading || page >= pageCount;
    label.parentElement.hidden = pageCount <= 1;
}

// 读取上一页，不重载整个主页
function previousPage() {
    if (!loading && page > 1) {
        page = page - 1;
        loadPeople();
    }
}

// 读取下一页，最大页数遵循接口限制
function nextPage() {
    if (!loading && page < pageCount) {
        page = page + 1;
        loadPeople();
    }
}

// 原生窗口负责焦点返回和 Escape 关闭
function closeDialog() {
    dialog.close();
}

// 关闭后忽略尚未返回的列表请求
function invalidateRequest() {
    requestNumber = requestNumber + 1;
}

// 在搜索页建立作者结果区，返回更新函数，文章和作者分别分页、分别处理失败
export function createPeopleSearch(container) {
    let keyword = "";
    let page = 1;
    let pageCount = 1;
    let revision = 0;
    let loading = false;
    const title = textElement("h2", "", "相关作者");
    title.id = "author-results-title";
    const status = textElement("p", "people-status", "");
    status.setAttribute("role", "status");
    const list = textElement("div", "author-result-list", "");
    const retry = textElement("button", "people-button", "重新读取作者");
    retry.type = "button";
    retry.hidden = true;
    retry.addEventListener("click", loadResults);
    const pager = textElement("nav", "people-pagination", "");
    pager.setAttribute("aria-label", "作者搜索分页");
    const previous = iconButton("previous", "上一页作者", previousResults);
    const next = iconButton("next", "下一页作者", nextResults);
    const label = textElement("span", "", "");
    pager.append(previous, label, next);
    pager.hidden = true;
    container.append(title, status, retry, list, pager);

    // 同一个搜索词刷新时保留旧结果，换词或清空时立刻作废旧请求
    function updateResults(query) {
        if (query !== keyword) {
            revision = revision + 1;
            keyword = query;
            page = 1;
            pageCount = 1;
            list.replaceChildren();
            status.textContent = "";
            pager.hidden = true;
        }
        container.hidden = !keyword;
        if (keyword) {
            loadResults();
        }
    }

    // 通过同一关键词读取真实作者，慢响应只能更新所属的这一次查询
    async function loadResults() {
        revision = revision + 1;
        const currentRevision = revision;
        loading = true;
        retry.hidden = true;
        list.inert = true;
        list.setAttribute("aria-busy", "true");
        if (!list.hasChildNodes()) {
            status.textContent = "正在读取作者……";
        }
        updateResultsPager();
        const parameters = new URLSearchParams();
        parameters.set("q", keyword);
        parameters.set("page", String(page));
        parameters.set("pageSize", String(PEOPLE_PAGE_SIZE));
        try {
            const result = await requestApi("/users?" + parameters.toString(), "GET", null, null);
            if (currentRevision !== revision) {
                return;
            }
            pageCount = Math.min(MAX_PAGE, Math.max(1, Math.ceil(result.total / PEOPLE_PAGE_SIZE)));
            if (page > pageCount) {
                page = pageCount;
                loadResults();
                return;
            }
            list.replaceChildren();
            for (const user of result.items) {
                list.appendChild(makePerson(user));
            }
            status.textContent = "共 " + result.total + " 位作者";
            if (result.items.length === 0) {
                status.textContent = "暂无符合条件的作者";
            }
        } catch (error) {
            if (currentRevision === revision) {
                status.textContent = "作者读取失败：" + error.message;
                retry.hidden = false;
            }
        } finally {
            if (currentRevision === revision) {
                loading = false;
                list.inert = false;
                list.setAttribute("aria-busy", "false");
                updateResultsPager();
            }
        }
    }

    // 作者分页只影响作者列表，文章页码保持原样
    function updateResultsPager() {
        label.textContent = page + " / " + pageCount;
        previous.disabled = loading || page <= 1;
        next.disabled = loading || page >= pageCount;
        pager.hidden = pageCount <= 1;
    }

    // 读取上一页作者，等待期间暂停重复操作
    function previousResults() {
        if (!loading && page > 1) {
            page = page - 1;
            loadResults();
        }
    }

    // 读取下一页作者，沿用接口规定的页数上限
    function nextResults() {
        if (!loading && page < pageCount) {
            page = page + 1;
            loadResults();
        }
    }

    return updateResults;
}
