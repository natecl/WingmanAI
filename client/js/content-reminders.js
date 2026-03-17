/**
 * Wingman V2 — Reminders, Scheduling, Send Classification & AI Helpers
 */

const GMAIL_THREAD_ID_RE = /^[A-Za-z0-9_\-]{8,}$/;


/* =========================================================
   REMINDERS (sidebar)
========================================================= */

function wireReminders() {
    // Load reminders on init
    chrome.storage.local.get("wm_reminders", ({ wm_reminders = [] }) => {
        renderSidebarReminders(wm_reminders);
    });

    // Re-render whenever storage changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.wm_reminders) {
            renderSidebarReminders(changes.wm_reminders.newValue || []);
        }
    });
}

function formatReminderTime(dueTime) {
    const diff = dueTime - Date.now();
    if (diff <= 0) return { label: "Overdue", overdue: true };
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days >= 1) return { label: `In ${days} day${days > 1 ? "s" : ""}`, overdue: false };
    if (hrs >= 1) return { label: `In ${hrs} hr${hrs > 1 ? "s" : ""}`, overdue: false };
    return { label: `In ${mins} min${mins !== 1 ? "s" : ""}`, overdue: false };
}

function renderSidebarReminders(reminders) {
    const list = document.getElementById("wm-sidebar-reminders-list");
    const badge = document.getElementById("wm-sidebar-reminders-badge");
    if (!list || !badge) return;

    if (!reminders || reminders.length === 0) {
        badge.style.display = "none";
        list.innerHTML = `
            <div class="wm-sidebar-ri-empty">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>
                </svg>
                <span>No pending follow-ups — you're all caught up!</span>
            </div>
        `;
        return;
    }

    badge.style.display = "flex";
    badge.textContent = reminders.length;
    list.innerHTML = "";

    const sorted = [...reminders].sort((a, b) => {
        if (a.fired && !b.fired) return -1;
        if (!a.fired && b.fired) return 1;
        return a.dueTime - b.dueTime;
    });

    // Kick off background summary generation for any reminder that doesn't have one yet
    sorted.filter(r => !r.summary).forEach(r => generateAndStoreSummary(r));

    sorted.forEach(r => {
        const isFired = r.fired === true;
        const { label, overdue } = isFired ? { label: "Follow up now!", overdue: true } : formatReminderTime(r.dueTime);

        // Description line below subject: AI summary or "Summarizing…" placeholder
        const descriptionLine = r.summary
            ? `<div class="wm-sidebar-ri-subject-line">${escapeHTML(r.summary)}</div>`
            : `<div class="wm-sidebar-ri-generating">Summarizing…</div>`;

        const item = document.createElement("div");
        item.className = "wm-sidebar-reminder-item" + (isFired ? " wm-ri-fired" : "");
        item.innerHTML = `
            <div class="wm-sidebar-ri-dot ${isFired ? "wm-ri-dot-fired" : ""}"></div>
            <div class="wm-sidebar-ri-info">
                <div class="wm-sidebar-ri-subject" title="${escapeHTML(r.subject)}">${escapeHTML(r.subject)}</div>
                ${descriptionLine}
                <div class="wm-sidebar-ri-due ${isFired ? "wm-ri-due-fired" : ""}">${label}</div>
            </div>
            <button class="wm-sidebar-ri-dismiss" title="Dismiss">&#x2715;</button>
        `;

        item.querySelector(".wm-sidebar-ri-dismiss").addEventListener("click", e => {
            e.stopPropagation();
            chrome.runtime.sendMessage({ type: "CLEAR_ALARM", id: r.id });
            chrome.storage.local.get("wm_reminders", ({ wm_reminders = [] }) => {
                chrome.storage.local.set({ wm_reminders: wm_reminders.filter(rem => rem.id !== r.id) });
            });
            item.classList.add("wm-ri-removing");
            setTimeout(() => item.remove(), 250);
        });

        // Click on item opens the thread
        item.style.cursor = 'pointer';
        item.addEventListener("click", e => {
            if (e.target.closest(".wm-sidebar-ri-dismiss")) return;
            const url = contentReminderUrl(r);
            chrome.runtime.sendMessage({ type: "OPEN_TAB", url });
        });

        // Hover: fetch and show reply timing tooltip if we have a recipient
        if (r.toEmail) {
            let timingTooltip = null;
            let timingData = null;

            item.addEventListener("mouseenter", async () => {
                if (!timingData) {
                    timingData = await _fetchReplyTiming(r.toEmail);
                }
                if (!timingData?.tip || !document.contains(item)) return;

                // Remove any existing tooltip
                item.querySelector('.wm-ri-timing-tooltip')?.remove();

                timingTooltip = document.createElement('div');
                timingTooltip.className = 'wm-ri-timing-tooltip';
                timingTooltip.innerHTML = `
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                    ${_renderTimingTip(timingData)}
                `;
                item.appendChild(timingTooltip);
            });

            item.addEventListener("mouseleave", () => {
                item.querySelector('.wm-ri-timing-tooltip')?.remove();
                timingTooltip = null;
            });
        }

        list.appendChild(item);
    });
}


