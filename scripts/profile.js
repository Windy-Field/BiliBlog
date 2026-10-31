import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy } from "./common.js";
import { makeIcon, fillIcons } from "./icons.js";
import { PROFILE_PAGE_SIZE, DEFAULT_COVER_URL } from "./config.js";
import { scrollPage } from "./motion.js";
import { makePinButton, makePinBadge } from "./pins.js";

const pageSize = PROFILE_PAGE_SIZE;
let currentUsername = "";
let currentYear = null;
let currentMonth = null;
let selfUsername = "";
let followState = false;
let followCount = 0;
let followLoading = false;
let viewerToken = null;
let followKnown = false;
let notesRequest = 0;
let notesPage = 1;

// 置顶改变后保留当前月份和页码，按后端排序重新读取文章
function refreshPinnedNotes() {
    loadNotes(currentUsername, notesPage, currentYear, currentMonth);
}

// 确认当前账号后再允许关注，避免把自己的主页当成其他人的主页
async function loadTopbarProfile() {
    const guestLinks = document.getElementById("guest-links");
    const accountMenu = document.getElementById("account-menu");
    guestLinks.hidden = true;
    accountMenu.hidden = true;
    selfUsername = "";
    viewerToken = null;
    const session = readSession();
    if (!session) {
        guestLinks.hidden = false;
        return;
    }
    try {
        const user = await requestApi("/me", "GET", null, session.token);
        const currentSession = readSession();
        // 发出请求后账号仍可能改变，返回时再核对一次，避免关注操作沿用旧身份
        if (!currentSession || currentSession.token !== session.token) {
            guestLinks.hidden = false;
            showFollowMessage("登录账号已变化，请重新检查登录状态", true);
            return;
        }
        selfUsername = user.username;
        viewerToken = session.token;
        const avatar = document.getElementById("avatar");
        const accountName = document.getElementById("account-name");
        const welcome = document.getElementById("welcome");
        accountName.textContent = user.displayName;
        welcome.textContent = user.displayName + "（" + user.username + "）";
        avatar.textContent = user.displayName.slice(0, 1);
        const myProfileLink = document.getElementById("my-profile-link");
        if (myProfileLink) {
            myProfileLink.href = "/profile.html?u=" + encodeURIComponent(user.username);
        }
        if (user.avatarUrl) {
            const image = document.createElement("img");
            image.src = user.avatarUrl;
            image.alt = "";
            // 头像链接失效时仍显示账号昵称首字
            image.addEventListener("error", function restoreNavigationAvatar() {
                avatar.textContent = user.displayName.slice(0, 1);
            }, { once: true });
            avatar.replaceChildren(image);
        }
        accountMenu.hidden = false;
    } catch (error) {
        guestLinks.hidden = false;
        if (error.status === 401) {
            resetViewer(session.token);
        } else {
            showFollowMessage("登录状态检查失败：" + error.message, true);
        }
    }
}

// 从地址栏读取目标用户名，参数为 u
function readTargetUsername() {
    const parameters = new URLSearchParams(window.location.search);
    const username = parameters.get("u") || "";
    return username.trim();
}

// 加载用户资料并渲染顶部卡片
async function loadUserProfile(username) {
    const profileCard = document.getElementById("profile-card");
    const profileError = document.getElementById("profile-error");
    profileError.hidden = true;
    try {
        const path = "/users/" + encodeURIComponent(username);
        let user;
        try {
            user = await requestApi(path, "GET", null, viewerToken);
        } catch (error) {
            if (error.status !== 401 || !viewerToken) {
                throw error;
            }
            resetViewer(viewerToken);
            showFollowMessage("登录已失效，请重新登录后关注", true);
            user = await requestApi(path, "GET", null, null);
        }
        showProfile(user);
        profileCard.hidden = false;
        return user;
    } catch (error) {
        if (error.status === 404) {
            showMessage(profileError, "用户不存在", true);
        } else {
            showMessage(profileError, error.message, true);
        }
        profileError.hidden = false;
        return null;
    }
}

