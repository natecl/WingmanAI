/**
 * BetterEmail V2
 * Extension Popup Controller
 */

const API_BASE = typeof BE_CONFIG !== 'undefined' ? BE_CONFIG.API_URL : "http://localhost:3000";
const API_URL = API_BASE + "/analyze-email";

const GMAIL_THREAD_ID_RE = /^[A-Za-z0-9_\-]{8,}$/;

function reminderUrl(reminder) {
    if (reminder?.threadPath) return `https://mail.google.com/mail/u/0/#${reminder.threadPath}`;
    // Only use threadId if it's a URL-navigable ID — not internal "thread-f:..." format
    if (reminder?.threadId && GMAIL_THREAD_ID_RE.test(reminder.threadId)) {
        return `https://mail.google.com/mail/u/0/#inbox/${reminder.threadId}`;
    }
    if (reminder?.subject) {
        // Gmail hash search format: + for spaces, %22 for quotes
        const clean = reminder.subject.replace(/"/g, "'");
        const encoded = `in:sent+subject:%22${clean.replace(/ /g, '+')}%22`;
        return `https://mail.google.com/mail/u/0/#search/${encoded}`;
    }
    return "https://mail.google.com/mail/u/0/#sent";
}

/* =====================================================
   DOM REFERENCES
===================================================== */

const form = document.getElementById("analyze-form");
const emailInput = document.getElementById("email-input");
const contextInput = document.getElementById("context-input");
const analyzeBtn = document.getElementById("analyze-btn");
const resultsContainer = document.getElementById("results-container");


/* =====================================================
   UI HELPERS
===================================================== */

function escapeHTML(str) {
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function setLoading(isLoading) {
    analyzeBtn.disabled = isLoading;
    analyzeBtn.textContent = isLoading ? "Analyzing..." : "Analyze";
}

function showError(message) {
    resultsContainer.innerHTML = `
        <div class="error-card">
            <span class="error-text">${escapeHTML(message)}</span>
        </div>
    `;
}

function showLoadingIndicator() {
    resultsContainer.innerHTML = `
        <div class="loading-indicator">
            <div class="loading-dots">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
            </div>
            <span>Analyzing your email...</span>
        </div>
    `;
}

function renderSections(sections) {
    resultsContainer.innerHTML = "";

    sections.forEach(section => {
        const card = document.createElement("div");
        card.className = "section-card";

        card.innerHTML = `
            <div class="section-card-header">
                <span class="section-icon">${escapeHTML(section.icon)}</span>
                <span class="section-title">${escapeHTML(section.title)}</span>
            </div>
            <div class="section-content">${escapeHTML(section.content)}</div>
        `;

        resultsContainer.appendChild(card);
    });
}

function renderRawText(text) {
    resultsContainer.innerHTML = `
        <div class="raw-card">${escapeHTML(text)}</div>
    `;
}


/* =====================================================
   RESPONSE PARSING
===================================================== */

function cleanModelOutput(raw) {
    let text = raw.trim();

    if (text.startsWith("```")) {
        text = text
            .replace(/^```(?:json)?\s*/, "")
            .replace(/\s*```$/, "");
    }

    return text;
}

function tryParseSections(raw) {
    try {
        const cleaned = cleanModelOutput(raw);
        const parsed = JSON.parse(cleaned);

        if (Array.isArray(parsed) && parsed.length && parsed[0].title) {
            return parsed;
        }

        return null;
    } catch {
        return null;
    }
}


/* =====================================================
   API CALL
===================================================== */

async function analyzeEmail(email, context) {
    const token = typeof getAccessToken === 'function' ? await getAccessToken() : null;

    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ email, context })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Analysis failed");
    }

    return data.response;
}


/* =====================================================
   FOLLOW-UP REMINDERS
===================================================== */

function formatDueTime(dueTime) {
    const diff = dueTime - Date.now();
    if (diff <= 0) return { label: "Overdue", overdue: true };
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days >= 1) return { label: `In ${days} day${days > 1 ? "s" : ""}`, overdue: false };
    if (hrs >= 1) return { label: `In ${hrs} hr${hrs > 1 ? "s" : ""}`, overdue: false };
    return { label: `In ${mins} min${mins !== 1 ? "s" : ""}`, overdue: false };
}

function dismissReminder(id) {
    chrome.alarms.clear(id);
    chrome.storage.local.get("be_reminders", ({ be_reminders = [] }) => {
        chrome.storage.local.set({ be_reminders: be_reminders.filter(r => r.id !== id) });
    });
}

function showEmptyState(list, badge) {
    badge.style.display = "none";
    list.innerHTML = `
        <div class="ri-empty">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 12l2 2 4-4"/>
                <circle cx="12" cy="12" r="9"/>
            </svg>
            <span>No pending follow-ups — you're all caught up!</span>
        </div>
    `;
}

