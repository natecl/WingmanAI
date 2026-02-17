/**
 * BetterEmail V2
 * Gmail Compose Analyzer - Inline Content Script
 */

console.log("[BetterEmail] Content script loaded");

const SYSTEM_PROMPT = `You are an expert email analyzer. The user will provide an email they have written and the context/purpose of the email.
Analyze the email and respond with a JSON array. Each element must have:
- "title"
- "icon"
- "content"
Return exactly these 5 sections in order:
1. Grammar & Spelling
2. Tone & Formality
3. Clarity & Structure
4. Suggestions
5. Overall Verdict
Return ONLY the JSON array.`;


/* =========================================================
   INIT
========================================================= */

function init() {
    console.log("[BetterEmail] Initializing...");

    // Check every second for compose windows
    setInterval(scanForComposeWindows, 1000);

    // Also watch for DOM changes
    const observer = new MutationObserver(scanForComposeWindows);
    observer.observe(document.body, { childList: true, subtree: true });

    // Inject the persistent follow-up reminders panel into Gmail
    initRemindersPanel();
}

if (document.body) {
    init();
} else {
    document.addEventListener('DOMContentLoaded', init);
}


/* =========================================================
   SCAN FOR COMPOSE WINDOWS
========================================================= */

function scanForComposeWindows() {
    // Look for ALL contenteditable divs that could be email editors
    const editors = document.querySelectorAll(
        '[aria-label="Message Body"], ' +
        '[g_editable="true"], ' +
        'div.editable[contenteditable="true"], ' +
        'div[contenteditable="true"][role="textbox"]'
    );
    
    editors.forEach(editor => {
        // Find the compose container (go up to find the form/dialog)
        const composeBox = editor.closest('div[role="dialog"]') || 
                          editor.closest('.M9') ||
                          editor.closest('form') ||
                          editor.closest('.nH.Hd');
        
        if (composeBox && !composeBox.dataset.beAttached) {
            console.log("[BetterEmail] Found compose window, attaching analyzer");
            attachAnalyzer(composeBox, editor);
        }
    });
}


/* =========================================================
   FIND EDITOR IN COMPOSE BOX
========================================================= */

function findEditorInCompose(composeBox) {
    const selectors = [
        '[aria-label="Message Body"]',
        '[aria-label="Body"]',
        '[g_editable="true"]',
        'div.editable[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div.Am.Al.editable',
        'div.aoI[contenteditable="true"]',
        'div[contenteditable="true"]'
    ];
    
    // First try within the compose box
    for (const selector of selectors) {
        const editor = composeBox.querySelector(selector);
        if (editor) {
            console.log("[BetterEmail] Found editor in composeBox with selector:", selector);
            return editor;
        }
    }
    
    // If not found, search globally (for cases where DOM structure is different)
    console.log("[BetterEmail] Editor not found in composeBox, searching globally...");
    for (const selector of selectors) {
        const editors = document.querySelectorAll(selector);
        for (const editor of editors) {
            // Make sure it's visible and has size
            const rect = editor.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 50) {
                console.log("[BetterEmail] Found visible editor globally with selector:", selector);
                return editor;
            }
        }
    }
    
    console.log("[BetterEmail] No editor found anywhere");
    return null;
}

function getEditorContent(editor) {
    // Log what we're working with
    console.log("[BetterEmail] Getting content from editor:", editor);
    console.log("[BetterEmail] Editor innerHTML preview:", editor.innerHTML?.substring(0, 200));
    
    // Try multiple ways to get content
    let content = "";
    
    // Method 1: innerText
    content = editor.innerText?.trim() || "";
    console.log("[BetterEmail] innerText result length:", content.length);
    if (content) return content;
    
    // Method 2: textContent
    content = editor.textContent?.trim() || "";
    console.log("[BetterEmail] textContent result length:", content.length);
    if (content) return content;
    
    // Method 3: innerHTML stripped of tags
    const temp = document.createElement("div");
    temp.innerHTML = editor.innerHTML || "";
    content = temp.textContent?.trim() || "";
    console.log("[BetterEmail] innerHTML->textContent result length:", content.length);
    
    return content;
}

