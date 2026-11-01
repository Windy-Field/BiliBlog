import { makeIcon } from "./icons.js";
import { readSession } from "./auth.js";
import { renderMarkdown } from "./markdown-preview.js";
import { PET_NAME, PET_CHAT_PATH, PET_STATUS_PATH, PET_TIMEOUT_MS, PET_MAX_MESSAGE_LENGTH, PET_MAX_MESSAGES, PET_STORAGE_KEY, PET_SESSION_KEY, PET_STATES, PET_GREETING_VISIBLE_MS, PET_GREETING_HIDDEN_MS, PET_DRAG_THRESHOLD, PET_EDGE_MARGIN, SESSION_KEY } from "./config.js";

const greetings = ["你好，我是 " + PET_NAME, "有什么知识想了解？", "一起把问题弄明白吧", "学习、写作，都可以聊"];
const root = document.createElement("aside");
const toggle = document.createElement("button");
const panel = document.createElement("section");
const messages = document.createElement("div");
const input = document.createElement("input");
const sendButton = document.createElement("button");
const status = document.createElement("small");
const greeting = document.createElement("span");
const layers = [];
const prompts = [];
let activeLayer = 0;
let imageRevision = 0;
let controller = null;
let requestRevision = 0;
let greetingTimer = 0;
let greetingIndex = 0;
let dragged = false;
let drag = null;
let settings = readSettings();
let sessionId = "";
let owner = sessionOwner();
let sessionStorageKey = "";
let enabledInput;
let greetingInput;

// 本机设置损坏时恢复默认值，位置只保存比例，窗口缩小时仍能找到宠物
function readSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(PET_STORAGE_KEY) || "null");
        if (saved && typeof saved === "object") {
            return { enabled: saved.enabled !== false, greeting: saved.greeting !== false, position: saved.position || null };
        }
    } catch {
        // 存储不可用时仍显示宠物，不阻断博客页面
    }
    return { enabled: true, greeting: true, position: null };
}

// 设置保存失败只影响下次进入，不影响当前操作
function saveSettings() {
    try {
        localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(settings));
    } catch {
        status.textContent = "当前设置仅本页有效";
    }
}

// 会话按登录凭证隔离，博客凭证不会发送给 AI 服务
function sessionOwner() {
    const session = readSession();
    if (session) {
        return session.token;
    }
    return "guest";
}

// 创建普通文字节点，界面文案和用户输入不作为 HTML 执行
function textElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

// 工具按钮统一使用现有图标，并给键盘和辅助阅读提供名称
function toolButton(icon, title, handler) {
    const button = textElement("button", "pet-tool", "");
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.appendChild(makeIcon(icon));
    button.addEventListener("click", handler);
    return button;
}