/* =========================================================
   REMINDER PROMPT UI (toast after sending)
========================================================= */

async function showReminderPrompt(subject, pendingThread = {}, bodySnippet = "", toEmail = null) {
    if (!(await isAuthenticated())) return;

    document.querySelector(".wm-reminder-toast")?.remove();

    const toast = document.createElement("div");
    toast.className = "wm-reminder-toast";
    toast.innerHTML = `
        <div class="wm-reminder-header">
            <div class="wm-reminder-title">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                Follow-up Reminder
            </div>
            <button class="wm-reminder-close" aria-label="Dismiss">&#x2715;</button>
        </div>
        <div class="wm-reminder-body">
            No reply to <strong>${escapeHTML(subject)}</strong>? Remind me in:
        </div>
        <div class="wm-reminder-timing-chip" style="display:none"></div>
        <div class="wm-reminder-options">
            <button class="wm-reminder-btn" data-ms="${1 * 24 * 60 * 60 * 1000}" data-label="1 day">1 Day</button>
            <button class="wm-reminder-btn" data-ms="${3 * 24 * 60 * 60 * 1000}" data-label="3 days">3 Days</button>
            <button class="wm-reminder-btn" data-ms="${7 * 24 * 60 * 60 * 1000}" data-label="1 week">1 Week</button>
            <button class="wm-reminder-btn wm-reminder-custom-trigger">Custom</button>
            <button class="wm-reminder-btn wm-reminder-skip" data-dismiss>Skip</button>
        </div>
    `;

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));

    const autoDismiss = setTimeout(() => dismissToast(toast), 15000);
    toast.dataset.autoDismiss = autoDismiss;

    toast.querySelector(".wm-reminder-close").addEventListener("click", () => dismissToast(toast));
    attachQuickOptionListeners(toast, subject, pendingThread, bodySnippet, toEmail);

    // Async: fetch reply timing and inject chip with "Suggested" button
    if (toEmail) {
        _fetchReplyTiming(toEmail).then(data => {
            if (!data?.tip || !document.contains(toast)) return;
            const chip = toast.querySelector(".wm-reminder-timing-chip");
            if (!chip) return;

            const suggestedMs = _msUntilHour(data.peakHour);
            const suggestedLabel = _formatSuggestedLabel(data.peakHour);

            chip.innerHTML = `
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span class="wm-timing-chip-text">${_renderTimingTip(data)}</span>
                <button class="wm-timing-suggest-btn">Remind at ${escapeHTML(suggestedLabel)}</button>
            `;
            chip.style.display = "flex";

            chip.querySelector(".wm-timing-suggest-btn").addEventListener("click", () => {
                generateSummaryAndSchedule(subject, bodySnippet, suggestedMs, pendingThread.id, pendingThread.path, toEmail);
                showReminderConfirm(toast, suggestedLabel);
            });
        });
    }
}

/**
 * Calculate ms from now until the next occurrence of a given hour (0-23).
 * If the hour has already passed today, schedules for tomorrow.
 */
