import { showToast } from "./common.js";

let dialog = null;
let addressInput;

// 复制公开文章链接，不携带私人列表、账号参数或评论定位编号
export async function copyArticleLink(noteId) {
    const address = new URL("/index.html", window.location.origin);
    const hash = new URLSearchParams();
    hash.set("article", noteId);
    address.hash = hash.toString();
    try {
        await navigator.clipboard.writeText(address.href);
        showToast("链接已复制");
    } catch {
        showCopyAddress(address.href);
    }
}

// 剪贴板权限不可用时保留可选中的地址，原生窗口负责焦点和 Escape
function showCopyAddress(address) {
    if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.className = "share-dialog";
        dialog.setAttribute("aria-labelledby", "share-title");
        const title = document.createElement("h2");
        title.id = "share-title";
        title.textContent = "文章链接";
        const label = document.createElement("label");
        label.htmlFor = "share-address";
        label.textContent = "链接地址";
        addressInput = document.createElement("input");
        addressInput.id = "share-address";
        addressInput.readOnly = true;
        const form = document.createElement("form");
        form.method = "dialog";
        const close = document.createElement("button");
        close.textContent = "关闭";
        form.appendChild(close);
        dialog.append(title, label, addressInput, form);
        document.body.appendChild(dialog);
    }
    addressInput.value = address;
    if (!dialog.open) {
        dialog.showModal();
    }
    addressInput.focus();
    addressInput.select();
}
