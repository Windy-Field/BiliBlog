import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy } from "./common.js";
import { resizePanel, scrollPage, updatePinnedTopbar, updateNoticeMotion } from "./motion.js";
import { HOME_PAGE_SIZE, HOME_FIRST_PAGE_SIZE, MAX_PAGE, TAG_PAGE_SIZE, SESSION_KEY } from "./config.js";
import { makeIcon, fillIcons } from "./icons.js";
import { setReactionArticle } from "./reactions.js";
import { setCommentArticle } from "./comments.js";
import { makePinButton, makePinBadge } from "./pins.js";
import { createCollections } from "./collections.js";
import { createPeopleSearch } from "./people.js";
import { copyArticleLink } from "./article-share.js";
import { startReadingProgress, stopReadingProgress } from "./reading-progress.js";

const FEED_SCROLL_OFFSET = 80;
const DESKTOP_TOPIC_LIMIT = 9;
const MOBILE_TOPIC_LIMIT = 4;
const NOTICE_LIMIT = 8;
const SKELETON_COUNT = 9;
const FEATURE_MIN_ARTICLES = 5;

const welcome = document.getElementById("welcome");
const guestLinks = document.getElementById("guest-links");
const logoutButton = document.getElementById("logout-button");
const retryButton = document.getElementById("retry-button");
const message = document.getElementById("message");
const accountMenu = document.getElementById("account-menu");
const accountName = document.getElementById("account-name");
const avatar = document.getElementById("avatar");
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
const pageSize = HOME_PAGE_SIZE;
const mobileTopics = window.matchMedia("(max-width: 767px)");
let query = new URLSearchParams(window.location.search);
let feed = "latest";
let currentPage = 1;
// 用请求编号筛选最新响应，避免较早发出的慢请求覆盖当前列表
let feedRequest = 0;
let displayedFeedKey = "";
let displayedFavoritesToken = null;
let detailRequest = 0;
let currentArticleId = "";
let currentUsername = "";
let pendingDeleteNote = null;
let deletingNote = false;
let topicItems = [];
let readingNote = null;
const collections = createCollections(refreshLibrary);
const updatePeopleSearch = createPeopleSearch(document.getElementById("author-results"));

// 收藏夹模块只负责分组，路由和文章列表继续由首页统一处理
async function refreshLibrary() {
    readRoute();
    updateFeedHeading();
    await loadFeed();
    if (readingNote && articleDialog.open) {
        renderDetailCollection(readingNote);
    }
}

// 已收藏文章可直接整理到收藏夹，未收藏时保持原来的收藏按钮流程
function renderDetailCollection(note) {
    const container = document.getElementById("detail-collection");
    container.replaceChildren();
    if (note.favorited) {
        container.appendChild(collections.makeMoveButton(note));
    }
}

// 其他标签页换账号时立即移除私人列表和收藏夹，不让旧名字留在页面上
function resetPrivateLibrary(event) {
    if (event.key && event.key !== SESSION_KEY) {
        return;
    }
    collections.reset(null);
    displayedFavoritesToken = null;
    if (feed !== "latest") {
        grid.replaceChildren();
        displayedFeedKey = "";
        loadFeed();
    }
    if (readingNote) {
        readArticleHash();
    }
}

// 从 URL 读取话题、搜索词、页码和内容来源，刷新和前进后退时沿用这些筛选条件
// 地址统一保存筛选条件，分享链接后也能打开同一个列表
function readRoute() {
    query = new URLSearchParams(window.location.search);
    feed = query.get("feed");
    if (!["following", "favorites", "mine", "likes"].includes(feed)) {
        feed = "latest";
    }
    currentPage = Number(query.get("page"));
    if (!Number.isInteger(currentPage) || currentPage < 1 || currentPage > MAX_PAGE) {
        currentPage = 1;
    }
    searchInput.value = query.get("q") || "";
    // 收藏和点赞接口不支持关键词，不显示看似生效但实际未过滤的搜索条件
    if (feed === "favorites" || feed === "likes") {
        searchInput.value = "";
    }
}

readRoute();

// 显示游客导航，隐藏退出按钮
function showGuest() {
    guestLinks.hidden = false;
    accountMenu.hidden = true;
}

