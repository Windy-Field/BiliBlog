import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy, confirmAction } from "./common.js";
import { makeIcon } from "./icons.js";
import { COMMENT_PAGE_SIZE, MAX_COMMENT_LENGTH } from "./config.js";

const pageSize = COMMENT_PAGE_SIZE;
const section = document.getElementById("comments-section");
const drafts = new Map();
let current = null;

// 为 note 建立评论区，关闭时传 null，切换文章后忽略旧请求
// 列表重建时更新 renderVersion，回复请求只写入对应版本的列表
// 这样旧回复晚到时，也能保留新列表里的内容
export function setCommentArticle(note, targetCommentId) {
    current = null;
    section.replaceChildren();
    if (!note) {
        return;
    }
    const session = readSession();
    let token = null;
    if (session) {
        token = session.token;
    }
    const draftKey = note.id;
    // 草稿以文章编号区分，暂时关掉阅读框不会丢字，也不会把另一篇的输入带过来
    if (!drafts.has(draftKey)) {
        drafts.set(draftKey, { text: "", parentId: null, target: "", uncertain: false, pending: false });
    }
    const state = {
        note: note,
        token: token,
        username: "",
        draft: drafts.get(draftKey),
        busy: false,
        loading: false,
        page: 1,
        pageCount: 1,
        renderVersion: 0,
        available: true,
        identifying: true
    };
    state.targetCommentId = targetCommentId;
    current = state;
    buildSection(state);
    initializeComments(state);
}

// 创建常用文字元素，用户输入按纯文字显示
function textElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

// 创建带事件的普通按钮，调用方决定其可用状态
function actionButton(text, handler) {
    const button = textElement("button", "comment-button", text);
    button.type = "button";
    button.addEventListener("click", handler);
    return button;
}

// 创建评论输入区和列表，刷新列表不会清空正在输入的内容
// 输入单独保存在 draft 中，用户刷新评论或重新登录后可以接着写
function buildSection(state) {
    const heading = textElement("div", "comments-heading", "");
    state.heading = textElement("h3", "", "评论 " + state.note.commentCount);
    // 同一账号只更新评论列表，保留输入框、文章正文和当前评论页
    const refresh = actionButton("刷新评论", function refreshComments() {
        if (state.busy || state.draft.pending || state.loading || state.identifying) {
            return;
        }
        const session = readSession();
        let token = null;
        if (session) {
            token = session.token;
        }
        // 重新登录后需要核对评论身份，避免沿用旧账号的删除权限
        if (token !== state.token || (token && !state.username)) {
            setCommentArticle(state.note, state.targetCommentId);
            return;
        }
        loadComments(state, state.page);
    });
    state.refresh = refresh;
    heading.append(state.heading, refresh);
    state.form = document.createElement("form");
    state.form.className = "comment-form";
    state.target = textElement("div", "reply-target", "");
    state.targetText = textElement("span", "", "");
    // 取消回复目标，已经输入的文字继续保留
    const cancel = actionButton("取消回复", function cancelReply() {
        if (state.busy) {
            return;
        }
        state.draft.parentId = null;
        state.draft.target = "";
        updateComposer(state);
    });
    state.target.append(state.targetText, cancel);
    const label = textElement("label", "comment-label", "写评论");
    label.htmlFor = "comment-body";
    state.input = document.createElement("textarea");
    state.input.id = "comment-body";
    state.input.maxLength = MAX_COMMENT_LENGTH;
    state.input.required = true;
    state.input.rows = 3;
    state.input.value = state.draft.text;
    // 记录输入，切换或重建评论区后还能继续编辑
    state.input.addEventListener("input", function saveCommentInput() {
        state.draft.text = state.input.value;
        state.input.setCustomValidity("");
        updateComposer(state);
    });
    const tools = textElement("div", "comment-form-tools", "");
    state.counter = textElement("span", "comment-muted", "");
    state.submit = textElement("button", "comment-submit", "发表评论");
    state.submit.type = "submit";
    tools.append(state.counter, state.submit);
    state.feedback = textElement("p", "message comment-feedback", "");
    state.feedback.setAttribute("role", "status");
    state.feedback.tabIndex = -1;
    state.login = textElement("a", "comment-login", "去登录，回来后刷新评论");
    state.login.href = "/login.html";
    state.login.target = "_blank";
    state.login.rel = "noopener";
    // 用户核对未提交后，解除不确定状态的提交限制
    state.retryPost = actionButton("已核对未提交，允许重试", function allowCommentRetry() {
        state.draft.uncertain = false;
        updateComposer(state);
    });
    state.form.append(state.target, label, state.input, tools, state.feedback, state.login, state.retryPost);
    // 接管提交事件，交给评论发送流程处理
    state.form.addEventListener("submit", function submitCommentForm(event) {
        event.preventDefault();
        sendComment(state);
    });
    state.listStatus = textElement("p", "comment-muted", "");
    state.listStatus.setAttribute("role", "status");
    state.list = textElement("div", "comment-list", "");
    // 主评论翻页只更新列表，不清空输入区
    state.pager = makePager(function changeCommentPage(page) {
        loadComments(state, page);
    });
    section.append(heading, state.form, state.listStatus, state.list, state.pager.element);
    state.context = textElement("section", "notification-comment-context", "");
    state.context.hidden = true;
    state.context.setAttribute("aria-label", "消息对应的评论");
    state.context.tabIndex = -1;
    section.insertBefore(state.context, state.listStatus);
    updateComposer(state);
}

