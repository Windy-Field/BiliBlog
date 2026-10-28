import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy } from "./common.js";
import { makeIcon, fillIcons } from "./icons.js";

const form = document.getElementById("settings-form");
const fields = document.getElementById("settings-fields");
const saveButton = document.getElementById("save-button");
const settingsMessage = document.getElementById("settings-message");
let sessionToken = null;
let initialSnapshot = {};
let pendingAvatarId = null;
let pendingCoverId = null;
let pendingCoverDeleted = false;

// 深色渐变，用于无封面图时的占位
const COVER_GRADIENTS = [
    "linear-gradient(135deg, #4a1942, #2d1b4e)",
    "linear-gradient(135deg, #1a3a5c, #0d2137)",
    "linear-gradient(135deg, #1b3a2d, #0f2318)",
    "linear-gradient(135deg, #3d2000, #5c3500)",
    "linear-gradient(135deg, #2d1b5e, #1a0f3d)",
    "linear-gradient(135deg, #004d4d, #002b2b)",
    "linear-gradient(135deg, #3b2000, #2a1500)",
];

function getRandomGradient() {
    return COVER_GRADIENTS[Math.floor(Math.random() * COVER_GRADIENTS.length)];
}

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
    document.getElementById("display-name").value = user.displayName || "";
    document.getElementById("bio").value = user.bio || "";
    document.getElementById("headline").value =
        user.homepage ? user.homepage.headline || "" : "";
    document.getElementById("about-md").value =
        user.homepage ? user.homepage.aboutMarkdown || "" : "";
    if (user.avatarUrl) {
        setImagePreview("avatar-preview", user.avatarUrl);
    } else {
        const preview = document.getElementById("avatar-preview");
        preview.textContent = (user.displayName || "?").slice(0, 1);
    }
    if (user.coverUrl) {
        setImagePreview("cover-preview", user.coverUrl);
        document.getElementById("remove-cover").hidden = false;
        document.getElementById("refresh-cover-gradient").hidden = true;
    } else {
        const preview = document.getElementById("cover-preview");
        preview.style.background = getRandomGradient();
        document.getElementById("refresh-cover-gradient").hidden = false;
    }
    const links = user.homepage && user.homepage.links ? user.homepage.links : [];
    renderLinkRows(links);
}

// 在预览容器里显示图片
function setImagePreview(containerId, url) {
    const container = document.getElementById(containerId);
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    container.replaceChildren(img);
}

// 从当前用户数据构建一个快照，用于之后比对变更
function buildSnapshot(user) {
    return {
        displayName: user.displayName || "",
        bio: user.bio || "",
        headline: user.homepage ? user.homepage.headline || "" : "",
        aboutMarkdown: user.homepage ? user.homepage.aboutMarkdown || "" : "",
        links: JSON.stringify(user.homepage && user.homepage.links ? user.homepage.links : []),
        avatarId: user.avatarId || null,
        coverId: user.coverId || null,
    };
}

