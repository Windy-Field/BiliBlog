import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy } from "./common.js";
import { makeIcon } from "./icons.js";
import { NOTIFICATION_PAGE_SIZE, NOTIFICATION_SCAN_SIZE, MAX_PAGE, LOCAL_UNREAD_PREFIX } from "./config.js";

const pageSize = NOTIFICATION_PAGE_SIZE;
const BADGE_LIMIT = 99;
const bell = document.querySelector("[data-notifications]");
const typeNames = {
    LIKE: "点赞",
    COMMENT: "评论",
    REPLY: "回复",
    FOLLOW: "关注",
    ORDER_PAID: "交易"
};
let token = null;
let page = 1;
let pageCount = 1;
let loading = false;
let writing = false;
let requestNumber = 0;
let countRequest = 0;
let listToken = null;
let ownerToken = null;
let ownerRequest = null;
let dialog;
let list;
let status;
let login;
let typeFilter;
let readFilter;
let refresh;
let readAll;
let previous;
let next;
let pageLabel;
let pager;

// 用服务器确认的用户名区分本机标记，重新登录后仍能找到同一账号的记录
async function notificationOwner(expectedToken) {
    if (ownerToken !== expectedToken) {
        ownerToken = expectedToken;
        ownerRequest = requestApi("/me", "GET", null, expectedToken);
    }
    const pending = ownerRequest;
    try {
        const user = await pending;
        return user.username;
    } catch (error) {
        if (ownerRequest === pending) {
            ownerToken = null;
            ownerRequest = null;
        }
        throw error;
    }
}

// 本地只保存通知 ID，避免额外保存消息正文或登录凭证
function readLocalUnread(username) {
    const key = LOCAL_UNREAD_PREFIX + username;
    const text = localStorage.getItem(key);
    if (!text) {
        return [];
    }
    let saved;
    try {
        saved = JSON.parse(text);
    } catch {
        throw new Error("本机未读记录无法读取，请清除该账号的本机通知记录后重试");
    }
    if (!Array.isArray(saved)) {
        throw new Error("本机未读记录格式异常");
    }
    const ids = [];
    for (const id of saved) {
        if (typeof id === "string" && id.length > 0 && !ids.includes(id)) {
            ids.push(id);
        }
    }
    return ids;
}

// 保存成功后才更新界面，浏览器拒绝存储时保留原状态并提示
function saveLocalUnread(username, ids) {
    const key = LOCAL_UNREAD_PREFIX + username;
    try {
        if (ids.length === 0) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, JSON.stringify(ids));
        }
    } catch {
        throw new Error("浏览器无法保存本机未读标记，请检查网站存储权限");
    }
}

// 查看或标记已读后清除本机记录，传空 ID 时清除该账号全部记录
function clearLocalUnread(username, notificationId) {
    const ids = readLocalUnread(username);
    const remaining = [];
    if (notificationId) {
        for (const id of ids) {
            if (id !== notificationId) {
                remaining.push(id);
            }
        }
    }
    saveLocalUnread(username, remaining);
}

// 本机有标记时先合并阅读状态，再分页，避免未读消息落在服务器的已读分页里
async function requestNotifications(parameters, expectedToken, localIds) {
    if (localIds.length === 0 || parameters.get("readStatus") === "all") {
        const result = await requestApi("/notifications?" + parameters.toString(), "GET", null, expectedToken);
        for (const notification of result.items) {
            notification.localUnread = localIds.includes(notification.id);
        }
        return result;
    }
    const serverParameters = new URLSearchParams(parameters);
    // 本机标记不在服务器上，服务器筛出的“已读”可能仍是本机“未读”
    // 因此有本机标记时先读完整分类结果，合并状态后再筛选和分页，防止漏消息
    serverParameters.set("readStatus", "all");
    serverParameters.set("pageSize", String(NOTIFICATION_SCAN_SIZE));
    const items = [];
    let serverPage = 1;
    let total = 0;
    do {
        serverParameters.set("page", String(serverPage));
        const result = await requestApi("/notifications?" + serverParameters.toString(), "GET", null, expectedToken);
        if (!sameSession(expectedToken)) {
            return { items: [], total: 0 };
        }
        total = result.total;
        for (const notification of result.items) {
            notification.localUnread = localIds.includes(notification.id);
            const unread = !notification.readAt || notification.localUnread;
            const filter = parameters.get("readStatus");
            if (filter === "unread" && !unread) {
                continue;
            }
            if (filter === "read" && unread) {
                continue;
            }
            items.push(notification);
        }
        if (result.items.length === 0) {
            break;
        }
        serverPage = serverPage + 1;
    } while ((serverPage - 1) * NOTIFICATION_SCAN_SIZE < total && serverPage <= MAX_PAGE);
    const requestedPage = Number(parameters.get("page"));
    const start = (requestedPage - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);
    return { items: pageItems, total: items.length };
}