// 携带凭证读取本人资料，后端确认后再显示已登录状态
async function loadProfile() {
    const session = readSession();
    currentUsername = "";
    retryButton.hidden = true;
    guestLinks.hidden = true;
    accountMenu.hidden = true;
    showMessage(message, "", false);
    if (!session) {
        showGuest();
        return;
    }

    try {
        const user = await requestApi("/me", "GET", null, session.token);
        if (currentToken() !== session.token) {
            showGuest();
            return;
        }
        currentUsername = user.username;
        welcome.textContent = user.displayName + "（" + user.username + "）";
        accountName.textContent = user.displayName;
        avatar.textContent = user.displayName.slice(0, 1);
        const myProfileLink = document.getElementById("my-profile-link");
        if (myProfileLink) {
            myProfileLink.href = "/profile.html?u=" + encodeURIComponent(user.username);
        }
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
    } catch (error) {
        if (currentToken() !== session.token) {
            showGuest();
            return;
        }
        if (error.status === 401) {
            // 401 表示凭证失效，清理后提示重新登录
            clearSession();
            currentUsername = "";
            showGuest();
            showToast("登录已失效，请重新登录", true);
            return;
        }
        // 网络错误只能说明这次检查失败，保留凭证以便用户恢复连接后重试
        welcome.textContent = "暂时无法确认登录状态";
        accountName.textContent = "账号";
        retryButton.hidden = false;
        accountMenu.hidden = false;
        showToast(error.message, true);
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
        showToast("退出未完成：" + error.message, true);
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

// 将文章的发布时间转换为卡片日期文字
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
    const title = document.createElement("span");
    title.className = "cover-word";
    title.textContent = note.title;
    cover.replaceChildren(title);
}

// 将一篇后端文章转换成卡片，用户文字一律按纯文字插入
// isFeature 时计数并进作者行，普通卡片的计数叠加在封面底部
function makeCard(note, index, isFeature) {
    const displayTitle = note.title;
    const card = document.createElement("article");
    card.className = "article-card cover-tone-" + String(index % 4);
    card.dataset.articleId = note.id;
    const stats = document.createElement("div");
    stats.className = "card-stats";
    stats.setAttribute(
        "aria-label",
        "点赞 " + note.likeCount + "，评论 " + note.commentCount,
    );
    stats.appendChild(makeCount("heart", note.likeCount));
    stats.appendChild(makeCount("comment", note.commentCount));
    const cover = document.createElement("a");
    cover.className = "card-cover";
    // 只改变文章编号，避免首次打开时新增页码参数导致整个页面重新加载
    const listAddress = window.location.pathname + window.location.search;
    cover.href = listAddress + "#article=" + encodeURIComponent(note.id);
    const coverLabel = "阅读：" + displayTitle;
    cover.setAttribute("aria-label", coverLabel);
    if (note.images.length > 0) {
        const image = document.createElement("img");
        image.src = note.images[0].url;
        image.alt = "";
        image.loading = "lazy";
        // 图片真正加载后再淡入，缓存命中时也立即显示
        image.addEventListener("load", function revealCover() {
            image.classList.add("is-loaded");
        }, { once: true });
        // 封面失效时保留文字和真实计数，大图卡的计数在作者行里不重复添加
        image.addEventListener(
            "error",
            // 图片失效时显示文字封面，并保留真实统计
            function replaceBrokenCover() {
                showTextCover(cover, note);
                if (!isFeature) {
                    cover.appendChild(stats);
                }
            },
            { once: true },
        );
        cover.appendChild(image);
        if (image.complete && image.naturalWidth > 0) {
            image.classList.add("is-loaded");
        }
    } else {
        showTextCover(cover, note);
    }
    if (!isFeature) {
        cover.appendChild(stats);
    }
    const info = document.createElement("div");
    info.className = "card-info";
    if (feed === "mine" && note.pinnedAt) {
        info.appendChild(makePinBadge(note));
    }
    let titleTag = "h2";
    if (feed === "following") {
        titleTag = "h3";
    }
    const title = document.createElement(titleTag);
    title.className = "card-title";
    const titleLink = document.createElement("a");
    titleLink.href = cover.href;
    titleLink.textContent = displayTitle;
    titleLink.title = displayTitle;
    title.appendChild(titleLink);
    const author = document.createElement("div");
    author.className = "card-author";
    author.appendChild(makeIcon("user"));
    const authorName = document.createElement("a");
    authorName.className = "card-author-name";
    authorName.href = "/profile.html?u=" + encodeURIComponent(note.author.username);
    authorName.textContent = note.author.displayName;
    const date = document.createElement("time");
    date.dateTime = note.createdAt;
    date.textContent = "· " + formatDate(note.createdAt);
    author.append(authorName, date);
    if (isFeature) {
        author.appendChild(stats);
    }
    info.append(title, author);
    if (feed === "mine" && note.author.username === currentUsername) {
        const actions = document.createElement("div");
        actions.className = "article-owner-actions";
        const editLink = document.createElement("a");
        editLink.className = "secondary-button";
        editLink.href = "/publish.html?id=" + encodeURIComponent(note.id);
        editLink.textContent = "编辑";
        actions.appendChild(editLink);
        if (!note.hidden) {
            actions.appendChild(makePinButton(note, loadFeed));
        }
        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-article-button";
        deleteButton.type = "button";
        deleteButton.textContent = "删除";
        deleteButton.setAttribute("aria-label", "删除文章：" + displayTitle);
        // 记录目标文章并打开删除确认框
        deleteButton.addEventListener("click", function openDeleteConfirmation(event) {
            event.preventDefault();
            event.stopPropagation();
            requestDeleteNote(note);
        });
        actions.appendChild(deleteButton);
        info.appendChild(actions);
    }
    if (feed === "favorites") {
        const tools = document.createElement("div");
        tools.className = "article-owner-actions";
        tools.appendChild(collections.makeMoveButton(note));
        info.appendChild(tools);
    }
    card.append(cover, info);
    return card;
}

// 按用户名整理本页文章，同名昵称也能区分，作者与文章都保留首次出现的顺序
function groupFollowingNotes(notes) {
    const groups = [];
    const authors = new Map();
    for (const note of notes) {
        // Map 像一本按用户名查找的目录，不用每篇文章都重新遍历所有作者
        // 数组另行保留首次出现顺序，作者同名时仍按 username 区分
        const username = note.author.username;
        let authorGroup = authors.get(username);
        if (!authorGroup) {
            authorGroup = {
                author: note.author,
                notes: []
            };
            authors.set(username, authorGroup);
            groups.push(authorGroup);
        }
        authorGroup.notes.push(note);
    }
    return groups;
}

// 为每位作者创建独立分区，内部复用文章网格，屏幕变窄时在分区内换行
function makeFollowingGroup(group, index) {
    const section = document.createElement("section");
    section.className = "following-author-row";
    section.dataset.username = group.author.username;
    const heading = document.createElement("h2");
    heading.className = "following-author-heading";
    heading.id = "following-author-" + index;
    section.setAttribute("aria-labelledby", heading.id);
    const link = document.createElement("a");
    link.className = "following-author-link";
    link.href = "/profile.html?u=" + encodeURIComponent(group.author.username);
    const avatar = document.createElement("span");
    avatar.className = "following-author-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = group.author.displayName.slice(0, 1);
    if (group.author.avatarUrl) {
        const image = document.createElement("img");
        image.src = group.author.avatarUrl;
        image.alt = "";
        image.loading = "lazy";
        // 头像地址失效时保留昵称首字，作者入口仍能辨认
        image.addEventListener("error", function showAuthorLetter() {
            avatar.textContent = group.author.displayName.slice(0, 1);
        }, { once: true });
        avatar.replaceChildren(image);
    }
    const identity = document.createElement("span");
    identity.className = "following-author-identity";
    const name = document.createElement("span");
    name.className = "following-author-name";
    name.textContent = group.author.displayName;
    name.title = group.author.displayName;
    const handle = document.createElement("span");
    handle.className = "following-author-handle";
    handle.textContent = "@" + group.author.username;
    identity.append(name, handle);
    link.append(avatar, identity);
    heading.appendChild(link);
    const articles = document.createElement("div");
    articles.className = "article-grid";
    for (let noteIndex = 0; noteIndex < group.notes.length; noteIndex = noteIndex + 1) {
        const card = makeCard(group.notes[noteIndex], noteIndex, false);
        articles.appendChild(card);
    }
    section.append(heading, articles);
    return section;
}

// 每组占满一行，分页仍使用后端返回的文章总数
function renderFollowingFeed(notes) {
    const groups = groupFollowingNotes(notes);
    for (let index = 0; index < groups.length; index = index + 1) {
        grid.appendChild(makeFollowingGroup(groups[index], index));
    }
}

// 打开确认框并记录准备删除的文章
function requestDeleteNote(note) {
    if (deletingNote) {
        return;
    }
    pendingDeleteNote = note;
    let title = note.title;
    if (!title) {
        title = "无标题草稿";
    }
    deleteDescription.textContent = "将删除《" + title + "》。文章删除后无法恢复，图片素材不会一并删除。";
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
        showToast("登录已失效，请重新登录", true);
        return;
    }

    deletingNote = true;
    confirmDeleteButton.disabled = true;
    confirmDeleteButton.textContent = "正在删除";
    setBusy(confirmDeleteButton, true);
    try {
        await requestApi("/notes/" + encodeURIComponent(note.id), "DELETE", null, session.token);
        finishDelete(note);
        return;
    } catch (error) {
        if (error.status === 401) {
            clearSession();
            currentUsername = "";
            showToast("登录已失效，请重新登录后再试", true);
            return;
        }
        if (error.uncertain) {
            try {
                await requestApi("/notes/" + encodeURIComponent(note.id), "GET", null, session.token);
                showToast("文章仍然存在，删除没有完成。请确认后再试", true);
            } catch (checkError) {
                if (checkError.status === 404) {
                    finishDelete(note);
                    return;
                }
                showToast('暂时无法确认文章是否已删除，请先刷新”我的文章”', true);
            }
            return;
        }
        if (error.status === 404) {
            finishDelete(note);
            return;
        }
        showToast(error.message, true);
    } finally {
        deletingNote = false;
        setBusy(confirmDeleteButton, false);
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
    showToast("文章已删除");
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
        if (query.get("collectionId")) {
            parameters.set("collectionId", query.get("collectionId"));
        }
    } else {
        if (searchInput.value.trim()) {
            parameters.set("q", searchInput.value.trim());
        }
        if (query.get("tag") && feed !== "mine") {
            parameters.set("tag", query.get("tag"));
        }
    }
    if (feed === "likes") {
        path = "/me/likes";
        parameters.delete("q");
        parameters.delete("tag");
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
    if (feed === "likes") {
        title = "点赞历史";
    }
    if (query.get("tag") && feed !== "mine" && feed !== "favorites" && feed !== "likes") {
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
        } else {
            link.removeAttribute("aria-current");
        }
    }
    syncActiveTopic();
}