function findAnyVisibleEditor() {
    const selectors = [
        '[aria-label="Message Body"]',
        '[aria-label="Body"]',
        '[g_editable="true"]',
        'div.editable[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div.Am.Al.editable',
        'div.aoI[contenteditable="true"]'
    ];
    
    for (const selector of selectors) {
        const editors = document.querySelectorAll(selector);
        for (const editor of editors) {
            const rect = editor.getBoundingClientRect();
            // Must be visible and reasonably sized
            if (rect.width > 100 && rect.height > 30 && rect.top > 0) {
                const content = editor.innerText?.trim() || editor.textContent?.trim() || "";
                if (content.length > 0) {
                    console.log("[BetterEmail] Found visible editor with content globally");
                    return editor;
                }
            }
        }
    }
    return null;
}


/* =========================================================
   ATTACH ANALYZER
========================================================= */

function attachAnalyzer(composeBox, initialEditor) {
    composeBox.dataset.beAttached = "true";
    attachSendListener(composeBox);
    
    // Store editor reference
    let storedEditor = initialEditor;
    
    // Create the analyzer bar
    const analyzer = document.createElement("div");
    analyzer.className = "be-inline-analyzer";
    analyzer.innerHTML = `
        <div class="be-analyzer-bar">
            <div class="be-bar-left">
                <div class="be-logo">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                    </svg>
                    <span>BetterEmail</span>
                </div>
            </div>
            <div class="be-bar-center">
                <input type="text" class="be-context-input" placeholder="What's this email for? (e.g., job application, follow-up)">
            </div>
            <div class="be-bar-right">
                <button type="button" class="be-analyze-btn">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                    </svg>
                    <span>Analyze</span>
                </button>
            </div>
        </div>
        <div class="be-results-panel"></div>
    `;
    
    // Try to insert after the editor, or at the end of compose box
    const editorWrapper = initialEditor.closest('.Ar') || initialEditor.parentElement;
    if (editorWrapper && editorWrapper.parentElement) {
        editorWrapper.parentElement.insertBefore(analyzer, editorWrapper.nextSibling);
    } else {
        composeBox.appendChild(analyzer);
    }
    
    console.log("[BetterEmail] Analyzer bar injected");
    
    // Setup click handler
    const analyzeBtn = analyzer.querySelector(".be-analyze-btn");
    const contextInput = analyzer.querySelector(".be-context-input");
    const resultsPanel = analyzer.querySelector(".be-results-panel");
    
    // CRITICAL: Stop Gmail from capturing keyboard events on our input
    contextInput.addEventListener("keydown", (e) => e.stopPropagation());
    contextInput.addEventListener("keyup", (e) => e.stopPropagation());
    contextInput.addEventListener("keypress", (e) => e.stopPropagation());
    contextInput.addEventListener("focus", (e) => e.stopPropagation());
    contextInput.addEventListener("click", (e) => e.stopPropagation());
    
    analyzeBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Try stored editor first, then search for it
        let emailText = "";
        
        // Method 1: Use stored editor reference
        if (storedEditor && storedEditor.isConnected) {
            console.log("[BetterEmail] Using stored editor reference");
            emailText = getEditorContent(storedEditor);
        }
        
        // Method 2: Search within compose box
        if (!emailText) {
            console.log("[BetterEmail] Stored editor failed, searching in composeBox");
            const foundEditor = findEditorInCompose(composeBox);
            if (foundEditor) {
                storedEditor = foundEditor; // Update stored reference
                emailText = getEditorContent(foundEditor);
            }
        }
        
        // Method 3: Search globally for any visible editor
        if (!emailText) {
            console.log("[BetterEmail] Still no content, searching globally");
            const globalEditor = findAnyVisibleEditor();
            if (globalEditor) {
                storedEditor = globalEditor;
                emailText = getEditorContent(globalEditor);
            }
        }
        
        const context = contextInput.value.trim();
        
        console.log("[BetterEmail] Final email text length:", emailText.length);
        console.log("[BetterEmail] Context:", context);
        
        if (!emailText) {
            showError(resultsPanel, "Write your email first, then click Analyze.");
            return;
        }
        
        if (!context) {
            showError(resultsPanel, "Add context (e.g., 'job application') for better analysis.");
            return;
        }
        
        // Loading state
        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<div class="be-spinner"></div><span>Analyzing...</span>';
        showLoading(resultsPanel);
        
        try {
            const res = await fetch("http://localhost:3000/analyze-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: emailText,
                    context,
                    systemPrompt: SYSTEM_PROMPT
                })
            });
            
            const data = await res.json();
            
            if (res.ok) {
                renderResults(resultsPanel, data.response);
            } else {
                showError(resultsPanel, data.error || "Analysis failed.");
            }
        } catch (err) {
            console.error("[BetterEmail] Error:", err);
            showError(resultsPanel, "Can't reach server. Is the backend running on localhost:3000?");
        }
        
        // Reset button
        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
            </svg>
            <span>Analyze</span>
        `;
    });
}


/* =========================================================
   UI HELPERS
========================================================= */

function showLoading(panel) {
    panel.classList.add("visible");
    panel.innerHTML = `
        <div class="be-loading-state">
            <div class="be-loading-dots">
                <div class="be-dot"></div>
                <div class="be-dot"></div>
                <div class="be-dot"></div>
            </div>
            <span>Analyzing your email...</span>
        </div>
    `;
}

function showError(panel, message) {
    panel.classList.add("visible");
    panel.innerHTML = `
        <div class="be-error-state">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>${message}</span>
        </div>
    `;
}

/* =========================================================
   FOLLOW-UP REMINDER
========================================================= */

function attachSendListener(composeBox) {
    // Try immediately, then poll until found (Gmail renders toolbar asynchronously)
    if (!trySendButton(composeBox)) {
        let attempts = 0;
        const poll = setInterval(() => {
            attempts++;
            if (trySendButton(composeBox) || attempts > 20 || !document.contains(composeBox)) {
                clearInterval(poll);
            }
        }, 500);
    }
}

function trySendButton(composeBox) {
    const sendSelectors = [
        '[data-tooltip^="Send"]',
        '[aria-label^="Send"]',
        '.aoO[role="button"]',
        '.T-I.aoO',
        'div.T-I[role="button"].aoO'
    ];

    let sendBtn = null;

    // First: search inside compose box
    for (const sel of sendSelectors) {
        const el = composeBox.querySelector(sel);
        if (el) { sendBtn = el; break; }
    }

    // Fallback: search document-wide and pick the one closest to the compose box
    if (!sendBtn) {
        for (const sel of sendSelectors) {
            const candidates = document.querySelectorAll(sel);
            for (const el of candidates) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) { sendBtn = el; break; }
            }
            if (sendBtn) break;
        }
    }

    if (!sendBtn || sendBtn.dataset.beReminderAttached) return !!sendBtn;

    sendBtn.dataset.beReminderAttached = "true";
    sendBtn.addEventListener("click", () => {
        const subject = document.querySelector('input[name="subjectbox"]')?.value?.trim() || "your email";
        setTimeout(() => showReminderPrompt(subject), 600);
    });

    console.log("[BetterEmail] Send button listener attached");
    return true;
}

function showReminderPrompt(subject) {
    // Remove any existing toast
    document.querySelector(".be-reminder-toast")?.remove();

    const toast = document.createElement("div");
    toast.className = "be-reminder-toast";
    toast.innerHTML = `
        <div class="be-reminder-header">
            <div class="be-reminder-title">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                Follow-up Reminder
            </div>
            <button class="be-reminder-close" aria-label="Dismiss">&#x2715;</button>
        </div>
        <div class="be-reminder-body">
            No reply to <strong>${escapeHTML(subject)}</strong>? Remind me in:
        </div>
        <div class="be-reminder-options">
            <button class="be-reminder-btn" data-ms="${1 * 24 * 60 * 60 * 1000}" data-label="1 day">1 Day</button>
            <button class="be-reminder-btn" data-ms="${3 * 24 * 60 * 60 * 1000}" data-label="3 days">3 Days</button>
            <button class="be-reminder-btn" data-ms="${7 * 24 * 60 * 60 * 1000}" data-label="1 week">1 Week</button>
            <button class="be-reminder-btn be-reminder-custom-trigger">Custom</button>
            <button class="be-reminder-btn be-reminder-skip" data-dismiss>Skip</button>
        </div>
    `;

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));

    const autoDismiss = setTimeout(() => dismissToast(toast), 15000);
    toast.dataset.autoDismiss = autoDismiss;

    toast.querySelector(".be-reminder-close").addEventListener("click", () => dismissToast(toast));
    attachQuickOptionListeners(toast, subject);
}

function attachQuickOptionListeners(toast, subject) {
    toast.querySelector("[data-dismiss]").addEventListener("click", () => dismissToast(toast));

    toast.querySelectorAll("[data-ms]").forEach(btn => {
        btn.addEventListener("click", () => {
            scheduleReminder(subject, parseInt(btn.dataset.ms));
            showReminderConfirm(toast, btn.dataset.label);
        });
    });

    toast.querySelector(".be-reminder-custom-trigger").addEventListener("click", () => {
        showCustomInput(toast, subject);
    });
}

function showCustomInput(toast, subject) {
    const options = toast.querySelector(".be-reminder-options");
    options.innerHTML = `
        <div class="be-reminder-custom">
            <input type="number" class="be-custom-num" min="1" max="9999" value="2" placeholder="2">
            <select class="be-custom-unit">
                <option value="min">Minutes</option>
                <option value="hr">Hours</option>
                <option value="day" selected>Days</option>
            </select>
            <button class="be-reminder-btn be-custom-set">Set</button>
        </div>
        <button class="be-reminder-btn be-reminder-skip be-custom-back">&#8592; Back</button>
    `;

    const numInput = toast.querySelector(".be-custom-num");
    const unitSelect = toast.querySelector(".be-custom-unit");

    // Stop Gmail from swallowing keyboard events on our inputs
    [numInput, unitSelect].forEach(el => {
        el.addEventListener("keydown", e => e.stopPropagation());
        el.addEventListener("keyup", e => e.stopPropagation());
        el.addEventListener("keypress", e => e.stopPropagation());
    });

    toast.querySelector(".be-custom-set").addEventListener("click", () => {
        const val = parseInt(numInput.value);
        const unit = unitSelect.value;
        if (!val || val < 1) {
            numInput.classList.add("be-custom-num-error");
            numInput.focus();
            return;
        }
        const multipliers = { min: 60 * 1000, hr: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000 };
        const unitNames = { min: "minute", hr: "hour", day: "day" };
        const ms = val * multipliers[unit];
        const label = `${val} ${unitNames[unit]}${val !== 1 ? "s" : ""}`;
        scheduleReminder(subject, ms);
        showReminderConfirm(toast, label);
    });

    // Also allow Enter to submit
    numInput.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Enter") toast.querySelector(".be-custom-set").click();
    });

    toast.querySelector(".be-custom-back").addEventListener("click", () => {
        // Restore quick options
        options.innerHTML = `
            <button class="be-reminder-btn" data-ms="${1 * 24 * 60 * 60 * 1000}" data-label="1 day">1 Day</button>
            <button class="be-reminder-btn" data-ms="${3 * 24 * 60 * 60 * 1000}" data-label="3 days">3 Days</button>
            <button class="be-reminder-btn" data-ms="${7 * 24 * 60 * 60 * 1000}" data-label="1 week">1 Week</button>
            <button class="be-reminder-btn be-reminder-custom-trigger">Custom</button>
            <button class="be-reminder-btn be-reminder-skip" data-dismiss>Skip</button>
        `;
        attachQuickOptionListeners(toast, subject);
    });

    numInput.focus();
    numInput.select();
}

function showReminderConfirm(toast, label) {
    clearTimeout(parseInt(toast.dataset.autoDismiss));
    toast.innerHTML = `
        <div class="be-reminder-confirm">
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