// 将一条已读消息记为本机未读，服务器上的阅读状态继续保留
async function markLocalUnread(notification) {
    if (writing || loading) {
        return;
    }
    const expectedToken = syncSession();
    if (!expectedToken || expectedToken !== listToken) {
        await loadNotifications();
        return;
    }
    writing = true;
    updateControls();
    try {
        const username = await notificationOwner(expectedToken);
        if (!sameSession(expectedToken)) {
            return;
        }
        const ids = readLocalUnread(username);
        if (!ids.includes(notification.id)) {
            ids.push(notification.id);
        }
        saveLocalUnread(username, ids);
        await loadNotifications();
        if (sameSession(expectedToken)) {
            showToast("已标记为本机未读");
        }
    } catch (error) {
        handleError(error, expectedToken);
    } finally {
        writing = false;
        await loadUnreadCount();
        updateControls();
    }
}

// 创建文字节点，昵称和通知内容按纯文字显示
function textElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

// 创建可复用的消息按钮，点击后执行传入函数
function makeButton(text, handler) {
    const button = textElement("button", "notification-button", text);
    button.type = "button";
    button.addEventListener("click", handler);
    return button;
}

// 创建带标签的筛选菜单，选项值直接对应接口参数
function makeFilter(label, options, parent) {
    const wrapper = textElement("label", "notification-filter", label);
    const select = document.createElement("select");
    select.setAttribute("aria-label", label);
    for (const option of options) {
        const item = textElement("option", "", option.label);
        item.value = option.value;
        select.appendChild(item);
    }
    select.addEventListener("change", resetPage);
    wrapper.appendChild(select);
    parent.appendChild(wrapper);
    return select;
}

// 原生弹窗负责焦点限制和 Escape 关闭，各页面共用同一个消息界面
function buildDialog() {
    dialog = document.createElement("dialog");
    dialog.className = "notification-dialog";
    dialog.id = "notification-dialog";
    dialog.setAttribute("aria-labelledby", "notification-title");
    bell.setAttribute("aria-controls", dialog.id);
    const header = textElement("div", "notification-header", "");
    const title = textElement("h2", "", "消息通知");
    title.id = "notification-title";
    const close = makeButton("", closeDialog);
    close.classList.add("notification-icon");
    close.appendChild(makeIcon("close"));
    close.setAttribute("aria-label", "关闭消息通知");
    close.title = "关闭";
    header.append(title, close);
    const tools = textElement("div", "notification-tools", "");
    const filters = textElement("div", "notification-filters", "");
    typeFilter = makeFilter("消息类型", [
        { value: "", label: "全部类型" },
        { value: "LIKE", label: "点赞" },
        { value: "COMMENT", label: "评论" },
        { value: "REPLY", label: "回复" },
        { value: "FOLLOW", label: "关注" },
        { value: "ORDER_PAID", label: "交易" }
    ], filters);
    readFilter = makeFilter("阅读状态", [
        { value: "all", label: "全部消息" },
        { value: "unread", label: "未读" },
        { value: "read", label: "已读" }
    ], filters);
    refresh = makeButton("刷新", refreshNotifications);
    readAll = makeButton("全部已读", markAllRead);
    const toolbarActions = textElement("div", "notification-toolbar-actions", "");
    toolbarActions.append(refresh, readAll);
    tools.append(filters, toolbarActions);
    status = textElement("p", "message notification-status", "");
    status.setAttribute("role", "status");
    status.tabIndex = -1;
    login = textElement("a", "notification-login", "登录后查看消息");
    login.href = "/login.html";
    list = textElement("div", "notification-list", "");
    pager = textElement("nav", "notification-pagination", "");
    pager.setAttribute("aria-label", "消息分页");
    previous = makeButton("", previousPage);
    previous.appendChild(makeIcon("previous"));
    previous.setAttribute("aria-label", "上一页消息");
    next = makeButton("", nextPage);
    next.appendChild(makeIcon("next"));
    next.setAttribute("aria-label", "下一页消息");
    pageLabel = textElement("span", "", "");
    pager.append(previous, pageLabel, next);
    dialog.append(header, tools, status, login, list, pager);
    document.body.appendChild(dialog);
}

