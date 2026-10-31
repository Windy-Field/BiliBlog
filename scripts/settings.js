import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy } from "./common.js";
import { fillIcons } from "./icons.js";
import { DEFAULT_COVER_URL, MAX_PROFILE_LINKS, MAX_LINK_LABEL_LENGTH, MAX_LINK_URL_LENGTH } from "./config.js";
import { showLocalImage, validateImage } from "./media.js";

const SAVE_COUNTDOWN_MS = 1000;
const SAVE_REDIRECT_MS = 2000;
const form = document.getElementById("settings-form");
const fields = document.getElementById("settings-fields");
const saveButton = document.getElementById("save-button");
const settingsMessage = document.getElementById("settings-message");
let sessionToken = null;
let initialSnapshot = {};
let pendingAvatarId = null;
let pendingCoverId = null;
let pendingCoverDeleted = false;

// 未登录时跳转到登录页
function checkAuth() {
    const session = readSession();
    if (!session) {
        window.location.replace("/login.html");
        return null;
    }
    return session;
}

// 读取本人资料并填入表单
async function loadSettings(token) {
    fields.disabled = true;
    try {
        const user = await requestApi("/me", "GET", null, token);
        populateForm(user);
        initialSnapshot = buildSnapshot(user);
        showMessage(settingsMessage, "", false);
        fields.disabled = false;
    } catch (error) {
        if (error.status === 401) {
            clearSession();
            window.location.replace("/login.html");
            return;
        }
        showToast("读取失败：" + error.message, true);
    }
}

// 把资料填入各表单字段
function populateForm(user) {
    const snapshot = buildSnapshot(user);
    document.getElementById("display-name").value = user.displayName || "";
    document.getElementById("bio").value = user.bio || "";
    document.getElementById("headline").value = snapshot.headline;
    document.getElementById("about-md").value = snapshot.aboutMarkdown;
    if (user.avatarUrl) {
        setImagePreview("avatar-preview", user.avatarUrl);
    } else {
        const preview = document.getElementById("avatar-preview");
        preview.textContent = (user.displayName || "?").slice(0, 1);
    }
    if (user.coverUrl) {
        setImagePreview("cover-preview", user.coverUrl);
        document.getElementById("remove-cover").hidden = false;
    } else {
        setImagePreview("cover-preview", DEFAULT_COVER_URL);
        document.getElementById("remove-cover").hidden = true;
    }
    const links = readHomepageLinks(user);
    renderLinkRows(links);
}

// 在预览容器里显示图片
function setImagePreview(containerId, url) {
    const container = document.getElementById(containerId);
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    container.replaceChildren(image);
}

// 从当前用户数据构建一个快照，用于之后比对变更
function buildSnapshot(user) {
    let headline = "";
    let aboutMarkdown = "";
    if (user.homepage) {
        headline = user.homepage.headline || "";
        aboutMarkdown = user.homepage.aboutMarkdown || "";
    }
    const links = readHomepageLinks(user);
    return {
        displayName: user.displayName || "",
        bio: user.bio || "",
        headline: headline,
        aboutMarkdown: aboutMarkdown,
        links: JSON.stringify(links),
    };
}

// 从用户资料读取个人链接，尚未设置主页时返回空列表
function readHomepageLinks(user) {
    if (user.homepage && user.homepage.links) {
        return user.homepage.links;
    }
    return [];
}

// 上传单张图片，返回 { id, url }
async function uploadImage(file, statusElement) {
    const formData = new FormData();
    formData.append("file", file);
    try {
        const result = await requestApi("/media", "POST", formData, sessionToken);
        showMessage(statusElement, "", false);
        return result;
    } catch (error) {
        showToast("上传失败：" + error.message, true);
        return null;
    }
}

