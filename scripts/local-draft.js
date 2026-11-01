import { LOCAL_DRAFT_PREFIX, MAX_BODY_LENGTH, MAX_IMAGES, MAX_TAGS, MAX_TAG_LENGTH, MAX_TITLE_LENGTH } from "./config.js";

// 按账号和文章编号隔离本地备份，新文章使用单独槽位
function storageKey(username, noteId) {
    let target = "new";
    if (noteId) {
        target = noteId;
    }
    return LOCAL_DRAFT_PREFIX + encodeURIComponent(username) + ":" + encodeURIComponent(target);
}

// 校验浏览器里的备份，损坏记录不能直接进入文章编辑器
function validDraft(draft) {
    if (!draft || typeof draft.title !== "string" || draft.title.length > MAX_TITLE_LENGTH) {
        return false;
    }
    if (typeof draft.contentMarkdown !== "string" || draft.contentMarkdown.length > MAX_BODY_LENGTH) {
        return false;
    }
    if (typeof draft.pendingTag !== "string" || draft.pendingTag.length > MAX_TAG_LENGTH) {
        return false;
    }
    if (draft.productId !== null && typeof draft.productId !== "string") {
        return false;
    }
    if (typeof draft.awaitingCreation !== "boolean" || typeof draft.needsComparison !== "boolean" || !Number.isInteger(draft.pendingImages) || draft.pendingImages < 0 || draft.pendingImages > MAX_IMAGES) {
        return false;
    }
    if (draft.baseVersion !== null && (!Number.isInteger(draft.baseVersion) || draft.baseVersion < 1)) {
        return false;
    }
    if (!Array.isArray(draft.tags) || draft.tags.length > MAX_TAGS || !Array.isArray(draft.images) || draft.images.length > MAX_IMAGES) {
        return false;
    }
    for (const tag of draft.tags) {
        if (typeof tag !== "string" || tag.length > MAX_TAG_LENGTH) {
            return false;
        }
    }
    for (const image of draft.images) {
        if (!image || typeof image.id !== "string" || typeof image.url !== "string") {
            return false;
        }
        const address = new URL(image.url, window.location.origin);
        if (address.protocol !== "https:" && address.protocol !== "http:") {
            return false;
        }
    }
    return true;
}

// 返回本机备份，浏览器拒绝存储或记录损坏时返回 null
export function readLocalDraft(username, noteId) {
    try {
        const draft = JSON.parse(localStorage.getItem(storageKey(username, noteId)) || "null");
        if (validDraft(draft)) {
            return draft;
        }
    } catch {
        return null;
    }
    return null;
}

// 保存文字、已上传图片和话题，不保存凭证及只能在当前页使用的临时图片地址
export function writeLocalDraft(username, noteId, draft) {
    localStorage.setItem(storageKey(username, noteId), JSON.stringify(draft));
}

// 用户明确丢弃或服务器确认保存后移除对应备份，其他文章不受影响
export function removeLocalDraft(username, noteId) {
    localStorage.removeItem(storageKey(username, noteId));
}