// 先向后端确认本人身份，再按作者显示删除入口，避免把操作按钮给错用户
async function initializeComments(state) {
    state.submit.disabled = true;
    if (state.token) {
        try {
            const user = await requestApi("/me", "GET", null, state.token);
            if (current !== state) {
                return;
            }
            state.username = user.username;
        } catch (error) {
            if (current !== state) {
                return;
            }
            handleCommentError(state, error);
        }
    }
    if (current === state) {
        state.identifying = false;
        updateComposer(state);
        loadComments(state, 1);
        if (state.targetCommentId) {
            loadCommentContext(state);
        }
    }
}

// 从通知直接读取目标评论和所属主评论，避免翻遍所有评论页
async function loadCommentContext(state) {
    state.context.hidden = false;
    state.context.textContent = "正在定位评论";
    try {
        const path = "/comments/" + encodeURIComponent(state.targetCommentId) + "/context";
        const context = await requestApi(path, "GET", null, state.token);
        if (current !== state) {
            return;
        }
        if (context.comment.noteId !== state.note.id) {
            throw new Error("这条评论属于其他文章，请返回消息列表重新打开");
        }
        state.context.replaceChildren(textElement("h3", "", "消息对应的评论"));
        if (context.rootComment.id !== context.comment.id) {
            state.context.appendChild(makeComment(state, context.rootComment, false));
        }
        const target = makeComment(state, context.comment, Boolean(context.comment.parentId));
        target.classList.add("notification-comment-target");
        state.context.appendChild(target);
        state.context.scrollIntoView({ block: "center", behavior: "instant" });
        state.context.focus({ preventScroll: true });
    } catch (error) {
        if (current !== state) {
            return;
        }
        state.context.replaceChildren();
        let message = error.message;
        if (error.status === 404) {
            message = "消息对应的评论已删除或暂时无法访问";
        }
        state.context.appendChild(textElement("p", "comment-muted", message));
        // 定位失败后重新读取同一个目标评论
        state.context.appendChild(actionButton("重新定位", function retryContext() {
            loadCommentContext(state);
        }));
    }
}

// 根据登录、回复目标和提交状态更新表单
function updateComposer(state) {
    state.target.hidden = !state.draft.parentId;
    state.targetText.textContent = "回复 " + state.draft.target;
    state.counter.textContent = state.draft.text.length + " / " + MAX_COMMENT_LENGTH;
    const pending = state.busy || state.draft.pending;
    state.input.disabled = pending;
    state.refresh.disabled = pending || state.loading || state.identifying;
    const submitUnavailable = pending || state.identifying || !state.username || state.draft.uncertain || !state.available;
    state.submit.disabled = submitUnavailable || state.loading;
    // 仅因刷新列表而暂停提交时保留按钮外观，避免禁用透明度来回变化
    state.submit.dataset.refreshing = String(state.loading && !submitUnavailable);
    state.submit.textContent = "发表评论";
    if (state.draft.parentId) {
        state.submit.textContent = "发送回复";
    }
    if (pending) {
        state.submit.textContent = "正在处理";
    }
    state.login.hidden = Boolean(state.username);
    state.retryPost.hidden = !state.draft.uncertain;
    state.retryPost.disabled = pending;
    setBusy(state.submit, pending);
    setBusy(state.refresh, state.loading || state.identifying);
    if (!state.token) {
        state.login.textContent = "去登录，回来后刷新评论";
    }
}

