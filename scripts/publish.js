import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy } from "./common.js";
import { makeIcon, fillIcons } from "./icons.js";

const form = document.getElementById("publish-form");
const editorFields = document.getElementById("editor-fields");
const titleInput = document.getElementById("article-title");
const bodyInput = document.getElementById("article-body");
const tagsInput = document.getElementById("article-tags");
const tagsTextField = document.getElementById("tags-text");
const tagsChips = document.getElementById("tags-chips");
const tagsFieldEl = document.getElementById("tags-field");
const fileInput = document.getElementById("article-images");
const imagePreviews = document.getElementById("image-previews");
const uploadButton = document.getElementById("upload-selected");
const publishButton = document.getElementById("publish-button");
const publishMessage = document.getElementById("publish-message");

// 胶囊标签管理
const chipTags = [];

function syncTagsInput() {
    tagsInput.value = chipTags.join(",");
}

function addChip(raw) {
    const tag = raw.replace(/^#+/, "").trim();
    if (!tag) return;
    if (chipTags.includes(tag)) {
        tagsTextField.value = "";
        return;
    }
    if (chipTags.length >= 5) {
        showToast("最多添加 5 个话题", true);
        tagsTextField.value = "";
        return;
    }
    if (tag.length > 20) {
        showToast("每个话题不超过 20 个字符", true);
        return;
    }
    chipTags.push(tag);
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = tag;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "tag-remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", "移除话题：" + tag);
    removeBtn.addEventListener("click", function () {
        chipTags.splice(chipTags.indexOf(tag), 1);
        chip.remove();
        syncTagsInput();
    });
    chip.appendChild(removeBtn);
    tagsChips.appendChild(chip);
    tagsTextField.value = "";
    syncTagsInput();
}

tagsTextField.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        addChip(tagsTextField.value);
    } else if (event.key === "Backspace" && tagsTextField.value === "" && chipTags.length > 0) {
        const lastChip = tagsChips.lastElementChild;
        if (lastChip) lastChip.querySelector(".tag-remove").click();
    }
});

tagsTextField.addEventListener("input", function () {
    const val = tagsTextField.value;
    if (val.endsWith(" ") || val.endsWith("，") || val.endsWith(",")) {
        addChip(val.slice(0, -1));
    }
});

tagsTextField.addEventListener("blur", function () {
    if (tagsTextField.value.trim()) {
        addChip(tagsTextField.value);
    }
});

tagsFieldEl.addEventListener("click", function () {
    tagsTextField.focus();
});
const uploadMessage = document.getElementById("upload-status");
const loginActions = document.getElementById("login-actions");
const uncertainPanel = document.getElementById("publish-uncertain");
const mediaDialog = document.getElementById("media-dialog");
const mediaList = document.getElementById("media-list");
const mediaStatus = document.getElementById("media-status");
const pageSize = 20;
const selectedImages = [];
let sessionToken = null;
let publishing = false;
let uploading = false;
let readingLibrary = false;
let libraryPage = 1;
let libraryPageCount = 1;

// 确认登录身份，凭证失效时显示重新登录入口
async function checkLogin() {
    editorFields.disabled = true;
    loginActions.hidden = true;
    const session = readSession();
    if (!session) {
        showLoginRequired("请先登录，再发布文章");
        return;
    }
    try {
        const user = await requestApi("/me", "GET", null, session.token);
        sessionToken = session.token;
        document.getElementById("author-name").textContent = user.displayName + "（" + user.username + "）";
        showMessage(publishMessage, "", false);
        editorFields.disabled = false;
    } catch (error) {
        if (error.status === 401) {
            clearSession();
            showLoginRequired("登录已失效，请重新登录");
            return;
        }
        showToast(error.message, true);
    }
}

// 显示 text 中的登录提示，暂停编辑并保留当前输入
function showLoginRequired(text) {
    sessionToken = null;
    editorFields.disabled = true;
    showMessage(publishMessage, text, true);
    loginActions.hidden = false;
    document.getElementById("check-login").hidden = false;
}

// 拆分话题并检查接口规定的数量和长度
function readTags() {
    const enteredTags = tagsInput.value.split(",");
    const tags = [];
    for (const enteredTag of enteredTags) {
        const tag = enteredTag.trim();
        if (!tag) {
            continue;
        }
        if (tag.length > 20) {
            throw new Error("每个话题不能超过 20 个字符");
        }
        if (!tags.includes(tag)) {
            tags.push(tag);
        }
    }
    if (tags.length > 5) {
        throw new Error("一篇文章最多添加 5 个话题");
    }
    return tags;
}

