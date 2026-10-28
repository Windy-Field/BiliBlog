import {
    createElement,
    Search,
    X,
    House,
    Compass,
    Users,
    Bookmark,
    FileText,
    LogOut,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Heart,
    MessageCircle,
    RefreshCw,
    ArrowUp,
    UserRound,
    PenLine,
    ImagePlus,
    Send,
    Megaphone,
} from "lucide";

const iconShapes = {
    search: Search,
    close: X,
    home: House,
    discover: Compass,
    following: Users,
    bookmark: Bookmark,
    article: FileText,
    logout: LogOut,
    down: ChevronDown,
    previous: ChevronLeft,
    next: ChevronRight,
    heart: Heart,
    comment: MessageCircle,
    refresh: RefreshCw,
    top: ArrowUp,
    user: UserRound,
    write: PenLine,
    image: ImagePlus,
    send: Send,
    notice: Megaphone,
};

// 根据名称创建 Lucide 图标，图标旁的按钮或文字负责说明用途
export function makeIcon(name) {
    return createElement(iconShapes[name], {
        width: 20,
        height: 20,
        "stroke-width": 1.8,
        "aria-hidden": "true",
        focusable: "false",
    });
}

// 替换页面中标记过的图标位置
export function fillIcons() {
    const places = document.querySelectorAll("[data-icon]");
    for (const place of places) {
        const icon = makeIcon(place.dataset.icon);
        place.replaceChildren(icon);
    }
}
