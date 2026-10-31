const TOAST_DURATION_MS = 3000;
const TOAST_CLOSE_MS = 240;
let toastElement = null;
let toastTimer = 0;
let toastCloseTimer = 0;
let confirmationDialog = null;

// 将文字显示在提示元素中，isError 决定是否使用错误样式
export function showMessage(element, text, isError) {
    // 按纯文字显示，避免把提示内容当成 HTML
    element.textContent = text;
    element.dataset.error = String(isError);
    element.dataset.tone = "info";
    if (isError) {
        element.dataset.tone = "error";
    }
    if (isError) {
        // 将焦点移到错误提示，方便键盘用户发现问题，提示元素需设置 tabindex="-1"
        element.focus();
    }
}

// 根据 busy 添加或移除按钮等待标记，禁用状态由调用方控制
// 同时更新 aria-busy，让辅助阅读工具也能识别等待状态
export function setBusy(element, busy) {
    element.setAttribute("aria-busy", String(busy));
    element.classList.toggle("is-busy", busy);
}

// 在页面底部短暂显示 text，isError 决定提示颜色
// popover 将提示放在浏览器顶层，文章对话框打开时也能看见
export function showToast(text, isError) {
    if (!toastElement) {
        toastElement = document.createElement("div");
        toastElement.className = "toast";
        toastElement.setAttribute("popover", "manual");
        toastElement.setAttribute("role", "status");
        toastElement.setAttribute("aria-live", "polite");
        document.body.appendChild(toastElement);
    }
    toastElement.textContent = text;
    toastElement.dataset.tone = "success";
    if (isError) {
        toastElement.dataset.tone = "error";
    }
    if (!toastElement.matches(":popover-open")) {
        toastElement.showPopover();
    }
    // 连续操作时重新播放动画并计时，留出阅读最新提示的时间
    toastElement.classList.remove("is-visible");
    void toastElement.offsetWidth;
    toastElement.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    // 新提示出现时取消旧提示的关闭计时，避免连续操作时提前隐藏
    window.clearTimeout(toastCloseTimer);
    // 阅读时间结束后先淡出，再移除浏览器顶层提示
    toastTimer = window.setTimeout(function hideToast() {
        toastElement.classList.remove("is-visible");
        // 等淡出完成再关闭浮层，避免提示突然消失
        toastCloseTimer = window.setTimeout(function closeToast() {
            if (toastElement.matches(":popover-open")) {
                toastElement.hidePopover();
            }
        }, TOAST_CLOSE_MS);
    }, TOAST_DURATION_MS);
}

// 显示 description 中的删除说明，用户确认时返回 true，取消时返回 false
// 原生 dialog 负责焦点限制、Escape 取消和顶层显示
// 复用浏览器的这些能力，可以让鼠标和键盘操作保持一致
export function confirmAction(description) {
    if (!confirmationDialog) {
        confirmationDialog = document.createElement("dialog");
        confirmationDialog.className = "confirmation-dialog";
        confirmationDialog.setAttribute("aria-labelledby", "confirmation-title");
        const title = document.createElement("h2");
        title.id = "confirmation-title";
        title.textContent = "确认删除";
        const text = document.createElement("p");
        text.id = "confirmation-description";
        confirmationDialog.setAttribute("aria-describedby", text.id);
        const form = document.createElement("form");
        form.method = "dialog";
        form.className = "confirmation-actions";
        const cancel = document.createElement("button");
        cancel.value = "cancel";
        cancel.textContent = "取消";
        cancel.autofocus = true;
        const confirm = document.createElement("button");
        confirm.value = "confirm";
        confirm.className = "confirm-danger";
        confirm.textContent = "删除";
        form.append(cancel, confirm);
        confirmationDialog.append(title, text, form);
        document.body.appendChild(confirmationDialog);
    }
    document.getElementById("confirmation-description").textContent = description;
    confirmationDialog.returnValue = "cancel";
    // 等待用户关闭确认窗口，返回本次选择
    return new Promise(function waitForConfirmation(resolve) {
        // 关闭后返回本次选择，监听器只执行一次
        confirmationDialog.addEventListener("close", function finishConfirmation() {
            resolve(confirmationDialog.returnValue === "confirm");
        }, { once: true });
        confirmationDialog.showModal();
    });
}