// 话题入口跟随当前搜索词重建链接，并标出正在查看的话题
function syncActiveTopic() {
    const activeTag = query.get("tag") || "";
    for (const item of topicItems) {
        const parameters = new URLSearchParams();
        if (item.tag) {
            parameters.set("tag", item.tag);
        }
        if (searchInput.value.trim()) {
            parameters.set("q", searchInput.value.trim());
        }
        item.link.href = "/index.html?" + parameters.toString();
        if (feed === "latest" && (item.tag || "") === activeTag) {
            item.link.setAttribute("aria-current", "page");
        } else {
            item.link.removeAttribute("aria-current");
        }
    }
}

// 按 parameters 更新筛选地址和列表，保留当前页面及滚动位置
// 只重查列表可以减少横幅和导航的重复加载，让切换话题更连贯
// replace 为 true 时修正当前历史记录，用于处理超出范围的页码
function navigate(parameters, replace) {
    if (parameters.get("feed") === "drafts") {
        window.location.assign(draftAddress(parameters));
        return;
    }
    const address = "/index.html?" + parameters.toString();
    if (replace) {
        window.history.replaceState(null, "", address);
    } else {
        window.history.pushState(null, "", address);
    }
    readRoute();
    updateFeedHeading();
    loadFeed();
}

// 滚到文章列表顶部；已在列表上方时不滚动
function scrollToFeed() {
    const heading = document.getElementById("feed-title");
    const top = heading.getBoundingClientRect().top + window.scrollY - FEED_SCROLL_OFFSET;
    if (window.scrollY > top) {
        scrollPage(top);
    }
}

