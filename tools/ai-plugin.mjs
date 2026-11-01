import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const APPLICATION_ID = "08f487dd5e10446287bec082430afe7f";
const APPLICATION_BASE_URL = "https://dashscope.aliyuncs.com/api/v1/apps";
const MAX_MESSAGE_LENGTH = 2000;
const MAX_BODY_BYTES = 16000;
const UPSTREAM_TIMEOUT_MS = 60000;
const RATE_WINDOW_MS = 60000;
const RATE_LIMIT = 8;
const MAX_RATE_CLIENTS = 1000;
const ENABLE_WEB_SEARCH = true;
const MAX_SOURCES = 10;
const ASSISTANT_INSTRUCTIONS = "你是 Octorange，小B书的通用知识助手。请始终使用 Octorange 自称，不使用迁移前的角色名称，也不默认围绕封泥或齐鲁文化回答。根据用户问题提供知识解释、资料检索和学习帮助，默认用清晰的 Markdown 排版。需要时使用应用提供的联网搜索或已关联知识库，区分检索证据与推测，引用可核实来源。没有实际检索结果时不得声称已经检索或编造来源；不确定的信息请明确说明。";

// 从博客自己的服务端环境读取密钥，不读取原项目配置或向浏览器暴露密钥
function readSettings() {
    let local = {};
    const address = path.join(PROJECT_ROOT, ".env.local");
    if (fs.existsSync(address)) {
        local = parseEnv(fs.readFileSync(address, "utf8"));
    }
    const appId = process.env.DASHSCOPE_APP_ID || local.DASHSCOPE_APP_ID || APPLICATION_ID;
    if (appId !== APPLICATION_ID) {
        throw new Error("博客 AI 必须使用新应用 ID " + APPLICATION_ID);
    }
    return {
        apiKey: process.env.DASHSCOPE_API_KEY || local.DASHSCOPE_API_KEY || "",
        appId: appId
    };
}

// 按统一格式返回接口结果，不输出密钥或上游请求内容
function sendJson(response, status, result) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(result));
}

// 读取有限大小的 JSON 请求，损坏和超大请求在调用模型前结束
function readBody(request) {
    // 请求结束后才解析，过大内容只丢弃不继续占用内存
    return new Promise(function collectBody(resolve, reject) {
        let size = 0;
        const chunks = [];
        // 累计大小并只保留限制以内的数据块
        request.on("data", function receiveChunk(chunk) {
            size = size + chunk.length;
            if (size <= MAX_BODY_BYTES) {
                chunks.push(chunk);
            }
        });
        // 完整接收后执行一次格式检查
        request.on("end", function finishBody() {
            if (size > MAX_BODY_BYTES) {
                const error = new Error("请求内容过大");
                error.status = 413;
                reject(error);
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
                const error = new Error("请求格式不正确");
                error.status = 400;
                reject(error);
            }
        });
        request.on("error", reject);
        // 浏览器中断请求时释放等待中的处理流程
        request.on("aborted", function rejectAborted() {
            reject(new Error("请求已中断"));
        });
        // 慢速请求也应有结束时间，避免长时间占用连接
        request.setTimeout(UPSTREAM_TIMEOUT_MS, function rejectSlowBody() {
            reject(new Error("请求读取超时"));
        });
    });
}

// 同一来源限制调用频率，计数表也设上限，防止长期运行时持续增长
function allowRequest(clients, address) {
    const now = Date.now();
    for (const entry of clients) {
        if (now - entry[1].startedAt >= RATE_WINDOW_MS) {
            clients.delete(entry[0]);
        }
    }
    let client = clients.get(address);
    if (!client) {
        if (clients.size >= MAX_RATE_CLIENTS) {
            return false;
        }
        client = { startedAt: now, count: 0 };
        clients.set(address, client);
    }
    if (client.count >= RATE_LIMIT) {
        return false;
    }
    client.count = client.count + 1;
    return true;
}