// 把用户资料填入 DOM
function showProfile(user) {
    document.title = user.displayName + " 的主页 - 小B书";
    const profileAvatar = document.getElementById("profile-avatar");
    profileAvatar.textContent = user.displayName.slice(0, 1);
    if (user.avatarUrl) {
        const image = document.createElement("img");
        image.src = user.avatarUrl;
        image.alt = user.displayName;
        // 资料头像加载失败时恢复昵称首字
        image.addEventListener("error", function restoreProfileAvatar() {
            profileAvatar.textContent = user.displayName.slice(0, 1);
        }, { once: true });
        profileAvatar.replaceChildren(image);
    }
    const coverImg = document.getElementById("profile-cover");
    document.getElementById("cover-placeholder").hidden = true;
    if (user.coverUrl) {
        coverImg.src = user.coverUrl;
    } else {
        coverImg.src = DEFAULT_COVER_URL;
    }
    coverImg.hidden = false;
    document.getElementById("profile-name").textContent = user.displayName;
    document.getElementById("profile-name").title = user.displayName;
    document.getElementById("profile-handle").textContent = "@" + user.username;
    document.getElementById("profile-handle").title = "@" + user.username;
    if (user.bio) {
        const bioElement = document.getElementById("profile-bio");
        bioElement.textContent = user.bio;
        bioElement.hidden = false;
    }
    document.getElementById("stat-notes-num").textContent = user.noteCount;
    document.querySelector("#stat-following strong").textContent = user.followingCount;
    updateFollowState(user);
    document.getElementById("profile-navbar").hidden = false;
    if (user.homepage && user.homepage.links && user.homepage.links.length > 0) {
        const linksElement = document.getElementById("profile-links");
        for (const link of user.homepage.links) {
            const anchor = document.createElement("a");
            anchor.href = link.url;
            anchor.textContent = link.label;
            anchor.title = link.label;
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
            linksElement.appendChild(anchor);
        }
        linksElement.hidden = false;
    }
    if (user.homepage && user.homepage.aboutHtml) {
        const aboutElement = document.getElementById("profile-about");
        // 关于我来自后端服务器端渲染的 HTML，插入前已经过服务器消毒
        document.getElementById("about-content").innerHTML = user.homepage.aboutHtml;
        aboutElement.hidden = false;
    }
    renderFollowControl();
}

// 将关注错误保留在页面上，方便用户核对后再操作
function showFollowMessage(text, isError) {
    const message = document.getElementById("follow-message");
    message.hidden = false;
    showMessage(message, text, isError);
}

// 只清理发生失效的那次登录，保留其他标签页新登录的账号
function resetViewer(token) {
    const session = readSession();
    if (session && session.token === token) {
        clearSession();
    }
    viewerToken = null;
    selfUsername = "";
    followKnown = false;
    document.getElementById("guest-links").hidden = false;
    document.getElementById("account-menu").hidden = true;
    renderFollowControl();
}

// 资料接口带登录凭证时，followed 才代表当前账号与作者的关注关系
function updateFollowState(user) {
    followState = user.followed === true;
    followCount = user.followerCount;
    followKnown = Boolean(viewerToken);
    document.querySelector("#stat-followers strong").textContent = followCount;
}

// 按登录、关注和等待状态更新同一个按钮，保持按钮尺寸和操作语义稳定
function renderFollowControl() {
    const button = document.getElementById("follow-button");
    const ownLink = document.getElementById("own-settings-link");
    const isSelf = selfUsername === currentUsername;
    ownLink.hidden = !isSelf;
    button.hidden = isSelf;
    button.disabled = followLoading;
    button.dataset.following = "false";
    button.removeAttribute("aria-pressed");
    button.removeAttribute("title");
    setBusy(button, followLoading);
    if (viewerToken && followKnown) {
        button.setAttribute("aria-pressed", String(followState));
        button.dataset.following = String(followState);
        if (followState) {
            button.textContent = "已关注";
            button.title = "点击取消关注";
        } else {
            button.textContent = "关注";
        }
    } else if (viewerToken) {
        button.textContent = "核对关注状态";
    } else if (readSession()) {
        button.textContent = "重试登录检查";
    } else {
        button.textContent = "登录后关注";
    }
}