// 站内筛选链接只更新列表，文章详情仍由 hashchange 处理
// Ctrl、Command 等组合点击保留浏览器原有的新标签页行为
function handleRouteClick(event) {
    if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    ) {
        return;
    }
    const link = event.target.closest("a[href]");
    if (!link || link.target === "_blank" || link.hasAttribute("download")) {
        return;
    }
    const url = new URL(link.href, window.location.href);
    if (url.hash) {
        return;
    }
    if (url.origin !== window.location.origin) {
        return;
    }
    if (!url.pathname.endsWith("/index.html")) {
        return;
    }
    event.preventDefault();
    navigate(url.searchParams, false);
    scrollToFeed();
}

// 只有未筛选的最新文章使用加长首页，其他列表沿用普通分页
function hasExpandedFirstPage() {
    return feed === "latest" && !query.get("q") && !query.get("tag");
}

// 根据首页容量计算总页数，剩余文章按普通页容量分配
function countFeedPages(total) {
    if (!hasExpandedFirstPage()) {
        return Math.max(1, Math.ceil(total / pageSize));
    }
    const remaining = Math.max(0, total - HOME_FIRST_PAGE_SIZE);
    return 1 + Math.ceil(remaining / pageSize);
}

// 读取指定接口页，公开文章遇到失效凭证时按原地址改用游客身份重试
async function requestFeedPage(path, token, publicFeed) {
    try {
        return await requestApi(path, "GET", null, token);
    } catch (error) {
        if (error.status !== 401 || !publicFeed || !token) {
            throw error;
        }
        clearSession();
        showGuest();
        showToast("登录已失效，当前以游客身份浏览", true);
        return await requestApi(path, "GET", null, null);
    }
}

