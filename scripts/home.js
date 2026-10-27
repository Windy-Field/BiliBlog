import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage } from "./common.js";
import { makeIcon, fillIcons } from "./icons.js";
import { setReactionArticle } from "./reactions.js";

const welcome = document.getElementById("welcome");
const guestLinks = document.getElementById("guest-links");
const logoutButton = document.getElementById("logout-button");
const retryButton = document.getElementById("retry-button");
const message = document.getElementById("message");
const accountMenu = document.getElementById("account-menu");
const accountName = document.getElementById("account-name");
const avatar = document.getElementById("avatar");
const myArticles = document.getElementById("my-articles");
const grid = document.getElementById("article-grid");
const feedStatus = document.getElementById("feed-status");
const feedLogin = document.getElementById("feed-login");
const refreshButton = document.getElementById("refresh-button");
const topicList = document.getElementById("topic-list");
const topicStatus = document.getElementById("topic-status");
const moreTopics = document.getElementById("more-topics");
const retryTopics = document.getElementById("retry-topics");
const searchInput = document.getElementById("search-input");
const pagination = document.getElementById("pagination");
const articleDialog = document.getElementById("article-dialog");
const deleteDialog = document.getElementById("delete-dialog");
const deleteDescription = document.getElementById("delete-description");
const deleteStatus = document.getElementById("delete-status");
const confirmDeleteButton = document.getElementById("confirm-delete");
const detailStatus = document.getElementById("detail-status");
const detailContent = document.getElementById("detail-content");
const retryDetail = document.getElementById("retry-detail");
const topbar = document.getElementById("topbar");
const pageSize = 20;
const query = new URLSearchParams(window.location.search);
let feed = query.get("feed");
let currentPage = Number(query.get("page"));
let feedRequest = 0;
let detailRequest = 0;
let currentArticleId = "";
let currentUsername = "";
let pendingDeleteNote = null;
let deletingNote = false;

if (!["following", "favorites", "mine"].includes(feed)) {
    feed = "latest";
}
if (!Number.isInteger(currentPage) || currentPage < 1 || currentPage > 10000) {
    currentPage = 1;
}
searchInput.value = query.get("q") || "";

// 显示游客导航，隐藏退出按钮
function showGuest() {
    guestLinks.hidden = false;
    accountMenu.hidden = true;
    myArticles.hidden = true;
}

// 携带凭证读取本人资料，后端确认后再显示已登录状态
async function loadProfile() {
    const session = readSession();
    retryButton.hidden = true;
    guestLinks.hidden = true;
    accountMenu.hidden = true;
    myArticles.hidden = true;
    showMessage(message, "", false);
    if (!session) {
        showGuest();
        return;
    }

    try {
        const user = await requestApi("/me", "GET", null, session.token);
        currentUsername = user.username;
        welcome.textContent = user.displayName + "（" + user.username + "）";
        accountName.textContent = user.displayName;
        avatar.textContent = user.displayName.slice(0, 1);
        if (user.avatarUrl) {
            const image = document.createElement("img");
            image.src = user.avatarUrl;
            image.alt = "";
            // 头像失效时仍保留昵称首字
            image.addEventListener("error", function showAvatarLetter() {
                avatar.textContent = user.displayName.slice(0, 1);
            });
            avatar.replaceChildren(image);
        }
        accountMenu.hidden = false;
        myArticles.hidden = false;
    } catch (error) {
        if (error.status === 401) {
            // 401 表示凭证失效，清理后提示重新登录
            clearSession();
            currentUsername = "";
            showGuest();
            showMessage(message, "登录已失效，请重新登录", true);
            return;
        }
        // 网络错误不等于凭证失效，保留凭证供用户重试
        welcome.textContent = "暂时无法确认登录状态";
        accountName.textContent = "账号";
        retryButton.hidden = false;
        accountMenu.hidden = false;
        showMessage(message, error.message, true);
    }
}

