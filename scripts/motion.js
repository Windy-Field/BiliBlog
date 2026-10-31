const RESIZE_CLEANUP_MS = 300;
const MIN_HEIGHT_CHANGE = 1;
const TOPBAR_PIN = 8;
const TOPBAR_FADE = 88;
const NOTICE_MIN_SECONDS = 24;
const NOTICE_SECONDS_PER_ITEM = 6;
// WeakMap 用元素作为键，元素被移除后不会仅因动效记录而一直占用内存
const panelChanges = new WeakMap();

// 执行 updateContent 更新面板，再平滑调整高度，连续操作从当前高度接着变化
export function resizePanel(element, updateContent) {
    const startHeight = element.getBoundingClientRect().height;
    const previous = panelChanges.get(element);
    if (previous) {
        element.removeEventListener("transitionend", previous.finish);
        window.clearTimeout(previous.timer);
    }
    element.classList.remove("is-resizing");
    element.style.removeProperty("height");
    updateContent();
    const endHeight = element.getBoundingClientRect().height;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || Math.abs(startHeight - endHeight) < MIN_HEIGHT_CHANGE) {
        panelChanges.delete(element);
        return;
    }
    const change = { timer: 0, finish: null };
    // 完成后恢复自然高度，屏幕变化和异步内容仍能正常排版
    function finishResize(event) {
        if (event && (event.target !== element || event.propertyName !== "height")) {
            return;
        }
        if (panelChanges.get(element) !== change) {
            return;
        }
        element.removeEventListener("transitionend", finishResize);
        window.clearTimeout(change.timer);
        element.classList.remove("is-resizing");
        element.style.removeProperty("height");
        panelChanges.delete(element);
    }
    change.finish = finishResize;
    panelChanges.set(element, change);
    element.style.height = startHeight + "px";
    // 先记录当前高度，再启用过渡，防止起点被浏览器合并掉
    void element.offsetHeight;
    element.classList.add("is-resizing");
    element.addEventListener("transitionend", finishResize);
    element.style.height = endHeight + "px";
    // 元素被移除或页面切到后台时，补充清理可能没有结束事件的过渡
    change.timer = window.setTimeout(finishResize, RESIZE_CLEANUP_MS);
}

// 滚动到 top 指定的页面位置，减少动态效果时直接到达
export function scrollPage(top) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let behavior = "smooth";
    if (reducedMotion) {
        behavior = "auto";
    }
    window.scrollTo({ top: top, behavior: behavior });
}

// 按滚动距离填充 topbar 的背景，保持导航位置和颜色连续变化
export function updatePinnedTopbar(topbar) {
    const offset = window.scrollY;
    if (offset <= TOPBAR_PIN) {
        topbar.classList.remove("is-sticky");
        topbar.style.removeProperty("--topbar-fill");
        return;
    }
    const progress = (offset - TOPBAR_PIN) / (TOPBAR_FADE - TOPBAR_PIN);
    const fill = Math.min(1, progress);
    topbar.classList.add("is-sticky");
    topbar.style.setProperty("--topbar-fill", fill.toFixed(3));
}

// 公告 group 超过可视区域时，复制一组内容并启用连续滚动
export function updateNoticeMotion(track, group, count) {
    const viewport = track.parentElement;
    if (group.scrollWidth <= viewport.clientWidth) {
        return;
    }
    const clone = group.cloneNode(true);
    clone.setAttribute("aria-hidden", "true");
    track.appendChild(clone);
    const seconds = Math.max(NOTICE_MIN_SECONDS, count * NOTICE_SECONDS_PER_ITEM);
    track.style.setProperty("--notice-duration", seconds + "s");
    track.classList.add("is-scrolling");
}
