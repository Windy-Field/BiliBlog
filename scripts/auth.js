import { SESSION_KEY } from "./config.js";

// 从 session 中保存 token 和过期时间，密码只用于提交登录请求
// 本页脚本可以读取 localStorage，凭证在有效期内也需要妥善保护
export function saveSession(session) {
    if (!session || typeof session.token !== "string" || !session.token) {
        throw new Error("登录响应缺少凭证，请重试。");
    }
    // 将日期转成毫秒数才能和当前时间比较，过期或无法解析的凭证都停止使用
    const expiresAt = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error("登录凭证的有效期异常，请重试。");
    }
    const savedSession = {
        token: session.token,
        expiresAt: session.expiresAt
    };
    try {
        // 将对象转成 JSON 文本保存，刷新页面后仍能读取登录凭证
        localStorage.setItem(SESSION_KEY, JSON.stringify(savedSession));
    } catch {
        throw new Error("浏览器无法保存登录状态，请允许此网站使用本地存储后重试。");
    }
}

// 读取并校验本地凭证，缺失或过期时返回 null，实际登录状态由后端确认
export function readSession() {
    let savedSession;
    try {
        const text = localStorage.getItem(SESSION_KEY);
        if (!text) {
            return null;
        }
        savedSession = JSON.parse(text);
    } catch {
        // 无法读取或解析时，按未登录处理
        clearSession();
        return null;
    }

    // 本地存储只能帮助页面记住登录，不能证明身份，用户也能自行修改其中的内容
    // 这里先检查格式和有效期，真正的身份及操作权限仍由后端接口判断
    if (!savedSession || typeof savedSession.token !== "string" || !savedSession.token) {
        clearSession();
        return null;
    }

    const expiresAt = Date.parse(savedSession.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        clearSession();
        return null;
    }
    return savedSession;
}

// 清理本地凭证，成功返回 true，后端会话由退出接口注销
// 两处都清理后，本机和服务器才会结束这次登录
export function clearSession() {
    try {
        localStorage.removeItem(SESSION_KEY);
        return true;
    } catch {
        return false;
    }
}