// 注销后端会话并清理本地凭证，成功后进入登录页
async function logout() {
    // 退出期间禁用按钮，避免同时重试或重复退出
    logoutButton.disabled = true;
    retryButton.disabled = true;
    const session = readSession();
    try {
        if (session) {
            try {
                await requestApi("/auth/logout", "POST", null, session.token);
            } catch (error) {
                // 会话已经失效时继续清理，其他错误留给用户重试
                if (error.status !== 401) {
                    throw error;
                }
            }
        }
        if (!clearSession()) {
            throw new Error("无法清除本地登录状态，请检查浏览器存储设置。");
        }
        window.location.replace("/login.html");
    } catch (error) {
        showMessage(message, "退出未完成：" + error.message, true);
    } finally {
        logoutButton.disabled = false;
        retryButton.disabled = false;
    }
}

// 返回当前凭证，没有登录时返回 null
function currentToken() {
    const session = readSession();
    if (session) {
        return session.token;
    }
    return null;
}

// 根据当前筛选生成分页链接，保留搜索和话题条件
function pageUrl(page) {
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("page", String(page));
    return "/index.html?" + parameters.toString();
}

// 显示文章日期，不把测试数据或系统日期写死在卡片里
function formatDate(value) {
    const date = new Date(value);
    return date.toLocaleDateString("zh-CN", {
        month: "numeric",
        day: "numeric",
    });
}

// 创建一项真实互动计数，返回包含图标和数字的元素
function makeCount(iconName, count) {
    const item = document.createElement("span");
    item.appendChild(makeIcon(iconName));
    item.appendChild(document.createTextNode(String(count)));
    return item;
}

// 没有图片或图片加载失败时，显示文章标题作为文字封面
function showTextCover(cover, note) {
    cover.classList.add("text-cover");
    const label = document.createElement("span");
    label.className = "cover-label";
    label.appendChild(makeIcon("book"));
    label.appendChild(document.createTextNode("文字笔记"));
    const title = document.createElement("span");
    title.className = "cover-word";
    title.textContent = note.title;
    cover.replaceChildren(label, title);
}

// 将一篇后端文章转换成卡片，用户文字一律按纯文字插入
function makeCard(note, index) {
    const card = document.createElement("article");
    card.className = "article-card cover-tone-" + String(index % 4);
    card.dataset.articleId = note.id;
    const cover = document.createElement("a");
    cover.className = "card-cover";
    cover.href =
        pageUrl(currentPage) + "#article=" + encodeURIComponent(note.id);
    cover.setAttribute("aria-label", "阅读：" + note.title);
    if (note.images.length > 0) {
        const image = document.createElement("img");
        image.src = note.images[0].url;
        image.alt = "";
        image.loading = "lazy";
        // 封面失效时保留文字和真实计数
        image.addEventListener(
            "error",
            function replaceBrokenCover() {
                showTextCover(cover, note);
                cover.appendChild(stats);
            },
            { once: true },
        );
        cover.appendChild(image);
    } else {
        showTextCover(cover, note);
    }
    const stats = document.createElement("div");
    stats.className = "card-stats";
    stats.setAttribute(
        "aria-label",
        "点赞 " + note.likeCount + "，评论 " + note.commentCount,
    );
    stats.appendChild(makeCount("heart", note.likeCount));
    stats.appendChild(makeCount("comment", note.commentCount));
    cover.appendChild(stats);
    const info = document.createElement("div");
    info.className = "card-info";
    const title = document.createElement("h2");
    title.className = "card-title";
    const titleLink = document.createElement("a");
    titleLink.href = cover.href;
    titleLink.textContent = note.title;
    titleLink.title = note.title;
    title.appendChild(titleLink);
    const author = document.createElement("div");
    author.className = "card-author";
    author.appendChild(makeIcon("user"));
    const authorName = document.createElement("span");
    authorName.className = "card-author-name";
    authorName.textContent = note.author.displayName;
    const date = document.createElement("time");
    date.dateTime = note.createdAt;
    date.textContent = "· " + formatDate(note.createdAt);
    author.append(authorName, date);
    info.append(title, author);
    if (feed === "mine" && note.author.username === currentUsername) {
        const actions = document.createElement("div");
        actions.className = "article-owner-actions";
        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-article-button";
        deleteButton.type = "button";
        deleteButton.textContent = "删除";
        deleteButton.setAttribute("aria-label", "删除文章：" + note.title);
        deleteButton.addEventListener("click", function openDeleteConfirmation(event) {
            event.preventDefault();
            event.stopPropagation();
            requestDeleteNote(note);
        });
        actions.appendChild(deleteButton);
        info.appendChild(actions);
    }
    card.append(cover, info);
    return card;
}