function _msUntilHour(hour) {
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
}

/**
 * Human-readable label for the suggested reminder time.
 * e.g. "9 AM today" or "9 AM tomorrow"
 */
function _formatSuggestedLabel(hour) {
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, 0, 0, 0);
    const isToday = target > now;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    return `${h} ${ampm} ${isToday ? 'today' : 'tomorrow'}`;
}

function attachQuickOptionListeners(toast, subject, pendingThread = {}, bodySnippet = "", toEmail = null) {
    toast.querySelector("[data-dismiss]").addEventListener("click", () => dismissToast(toast));

    toast.querySelectorAll("[data-ms]").forEach(btn => {
        btn.addEventListener("click", () => {
            generateSummaryAndSchedule(subject, bodySnippet, parseInt(btn.dataset.ms), pendingThread.id, pendingThread.path, toEmail);
            showReminderConfirm(toast, btn.dataset.label);
        });
    });

    toast.querySelector(".wm-reminder-custom-trigger").addEventListener("click", () => {
        showCustomInput(toast, subject, pendingThread, bodySnippet, toEmail);
    });
}

function showCustomInput(toast, subject, pendingThread = {}, bodySnippet = "", toEmail = null) {
    const options = toast.querySelector(".wm-reminder-options");
    options.innerHTML = `
        <div class="wm-reminder-custom">
            <input type="number" class="wm-custom-num" min="1" max="9999" value="2" placeholder="2">
            <select class="wm-custom-unit">
                <option value="min">Minutes</option>
                <option value="hr">Hours</option>
                <option value="day" selected>Days</option>
            </select>
            <button class="wm-reminder-btn wm-custom-set">Set</button>
        </div>
        <button class="wm-reminder-btn wm-reminder-skip wm-custom-back">&#8592; Back</button>
    `;

    const numInput = toast.querySelector(".wm-custom-num");
    const unitSelect = toast.querySelector(".wm-custom-unit");

    [numInput, unitSelect].forEach(el => {
        el.addEventListener("keydown", e => e.stopPropagation());
        el.addEventListener("keyup", e => e.stopPropagation());
        el.addEventListener("keypress", e => e.stopPropagation());
    });

    toast.querySelector(".wm-custom-set").addEventListener("click", () => {
        const val = parseInt(numInput.value);
        const unit = unitSelect.value;
        if (!val || val < 1) {
            numInput.classList.add("wm-custom-num-error");
            numInput.focus();
            return;
        }
        const multipliers = { min: 60 * 1000, hr: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000 };
        const unitNames = { min: "minute", hr: "hour", day: "day" };
        const ms = val * multipliers[unit];
        const label = `${val} ${unitNames[unit]}${val !== 1 ? "s" : ""}`;
        generateSummaryAndSchedule(subject, bodySnippet, ms, pendingThread.id, pendingThread.path, toEmail);
        showReminderConfirm(toast, label);
    });

    numInput.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Enter") toast.querySelector(".wm-custom-set").click();
    });

    toast.querySelector(".wm-custom-back").addEventListener("click", () => {
        options.innerHTML = `
            <button class="wm-reminder-btn" data-ms="${1 * 24 * 60 * 60 * 1000}" data-label="1 day">1 Day</button>
            <button class="wm-reminder-btn" data-ms="${3 * 24 * 60 * 60 * 1000}" data-label="3 days">3 Days</button>
            <button class="wm-reminder-btn" data-ms="${7 * 24 * 60 * 60 * 1000}" data-label="1 week">1 Week</button>
            <button class="wm-reminder-btn wm-reminder-custom-trigger">Custom</button>
            <button class="wm-reminder-btn wm-reminder-skip" data-dismiss>Skip</button>
        `;
        attachQuickOptionListeners(toast, subject, pendingThread, bodySnippet, toEmail);
    });

    numInput.focus();
    numInput.select();
}

