import { marked } from "marked";
import DOMPurify from "dompurify";

// 使用成熟解析器生成 Markdown 预览，再清理 HTML，禁止把用户输入直接当作可信页面
export function renderMarkdown(container, markdown) {
    const html = marked.parse(markdown, { breaks: true, gfm: true });
    container.innerHTML = DOMPurify.sanitize(html);
    for (const link of container.querySelectorAll("a")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    }
}
