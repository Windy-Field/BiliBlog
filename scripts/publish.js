import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy } from "./common.js";
import { makeIcon, fillIcons } from "./icons.js";
import { MEDIA_PAGE_SIZE, MAX_TAGS, MAX_TAG_LENGTH, MAX_IMAGES, MAX_BODY_LENGTH } from "./config.js";
import { validateImage } from "./media.js";
import { createEditorSession, noteFields } from "./editor-session.js";
import { renderMarkdown } from "./markdown-preview.js";

const PUBLISH_REDIRECT_MS = 700;
const AUTOSAVE_DELAY_MS = 2000;
const PREVIEW_DELAY_MS = 150;
const form = document.getElementById("publish-form");
const editorFields = document.getElementById("editor-fields");
const titleInput = document.getElementById("article-title");
const bodyInput = document.getElementById("article-body");
const tagsTextField = document.getElementById("tags-text");
const tagsChips = document.getElementById("tags-chips");
const tagsField = document.getElementById("tags-field");
const fileInput = document.getElementById("article-images");
const imagePreviews = document.getElementById("image-previews");
const uploadButton = document.getElementById("upload-selected");
const publishButton = document.getElementById("publish-button");
const publishMessage = document.getElementById("publish-message");
const uploadMessage = document.getElementById("upload-status");
const loginActions = document.getElementById("login-actions");
const uncertainPanel = document.getElementById("publish-uncertain");
const mediaDialog = document.getElementById("media-dialog");
const mediaList = document.getElementById("media-list");
const mediaStatus = document.getElementById("media-status");
const pageSize = MEDIA_PAGE_SIZE;
const selectedImages = [];
let sessionToken = null;
let uploading = false;
let readingLibrary = false;
let libraryPage = 1;
let libraryPageCount = 1;

// 胶囊标签管理
const chipTags = [];
const saveDraftButton = document.getElementById("save-draft");
const saveState = document.getElementById("save-state");
const autosaveEnabled = document.getElementById("autosave-enabled");
const conflictPanel = document.getElementById("conflict-panel");
const editor = createEditorSession(readEditorFields, showSaveState, checkEditorIdentity);
let username = "";
let initialized = false;
let leaving = false;
let manualSave = false;
let autosaveTimer = 0;
let previewTimer = 0;
let dirtyDuringLogin = false;
let productId = null;

// 把当前表单转成可提交快照，图片必须先取得服务器 ID，商品关联继续保留
function readEditorFields() {
    const imageIds = [];
    for (const image of selectedImages) {
        if (image.id) {
            imageIds.push(image.id);
        }
    }
    let status = "DRAFT";
    if (editor.state.note) {
        status = editor.state.note.status;
    }
    return {
        title: titleInput.value.trim(),
        contentMarkdown: bodyInput.value,
        imageIds: imageIds,
        tags: chipTags.slice(),
        status: status,
        productId: productId
    };
}

// 保存和异步回调前再次检查凭证，禁止沿用其他标签页已经退出的账号
function checkEditorIdentity(expectedToken) {
    const session = readSession();
    if (!session || !expectedToken || session.token !== expectedToken) {
        const error = new Error("登录账号已变化，请重新确认登录，输入会保留");
        error.code = "IDENTITY_CHANGED";
        throw error;
    }
}

// 采用服务器文章时一次填入正文、话题和图片，装入过程不触发自动保存
function populateEditor(note) {
    const wasInitialized = initialized;
    initialized = false;
    titleInput.value = note.title;
    bodyInput.value = note.contentMarkdown;
    productId = note.productId;
    chipTags.length = 0;
    tagsChips.replaceChildren();
    tagsTextField.value = "";
    for (const tag of note.tags) {
        addChip(tag);
    }
    for (const image of selectedImages) {
        if (image.previewUrl) {
            URL.revokeObjectURL(image.previewUrl);
        }
    }
    selectedImages.length = 0;
    for (const image of note.images) {
        selectedImages.push({ id: image.id, url: image.url, file: null });
    }
    initialized = wasInitialized;
    updateBodyCount();
    renderSelectedImages();
    updateMediaSelection();
    updatePreview();
}