// 切换账号后立即移除旧消息，使晚到的响应也无法写回界面
function syncSession() {
    const session = readSession();
    let currentToken = null;
    if (session) {
        currentToken = session.token;
    }
    if (token !== currentToken) {
        // 另一个标签页可能刚换了账号，先清空旧消息，再允许新账号的响应更新界面
        token = currentToken;
        requestNumber = requestNumber + 1;
        page = 1;
        pageCount = 1;
        loading = false;
        listToken = null;
        list.replaceChildren();
        showMessage(status, "", false);
        updateBadge(null);
    }
    return token;
}

// 响应只属于发出请求时的账号，账号变化后丢弃结果
function sameSession(expectedToken) {
    return syncSession() === expectedToken;
}

// 角标合并服务器未读数与本机标记，数量未知时隐藏角标
function updateBadge(count) {
    const badge = bell.querySelector(".notification-badge");
    badge.hidden = !count;
    let label = "消息通知";
    if (count > 0) {
        badge.textContent = String(count);
        if (count > BADGE_LIMIT) {
            badge.textContent = BADGE_LIMIT + "+";
        }
        label = label + "，" + count + " 条未读";
    }
    bell.setAttribute("aria-label", label);
    bell.title = label;
}

// 登录失效时只清理本次凭证，保留其他标签页刚建立的新登录
function handleError(error, expectedToken) {
    if (!sameSession(expectedToken)) {
        return;
    }
    if (error.status === 401) {
        clearSession();
        syncSession();
        login.hidden = false;
        showMessage(status, "登录已失效，请重新登录后查看消息", true);
        updateControls();
    } else {
        showMessage(status, error.message, true);
    }
}

// 每次打开消息和返回页面时读取未读数，不自动标记消息已读
async function loadUnreadCount() {
    const expectedToken = syncSession();
    countRequest = countRequest + 1;
    const currentRequest = countRequest;
    if (!expectedToken) {
        return;
    }
    try {
        const username = await notificationOwner(expectedToken);
        if (!sameSession(expectedToken)) {
            return;
        }
        const localIds = readLocalUnread(username);
        let count;
        if (localIds.length === 0) {
            const result = await requestApi("/notifications/unread-count", "GET", null, expectedToken);
            count = result.count;
        } else {
            // 按消息实际状态合并，已删除的记录和服务器未读消息都不会重复计数
            const parameters = new URLSearchParams();
            parameters.set("page", "1");
            parameters.set("pageSize", String(pageSize));
            parameters.set("readStatus", "unread");
            const result = await requestNotifications(parameters, expectedToken, localIds);
            count = result.total;
        }
        if (sameSession(expectedToken) && currentRequest === countRequest) {
            updateBadge(count);
        }
    } catch (error) {
        if (sameSession(expectedToken) && currentRequest === countRequest) {
            updateBadge(null);
            if (error.status === 401) {
                handleError(error, expectedToken);
            }
        }
    }
}

// 请求期间禁用筛选和写入入口，避免重复标记和交错翻页
function updateControls() {
    const busy = loading || writing;
    typeFilter.disabled = busy || !token;
    readFilter.disabled = busy || !token;
    refresh.disabled = busy || !token;
    readAll.disabled = busy || !token;
    previous.disabled = busy || page <= 1;
    next.disabled = busy || page >= pageCount;
    pageLabel.textContent = page + " / " + pageCount;
    pager.hidden = !token || pageCount <= 1;
    setBusy(refresh, loading);
    const actions = list.querySelectorAll("button");
    for (const action of actions) {
        action.disabled = busy;
    }
}

