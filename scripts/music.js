import { makeIcon } from "./icons.js";
import { showToast } from "./common.js";
import { MUSIC_STORAGE_KEY, MUSIC_POSITION_KEY, MUSIC_DEFAULT_VOLUME, MUSIC_POSITION_SAVE_MS, MUSIC_SOURCE } from "./config.js";

// 音量滑块使用百分数显示，实际播放音量为 0 到 1。
const VOLUME_MAX = 100;
const SECONDS_PER_MINUTE = 60;
const player = document.createElement("audio");
const shortcut = document.createElement("button");
const enabledControl = document.createElement("input");
const volumeControl = document.createElement("input");
const volumeValue = document.createElement("output");
const progressControl = document.createElement("input");
const progressValue = document.createElement("output");
let editingProgress = false;
let settings = readMusicSettings();
let waitingForGesture = false;
let playPending = false;
let failed = false;
let suspended = false;
let lastPositionSave = 0;
let initialized = false;

// 将秒数转成分:秒，音轨尚未加载时按零显示。
function formatMusicTime(seconds) {
    let totalSeconds = 0;
    if (Number.isFinite(seconds) && seconds > 0) {
        totalSeconds = Math.floor(seconds);
    }
    const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
    const remainingSeconds = totalSeconds % SECONDS_PER_MINUTE;
    let secondsText = String(remainingSeconds);
    if (remainingSeconds < 10) {
        secondsText = "0" + secondsText;
    }
    return minutes + ":" + secondsText;
}

// 同步进度范围和时间，拖动期间保留用户预览位置，不被播放事件覆盖。
function updateMusicProgress() {
    const duration = player.duration;
    const available = Number.isFinite(duration) && duration > 0 && !failed;
    progressControl.disabled = !available;
    if (!available) {
        editingProgress = false;
        progressControl.max = "0";
        progressControl.value = "0";
        progressValue.value = "0:00 / 0:00";
        progressControl.setAttribute("aria-valuetext", "音轨尚未就绪");
        return;
    }
    progressControl.max = String(duration);
    let position = player.currentTime;
    if (editingProgress) {
        position = Number(progressControl.value);
    }
    position = Math.max(0, Math.min(duration, position));
    progressControl.value = String(position);
    const timeText = formatMusicTime(position) + " / " + formatMusicTime(duration);
    progressValue.value = timeText;
    progressControl.setAttribute("aria-valuetext", timeText);
}

// 滑块移动时只预览时间，避免拖动过程中反复请求不同音频位置。
function previewMusicProgress() {
    editingProgress = true;
    updateMusicProgress();
}

// 松开滑块或完成键盘调节后跳转并保存进度，暂停状态保持不变。
function seekMusicProgress() {
    if (progressControl.disabled || !editingProgress) {
        return;
    }
    const position = Number(progressControl.value);
    editingProgress = false;
    try {
        player.currentTime = position;
        saveMusicPosition();
    } catch {
        showToast("暂时无法调整音乐进度，请稍后重试", true);
    }
    updateMusicProgress();
}

// 触摸拖动被取消时回到真实播放位置，不保留未提交的预览。
function cancelMusicProgress() {
    editingProgress = false;
    updateMusicProgress();
}

// 校验本机偏好，记录损坏时恢复默认开启和默认音量。
function readMusicSettings() {
    const defaults = { enabled: true, volume: MUSIC_DEFAULT_VOLUME };
    try {
        const text = localStorage.getItem(MUSIC_STORAGE_KEY);
        const saved = JSON.parse(text);
        if (!saved || typeof saved !== "object") {
            return defaults;
        }
        if (typeof saved.enabled === "boolean") {
            defaults.enabled = saved.enabled;
        }
        if (typeof saved.volume === "number" && Number.isFinite(saved.volume)) {
            defaults.volume = Math.max(0, Math.min(1, saved.volume));
        }
    } catch {
        // 存储被拒绝时仍允许在当前页面听音乐。
    }
    return defaults;
}

// 保存开关与音量，无法保存时给出仅本页有效的提示。
function saveMusicSettings() {
    try {
        localStorage.setItem(MUSIC_STORAGE_KEY, JSON.stringify(settings));
    } catch {
        showToast("音乐设置仅本页有效，浏览器未能保存偏好", true);
    }
}

