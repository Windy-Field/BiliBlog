import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast } from "./common.js";

const likeButton = document.getElementById("like-button");
const favoriteButton = document.getElementById("favorite-button");
const message = document.getElementById("reaction-message");
const loginLink = document.getElementById("reaction-login");
let currentNote = null;
let busy = false;
let pendingReaction = null;
let needsCheck = false;
let articleToken = null;

// 按钮先展示本次点击的目标，真实文章对象只在服务器确认后更新。
function renderReactions() {
    if (!currentNote) {
        return;
    }
    let likeText = "点赞";
    let favoriteText = "收藏";
    let liked = currentNote.liked;
    let favorited = currentNote.favorited;
    let likeCount = currentNote.likeCount;
    let favoriteCount = currentNote.favoriteCount;
    if (pendingReaction) {
        if (pendingReaction.kind === "like") {
            liked = pendingReaction.active;
            likeCount = pendingReaction.count;
        } else {
            favorited = pendingReaction.active;
            favoriteCount = pendingReaction.count;
        }
    }
    if (liked) {
        likeText = "已点赞";
    }
    if (favorited) {
        favoriteText = "已收藏";
    }
    document.getElementById("like-label").textContent = likeText + " " + likeCount;
    document.getElementById("favorite-label").textContent = favoriteText + " " + favoriteCount;
    likeButton.setAttribute("aria-pressed", String(liked));
    favoriteButton.setAttribute("aria-pressed", String(favorited));
    likeButton.disabled = busy || needsCheck;
    favoriteButton.disabled = busy || needsCheck;
    likeButton.setAttribute("aria-busy", String(busy));
    favoriteButton.setAttribute("aria-busy", String(busy));
}

// 详情加载后接收最新文章，关闭或切换文章时传 null，防止迟到的响应改错文章
export function setReactionArticle(note) {
    const session = readSession();
    articleToken = null;
    if (session) {
        articleToken = session.token;
    }
    currentNote = note;
    busy = false;
    pendingReaction = null;
    needsCheck = false;
    showMessage(message, "", false);
    loginLink.hidden = true;
    loginLink.textContent = "登录后重新读取文章";
    loginLink.href = "/login.html";
    renderReactions();
}

// 立即反馈点击目标，失败恢复原值；结果不明时只回读，不重复发送写入请求。
async function changeReaction(kind) {
    if (!currentNote || busy || needsCheck) {
        return;
    }
    const session = readSession();
    if (!session) {
        showMessage(message, "请先登录，再重新读取文章", true);
        loginLink.hidden = false;
        return;
    }
    if (session.token !== articleToken) {
        showMessage(message, "登录账号已变化，请重新读取文章后再操作", true);
        return;
    }
    const note = currentNote;
    let active = !note.liked;
    let count = note.likeCount;
    if (kind === "favorite") {
        active = !note.favorited;
        count = note.favoriteCount;
    }
    if (active) {
        count = count + 1;
    } else {
        count = Math.max(0, count - 1);
    }
    busy = true;
    pendingReaction = { kind: kind, active: active, count: count };
    renderReactions();
    showMessage(message, "", false);
    try {
        const path = "/notes/" + encodeURIComponent(note.id) + "/" + kind;
        const result = await requestApi(path, "POST", { active: active }, session.token);
        // 等待时用户可能已经打开另一篇文章，旧结果不能改动新文章的按钮
        const activeSession = readSession();
        if (currentNote !== note || !activeSession || activeSession.token !== session.token) {
            return;
        }
        if (kind === "like") {
            // 使用后端返回的总数，不在本地直接加一，避免多标签页操作造成计数错误
            note.liked = result.active;
            note.likeCount = result.count;
        } else {
            note.favorited = result.active;
            note.favoriteCount = result.count;
            if (!result.active) {
                note.favoriteCollectionId = null;
            }
        }
        notifyReactionChange(note);
        if (kind === "favorite" && active && note.favorited) {
            notifyFavoriteCreated(note, session.token);
        }
        // 按钮已显示最新状态，减少连续互动时反复弹出的提示
    } catch (error) {
        const sessionNow = readSession();
        if (currentNote !== note || !sessionNow || sessionNow.token !== session.token) {
            return;
        }
        if (error.status === 401) {
            clearSession();
            loginLink.hidden = false;
        }
        if (error.uncertain) {
            try {
                const latest = await requestApi("/notes/" + encodeURIComponent(note.id), "GET", null, session.token);
                const activeSession = readSession();
                if (currentNote !== note || !activeSession || activeSession.token !== session.token) {
                    return;
                }
                note.liked = latest.liked;
                note.favorited = latest.favorited;
                note.likeCount = latest.likeCount;
                note.favoriteCount = latest.favoriteCount;
                note.favoriteCollectionId = latest.favoriteCollectionId;
                notifyReactionChange(note);
                if (kind === "favorite" && active && note.favorited) {
                    notifyFavoriteCreated(note, session.token);
                }
                // 读取后端最新状态后更新按钮
                return;
            } catch {
                const latestSession = readSession();
                if (currentNote !== note || !latestSession || latestSession.token !== session.token) {
                    return;
                }
                needsCheck = true;
                showMessage(message, "暂时无法确认操作结果，请重新读取文章后再操作", true);
                loginLink.textContent = "重新读取文章";
                loginLink.href = window.location.href;
                loginLink.hidden = false;
            }
        }
        showToast(error.message + "，请重新读取文章确认状态", true);
    } finally {
        const finalSession = readSession();
        if (currentNote === note) {
            busy = false;
            pendingReaction = null;
            if (!finalSession || finalSession.token !== session.token) {
                needsCheck = true;
            }
            renderReactions();
        }
    }
}

// 通知首页更新卡片和收藏列表，避免详情与列表显示不同计数
function notifyReactionChange(note) {
    document.dispatchEvent(new CustomEvent("article-reaction", { detail: note }));
}

// 仅在本次收藏已确认成功时请求选择收藏夹，取消收藏和普通刷新不会弹窗。
function notifyFavoriteCreated(note, token) {
    document.dispatchEvent(new CustomEvent("article-favorited", { detail: { note: note, token: token } }));
}

// 点击点赞，已有点赞时取消
function toggleLike() {
    changeReaction("like");
}

// 点击收藏，已有收藏时取消
function toggleFavorite() {
    changeReaction("favorite");
}

likeButton.addEventListener("click", toggleLike);
favoriteButton.addEventListener("click", toggleFavorite);
