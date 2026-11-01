// 与后端协议有关的共享参数，修改限制时需要同时核对 openapi.json 和 HTML 校验属性
export const API_BASE_URL = "https://dev.muyufly.com/api/v1";
export const REQUEST_TIMEOUT_MS = 15000;
export const SESSION_KEY = "sdu-blog-session";
export const LOCAL_UNREAD_PREFIX = "BiliBlog-notification-unread-";
export const DEFAULT_COVER_URL = "/assets/images/forest-banner.jpg";
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
export const MAX_SEARCH_LENGTH = 100;
export const MAX_TITLE_LENGTH = 100;
export const READING_STORAGE_KEY = "BiliBlog-reading-progress";
export const READING_HISTORY_LIMIT = 100;
export const READING_SAVE_DELAY_MS = 300;
export const LOCAL_DRAFT_PREFIX = "BiliBlog-local-draft-";
export const LOCAL_DRAFT_DELAY_MS = 400;
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
export const PET_CHAT_PATH = "/api/ai/chat";
export const PET_NAME = "Octorange";
export const PET_STATUS_PATH = "/api/ai/status";
export const PET_TIMEOUT_MS = 65000;
export const PET_MAX_MESSAGE_LENGTH = 2000;
export const PET_MAX_MESSAGES = 40;
export const PET_STORAGE_KEY = "BiliBlog-pet-settings";
export const PET_SESSION_KEY = "BiliBlog-octorange-session";
export const PET_GREETING_VISIBLE_MS = 5000;
export const PET_GREETING_HIDDEN_MS = 8000;
export const PET_DRAG_THRESHOLD = 6;
export const PET_EDGE_MARGIN = 12;
export const PET_STATES = {
    idle: new URL("../assets/pet/idling.png", import.meta.url).href,
    hover: new URL("../assets/pet/hovering.png", import.meta.url).href,
    thinking: new URL("../assets/pet/thinking.png", import.meta.url).href
};

