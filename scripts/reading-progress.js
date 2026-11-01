import { READING_STORAGE_KEY, READING_HISTORY_LIMIT, READING_SAVE_DELAY_MS } from "./config.js";

let current = null;
let timer = 0;
let observer = null;

// 本机记录损坏或存储不可用时按空记录处理，不能阻断文章阅读
function readHistory() {
    try {
        const saved = JSON.parse(localStorage.getItem(READING_STORAGE_KEY) || "[]");
        if (Array.isArray(saved)) {
            return saved;
        }
    } catch {
        return [];
    }
    return [];
}

// 正文和图片末端限定阅读位置，评论展开不会改变文章的阅读进度
function readingHeight() {
    const gallery = document.getElementById("detail-gallery");
    const body = document.getElementById("detail-body");
    let end = body;
    if (gallery.hasChildNodes()) {
        end = gallery;
    }
    const dialog = current.dialog;
    const bounds = end.getBoundingClientRect();
    const dialogBounds = dialog.getBoundingClientRect();
    const contentEnd = bounds.bottom - dialogBounds.top + dialog.scrollTop;
    return Math.max(1, contentEnd - dialog.clientHeight);
}

// 保存当前文章的正文进度，限制记录数量，避免本地数据长期无限增长
function saveProgress() {
    window.clearTimeout(timer);
    if (!current || current.restoring) {
        return;
    }
    const history = readHistory();
    const remaining = [];
    const ratio = Math.min(1, Math.max(0, current.dialog.scrollTop / readingHeight()));
    remaining.push({ id: current.id, ratio: ratio });
    for (const item of history) {
        if (item && item.id !== current.id && remaining.length < READING_HISTORY_LIMIT) {
            remaining.push(item);
        }
    }
    try {
        localStorage.setItem(READING_STORAGE_KEY, JSON.stringify(remaining));
    } catch {
        // 浏览器拒绝本地记录时仍允许正常阅读
    }
}

// 滚动时合并频繁写入，关闭页面前仍会立即保存最后的位置
function scheduleSave() {
    window.clearTimeout(timer);
    timer = window.setTimeout(saveProgress, READING_SAVE_DELAY_MS);
}

// 图片加载导致高度变化时再次对齐原进度，用户开始操作后停止自动调整
function restoreProgress() {
    if (current && current.restoring) {
        current.dialog.scrollTop = current.ratio * readingHeight();
    }
}

// 用户主动滚动或点击后接管阅读位置，不再让图片加载把位置拉回去
function finishRestoring() {
    if (current) {
        current.restoring = false;
    }
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

// 文章显示后启用本机进度，直接访问与消息打开文章共用同一流程
export function startReadingProgress(noteId, dialog) {
    stopReadingProgress();
    let ratio = 0;
    for (const item of readHistory()) {
        if (item && item.id === noteId && Number.isFinite(item.ratio)) {
            ratio = Math.min(1, Math.max(0, item.ratio));
            break;
        }
    }
    current = { id: noteId, dialog: dialog, ratio: ratio, restoring: true };
    dialog.addEventListener("scroll", scheduleSave, { passive: true });
    dialog.addEventListener("wheel", finishRestoring, { passive: true });
    dialog.addEventListener("touchstart", finishRestoring, { passive: true });
    dialog.addEventListener("pointerdown", finishRestoring);
    dialog.addEventListener("keydown", finishRestoring);
    observer = new ResizeObserver(restoreProgress);
    observer.observe(document.getElementById("detail-body"));
    observer.observe(document.getElementById("detail-gallery"));
    restoreProgress();
}

// 关闭或切换文章时解除监听，旧文章的图片和滚动不再影响新文章
export function stopReadingProgress() {
    if (!current) {
        return;
    }
    saveProgress();
    window.clearTimeout(timer);
    const dialog = current.dialog;
    dialog.removeEventListener("scroll", scheduleSave);
    dialog.removeEventListener("wheel", finishRestoring);
    dialog.removeEventListener("touchstart", finishRestoring);
    dialog.removeEventListener("pointerdown", finishRestoring);
    dialog.removeEventListener("keydown", finishRestoring);
    finishRestoring();
    current = null;
}

// 页面离开或切入后台时及时记录，手机关闭浏览器时也尽量保留位置
function saveBeforeHidden() {
    if (document.visibilityState === "hidden") {
        saveProgress();
    }
}

document.addEventListener("visibilitychange", saveBeforeHidden);
window.addEventListener("pagehide", saveProgress);
