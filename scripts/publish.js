import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showMessage, showToast, setBusy } from "./common.js";
import { makeIcon, fillIcons } from "./icons.js";
import { MEDIA_PAGE_SIZE, MAX_TAGS, MAX_TAG_LENGTH, MAX_IMAGES, MAX_BODY_LENGTH } from "./config.js";
import { validateImage } from "./media.js";

const PUBLISH_REDIRECT_MS = 700;
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
let publishing = false;
let uploading = false;
let readingLibrary = false;
let libraryPage = 1;
let libraryPageCount = 1;

// 胶囊标签管理
const chipTags = [];

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
    });
    chip.appendChild(removeButton);
    tagsChips.appendChild(chip);
    tagsTextField.value = "";
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
    // 话题在添加时已经校验，提交副本以免后续编辑改变本次请求
    const tags = chipTags.slice();
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
        }, PUBLISH_REDIRECT_MS);
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
        editorFields.disabled = false;
    }
}

// 显示正文长度，输入上限与接口一致
function updateBodyCount() {
    document.getElementById("body-count").textContent = bodyInput.value.length + " / " + MAX_BODY_LENGTH;
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

tagsTextField.addEventListener("keydown", handleTagKey);
tagsTextField.addEventListener("input", handleTagInput);
tagsTextField.addEventListener("blur", confirmTagInput);
tagsField.addEventListener("click", focusTagInput);
fileInput.addEventListener("change", handleFileSelection);
uploadButton.addEventListener("click", uploadPendingImages);
form.addEventListener("submit", publishArticle);
bodyInput.addEventListener("input", updateBodyCount);
document.getElementById("check-login").addEventListener("click", retryLoginCheck);
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
