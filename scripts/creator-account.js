import { requestApi } from "./api.js";
import { readSession } from "./auth.js";
import { makeIcon } from "./icons.js";
import { SESSION_KEY } from "./config.js";

const shortcuts = [
    { title: "我的主页", icon: "user", address: "/profile.html" },
    { title: "我的文章", icon: "article", address: "/index.html?feed=mine" },
    { title: "草稿箱", icon: "article", address: "/drafts.html" },
    { title: "点赞历史", icon: "heart", address: "/index.html?feed=likes" },
    { title: "我的收藏", icon: "bookmark", address: "/index.html?feed=favorites" },
    { title: "资料设置", icon: "write", address: "/settings.html" }
];
const navigation = document.querySelector(".editor-header nav");
const menu = document.createElement("details");
const summary = document.createElement("summary");
const avatar = document.createElement("span");
const name = document.createElement("span");
const dropdown = document.createElement("div");
const welcome = document.createElement("p");
const profile = document.createElement("a");
const retry = document.createElement("button");
const login = document.createElement("a");
let requestNumber = 0;

// 建立创作页面共用的账号入口，普通链接继续使用浏览器跳转和离开提醒
function buildMenu() {
    menu.className = "account-menu creator-account";
    menu.hidden = true;
    summary.setAttribute("aria-label", "账号菜单");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    name.className = "account-name";
    summary.append(avatar, name, makeIcon("down"));
    dropdown.className = "account-dropdown";
    welcome.className = "account-welcome";
    dropdown.appendChild(welcome);
    for (const shortcut of shortcuts) {
        let link = profile;
        if (shortcut.title !== "我的主页") {
            link = document.createElement("a");
        }
        link.href = shortcut.address;
        link.append(makeIcon(shortcut.icon), document.createTextNode(shortcut.title));
        dropdown.appendChild(link);
    }
    retry.type = "button";
    retry.append(makeIcon("refresh"), document.createTextNode("重新读取账号"));
    retry.addEventListener("click", loadAccount);
    dropdown.appendChild(retry);
    menu.append(summary, dropdown);
    login.href = "/login.html";
    login.textContent = "登录";
    login.hidden = true;
    // 铃铛保持在右侧，菜单位于导航和消息入口之间
    const bell = navigation.querySelector("[data-notifications]");
    navigation.insertBefore(menu, bell);
    navigation.insertBefore(login, bell);
    document.addEventListener("click", closeOutside);
    menu.addEventListener("keydown", closeWithEscape);
    window.addEventListener("storage", accountChanged);
    window.addEventListener("pageshow", restoreAccount);
    loadAccount();
}

// 读取真实账号并核对当前凭证，晚返回的旧身份不能覆盖新账号
async function loadAccount() {
    requestNumber = requestNumber + 1;
    const currentRequest = requestNumber;
    const session = readSession();
    menu.open = false;
    menu.hidden = true;
    login.hidden = Boolean(session);
    if (!session) {
        return;
    }
    try {
        const user = await requestApi("/me", "GET", null, session.token);
        const activeSession = readSession();
        if (currentRequest !== requestNumber || !activeSession || activeSession.token !== session.token) {
            return;
        }
        const letter = user.displayName.slice(0, 1);
        avatar.textContent = letter;
        name.textContent = user.displayName;
        welcome.textContent = user.displayName + "（" + user.username + "）";
        profile.href = "/profile.html?u=" + encodeURIComponent(user.username);
        profile.hidden = false;
        retry.hidden = true;
        if (user.avatarUrl) {
            const image = document.createElement("img");
            image.alt = "";
            // 图片失效时退回昵称首字，不让失效图标占据账号入口
            image.addEventListener("error", function restoreAvatar() {
                if (currentRequest === requestNumber) {
                    avatar.textContent = letter;
                }
            }, { once: true });
            image.src = user.avatarUrl;
            avatar.replaceChildren(image);
        }
        menu.hidden = false;
    } catch (error) {
        const activeSession = readSession();
        if (currentRequest !== requestNumber || !activeSession || activeSession.token !== session.token) {
            return;
        }
        avatar.textContent = "B";
        name.textContent = "账号";
        welcome.textContent = "暂时无法读取账号，请重试";
        profile.hidden = true;
        retry.hidden = false;
        if (error.status === 401) {
            login.hidden = false;
            return;
        }
        menu.hidden = false;
    }
}

// 点击菜单之外的内容时收起，不拦截原本的链接和表单操作
function closeOutside(event) {
    if (!menu.contains(event.target)) {
        menu.open = false;
    }
}

// Escape 收起菜单并把焦点交还头像入口，方便键盘继续操作
function closeWithEscape(event) {
    if (event.key === "Escape" && menu.open) {
        event.preventDefault();
        menu.open = false;
        summary.focus();
    }
}

// 其他标签页切换账号时立即重新核对，清除旧昵称和主页入口
function accountChanged(event) {
    if (!event.key || event.key === SESSION_KEY) {
        loadAccount();
    }
}

// 浏览器恢复缓存页面时重新核对账号，避免显示离开前的旧身份
function restoreAccount(event) {
    if (event.persisted) {
        loadAccount();
    }
}

buildMenu();