// 打开确认框并记录准备删除的文章
function requestDeleteNote(note) {
    if (deletingNote) {
        return;
    }
    pendingDeleteNote = note;
    deleteDescription.textContent = "将删除《" + note.title + "》。文章删除后无法恢复，图片素材不会一并删除。";
    showMessage(deleteStatus, "", false);
    confirmDeleteButton.disabled = false;
    confirmDeleteButton.textContent = "删除文章";
    deleteDialog.showModal();
}

// 用户确认后调用删除接口，删除结果不明时先查询文章状态
async function deleteArticle() {
    if (!pendingDeleteNote || deletingNote) {
        return;
    }
    const note = pendingDeleteNote;
    const session = readSession();
    if (!session) {
        clearSession();
        currentUsername = "";
        deleteDialog.close();
        showMessage(message, "登录已失效，请重新登录", true);
        return;
    }

    deletingNote = true;
    confirmDeleteButton.disabled = true;
    confirmDeleteButton.textContent = "正在删除";
    showMessage(deleteStatus, "正在删除文章", false);
    try {
        await requestApi("/notes/" + encodeURIComponent(note.id), "DELETE", null, session.token);
        finishDelete(note);
        return;
    } catch (error) {
        if (error.status === 401) {
            clearSession();
            currentUsername = "";
            showMessage(deleteStatus, "登录已失效，请重新登录后再试", true);
            return;
        }
        if (error.uncertain) {
            try {
                await requestApi("/notes/" + encodeURIComponent(note.id), "GET", null, session.token);
                showMessage(deleteStatus, "文章仍然存在，删除没有完成。请确认后再试", true);
            } catch (checkError) {
                if (checkError.status === 404) {
                    finishDelete(note);
                    return;
                }
                showMessage(deleteStatus, "暂时无法确认文章是否已删除，请先刷新“我的文章”", true);
            }
            return;
        }
        if (error.status === 404) {
            finishDelete(note);
            return;
        }
        showMessage(deleteStatus, error.message, true);
    } finally {
        deletingNote = false;
        if (deleteDialog.open) {
            confirmDeleteButton.disabled = false;
            confirmDeleteButton.textContent = "删除文章";
        }
    }
}

// 删除确认成功后关闭窗口并重新读取文章列表
function finishDelete(note) {
    pendingDeleteNote = null;
    deleteDialog.close();
    showMessage(message, "文章已删除", false);
    if (currentArticleId === note.id) {
        closeArticle();
    }
    loadFeed();
}

// 关闭删除确认框时清除待删除文章
function cancelDelete() {
    if (deletingNote) {
        return;
    }
    pendingDeleteNote = null;
    deleteDialog.close();
}

// 将搜索、话题和页码写入接口参数，返回后端路径
function feedPath() {
    const parameters = new URLSearchParams();
    parameters.set("page", String(currentPage));
    parameters.set("pageSize", String(pageSize));
    let path = "/notes";
    if (feed === "following") {
        parameters.set("feed", "following");
    }
    if (feed === "favorites") {
        path = "/me/favorites";
    } else {
        if (searchInput.value.trim()) {
            parameters.set("q", searchInput.value.trim());
        }
        if (query.get("tag") && feed !== "mine") {
            parameters.set("tag", query.get("tag"));
        }
    }
    if (feed === "mine") {
        path = "/me/notes";
        parameters.set("status", "PUBLISHED");
    }
    return path + "?" + parameters.toString();
}