// 把显示页转换成接口页，首页多出的文章不会在后续页面重复出现
async function requestFeed() {
    const token = currentToken();
    const publicFeed = feed === "latest";
    const path = feedPath();
    if (!hasExpandedFirstPage()) {
        return requestFeedPage(path, token, publicFeed);
    }
    const address = new URL(path, window.location.origin);
    if (currentPage === 1) {
        address.searchParams.set("pageSize", String(HOME_FIRST_PAGE_SIZE));
        return requestFeedPage(address.pathname + address.search, token, publicFeed);
    }
    // 例如第 2 页从第 23 篇开始：读取接口第 2 页，跳过已在首页显示的两篇
    const start = HOME_FIRST_PAGE_SIZE + (currentPage - 2) * pageSize;
    const serverPage = Math.floor(start / pageSize) + 1;
    const skipped = start % pageSize;
    address.searchParams.set("page", String(serverPage));
    const nextAddress = new URL(address.href);
    nextAddress.searchParams.set("page", String(serverPage + 1));
    const result = await requestFeedPage(address.pathname + address.search, token, publicFeed);
    const items = result.items.slice(skipped);
    const nextStart = serverPage * pageSize;
    // 当前接口页不够时只补读紧接的一页，不从头加载全部文章
    if (items.length < pageSize && result.total > nextStart) {
        const next = await requestFeedPage(nextAddress.pathname + nextAddress.search, currentToken(), publicFeed);
        const needed = pageSize - items.length;
        for (let index = 0; index < needed && index < next.items.length; index = index + 1) {
            items.push(next.items[index]);
        }
    }
    return { items: items, total: result.total };
}

// 读取当前文章列表，旧请求晚返回时不覆盖新结果
async function loadFeed() {
    updatePeopleSearch(searchInput.value.trim());
    document.getElementById("article-results-title").hidden = !searchInput.value.trim();
    feedRequest = feedRequest + 1;
    const requestNumber = feedRequest;
    refreshButton.disabled = true;
    setBusy(refreshButton, true);
    grid.setAttribute("aria-busy", "true");
    grid.inert = true;
    feedLogin.hidden = true;
    const token = currentToken();
    collections.reset(token);
    collections.panel.hidden = feed !== "favorites" || !token;
    // 同一账号切换收藏夹时也保留旧内容，暂停交互后等待最新结果，避免骨架闪动
    const feedKey = feedPath() + "|" + token;
    const keepFavorites = feed === "favorites" && Boolean(token) && displayedFavoritesToken === token;
    const keepCards = keepFavorites || (displayedFeedKey === feedKey && grid.hasChildNodes());
    pagination.inert = true;
    if (!keepCards) {
        pagination.hidden = true;
        displayedFeedKey = "";
        displayedFavoritesToken = null;
        grid.replaceChildren();
        document.getElementById("result-count").textContent = "";
        feedStatus.textContent = "正在读取文章……";
    }
    try {
        if (feed !== "latest" && !token) {
            feedStatus.textContent = "登录后才能查看这些文章";
            feedLogin.hidden = false;
            return;
        }
        if (!keepCards) {
            renderFeedSkeletons();
        }
        if (feed === "favorites") {
            // 收藏夹读取失败不阻断文章阅读，管理区保留错误与刷新入口
            try {
                await collections.load(token);
            } catch {
                showToast("收藏夹读取失败，可在管理区刷新", true);
            }
            if (requestNumber !== feedRequest || currentToken() !== token) {
                if (requestNumber === feedRequest && !currentToken()) {
                    grid.replaceChildren();
                    displayedFeedKey = "";
                    displayedFavoritesToken = null;
                    pagination.hidden = true;
                    feedStatus.textContent = "登录已失效，请重新登录后查看收藏";
                    feedLogin.hidden = false;
                    collections.panel.hidden = true;
                    showGuest();
                }
                return;
            }
        }
        // 私人列表的编辑入口需要先确认本人用户名，不能依赖两个请求碰巧按顺序返回
        if (feed === "mine") {
            await loadProfile();
            if (requestNumber !== feedRequest) {
                return;
            }
        }
        const result = await requestFeed();
        // 网络请求的返回顺序不一定和点击顺序相同，只让最后一次点击更新页面
        const activeToken = currentToken();
        const becameGuest = feed === "latest" && !activeToken;
        if (requestNumber !== feedRequest || (activeToken !== token && !becameGuest)) {
            return;
        }
        // 页码超出实际结果时返回最后一页，避免搜索或内容减少后出现空白页
        const pageCount = countFeedPages(result.total);
        if (currentPage > pageCount) {
            const parameters = new URLSearchParams(window.location.search);
            parameters.set("page", String(pageCount));
            navigate(parameters, true);
            return;
        }
        document.getElementById("result-count").textContent =
            "共 " + result.total + " 篇";
        feedStatus.textContent = "";
        grid.replaceChildren();
        if (result.items.length === 0) {
            feedStatus.textContent = "暂无文章";
        }
        const useFeature =
            feed === "latest" &&
            !query.get("q") &&
            !query.get("tag") &&
            currentPage === 1 &&
            result.items.length >= FEATURE_MIN_ARTICLES;
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
                makeCard(result.items[featureIndex], featureIndex, true),
            );
        }
        if (feed === "following") {
            renderFollowingFeed(result.items);
        } else {
            for (let index = 0; index < result.items.length; index = index + 1) {
                if (useFeature && index === featureIndex) {
                    continue;
                }
                grid.appendChild(makeCard(result.items[index], index));
            }
        }
        if (feed === "latest" && currentPage === 1) {
            renderNotices(result.items);
        }
        grid.classList.toggle("has-feature", useFeature);
        document.getElementById("page-info").textContent =
            currentPage + " / " + pageCount;
        setPageLink("previous-page", currentPage - 1, currentPage > 1);
        setPageLink("next-page", currentPage + 1, currentPage < pageCount);
        pagination.hidden = pageCount <= 1;
        displayedFeedKey = feedKey;
        displayedFavoritesToken = null;
        if (feed === "favorites") {
            displayedFavoritesToken = token;
        }
    } catch (error) {
        if (requestNumber !== feedRequest) {
            return;
        }
        feedStatus.textContent = "读取失败：" + error.message;
        grid.replaceChildren();
        displayedFeedKey = "";
        displayedFavoritesToken = null;
        pagination.hidden = true;
        grid.classList.remove("has-feature");
        if (error.status === 401) {
            clearSession();
            showGuest();
            feedLogin.hidden = false;
        }
    } finally {
        if (requestNumber === feedRequest) {
            refreshButton.disabled = false;
            setBusy(refreshButton, false);
            grid.setAttribute("aria-busy", "false");
            grid.inert = false;
            pagination.inert = false;
        }
    }
}

