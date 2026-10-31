import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy, confirmAction } from "./common.js";
import { MAX_COLLECTIONS, MAX_COLLECTION_NAME_LENGTH } from "./config.js";

// 建立收藏夹管理界面，onChanged 在分组变化后重新读取文章列表
export function createCollections(onChanged) {
    const panel = document.getElementById("collection-tools");
    const filter = document.getElementById("collection-filter");
    const dialog = document.getElementById("collection-dialog");
    const form = document.getElementById("collection-form");
    const nameInput = document.getElementById("collection-name");
    const nameStatus = document.getElementById("collection-name-status");
    const submit = document.getElementById("save-collection");
    const moveDialog = document.getElementById("move-collection-dialog");
    const moveForm = document.getElementById("move-collection-form");
    const destination = document.getElementById("collection-destination");
    const moveStatus = document.getElementById("move-collection-status");
    const moveSubmit = document.getElementById("move-collection-submit");
    const status = document.getElementById("collection-status");
    let token = null;
    let items = [];
    let loading = false;
    let writing = false;
    let refreshing = false;
    let requestNumber = 0;
    let editingId = null;
    let dialogToken = null;
    let moveToken = null;
    let moveNote = null;
    let needsCheck = false;
    nameInput.maxLength = MAX_COLLECTION_NAME_LENGTH;

    // 核对凭证，旧账号对话框不能在新账号下继续提交
    function checkSession(expectedToken) {
        const session = readSession();
        if (!session || session.token !== expectedToken || token !== expectedToken) {
            throw new Error("登录账号已变化，请重新打开收藏夹操作");
        }
    }

    // 账号变化后立即移除名称、选项和打开的对话框，旧请求也会被编号拦截
    function reset(nextToken) {
        if (token === nextToken) {
            return;
        }
        token = nextToken;
        requestNumber = requestNumber + 1;
        items = [];
        loading = false;
        refreshing = false;
        needsCheck = false;
        filter.replaceChildren();
        destination.replaceChildren();
        nameInput.value = "";
        moveNote = null;
        dialogToken = null;
        moveToken = null;
        dialog.close();
        moveDialog.close();
        showMessage(status, "", false);
        updateControls();
    }

    // 返回当前选中的自定义收藏夹，全部收藏和默认收藏夹不能改名或删除
    function selectedCollection() {
        for (const item of items) {
            if (item.id && item.id === filter.value) {
                return item;
            }
        }
        return null;
    }

    // 统一按钮等待和可用状态，结果未知时先刷新核对，防止重复创建同名收藏夹
    function updateControls() {
        const busy = loading || writing || refreshing;
        const selected = selectedCollection();
        filter.disabled = busy || !token;
        document.getElementById("new-collection").disabled = busy || !token || needsCheck || items.length > MAX_COLLECTIONS;
        document.getElementById("rename-collection").disabled = busy || !selected || needsCheck;
        document.getElementById("delete-collection").disabled = busy || !selected || needsCheck;
        document.getElementById("refresh-collections").disabled = busy || !token;
        submit.disabled = busy || needsCheck;
        nameInput.disabled = busy;
        destination.disabled = busy;
        moveSubmit.disabled = busy || needsCheck;
        setBusy(submit, writing);
        setBusy(moveSubmit, writing);
        setBusy(document.getElementById("refresh-collections"), loading || refreshing);
        for (const button of document.querySelectorAll("[data-move-favorite]")) {
            button.disabled = busy;
        }
    }

    // 创建选项，名称按纯文字显示，用户输入不能作为 HTML 执行
    function option(value, label) {
        const element = document.createElement("option");
        element.value = value;
        element.textContent = label;
        return element;
    }

    // 重建筛选器并沿用地址中的收藏夹，过期分组链接保留明确提示而不是冒充全部收藏
    function renderFilter() {
        const parameters = new URLSearchParams(window.location.search);
        const selected = parameters.get("collectionId") || "";
        filter.replaceChildren(option("", "全部收藏"));
        let found = selected === "";
        for (const item of items) {
            let value = "default";
            if (item.id) {
                value = item.id;
            }
            filter.appendChild(option(value, item.name + "（" + item.noteCount + "）"));
            if (value === selected) {
                found = true;
            }
        }
        if (!found) {
            filter.appendChild(option(selected, "收藏夹不存在或不可访问"));
        }
        filter.value = selected;
    }

    // 读取本人真实收藏夹，编号与账号双重检查阻止迟到响应回写旧名称
    async function load(expectedToken) {
        reset(expectedToken);
        if (!expectedToken) {
            return;
        }
        requestNumber = requestNumber + 1;
        const currentRequest = requestNumber;
        loading = true;
        updateControls();
        // 已有选项时用刷新图标表示等待，避免提示撑高工具栏后又消失
        if (items.length === 0) {
            showMessage(status, "正在读取收藏夹", false);
        } else {
            showMessage(status, "", false);
        }
        try {
            const result = await requestApi("/me/collections", "GET", null, expectedToken);
            checkSession(expectedToken);
            if (currentRequest !== requestNumber) {
                return;
            }
            items = result;
            needsCheck = false;
            renderFilter();
            showMessage(status, "", false);
        } catch (error) {
            if (currentRequest === requestNumber && token === expectedToken) {
                items = [];
                filter.replaceChildren();
                needsCheck = true;
                handleError(error, expectedToken, status);
            }
            throw error;
        } finally {
            if (currentRequest === requestNumber) {
                loading = false;
                updateControls();
            }
        }
    }

    // 错误保留在对应区域，401 只清理本次凭证，不影响刚切换的新账号
    function handleError(error, expectedToken, target) {
        const session = readSession();
        if (!session || session.token !== expectedToken) {
            reset(null);
            return;
        }
        if (error.status === 401) {
            clearSession();
            reset(null);
        }
        showMessage(target, error.message, true);
    }

    // 开启新建或改名对话框，保存打开时的凭证和目标 ID
    function openNameDialog(rename) {
        if (loading || writing || needsCheck || !token) {
            return;
        }
        const selected = selectedCollection();
        if (rename && !selected) {
            return;
        }
        dialogToken = token;
        editingId = null;
        nameInput.value = "";
        document.getElementById("collection-dialog-title").textContent = "新建收藏夹";
        if (rename) {
            editingId = selected.id;
            nameInput.value = selected.name;
            document.getElementById("collection-dialog-title").textContent = "重命名收藏夹";
        }
        showMessage(nameStatus, "", false);
        dialog.showModal();
        nameInput.focus();
    }

    // 新建和改名共用验证与提交，成功后回读名称和数量，不在本地猜测结果
    async function saveName(event) {
        event.preventDefault();
        if (writing || loading || needsCheck) {
            return;
        }
        const expectedToken = dialogToken;
        const name = nameInput.value.trim();
        if (!name || name.length > MAX_COLLECTION_NAME_LENGTH) {
            showMessage(nameStatus, "收藏夹名称应为 1～" + MAX_COLLECTION_NAME_LENGTH + " 个字符", true);
            return;
        }
        writing = true;
        updateControls();
        try {
            checkSession(expectedToken);
            let path = "/me/collections";
            let method = "POST";
            if (editingId) {
                path = path + "/" + encodeURIComponent(editingId);
                method = "PATCH";
            }
            await requestApi(path, method, { name: name }, expectedToken);
            checkSession(expectedToken);
            dialog.close();
            await load(expectedToken);
            onChanged();
            showToast("收藏夹已保存");
        } catch (error) {
            const session = readSession();
            if (!session || session.token !== expectedToken) {
                reset(null);
                return;
            }
            if (error.uncertain) {
                needsCheck = true;
                dialog.close();
                showMessage(status, "保存结果待核对，请刷新收藏夹后再操作", true);
            } else {
                handleError(error, expectedToken, nameStatus);
            }
        } finally {
            writing = false;
            updateControls();
        }
    }

    // 删除自定义收藏夹只移动其中收藏，不删除文章或取消收藏
    async function deleteSelected() {
        const selected = selectedCollection();
        if (!selected || loading || writing || needsCheck) {
            return;
        }
        const expectedToken = token;
        writing = true;
        updateControls();
        try {
            const confirmed = await confirmAction("删除收藏夹“" + selected.name + "”？其中文章会移回默认收藏夹，不会取消收藏");
            if (!confirmed) {
                return;
            }
            checkSession(expectedToken);
            await requestApi("/me/collections/" + encodeURIComponent(selected.id), "DELETE", null, expectedToken);
            checkSession(expectedToken);
            // 删除当前分组后移回默认分组并回到第一页，避免留下失效分组地址
            const parameters = new URLSearchParams(window.location.search);
            parameters.set("collectionId", "default");
            parameters.delete("page");
            window.history.replaceState(null, "", "/index.html?" + parameters.toString());
            await load(expectedToken);
            onChanged();
            showToast("收藏夹已删除，文章已移回默认收藏夹");
        } catch (error) {
            const session = readSession();
            if (!session || session.token !== expectedToken) {
                reset(null);
                return;
            }
            if (error.uncertain) {
                needsCheck = true;
                showMessage(status, "删除结果待核对，请刷新收藏夹确认", true);
            } else {
                handleError(error, expectedToken, status);
            }
        } finally {
            writing = false;
            updateControls();
        }
    }

    // 打开移动窗口前重新读取目标列表，避免提交已经删除或来自旧账号的收藏夹
    async function openMove(note) {
        if (loading || writing) {
            return;
        }
        const session = readSession();
        if (!session) {
            showToast("请登录并重新读取文章后整理收藏", true);
            return;
        }
        try {
            await load(session.token);
            checkSession(session.token);
            moveToken = session.token;
            moveNote = note;
            destination.replaceChildren();
            for (const item of items) {
                let value = "default";
                if (item.id) {
                    value = item.id;
                }
                destination.appendChild(option(value, item.name));
            }
            destination.value = "default";
            if (note.favoriteCollectionId) {
                destination.value = note.favoriteCollectionId;
                if (!destination.value) {
                    destination.value = "default";
                }
            }
            document.getElementById("move-collection-title").textContent = "移动收藏：《" + note.title + "》";
            showMessage(moveStatus, "", false);
            moveDialog.showModal();
        } catch (error) {
            handleError(error, session.token, status);
            showToast(error.message, true);
        }
    }

    // 路径使用文章 ID，默认收藏夹提交 null，成功后更新文章分组并通知列表回读
    async function moveFavorite(event) {
        event.preventDefault();
        if (!moveNote || writing || loading || needsCheck) {
            return;
        }
        const expectedToken = moveToken;
        const note = moveNote;
        writing = true;
        updateControls();
        try {
            checkSession(expectedToken);
            let collectionId = null;
            if (destination.value !== "default") {
                collectionId = destination.value;
                let found = false;
                for (const item of items) {
                    if (item.id === collectionId) {
                        found = true;
                    }
                }
                if (!found) {
                    throw new Error("目标收藏夹已变化，请重新打开操作");
                }
            }
            await requestApi("/me/favorites/" + encodeURIComponent(note.id) + "/collection", "PUT", { collectionId: collectionId }, expectedToken);
            checkSession(expectedToken);
            note.favoriteCollectionId = collectionId;
            moveDialog.close();
            await load(expectedToken);
            onChanged();
            showToast("收藏已移动");
        } catch (error) {
            const session = readSession();
            if (!session || session.token !== expectedToken) {
                reset(null);
                return;
            }
            if (error.uncertain) {
                needsCheck = true;
                moveDialog.close();
                showMessage(status, "移动结果待核对，请刷新收藏页后确认", true);
                onChanged();
            } else {
                handleError(error, expectedToken, moveStatus);
            }
        } finally {
            writing = false;
            updateControls();
        }
    }

    // 为已收藏文章创建整理入口，尚未收藏的文章不显示移动操作
    function makeMoveButton(note) {
        const session = readSession();
        let renderedToken = null;
        if (session) {
            renderedToken = session.token;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "collection-button";
        button.dataset.moveFavorite = note.id;
        button.textContent = "移动收藏夹";
        button.hidden = !note.favorited;
        button.disabled = loading || writing || refreshing;
        // 按钮只记录当前文章，实际目标在本人收藏夹列表读取完成后选择
        button.addEventListener("click", function chooseCollection() {
            const current = readSession();
            if (!current || current.token !== renderedToken) {
                showToast("登录账号已变化，请刷新文章后再整理收藏", true);
                return;
            }
            openMove(note);
        });
        return button;
    }

    // 切换收藏夹时保留站内路由与分页约定，只更新收藏页筛选
    function changeFilter() {
        const parameters = new URLSearchParams(window.location.search);
        parameters.set("feed", "favorites");
        parameters.delete("page");
        parameters.delete("collectionId");
        if (filter.value) {
            parameters.set("collectionId", filter.value);
        }
        window.history.pushState(null, "", "/index.html?" + parameters.toString());
        onChanged();
    }

    // 手动刷新可核对未知结果，失败时保留提示供重试
    async function refresh() {
        if (loading || writing || refreshing) {
            return;
        }
        const session = readSession();
        if (!session) {
            reset(null);
            onChanged();
            return;
        }
        refreshing = true;
        updateControls();
        try {
            // 首页统一读取收藏夹与文章，沿用保留旧卡片的刷新流程，避免重复读取
            await onChanged();
        } catch (error) {
            showToast(error.message, true);
        } finally {
            if (token === session.token) {
                refreshing = false;
                updateControls();
            }
        }
    }

    // 新建按钮进入空名称表单
    function createCollection() {
        openNameDialog(false);
    }

    // 改名按钮沿用选中的自定义收藏夹
    function renameCollection() {
        openNameDialog(true);
    }

    // 关闭名称表单时保留请求状态，不会自动重复提交
    function closeName() {
        dialog.close();
    }

    // 关闭移动表单不更改文章分组
    function closeMove() {
        moveDialog.close();
    }

    form.addEventListener("submit", saveName);
    moveForm.addEventListener("submit", moveFavorite);
    filter.addEventListener("change", changeFilter);
    document.getElementById("new-collection").addEventListener("click", createCollection);
    document.getElementById("rename-collection").addEventListener("click", renameCollection);
    document.getElementById("delete-collection").addEventListener("click", deleteSelected);
    document.getElementById("refresh-collections").addEventListener("click", refresh);
    document.getElementById("close-collection").addEventListener("click", closeName);
    document.getElementById("close-move-collection").addEventListener("click", closeMove);
    return { panel: panel, load: load, reset: reset, makeMoveButton: makeMoveButton };
}