// 创建独立分页控件，主评论和每条主评论的回复分别翻页
// 两类列表使用不同接口，分别记录页码才能互不影响
function makePager(onChange) {
    const pager = { page: 1 };
    pager.element = textElement("nav", "comment-pagination", "");
    pager.element.setAttribute("aria-label", "评论分页");
    // 将上一页页码交给调用方处理
    pager.previous = actionButton("", function previousPage() {
        onChange(pager.page - 1);
    });
    pager.previous.appendChild(makeIcon("previous"));
    pager.previous.setAttribute("aria-label", "上一页评论");
    // 将下一页页码交给调用方处理
    pager.next = actionButton("", function nextPage() {
        onChange(pager.page + 1);
    });
    pager.next.appendChild(makeIcon("next"));
    pager.next.setAttribute("aria-label", "下一页评论");
    pager.label = textElement("span", "comment-muted", "");
    pager.element.append(pager.previous, pager.label, pager.next);
    pager.element.hidden = true;
    return pager;
}

// 更新分页状态，读取期间禁用翻页以免请求交叉
function updatePager(pager, page, count, loading) {
    pager.page = page;
    pager.label.textContent = page + " / " + count;
    pager.element.hidden = count <= 1;
    pager.previous.disabled = loading || page <= 1;
    pager.next.disabled = loading || page >= count;
}

// 读取主评论页，主评论删空当前页时回到最后一页
async function loadComments(state, page) {
    if (current !== state || state.loading) {
        return;
    }
    state.loading = true;
    updateComposer(state);
    // 已有评论时保留原列表，用刷新按钮表示等待，避免加载文字把阅读位置顶动
    if (!state.list.hasChildNodes()) {
        state.listStatus.textContent = "正在读取评论";
    }
    updatePager(state.pager, state.page, state.pageCount, true);
    try {
        const path = "/notes/" + encodeURIComponent(state.note.id) + "/comments?page=" + page + "&pageSize=" + pageSize;
        const result = await requestApi(path, "GET", null, state.token);
        if (current !== state) {
            return;
        }
        const count = Math.max(1, Math.ceil(result.total / pageSize));
        if (page > count) {
            state.loading = false;
            return await loadComments(state, count);
        }
        state.page = page;
        state.pageCount = count;
        state.renderVersion = state.renderVersion + 1;
        state.list.replaceChildren();
        for (const comment of result.items) {
            state.list.appendChild(makeComment(state, comment, false));
        }
        state.available = true;
        state.listStatus.textContent = "";
        if (result.items.length === 0) {
            state.listStatus.textContent = "还没有评论";
        }
    } catch (error) {
        if (current !== state) {
            return;
        }
        if (error.status === 404) {
            state.available = false;
        }
        state.listStatus.textContent = "评论读取失败，可点击上方刷新重试";
        handleCommentError(state, error);
    } finally {
        state.loading = false;
        if (current === state) {
            updatePager(state.pager, state.page, state.pageCount, false);
            updateComposer(state);
        }
    }
}

// 创建评论或回复，已删除主评论保留占位和回复入口
function makeComment(state, comment, isReply) {
    const row = textElement("article", "comment-item", "");
    row.dataset.commentId = comment.id;
    const avatar = textElement("span", "comment-avatar", comment.author.displayName.slice(0, 1));
    avatar.setAttribute("aria-hidden", "true");
    if (comment.author.avatarUrl) {
        const image = document.createElement("img");
        image.src = comment.author.avatarUrl;
        image.alt = "";
        image.loading = "lazy";
        // 头像加载失败时回到昵称首字
        image.addEventListener("error", function restoreCommentAvatar() {
            avatar.textContent = comment.author.displayName.slice(0, 1);
        }, { once: true });
        avatar.replaceChildren(image);
    }
    const header = textElement("div", "comment-meta", "");
    header.appendChild(textElement("strong", "comment-author", comment.author.displayName));
    const time = document.createElement("time");
    time.dateTime = comment.createdAt;
    time.textContent = new Date(comment.createdAt).toLocaleString("zh-CN");
    header.appendChild(time);
    let body = comment.body;
    if (comment.deleted) {
        body = "该评论已删除";
    }
    const content = textElement("p", "comment-body", body);
    if (comment.deleted) {
        content.classList.add("comment-muted");
    }
    const actions = textElement("div", "comment-actions", "");
    if (!isReply && !comment.deleted) {
        // 选择主评论作为回复目标，并把焦点放到输入框
        actions.appendChild(actionButton("回复", function selectReply() {
            if (state.busy || state.draft.pending) {
                return;
            }
            state.draft.parentId = comment.id;
            state.draft.target = comment.author.displayName;
            updateComposer(state);
            state.input.focus();
        }));
    }
    if (!comment.deleted && state.username === comment.author.username) {
        // 本人点击删除时，进入确认和删除流程
        const remove = actionButton("删除", function requestCommentDelete() {
            deleteComment(state, comment);
        });
        remove.classList.add("comment-delete");
        actions.appendChild(remove);
    }
    row.append(avatar, header, content, actions);
    if (!isReply && comment.replyCount > 0) {
        addReplyList(state, row, actions, comment);
    }
    return row;
}