// 上传单张图片，返回 { id, url }
async function uploadImage(file, statusEl) {
    const formData = new FormData();
    formData.append("file", file);
    try {
        const result = await requestApi("/media", "POST", formData, sessionToken);
        showMessage(statusEl, "", false);
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
    const statusEl = document.getElementById("avatar-status");
    const previewEl = document.getElementById("avatar-preview");
    // 本地预览，让用户立刻看到选中效果
    const previewUrl = URL.createObjectURL(file);
    const img = document.createElement("img");
    img.src = previewUrl;
    img.alt = "";
    img.onload = function () {
        URL.revokeObjectURL(previewUrl);
    };
    previewEl.replaceChildren(img);
    const result = await uploadImage(file, statusEl);
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
    const statusEl = document.getElementById("cover-status");
    const previewEl = document.getElementById("cover-preview");
    const previewUrl = URL.createObjectURL(file);
    const img = document.createElement("img");
    img.src = previewUrl;
    img.alt = "";
    img.onload = function () {
        URL.revokeObjectURL(previewUrl);
    };
    previewEl.replaceChildren(img);
    const result = await uploadImage(file, statusEl);
    if (result) {
        pendingCoverId = result.id;
        pendingCoverDeleted = false;
        document.getElementById("remove-cover").hidden = false;
        document.getElementById("refresh-cover-gradient").hidden = true;
        showToast("封面已上传，保存后生效");
    }
}

// 删除封面图
function handleRemoveCover() {
    pendingCoverId = null;
    pendingCoverDeleted = true;
    const previewEl = document.getElementById("cover-preview");
    previewEl.replaceChildren();
    previewEl.style.background = getRandomGradient();
    document.getElementById("remove-cover").hidden = true;
    document.getElementById("refresh-cover-gradient").hidden = false;
    document.getElementById("cover-input").value = "";
}

// 刷新封面渐变配色
function handleRefreshGradient() {
    if (pendingCoverId !== null) {
        return;
    }
    const previewEl = document.getElementById("cover-preview");
    previewEl.style.background = getRandomGradient();
}

// 渲染链接输入行列表
function renderLinkRows(links) {
    const list = document.getElementById("links-list");
    list.replaceChildren();
    for (let i = 0; i < links.length; i = i + 1) {
        list.appendChild(makeLinkRow(links[i].label, links[i].url, i));
    }
}

// 创建一条链接行
function makeLinkRow(label, url, index) {
    const row = document.createElement("div");
    row.className = "link-row";
    row.dataset.index = String(index);
    const labelInput = document.createElement("input");
    labelInput.className = "link-label";
    labelInput.type = "text";
    labelInput.placeholder = "链接名称";
    labelInput.maxLength = 30;
    labelInput.value = label || "";
    labelInput.setAttribute("aria-label", "链接名称 " + (index + 1));
    const urlInput = document.createElement("input");
    urlInput.type = "url";
    urlInput.placeholder = "https://";
    urlInput.maxLength = 500;
    urlInput.value = url || "";
    urlInput.setAttribute("aria-label", "链接地址 " + (index + 1));
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-link";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", "删除第 " + (index + 1) + " 条链接");
    removeBtn.addEventListener("click", function removeLinkRow() {
        row.remove();
        reindexLinkRows();
    });
    row.append(labelInput, urlInput, removeBtn);
    return row;
}

// 删除一行后重新编号
function reindexLinkRows() {
    const rows = document.getElementById("links-list").querySelectorAll(".link-row");
    rows.forEach(function (row, i) {
        row.dataset.index = String(i);
        const inputs = row.querySelectorAll("input");
        inputs[0].setAttribute("aria-label", "链接名称 " + (i + 1));
        inputs[1].setAttribute("aria-label", "链接地址 " + (i + 1));
        row.querySelector(".remove-link").setAttribute("aria-label", "删除第 " + (i + 1) + " 条链接");
    });
}

// 添加一条空链接行
function addLink() {
    const list = document.getElementById("links-list");
    const rows = list.querySelectorAll(".link-row");
    if (rows.length >= 5) {
        showToast("最多添加 5 条链接", true);
        return;
    }
    showMessage(settingsMessage, "", false);
    list.appendChild(makeLinkRow("", "", rows.length));
}

// 从 DOM 收集链接行数据
function collectLinks() {
    const rows = document.getElementById("links-list").querySelectorAll(".link-row");
    const links = [];
    for (const row of rows) {
        const inputs = row.querySelectorAll("input");
        const label = inputs[0].value.trim();
        const url = inputs[1].value.trim();
        if (label && url) {
            links.push({ label, url });
        }
    }
    return links;
}

// 保存资料，只提交有变更的字段
async function saveSettings(event) {
    event.preventDefault();
    const displayName = document.getElementById("display-name").value.trim();
    if (!displayName) {
        showToast("昵称不能为空", true);
        document.getElementById("display-name").focus();
        return;
    }
    const bio = document.getElementById("bio").value;
    const headline = document.getElementById("headline").value;
    const aboutMarkdown = document.getElementById("about-md").value;
    const links = collectLinks();
    const payload = {};
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
        window.setTimeout(function () {
            showToast("资料已保存，1 秒后跳转到主页…");
        }, 1000);
        window.setTimeout(function () {
            window.location.href = "/profile.html?u=" + username;
        }, 2000);
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
    document.getElementById("refresh-cover-gradient").addEventListener("click", handleRefreshGradient);
    document.getElementById("add-link").addEventListener("click", addLink);
    form.addEventListener("submit", saveSettings);
    loadSettings(sessionToken);
}

init();