// 更新标题和已选入口，只展示接口实际提供的内容来源
function updateFeedHeading() {
    let title = "最新文章";
    if (feed === "following") {
        title = "关注的文章";
    }
    if (feed === "favorites") {
        title = "我的收藏";
    }
    if (feed === "mine") {
        title = "我的公开文章";
    }
    if (query.get("tag") && feed !== "mine" && feed !== "favorites") {
        title = "# " + query.get("tag");
    }
    if (searchInput.value.trim() && feed !== "favorites") {
        title = "搜索：" + searchInput.value.trim();
    }
    document.getElementById("feed-title").textContent = title;
    const links = document.querySelectorAll("[data-feed]");
    for (const link of links) {
        if (link.dataset.feed === feed) {
            link.setAttribute("aria-current", "page");
        }
    }
}

// 公开文章遇到失效凭证时改用游客身份读取，私人列表仍需重新登录
async function requestFeed() {
    const token = currentToken();
    try {
        return await requestApi(feedPath(), "GET", null, token);
    } catch (error) {
        if (error.status !== 401 || feed !== "latest" || !token) {
            throw error;
        }
        clearSession();
        showGuest();
        showMessage(message, "登录已失效，当前以游客身份浏览", true);
        return await requestApi(feedPath(), "GET", null, null);
    }
}

// 读取当前文章列表，旧请求晚返回时不覆盖新结果
async function loadFeed() {
    feedRequest = feedRequest + 1;
    const requestNumber = feedRequest;
    refreshButton.disabled = true;
    grid.setAttribute("aria-busy", "true");
    pagination.hidden = true;
    feedLogin.hidden = true;
    grid.replaceChildren();
    document.getElementById("result-count").textContent = "";
    feedStatus.textContent = "正在读取文章……";
    const token = currentToken();
    try {
        if (feed !== "latest" && !token) {
            feedStatus.textContent = "登录后才能查看这些文章";
            feedLogin.hidden = false;
            return;
        }
        const result = await requestFeed();
        if (requestNumber !== feedRequest) {
            return;
        }
        // 页码超出实际结果时返回最后一页，避免搜索或内容减少后出现空白页
        const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
        if (currentPage > pageCount) {
            window.location.replace(pageUrl(pageCount));
            return;
        }
        document.getElementById("result-count").textContent =
            "共 " + result.total + " 篇";
        feedStatus.textContent = "";
        if (result.items.length === 0) {
            feedStatus.textContent = "暂无文章";
        }
        const useFeature =
            feed === "latest" &&
            !query.get("q") &&
            !query.get("tag") &&
            currentPage === 1 &&
            result.items.length >= 5;
        // 首屏大图优先选本页最新带图文章，其余文章保持原顺序且不重复展示
        let featureIndex = 0;
        if (useFeature) {
            for (
                let index = 0;
                index < result.items.length;
                index = index + 1
            ) {
                if (result.items[index].images.length > 0) {
                    featureIndex = index;
                    break;
                }
            }
            grid.appendChild(
                makeCard(result.items[featureIndex], featureIndex),
            );
        }
        for (let index = 0; index < result.items.length; index = index + 1) {
            if (useFeature && index === featureIndex) {
                continue;
            }
            grid.appendChild(makeCard(result.items[index], index));
        }
        grid.classList.toggle("has-feature", useFeature);
        document.getElementById("page-info").textContent =
            currentPage + " / " + pageCount;
        setPageLink("previous-page", currentPage - 1, currentPage > 1);
        setPageLink("next-page", currentPage + 1, currentPage < pageCount);
        pagination.hidden = pageCount <= 1;
    } catch (error) {
        if (requestNumber !== feedRequest) {
            return;
        }
        feedStatus.textContent = "读取失败：" + error.message;
        if (error.status === 401) {
            clearSession();
            showGuest();
            feedLogin.hidden = false;
        }
    } finally {
        if (requestNumber === feedRequest) {
            refreshButton.disabled = false;
            grid.setAttribute("aria-busy", "false");
        }
    }
}