// 沿用原宠物的百炼会话协议，新应用 ID 仅由本项目服务端配置决定
async function askApplication(settings, message, sessionId) {
    const input = { prompt: ASSISTANT_INSTRUCTIONS + "\n\n用户问题：" + message };
    if (sessionId) {
        input.session_id = sessionId;
    }
    const address = APPLICATION_BASE_URL + "/" + encodeURIComponent(settings.appId) + "/completion";
    const response = await fetch(address, {
        method: "POST",
        headers: { Authorization: "Bearer " + settings.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ input: input, parameters: { enable_web_search: ENABLE_WEB_SEARCH }, debug: {} }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
    const result = await response.json();
    if (!response.ok || !result.output || typeof result.output.text !== "string") {
        const error = new Error("Octorange 暂时无法回答，请稍后重试");
        if (response.status === 429) {
            error.message = "AI 服务较忙，请稍后重试";
        } else if (response.status === 401 || response.status === 403) {
            error.message = "AI 服务鉴权失败，请检查服务端密钥与应用权限";
        }
        throw error;
    }
    const sources = readSources(result.output.doc_references);
    return { reply: result.output.text, sessionId: result.output.session_id || "", sources: sources };
}

// 提取百炼实际返回的文档引用，不向前端传递整段文档或内部元数据
function readSources(references) {
    const sources = [];
    if (!Array.isArray(references)) {
        return sources;
    }
    const seen = new Set();
    for (const reference of references) {
        if (!reference || sources.length >= MAX_SOURCES) {
            continue;
        }
        const title = reference.title || reference.doc_name;
        if (typeof title !== "string" || !title.trim()) {
            continue;
        }
        let url = "";
        try {
            const address = new URL(reference.doc_url);
            if (address.protocol === "https:" || address.protocol === "http:") {
                url = address.href;
            }
        } catch {
            url = "";
        }
        const key = title + "|" + url;
        if (!seen.has(key)) {
            seen.add(key);
            sources.push({ title: title, url: url });
        }
    }
    return sources;
}

// 为开发与构建预览安装相同接口，前端静态部署时也可转发到相同路径
export function aiPlugin() {
    const clients = new Map();
    const settings = readSettings();

    // 只处理 AI 路径，其他博客请求继续交给 Vite 和校园后端
    async function handleAi(request, response, next) {
        const address = new URL(request.url, "http://localhost");
        if (!address.pathname.startsWith("/api/ai/")) {
            next();
            return;
        }
        let originMatches = true;
        const origin = request.headers.origin;
        try {
            if (origin) {
                const originAddress = new URL(origin);
                originMatches = originAddress.host === request.headers.host;
            }
        } catch {
            originMatches = false;
        }
        if (!originMatches) {
            sendJson(response, 403, { error: "请求来源不匹配" });
            return;
        }
        if (request.method === "GET" && address.pathname === "/api/ai/status") {
            sendJson(response, 200, { configured: Boolean(settings.apiKey), appId: settings.appId });
            return;
        }
        if (request.method !== "POST" || address.pathname !== "/api/ai/chat") {
            sendJson(response, 404, { error: "接口不存在" });
            return;
        }
        if (!settings.apiKey) {
            sendJson(response, 503, { error: "尚未配置 AI 服务端密钥" });
            return;
        }
        if (!allowRequest(clients, request.socket.remoteAddress || "local")) {
            sendJson(response, 429, { error: "请求过于频繁，请稍后重试" });
            return;
        }
        try {
            const body = await readBody(request);
            if (!body || Array.isArray(body) || typeof body.message !== "string" || !body.message.trim() || body.message.length > MAX_MESSAGE_LENGTH) {
                sendJson(response, 400, { error: "问题应为 1～" + MAX_MESSAGE_LENGTH + " 个字符" });
                return;
            }
            let sessionId = "";
            if (typeof body.sessionId === "string" && body.sessionId.length <= 200) {
                sessionId = body.sessionId;
            }
            const result = await askApplication(settings, body.message.trim(), sessionId);
            sendJson(response, 200, result);
        } catch (error) {
            let status = 502;
            if (error.status === 400 || error.status === 413) {
                status = error.status;
            }
            let message = error.message;
            if (error.name === "TimeoutError" || error.name === "AbortError") {
                message = "AI 回答超时，请稍后重试";
            } else if (error instanceof TypeError) {
                message = "AI 服务暂时无法连接";
            }
            sendJson(response, status, { error: message });
        }
    }

    // 两种运行方式复用同一中间件，避免开发与预览行为不同
    function install(server) {
        server.middlewares.use(handleAi);
    }

    return { name: "BiliBlog-ai", configureServer: install, configurePreviewServer: install };
}