function showReminderConfirm(toast, label) {
    clearTimeout(parseInt(toast.dataset.autoDismiss));
    toast.innerHTML = `
        <div class="wm-reminder-confirm">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M20 6L9 17l-5-5"/>
            </svg>
            <span>Reminder set for ${label}!</span>
        </div>
    `;
    setTimeout(() => dismissToast(toast), 2500);
}

function dismissToast(toast) {
    clearTimeout(parseInt(toast.dataset.autoDismiss));
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
}


/* =========================================================
   REMINDER SCHEDULING & THREAD UTILITIES
========================================================= */

function scheduleReminder(subject, ms, capturedThreadId = null, capturedThreadPath = null, summary = null, toEmail = null) {
    const id = "wm_reminder_" + Date.now();
    const dueTime = Date.now() + ms;
    const threadId = capturedThreadId || getCurrentThreadId();
    const threadPath = capturedThreadPath || getCurrentThreadPath();
    try {
        chrome.runtime.sendMessage({ type: "SET_REMINDER", id, subject, summary, dueTime, threadId, threadPath, toEmail });
    } catch (e) {
        console.warn("[Wingman] Extension context invalidated — please refresh the page.", e);
    }
}

function getCurrentThreadId() {
    const hash = window.location.hash.replace('#', '');
    const parts = hash.split('/');
    if (parts.length >= 2) {
        const folder = parts[0].toLowerCase();
        const MAIL_FOLDERS = new Set(['inbox', 'sent', 'trash', 'spam', 'all', 'starred',
            'imp', 'scheduled', 'snoozed', 'chats', 'drafts']);
        const threadPart = parts[1].split('?')[0];
        if (MAIL_FOLDERS.has(folder) && GMAIL_THREAD_ID_RE.test(threadPart)) {
            return threadPart;
        }
        if (parts.length >= 3) {
            const threadPart3 = parts[2].split('?')[0];
            if (GMAIL_THREAD_ID_RE.test(threadPart3)) {
                return threadPart3;
            }
        }
    }
    return null;
}

