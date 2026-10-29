import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy } from "./common.js";
import { makeIcon, fillIcons } from "./icons.js";

const pageSize = 12;
let currentUsername = "";
let currentPage = 1;
let currentYear = null;
let currentMonth = null;
let selfUsername = "";
let followState = false;
let followCount = 0;
let followLoading = false;
let viewerToken = null;
let followKnown = false;

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
            const img = document.createElement("img");
            img.src = user.avatarUrl;
            img.alt = "";
            img.addEventListener("error", function () {
                avatar.textContent = user.displayName.slice(0, 1);
            }, { once: true });
            avatar.replaceChildren(img);
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
    const params = new URLSearchParams(window.location.search);
    const u = params.get("u") || "";
    return u.trim();
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
    const avatarEl = document.getElementById("profile-avatar");
    avatarEl.textContent = user.displayName.slice(0, 1);
    if (user.avatarUrl) {
        const img = document.createElement("img");
        img.src = user.avatarUrl;
        img.alt = user.displayName;
        img.addEventListener("error", function () {
            avatarEl.textContent = user.displayName.slice(0, 1);
        }, { once: true });
        avatarEl.replaceChildren(img);
    }
    if (user.coverUrl) {
        const coverImg = document.getElementById("profile-cover");
        document.getElementById("cover-placeholder").hidden = true;
        coverImg.src = user.coverUrl;
        coverImg.hidden = false;
    } else {
        const coverImg = document.getElementById("profile-cover");
        document.getElementById("cover-placeholder").hidden = true;
        coverImg.src = "/assets/images/forest-banner.jpg";
        coverImg.hidden = false;
    }
    document.getElementById("profile-name").textContent = user.displayName;
    document.getElementById("profile-name").title = user.displayName;
    document.getElementById("profile-handle").textContent = "@" + user.username;
    document.getElementById("profile-handle").title = "@" + user.username;
    if (user.bio) {
        const bioEl = document.getElementById("profile-bio");
        bioEl.textContent = user.bio;
        bioEl.hidden = false;
    }
    document.getElementById("stat-notes-num").textContent = user.noteCount;
    document.querySelector("#stat-following strong").textContent = user.followingCount;
    updateFollowState(user);
    document.getElementById("profile-navbar").hidden = false;
    if (user.homepage && user.homepage.links && user.homepage.links.length > 0) {
        const linksEl = document.getElementById("profile-links");
        for (const link of user.homepage.links) {
            const a = document.createElement("a");
            a.href = link.url;
            a.textContent = link.label;
            a.title = link.label;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            linksEl.appendChild(a);
        }
        linksEl.hidden = false;
    }
    if (user.homepage && user.homepage.aboutHtml) {
        const aboutEl = document.getElementById("profile-about");
        // 关于我来自后端服务器端渲染的 HTML，插入前已经过服务器消毒
        document.getElementById("about-content").innerHTML = user.homepage.aboutHtml;
        aboutEl.hidden = false;
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
        showFollowMessage("已重新读取服务器上的关注状态，请查看按钮和粉丝数", false);
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

function renderArchives(list) {
    const nav = document.getElementById("archives-nav");
    const allBtn = document.createElement("button");
    allBtn.className = "archive-btn";
    allBtn.type = "button";
    allBtn.textContent = "全部";
    allBtn.setAttribute("aria-current", "true");
    allBtn.addEventListener("click", function () {
        currentYear = null;
        currentMonth = null;
        currentPage = 1;
        updateArchiveActive(allBtn);
        loadNotes(currentUsername, 1, null, null);
    });
    nav.appendChild(allBtn);
    for (const item of list) {
        const btn = document.createElement("button");
        btn.className = "archive-btn";
        btn.type = "button";
        btn.textContent = item.year + "/" + String(item.month).padStart(2, "0");
        btn.dataset.year = item.year;
        btn.dataset.month = item.month;
        btn.addEventListener("click", function () {
            currentYear = item.year;
            currentMonth = item.month;
            currentPage = 1;
            updateArchiveActive(btn);
            loadNotes(currentUsername, 1, item.year, item.month);
        });
        nav.appendChild(btn);
    }
    nav.hidden = false;
}

function updateArchiveActive(activeBtn) {
    const nav = document.getElementById("archives-nav");
    for (const btn of nav.querySelectorAll(".archive-btn")) {
        btn.setAttribute("aria-current", btn === activeBtn ? "true" : "false");
    }
}

// 加载指定用户的文章列表
async function loadNotes(username, page, year, month) {
    const grid = document.getElementById("profile-grid");
    const status = document.getElementById("profile-status");
    grid.setAttribute("aria-busy", "true");
    grid.replaceChildren();
    status.textContent = "正在读取文章……";
    const params = new URLSearchParams();
    params.set("username", username);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (year) {
        params.set("year", String(year));
    }
    if (month) {
        params.set("month", String(month));
    }
    try {
        const result = await requestApi("/notes?" + params.toString(), "GET", null, null);
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
        currentPage = page;
        renderPagination(page, pageCount);
    } catch (error) {
        status.textContent = "文章读取失败：" + error.message;
    } finally {
        grid.setAttribute("aria-busy", "false");
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
        const img = document.createElement("img");
        img.src = note.images[0].url;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("load", function () {
            img.classList.add("is-loaded");
        }, { once: true });
        if (img.complete && img.naturalWidth > 0) {
            img.classList.add("is-loaded");
        }
        cover.appendChild(img);
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
    const d = new Date(note.createdAt);
    date.textContent = "· " + (d.getMonth() + 1) + "/" + d.getDate();
    author.append(authorName, date);
    info.append(title, author);
    article.append(cover, info);
    return article;
}

// 渲染分页控件
function renderPagination(page, pageCount) {
    const pagination = document.getElementById("pagination");
    const prevLink = document.getElementById("previous-page");
    const nextLink = document.getElementById("next-page");
    const pageInfo = document.getElementById("page-info");
    pagination.hidden = pageCount <= 1;
    pageInfo.textContent = page + " / " + pageCount;
    prevLink.setAttribute("aria-disabled", page <= 1 ? "true" : "false");
    nextLink.setAttribute("aria-disabled", page >= pageCount ? "true" : "false");
    prevLink.dataset.page = String(page - 1);
    nextLink.dataset.page = String(page + 1);
    prevLink.dataset.maxPage = String(pageCount);
    nextLink.dataset.maxPage = String(pageCount);
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
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
}

// 先确认浏览者身份，再读取作者资料，保证刷新后的关注状态对应当前账号
async function init() {
    const username = readTargetUsername();
    if (!username) {
        const err = document.getElementById("profile-error");
        showMessage(err, "链接缺少用户名参数", true);
        err.hidden = false;
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