// 头像文件选中后自动上传
async function handleAvatarChange() {
    const file = document.getElementById("avatar-input").files[0];
    if (!file) {
        return;
    }
    const statusElement = document.getElementById("avatar-status");
    const previewElement = document.getElementById("avatar-preview");
    // 本地预览，让用户立刻看到选中效果
    try {
        validateImage(file);
    } catch (error) {
        showToast(error.message, true);
        return;
    }
    showLocalImage(previewElement, file);
    const result = await uploadImage(file, statusElement);
    if (result) {
        pendingAvatarId = result.id;
        showToast("头像已上传，保存后生效");
    }
}

// 封面文件选中后自动上传
async function handleCoverChange() {
    const file = document.getElementById("cover-input").files[0];
    if (!file) {
        return;
    }
    const statusElement = document.getElementById("cover-status");
    const previewElement = document.getElementById("cover-preview");
    try {
        validateImage(file);
    } catch (error) {
        showToast(error.message, true);
        return;
    }
    showLocalImage(previewElement, file);
    const result = await uploadImage(file, statusElement);
    if (result) {
        pendingCoverId = result.id;
        pendingCoverDeleted = false;
        document.getElementById("remove-cover").hidden = false;
        showToast("封面已上传，保存后生效");
    }
}

// 删除封面图
function handleRemoveCover() {
    pendingCoverId = null;
    pendingCoverDeleted = true;
    setImagePreview("cover-preview", DEFAULT_COVER_URL);
    document.getElementById("remove-cover").hidden = true;
    document.getElementById("cover-input").value = "";
}

// 渲染链接输入行列表
function renderLinkRows(links) {
    const list = document.getElementById("links-list");
    list.replaceChildren();
    for (let index = 0; index < links.length; index = index + 1) {
        const link = links[index];
        const row = makeLinkRow(link.label, link.url, index);
        list.appendChild(row);
    }
}

// 创建一条链接行
function makeLinkRow(label, url, index) {
    const row = document.createElement("div");
    row.className = "link-row";
    const labelInput = document.createElement("input");
    labelInput.className = "link-label";
    labelInput.type = "text";
    labelInput.placeholder = "链接名称";
    labelInput.maxLength = MAX_LINK_LABEL_LENGTH;
    labelInput.value = label || "";
    labelInput.setAttribute("aria-label", "链接名称 " + (index + 1));
    const urlInput = document.createElement("input");
    urlInput.type = "url";
    urlInput.placeholder = "https://";
    urlInput.maxLength = MAX_LINK_URL_LENGTH;
    urlInput.value = url || "";
    urlInput.setAttribute("aria-label", "链接地址 " + (index + 1));
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-link";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", "删除第 " + (index + 1) + " 条链接");
    // 删除链接后同步后续输入框的编号和可访问名称
    removeButton.addEventListener("click", function removeLinkRow() {
        row.remove();
        reindexLinkRows();
    });
    row.append(labelInput, urlInput, removeButton);
    return row;
}

// 删除一行后重新编号
function reindexLinkRows() {
    const list = document.getElementById("links-list");
    const rows = list.querySelectorAll(".link-row");
    for (let index = 0; index < rows.length; index = index + 1) {
        const row = rows[index];
        const inputs = row.querySelectorAll("input");
        const number = index + 1;
        inputs[0].setAttribute("aria-label", "链接名称 " + number);
        inputs[1].setAttribute("aria-label", "链接地址 " + number);
        const removeButton = row.querySelector(".remove-link");
        removeButton.setAttribute("aria-label", "删除第 " + number + " 条链接");
    }
}

// 添加一条空链接行
function addLink() {
    const list = document.getElementById("links-list");
    const rows = list.querySelectorAll(".link-row");
    if (rows.length >= MAX_PROFILE_LINKS) {
        showToast("最多添加 5 条链接", true);
        return;
    }
    showMessage(settingsMessage, "", false);
    list.appendChild(makeLinkRow("", "", rows.length));
}

