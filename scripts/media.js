import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "./config.js";

// 检查 file 的图片格式，返回是否属于接口支持的类型
export function isAllowedImage(file) {
    return IMAGE_TYPES.includes(file.type);
}

// 校验单张图片，格式或大小不符合接口限制时抛出中文错误
export function validateImage(file) {
    if (!isAllowedImage(file)) {
        throw new Error(file.name + " 不是 JPEG、PNG 或 WebP 图片");
    }
    if (file.size > MAX_IMAGE_BYTES) {
        throw new Error(file.name + " 超过 5 MiB，请选择较小的图片");
    }
}

// 将 file 显示在 container 中，图片加载完成或失败后释放本地预览地址
export function showLocalImage(container, file) {
    const previewUrl = URL.createObjectURL(file);
    const image = document.createElement("img");
    image.alt = "";
    // 预览地址只用于这张图片，结束后释放浏览器占用的内存
    function releasePreview() {
        URL.revokeObjectURL(previewUrl);
    }
    image.addEventListener("load", releasePreview, { once: true });
    image.addEventListener("error", releasePreview, { once: true });
    image.src = previewUrl;
    container.replaceChildren(image);
}