// 公告使用“X月X日”格式，与卡片日期区分
function formatNoticeDate(value) {
    const date = new Date(value);
    return date.getMonth() + 1 + "月" + date.getDate() + "日";
}

// 根据 notes 生成发布公告，内容超宽时用两组相同文字首尾衔接循环滚动
// 第一组移出后接上第二组，动画回到起点时画面仍能衔接
function renderNotices(notes) {
    const bar = document.getElementById("notice-bar");
    const track = document.getElementById("notice-track");
    track.classList.remove("is-scrolling");
    if (notes.length === 0) {
        bar.hidden = true;
        track.replaceChildren();
        return;
    }
    const group = document.createElement("div");
    group.className = "notice-group";
    const noticeCount = Math.min(notes.length, NOTICE_LIMIT);
    for (let index = 0; index < noticeCount; index = index + 1) {
        const note = notes[index];
        const text = document.createElement("span");
        text.className = "notice-item";
        const author = document.createElement("strong");
        author.textContent = note.author.displayName;
        text.append(
            author,
            document.createTextNode(
                "于" + formatNoticeDate(note.createdAt) + "发布了《" + note.title + "》",
            ),
        );
        group.appendChild(text);
    }
    track.replaceChildren(group);
    bar.hidden = false;
    updateNoticeMotion(track, group, notes.length);
}