// 建立全站共用的小窗口，宠物不挤占文章布局，浮层由原生 popover 管理
function buildPet() {
    root.id = "ai-pet";
    root.className = "ai-pet";
    root.setAttribute("aria-label", PET_NAME + " AI 助手");
    toggle.type = "button";
    toggle.className = "pet-toggle";
    toggle.setAttribute("aria-label", "打开 " + PET_NAME + " 对话，可拖动调整位置");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "pet-panel");
    const stage = textElement("span", "pet-stage", "");
    for (let index = 0; index < 2; index = index + 1) {
        const image = document.createElement("img");
        image.src = PET_STATES.idle;
        image.alt = "";
        image.draggable = false;
        image.className = "pet-layer";
        image.classList.toggle("is-active", index === 0);
        layers.push(image);
        stage.appendChild(image);
    }
    greeting.className = "pet-greeting";
    toggle.append(stage, greeting);
    toggle.addEventListener("click", togglePanel);
    toggle.addEventListener("pointerenter", hoverPet);
    toggle.addEventListener("pointerleave", leavePet);
    toggle.addEventListener("pointerdown", startDrag);
    toggle.addEventListener("pointermove", moveDrag);
    toggle.addEventListener("pointerup", finishDrag);
    toggle.addEventListener("pointercancel", cancelDrag);
    panel.id = "pet-panel";
    panel.className = "pet-panel";
    panel.setAttribute("popover", "auto");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "pet-title");
    const header = textElement("header", "pet-header", "");
    const identity = document.createElement("div");
    const title = textElement("strong", "", PET_NAME);
    title.id = "pet-title";
    status.textContent = "来找我聊聊吧";
    identity.append(title, status);
    const actions = textElement("div", "pet-actions", "");
    actions.append(toolButton("refresh", "清空 " + PET_NAME + " 对话", clearConversation), toolButton("close", "收起 " + PET_NAME + " 对话", closePanel));
    header.append(identity, actions);
    messages.className = "pet-messages";
    messages.setAttribute("role", "log");
    messages.setAttribute("aria-live", "polite");
    const shortcuts = textElement("div", "pet-prompts", "");
    for (const question of ["如何查找并核对可靠的知识来源？", "请通俗解释一个机器学习的基础概念"]) {
        const button = textElement("button", "", question);
        button.type = "button";
        // 快捷问题与手动输入共用一次发送流程
        button.addEventListener("click", function sendPrompt() {
            sendMessage(question);
        });
        prompts.push(button);
        shortcuts.appendChild(button);
    }
    const form = textElement("form", "pet-form", "");
    const label = textElement("label", "visually-hidden", "发给 " + PET_NAME + " 的问题");
    label.htmlFor = "pet-input";
    input.id = "pet-input";
    input.type = "text";
    input.maxLength = PET_MAX_MESSAGE_LENGTH;
    input.placeholder = "输入想了解的问题……";
    input.autocomplete = "off";
    sendButton.type = "submit";
    sendButton.setAttribute("aria-label", "发送给 " + PET_NAME);
    sendButton.appendChild(makeIcon("send"));
    form.append(label, input, sendButton);
    form.addEventListener("submit", submitMessage);
    panel.append(header, messages, shortcuts, form);
    panel.addEventListener("toggle", panelChanged);
    root.appendChild(toggle);
    document.body.append(root, panel);
    addSettings();
    loadConversationId();
    appendMessage("你好，我是 **" + PET_NAME + "**。可以帮你梳理知识、解答问题和查找思路，检索到的知识来源会随回答显示", "assistant");
    applySettings();
    window.addEventListener("resize", adaptPosition);
    window.addEventListener("storage", storageChanged);
    window.addEventListener("pagehide", cancelRequest);
    // 页面弹窗打开时暂时收起宠物，避免干扰阅读和编辑确认
    const observer = new MutationObserver(syncModalVisibility);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"], childList: true });
}

// 设置入口始终可见，即使隐藏宠物也可重新开启
function addSettings() {
    const footer = document.querySelector(".creator-footer, .home-footer, .profile-footer, .account-footer");
    const group = textElement("details", "pet-settings", "");
    const summary = textElement("summary", "", "宠物助手设置");
    const controls = textElement("div", "pet-setting-controls", "");
    const enabledLabel = textElement("label", "", "");
    enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledLabel.append(enabledInput, document.createTextNode("显示 " + PET_NAME));
    enabledInput.addEventListener("change", changeEnabled);
    const greetingLabel = textElement("label", "", "");
    greetingInput = document.createElement("input");
    greetingInput.type = "checkbox";
    greetingLabel.append(greetingInput, document.createTextNode("动态问候"));
    greetingInput.addEventListener("change", changeGreeting);
    controls.append(enabledLabel, greetingLabel);
    group.append(summary, controls);
    footer.appendChild(group);
}

// 状态图片预加载完成后双层交替显示，快速操作时忽略旧加载结果
function setState(state) {
    let address = PET_STATES[state];
    if (!address) {
        address = PET_STATES.idle;
    }
    imageRevision = imageRevision + 1;
    const revision = imageRevision;
    const image = new Image();
    // 图片准备好后才切换，避免思考和悬停状态闪白
    image.addEventListener("load", function showStateImage() {
        if (revision !== imageRevision) {
            return;
        }
        const next = (activeLayer + 1) % layers.length;
        layers[next].src = address;
        layers[next].classList.add("is-active");
        layers[activeLayer].classList.remove("is-active");
        activeLayer = next;
    }, { once: true });
    image.src = address;
}

// 对话关闭或空闲时显示悬停反馈，不覆盖正在思考的状态
function hoverPet() {
    if (!controller) {
        setState("hover");
    }
}

// 鼠标离开后回到待机状态
function leavePet() {
    if (!controller) {
        setState("idle");
    }
}

// 只保留有限条当前页消息，长时间使用不持续堆积 DOM
function appendMessage(text, role) {
    const message = textElement("div", "pet-message " + role, "");
    if (role === "assistant") {
        renderMarkdown(message, text);
    } else {
        message.textContent = text;
    }
    messages.appendChild(message);
    while (messages.children.length > PET_MAX_MESSAGES) {
        messages.firstElementChild.remove();
    }
    messages.scrollTop = messages.scrollHeight;
    return message;
}