function scheduleReminder(subject, ms) {
    const id = "be_reminder_" + Date.now();
    const dueTime = Date.now() + ms;
    try {
        chrome.runtime.sendMessage({ type: "SET_REMINDER", id, subject, dueTime });
    } catch (e) {
        console.warn("[BetterEmail] Extension context invalidated — please refresh the page.", e);
    }
}

function escapeHTML(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}


/* =========================================================
   GMAIL REMINDERS PANEL
========================================================= */

function initRemindersPanel() {
    // Try immediately, then watch for Gmail's header to render
    if (!tryInjectPanel()) {
        const observer = new MutationObserver(() => {
            if (tryInjectPanel()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
}

function tryInjectPanel() {
    if (document.getElementById("be-reminders-panel")) return true;

    // Wait for body to be available
    if (!document.body) return false;

    const panel = document.createElement("div");
    panel.id = "be-reminders-panel";
    panel.className = "be-reminders-panel";
    panel.innerHTML = `
        <button class="be-panel-trigger" id="be-panel-toggle" type="button">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span class="be-panel-label">Follow-ups</span>
            <span class="be-panel-badge" id="be-panel-badge"></span>
            <svg class="be-panel-chevron" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="6 9 12 15 18 9"/>
            </svg>
        </button>
        <div class="be-panel-body" id="be-panel-body"></div>
    `;

    document.body.appendChild(panel);

    // Toggle dropdown open/closed
    panel.querySelector("#be-panel-toggle").addEventListener("click", e => {
        e.stopPropagation();
        panel.classList.toggle("be-panel-open");
    });

    // Close when clicking anywhere outside the panel
    document.addEventListener("click", e => {
        if (!panel.contains(e.target)) panel.classList.remove("be-panel-open");
    });

    // Load and render on init
    chrome.storage.local.get("be_reminders", ({ be_reminders = [] }) => {
        renderPanelReminders(be_reminders);
    });

    // Re-render whenever storage changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.be_reminders) {
            renderPanelReminders(changes.be_reminders.newValue || []);
        }
    });

    return true;
}

function formatPanelTime(dueTime) {
    const diff = dueTime - Date.now();
    if (diff <= 0) return "Overdue";
    const mins = Math.floor(diff / 60000);
    const hrs  = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days >= 1) return `In ${days}d`;
    if (hrs  >= 1) return `In ${hrs}h`;
    return `In ${mins}m`;
}