function renderReminders(reminders) {
    const list = document.getElementById("reminders-list");
    const badge = document.getElementById("reminders-badge");

    if (!reminders || reminders.length === 0) {
        showEmptyState(list, badge);
        return;
    }

    badge.style.display = "flex";
    badge.textContent = reminders.length;
    list.innerHTML = "";

    // Sort: fired first, then soonest first
    const sorted = [...reminders].sort((a, b) => {
        if (a.fired && !b.fired) return -1;
        if (!a.fired && b.fired) return 1;
        return a.dueTime - b.dueTime;
    });

    sorted.forEach(r => {
        const isFired = r.fired === true;
        const { label, overdue } = isFired ? { label: "Follow up now!", overdue: true } : formatDueTime(r.dueTime);

        const item = document.createElement("div");
        item.className = "reminder-item" + (isFired ? " ri-fired" : "");
        item.dataset.id = r.id;
        item.innerHTML = `
            <div class="ri-dot ${isFired ? "ri-dot-fired" : overdue ? "ri-dot-overdue" : ""}"></div>
            <div class="ri-info">
                <div class="ri-subject" title="${escapeHTML(r.subject)}">${escapeHTML(r.subject)}</div>
                <div class="ri-due ${isFired ? "ri-due-fired" : overdue ? "ri-due-overdue" : ""}">${label}</div>
            </div>
            <div class="ri-actions">
                <button class="ri-open-btn" title="Open Gmail">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                </button>
                <button class="ri-dismiss-btn" title="Mark as done">&#x2715;</button>
            </div>
        `;

        item.querySelector(".ri-open-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            chrome.tabs.create({ url: reminderUrl(r) });
        });

        item.querySelector(".ri-dismiss-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            dismissReminder(r.id);
            item.classList.add("ri-removing");
            setTimeout(() => {
                item.remove();
                const remaining = list.querySelectorAll(".reminder-item").length;
                if (remaining === 0) showEmptyState(list, badge);
                else badge.textContent = remaining;
            }, 250);
        });

        // Click anywhere on the row (except buttons) to open the thread
        item.style.cursor = 'pointer';
        item.addEventListener("click", (e) => {
            if (e.target.closest(".ri-open-btn") || e.target.closest(".ri-dismiss-btn")) return;
            chrome.tabs.create({ url: reminderUrl(r) });
        });

        list.appendChild(item);
    });
}

// Load reminders whenever popup opens
chrome.storage.local.get("be_reminders", ({ be_reminders = [] }) => {
    renderReminders(be_reminders);
});


/* =====================================================
   AUTHENTICATION UI
===================================================== */

async function initAuthUI() {
    const authCard = document.getElementById("be-auth-card");
    const userBar = document.getElementById("be-user-bar");
    const userEmail = document.getElementById("be-user-email");
    const mainContent = document.querySelector(".main-content");

    // Check if auth.js loaded (BE_CONFIG and getSession exist)
    if (typeof getSession !== 'function') {
        // auth.js not loaded — show main content, hide auth card
        if (authCard) authCard.style.display = "none";
        if (mainContent) mainContent.style.display = "flex";
        return;
    }

    const session = await getSession();

    const tabs = document.getElementById("be-tabs");

    if (session && session.access_token) {
        // Signed in
        if (authCard) authCard.style.display = "none";
        if (mainContent) mainContent.style.display = "flex";
        if (tabs) tabs.style.display = "flex";
        if (userBar) userBar.style.display = "flex";
        if (userEmail && session.user) {
            userEmail.textContent = session.user.email || "";
        }
        // Load saved resume into the settings tab
        loadResume(session.access_token);
    } else {
        // Signed out — hide everything except auth card
        if (authCard) authCard.style.display = "flex";
        if (mainContent) mainContent.style.display = "none";
        if (tabs) tabs.style.display = "none";
        document.getElementById("be-tab-settings").style.display = "none";
        if (userBar) userBar.style.display = "none";
    }
}

// Sign-in handler
document.getElementById("be-signin-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("be-signin-btn");
    btn.disabled = true;
    btn.textContent = "Signing in...";

    try {
        await signInWithGoogle();
        await initAuthUI();
    } catch (err) {
        console.error("Sign-in failed:", err);
        btn.textContent = "Sign in with Google";
        btn.disabled = false;
        alert("Sign-in error: " + err.message);
    }
});

// Sign-out handler
document.getElementById("be-signout-btn")?.addEventListener("click", async () => {
    await signOut();
    await initAuthUI();
});

// Initialize auth UI on popup open
initAuthUI();


/* =====================================================
   TAB NAVIGATION
===================================================== */

document.querySelectorAll('.be-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.be-tab').forEach(t => t.classList.remove('be-tab-active'));
        document.getElementById('be-tab-main').style.display = 'none';
        document.getElementById('be-tab-settings').style.display = 'none';
        tab.classList.add('be-tab-active');
        document.getElementById(`be-tab-${tab.dataset.tab}`).style.display = 'flex';
    });
});


/* =====================================================
   RESUME LOAD / SAVE
===================================================== */