// 只展示服务端实际返回的知识来源，链接限制为网页协议，缺少链接时显示文档名
function appendSources(message, sources) {
    if (!Array.isArray(sources) || sources.length === 0) {
        return;
    }
    const section = textElement("section", "pet-sources", "");
    section.appendChild(textElement("strong", "", "参考来源"));
    const list = document.createElement("ul");
    for (const source of sources) {
        if (!source || typeof source.title !== "string") {
            continue;
        }
        const item = document.createElement("li");
        let address = null;
        try {
            address = new URL(source.url);
        } catch {
            address = null;
        }
        if (address && (address.protocol === "https:" || address.protocol === "http:")) {
            const link = textElement("a", "", source.title);
            link.href = address.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            item.appendChild(link);
        } else {
            item.textContent = source.title;
        }
        list.appendChild(item);
    }
    if (list.hasChildNodes()) {
        section.appendChild(list);
        message.appendChild(section);
    }
}

// 对话编号按应用和当前账号隔离，只存在当前标签页，不存储对话正文
async function loadConversationId() {
    const expectedOwner = owner;
    const revision = requestRevision;
    try {
        const bytes = new TextEncoder().encode(expectedOwner);
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        let fingerprint = "";
        for (const value of new Uint8Array(digest)) {
            fingerprint = fingerprint + value.toString(16).padStart(2, "0");
        }
        if (expectedOwner !== owner || revision !== requestRevision) {
            return;
        }
        sessionStorageKey = PET_SESSION_KEY + "-" + fingerprint;
        const saved = JSON.parse(sessionStorage.getItem(sessionStorageKey) || "null");
        if (saved && typeof saved.id === "string") {
            sessionId = saved.id;
        }
    } catch {
        // 非安全页面或存储不可用时，只在当前页面内延续对话
        if (expectedOwner === owner && revision === requestRevision) {
            sessionStorageKey = "";
        }
    }
}

// 清空时取消旧请求并重置会话，迟到回复不能重新填回已清空的窗口
function clearConversation() {
    cancelRequest();
    sessionId = "";
    try {
        if (sessionStorageKey) {
            sessionStorage.removeItem(sessionStorageKey);
        }
    } catch {
        // 无法保存会话时继续使用本页临时会话
    }
    messages.replaceChildren();
    appendMessage("对话已清空，我们重新聊吧", "assistant");
    status.textContent = "来找我聊聊吧";
    input.value = "";
    input.focus();
}

// 请求取消与状态恢复共用入口，页面离开和换账号都能及时结束旧请求
function cancelRequest() {
    requestRevision = requestRevision + 1;
    if (controller) {
        controller.abort();
        controller = null;
    }
    updateSending();
}

// 发送期间暂停重复操作，输入内容和错误都保留可读反馈
function updateSending() {
    const busy = Boolean(controller);
    sendButton.disabled = busy;
    for (const button of prompts) {
        button.disabled = busy;
    }
    messages.setAttribute("aria-busy", String(busy));
    if (busy) {
        setState("thinking");
    } else {
        setState("idle");
    }
}

// 发送普通文字对话，不自动读取文章、草稿或任何账号资料
async function sendMessage(text) {
    if (owner !== sessionOwner()) {
        clearConversation();
        owner = sessionOwner();
        sessionStorageKey = "";
        loadConversationId();
    }
    const message = text.trim();
    if (controller || !message || message.length > PET_MAX_MESSAGE_LENGTH) {
        return;
    }
    controller = new AbortController();
    const activeController = controller;
    requestRevision = requestRevision + 1;
    const revision = requestRevision;
    appendMessage(message, "user");
    const pending = appendMessage("让我想一想……", "assistant pending");
    input.value = "";
    status.textContent = "正在思考";
    updateSending();
    // 超时只结束当前请求，不自动重发，避免重复计费或重复回答
    const timer = window.setTimeout(function timeoutRequest() {
        activeController.abort();
    }, PET_TIMEOUT_MS);
    try {
        const response = await fetch(PET_CHAT_PATH, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: message, sessionId: sessionId }),
            signal: activeController.signal
        });
        const result = await response.json();
        if (revision !== requestRevision || owner !== sessionOwner()) {
            return;
        }
        if (!response.ok || typeof result.reply !== "string") {
            throw new Error(result.error || "AI 暂时无法回答，请稍后重试");
        }
        renderMarkdown(pending, result.reply);
        appendSources(pending, result.sources);
        status.textContent = "回答完成";
        if (typeof result.sessionId === "string") {
            sessionId = result.sessionId;
            try {
                if (sessionStorageKey) {
                    sessionStorage.setItem(sessionStorageKey, JSON.stringify({ id: sessionId }));
                }
            } catch {
                // 会话保存失败不影响当前回答
            }
        }
    } catch (error) {
        if (revision === requestRevision) {
            let text = PET_NAME + " 暂时没接上线，请稍后重试";
            if (error.name === "AbortError") {
                text = "回答等待超时，请稍后重试";
            } else if (!(error instanceof TypeError)) {
                text = error.message;
            }
            pending.textContent = text;
            pending.classList.add("error");
            status.textContent = "暂时无法回答";
            input.value = message;
        }
    } finally {
        window.clearTimeout(timer);
        if (revision === requestRevision) {
            controller = null;
            pending.classList.remove("pending");
            updateSending();
            messages.scrollTop = messages.scrollHeight;
        }
    }
}

