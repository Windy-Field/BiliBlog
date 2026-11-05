// 后端地址、请求超时（毫秒）与登录存储键，部署或切换环境时在这里修改
export const API_BASE_URL = "https://dev.muyufly.com/api/v1";
export const REQUEST_TIMEOUT_MS = 15000;
export const SESSION_KEY = "sdu-blog-session";
// 本页登录状态变化时通知界面，其他标签页继续使用浏览器的 storage 事件
export const SESSION_CHANGED_EVENT = "account-session-change";
export const LOCAL_UNREAD_PREFIX = "BiliBlog-notification-unread-";
export const DEFAULT_COVER_URL = "/assets/images/forest-banner.jpg";
// 列表每页数量及接口最大页码，首页首屏额外容纳两篇文章
export const MAX_PAGE = 10000;
export const HOME_PAGE_SIZE = 20;
export const HOME_FIRST_PAGE_SIZE = 22;
export const PROFILE_PAGE_SIZE = 12;
export const DRAFT_PAGE_SIZE = 12;
export const COMMENT_PAGE_SIZE = 10;
export const NOTIFICATION_PAGE_SIZE = 10;
export const NOTIFICATION_SCAN_SIZE = 50;
export const MEDIA_PAGE_SIZE = 20;
export const TAG_PAGE_SIZE = 20;
export const PEOPLE_PAGE_SIZE = 20;
// 接口文字长度限制，修改时同时核对 openapi.json 和 HTML 校验属性
export const MAX_SEARCH_LENGTH = 100;
export const MAX_TITLE_LENGTH = 100;
// 本机阅读记录上限，以及滚动后延迟保存的毫秒数
export const READING_STORAGE_KEY = "BiliBlog-reading-progress";
export const READING_HISTORY_LIMIT = 100;
export const READING_SAVE_DELAY_MS = 300;
// 草稿备份与自动保存偏好的存储键，输入停止后的备份延迟以毫秒计
export const LOCAL_DRAFT_PREFIX = "BiliBlog-local-draft-";
export const DRAFT_AUTOSAVE_KEY = "BiliBlog-draft-autosave";
// 阅读偏好仅保存在本机，未设置时显示已删除评论的占位。
export const DELETED_COMMENTS_KEY = "BiliBlog-show-deleted-comments";
// 音乐偏好保存在本机，播放进度只在当前标签页延续，音量范围为 0 到 1。
export const MUSIC_STORAGE_KEY = "BiliBlog-music-settings";
export const MUSIC_POSITION_KEY = "BiliBlog-music-position";
export const MUSIC_DEFAULT_VOLUME = 0.03;
export const MUSIC_POSITION_SAVE_MS = 2000;
export const MUSIC_SOURCE = new URL("../assets/audio/mirror.m4a", import.meta.url).href;
export const LOCAL_DRAFT_DELAY_MS = 400;
// 文章、图片和个人资料的接口限制，容量单位为字节
export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 20;
export const MAX_IMAGES = 9;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_COMMENT_LENGTH = 1000;
export const MAX_BODY_LENGTH = 12000;
export const MAX_PROFILE_LINKS = 5;
export const MAX_LINK_LABEL_LENGTH = 30;
export const MAX_LINK_URL_LENGTH = 500;
// 本站界面按产品要求最多置顶两篇，校园后端自身的上限仍为三篇
export const MAX_PINNED_NOTES = 2;
export const MAX_COLLECTIONS = 20;
export const MAX_COLLECTION_NAME_LENGTH = 40;
// 宠物前后端共用路径和输入上限，会话编号仅用于延续当前应用对话
export const PET_CHAT_PATH = "/api/ai/chat";
export const PET_NAME = "Octorange";
export const PET_STATUS_PATH = "/api/ai/status";
export const PET_TIMEOUT_MS = 65000;
export const PET_MAX_MESSAGE_LENGTH = 2000;
export const PET_MAX_SESSION_LENGTH = 200;
// 当前页消息条数和本机设置键，超出条数时移除最早的消息节点
export const PET_MAX_MESSAGES = 40;
export const PET_STORAGE_KEY = "BiliBlog-pet-settings";
export const PET_SESSION_KEY = "BiliBlog-octorange-session";
// 问候显示与间隔时间以毫秒计，拖动阈值和视口边距以像素计
export const PET_GREETING_VISIBLE_MS = 5000;
export const PET_GREETING_HIDDEN_MS = 8000;
export const PET_DRAG_THRESHOLD = 6;
export const PET_EDGE_MARGIN = 12;
// 三种状态共用同一裁切范围，切图时保持角色位置稳定
export const PET_STATES = {
    idle: new URL("../assets/pet/idling.png", import.meta.url).href,
    hover: new URL("../assets/pet/hovering.png", import.meta.url).href,
    thinking: new URL("../assets/pet/thinking.png", import.meta.url).href
};