// 请求返回时再核对账号，避免把旧账号的关注结果显示给新账号
function checkViewer(token) {
    const session = readSession();
    if (session && session.token === token && viewerToken === token) {
        return true;
    }
    resetViewer(token);
    showFollowMessage("登录账号已变化，请重新检查登录状态", true);
    return false;
}

// 请求结果未知时只读取服务器状态，核对成功前继续阻止新的关注提交
async function refreshFollowState(token) {
    const path = "/users/" + encodeURIComponent(currentUsername);
    try {
        const user = await requestApi(path, "GET", null, token);
        if (!checkViewer(token)) {
            return;
        }
        updateFollowState(user);
        document.getElementById("follow-message").hidden = true;
        showToast("已更新关注状态");
    } catch (error) {
        if (!checkViewer(token)) {
            return;
        }
        followKnown = false;
        if (error.status === 401) {
            resetViewer(token);
            showFollowMessage("登录已失效，请重新登录后关注", true);
        } else {
            showFollowMessage("暂时无法确认关注状态，请点击「核对关注状态」后再操作", true);
        }
    }
}

// 切换关注关系，以服务器返回值更新按钮和粉丝数
async function toggleFollow() {
    if (followLoading) {
        return;
    }
    const session = readSession();
    if (!session) {
        resetViewer(viewerToken);
        window.location.href = "/login.html";
        return;
    }
    followLoading = true;
    document.getElementById("follow-message").hidden = true;
    renderFollowControl();
    let token = viewerToken;
    try {
        // 账号变化或上次检查失败时，本次点击只检查身份和状态
        if (!viewerToken || viewerToken !== session.token) {
            followKnown = false;
            await loadTopbarProfile();
        }
        if (!viewerToken || selfUsername === currentUsername) {
            return;
        }
        token = viewerToken;
        if (!followKnown) {
            await refreshFollowState(token);
            return;
        }
        const newActive = !followState;
        const result = await requestApi(
            "/users/" + encodeURIComponent(currentUsername) + "/follow",
            "POST",
            { active: newActive },
            token,
        );
        if (!checkViewer(token)) {
            return;
        }
        followState = result.active;
        followCount = result.count;
        document.querySelector("#stat-followers strong").textContent = followCount;
        if (followState) {
            showToast("已关注，可在首页「关注」查看对方的文章");
        } else {
            showToast("已取消关注");
        }
    } catch (error) {
        if (token && !checkViewer(token)) {
            return;
        }
        if (error.status === 401) {
            resetViewer(token);
            showFollowMessage("登录已失效，请重新登录后关注", true);
        } else if (error.uncertain) {
            followKnown = false;
            await refreshFollowState(token);
        } else {
            showFollowMessage("关注操作失败：" + error.message, true);
        }
    } finally {
        followLoading = false;
        renderFollowControl();
    }
}

// 账号检查可重试，菜单事件只绑定一次，避免重复响应同一次点击
function closeAccountMenu(event) {
    const accountMenu = document.getElementById("account-menu");
    if (!accountMenu.contains(event.target)) {
        accountMenu.open = false;
    }
}

// 沿用个人主页的本地退出流程，清理后跳转登录页
function logout() {
    clearSession();
    window.location.href = "/login.html";
}

// 加载按月归档并生成筛选按钮
async function loadArchives(username) {
    try {
        const archives = await requestApi(
            "/users/" + encodeURIComponent(username) + "/archives",
            "GET",
            null,
            null,
        );
        if (archives && archives.length > 0) {
            renderArchives(archives);
        }
    } catch {
        // 归档加载失败不影响主内容
    }
}

