/**
 * BetterEmail V2
 * Extension Popup Controller
 */

const API_URL = (typeof BE_CONFIG !== 'undefined' ? BE_CONFIG.API_URL : "http://localhost:3000") + "/analyze-email";

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

        item.querySelector(".ri-open-btn").addEventListener("click", () => {
            chrome.tabs.create({ url: "https://mail.google.com" });
        });

        item.querySelector(".ri-dismiss-btn").addEventListener("click", () => {
            dismissReminder(r.id);
            item.classList.add("ri-removing");
            setTimeout(() => {
                item.remove();
                const remaining = list.querySelectorAll(".reminder-item").length;
                if (remaining === 0) showEmptyState(list, badge);
                else badge.textContent = remaining;
            }, 250);
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

    if (session && session.access_token) {
        // Signed in
        if (authCard) authCard.style.display = "none";
        if (mainContent) mainContent.style.display = "flex";
        if (userBar) userBar.style.display = "flex";
        if (userEmail && session.user) {
            userEmail.textContent = session.user.email || "";
        }
    } else {
        // Signed out — hide everything except auth card
        if (authCard) authCard.style.display = "flex";
        if (mainContent) mainContent.style.display = "none";
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