// 用灰色骨架预留卡片位置，避免等待时列表塌陷、结果返回后页面又被撑开
function renderFeedSkeletons() {
    grid.classList.toggle("has-feature", feed === "latest" && !query.get("q") && !query.get("tag") && currentPage === 1);
    for (let index = 0; index < SKELETON_COUNT; index = index + 1) {
        const card = document.createElement("div");
        card.className = "article-card skeleton-card";
        card.setAttribute("aria-hidden", "true");
        const cover = document.createElement("div");
        cover.className = "skeleton-cover";
        const title = document.createElement("div");
        title.className = "skeleton-line";
        const author = document.createElement("div");
        author.className = "skeleton-line short";
        card.append(cover, title, author);
        grid.appendChild(card);
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
        const result = await requestApi("/tags?pageSize=" + TAG_PAGE_SIZE, "GET", null, null);
        topicList.replaceChildren(moreTopics);
        topicItems = [];
        const allTopics = [{ tag: "", noteCount: 0 }];
        for (const item of result.items) {
            allTopics.push(item);
        }
        for (let index = 0; index < allTopics.length; index = index + 1) {
            const item = allTopics[index];
            const link = document.createElement("a");
            const label = document.createElement("span");
            label.textContent = item.tag || "全部文章";
            link.appendChild(label);
            if (item.tag) {
                link.title = item.tag + " · " + item.noteCount + " 篇文章";
            }
            topicList.insertBefore(link, moreTopics);
            topicItems.push({ tag: item.tag, link: link });
        }
        syncActiveTopic();
        topicStatus.textContent = "";
        updateTopicVisibility();
    } catch {
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
    if (feed === "favorites" || feed === "likes") {
        parameters.delete("feed");
        parameters.delete("collectionId");
    }
    navigate(parameters, false);
    scrollToFeed();
}

// 根据屏幕宽度和展开状态显示话题，手机默认只显示两行
function updateTopicVisibility() {
    let limit = DESKTOP_TOPIC_LIMIT;
    if (mobileTopics.matches) {
        limit = MOBILE_TOPIC_LIMIT;
    }
    const expanded = moreTopics.getAttribute("aria-expanded") === "true";
    for (let index = 0; index < topicItems.length; index = index + 1) {
        const item = topicItems[index];
        const hidden = index >= limit && !expanded;
        item.link.classList.toggle("topic-hidden", hidden);
    }
    moreTopics.hidden = topicItems.length <= limit;
    let label = "更多";
    if (expanded) {
        label = "收起";
    }
    // 保留原图标节点，展开和收起时箭头才能从当前角度连续转动
    moreTopics.firstChild.textContent = label;
}

// 切换展开状态，再统一更新按钮文字和可见话题
function toggleTopics() {
    const expanded = moreTopics.getAttribute("aria-expanded") !== "true";
    // 在高度过渡中更新话题和按钮状态
    resizePanel(topicList, function changeTopicVisibility() {
        moreTopics.setAttribute("aria-expanded", String(expanded));
        updateTopicVisibility();
    });
}

// 文章作者与完整发布日期独立成行，头像失效时仍能辨认作者
function renderArticleAuthor(note) {
    const container = document.getElementById("detail-author");
    const link = document.createElement("a");
    link.className = "reader-author-link";
    link.href = "/profile.html?u=" + encodeURIComponent(note.author.username);
    const avatar = document.createElement("span");
    avatar.className = "reader-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = note.author.displayName.slice(0, 1);
    if (note.author.avatarUrl) {
        const image = document.createElement("img");
        image.src = note.author.avatarUrl;
        image.alt = "";
        // 头像失效后显示昵称首字，作者入口仍可辨认
        image.addEventListener("error", function restoreReaderAvatar() {
            avatar.textContent = note.author.displayName.slice(0, 1);
        }, { once: true });
        avatar.replaceChildren(image);
    }
    const name = document.createElement("span");
    name.className = "reader-author-name";
    name.textContent = note.author.displayName;
    link.append(avatar, name);
    const time = document.createElement("time");
    time.dateTime = note.createdAt;
    const createdDate = new Date(note.createdAt);
    time.textContent = createdDate.toLocaleDateString("zh-CN", {
        year: "numeric", month: "long", day: "numeric"
    });
    container.replaceChildren(link, time);
}

// 话题沿用站内筛选链接，阅读后可以继续查看同类文章
function renderArticleTags(tags) {
    const container = document.getElementById("detail-tags");
    container.replaceChildren();
    container.hidden = tags.length === 0;
    for (const tag of tags) {
        const link = document.createElement("a");
        const parameters = new URLSearchParams();
        parameters.set("tag", tag);
        link.href = "/index.html?" + parameters.toString();
        link.textContent = "# " + tag;
        container.appendChild(link);
    }
}

// 仅折叠独占段落的活动附加标记，正文和代码示例继续完整显示
function foldActivityMetadata(body) {
    const paragraphs = body.querySelectorAll("p");
    for (const paragraph of paragraphs) {
        const text = paragraph.textContent.trim();
        if (!text.startsWith("<!--SDU_ACTIVITY:") || !text.endsWith("-->")) {
            continue;
        }
        if (paragraph.children.length > 0) {
            continue;
        }
        const details = document.createElement("details");
        details.className = "reader-metadata";
        const summary = document.createElement("summary");
        summary.textContent = "活动附加数据";
        const source = document.createElement("pre");
        source.textContent = text;
        details.append(summary, source);
        paragraph.replaceWith(details);
    }
}

// 根据链接中的文章 ID 读取详情，支持直接打开链接和刷新
async function readArticleHash() {
    stopReadingProgress();
    readingNote = null;
    document.getElementById("detail-collection").replaceChildren();
    setReactionArticle(null);
    setCommentArticle(null);
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
        detailContent.hidden = true;
        retryDetail.hidden = true;
        detailStatus.textContent = "";
        articleDialog.showModal();
    }
    detailContent.hidden = true;
    articleDialog.scrollTop = 0;
    retryDetail.hidden = true;
    detailStatus.textContent = "正在读取文章……";
    setBusy(detailStatus, true);
    const token = currentToken();
    try {
        const path = "/notes/" + encodeURIComponent(currentArticleId);
        const note = await requestApi(path, "GET", null, token);
        if (requestNumber !== detailRequest || !articleDialog.open) {
            return;
        }
        if (currentToken() !== token) {
            throw new Error("登录账号已变化，请重新读取文章");
        }
        // 先把整篇文章填好，再显示正文，用户不会看到标题、作者逐项替换的半成品
        document.getElementById("detail-title").textContent = note.title;
        renderArticleAuthor(note);
        renderArticleTags(note.tags);
        // 接口约定 contentHtml 已清理，可用于富文本展示；昵称和标题按纯文字插入以免执行用户标记
        const body = document.getElementById("detail-body");
        body.innerHTML = note.contentHtml;
        foldActivityMetadata(body);
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
        readingNote = note;
        renderDetailCollection(note);
        setReactionArticle(note);
        setCommentArticle(note);
        startReadingProgress(note.id, articleDialog);
    } catch (error) {
        if (requestNumber !== detailRequest) {
            return;
        }
        if (error.status === 401 && currentToken() === token) {
            clearSession();
            showGuest();
            document.getElementById("reaction-login").hidden = false;
        }
        detailStatus.textContent = "无法读取文章：" + error.message;
        retryDetail.hidden = false;
    } finally {
        if (requestNumber === detailRequest) {
            setBusy(detailStatus, false);
        }
    }
}