// 按草稿、已发布和保存状态更新按钮，正文仍允许在自动保存期间继续编辑
function updateEditorControls() {
    let published = false;
    if (editor.state.note) {
        published = editor.state.note.status === "PUBLISHED";
    }
    let heading = "发布文章";
    let action = "发布文章";
    let stateText = "新文章";
    if (editor.state.note) {
        heading = "编辑草稿";
        stateText = "草稿 · 版本 " + editor.state.note.version;
    }
    if (published) {
        heading = "编辑文章";
        action = "保存修改";
        stateText = "已发布 · 版本 " + editor.state.note.version;
    }
    document.getElementById("editor-title").textContent = heading;
    document.title = heading + " - 小B书";
    document.getElementById("article-state").textContent = stateText;
    publishButton.replaceChildren(makeIcon("send"), document.createTextNode(action));
    saveDraftButton.hidden = published;
    autosaveEnabled.disabled = published || manualSave || !sessionToken;
    const paused = !sessionToken || !initialized || manualSave || uploading || editor.state.blocked || leaving;
    publishButton.disabled = paused;
    saveDraftButton.disabled = paused;
    setBusy(publishButton, manualSave);
    setBusy(saveDraftButton, Boolean(editor.state.pending) && !manualSave);
}

// 保存会话只报告状态，界面在此决定提示、冲突区和文章地址如何展示
function showSaveState(kind) {
    if (kind === "saving") {
        saveState.textContent = "正在保存";
    } else if (kind === "saved") {
        showMessage(publishMessage, "", false);
        saveState.textContent = "已保存 " + new Date().toLocaleTimeString("zh-CN");
        uncertainPanel.hidden = true;
        if (editor.state.note) {
            const address = "/publish.html?id=" + encodeURIComponent(editor.state.note.id);
            window.history.replaceState(null, "", address);
        }
    } else if (kind === "conflict" || kind === "blocked") {
        saveState.textContent = "版本冲突，自动保存已暂停";
        autosaveEnabled.checked = false;
        conflictPanel.hidden = false;
        renderConflict();
    } else if (kind === "uncertain") {
        saveState.textContent = "保存结果待核对";
        uncertainPanel.hidden = false;
        document.getElementById("retry-publish").hidden = Boolean(editor.state.note);
        document.getElementById("check-save-result").hidden = !editor.state.note;
    } else if (kind === "retry") {
        uncertainPanel.hidden = true;
        saveState.textContent = "服务器未更新，请手动重试";
        autosaveEnabled.checked = false;
    } else if (kind === "resolved") {
        showMessage(publishMessage, "", false);
        conflictPanel.hidden = true;
        document.getElementById("merge-reviewed").checked = false;
        saveState.textContent = "已完成对比，请确认后手动保存";
    }
    updateEditorControls();
}

// 输入变化时更新保存提示，防抖计时会在每次输入后重新开始
function editorChanged() {
    if (!initialized) {
        return;
    }
    window.clearTimeout(autosaveTimer);
    if (!sessionToken) {
        dirtyDuringLogin = true;
        return;
    }
    if (editor.state.conflict) {
        renderConflict();
    }
    if (editor.state.blocked) {
        return;
    }
    if (editor.dirty() || hasPendingImages() || tagsTextField.value.trim()) {
        saveState.textContent = "有未保存的修改";
    }
    const published = editor.state.note && editor.state.note.status === "PUBLISHED";
    if (autosaveEnabled.checked && !published && !editor.state.blocked && !manualSave && !uploading) {
        autosaveTimer = window.setTimeout(autoSaveDraft, AUTOSAVE_DELAY_MS);
    }
}

// 只自动保存草稿，不自动发布；上次请求没结束时等待下一轮，避免版本交叉
async function autoSaveDraft() {
    if (manualSave || uploading || editor.state.blocked || !autosaveEnabled.checked || !sessionToken) {
        return;
    }
    if (editor.state.pending) {
        autosaveTimer = window.setTimeout(autoSaveDraft, AUTOSAVE_DELAY_MS);
        return;
    }
    if (editor.state.note && editor.state.note.status === "PUBLISHED") {
        return;
    }
    // 输入框中的话题还没确认或图片未上传时，保留输入，等待用户完成后再保存
    if (hasPendingImages() || tagsTextField.value.trim()) {
        saveState.textContent = "待确认话题或上传图片";
        return;
    }
    if (!editor.dirty()) {
        return;
    }
    try {
        await editor.save("DRAFT", sessionToken);
    } catch (error) {
        handleSaveError(error);
    } finally {
        updateEditorControls();
        if (!editor.state.blocked && editor.dirty()) {
            saveState.textContent = "有未保存的修改";
        }
    }
}