// 按当前筛选读取一页通知，删除或标记后页数减少时退回最后一页
async function loadNotifications() {
    const expectedToken = syncSession();
    requestNumber = requestNumber + 1;
    const currentRequest = requestNumber;
    login.hidden = Boolean(expectedToken);
    list.replaceChildren();
    if (!expectedToken) {
        loading = false;
        showMessage(status, "登录后查看你的消息", false);
        updateControls();
        return;
    }
    loading = true;
    showMessage(status, "正在读取消息", false);
    updateControls();
    const parameters = new URLSearchParams();
    parameters.set("page", String(page));
    parameters.set("pageSize", String(pageSize));
    parameters.set("readStatus", readFilter.value);
    if (typeFilter.value) {
        parameters.set("type", typeFilter.value);
    }
    try {
        const username = await notificationOwner(expectedToken);
        if (!sameSession(expectedToken)) {
            return;
        }
        const localIds = readLocalUnread(username);
        const result = await requestNotifications(parameters, expectedToken, localIds);
        if (!sameSession(expectedToken) || currentRequest !== requestNumber) {
            return;
        }
        pageCount = Math.max(1, Math.ceil(result.total / pageSize));
        if (page > pageCount) {
            page = pageCount;
            await loadNotifications();
            return;
        }
        for (const notification of result.items) {
            list.appendChild(makeNotification(notification));
        }
        listToken = expectedToken;
        let message = "";
        if (result.items.length === 0) {
            message = "暂无符合条件的消息";
        }
        showMessage(status, message, false);
    } catch (error) {
        if (currentRequest === requestNumber) {
            handleError(error, expectedToken);
        }
    } finally {
        if (currentRequest === requestNumber) {
            loading = false;
            updateControls();
        }
    }
}

// 将通知类型转成明确的动作文字，交易消息使用后端提供的商品摘要
function notificationText(notification) {
    let text = notification.actor.displayName;
    if (notification.type === "LIKE") {
        text = text + " 赞了你的文章";
    } else if (notification.type === "COMMENT") {
        text = text + " 评论了你的文章";
    } else if (notification.type === "REPLY") {
        text = text + " 回复了你的评论";
    } else if (notification.type === "FOLLOW") {
        text = text + " 关注了你";
    } else if (notification.order) {
        const order = notification.order;
        text = text + " 的交易已付款：" + order.productTitle;
        text = text + "，数量 " + order.quantity;
        const amount = (order.totalCents / 100).toFixed(2);
        text = text + "，金额 ¥" + amount;
    } else {
        text = text + " 的交易消息";
    }
    return text;
}

// 每条消息提供查看与已读操作，失效目标保留说明和标记入口
function makeNotification(notification) {
    const row = textElement("article", "notification-item", "");
    row.dataset.notificationId = notification.id;
    const unread = !notification.readAt || notification.localUnread === true;
    row.dataset.unread = String(unread);
    const heading = textElement("div", "notification-meta", "");
    heading.appendChild(textElement("span", "notification-type", typeNames[notification.type]));
    let readText = "已读";
    if (unread) {
        readText = "未读";
    }
    if (notification.localUnread) {
        readText = "本机未读";
    }
    heading.appendChild(textElement("span", "", readText));
    const time = textElement("time", "", new Date(notification.createdAt).toLocaleString("zh-CN"));
    time.dateTime = notification.createdAt;
    heading.appendChild(time);
    const text = textElement("p", "notification-text", notificationText(notification));
    const actions = textElement("div", "notification-actions", "");
    if (!notification.targetAvailable) {
        actions.appendChild(textElement("span", "notification-unavailable", "相关内容已删除或暂时无法访问"));
    } else if (notification.type !== "ORDER_PAID") {
        // 查看该条通知对应的文章、评论或作者
        actions.appendChild(makeButton("查看", function viewNotification() {
            openNotification(notification);
        }));
    }
    if (unread) {
        // 只更新当前通知的阅读状态
        actions.appendChild(makeButton("标记已读", function readNotification() {
            markRead(notification);
        }));
    } else {
        // 本机未读记录按当前账号单独保存
        const unreadButton = makeButton("标记未读", function unreadNotification() {
            markLocalUnread(notification);
        });
        unreadButton.title = "仅保存在当前浏览器";
        actions.appendChild(unreadButton);
    }
    row.append(heading, text, actions);
    return row;
}

// 单条或全部标记成功后回读列表与数量，失败时不猜测已读结果
async function writeReadState(path, notificationId) {
    if (writing || loading) {
        return false;
    }
    const expectedToken = syncSession();
    if (!expectedToken || expectedToken !== listToken) {
        await loadNotifications();
        return false;
    }
    writing = true;
    updateControls();
    try {
        const username = await notificationOwner(expectedToken);
        if (!sameSession(expectedToken)) {
            return false;
        }
        await requestApi(path, "PUT", null, expectedToken);
        if (!sameSession(expectedToken)) {
            return false;
        }
        clearLocalUnread(username, notificationId);
        return sameSession(expectedToken);
    } catch (error) {
        handleError(error, expectedToken);
        if (error.uncertain && sameSession(expectedToken)) {
            await loadNotifications();
            showMessage(status, "标记结果尚未确认，已重新读取列表，请核对后再操作", true);
        }
        return false;
    } finally {
        writing = false;
        await loadUnreadCount();
        updateControls();
    }
}

