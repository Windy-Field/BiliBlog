import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage } from "./common.js";
import { makeIcon, fillIcons } from "./icons.js";

const form = document.getElementById("publish-form");
const editorFields = document.getElementById("editor-fields");
const titleInput = document.getElementById("article-title");
const bodyInput = document.getElementById("article-body");
const tagsInput = document.getElementById("article-tags");
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
const pageSize = 20;
const selectedImages = [];
let sessionToken = null;
let publishing = false;
let uploading = false;
let readingLibrary = false;
let libraryPage = 1;
let libraryPageCount = 1;

// 显示登录状态，并在登录失效时允许先去登录再回来继续写
async function checkLogin() {
    editorFields.disabled = true;
    loginActions.hidden = true;
    showMessage(publishMessage, "正在确认登录状态", false);
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
        showMessage(publishMessage, error.message, true);
        loginActions.hidden = false;
    }
}

// 暂停编辑并显示登录入口，重新登录后输入内容仍保留
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
        removeButton.className = "remove-image";
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

// 选择图片后立即预览，并检查格式、大小和文章图片数量
function handleFileSelection() {
    showMessage(uploadMessage, "", false);
    const files = fileInput.files;
    if (selectedImages.length + files.length > 9) {
        showMessage(uploadMessage, "一篇文章最多添加 9 张图片", true);
        fileInput.value = "";
        return;
    }
    for (const file of files) {
        if (!isAllowedImage(file)) {
            showMessage(uploadMessage, file.name + " 不是 JPEG、PNG 或 WebP 图片", true);
            fileInput.value = "";
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showMessage(uploadMessage, file.name + " 超过 5 MiB，请选择较小的图片", true);
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
async function uploadPendingImages() {
    if (uploading || !sessionToken) {
        return;
    }
    uploading = true;
    uploadButton.disabled = true;
    fileInput.disabled = true;
    let failed = false;
    try {
        for (let index = 0; index < selectedImages.length; index = index + 1) {
            const selectedImage = selectedImages[index];
            if (!selectedImage.file || selectedImage.id) {
                continue;
            }
            showMessage(uploadMessage, "正在上传第 " + (index + 1) + " 张图片", false);
            const formData = new FormData();
            formData.append("file", selectedImage.file);
            const uploadedImage = await requestApi("/media", "POST", formData, sessionToken);
            selectedImage.id = uploadedImage.id;
            selectedImage.url = uploadedImage.url;
            selectedImage.file = null;
            renderSelectedImages();
        }
        showMessage(uploadMessage, "图片已上传，可以发布文章", false);
    } catch (error) {
        failed = true;
        if (error.status === 401) {
            clearSession();
            showLoginRequired("登录已失效，请重新登录；已选图片仍保留");
        }
        if (error.uncertain && error.status !== 401) {
            showMessage(uploadMessage, error.message + "。请打开素材库确认上传结果，避免重复上传", true);
        } else {
            showMessage(uploadMessage, error.message + "。已上传图片会保留", true);
        }
    } finally {
        uploading = false;
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

// 从文章中移除素材引用，但不删除用户素材库里的文件
function removeSelectedImage(imageId) {
    for (let index = selectedImages.length - 1; index >= 0; index = index - 1) {
        if (selectedImages[index].id === imageId) {
            selectedImages.splice(index, 1);
        }
    }
}

// 检查表单后真实发布文章；结果不明确时先让用户核对，避免重复创建
async function publishArticle(event) {
    event.preventDefault();
    if (publishing || !sessionToken) {
        return;
    }
    if (!form.reportValidity()) {
        return;
    }
    if (hasPendingImages()) {
        showMessage(uploadMessage, "请先上传选中的图片", true);
        uploadButton.focus();
        return;
    }
    let tags;
    try {
        tags = readTags();
    } catch (error) {
        showMessage(publishMessage, error.message, true);
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
    editorFields.disabled = true;
    document.getElementById("publish-button").textContent = "正在发布";
    showMessage(publishMessage, "正在发布文章", false);
    uncertainPanel.hidden = true;
    try {
        const note = await requestApi("/notes", "POST", body, sessionToken);
        showMessage(publishMessage, "文章已发布，正在打开文章", false);
        window.location.replace("/index.html?feed=mine#article=" + encodeURIComponent(note.id));
    } catch (error) {
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