// 可用时设置分页链接，首尾页取消无效链接
function setPageLink(id, page, available) {
    const link = document.getElementById(id);
    link.setAttribute("aria-disabled", String(!available));
    if (available) {
        link.href = pageUrl(page);
        link.removeAttribute("tabindex");
    } else {
        link.removeAttribute("href");
        link.setAttribute("tabindex", "-1");
    }
}

// 读取真实话题，点击话题时回到第一页并保留搜索词
async function loadTopics() {
    retryTopics.hidden = true;
    topicStatus.textContent = "正在读取话题";
    try {
        const result = await requestApi("/tags?pageSize=20", "GET", null, null);
        topicList.replaceChildren();
        const allTopics = [{ tag: "", noteCount: 0 }];
        for (const item of result.items) {
            allTopics.push(item);
        }
        for (const item of allTopics) {
            const link = document.createElement("a");
            const parameters = new URLSearchParams();
            if (item.tag) {
                parameters.set("tag", item.tag);
            }
            if (searchInput.value.trim()) {
                parameters.set("q", searchInput.value.trim());
            }
            link.href = "/index.html?" + parameters.toString();
            const label = document.createElement("span");
            label.textContent = item.tag || "全部文章";
            link.appendChild(label);
            if ((query.get("tag") || "") === item.tag && feed === "latest") {
                link.setAttribute("aria-current", "page");
            }
            if (item.tag) {
                link.title = item.tag + " · " + item.noteCount + " 篇文章";
            }
            topicList.appendChild(link);
        }
        topicStatus.textContent = "";
        moreTopics.hidden = allTopics.length <= 4;
    } catch (error) {
        topicStatus.textContent = "话题暂时不可用";
        retryTopics.hidden = false;
    }
}

// 提交搜索时清除旧页码，收藏页搜索回到公开文章
function searchArticles(event) {
    event.preventDefault();
    const parameters = new URLSearchParams(window.location.search);
    parameters.delete("page");
    parameters.set("q", searchInput.value.trim());
    if (feed === "favorites") {
        parameters.delete("feed");
    }
    window.location.href = "/index.html?" + parameters.toString();
}

// 展开或收起手机上未显示的话题
function toggleTopics() {
    const expanded = moreTopics.getAttribute("aria-expanded") !== "true";
    moreTopics.setAttribute("aria-expanded", String(expanded));
    topicList.classList.toggle("expanded", expanded);
    let label = "更多话题";
    if (expanded) {
        label = "收起话题";
    }
    moreTopics.replaceChildren(
        document.createTextNode(label),
        makeIcon("down"),
    );
}