// 把月份列表转换为筛选按钮，切换月份时从第一页开始读取
function renderArchives(list) {
    const nav = document.getElementById("archives-nav");
    const allButton = document.createElement("button");
    allButton.className = "archive-btn";
    allButton.type = "button";
    allButton.textContent = "全部";
    allButton.setAttribute("aria-current", "true");
    // 清除月份筛选，从第一页读取全部文章
    allButton.addEventListener("click", function showAllMonths() {
        currentYear = null;
        currentMonth = null;
        updateArchiveActive(allButton);
        loadNotes(currentUsername, 1, null, null);
    });
    nav.appendChild(allButton);
    for (const item of list) {
        const button = document.createElement("button");
        button.className = "archive-btn";
        button.type = "button";
        button.textContent = item.year + "/" + String(item.month).padStart(2, "0");
        // 按当前归档月份重新读取第一页
        button.addEventListener("click", function showArchiveMonth() {
            currentYear = item.year;
            currentMonth = item.month;
            updateArchiveActive(button);
            loadNotes(currentUsername, 1, item.year, item.month);
        });
        nav.appendChild(button);
    }
    nav.hidden = false;
}

// 标记当前月份按钮，其他月份恢复为未选中状态
function updateArchiveActive(activeButton) {
    const nav = document.getElementById("archives-nav");
    const buttons = nav.querySelectorAll(".archive-btn");
    for (const button of buttons) {
        const active = button === activeButton;
        button.setAttribute("aria-current", String(active));
    }
}

// 加载指定用户的文章列表
async function loadNotes(username, page, year, month) {
    notesRequest = notesRequest + 1;
    const requestNumber = notesRequest;
    const grid = document.getElementById("profile-grid");
    const status = document.getElementById("profile-status");
    grid.setAttribute("aria-busy", "true");
    grid.replaceChildren();
    status.textContent = "正在读取文章……";
    const parameters = new URLSearchParams();
    parameters.set("username", username);
    parameters.set("page", String(page));
    parameters.set("pageSize", String(pageSize));
    if (year) {
        parameters.set("year", String(year));
    }
    if (month) {
        parameters.set("month", String(month));
    }
    try {
        const result = await requestApi("/notes?" + parameters.toString(), "GET", null, null);
        // 切换月份或页码后，只允许最新请求更新列表
        if (requestNumber !== notesRequest) {
            return;
        }
        grid.replaceChildren();
        if (result.items.length === 0) {
            status.textContent = "这里还没有文章";
        } else {
            status.textContent = "";
        }
        for (const note of result.items) {
            grid.appendChild(renderNoteCard(note));
        }
        const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
        notesPage = page;
        renderPagination(page, pageCount);
    } catch (error) {
        if (requestNumber === notesRequest) {
            status.textContent = "文章读取失败：" + error.message;
        }
    } finally {
        if (requestNumber === notesRequest) {
            grid.setAttribute("aria-busy", "false");
        }
    }
}