async function loadResume(token) {
    try {
        const res = await fetch(`${API_BASE}/user/resume`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            const indicator = document.getElementById('be-resume-on-file');
            const summary = document.getElementById('be-resume-summary');
            const summaryText = document.getElementById('be-summary-text');
            if (indicator) indicator.style.display = data.resume_text ? 'block' : 'none';
            if (data.resume_summary) {
                if (summaryText) summaryText.textContent = data.resume_summary;
                if (summary) summary.style.display = 'block';
            } else {
                if (summary) summary.style.display = 'none';
            }
        }
    } catch (err) {
        console.error('[BetterEmail] Failed to load resume:', err);
    }
}

/* ---- PDF upload UI wiring ---- */
const resumeFileInput = document.getElementById('be-resume-file');
const uploadZone = document.getElementById('be-upload-zone');
const fileChosen = document.getElementById('be-file-chosen');
const fileNameDisplay = document.getElementById('be-file-name-display');
const fileRemove = document.getElementById('be-file-remove');
const resumeSave = document.getElementById('be-resume-save');
const resumeStatus = document.getElementById('be-resume-status');

document.getElementById('be-upload-browse')?.addEventListener('click', (e) => {
    e.stopPropagation();
    resumeFileInput?.click();
});
uploadZone?.addEventListener('click', () => resumeFileInput?.click());
uploadZone?.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('be-upload-drag'); });
uploadZone?.addEventListener('dragleave', () => uploadZone.classList.remove('be-upload-drag'));
uploadZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('be-upload-drag');
    const file = e.dataTransfer?.files?.[0];
    if (file) setChosenFile(file);
});
resumeFileInput?.addEventListener('change', () => {
    const file = resumeFileInput.files?.[0];
    if (file) setChosenFile(file);
});

function setChosenFile(file) {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        if (resumeStatus) {
            resumeStatus.textContent = 'Please select a PDF file.';
            resumeStatus.className = 'be-status-msg be-status-err';
        }
        return;
    }
    if (fileNameDisplay) fileNameDisplay.textContent = file.name;
    if (uploadZone) uploadZone.style.display = 'none';
    if (fileChosen) fileChosen.style.display = 'flex';
    if (resumeSave) resumeSave.disabled = false;
    if (resumeStatus) { resumeStatus.textContent = ''; resumeStatus.className = 'be-status-msg'; }
}

fileRemove?.addEventListener('click', () => {
    if (resumeFileInput) resumeFileInput.value = '';
    if (uploadZone) uploadZone.style.display = 'flex';
    if (fileChosen) fileChosen.style.display = 'none';
    if (resumeSave) resumeSave.disabled = true;
    if (resumeStatus) { resumeStatus.textContent = ''; resumeStatus.className = 'be-status-msg'; }
});

resumeSave?.addEventListener('click', async () => {
    const file = resumeFileInput?.files?.[0];
    if (!file) return;

    if (resumeStatus) { resumeStatus.textContent = 'Uploading...'; resumeStatus.className = 'be-status-msg'; }
    if (resumeSave) resumeSave.disabled = true;

    try {
        const token = typeof getAccessToken === 'function' ? await getAccessToken() : null;
        if (!token) {
            if (resumeStatus) { resumeStatus.textContent = 'Not signed in.'; resumeStatus.className = 'be-status-msg be-status-err'; }
            if (resumeSave) resumeSave.disabled = false;
            return;
        }
        const formData = new FormData();
        formData.append('resume', file);

        const res = await fetch(`${API_BASE}/user/resume/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();
        if (res.ok) {
            if (resumeStatus) {
                resumeStatus.textContent = data.summary
                    ? `Resume uploaded! AI summary generated. (${data.characters.toLocaleString()} chars)`
                    : `Resume saved (${data.characters.toLocaleString()} chars). AI summary unavailable — check server logs.`;
                resumeStatus.className = 'be-status-msg be-status-ok';
            }
            // Refresh the summary panel with the newly stored text
            const uploadToken = typeof getAccessToken === 'function' ? await getAccessToken() : token;
            if (uploadToken) await loadResume(uploadToken);
        } else {
            if (resumeStatus) { resumeStatus.textContent = data.error || 'Upload failed.'; resumeStatus.className = 'be-status-msg be-status-err'; }
        }
    } catch (err) {
        if (resumeStatus) { resumeStatus.textContent = 'Could not reach server.'; resumeStatus.className = 'be-status-msg be-status-err'; }
    }
    if (resumeSave) resumeSave.disabled = false;
});


/* =====================================================
   FORM SUBMIT HANDLER
===================================================== */

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const context = contextInput.value.trim();

    if (!email || !context) {
        showError("Please provide both an email and context.");
        return;
    }

    setLoading(true);
    showLoadingIndicator();

    try {

        const raw = await analyzeEmail(email, context);
        const sections = tryParseSections(raw);

        if (sections) {
            renderSections(sections);
        } else {
            renderRawText(raw);
        }

    } catch (err) {
        showError(
            err.message ||
            "Could not connect to server. Make sure BetterEmail backend is running."
        );
    }

    setLoading(false);
});