// 更新已选图片数量和预览，上传成功后改用服务器图片地址
function renderSelectedImages() {
    imagePreviews.replaceChildren();
    document.getElementById("image-count").textContent = selectedImages.length + " / 9";
    for (let index = 0; index < selectedImages.length; index = index + 1) {
        const selectedImage = selectedImages[index];
        const figure = document.createElement("figure");
        figure.className = "image-preview";
        const image = document.createElement("img");
        image.src = selectedImage.url;
        image.alt = selectedImage.file ? selectedImage.file.name : "已选素材图片";
        image.loading = "lazy";
        const caption = document.createElement("figcaption");
        const name = document.createElement("span");
        name.textContent = selectedImage.file ? selectedImage.file.name : "素材库图片";
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.textContent = "移除";
        removeButton.setAttribute("aria-label", "移除第 " + (index + 1) + " 张图片");
        removeButton.addEventListener("click", function removeSelectedImage() {
            if (selectedImages[index].previewUrl) {
                URL.revokeObjectURL(selectedImages[index].previewUrl);
            }
            selectedImages.splice(index, 1);
            renderSelectedImages();
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
    if (selectedImages.length + files.length > 9) {
        showToast("一篇文章最多添加 9 张图片", true);
        fileInput.value = "";
        return;
    }
    for (const file of files) {
        if (!isAllowedImage(file)) {
            showToast(file.name + " 不是 JPEG、PNG 或 WebP 图片", true);
            fileInput.value = "";
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showToast(file.name + " 超过 5 MiB，请选择较小的图片", true);
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
}

// 只接受接口支持的三种图片格式
function isAllowedImage(file) {
    return file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp";
}

// 逐张上传图片，成功的图片保留，失败的图片留在列表中供重试
// 每次只发送尚未取得 ID 的文件，避免整组重试时重复上传成功图片
async function uploadPendingImages() {
    if (uploading || !sessionToken) {
        return;
    }
    uploading = true;
    setBusy(uploadButton, true);
    uploadButton.disabled = true;
    fileInput.disabled = true;
    let failed = false;
    try {
        for (let index = 0; index < selectedImages.length; index = index + 1) {
            const selectedImage = selectedImages[index];
            if (!selectedImage.file || selectedImage.id) {
                continue;
            }
            const formData = new FormData();
            formData.append("file", selectedImage.file);
            const uploadedImage = await requestApi("/media", "POST", formData, sessionToken);
            selectedImage.id = uploadedImage.id;
            selectedImage.url = uploadedImage.url;
            selectedImage.file = null;
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
    const alreadySelected = isImageSelected(item.id);
    choice.setAttribute("aria-pressed", String(alreadySelected));
    const image = document.createElement("img");
    image.src = item.url;
    image.alt = "";
    image.loading = "lazy";
    const caption = document.createElement("span");
    caption.textContent = "引用数 " + item.referenceCount;
    choice.append(image, caption);
    choice.addEventListener("click", function toggleMediaChoice() {
        if (isImageSelected(item.id)) {
            removeSelectedImage(item.id);
        } else if (selectedImages.length >= 9) {
            mediaStatus.textContent = "一篇文章最多添加 9 张图片";
            return;
        } else {
            selectedImages.push({ file: null, id: item.id, url: item.url });
        }
        renderSelectedImages();
        loadMediaLibrary();
    });
    return choice;
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
    if (publishing || !sessionToken) {
        return;
    }
    if (!form.reportValidity()) {
        return;
    }
    if (hasPendingImages()) {
        showToast("请先上传选中的图片", true);
        uploadButton.focus();
        return;
    }
    let tags;
    try {
        tags = readTags();
    } catch (error) {
        showToast(error.message, true);
        tagsInput.focus();
        return;
    }
    const body = {
        title: titleInput.value.trim(),
        contentMarkdown: bodyInput.value,
        imageIds: [],
        tags: tags,
        status: "PUBLISHED"
    };
    for (const selectedImage of selectedImages) {
        if (selectedImage.id) {
            body.imageIds.push(selectedImage.id);
        }
    }
    publishing = true;
    setBusy(publishButton, true);
    editorFields.disabled = true;
    document.getElementById("publish-button").textContent = "正在发布";
    uncertainPanel.hidden = true;
    try {
        const note = await requestApi("/notes", "POST", body, sessionToken);
        showToast("文章已发布，正在打开文章");
        // 短暂显示成功提示后打开文章
        window.setTimeout(function openPublishedArticle() {
            window.location.replace("/index.html?feed=mine#article=" + encodeURIComponent(note.id));
        }, 700);
    } catch (error) {
        publishing = false;
        setBusy(publishButton, false);
        publishButton.replaceChildren(makeIcon("send"), document.createTextNode("发布文章"));
        if (error.status === 401) {
            clearSession();
            showLoginRequired("登录已失效，请重新登录；文章内容和图片已保留");
            return;
        }
        showMessage(publishMessage, error.message, true);
        if (error.uncertain) {
            uncertainPanel.hidden = false;
            editorFields.disabled = true;
            return;
        }
        publishing = false;
        editorFields.disabled = false;
        publishButton.replaceChildren(makeIcon("send"), document.createTextNode("发布文章"));
    }
}

// 显示正文长度，输入上限与接口一致
function updateBodyCount() {
    document.getElementById("body-count").textContent = bodyInput.value.length + " / 12000";
}

// 确认文章未发布后，才允许再次提交，避免重复创建
function allowPublishRetry() {
    uncertainPanel.hidden = true;
    publishing = false;
    editorFields.disabled = false;
    publishButton.disabled = false;
    publishButton.replaceChildren(makeIcon("send"), document.createTextNode("发布文章"));
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

// 登录或返回发布页面后重新确认账号状态
function retryLoginCheck() {
    checkLogin();
}

fileInput.addEventListener("change", handleFileSelection);
uploadButton.addEventListener("click", uploadPendingImages);
form.addEventListener("submit", publishArticle);
bodyInput.addEventListener("input", updateBodyCount);
document.getElementById("check-login").addEventListener("click", retryLoginCheck);
document.getElementById("retry-publish").addEventListener("click", allowPublishRetry);
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