// 关闭阅读窗口时移除文章地址，避免刷新又打开已关闭的文章
function closeArticle() {
    stopReadingProgress();
    readingNote = null;
    document.getElementById("detail-collection").replaceChildren();
    setReactionArticle(null);
    setCommentArticle(null);
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
    // 评论数量变化只同步数字，点赞和收藏操作才可能改变私人列表的内容
    if (event.type === "article-reaction" && (feed === "favorites" || feed === "likes")) {
        loadFeed();
    }
    if (event.type === "article-reaction" && readingNote && readingNote.id === note.id) {
        renderDetailCollection(note);
    }
    document.getElementById("detail-counts").textContent = "点赞 " + note.likeCount + " · 收藏 " + note.favoriteCount + " · 评论 " + note.commentCount;
}

// 下滑后固定导航，并按滚动距离逐渐由透明填充为白色
function updateTopbar() {
    updatePinnedTopbar(topbar);
}

// 点击账号菜单外部时收起菜单
function closeAccountMenu(event) {
    if (!accountMenu.contains(event.target)) {
        accountMenu.open = false;
    }
}

// 回到页面顶部并保留地址栏哈希，文章详情状态继续由原链接控制
function backToTop() {
    scrollPage(0);
}

logoutButton.addEventListener("click", logout);
retryButton.addEventListener("click", loadProfile);
refreshButton.addEventListener("click", loadFeed);
retryTopics.addEventListener("click", loadTopics);
moreTopics.addEventListener("click", toggleTopics);
mobileTopics.addEventListener("change", updateTopicVisibility);
document.getElementById("back-to-top").addEventListener("click", backToTop);
document
    .getElementById("search-form")
    .addEventListener("submit", searchArticles);
document.getElementById("close-detail").addEventListener("click", closeArticle);
// 分享当前文章，地址不保留收藏夹等私人列表条件
document.getElementById("share-article").addEventListener("click", function shareArticle() {
    if (readingNote) {
        copyArticleLink(readingNote.id);
    }
});
retryDetail.addEventListener("click", readArticleHash);
// Escape 关闭阅读窗口时也清理文章地址
articleDialog.addEventListener("cancel", function cancelArticle(event) {
    event.preventDefault();
    closeArticle();
});
window.addEventListener("hashchange", readArticleHash);
// 浏览器前进后退时按地址重新读取列表，保持页面不重载
window.addEventListener("popstate", function handleHistory() {
    const parameters = new URLSearchParams(window.location.search);
    // 只切换文章时交给 hashchange，避免重复读取列表和文章
    if (parameters.toString() === query.toString()) {
        return;
    }
    readRoute();
    updateFeedHeading();
    loadFeed();
    readArticleHash();
});
// 从作者主页返回时，浏览器可能直接恢复旧页面，需要重新读取关注文章
window.addEventListener("pageshow", function refreshFollowing(event) {
    if (event.persisted && feed === "following") {
        loadProfile();
        loadFeed();
    }
});
document.addEventListener("click", handleRouteClick);
window.addEventListener("scroll", updateTopbar, { passive: true });
document.addEventListener("click", closeAccountMenu);
document.addEventListener("article-reaction", updateArticleReaction);
document.addEventListener("article-comment-count", updateArticleReaction);
window.addEventListener("storage", resetPrivateLibrary);
confirmDeleteButton.addEventListener("click", deleteArticle);
document.getElementById("cancel-delete").addEventListener("click", cancelDelete);
// Escape 和取消按钮共用关闭流程，请求处理中保持原有保护
deleteDialog.addEventListener("cancel", function closeDeleteDialog(event) {
    event.preventDefault();
    cancelDelete();
});
// 兼容已保存的旧草稿地址，仅保留草稿页支持的筛选参数，不再加载首页文章
function draftAddress(parameters) {
    const target = new URLSearchParams();
    if (parameters.get("q")) {
        target.set("q", parameters.get("q"));
    }
    if (parameters.get("page")) {
        target.set("page", parameters.get("page"));
    }
    let address = "/drafts.html";
    if (target.size > 0) {
        address = address + "?" + target.toString();
    }
    return address;
}

// 页面加载和刷新时都重新确认登录状态，旧草稿链接转到独立创作页面
if (query.get("feed") === "drafts") {
    window.location.replace(draftAddress(query));
} else {
    fillIcons();
    updateFeedHeading();
    updateTopbar();
    loadProfile();
    loadTopics();
    loadFeed();
    readArticleHash();
}