// 手动保存期间禁用表单，空草稿可保存，公开发布才要求标题和正文
async function saveManually(status) {
    if (manualSave || uploading || !sessionToken || editor.state.blocked) {
        return;
    }
    confirmTagInput();
    if (tagsTextField.value.trim()) {
        tagsTextField.focus();
        return;
    }
    if (hasPendingImages()) {
        showToast("请先上传选中的图片", true);
        uploadButton.focus();
        return;
    }
    if (status === "PUBLISHED" && (!titleInput.value.trim() || !bodyInput.value.trim())) {
        showMessage(publishMessage, "发布时标题和正文不能为空", true);
        return;
    }
    if (titleInput.value.length > titleInput.maxLength || bodyInput.value.length > MAX_BODY_LENGTH) {
        showMessage(publishMessage, "标题或正文超过长度限制", true);
        return;
    }
    window.clearTimeout(autosaveTimer);
    manualSave = true;
    editorFields.disabled = true;
    updateEditorControls();
    showMessage(publishMessage, "", false);
    try {
        const note = await editor.save(status, sessionToken);
        if (status === "PUBLISHED") {
            leaving = true;
            showToast("文章已保存，正在打开");
            // 等反馈显示后打开服务器确认保存的文章
            window.setTimeout(function openSavedArticle() {
                window.location.replace("/index.html?feed=mine#article=" + encodeURIComponent(note.id));
            }, PUBLISH_REDIRECT_MS);
        } else {
            showToast("草稿已保存");
        }
    } catch (error) {
        handleSaveError(error);
    } finally {
        manualSave = false;
        editorFields.disabled = !sessionToken || leaving;
        updateEditorControls();
    }
}

// 将错误留在编辑页，凭证失效或未知结果不会清空用户输入
function handleSaveError(error) {
    if (error.status === 401) {
        const session = readSession();
        if (session && session.token === sessionToken) {
            clearSession();
        }
        showLoginRequired("登录已失效，请重新登录，输入仍保留");
    } else if (error.code === "IDENTITY_CHANGED") {
        showLoginRequired(error.message);
    } else {
        showMessage(publishMessage, error.message, true);
    }
    if (editor.state.blocked) {
        window.clearTimeout(autosaveTimer);
    } else {
        saveState.textContent = "保存失败，请重试";
    }
}

// 将完整可编辑快照转换为对比文字，不把标题或正文插入 HTML
function comparisonText(fields) {
    return "标题：" + fields.title + "\n状态：" + fields.status + "\n话题：" + fields.tags.join("、")
        + "\n图片 ID：" + fields.imageIds.join("、") + "\n商品关联：" + fields.productId
        + "\n\n正文：\n" + fields.contentMarkdown;
}

// 展示当前本地内容与已读取的服务器快照，不替换用户的输入
function renderConflict() {
    document.getElementById("conflict-local").textContent = comparisonText(readEditorFields());
    let serverText = "正在读取最新内容，读取失败时可重试";
    if (editor.state.conflict) {
        serverText = comparisonText(noteFields(editor.state.conflict));
    }
    document.getElementById("conflict-server").textContent = serverText;
    document.getElementById("conflict-message").textContent = "其他页面已经保存了新版本，请对比并处理后再保存，自动保存已暂停";
    document.getElementById("use-server").disabled = !editor.state.conflict;
    document.getElementById("keep-local").disabled = !editor.state.conflict;
    document.getElementById("merge-reviewed").checked = false;
}

// 明确采用服务器内容，包含正文、话题和图片，不保留过期的本地编辑
function useServerContent() {
    if (!document.getElementById("merge-reviewed").checked) {
        showToast("请先对比并勾选确认", true);
        return;
    }
    const note = editor.resolveConflict(true);
    if (note) {
        populateEditor(note);
        saveState.textContent = "已采用服务器内容";
        updateEditorControls();
    }
}

// 用户确认对比后保留表单，仅接纳新版本号，下一次必须手动保存
function keepLocalContent() {
    if (!document.getElementById("merge-reviewed").checked) {
        showToast("请先对比并勾选确认", true);
        return;
    }
    editor.resolveConflict(false);
    updateEditorControls();
}

// 冲突读取失败时可再次获取最新版本，成功后仍需用户决定如何处理
async function reloadConflict() {
    const button = document.getElementById("reload-conflict");
    button.disabled = true;
    try {
        checkEditorIdentity(sessionToken);
        await editor.readConflict(sessionToken);
    } catch (error) {
        handleSaveError(error);
    } finally {
        button.disabled = false;
    }
}