// 普通提交沿用浏览器输入法行为，不拦截中文输入组合
function submitMessage(event) {
    event.preventDefault();
    sendMessage(input.value);
}

// 拖动后的鼠标释放不再当作点击，普通键盘操作仍可打开对话
function togglePanel(event) {
    if (dragged && event.detail !== 0) {
        dragged = false;
        return;
    }
    if (panel.matches(":popover-open")) {
        closePanel();
    } else {
        adaptPosition();
        panel.showPopover();
        input.focus();
        checkStatus();
    }
}

// 状态接口只检查配置，不为页面打开额外消耗模型额度
async function checkStatus() {
    if (controller) {
        return;
    }
    try {
        const response = await fetch(PET_STATUS_PATH, { signal: AbortSignal.timeout(5000) });
        const result = await response.json();
        if (!controller && result.configured === false) {
            status.textContent = "AI 服务尚未配置";
        }
    } catch {
        if (!controller) {
            status.textContent = "连接状态暂未确认，可直接发送问题";
        }
    }
}

// 原生 popover 提供外部点击和 Escape 收起，不强制锁住页面焦点
function closePanel() {
    if (panel.matches(":popover-open")) {
        panel.hidePopover();
    }
}

// 同步按钮状态和问候计时，外部点击关闭也走同一流程
function panelChanged(event) {
    const open = event.newState === "open";
    toggle.setAttribute("aria-expanded", String(open));
    restartGreeting();
}

// 开始拖动时记录坐标，阈值以内仍按普通点击处理
function startDrag(event) {
    if (event.button !== 0) {
        return;
    }
    const bounds = root.getBoundingClientRect();
    dragged = false;
    drag = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, left: bounds.left, top: bounds.top };
    toggle.setPointerCapture(event.pointerId);
}

// 位置限制在视口内，直接更新位置不播放拖动滞后动画
function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointer) {
        return;
    }
    const changeX = event.clientX - drag.startX;
    const changeY = event.clientY - drag.startY;
    if (!dragged && Math.hypot(changeX, changeY) < PET_DRAG_THRESHOLD) {
        return;
    }
    dragged = true;
    event.preventDefault();
    const maxLeft = Math.max(PET_EDGE_MARGIN, innerWidth - root.offsetWidth - PET_EDGE_MARGIN);
    const maxTop = Math.max(PET_EDGE_MARGIN, innerHeight - root.offsetHeight - PET_EDGE_MARGIN);
    const left = Math.max(PET_EDGE_MARGIN, Math.min(maxLeft, drag.left + changeX));
    const top = Math.max(PET_EDGE_MARGIN, Math.min(maxTop, drag.top + changeY));
    settings.position = { horizontal: left / Math.max(1, maxLeft), vertical: top / Math.max(1, maxTop) };
    adaptPosition();
}

// 放开时才保存位置，不在每个鼠标移动事件中写入本地存储
function finishDrag(event) {
    if (drag && drag.pointer === event.pointerId) {
        drag = null;
        if (dragged) {
            saveSettings();
        }
    }
}

// 手势取消后清理拖动记录，避免下次移动沿用旧起点
function cancelDrag() {
    drag = null;
    dragged = false;
}