// 保留同一按钮和滑块，仅按当前偏好及播放状态更新图标和可访问名称。
function updateMusicControls() {
    enabledControl.checked = settings.enabled;
    const percent = Math.round(settings.volume * VOLUME_MAX);
    volumeControl.value = String(percent);
    volumeControl.setAttribute("aria-valuetext", percent + "%");
    volumeValue.value = percent + "%";
    shortcut.setAttribute("aria-pressed", String(settings.enabled));
    let title = "开启背景音乐";
    let state = "off";
    if (settings.enabled) {
        title = "关闭背景音乐";
        state = "playing";
        if (player.paused) {
            title = "背景音乐已开启，等待首次交互播放；点击关闭";
            state = "waiting";
        }
        if (settings.volume === 0) {
            title = "背景音乐已开启，音量为零；点击关闭";
        }
    }
    if (failed && settings.enabled) {
        title = "音乐加载失败，点击重试";
        state = "error";
    }
    if (shortcut.dataset.state !== state) {
        shortcut.replaceChildren(makeIcon("music"));
    }
    shortcut.dataset.state = state;
    shortcut.title = title;
    shortcut.setAttribute("aria-label", title);
}

// 尝试有声播放；自动播放受限时等待真实交互，不伪装成正在播放。
async function playMusic() {
    if (!settings.enabled || suspended || failed || playPending || !player.paused) {
        return;
    }
    playPending = true;
    try {
        await player.play();
        waitingForGesture = false;
        if (!settings.enabled || suspended) {
            player.pause();
        }
    } catch (error) {
        if (error.name === "NotAllowedError") {
            waitingForGesture = true;
        } else if (error.name === "AbortError") {
            waitingForGesture = settings.enabled && !suspended;
        } else {
            reportMusicError();
        }
    } finally {
        playPending = false;
        updateMusicControls();
    }
}

// 统一应用设置，关闭时立即暂停，开关不影响登录和文章业务。
function applyMusicSettings() {
    player.volume = settings.volume;
    if (!settings.enabled) {
        waitingForGesture = false;
        player.pause();
    } else {
        playMusic();
    }
    updateMusicControls();
}

// 快捷开关修改启用偏好，音轨失败时下一次点击明确重试。
function toggleMusic() {
    if (failed) {
        failed = false;
        settings.enabled = true;
        player.load();
    } else {
        settings.enabled = !settings.enabled;
    }
    saveMusicSettings();
    applyMusicSettings();
}

// 设置中的音乐开关和导航快捷开关共用同一份偏好。
function changeMusicEnabled() {
    settings.enabled = enabledControl.checked;
    if (settings.enabled && failed) {
        failed = false;
        player.load();
    }
    saveMusicSettings();
    applyMusicSettings();
}

// 拖动音量时实时应用，松开后再保存，避免每一帧都写本机存储。
function previewMusicVolume() {
    settings.volume = Number(volumeControl.value) / VOLUME_MAX;
    applyMusicSettings();
}

// 保存滑块最终位置，键盘调节也使用同一流程。
function saveMusicVolume() {
    previewMusicVolume();
    saveMusicSettings();
}

// 自动播放被浏览器阻止后，在首次真实点击或键盘操作中重试。
function resumeFromGesture(event) {
    if (!event.isTrusted || !waitingForGesture || !settings.enabled || shortcut.contains(event.target) || event.target === enabledControl) {
        return;
    }
    playMusic();
}

// 同一标签页跨页面保留播放进度，存储不可用不影响播放。
function saveMusicPosition() {
    if (!Number.isFinite(player.currentTime)) {
        return;
    }
    try {
        sessionStorage.setItem(MUSIC_POSITION_KEY, String(player.currentTime));
    } catch {
        // 无法保存进度时，下页从头播放。
    }
}

// 合并高频进度事件，每隔配置的时间再记录一次。
function recordMusicPosition() {
    updateMusicProgress();
    const now = Date.now();
    if (now - lastPositionSave >= MUSIC_POSITION_SAVE_MS) {
        lastPositionSave = now;
        saveMusicPosition();
    }
}

// 音轨元数据就绪后恢复进度，防止使用超出时长的旧记录。
function restoreMusicPosition() {
    try {
        const position = Number(sessionStorage.getItem(MUSIC_POSITION_KEY));
        if (Number.isFinite(position) && position > 0 && position < player.duration) {
            player.currentTime = position;
        }
    } catch {
        // 浏览器不允许跳转时保持当前播放位置。
    }
    updateMusicProgress();
}