// 回读结果未知的已有文章，确定已保存、未保存或版本冲突
async function checkSaveResult() {
    const button = document.getElementById("check-save-result");
    button.disabled = true;
    try {
        await editor.reconcile(sessionToken);
    } catch (error) {
        handleSaveError(error);
    } finally {
        button.disabled = false;
        updateEditorControls();
    }
}

// 使用解析器和清理器渲染正文，尚未输入时保持空预览
function updatePreview() {
    renderMarkdown(document.getElementById("markdown-preview"), bodyInput.value);
}

// 正文输入后短暂合并预览更新，避免每个按键都重复解析长文章
function bodyChanged() {
    updateBodyCount();
    editorChanged();
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(updatePreview, PREVIEW_DELAY_MS);
}

// 显示方式只改变界面，不修改正文和保存状态
function changePreviewMode(event) {
    const button = event.target.closest("button[data-mode]");
    if (!button) {
        return;
    }
    const mode = button.dataset.mode;
    document.getElementById("body-workspace").dataset.mode = mode;
    document.getElementById("markdown-preview").hidden = mode === "edit";
    bodyInput.hidden = mode === "preview";
    for (const item of document.querySelectorAll("#preview-modes button")) {
        item.setAttribute("aria-pressed", String(item === button));
    }
    updatePreview();
}

// 手动保存草稿允许标题和正文为空，发布校验由另一个按钮执行
function saveDraft() {
    saveManually("DRAFT");
}

// 页面有未保存输入、待上传图片或进行中的请求时，离开前提醒用户
function warnBeforeLeaving(event) {
    if (!initialized || leaving) {
        return;
    }
    if (editor.dirty() || editor.state.pending || editor.state.blocked || hasPendingImages() || tagsTextField.value.trim()) {
        event.preventDefault();
        event.returnValue = "";
    }
}

// 校验 raw 中的话题，合格后创建可移除的标签
function addChip(raw) {
    const withoutPrefix = raw.replace(/^#+/, "");
    const tag = withoutPrefix.trim();
    if (!tag) {
        return;
    }
    if (chipTags.includes(tag)) {
        tagsTextField.value = "";
        return;
    }
    if (chipTags.length >= MAX_TAGS) {
        showToast("最多添加 " + MAX_TAGS + " 个话题", true);
        tagsTextField.value = "";
        return;
    }
    if (tag.length > MAX_TAG_LENGTH) {
        showToast("每个话题不超过 " + MAX_TAG_LENGTH + " 个字符", true);
        return;
    }
    chipTags.push(tag);
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = tag;
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "tag-remove";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", "移除话题：" + tag);
    // 同时移除标签元素和对应值，保持界面与提交内容一致
    removeButton.addEventListener("click", function removeTagChip() {
        const index = chipTags.indexOf(tag);
        chipTags.splice(index, 1);
        chip.remove();
        editorChanged();
    });
    chip.appendChild(removeButton);
    tagsChips.appendChild(chip);
    tagsTextField.value = "";
    editorChanged();
}

// 回车或空格确认话题，空输入时退格移除最后一个话题
function handleTagKey(event) {
    if (event.isComposing) {
        return;
    }
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        addChip(tagsTextField.value);
    } else if (event.key === "Backspace" && tagsTextField.value === "" && chipTags.length > 0) {
        const lastChip = tagsChips.lastElementChild;
        if (lastChip) {
            const removeButton = lastChip.querySelector(".tag-remove");
            removeButton.click();
        }
    }
}

// 输入分隔符时确认话题，中文输入法组合期间继续保留输入
function handleTagInput(event) {
    if (event.isComposing) {
        return;
    }
    const value = tagsTextField.value;
    if (value.endsWith(" ") || value.endsWith("，") || value.endsWith(",")) {
        addChip(value.slice(0, -1));
    }
}

// 离开话题输入框时确认尚未添加的话题
function confirmTagInput() {
    if (tagsTextField.value.trim()) {
        addChip(tagsTextField.value);
    }
}

// 点击话题区域时把焦点放回输入框
function focusTagInput() {
    tagsTextField.focus();
}