// 回复列表按需展开，每个回复列表保留自己的页码和读取状态
function addReplyList(state, row, actions, comment) {
    const replyState = {
        page: 1, count: 1, loading: false, version: state.renderVersion,
        root: textElement("div", "comment-replies", ""),
        status: textElement("p", "comment-muted", ""),
        list: textElement("div", "", "")
    };
    replyState.root.hidden = true;
    replyState.status.setAttribute("role", "status");
    // 每个回复列表独立翻页，保留其他主评论的状态
    replyState.pager = makePager(function changeReplyPage(page) {
        loadReplies(state, comment.id, replyState, page);
    });
    // 请求失败时重读当前回复页
    replyState.retry = actionButton("重试回复", function retryReplies() {
        loadReplies(state, comment.id, replyState, replyState.page);
    });
    replyState.retry.hidden = true;
    const content = textElement("div", "comment-replies-content", "");
    content.append(replyState.status, replyState.retry, replyState.list, replyState.pager.element);
    replyState.root.appendChild(content);
    // 同步展开状态和可访问性，第一次展开时读取回复
    const toggle = actionButton("查看回复 " + comment.replyCount, function toggleReplies() {
        const expanded = toggle.getAttribute("aria-expanded") !== "true";
        replyState.root.hidden = !expanded;
        replyState.root.inert = !expanded;
        toggle.setAttribute("aria-expanded", String(expanded));
        if (!replyState.root.hidden && !replyState.list.hasChildNodes()) {
            loadReplies(state, comment.id, replyState, 1);
        }
    });
    toggle.dataset.replyRoot = comment.id;
    toggle.appendChild(makeIcon("down"));
    toggle.setAttribute("aria-expanded", "false");
    replyState.root.inert = true;
    actions.appendChild(toggle);
    row.appendChild(replyState.root);
}

// 获取某条主评论的回复，重建列表后忽略旧回复请求
async function loadReplies(state, parentId, replies, page) {
    if (replies.loading) {
        return;
    }
    replies.loading = true;
    replies.retry.hidden = true;
    replies.status.textContent = "正在读取回复";
    updatePager(replies.pager, replies.page, replies.count, true);
    try {
        const path = "/comments/" + encodeURIComponent(parentId) + "/replies?page=" + page + "&pageSize=" + pageSize;
        const result = await requestApi(path, "GET", null, state.token);
        if (current !== state || state.renderVersion !== replies.version) {
            return;
        }
        replies.count = Math.max(1, Math.ceil(result.total / pageSize));
        if (page > replies.count) {
            replies.loading = false;
            return await loadReplies(state, parentId, replies, replies.count);
        }
        replies.page = page;
        replies.list.replaceChildren();
        for (const reply of result.items) {
            replies.list.appendChild(makeComment(state, reply, true));
        }
        replies.status.textContent = "";
        if (result.items.length === 0) {
            replies.status.textContent = "还没有回复";
        }
    } catch (error) {
        if (current === state && state.renderVersion === replies.version) {
            replies.status.textContent = "回复读取失败";
            replies.retry.hidden = false;
            handleCommentError(state, error);
        }
    } finally {
        replies.loading = false;
        updatePager(replies.pager, replies.page, replies.count, false);
    }
}

// 写操作前核对当前凭证，切换账号时先刷新评论身份
// 页面可能在另一个标签页重新登录，这里要避免沿用上一账号的作者判断
function checkWriteSession(state) {
    const session = readSession();
    if (!session || session.token !== state.token || !state.username) {
        showMessage(state.feedback, "请先登录并刷新评论，输入会保留在当前页面", true);
        state.login.hidden = false;
        return false;
    }
    return true;
}