// 渲染单张文章卡片，样式与首页卡片一致
function renderNoteCard(note) {
    const article = document.createElement("article");
    article.className = "article-card";
    const href = "/index.html?username=" + encodeURIComponent(note.author.username)
        + "#article=" + encodeURIComponent(note.id);
    const cover = document.createElement("a");
    cover.className = "card-cover";
    cover.href = href;
    cover.setAttribute("aria-label", "阅读：" + note.title);
    if (note.images && note.images.length > 0) {
        const image = document.createElement("img");
        image.src = note.images[0].url;
        image.alt = "";
        image.loading = "lazy";
        // 封面真正加载完成后才淡入
        image.addEventListener("load", function revealProfileCover() {
            image.classList.add("is-loaded");
        }, { once: true });
        if (image.complete && image.naturalWidth > 0) {
            image.classList.add("is-loaded");
        }
        cover.appendChild(image);
    } else {
        cover.classList.add("text-cover");
        const word = document.createElement("span");
        word.className = "cover-word";
        word.textContent = note.title;
        cover.appendChild(word);
    }
    const stats = document.createElement("div");
    stats.className = "card-stats";
    stats.setAttribute("aria-label", "点赞 " + note.likeCount + "，评论 " + note.commentCount);
    const heart = document.createElement("span");
    heart.appendChild(makeIcon("heart"));
    heart.appendChild(document.createTextNode(note.likeCount));
    const comment = document.createElement("span");
    comment.appendChild(makeIcon("comment"));
    comment.appendChild(document.createTextNode(note.commentCount));
    stats.append(heart, comment);
    cover.appendChild(stats);
    const info = document.createElement("div");
    info.className = "card-info";
    if (note.pinnedAt) {
        info.appendChild(makePinBadge(note));
    }
    const title = document.createElement("h2");
    title.className = "card-title";
    const titleLink = document.createElement("a");
    titleLink.href = href;
    titleLink.textContent = note.title;
    title.appendChild(titleLink);
    const author = document.createElement("div");
    author.className = "card-author";
    author.appendChild(makeIcon("user"));
    const authorName = document.createElement("span");
    authorName.className = "card-author-name";
    authorName.textContent = note.author.displayName;
    const date = document.createElement("time");
    date.dateTime = note.createdAt;
    const createdDate = new Date(note.createdAt);
    date.textContent = "· " + (createdDate.getMonth() + 1) + "/" + createdDate.getDate();
    author.append(authorName, date);
    info.append(title, author);
    if (selfUsername === currentUsername && viewerToken && !note.hidden) {
        const actions = document.createElement("div");
        actions.className = "article-owner-actions";
        actions.appendChild(makePinButton(note, refreshPinnedNotes));
        info.appendChild(actions);
    }
    article.append(cover, info);
    return article;
}

// 渲染分页控件
function renderPagination(page, pageCount) {
    const pagination = document.getElementById("pagination");
    const previousLink = document.getElementById("previous-page");
    const nextLink = document.getElementById("next-page");
    const pageInfo = document.getElementById("page-info");
    pagination.hidden = pageCount <= 1;
    pageInfo.textContent = page + " / " + pageCount;
    previousLink.setAttribute("aria-disabled", String(page <= 1));
    nextLink.setAttribute("aria-disabled", String(page >= pageCount));
    previousLink.dataset.page = String(page - 1);
    nextLink.dataset.page = String(page + 1);
}

// 分页点击委托
function handlePageNav(event) {
    const link = event.target.closest(".page-button");
    if (!link) {
        return;
    }
    if (link.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
        return;
    }
    event.preventDefault();
    const page = Number(link.dataset.page);
    if (Number.isInteger(page) && page >= 1) {
        loadNotes(currentUsername, page, currentYear, currentMonth);
        scrollPage(0);
    }
}

// 先确认浏览者身份，再读取作者资料，保证刷新后的关注状态对应当前账号
async function init() {
    const username = readTargetUsername();
    if (!username) {
        const errorElement = document.getElementById("profile-error");
        showMessage(errorElement, "链接缺少用户名参数", true);
        errorElement.hidden = false;
        fillIcons();
        return;
    }
    currentUsername = username;
    fillIcons();
    document.getElementById("follow-button").addEventListener("click", toggleFollow);
    document.getElementById("logout-button").addEventListener("click", logout);
    document.addEventListener("click", closeAccountMenu);
    await loadTopbarProfile();
    const user = await loadUserProfile(username);
    if (!user) {
        return;
    }
    await Promise.all([
        loadArchives(username),
        loadNotes(username, 1, null, null),
    ]);
    document.getElementById("pagination").addEventListener("click", handlePageNav);
}

init();
