const SESSION_KEY = "sdu-blog-session";

// 保存 session 中的凭证和有效期，不保存密码；格式不对或保存失败时抛出错误
export function saveSession(session) {
    if (!session || typeof session.token !== "string" || !session.token) {
        throw new Error("登录响应缺少凭证，请重试。");
    }
    // 日期转成毫秒数，检查有效期
    const expiresAt = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error("登录凭证的有效期异常，请重试。");
    }
    const savedSession = {
        token: session.token,
        expiresAt: session.expiresAt
    };
    try {
        // localStorage 只能保存文本，刷新后仍可读取
        localStorage.setItem(SESSION_KEY, JSON.stringify(savedSession));
    } catch {
        throw new Error("浏览器无法保存登录状态，请允许此网站使用本地存储后重试。");
    }
}

// 读取本地凭证，没有可用凭证时返回 null；是否有效仍需后端确认
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

    // 本地存储可能被改动，读取后也要检查格式和有效期
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

// 删除本地凭证，成功返回 true；后端会话需要另调退出接口注销
export function clearSession() {
    try {
        localStorage.removeItem(SESSION_KEY);
        return true;
    } catch {
        return false;
    }
}