// 确认登录身份，凭证失效时显示重新登录入口
async function checkLogin() {
    window.clearTimeout(autosaveTimer);
    editorFields.disabled = true;
    loginActions.hidden = true;
    const session = readSession();
    if (!session) {
        showLoginRequired("请先登录，再发布文章");
        return;
    }
    try {
        const user = await requestApi("/me", "GET", null, session.token);
        const active = readSession();
        if (!active || active.token !== session.token) {
            throw new Error("登录账号已变化，请重新确认登录");
        }
        if (initialized && username !== user.username) {
            showLoginRequired("当前账号与文章作者不同，请切回原账号，输入仍保留");
            return;
        }
        sessionToken = session.token;
        username = user.username;
        document.getElementById("author-name").textContent = user.displayName + "（" + user.username + "）";
        if (!initialized) {
            const parameters = new URLSearchParams(window.location.search);
            const id = parameters.get("id");
            if (id) {
                const note = await requestApi("/notes/" + encodeURIComponent(id), "GET", null, sessionToken);
                checkEditorIdentity(sessionToken);
                if (note.author.username !== username) {
                    throw new Error("只能编辑本人文章");
                }
                editor.load(note);
                populateEditor(note);
                saveState.textContent = "已载入保存的版本";
            }
            initialized = true;
        }
        showMessage(publishMessage, "", false);
        editorFields.disabled = false;
        updateEditorControls();
        if (dirtyDuringLogin) {
            dirtyDuringLogin = false;
            editorChanged();
        }
    } catch (error) {
        if (error.status === 401) {
            clearSession();
            showLoginRequired("登录已失效，请重新登录");
            return;
        }
        showLoginRequired(error.message);
    }
}

// 显示 text 中的登录提示，暂停编辑并保留当前输入
function showLoginRequired(text) {
    sessionToken = null;
    window.clearTimeout(autosaveTimer);
    editorFields.disabled = true;
    showMessage(publishMessage, text, true);
    loginActions.hidden = false;
    document.getElementById("check-login").hidden = false;
    updateEditorControls();
}

// 更新已选图片数量和预览，上传成功后改用服务器图片地址
function renderSelectedImages() {
    imagePreviews.replaceChildren();
    document.getElementById("image-count").textContent = selectedImages.length + " / " + MAX_IMAGES;
    for (let index = 0; index < selectedImages.length; index = index + 1) {
        const selectedImage = selectedImages[index];
        const figure = document.createElement("figure");
        figure.className = "image-preview";
        const image = document.createElement("img");
        image.src = selectedImage.url;
        image.alt = "已选素材图片";
        if (selectedImage.file) {
            image.alt = selectedImage.file.name;
        }
        image.loading = "lazy";
        const caption = document.createElement("figcaption");
        const name = document.createElement("span");
        name.textContent = "素材库图片";
        if (selectedImage.file) {
            name.textContent = selectedImage.file.name;
        }
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.textContent = "移除";
        removeButton.setAttribute("aria-label", "移除第 " + (index + 1) + " 张图片");
        // 移除这张预览，释放本地地址并重新排列剩余图片
        removeButton.addEventListener("click", function removePreviewImage() {
            if (selectedImages[index].previewUrl) {
                URL.revokeObjectURL(selectedImages[index].previewUrl);
            }
            selectedImages.splice(index, 1);
            renderSelectedImages();
            updateMediaSelection();
            editorChanged();
        });
        caption.append(name, removeButton);
        figure.append(image, caption);
        imagePreviews.appendChild(figure);
    }
    uploadButton.disabled = uploading || !hasPendingImages();
}

// 检查是否还有只保存在本机、尚未上传的图片
function hasPendingImages() {
    for (const selectedImage of selectedImages) {
        if (selectedImage.file && !selectedImage.id) {
            return true;
        }
    }
    return false;
}

// 整组选中文件通过格式、大小和数量检查后，一起加入预览列表
// 中途发现无效文件时保持原列表，方便用户分清本次是否添加成功
function handleFileSelection() {
    showMessage(uploadMessage, "", false);
    const files = fileInput.files;
    if (selectedImages.length + files.length > MAX_IMAGES) {
        showToast("一篇文章最多添加 9 张图片", true);
        fileInput.value = "";
        return;
    }
    for (const file of files) {
        try {
            validateImage(file);
        } catch (error) {
            showToast(error.message, true);
            fileInput.value = "";
            return;
        }
    }
    for (const file of files) {
        const previewUrl = URL.createObjectURL(file);
        selectedImages.push({ file: file, id: null, url: previewUrl, previewUrl: previewUrl });
    }
    fileInput.value = "";
    renderSelectedImages();
    editorChanged();
}