// 发送当前评论或回复，后端确认成功后清空输入，失败时保留原文
// 响应丢失时评论可能已经保存，先核对列表再重试可以避免重复发送
async function sendComment(state) {
    if (state.busy || state.draft.pending || state.loading || !state.available || state.draft.uncertain || !checkWriteSession(state)) {
        return;
    }
    const text = state.input.value.trim();
    if (!text) {
        state.input.setCustomValidity("评论不能只包含空格");
        state.input.reportValidity();
        return;
    }
    if (text.length > MAX_COMMENT_LENGTH) {
        state.input.setCustomValidity("评论最多 1000 个字符");
        state.input.reportValidity();
        return;
    }
    const body = { body: text };
    if (state.draft.parentId) {
        body.parentId = state.draft.parentId;
    }
    state.busy = true;
    state.draft.pending = true;
    // draft 的等待状态比当前界面活得更久，关掉再打开也不能重复发送同一条评论
    const parentId = state.draft.parentId;
    updateComposer(state);
    try {
        await requestApi("/notes/" + encodeURIComponent(state.note.id) + "/comments", "POST", body, state.token);
        // 只有服务器明确确认成功后才清空草稿，断网或报错时保留原文供用户核对
        state.draft.text = "";
        state.draft.parentId = null;
        state.draft.target = "";
        if (current !== state) {
            return;
        }
        state.input.value = "";
        showToast("已发送");
        let page = 1;
        if (parentId) {
            page = state.page;
        }
        await loadComments(state, page);
        if (current !== state) {
            return;
        }
        // 回复成功后展开对应主评论，方便核对发送结果
        if (parentId) {
            const toggles = state.list.querySelectorAll("[data-reply-root]");
            for (const toggle of toggles) {
                if (toggle.dataset.replyRoot === parentId) {
                    toggle.click();
                }
            }
        }
        await refreshCommentCount(state);
    } catch (error) {
        if (error.uncertain) {
            state.draft.uncertain = true;
        }
        if (current !== state) {
            return;
        }
        handleCommentError(state, error);
        if (error.uncertain) {
            showMessage(state.feedback, "发送结果尚未确认，请刷新评论并展开对应回复核对，再决定是否重试", true);
            await loadComments(state, state.page);
        }
    } finally {
        state.busy = false;
        state.draft.pending = false;
        if (current === state) {
            updateComposer(state);
        } else if (current && current.draft === state.draft) {
            current.input.value = current.draft.text;
            updateComposer(current);
        }
    }
}

// 删除本人评论，后端保留主评论与回复结构，前端重新读取结果
// 重新读取能保留其他人的回复，也能更新当前页和总数
async function deleteComment(state, comment) {
    if (state.busy || state.draft.pending || state.loading || !checkWriteSession(state)) {
        return;
    }
    state.busy = true;
    updateComposer(state);
    const confirmed = await confirmAction("删除这条评论后无法恢复，主评论下已有的回复会保留");
    if (!confirmed || current !== state) {
        state.busy = false;
        if (current === state) {
            updateComposer(state);
        }
        return;
    }
    try {
        await requestApi("/comments/" + encodeURIComponent(comment.id), "DELETE", null, state.token);
        if (current !== state) {
            return;
        }
        showToast("评论已删除");
        await loadComments(state, state.page);
        await refreshCommentCount(state);
    } catch (error) {
        if (current === state) {
            handleCommentError(state, error);
            if (error.uncertain || error.status === 404) {
                showMessage(state.feedback, "请刷新评论并核对删除结果", true);
                await loadComments(state, state.page);
                await refreshCommentCount(state);
            }
        }
    } finally {
        state.busy = false;
        if (current === state) {
            updateComposer(state);
        }
    }
}

// 从文章详情获取评论总数，主评论和回复分别分页，本页条数无法代表文章总数
async function refreshCommentCount(state) {
    try {
        const note = await requestApi("/notes/" + encodeURIComponent(state.note.id), "GET", null, state.token);
        if (current !== state) {
            return;
        }
        state.note.commentCount = note.commentCount;
        state.heading.textContent = "评论 " + note.commentCount;
        document.dispatchEvent(new CustomEvent("article-comment-count", { detail: state.note }));
    } catch {
        if (current === state) {
            showMessage(state.feedback, "操作已完成，评论数量暂时读取失败，可刷新文章确认", true);
        }
    }
}

// 失效会话转为游客，评论输入继续保留
function handleCommentError(state, error) {
    if (error.status === 401) {
        clearSession();
        state.token = null;
        state.username = "";
    }
    showMessage(state.feedback, error.message, true);
    updateComposer(state);
}