// 从 DOM 收集链接行数据
function collectLinks() {
    const list = document.getElementById("links-list");
    const rows = list.querySelectorAll(".link-row");
    const links = [];
    for (const row of rows) {
        const inputs = row.querySelectorAll("input");
        const label = inputs[0].value.trim();
        const url = inputs[1].value.trim();
        if (label && url) {
            links.push({ label: label, url: url });
        }
    }
    return links;
}

// 保存资料，只提交有变更的字段
async function saveSettings(event) {
    event.preventDefault();
    const displayNameInput = document.getElementById("display-name");
    const displayName = displayNameInput.value.trim();
    if (!displayName) {
        showToast("昵称不能为空", true);
        displayNameInput.focus();
        return;
    }
    const bio = document.getElementById("bio").value;
    const headline = document.getElementById("headline").value;
    const aboutMarkdown = document.getElementById("about-md").value;
    const links = collectLinks();
    const payload = {};
    // PATCH 表示只修改传入的字段，省略未改内容，避免覆盖服务器保存的其他资料
    if (displayName !== initialSnapshot.displayName) {
        payload.displayName = displayName;
    }
    if (bio !== initialSnapshot.bio) {
        payload.bio = bio;
    }
    if (pendingAvatarId !== null) {
        payload.avatarId = pendingAvatarId;
    }
    if (pendingCoverId !== null) {
        payload.coverId = pendingCoverId;
    } else if (pendingCoverDeleted) {
        // 不传 coverId 表示不修改封面，明确传 null 才表示删除，二者含义不同
        payload.coverId = null;
    }
    const homepagePayload = {};
    if (headline !== initialSnapshot.headline) {
        homepagePayload.headline = headline;
    }
    if (aboutMarkdown !== initialSnapshot.aboutMarkdown) {
        homepagePayload.aboutMarkdown = aboutMarkdown;
    }
    if (JSON.stringify(links) !== initialSnapshot.links) {
        // 链接是数组，不能直接比较两个数组是否相等；转成文本比较内容和顺序
        homepagePayload.links = links;
    }
    if (Object.keys(homepagePayload).length > 0) {
        payload.homepage = homepagePayload;
    }
    if (Object.keys(payload).length === 0) {
        showToast("没有需要保存的变更");
        return;
    }
    setBusy(saveButton, true);
    saveButton.disabled = true;
    fields.disabled = true;
    try {
        const updated = await requestApi("/me", "PATCH", payload, sessionToken);
        initialSnapshot = buildSnapshot(updated);
        pendingAvatarId = null;
        pendingCoverId = null;
        pendingCoverDeleted = false;
        showMessage(settingsMessage, "", false);
        // 倒计时 toast 提示后跳转到个人主页
        const username = encodeURIComponent(updated.username || "");
        showToast("资料已保存，2 秒后跳转到主页…");
        // 最后一秒更新提示，保持现有的保存后跳转反馈
        window.setTimeout(function showLastSaveSecond() {
            showToast("资料已保存，1 秒后跳转到主页…");
        }, SAVE_COUNTDOWN_MS);
        // 提示结束后打开本人的公开主页
        window.setTimeout(function openSavedProfile() {
            window.location.href = "/profile.html?u=" + username;
        }, SAVE_REDIRECT_MS);
    } catch (error) {
        if (error.status === 401) {
            clearSession();
            window.location.replace("/login.html");
            return;
        }
        showToast("保存失败：" + error.message, true);
    } finally {
        setBusy(saveButton, false);
        saveButton.disabled = false;
        fields.disabled = false;
    }
}

// 检查身份并绑定资料表单事件，页面加载时执行一次
function init() {
    const session = checkAuth();
    if (!session) {
        return;
    }
    sessionToken = session.token;
    fillIcons();
    document.getElementById("avatar-input").addEventListener("change", handleAvatarChange);
    document.getElementById("cover-input").addEventListener("change", handleCoverChange);
    document.getElementById("remove-cover").addEventListener("click", handleRemoveCover);
    document.getElementById("add-link").addEventListener("click", addLink);
    form.addEventListener("submit", saveSettings);
    loadSettings(sessionToken);
}

init();