// 逐张上传图片，成功的图片保留，失败的图片留在列表中供重试
// 每次只发送尚未取得 ID 的文件，避免整组重试时重复上传成功图片
async function uploadPendingImages() {
    if (uploading || !sessionToken || manualSave) {
        return;
    }
    uploading = true;
    setBusy(uploadButton, true);
    uploadButton.disabled = true;
    fileInput.disabled = true;
    let failed = false;
    try {
        checkEditorIdentity(sessionToken);
        for (let index = 0; index < selectedImages.length; index = index + 1) {
            const selectedImage = selectedImages[index];
            if (!selectedImage.file || selectedImage.id) {
                continue;
            }
            const formData = new FormData();
            formData.append("file", selectedImage.file);
            const uploadedImage = await requestApi("/media", "POST", formData, sessionToken);
            checkEditorIdentity(sessionToken);
            selectedImage.id = uploadedImage.id;
            selectedImage.url = uploadedImage.url;
            selectedImage.file = null;
            // 上传后预览改用服务器地址，本地临时地址已经没有用途，及时释放内存
            if (selectedImage.previewUrl) {
                URL.revokeObjectURL(selectedImage.previewUrl);
                selectedImage.previewUrl = null;
            }
            renderSelectedImages();
        }
        showToast("图片已上传，可以发布文章");
    } catch (error) {
        failed = true;
        if (error.status === 401) {
            clearSession();
            showLoginRequired("登录已失效，请重新登录；已选图片仍保留");
        }
        if (error.uncertain && error.status !== 401) {
            showToast(error.message + "。请打开素材库确认上传结果，避免重复上传", true);
        } else {
            showToast(error.message + "。已上传图片会保留", true);
        }
    } finally {
        uploading = false;
        setBusy(uploadButton, false);
        fileInput.disabled = !sessionToken;
        uploadButton.disabled = !sessionToken || !hasPendingImages();
        editorChanged();
        if (failed) {
            fileInput.focus();
        }
    }
}

// 读取本人素材库，用既有图片时不重复上传
async function loadMediaLibrary() {
    if (readingLibrary || !sessionToken) {
        return;
    }
    readingLibrary = true;
    document.getElementById("media-refresh").disabled = true;
    mediaList.replaceChildren();
    mediaStatus.textContent = "正在读取图片";
    try {
        const path = "/me/media?page=" + libraryPage + "&pageSize=" + pageSize;
        const result = await requestApi(path, "GET", null, sessionToken);
        libraryPageCount = Math.max(1, Math.ceil(result.total / pageSize));
        document.getElementById("media-page").textContent = libraryPage + " / " + libraryPageCount;
        document.getElementById("media-previous").disabled = libraryPage <= 1;
        document.getElementById("media-next").disabled = libraryPage >= libraryPageCount;
        if (result.items.length === 0) {
            mediaStatus.textContent = "素材库里还没有图片";
        } else {
            mediaStatus.textContent = "选择图片即可加入文章，最多 9 张";
        }
        for (const item of result.items) {
            mediaList.appendChild(makeMediaChoice(item));
        }
    } catch (error) {
        if (error.status === 401) {
            clearSession();
            showLoginRequired("登录已失效，请重新登录");
        }
        mediaStatus.textContent = "读取素材失败：" + error.message;
    } finally {
        readingLibrary = false;
        document.getElementById("media-refresh").disabled = false;
    }
}

// 创建素材库选项，并标出已加入文章的图片
function makeMediaChoice(item) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "media-choice";
    choice.dataset.imageId = item.id;
    const alreadySelected = isImageSelected(item.id);
    choice.setAttribute("aria-pressed", String(alreadySelected));
    const image = document.createElement("img");
    image.src = item.url;
    image.alt = "";
    image.loading = "lazy";
    const caption = document.createElement("span");
    caption.textContent = "引用数 " + item.referenceCount;
    choice.append(image, caption);
    // 点击素材时切换选择状态，服务器素材本身继续保留
    choice.addEventListener("click", function toggleMediaChoice() {
        if (isImageSelected(item.id)) {
            removeSelectedImage(item.id);
        } else if (selectedImages.length >= MAX_IMAGES) {
            showToast("一篇文章最多添加 9 张图片", true);
            return;
        } else {
            selectedImages.push({ file: null, id: item.id, url: item.url });
        }
        renderSelectedImages();
        // 选择只改变本页引用关系，没有修改素材库，直接更新按钮即可，省去一次查询
        updateMediaSelection();
        editorChanged();
    });
    return choice;
}