function contentReminderUrl(reminder) {
    if (reminder?.threadPath) return `https://mail.google.com/mail/u/0/#${reminder.threadPath}`;
    if (reminder?.threadId && GMAIL_THREAD_ID_RE.test(reminder.threadId)) {
        return `https://mail.google.com/mail/u/0/#inbox/${reminder.threadId}`;
    }
    if (reminder?.subject) {
        const clean = reminder.subject.replace(/"/g, "'");
        const encoded = `in:sent+subject:%22${clean.replace(/ /g, '+')}%22`;
        return `https://mail.google.com/mail/u/0/#search/${encoded}`;
    }
    return "https://mail.google.com/mail/u/0/#sent";
}

function getCurrentThreadPath() {
    const hash = window.location.hash.replace('#', '');
    const parts = hash.split('/');
    if (parts.length >= 2) {
        const folder = parts[0].toLowerCase();
        const MAIL_FOLDERS = new Set(['inbox', 'sent', 'trash', 'spam', 'all', 'starred',
            'imp', 'scheduled', 'snoozed', 'chats', 'drafts']);
        const threadPart = parts[1].split('?')[0];
        if (MAIL_FOLDERS.has(folder) && GMAIL_THREAD_ID_RE.test(threadPart)) {
            return `${folder}/${threadPart}`;
        }
        if (parts.length >= 3) {
            const threadPart3 = parts[2].split('?')[0];
            if (GMAIL_THREAD_ID_RE.test(threadPart3)) {
                return `${parts[0]}/${parts[1]}/${threadPart3}`;
            }
        }
    }
    return null;
}

function watchForSentThread(pendingThread) {
    let found = false;

    function tryLink(el) {
        if (found || !el) return;
        const href = el.getAttribute && (el.getAttribute('href') || '');
        const m = href.match(/(?:#)(sent|inbox|all)\/([A-Za-z0-9_\-]{8,})/);
        if (m) {
            pendingThread.path = `${m[1]}/${m[2]}`;
            pendingThread.id = m[2];
            found = true;
            cleanup();
        }
    }

    const observer = new MutationObserver((mutations) => {
        if (found) return;
        for (const mut of mutations) {
            for (const node of mut.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.tagName === 'A') tryLink(node);
                node.querySelectorAll('a[href]').forEach(tryLink);
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function onHashChange() {
        if (found) return;
        const path = getCurrentThreadPath();
        if (path) {
            pendingThread.path = path;
            pendingThread.id = path.split('/').pop();
            found = true;
            cleanup();
        }
    }
    window.addEventListener('hashchange', onHashChange);

    const timeout = setTimeout(() => cleanup(), 30000);

    function cleanup() {
        observer.disconnect();
        window.removeEventListener('hashchange', onHashChange);
        clearTimeout(timeout);
    }
}


/* =========================================================
   AI HELPERS — server calls for follow-up classification & summaries
========================================================= */

/**
 * Fetch reply timing data for a recipient email (GET /ai/reply-timing).
 * Returns the tip string or null on failure/no data.
 */
function _fetchReplyTiming(recipientEmail) {
    return new Promise((resolve) => {
        chrome.storage.local.get('wm_supabase_session', ({ wm_supabase_session }) => {
            const token = wm_supabase_session?.access_token;
            if (!token) { resolve(null); return; }
            const url = `https://wingman-lyart-seven.vercel.app/ai/reply-timing?recipientEmail=${encodeURIComponent(recipientEmail)}`;
            chrome.runtime.sendMessage({
                type: 'API_FETCH',
                url,
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            }, (response) => {
                resolve(response?.ok && response.data?.tip ? response.data : null);
            });
        });
    });
}

/** Convert a timing tip string with **bold** markdown into safe HTML. */
function _renderTimingTip(data) {
    if (!data?.tip) return '';
    return escapeHTML(data.tip).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * Call a server AI endpoint with the user's auth token.
 * Returns the parsed JSON response data, or null on failure.
 */
function wmServerAI(endpoint, body) {
    return new Promise((resolve) => {
        chrome.storage.local.get('wm_supabase_session', ({ wm_supabase_session }) => {
            const token = wm_supabase_session?.access_token;
            if (!token) { resolve(null); return; }
            chrome.runtime.sendMessage({
                type: 'API_FETCH',
                url: 'https://wingman-lyart-seven.vercel.app' + endpoint,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(body)
            }, (response) => {
                resolve(response?.ok ? response.data : null);
            });
        });
    });
}


/* =========================================================
   SEND CLASSIFICATION — follow-up detection & reminder management
========================================================= */

/**
 * Decide whether a sent email is a follow-up and act accordingly.
 *
 * Rules (evaluated in order, no blocking AI calls in the hot path):
 *  1. threadId matches a stored reminder → dismiss it, no prompt
 *  2. Subject starts with "Re:" → it's a reply, try subject-match dismiss, no prompt
 *  3. Everything else → show "Set a reminder?" prompt immediately
 */
function classifyAndHandleSend(subject, bodySnippet, currentThreadId, pendingThread, toEmail = null) {
    const subjectIsReply = /^re:/i.test(subject);

    // Dismiss the inbox summary item (by thread ID or subject fallback)
    if (typeof dismissInboxItem === 'function') {
        dismissInboxItem(currentThreadId, subject);
    }

    if (currentThreadId) {
        autoDismissReminderForThread(currentThreadId, (wasCleared) => {
            if (wasCleared) return; // Reminder dismissed — done

            if (subjectIsReply) {
                // Re: subject with a thread open — try subject-match as backup
                autoDismissReminderBySubjectMatch(subject);
                // No prompt for replies
            } else {
                // New email composed while a thread was open in the background.
                // The thread in the URL is unrelated — treat this as a new email.
                showReminderPrompt(subject || "your email", pendingThread, bodySnippet, toEmail);
            }
        });
    } else if (subjectIsReply) {
        // Re: email, no thread in the URL — try subject-match dismiss
        autoDismissReminderBySubjectMatch(subject);
        // No prompt for replies
    } else {
        // New outgoing email — show prompt immediately
        showReminderPrompt(subject || "your email", pendingThread, bodySnippet, toEmail);
    }
}

/**
 * Dismiss reminders whose subject (stripped of Re: prefixes) matches the sent email's subject.
 */
function autoDismissReminderBySubjectMatch(subject, callback) {
    const normalize = s => s.replace(/^(re:\s*)+/i, '').toLowerCase().trim();
    const cleanSubject = normalize(subject);
    if (!cleanSubject) { if (callback) callback(false); return; }

    chrome.storage.local.get("wm_reminders", ({ wm_reminders = [] }) => {
        const toRemove = wm_reminders.filter(r => normalize(r.subject) === cleanSubject);
        if (toRemove.length === 0) { if (callback) callback(false); return; }

        const updated = wm_reminders.filter(r => normalize(r.subject) !== cleanSubject);
        chrome.storage.local.set({ wm_reminders: updated });
        toRemove.forEach(r => {
            chrome.runtime.sendMessage({ type: "CLEAR_ALARM", id: r.id });
            if (r.fired) chrome.runtime.sendMessage({ type: "CLEAR_NOTIFICATION", id: r.id });
        });
        setTimeout(() => showFollowUpSentNotification(toRemove[0].subject), 300);
        if (callback) callback(true);
    });
}

/**
 * Generate an AI summary for an email, then schedule the reminder.
 * Falls back to the raw subject if the AI call fails or times out.
 */
async function generateSummaryAndSchedule(subject, bodySnippet, ms, threadId, threadPath, toEmail = null) {
    let summary = null;
    try {
        const r = await Promise.race([
            wmServerAI('/ai/summarize-email', { subject, body: bodySnippet }),
            new Promise(resolve => setTimeout(() => resolve(null), 4000))
        ]);
        summary = r?.summary || null;
    } catch (_) {}
    scheduleReminder(subject, ms, threadId, threadPath, summary, toEmail);
}

/**
 * Generate and persist an AI summary for an existing reminder that has none.
 * Writes back to storage → onChanged fires → sidebar re-renders with the summary.
 */
async function generateAndStoreSummary(reminder) {
    try {
        const r = await Promise.race([
            wmServerAI('/ai/summarize-email', { subject: reminder.subject, body: '' }),
            new Promise(resolve => setTimeout(() => resolve(null), 5000))
        ]);
        const summary = r?.summary || null;
        if (!summary || summary === reminder.subject) return; // Nothing useful

        chrome.storage.local.get("wm_reminders", ({ wm_reminders = [] }) => {
            const updated = wm_reminders.map(rem =>
                rem.id === reminder.id ? { ...rem, summary } : rem
            );
            chrome.storage.local.set({ wm_reminders: updated });
        });
    } catch (_) {}
}

function autoDismissReminderForThread(threadId, callback) {
    chrome.storage.local.get("wm_reminders", ({ wm_reminders = [] }) => {
        const toRemove = wm_reminders.filter(r => r.threadId === threadId);
        if (toRemove.length === 0) {
            if (callback) callback(false);
            return;
        }
        const updated = wm_reminders.filter(r => r.threadId !== threadId);
        chrome.storage.local.set({ wm_reminders: updated });
        toRemove.forEach(r => {
            // Cancel the scheduled alarm
            chrome.runtime.sendMessage({ type: "CLEAR_ALARM", id: r.id });
            // Also dismiss the OS notification if it was already shown (fired reminders)
            if (r.fired) {
                chrome.runtime.sendMessage({ type: "CLEAR_NOTIFICATION", id: r.id });
            }
        });
        // Show a brief "follow-up sent" confirmation toast
        setTimeout(() => showFollowUpSentNotification(toRemove[0].subject), 600);
        if (callback) callback(true);
    });
}

function showFollowUpSentNotification(subject) {
    document.querySelector(".wm-reminder-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "wm-reminder-toast";
    toast.innerHTML = `
        <div class="wm-reminder-confirm">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M20 6L9 17l-5-5"/>
            </svg>
            <span>Follow-up sent! Reminder for <strong>${escapeHTML(subject)}</strong> has been cleared.</span>
        </div>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    setTimeout(() => dismissToast(toast), 3500);
}
