import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy } from "./common.js";
import { makeIcon, fillIcons } from "./icons.js";
import { setReactionArticle } from "./reactions.js";
import { setCommentArticle } from "./comments.js";

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
const pageSize = 20;
let query = new URLSearchParams(window.location.search);
let feed = "latest";
let currentPage = 1;
// 用请求编号筛选最新响应，避免较早发出的慢请求覆盖当前列表
let feedRequest = 0;
let detailRequest = 0;
let currentArticleId = "";
let currentUsername = "";
let pendingDeleteNote = null;
let deletingNote = false;
let topicItems = [];

// 从 URL 读取话题、搜索词、页码和内容来源，刷新和前进后退时沿用这些筛选条件
// 地址统一保存筛选条件，分享链接后也能打开同一个列表
function readRoute() {
    query = new URLSearchParams(window.location.search);
    feed = query.get("feed");
    if (!["following", "favorites", "mine"].includes(feed)) {
        feed = "latest";
    }
    currentPage = Number(query.get("page"));
    if (!Number.isInteger(currentPage) || currentPage < 1 || currentPage > 10000) {
        currentPage = 1;
    }
    searchInput.value = query.get("q") || "";
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
    cover.href =
        pageUrl(currentPage) + "#article=" + encodeURIComponent(note.id);
    cover.setAttribute("aria-label", "阅读：" + note.title);
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
    let titleTag = "h2";
    if (feed === "following") {
        titleTag = "h3";
    }
    const title = document.createElement(titleTag);
    title.className = "card-title";
    const titleLink = document.createElement("a");
    titleLink.href = cover.href;
    titleLink.textContent = note.title;
    titleLink.title = note.title;
    title.appendChild(titleLink);
    const author = document.createElement("div");
    author.className = "card-author";
    author.appendChild(makeIcon("user"));
    const authorName = document.createElement("a");
    authorName.className = "card-author-name";
    authorName.href = "/profile.html?u=" + encodeURIComponent(note.author.username);
    authorName.textContent = note.author.displayName;
    authorName.addEventListener("click", function stopPropagation(e) {
        e.stopPropagation();
    });
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

// 按用户名整理本页文章，同名昵称也能区分，作者与文章都保留首次出现的顺序
function groupFollowingNotes(notes) {
    const groups = [];
    for (const note of notes) {
        let authorGroup = null;
        for (const group of groups) {
            if (group.author.username === note.author.username) {
                authorGroup = group;
                break;
            }
        }
        if (!authorGroup) {
            authorGroup = {
                author: note.author,
                notes: []
            };
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
    const top = heading.getBoundingClientRect().top + window.scrollY - 80;
    if (window.scrollY > top) {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
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

// 公开文章遇到失效凭证时改用游客身份读取，关注、收藏和本人列表需要重新登录
// 公开内容允许游客访问，私人列表则需要后端确认身份
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
        showToast("登录已失效，当前以游客身份浏览", true);
        return await requestApi(feedPath(), "GET", null, null);
    }
}

// 读取当前文章列表，旧请求晚返回时不覆盖新结果
async function loadFeed() {
    feedRequest = feedRequest + 1;
    const requestNumber = feedRequest;
    refreshButton.disabled = true;
    setBusy(refreshButton, true);
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
        renderFeedSkeletons();
        const result = await requestFeed();
        if (requestNumber !== feedRequest) {
            return;
        }
        // 页码超出实际结果时返回最后一页，避免搜索或内容减少后出现空白页
        const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
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
    } catch (error) {
        if (requestNumber !== feedRequest) {
            return;
        }
        feedStatus.textContent = "读取失败：" + error.message;
        grid.replaceChildren();
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
    const items = notes.slice(0, 8).map(function makeNoticeText(note) {
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
        return text;
    });
    const group = document.createElement("div");
    group.className = "notice-group";
    group.append(...items);
    track.replaceChildren(group);
    bar.hidden = false;
    // 公告总宽度超过可视区域时开启滚动
    const viewport = track.parentElement;
    if (group.scrollWidth > viewport.clientWidth) {
        const clone = group.cloneNode(true);
        clone.setAttribute("aria-hidden", "true");
        track.appendChild(clone);
        track.style.setProperty(
            "--notice-duration",
            Math.max(24, notes.length * 6) + "s",
        );
        track.classList.add("is-scrolling");
    }
}

// 用灰色骨架预留卡片位置，避免等待时列表塌陷、结果返回后页面又被撑开
function renderFeedSkeletons() {
    grid.classList.toggle("has-feature", feed === "latest" && !query.get("q") && !query.get("tag") && currentPage === 1);
    for (let index = 0; index < 9; index = index + 1) {
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
        const result = await requestApi("/tags?pageSize=20", "GET", null, null);
        topicList.replaceChildren(moreTopics);
        topicItems = [];
        const allTopics = [{ tag: "", noteCount: 0 }];
        for (const item of result.items) {
            allTopics.push(item);
        }
        for (let i = 0; i < allTopics.length; i = i + 1) {
            const item = allTopics[i];
            const link = document.createElement("a");
            const label = document.createElement("span");
            label.textContent = item.tag || "全部文章";
            link.appendChild(label);
            if (item.tag) {
                link.title = item.tag + " · " + item.noteCount + " 篇文章";
            }
            if (i >= 9) {
                link.classList.add("topic-hidden");
            }
            topicList.insertBefore(link, moreTopics);
            topicItems.push({ tag: item.tag, link: link });
        }
        syncActiveTopic();
        topicStatus.textContent = "";
        moreTopics.hidden = topicItems.length <= 9;
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
    navigate(parameters, false);
    scrollToFeed();
}

// 展开或收起多余话题
function toggleTopics() {
    const expanded = moreTopics.getAttribute("aria-expanded") !== "true";
    moreTopics.setAttribute("aria-expanded", String(expanded));
    const extraLinks = topicItems.slice(9).map(function (item) { return item.link; });
    for (const link of extraLinks) {
        link.classList.toggle("topic-hidden", !expanded);
    }
    moreTopics.replaceChildren(
        document.createTextNode(expanded ? "收起" : "更多"),
        makeIcon("down"),
    );
}

// 根据链接中的文章 ID 读取详情，支持直接打开链接和刷新
async function readArticleHash() {
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
    retryDetail.hidden = true;
    detailStatus.textContent = "正在读取文章……";
    setBusy(detailStatus, true);
    try {
        const path = "/notes/" + encodeURIComponent(currentArticleId);
        const note = await requestApi(path, "GET", null, currentToken());
        if (requestNumber !== detailRequest || !articleDialog.open) {
            return;
        }
        document.getElementById("detail-title").textContent = note.title;
        const detailAuthor = document.getElementById("detail-author");
        const authorLink = document.createElement("a");
        authorLink.href = "/profile.html?u=" + encodeURIComponent(note.author.username);
        authorLink.textContent = note.author.displayName;
        detailAuthor.replaceChildren(
            authorLink,
            document.createTextNode(" · " + formatDate(note.createdAt)),
        );
        // 接口约定 contentHtml 已清理，可用于富文本展示；昵称和标题按纯文字插入以免执行用户标记
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
        setCommentArticle(note);
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
    } finally {
        if (requestNumber === detailRequest) {
            setBusy(detailStatus, false);
        }
    }
}

// 关闭阅读窗口时移除文章地址，避免刷新又打开已关闭的文章
function closeArticle() {
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
    if (feed === "favorites") {
        loadFeed();
    }
    document.getElementById("detail-counts").textContent = "点赞 " + note.likeCount + " · 收藏 " + note.favoriteCount + " · 评论 " + note.commentCount;
}

// 下滑后固定导航，并按滚动距离逐渐由透明填充为白色
const TOPBAR_PIN = 8;
const TOPBAR_FADE = 88;
function updateTopbar() {
    const offset = window.scrollY;
    if (offset <= TOPBAR_PIN) {
        topbar.classList.remove("is-sticky");
        topbar.style.removeProperty("--topbar-fill");
        return;
    }
    const fill = Math.min(1, (offset - TOPBAR_PIN) / (TOPBAR_FADE - TOPBAR_PIN));
    topbar.classList.add("is-sticky");
    topbar.style.setProperty("--topbar-fill", fill.toFixed(3));
}

// 点击账号菜单外部时收起菜单
function closeAccountMenu(event) {
    if (!accountMenu.contains(event.target)) {
        accountMenu.open = false;
    }
}

// 回到页面顶部并保留地址栏哈希，文章详情状态继续由原链接控制
function backToTop() {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
}

logoutButton.addEventListener("click", logout);
retryButton.addEventListener("click", loadProfile);
refreshButton.addEventListener("click", loadFeed);
retryTopics.addEventListener("click", loadTopics);
moreTopics.addEventListener("click", toggleTopics);
document.getElementById("back-to-top").addEventListener("click", backToTop);
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
// 浏览器前进后退时按地址重新读取列表，保持页面不重载
window.addEventListener("popstate", function handleHistory() {
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