function renderPanelReminders(reminders) {
    const body  = document.getElementById("be-panel-body");
    const badge = document.getElementById("be-panel-badge");
    const panel = document.getElementById("be-reminders-panel");
    if (!body || !badge || !panel) return;

    const hasFired = reminders.some(r => r.fired);

    if (!reminders.length) {
        badge.textContent = "";
        badge.style.display = "none";
        body.innerHTML = `
            <div class="be-panel-empty">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>
                </svg>
                All caught up!
            </div>
        `;
        return;
    }

    badge.style.display = "flex";
    badge.textContent = reminders.length;

    // Auto-open dropdown when a fired reminder arrives
    if (hasFired) panel.classList.add("be-panel-open");

    const sorted = [...reminders].sort((a, b) => {
        if (a.fired && !b.fired) return -1;
        if (!a.fired && b.fired) return 1;
        return a.dueTime - b.dueTime;
    });

    body.innerHTML = "";

    sorted.forEach(r => {
        const isFired = r.fired === true;
        const timeLabel = isFired ? "Follow up now!" : formatPanelTime(r.dueTime);

        const item = document.createElement("div");
        item.className = "be-panel-item" + (isFired ? " be-panel-item-fired" : "");
        item.innerHTML = `
            <div class="be-panel-dot ${isFired ? "be-panel-dot-fired" : ""}"></div>
            <div class="be-panel-info">
                <div class="be-panel-subject" title="${escapeHTML(r.subject)}">${escapeHTML(r.subject)}</div>
                <div class="be-panel-time ${isFired ? "be-panel-time-fired" : ""}">${timeLabel}</div>
            </div>
            <button class="be-panel-dismiss" title="Dismiss">&#x2715;</button>
        `;

        item.querySelector(".be-panel-dismiss").addEventListener("click", e => {
            e.stopPropagation();
            chrome.storage.local.get("be_reminders", ({ be_reminders = [] }) => {
                chrome.storage.local.set({
                    be_reminders: be_reminders.filter(rem => rem.id !== r.id)
                });
            });
        });

        body.appendChild(item);
    });
}