// 离开页面时保存进度并暂停，防止浏览器缓存旧页后继续播放。
function suspendMusic() {
    saveMusicPosition();
    suspended = true;
    player.pause();
}

// 从页面缓存返回时按现有开关恢复，而非保留离开时的暂停状态。
function restoreMusicPage() {
    suspended = false;
    settings = readMusicSettings();
    applyMusicSettings();
}

// 其他标签页改变偏好时同步音量及开关，不同步各页播放进度。
function syncMusicStorage(event) {
    if (event.key === MUSIC_STORAGE_KEY || event.key === null) {
        settings = readMusicSettings();
        applyMusicSettings();
    }
}

// 资源损坏时不循环重试，保留一个明确的重试入口。
function reportMusicError() {
    if (!failed) {
        showToast("背景音乐暂时无法播放，可点击音符重试", true);
    }
    failed = true;
    waitingForGesture = false;
    updateMusicProgress();
    updateMusicControls();
}

// 在 tools 导航区和 addSection 设置入口中注册音乐，登录页不创建播放器或请求音轨。
export function initializeMusic(tools, addSection) {
    if (initialized || document.body.dataset.mode === "login") {
        return;
    }
    initialized = true;
    shortcut.id = "music-toggle";
    shortcut.type = "button";
    shortcut.className = "music-toggle";
    shortcut.addEventListener("click", toggleMusic);
    tools.insertBefore(shortcut, tools.querySelector(".site-settings-button"));

    const controls = document.createElement("div");
    const enabledLabel = document.createElement("label");
    enabledLabel.className = "site-setting-row";
    enabledControl.id = "music-enabled";
    enabledControl.type = "checkbox";
    enabledControl.setAttribute("role", "switch");
    enabledControl.addEventListener("change", changeMusicEnabled);
    enabledLabel.append(document.createTextNode("背景音乐"), enabledControl);
    const volumeLabel = document.createElement("label");
    volumeLabel.className = "music-volume-label";
    volumeLabel.htmlFor = "music-volume";
    volumeValue.setAttribute("for", "music-volume");
    volumeLabel.append(document.createTextNode("音量"), volumeValue);
    volumeControl.id = "music-volume";
    volumeControl.type = "range";
    volumeControl.min = "0";
    volumeControl.max = String(VOLUME_MAX);
    volumeControl.step = "1";
    volumeControl.addEventListener("input", previewMusicVolume);
    volumeControl.addEventListener("change", saveMusicVolume);
    const progressLabel = document.createElement("label");
    progressLabel.className = "music-volume-label";
    progressLabel.htmlFor = "music-progress";
    progressValue.setAttribute("for", "music-progress");
    progressLabel.append(document.createTextNode("播放进度"), progressValue);
    progressControl.id = "music-progress";
    progressControl.type = "range";
    progressControl.min = "0";
    progressControl.max = "0";
    progressControl.step = "0.1";
    progressControl.value = "0";
    progressControl.disabled = true;
    progressControl.addEventListener("input", previewMusicProgress);
    progressControl.addEventListener("change", seekMusicProgress);
    progressControl.addEventListener("blur", seekMusicProgress);
    progressControl.addEventListener("pointercancel", cancelMusicProgress);
    controls.append(enabledLabel, volumeLabel, volumeControl, progressLabel, progressControl);
    addSection("音乐", controls);

    player.id = "background-music";
    player.hidden = true;
    player.loop = true;
    player.preload = "metadata";
    player.src = MUSIC_SOURCE;
    player.addEventListener("loadedmetadata", restoreMusicPosition);
    player.addEventListener("durationchange", updateMusicProgress);
    player.addEventListener("emptied", cancelMusicProgress);
    player.addEventListener("seeked", updateMusicProgress);
    player.addEventListener("timeupdate", recordMusicPosition);
    player.addEventListener("playing", updateMusicControls);
    player.addEventListener("pause", updateMusicControls);
    player.addEventListener("error", reportMusicError);
    document.body.appendChild(player);
    document.addEventListener("click", resumeFromGesture);
    document.addEventListener("keydown", resumeFromGesture);
    window.addEventListener("storage", syncMusicStorage);
    window.addEventListener("pagehide", suspendMusic);
    window.addEventListener("pageshow", restoreMusicPage);
    applyMusicSettings();
    updateMusicProgress();
}
