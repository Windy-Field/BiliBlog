// 将文字显示在提示元素中，isError 决定是否使用错误样式
export function showMessage(element, text, isError) {
    // 按纯文字显示，避免把提示内容当成 HTML
    element.textContent = text;
    element.dataset.error = String(isError);
    if (isError) {
        // 错误出现时移入焦点，提示元素需设置 tabindex="-1"
        element.focus();
    }
}