function renderResults(panel, raw) {
    panel.classList.add("visible");
    panel.innerHTML = "";
    
    let jsonStr = raw.trim();
    if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    
    try {
        const sections = JSON.parse(jsonStr);
        
        const grid = document.createElement("div");
        grid.className = "be-results-grid";
        
        sections.forEach((s, i) => {
            const card = document.createElement("div");
            card.className = "be-result-card";
            card.style.animationDelay = `${i * 0.08}s`;
            
            // Color coding
            let accent = "";
            const title = s.title.toLowerCase();
            if (title.includes("grammar")) accent = "accent-blue";
            else if (title.includes("tone")) accent = "accent-purple";
            else if (title.includes("clarity")) accent = "accent-cyan";
            else if (title.includes("suggestion")) accent = "accent-yellow";
            else if (title.includes("verdict")) accent = "accent-green";
            
            if (accent) card.classList.add(accent);
            
            card.innerHTML = `
                <div class="be-card-header">
                    <span class="be-card-icon">${s.icon}</span>
                    <span class="be-card-title">${s.title}</span>
                </div>
                <div class="be-card-content">${s.content}</div>
            `;
            
            grid.appendChild(card);
        });
        
        // Close button
        const closeBtn = document.createElement("button");
        closeBtn.className = "be-close-results";
        closeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            Close
        `;
        closeBtn.addEventListener("click", () => {
            panel.classList.remove("visible");
            panel.innerHTML = "";
        });
        
        panel.appendChild(grid);
        panel.appendChild(closeBtn);
        
    } catch (e) {
        panel.innerHTML = `<div class="be-raw-result">${raw}</div>`;
    }
}
