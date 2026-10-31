import { requestApi } from "./api.js";

// 从文章中取出完整可编辑字段，更新接口是整体替换，不能漏掉图片或商品关联
export function noteFields(note) {
    const imageIds = [];
    for (const image of note.images) {
        imageIds.push(image.id);
    }
    return {
        title: note.title,
        contentMarkdown: note.contentMarkdown,
        imageIds: imageIds,
        tags: note.tags.slice(),
        status: note.status,
        productId: note.productId
    };
}

// 比较文章可编辑内容，不比较更新时间和版本号，供未知结果核对使用
function sameFields(first, second) {
    return JSON.stringify(first) === JSON.stringify(second);
}

// 为一个编辑页建立保存会话，readFields 读取当前输入，notify 将状态交给界面处理
// 每次只允许一个保存请求，成功后更新版本；冲突和结果未知时阻止继续写入
export function createEditorSession(readFields, notify, checkIdentity) {
    const state = {
        note: null,
        saved: null,
        pending: null,
        conflict: null,
        uncertain: null,
        blocked: false
    };

    // 装入服务器文章，保留其 ID 和版本，之后始终更新同一篇
    function load(note) {
        state.note = note;
        state.saved = noteFields(note);
        state.conflict = null;
        state.uncertain = null;
        state.blocked = false;
    }

    // 判断输入是否与上次确认保存的内容不同，新建空页面不算待自动保存的内容
    function dirty() {
        const fields = readFields();
        if (!state.saved) {
            return Boolean(fields.title || fields.contentMarkdown || fields.tags.length || fields.imageIds.length);
        }
        fields.status = state.saved.status;
        return !sameFields(fields, state.saved);
    }

    // 读取最新版供用户对比，只记录冲突快照，不替换本地输入或当前保存版本
    async function readConflict(token) {
        state.blocked = true;
        const latest = await requestApi("/notes/" + encodeURIComponent(state.note.id), "GET", null, token);
        checkIdentity(token);
        state.conflict = latest;
        notify("conflict");
    }

    // 发送一次保存，submitted 是发出请求时的快照，期间继续输入不会被响应覆盖
    async function write(status, token) {
        checkIdentity(token);
        const submitted = readFields();
        submitted.status = status;
        const payload = {
            title: submitted.title,
            contentMarkdown: submitted.contentMarkdown,
            imageIds: submitted.imageIds.slice(),
            tags: submitted.tags.slice(),
            status: submitted.status,
            productId: submitted.productId
        };
        let path = "/notes";
        let method = "POST";
        if (state.note) {
            path = path + "/" + encodeURIComponent(state.note.id);
            method = "PUT";
            payload.version = state.note.version;
        }
        notify("saving");
        try {
            const saved = await requestApi(path, method, payload, token);
            try {
                checkIdentity(token);
            } catch (error) {
                // 响应虽已成功，账号却改变了，先暂停，不能当作普通失败直接重建文章
                state.note = saved;
                error.uncertain = true;
                throw error;
            }
            state.note = saved;
            // 只标记本次提交的内容已保存，用户在等待时输入的新文字仍然算未保存
            state.saved = submitted;
            notify("saved");
            return saved;
        } catch (error) {
            if (error.code === "VERSION_CONFLICT") {
                state.blocked = true;
                notify("blocked");
                await readConflict(token);
            } else if (error.uncertain) {
                state.blocked = true;
                state.uncertain = { fields: submitted, version: payload.version };
                notify("uncertain");
            }
            throw error;
        }
    }

    // 手动保存先等待自动保存结束，再读取最新输入和新版本，保证写请求串行
    async function save(status, token) {
        while (state.pending) {
            await state.pending;
        }
        if (state.blocked) {
            throw new Error("请先处理版本冲突或核对保存结果");
        }
        const pending = write(status, token);
        state.pending = pending;
        try {
            return await pending;
        } finally {
            if (state.pending === pending) {
                state.pending = null;
            }
        }
    }

    // 已有文章遇到超时先读回结果，相同内容视为成功，版本不同则交给用户对比
    async function reconcile(token) {
        checkIdentity(token);
        if (!state.note || !state.uncertain) {
            throw new Error("请先到草稿箱或我的文章核对是否已创建");
        }
        const latest = await requestApi("/notes/" + encodeURIComponent(state.note.id), "GET", null, token);
        checkIdentity(token);
        const fields = noteFields(latest);
        if (sameFields(fields, state.uncertain.fields)) {
            state.note = latest;
            state.saved = state.uncertain.fields;
            state.uncertain = null;
            state.blocked = false;
            notify("saved");
        } else if (latest.version === state.uncertain.version) {
            state.uncertain = null;
            state.blocked = false;
            notify("retry");
        } else {
            state.conflict = latest;
            state.uncertain = null;
            notify("conflict");
        }
    }

    // 用户明确完成对比后才接纳新版本，保留本地时不立即提交，避免静默覆盖
    function resolveConflict(useServer) {
        if (!state.conflict) {
            return null;
        }
        const latest = state.conflict;
        load(latest);
        notify("resolved");
        if (useServer) {
            return latest;
        }
        return null;
    }

    return {
        state: state,
        load: load,
        dirty: dirty,
        save: save,
        readConflict: readConflict,
        reconcile: reconcile,
        resolveConflict: resolveConflict
    };
}
