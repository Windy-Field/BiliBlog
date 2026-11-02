import { makeIcon } from "./icons.js";
import { showMessage } from "./common.js";
import { DRAFT_AUTOSAVE_KEY } from "./config.js";

const dialog = document.createElement("dialog");
const button = document.createElement("button");
const message = document.createElement("p");
export const autosaveControl = document.createElement("input");

// 通过导航右侧的独立入口打开设置，原生弹窗管理焦点和 Escape 关闭
function buildSettings() {
    let navigation = document.querySelector(".account-nav, .editor-header nav");
    if (!navigation) {
        const header = document.querySelector(".site-header");
        navigation = document.createElement("nav");
        navigation.className = "site-settings-navigation";
        navigation.setAttribute("aria-label", "页面导航");
        const returnLink = header.querySelector(".account-return");
        navigation.appendChild(returnLink);
        header.appendChild(navigation);
    }
    button.type = "button";
    button.className = "site-settings-button";
    button.title = "设置";
    button.setAttribute("aria-label", "网站设置");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "site-settings-dialog");
    button.setAttribute("aria-expanded", "false");
    button.appendChild(makeIcon("settings"));
    button.addEventListener("click", openSettings);
    const tools = document.createElement("div");
    tools.className = "navigation-tools";
    const bell = navigation.querySelector("[data-notifications]");
    if (bell) {
        tools.appendChild(bell);
    }
    tools.appendChild(button);
    navigation.appendChild(tools);

    dialog.id = "site-settings-dialog";
    dialog.className = "site-settings-dialog";
    dialog.setAttribute("aria-labelledby", "site-settings-title");
    const header = document.createElement("header");
    header.className = "site-settings-heading";
    const title = document.createElement("h2");
    title.id = "site-settings-title";
    title.textContent = "设置";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "site-settings-button";
    close.title = "关闭设置";
    close.setAttribute("aria-label", "关闭设置");
    close.appendChild(makeIcon("close"));
    close.addEventListener("click", closeSettings);
    header.append(title, close);
    message.className = "message";
    message.setAttribute("role", "status");
    message.tabIndex = -1;
    dialog.append(header, message);

    const profile = document.createElement("a");
    profile.className = "site-settings-link";
    profile.href = "/settings.html";
    profile.append(makeIcon("user"), document.createTextNode("资料设置"), makeIcon("next"));
    addSettingsSection("账号", profile);

    const writing = document.createElement("label");
    writing.className = "site-setting-row";
    autosaveControl.id = "autosave-enabled";
    autosaveControl.type = "checkbox";
    autosaveControl.setAttribute("role", "switch");
    autosaveControl.checked = readAutosavePreference();
    autosaveControl.addEventListener("change", saveAutosavePreference);
    writing.append(document.createTextNode("自动保存草稿"), autosaveControl);
    addSettingsSection("写作", writing);
    dialog.addEventListener("close", settingsClosed);
    document.body.appendChild(dialog);
}

// 添加所属模块的设置分区，直接使用原控件，保留它已有的事件和禁用状态
export function addSettingsSection(title, content) {
    const section = document.createElement("section");
    section.className = "site-settings-section";
    const heading = document.createElement("h3");
    let icon = "user";
    if (title === "写作") {
        icon = "write";
    } else if (title === "宠物助手") {
        icon = "comment";
    }
    heading.append(makeIcon(icon), document.createTextNode(title));
    section.append(heading, content);
    dialog.appendChild(section);
}

// 未保存偏好时默认自动保存，存储受限时仍允许用户在本页切换
function readAutosavePreference() {
    try {
        return localStorage.getItem(DRAFT_AUTOSAVE_KEY) !== "false";
    } catch {
        return true;
    }
}

// 只记录用户主动选择的偏好，编辑冲突造成的临时暂停仍由编辑器处理
function saveAutosavePreference() {
    try {
        localStorage.setItem(DRAFT_AUTOSAVE_KEY, String(autosaveControl.checked));
        showMessage(message, "", false);
    } catch {
        showMessage(message, "当前设置仅本页有效，浏览器未能保存偏好", true);
    }
}

// 打开设置前收起账号菜单，设置过程保留当前页面及编辑内容
function openSettings() {
    const accountMenu = document.querySelector(".account-menu");
    if (accountMenu) {
        accountMenu.open = false;
    }
    dialog.showModal();
    button.setAttribute("aria-expanded", "true");
}

// 点击关闭后由浏览器返回设置入口，页面位置保持不变
function closeSettings() {
    dialog.close();
}

// 点击关闭按钮或按 Escape 都同步导航入口状态
function settingsClosed() {
    button.setAttribute("aria-expanded", "false");
}

buildSettings();
