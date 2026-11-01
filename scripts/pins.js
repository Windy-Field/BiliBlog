import { requestApi } from "./api.js";
import { readSession, clearSession } from "./auth.js";
import { showToast, setBusy } from "./common.js";
import { makeIcon } from "./icons.js";
import { MAX_PINNED_NOTES } from "./config.js";

let writing = false;

// 再次核对凭证，防止确认身份或置顶过程中切换到另一个账号
function checkSession(token) {
    const session = readSession();
    if (!session || session.token !== token) {
        throw new Error("登录账号已变化，请刷新后再操作");
    }
}

// 同页所有置顶按钮共享等待状态，避免同时把不同文章置顶而越过数量检查
function updateButtons() {
    for (const button of document.querySelectorAll("[data-pin-note]")) {
        button.disabled = writing;
    }
}

// 根据真实 pinnedAt 创建置顶角标，不改变文章顺序
export function makePinBadge(note) {
    const badge = document.createElement("span");
    badge.className = "pin-badge";
    badge.append(makeIcon("pin"), document.createTextNode("置顶"));
    badge.hidden = !note.pinnedAt;
    return badge;
}

// 创建本人文章的置顶按钮，成功或状态核对后调用 onChanged 重新读取所在列表
export function makePinButton(note, onChanged) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pin-button";
    button.dataset.pinNote = note.id;
    button.disabled = writing;
    let label = "置顶";
    if (note.pinnedAt) {
        label = "取消置顶";
    }
    button.append(makeIcon("pin"), document.createTextNode(label));
    button.setAttribute("aria-label", label + "：" + note.title);
    button.setAttribute("aria-pressed", String(Boolean(note.pinnedAt)));
    // 先从服务器查全局置顶数，再设置明确的目标状态，不能只数当前页的卡片
    button.addEventListener("click", async function changePin() {
        if (writing) {
            return;
        }
        const session = readSession();
        if (!session) {
            showToast("请登录后刷新本人文章列表", true);
            return;
        }
        writing = true;
        updateButtons();
        setBusy(button, true);
        let sent = false;
        // 同一浏览器的标签页共用账号锁，两个页面同时点击时也按顺序核对数量
        async function performPin() {
            const user = await requestApi("/me", "GET", null, session.token);
            checkSession(session.token);
            if (user.username !== note.author.username) {
                throw new Error("只能置顶本人文章，请刷新当前账号的列表");
            }
            const profile = await requestApi("/users/" + encodeURIComponent(user.username), "GET", null, session.token);
            checkSession(session.token);
            const pinned = profile.pinnedNoteIds.includes(note.id);
            if (pinned !== Boolean(note.pinnedAt)) {
                onChanged();
                throw new Error("置顶状态已变化，已重新读取，请核对后再操作");
            }
            if (!pinned && profile.pinnedNoteIds.length >= MAX_PINNED_NOTES) {
                throw new Error("最多置顶 " + MAX_PINNED_NOTES + " 篇文章，请先取消一篇置顶");
            }
            sent = true;
            await requestApi("/notes/" + encodeURIComponent(note.id) + "/pin", "POST", { active: !pinned }, session.token);
            checkSession(session.token);
            onChanged();
            let message = "文章已置顶";
            if (pinned) {
                message = "已取消置顶";
            }
            showToast(message);
        }
        try {
            if (navigator.locks) {
                await navigator.locks.request("BiliBlog-pin-" + note.author.username, performPin);
            } else {
                await performPin();
            }
        } catch (error) {
            const current = readSession();
            if (current && current.token === session.token) {
                if (error.status === 401) {
                    clearSession();
                }
                if (sent && error.uncertain) {
                    // 不能直接重发置顶请求，重读文章状态让用户核对实际结果
                    onChanged();
                    showToast("置顶结果待核对，已重新读取列表，请确认后再操作", true);
                } else {
                    showToast(error.message, true);
                }
            } else {
                onChanged();
                showToast("登录状态已变化，请刷新后再操作", true);
            }
        } finally {
            writing = false;
            setBusy(button, false);
            updateButtons();
        }
    });
    return button;
}
