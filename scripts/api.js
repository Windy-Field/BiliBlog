import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "./config.js";

const pendingReads = new Map();

// 按指定路径和方法发送请求，body 为提交内容，token 为登录凭证，空值传 null
// 成功返回 data，失败抛出错误，由页面显示提示
// 只合并尚未结束的本人身份读取，不缓存结果，刷新时仍取得最新身份
export async function requestApi(path, method, body, token) {
    if (method !== "GET" || body !== null || path !== "/me") {
        if (path === "/me" && method !== "GET") {
            // 修改资料后再读必须取得新结果，不能接着等待修改前发出的身份查询
            const identityKey = JSON.stringify([path, token]);
            pendingReads.delete(identityKey);
        }
        return sendRequest(path, method, body, token);
    }
    // 首页导航、评论和通知可能同时确认身份，账号凭证也放进键中，避免串用身份
    const key = JSON.stringify([path, token]);
    const previous = pendingReads.get(key);
    if (previous) {
        return previous;
    }
    const pending = sendRequest(path, method, body, token);
    pendingReads.set(key, pending);
    try {
        return await pending;
    } finally {
        // 成功和失败都移除记录，失败后重试不会重复拿到旧错误
        if (pendingReads.get(key) === pending) {
            pendingReads.delete(key);
        }
    }
}

// 执行一次真实请求，统一处理超时、JSON 解析和后端错误，供 requestApi 调用
async function sendRequest(path, method, body, token) {
    const controller = new AbortController();
    // 请求超过 15 秒后取消，避免网络卡住时界面一直等待
    const timeout = window.setTimeout(function cancelRequest() {
        controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const options = {
        method: method,
        headers: {},
        signal: controller.signal
    };

    if (body instanceof FormData) {
        // 浏览器会为文件表单补上分隔信息，手动填写 Content-Type 容易导致后端解析失败
        options.body = body;
    } else if (body !== null) {
        // 请求内容转成 JSON 文本，并声明格式
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }

    if (token) {
        // 后端用这个请求头确认用户身份
        options.headers.Authorization = "Bearer " + token;
    }

    try {
        const response = await fetch(API_BASE_URL + path, options);
        let result;

        try {
            result = await response.json();
        } catch {
            const formatError = new Error("服务器返回了无法读取的内容，请稍后重试。");
            formatError.status = response.status;
            formatError.uncertain = true;
            throw formatError;
        }

        // 收到响应也可能是业务失败，需要检查 HTTP 状态
        if (!response.ok) {
            let message = "请求失败，请稍后重试。";
            if (result.error && typeof result.error.message === "string") {
                message = result.error.message;
            }
            const apiError = new Error(message);
            // 保留状态码，让页面区分 401 登录失效和其他错误
            apiError.status = response.status;
            // 服务器报错不代表操作一定没执行，例如文章可能已保存但返回结果失败
            // uncertain 提醒页面先查一次实际结果，避免用户重试时重复发布
            apiError.uncertain = response.status >= 500;
            throw apiError;
        }

        return result.data;
    } catch (error) {
        if (error.name === "AbortError") {
            const timeoutError = new Error("请求超时，请检查校园网络");
            timeoutError.uncertain = true;
            throw timeoutError;
        }
        if (error instanceof TypeError) {
            // 断网或跨域拦截也可能发生在请求发出之后，页面需要先核对保存结果
            const networkError = new Error("无法连接后端，请检查校园网，并将 dev.muyufly.com 设为直连");
            networkError.uncertain = true;
            throw networkError;
        }
        throw error;
    } finally {
        // 请求结束后清除定时器，避免完成后又执行取消回调
        window.clearTimeout(timeout);
    }
}
