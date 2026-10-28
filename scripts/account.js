// 引入请求、登录状态和提示函数，两个账号页面共用
import { requestApi } from "./api.js";
import { saveSession } from "./auth.js";
import { showMessage, setBusy } from "./common.js";

const form = document.getElementById("account-form");
const fields = document.getElementById("account-fields");
const username = document.getElementById("username");
const password = document.getElementById("password");
const displayName = document.getElementById("display-name");
const confirmPassword = document.getElementById("confirm-password");
const submitButton = document.getElementById("submit-button");
const message = document.getElementById("message");
// data-mode 区分注册和登录，昵称与确认密码只在注册页使用
const isRegister = document.body.dataset.mode === "register";
let submitting = false;

// 检查昵称和确认密码，错误交给浏览器提示
function validateRegistration() {
    if (!isRegister) {
        return;
    }
    // 清除上次的错误，改对后才能继续提交
    displayName.setCustomValidity("");
    confirmPassword.setCustomValidity("");
    if (displayName.value.trim().length === 0) {
        displayName.setCustomValidity("昵称不能只包含空格。");
    }
    if (password.value !== confirmPassword.value) {
        confirmPassword.setCustomValidity("两次输入的密码不一致。");
    }
}

// 处理表单提交事件，校验输入、请求后端，成功后保存凭证并进入主页
async function submitAccount(event) {
    // 阻止表单默认跳转，由脚本提交请求
    event.preventDefault();
    if (submitting) {
        return;
    }
    validateRegistration();
    if (!form.reportValidity()) {
        return;
    }

    // 密码按原样提交，确认密码只用于前端校验
    const credentials = {
        username: username.value,
        password: password.value
    };
    let path = "/auth/login";
    let idleText = "登录";
    if (isRegister) {
        path = "/auth/register";
        idleText = "注册并登录";
        credentials.displayName = displayName.value.trim();
    }

    // 等待响应时禁用表单，避免重复提交
    submitting = true;
    fields.disabled = true;
    setBusy(submitButton, true);
    submitButton.textContent = "正在提交……";
    showMessage(message, "", false);

    try {
        // 登录和注册省略旧凭证，避免失效凭证干扰新的身份验证
        const session = await requestApi(path, "POST", credentials, null);
        saveSession(session);
        window.location.replace("/index.html");
    } catch (error) {
        // 失败时保留输入，方便修改后重试
        showMessage(message, error.message, true);
    } finally {
        submitting = false;
        fields.disabled = false;
        setBusy(submitButton, false);
        submitButton.textContent = idleText;
    }
}

// 提交时执行函数，输入变化时重新校验
form.addEventListener("submit", submitAccount);
if (isRegister) {
    password.addEventListener("input", validateRegistration);
    confirmPassword.addEventListener("input", validateRegistration);
    displayName.addEventListener("input", validateRegistration);
}