// 屏幕或窗口变化时保持宠物与聊天面板可见，不让保存的位置落在屏幕外
function adaptPosition() {
    if (settings.position && Number.isFinite(settings.position.horizontal) && Number.isFinite(settings.position.vertical)) {
        const maxLeft = Math.max(PET_EDGE_MARGIN, innerWidth - root.offsetWidth - PET_EDGE_MARGIN);
        const maxTop = Math.max(PET_EDGE_MARGIN, innerHeight - root.offsetHeight - PET_EDGE_MARGIN);
        const left = Math.max(PET_EDGE_MARGIN, Math.min(maxLeft, settings.position.horizontal * maxLeft));
        const top = Math.max(PET_EDGE_MARGIN, Math.min(maxTop, settings.position.vertical * maxTop));
        root.style.left = left + "px";
        root.style.top = top + "px";
        root.style.right = "auto";
        root.style.bottom = "auto";
    }
    const bounds = root.getBoundingClientRect();
    const width = Math.min(360, innerWidth - PET_EDGE_MARGIN * 2);
    const left = Math.max(PET_EDGE_MARGIN, Math.min(innerWidth - width - PET_EDGE_MARGIN, bounds.right - width));
    panel.style.left = left + "px";
    positionGreeting();
}

// 气泡中心对齐图片中左耳上方的锚点，贴近屏幕边缘时只做必要的防溢出调整
function positionGreeting() {
    if (root.hidden) {
        return;
    }
    const bounds = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    const horizontal = Number.parseFloat(style.getPropertyValue("--pet-greeting-anchor")) / 100;
    const offset = Number.parseFloat(style.getPropertyValue("--pet-greeting-offset"));
    const halfWidth = greeting.offsetWidth / 2;
    const halfHeight = greeting.offsetHeight / 2;
    const desiredLeft = bounds.left + bounds.width * horizontal;
    const desiredTop = bounds.top - offset;
    const centerLeft = Math.max(PET_EDGE_MARGIN + halfWidth, Math.min(innerWidth - PET_EDGE_MARGIN - halfWidth, desiredLeft));
    const centerTop = Math.max(PET_EDGE_MARGIN + halfHeight, desiredTop);
    greeting.style.left = centerLeft - bounds.left + "px";
    greeting.style.top = centerTop - bounds.top + "px";
}

// 动态问候只在宠物可见且对话关闭时轮换，不抢占输入焦点
function restartGreeting() {
    window.clearTimeout(greetingTimer);
    root.classList.remove("has-greeting");
    if (root.hidden || !settings.greeting || panel.matches(":popover-open") || document.visibilityState === "hidden") {
        return;
    }
    greeting.textContent = greetings[greetingIndex % greetings.length];
    positionGreeting();
    greetingIndex = greetingIndex + 1;
    root.classList.add("has-greeting");
    // 本句展示结束后留出间隔，避免语录一直遮挡页面
    greetingTimer = window.setTimeout(function hideGreeting() {
        root.classList.remove("has-greeting");
        greetingTimer = window.setTimeout(restartGreeting, PET_GREETING_HIDDEN_MS);
    }, PET_GREETING_VISIBLE_MS);
}

// 设置变化立刻应用，隐藏时收起聊天，开关仍保留在页脚
function applySettings() {
    enabledInput.checked = settings.enabled;
    greetingInput.checked = settings.greeting;
    root.hidden = !settings.enabled;
    if (!settings.enabled) {
        closePanel();
    }
    adaptPosition();
    syncModalVisibility();
    restartGreeting();
}

// 读写显示开关只修改宠物，不影响博客的其他页面设置
function changeEnabled() {
    settings.enabled = enabledInput.checked;
    saveSettings();
    applySettings();
}

// 动态语录单独开关，聊天和拖动仍可使用
function changeGreeting() {
    settings.greeting = greetingInput.checked;
    saveSettings();
    restartGreeting();
}

// 原生模态窗口出现时不让宠物遮住正文或操作按钮
function syncModalVisibility() {
    const modal = document.querySelector("dialog[open]");
    const hidden = !settings.enabled || Boolean(modal);
    if (root.hidden !== hidden) {
        root.hidden = hidden;
        if (hidden) {
            closePanel();
        }
        restartGreeting();
    }
}

// 设置跨页面同步，登录账号变化时取消旧请求并清空旧 AI 会话
function storageChanged(event) {
    if (event.key === PET_STORAGE_KEY || !event.key) {
        settings = readSettings();
        applySettings();
    }
    if ((event.key === SESSION_KEY || !event.key) && owner !== sessionOwner()) {
        clearConversation();
        owner = sessionOwner();
        sessionStorageKey = "";
        loadConversationId();
        closePanel();
    }
}

// 页面切入后台停止语录定时器，返回后恢复
document.addEventListener("visibilitychange", restartGreeting);
buildPet();