// 根据链接中的文章 ID 读取详情，支持直接打开链接和刷新
async function readArticleHash() {
    setReactionArticle(null);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    currentArticleId = hash.get("article") || "";
    detailRequest = detailRequest + 1;
    const requestNumber = detailRequest;
    if (!currentArticleId) {
        if (articleDialog.open) {
            articleDialog.close();
        }
        return;
    }
    if (!articleDialog.open) {
        articleDialog.showModal();
    }
    detailContent.hidden = true;
    retryDetail.hidden = true;
    detailStatus.textContent = "正在读取文章……";
    try {
        const path = "/notes/" + encodeURIComponent(currentArticleId);
        const note = await requestApi(path, "GET", null, currentToken());
        if (requestNumber !== detailRequest || !articleDialog.open) {
            return;
        }
        document.getElementById("detail-title").textContent = note.title;
        document.getElementById("detail-author").textContent =
            note.author.displayName + " · " + formatDate(note.createdAt);
        // 只把文档明确说明已清理的 contentHtml 放入正文，其他字段使用纯文字
        const body = document.getElementById("detail-body");
        body.innerHTML = note.contentHtml;
        const gallery = document.getElementById("detail-gallery");
        gallery.replaceChildren();
        for (const item of note.images) {
            const image = document.createElement("img");
            image.src = item.url;
            image.alt = note.title;
            image.loading = "lazy";
            gallery.appendChild(image);
        }
        document.getElementById("detail-counts").textContent =
            "点赞 " +
            note.likeCount +
            " · 收藏 " +
            note.favoriteCount +
            " · 评论 " +
            note.commentCount;
        detailStatus.textContent = "";
        detailContent.hidden = false;
        setReactionArticle(note);
    } catch (error) {
        if (requestNumber !== detailRequest) {
            return;
        }
        if (error.status === 401) {
            clearSession();
            showGuest();
            document.getElementById("reaction-login").hidden = false;
        }
        detailStatus.textContent = "无法读取文章：" + error.message;
        retryDetail.hidden = false;
    }
}

// 关闭阅读窗口时移除文章地址，避免刷新又打开已关闭的文章
function closeArticle() {
    setReactionArticle(null);
    detailRequest = detailRequest + 1;
    const address = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", address);
    articleDialog.close();
}

// 互动成功后同步当前卡片，收藏列表需要重新查询才能更新总数和分页
function updateArticleReaction(event) {
    const note = event.detail;
    const cards = grid.querySelectorAll(".article-card");
    for (const card of cards) {
        if (card.dataset.articleId !== note.id) {
            continue;
        }
        const stats = card.querySelector(".card-stats");
        stats.setAttribute("aria-label", "点赞 " + note.likeCount + "，评论 " + note.commentCount);
        stats.replaceChildren(makeCount("heart", note.likeCount), makeCount("comment", note.commentCount));
    }
    if (feed === "favorites") {
        loadFeed();
    }
    document.getElementById("detail-counts").textContent = "点赞 " + note.likeCount + " · 收藏 " + note.favoriteCount + " · 评论 " + note.commentCount;
}

// 滚过横幅上方后改用白色固定导航
function updateTopbar() {
    topbar.classList.toggle("is-fixed", window.scrollY >= 64);
}

// 点击账号菜单外部时收起菜单
function closeAccountMenu(event) {
    if (!accountMenu.contains(event.target)) {
        accountMenu.open = false;
    }
}

logoutButton.addEventListener("click", logout);
retryButton.addEventListener("click", loadProfile);
refreshButton.addEventListener("click", loadFeed);
retryTopics.addEventListener("click", loadTopics);
moreTopics.addEventListener("click", toggleTopics);
document
    .getElementById("search-form")
    .addEventListener("submit", searchArticles);
document.getElementById("close-detail").addEventListener("click", closeArticle);
retryDetail.addEventListener("click", readArticleHash);
// Escape 关闭阅读窗口时也清理文章地址
articleDialog.addEventListener("cancel", function cancelArticle(event) {
    event.preventDefault();
    closeArticle();
});
window.addEventListener("hashchange", readArticleHash);
window.addEventListener("scroll", updateTopbar, { passive: true });
document.addEventListener("click", closeAccountMenu);
document.addEventListener("article-reaction", updateArticleReaction);
confirmDeleteButton.addEventListener("click", deleteArticle);
document.getElementById("cancel-delete").addEventListener("click", cancelDelete);
deleteDialog.addEventListener("cancel", function closeDeleteDialog(event) {
    event.preventDefault();
    cancelDelete();
});
// 页面加载和刷新时都重新确认登录状态
fillIcons();
updateFeedHeading();
updateTopbar();
loadProfile();
loadTopics();
loadFeed();
readArticleHash();