// 按当前已选图片更新素材按钮，复用已有节点，不重新请求整页素材
function updateMediaSelection() {
    const choices = mediaList.querySelectorAll(".media-choice");
    for (const choice of choices) {
        const selected = isImageSelected(choice.dataset.imageId);
        choice.setAttribute("aria-pressed", String(selected));
    }
}

// 查询素材是否已在文章图片列表中
function isImageSelected(imageId) {
    for (const selectedImage of selectedImages) {
        if (selectedImage.id === imageId) {
            return true;
        }
    }
    return false;
}

// 根据 imageId 移出文章图片列表，素材库里的文件继续保留
function removeSelectedImage(imageId) {
    for (let index = selectedImages.length - 1; index >= 0; index = index - 1) {
        if (selectedImages[index].id === imageId) {
            selectedImages.splice(index, 1);
        }
    }
}

// 处理表单提交并发布文章，输入和图片在失败时保留
// 请求结果不明时暂停提交，用户核对“我的文章”后再决定是否重试
// 后端可能已经创建文章但响应丢失，直接重发会产生重复文章
async function publishArticle(event) {
    event.preventDefault();
    await saveManually("PUBLISHED");
}

// 显示正文长度，输入上限与接口一致
function updateBodyCount() {
    document.getElementById("body-count").textContent = bodyInput.value.length + " / " + MAX_BODY_LENGTH;
}

// 确认文章未发布后，才允许再次提交，避免重复创建
function allowPublishRetry() {
    // 首次创建没有拿到 ID，用户只能自行核对列表后明确恢复提交
    if (editor.state.note || !editor.state.uncertain) {
        return;
    }
    editor.state.blocked = false;
    editor.state.uncertain = null;
    autosaveEnabled.checked = false;
    uncertainPanel.hidden = true;
    saveState.textContent = "已核对，请手动保存";
    updateEditorControls();
}

// 选择素材库上一页
function showPreviousMediaPage() {
    if (libraryPage > 1) {
        libraryPage = libraryPage - 1;
        loadMediaLibrary();
    }
}

// 选择素材库下一页
function showNextMediaPage() {
    if (libraryPage < libraryPageCount) {
        libraryPage = libraryPage + 1;
        loadMediaLibrary();
    }
}

// 关闭素材库窗口
function closeMediaLibrary() {
    mediaDialog.close();
}

tagsTextField.addEventListener("keydown", handleTagKey);
tagsTextField.addEventListener("input", handleTagInput);
tagsTextField.addEventListener("blur", confirmTagInput);
tagsField.addEventListener("click", focusTagInput);
fileInput.addEventListener("change", handleFileSelection);
uploadButton.addEventListener("click", uploadPendingImages);
form.addEventListener("submit", publishArticle);
bodyInput.addEventListener("input", bodyChanged);
titleInput.addEventListener("input", editorChanged);
tagsTextField.addEventListener("input", editorChanged);
autosaveEnabled.addEventListener("change", editorChanged);
saveDraftButton.addEventListener("click", saveDraft);
document.getElementById("preview-modes").addEventListener("click", changePreviewMode);
document.getElementById("check-save-result").addEventListener("click", checkSaveResult);
document.getElementById("reload-conflict").addEventListener("click", reloadConflict);
document.getElementById("use-server").addEventListener("click", useServerContent);
document.getElementById("keep-local").addEventListener("click", keepLocalContent);
window.addEventListener("beforeunload", warnBeforeLeaving);
document.getElementById("check-login").addEventListener("click", checkLogin);
document.getElementById("retry-publish").addEventListener("click", allowPublishRetry);
// 打开素材窗口后读取当前页
document.getElementById("open-library").addEventListener("click", function openMediaLibrary() {
    mediaDialog.showModal();
    loadMediaLibrary();
});
document.getElementById("close-library").addEventListener("click", closeMediaLibrary);
document.getElementById("media-refresh").addEventListener("click", loadMediaLibrary);
document.getElementById("media-previous").addEventListener("click", showPreviousMediaPage);
document.getElementById("media-next").addEventListener("click", showNextMediaPage);

fillIcons();
updateBodyCount();
checkLogin();
