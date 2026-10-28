import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy } from "./common.js";

const likeButton = document.getElementById("like-button");
const favoriteButton = document.getElementById("favorite-button");
const message = document.getElementById("reaction-message");
const loginLink = document.getElementById("reaction-login");
let currentNote = null;
let busy = false;
let busyKind = "";

// 用后端返回的状态和数量更新按钮
// 使用服务器结果能让重复设置保持一致，避免前端累加出错误计数
function renderReactions() {
    if (!currentNote) {
        return;
    }
    let likeText = "点赞";
    let favoriteText = "收藏";
    if (currentNote.liked) {
        likeText = "已点赞";
    }
    if (currentNote.favorited) {
        favoriteText = "已收藏";
    }
    document.getElementById("like-label").textContent = likeText + " " + currentNote.likeCount;
    document.getElementById("favorite-label").textContent = favoriteText + " " + currentNote.favoriteCount;
    likeButton.setAttribute("aria-pressed", String(currentNote.liked));
    favoriteButton.setAttribute("aria-pressed", String(currentNote.favorited));
    likeButton.disabled = busy;
    favoriteButton.disabled = busy;
    setBusy(likeButton, busy && busyKind === "like");
    setBusy(favoriteButton, busy && busyKind === "favorite");
}

// 详情加载后接收最新文章，关闭或切换文章时传 null，防止迟到的响应改错文章
export function setReactionArticle(note) {
    currentNote = note;
    busy = false;
    busyKind = "";
    showMessage(message, "", false);
    loginLink.hidden = true;
    renderReactions();
}

// 设置或取消一种互动；失败保留原状态，结果不明时重新读取后端详情
async function changeReaction(kind) {
    if (!currentNote || busy) {
        return;
    }
    const session = readSession();
    if (!session) {
        showMessage(message, "请先登录，再重新读取文章", true);
        loginLink.hidden = false;
        return;
    }
    const note = currentNote;
    let active = !note.liked;
    if (kind === "favorite") {
        active = !note.favorited;
    }
    busy = true;
    busyKind = kind;
    renderReactions();
    showMessage(message, "", false);
    try {
        const path = "/notes/" + encodeURIComponent(note.id) + "/" + kind;
        const result = await requestApi(path, "POST", { active: active }, session.token);
        if (currentNote !== note) {
            return;
        }
        if (kind === "like") {
            note.liked = result.active;
            note.likeCount = result.count;
        } else {
            note.favorited = result.active;
            note.favoriteCount = result.count;
        }
        notifyReactionChange(note);
        // 按钮已显示最新状态，减少连续互动时反复弹出的提示
    } catch (error) {
        if (currentNote !== note) {
            return;
        }
        if (error.status === 401) {
            clearSession();
            loginLink.hidden = false;
        }
        if (error.uncertain) {
            try {
                const latest = await requestApi("/notes/" + encodeURIComponent(note.id), "GET", null, session.token);
                if (currentNote !== note) {
                    return;
                }
                note.liked = latest.liked;
                note.favorited = latest.favorited;
                note.likeCount = latest.likeCount;
                note.favoriteCount = latest.favoriteCount;
                notifyReactionChange(note);
                // 读取后端最新状态后更新按钮
                return;
            } catch {
                if (currentNote !== note) {
                    return;
                }
            }
        }
        showToast(error.message + "，请重新读取文章确认状态", true);
    } finally {
        if (currentNote === note) {
            busy = false;
            renderReactions();
        }
    }
}

// 通知首页更新卡片和收藏列表，避免详情与列表显示不同计数
function notifyReactionChange(note) {
    document.dispatchEvent(new CustomEvent("article-reaction", { detail: note }));
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