// 只标记用户选择的这一条消息
async function markRead(notification) {
    const expectedToken = token;
    const success = await writeReadState("/notifications/" + encodeURIComponent(notification.id) + "/read", notification.id);
    if (success && sameSession(expectedToken)) {
        await loadNotifications();
        if (sameSession(expectedToken)) {
            showToast("已标记为已读");
        }
    }
}

// 全部已读对账号全部消息生效，按钮名称与接口范围一致
async function markAllRead() {
    const expectedToken = token;
    const success = await writeReadState("/notifications/read-all", null);
    if (success && sameSession(expectedToken)) {
        await loadNotifications();
        if (sameSession(expectedToken)) {
            showToast("全部消息已标记为已读");
        }
    }
}

// 跳转前检查内容是否仍可访问，评论通过 context 取得所属文章
async function openNotification(notification) {
    if (writing || loading || !notification.targetAvailable) {
        return;
    }
    const expectedToken = syncSession();
    if (!expectedToken || expectedToken !== listToken) {
        await loadNotifications();
        return;
    }
    writing = true;
    updateControls();
    let address = "";
    try {
        if (notification.type === "FOLLOW") {
            const username = notification.targetUsername;
            await requestApi("/users/" + encodeURIComponent(username), "GET", null, expectedToken);
            address = "/profile.html?u=" + encodeURIComponent(username);
        } else {
            let noteId = notification.noteId;
            let commentId = "";
            if (notification.type === "COMMENT" || notification.type === "REPLY") {
                const context = await requestApi("/comments/" + encodeURIComponent(notification.commentId) + "/context", "GET", null, expectedToken);
                noteId = context.comment.noteId;
                commentId = context.comment.id;
            }
            await requestApi("/notes/" + encodeURIComponent(noteId), "GET", null, expectedToken);
            const hash = new URLSearchParams();
            hash.set("article", noteId);
            if (commentId) {
                hash.set("comment", commentId);
            }
            address = "/index.html#" + hash.toString();
        }
        if (!sameSession(expectedToken)) {
            return;
        }
        if (!notification.readAt || notification.localUnread) {
            await requestApi("/notifications/" + encodeURIComponent(notification.id) + "/read", "PUT", null, expectedToken);
        }
        if (sameSession(expectedToken)) {
            const username = await notificationOwner(expectedToken);
            if (!sameSession(expectedToken)) {
                return;
            }
            clearLocalUnread(username, notification.id);
            dialog.close();
            window.location.href = address;
        }
    } catch (error) {
        if (error.status === 404 && sameSession(expectedToken)) {
            showMessage(status, "相关内容已删除或暂时无法访问，可以刷新消息列表", true);
        } else {
            handleError(error, expectedToken);
        }
    } finally {
        writing = false;
        await loadUnreadCount();
        updateControls();
    }
}

// 打开弹窗时重新读取，浏览列表本身保持未读状态
function openDialog() {
    const accountMenu = document.getElementById("account-menu");
    if (accountMenu) {
        accountMenu.open = false;
    }
    dialog.showModal();
    loadNotifications();
    loadUnreadCount();
}

// 关闭弹窗后焦点由浏览器返回铃铛
function closeDialog() {
    dialog.close();
}

// 筛选变化时从第一页读取
function resetPage() {
    page = 1;
    loadNotifications();
}

// 手动刷新列表并同步铃铛角标
function refreshNotifications() {
    loadNotifications();
    loadUnreadCount();
}

// 消息分页只更新弹窗内容，保持主页面位置
function previousPage() {
    page = page - 1;
    loadNotifications();
}

// 前往下一页消息
function nextPage() {
    page = page + 1;
    loadNotifications();
}

// 返回窗口或另一个标签页切换账号时，重新确认消息身份
function refreshSession() {
    syncSession();
    loadUnreadCount();
    if (dialog.open && !writing) {
        loadNotifications();
    }
}

if (bell) {
    // 同时调整显示和键盘顺序，让铃铛位于导航最右侧
    bell.parentElement.appendChild(bell);
    buildDialog();
    bell.replaceChildren(makeIcon("bell"), bell.querySelector(".notification-badge"));
    bell.addEventListener("click", openDialog);
    window.addEventListener("focus", refreshSession);
    window.addEventListener("storage", refreshSession);
    loadUnreadCount();
}
