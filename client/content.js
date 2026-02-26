/**
 * BetterEmail V2
 * Gmail Compose Analyzer - Inline Content Script
 */

console.log("[BetterEmail] Content script loaded — v2.1 (API proxy)");


/* =========================================================
   API PROXY — routes fetch calls through background service
   worker to avoid mixed-content (HTTPS→HTTP) and CORS issues
========================================================= */

function apiFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage({
                type: "API_FETCH",
                url,
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body || undefined
            }, (response) => {
                if (chrome.runtime.lastError) {
                    const errMsg = chrome.runtime.lastError.message || '';
                    if (errMsg.includes('Extension context invalidated')) {
                        return reject(new Error('Extension was updated — please refresh this Gmail tab (Cmd+Shift+R)'));
                    }
                    return reject(new Error(errMsg));
                }
                if (!response) {
                    return reject(new Error('No response from background script'));
                }
                if (response.error) {
                    return reject(new Error(response.error));
                }
                resolve(response);
            });
        } catch (err) {
            if (err.message && err.message.includes('Extension context invalidated')) {
                reject(new Error('Extension was updated — please refresh this Gmail tab (Cmd+Shift+R)'));
            } else {
                reject(err);
            }
        }
    });
}


/* =========================================================
   AUTH HELPERS (content script context)
========================================================= */

async function isAuthenticated() {
    return new Promise((resolve) => {
        chrome.storage.local.get('be_supabase_session', (result) => {
            const session = result.be_supabase_session || null;
            resolve(!!(session && session.access_token));
        });
    });
}

// Listen for auth state changes and re-initialize UIs
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.be_supabase_session) {
        console.log("[BetterEmail] Auth state changed, re-initializing UIs");
        refreshAllAuthStates();
    }
});

async function refreshAllAuthStates() {
    const authed = await isAuthenticated();

    // Refresh Lead Finder panel lock state
    refreshLeadFinderAuth(authed);

    // Refresh Semantic Search bar lock state
    refreshSemanticSearchAuth(authed);

    // Refresh Compose Analyzer lock states
    refreshAnalyzerAuth(authed);

    // Refresh Reminders panel lock state
    refreshRemindersAuth(authed);
}


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

async function attachAnalyzer(composeBox, initialEditor) {
    composeBox.dataset.beAttached = "true";
    attachSendListener(composeBox);

    // Store editor reference
    let storedEditor = initialEditor;

    const authed = await isAuthenticated();

    // Create the analyzer bar
    const analyzer = document.createElement("div");
    analyzer.className = "be-inline-analyzer";
    analyzer.dataset.beAnalyzer = "true";
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
                <input type="text" class="be-context-input"
                    placeholder="${authed ? "What's this email for? (e.g., job application, follow-up)" : "Sign in via the extension popup to use AI Analyzer"}"
                    ${authed ? '' : 'disabled'}>
            </div>
            <div class="be-bar-right">
                <button type="button" class="be-analyze-btn" ${authed ? '' : 'disabled'}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                    </svg>
                    <span>${authed ? 'Analyze' : 'Locked'}</span>
                </button>
                <button type="button" class="be-draft-btn" ${authed ? '' : 'disabled'}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    <span>${authed ? 'Draft' : 'Locked'}</span>
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
    const draftBtn = analyzer.querySelector(".be-draft-btn");
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
            const token = await getContentAccessToken();
            if (!token) {
                showError(resultsPanel, "Please sign in via the BetterEmail popup first.");
                analyzeBtn.disabled = false;
                analyzeBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                    </svg>
                    <span>Analyze</span>
                `;
                return;
            }

            const res = await apiFetch(`${getApiBase()}/analyze-email`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    email: emailText,
                    context,
                    systemPrompt: SYSTEM_PROMPT
                })
            });

            if (res.ok) {
                renderResults(resultsPanel, res.data.response);
            } else {
                showError(resultsPanel, res.data.error || "Analysis failed.");
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

    draftBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const jobDesc = prompt('What is this email for?\n(e.g. "Software Engineer role at Google", "cold email to UF professor about research")');
        if (!jobDesc || !jobDesc.trim()) return;

        draftBtn.disabled = true;
        draftBtn.innerHTML = '<div class="be-spinner"></div><span>Drafting...</span>';
        showLoading(resultsPanel);

        const token = await getContentAccessToken();
        if (!token) {
            showError(resultsPanel, 'Please sign in via the BetterEmail popup first.');
            draftBtn.disabled = false;
            draftBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Draft</span>`;
            return;
        }

        try {
            const res = await apiFetch(`${getApiBase()}/draft-email`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ jobDescription: jobDesc })
            });

            if (res.ok) {
                const draft = res.data.draft || '';
                // Insert draft into the Gmail compose field
                const editor = findEditorInCompose(composeBox) || storedEditor;
                if (editor) {
                    editor.focus();
                    document.execCommand('selectAll');
                    document.execCommand('insertText', false, draft);
                }
                resultsPanel.classList.remove('visible');
                resultsPanel.innerHTML = '';
            } else {
                showError(resultsPanel, res.data?.error || 'Draft failed. Make sure your resume is saved in Settings.');
            }
        } catch (err) {
            console.error('[BetterEmail] Draft error:', err);
            showError(resultsPanel, "Can't reach server. Is the backend running on localhost:3000?");
        }

        draftBtn.disabled = false;
        draftBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Draft</span>`;
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

function resetPanelAnalyzeBtn(btn) {
    btn.disabled = false;
    btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
        </svg>
        Analyze
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
   AUTH REFRESH: COMPOSE ANALYZER
========================================================= */

function refreshAnalyzerAuth(authed) {
    document.querySelectorAll('[data-be-analyzer]').forEach(analyzer => {
        const input = analyzer.querySelector('.be-context-input');
        const btn = analyzer.querySelector('.be-analyze-btn');
        const draft = analyzer.querySelector('.be-draft-btn');
        if (input) {
            input.disabled = !authed;
            input.placeholder = authed
                ? "What's this email for? (e.g., job application, follow-up)"
                : "Sign in via the extension popup to use AI Analyzer";
        }
        if (btn) {
            btn.disabled = !authed;
            btn.querySelector('span').textContent = authed ? 'Analyze' : 'Locked';
        }
        if (draft) {
            draft.disabled = !authed;
            draft.querySelector('span').textContent = authed ? 'Draft' : 'Locked';
        }
    });
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
        // For replies: capture thread from URL now (Gmail navigates away by toast time).
        // For new compose emails: both null here — watchForSentThread will fill pendingThread
        // by observing Gmail's "View message" notification link that appears after send.
        const currentThreadId = getCurrentThreadId();
        const currentThreadPath = getCurrentThreadPath();
        console.log("[BetterEmail] Send clicked — hash:", window.location.hash, "→ threadId:", currentThreadId, "path:", currentThreadPath);
        if (currentThreadId) autoDismissReminderForThread(currentThreadId);
        const pendingThread = { id: currentThreadId, path: currentThreadPath };
        if (!currentThreadPath) watchForSentThread(pendingThread);
        setTimeout(() => showReminderPrompt(subject, pendingThread), 600);
    });

    console.log("[BetterEmail] Send button listener attached");
    return true;
}

async function showReminderPrompt(subject, pendingThread = {}) {
    // Abort if not authenticated
    if (!(await isAuthenticated())) return;

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
    // Pass pendingThread by reference — watchForSentThread may still be updating it
    attachQuickOptionListeners(toast, subject, pendingThread);
}

function attachQuickOptionListeners(toast, subject, pendingThread = {}) {
    toast.querySelector("[data-dismiss]").addEventListener("click", () => dismissToast(toast));

    toast.querySelectorAll("[data-ms]").forEach(btn => {
        btn.addEventListener("click", () => {
            // Read pendingThread at click time — observer may have populated it since toast appeared
            scheduleReminder(subject, parseInt(btn.dataset.ms), pendingThread.id, pendingThread.path);
            showReminderConfirm(toast, btn.dataset.label);
        });
    });

    toast.querySelector(".be-reminder-custom-trigger").addEventListener("click", () => {
        showCustomInput(toast, subject, pendingThread);
    });
}

function showCustomInput(toast, subject, pendingThread = {}) {
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
        scheduleReminder(subject, ms, pendingThread.id, pendingThread.path);
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

function scheduleReminder(subject, ms, capturedThreadId = null, capturedThreadPath = null) {
    const id = "be_reminder_" + Date.now();
    const dueTime = Date.now() + ms;
    // For replies: captured values come from the URL at send-click time (before Gmail navigates away).
    // For new emails: both are null at send time; by now Gmail has navigated to #sent/THREADID.
    const threadId = capturedThreadId || getCurrentThreadId();
    const threadPath = capturedThreadPath || getCurrentThreadPath();
    console.log("[BetterEmail] Reminder scheduled — subject:", subject, "threadId:", threadId, "threadPath:", threadPath);
    try {
        chrome.runtime.sendMessage({ type: "SET_REMINDER", id, subject, dueTime, threadId, threadPath });
    } catch (e) {
        console.warn("[BetterEmail] Extension context invalidated — please refresh the page.", e);
    }
}

// Valid Gmail URL thread IDs are alphanumeric (e.g. "CwCPbpQHJcjrSFlVPxcprfrKKSQmqXb").
// Gmail's *internal* DOM thread IDs look like "thread-f:1857966367691616753" (contain a colon)
// and cannot be used in Gmail hash URLs. This regex accepts only URL-safe IDs.
const GMAIL_THREAD_ID_RE = /^[A-Za-z0-9_\-]{8,}$/;

function getCurrentThreadId() {
    // URL hash — the only reliable source of URL-navigable thread IDs.
    // Formats: #inbox/ID, #sent/ID, #label/NAME/ID, #search/QUERY/ID
    // Strip ?compose=new or other query params that Gmail appends when a compose window is open.
    const hash = window.location.hash.replace('#', '');
    const parts = hash.split('/');
    if (parts.length >= 2) {
        const folder = parts[0].toLowerCase();
        const MAIL_FOLDERS = new Set(['inbox', 'sent', 'trash', 'spam', 'all', 'starred',
            'imp', 'scheduled', 'snoozed', 'chats', 'drafts']);
        const threadPart = parts[1].split('?')[0]; // strip ?compose=new etc.
        if (MAIL_FOLDERS.has(folder) && GMAIL_THREAD_ID_RE.test(threadPart)) {
            console.log("[BetterEmail] threadId from URL hash:", threadPart);
            return threadPart;
        }
        // #label/NAME/THREADID or #search/QUERY/THREADID
        if (parts.length >= 3) {
            const threadPart3 = parts[2].split('?')[0];
            if (GMAIL_THREAD_ID_RE.test(threadPart3)) {
                console.log("[BetterEmail] threadId from URL (label/search):", threadPart3);
                return threadPart3;
            }
        }
    }
    console.log("[BetterEmail] threadId: could not find. hash was:", window.location.hash);
    return null;
}

// Builds the Gmail URL for a reminder — used by both popup and panel clicks.
// Gmail's hash search uses + for spaces: in:sent+subject:%22Subject%22
function contentReminderUrl(reminder) {
    if (reminder?.threadPath) return `https://mail.google.com/mail/u/0/#${reminder.threadPath}`;
    // Only use threadId if it's a valid URL-navigable ID — not internal "thread-f:..." DOM format
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

// Returns the full hash path (e.g. "sent/CwCPbpQH..." or "inbox/AbCdEf...")
// so navigation uses the correct Gmail folder, not always #inbox.
// Strips ?compose=new and other query params Gmail appends when a compose window is open.
function getCurrentThreadPath() {
    const hash = window.location.hash.replace('#', '');
    const parts = hash.split('/');
    if (parts.length >= 2) {
        const folder = parts[0].toLowerCase();
        const MAIL_FOLDERS = new Set(['inbox', 'sent', 'trash', 'spam', 'all', 'starred',
            'imp', 'scheduled', 'snoozed', 'chats', 'drafts']);
        const threadPart = parts[1].split('?')[0]; // strip ?compose=new etc.
        if (MAIL_FOLDERS.has(folder) && GMAIL_THREAD_ID_RE.test(threadPart)) {
            return `${folder}/${threadPart}`;
        }
        // label/NAME/THREADID or search/QUERY/THREADID
        if (parts.length >= 3) {
            const threadPart3 = parts[2].split('?')[0];
            if (GMAIL_THREAD_ID_RE.test(threadPart3)) {
                return `${parts[0]}/${parts[1]}/${threadPart3}`;
            }
        }
    }
    return null;
}

// After a new-compose send, Gmail shows a "Message sent. View message." notification.
// The "View message" link contains the sent thread path. This observer captures it
// and writes it into pendingThread so scheduleReminder has it when the user picks a time.
function watchForSentThread(pendingThread) {
    let found = false;

    function tryLink(el) {
        if (found || !el) return;
        const href = el.getAttribute && (el.getAttribute('href') || '');
        // Handle both "#sent/ID" and "/mail/u/0/#sent/ID" and full https://... URLs
        const m = href.match(/(?:#)(sent|inbox|all)\/([A-Za-z0-9_\-]{8,})/);
        if (m) {
            pendingThread.path = `${m[1]}/${m[2]}`;
            pendingThread.id = m[2];
            found = true;
            console.log("[BetterEmail] watchForSentThread: captured", pendingThread.path);
            cleanup();
        }
    }

    const observer = new MutationObserver((mutations) => {
        if (found) return;
        for (const mut of mutations) {
            for (const node of mut.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                // Check the node itself and all descendant links
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
            console.log("[BetterEmail] watchForSentThread: hashchange captured", path);
            cleanup();
        }
    }
    window.addEventListener('hashchange', onHashChange);

    const timeout = setTimeout(() => {
        if (!found) console.log("[BetterEmail] watchForSentThread: timed out (no sent link found in DOM)");
        cleanup();
    }, 30000);

    function cleanup() {
        observer.disconnect();
        window.removeEventListener('hashchange', onHashChange);
        clearTimeout(timeout);
    }
}

function autoDismissReminderForThread(threadId) {
    chrome.storage.local.get("be_reminders", ({ be_reminders = [] }) => {
        const toRemove = be_reminders.filter(r => r.threadId === threadId);
        if (toRemove.length === 0) {
            console.log("[BetterEmail] No reminders to auto-dismiss for thread:", threadId);
            return;
        }
        console.log("[BetterEmail] Auto-dismissing", toRemove.length, "reminder(s) for thread:", threadId);
        const updated = be_reminders.filter(r => r.threadId !== threadId);
        chrome.storage.local.set({ be_reminders: updated });
        // chrome.alarms not available in content scripts — proxy through background
        toRemove.forEach(r => chrome.runtime.sendMessage({ type: "CLEAR_ALARM", id: r.id }));
    });
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

    // Wait for Gmail search bar
    const searchForm = document.querySelector('form[role="search"]');
    if (!searchForm) return false;

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

    function positionPanel() {
        const rect = searchForm.getBoundingClientRect();
        // Position to the right of the scraper trigger with equal 8px spacing, and vertically centered.
        // Scraper is center-aligned at +24px, Follow-ups panel is ~32px tall, so top offset is +8px.
        panel.style.top = (rect.top + 8) + 'px';
        panel.style.left = (rect.right + 104) + 'px';
    } positionPanel();
    window.addEventListener('resize', positionPanel);
    setInterval(positionPanel, 2000);

    // Toggle dropdown open/closed
    panel.querySelector("#be-panel-toggle").addEventListener("click", e => {
        e.stopPropagation();
        panel.classList.toggle("be-panel-open");
    });

    // Close when clicking anywhere outside the panel
    document.addEventListener("click", e => {
        if (!panel.contains(e.target)) panel.classList.remove("be-panel-open");
    });

    // Load and render on init (only show if authenticated)
    isAuthenticated().then(authed => {
        if (!authed) {
            panel.style.display = 'none';
        }
    });

    chrome.storage.local.get("be_reminders", ({ be_reminders = [] }) => {
        renderPanelReminders(be_reminders);
        // Auto-open panel on load if there are any active reminders
        if (be_reminders.length > 0) panel.classList.add("be-panel-open");
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
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days >= 1) return `In ${days}d`;
    if (hrs >= 1) return `In ${hrs}h`;
    return `In ${mins}m`;
}

function renderPanelReminders(reminders) {
    const body = document.getElementById("be-panel-body");
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
            chrome.runtime.sendMessage({ type: "CLEAR_ALARM", id: r.id });
            chrome.storage.local.get("be_reminders", ({ be_reminders = [] }) => {
                chrome.storage.local.set({
                    be_reminders: be_reminders.filter(rem => rem.id !== r.id)
                });
            });
        });

        // Click anywhere on the item (except dismiss) — opens the thread in a new tab.
        // Must proxy through background because chrome.tabs is not accessible from content scripts.
        item.style.cursor = 'pointer';
        item.addEventListener("click", e => {
            if (e.target.closest(".be-panel-dismiss")) return;
            panel.classList.remove("be-panel-open");
            const url = contentReminderUrl(r);
            console.log("[BetterEmail] Panel reminder click — threadPath:", r.threadPath, "threadId:", r.threadId, "url:", url);
            chrome.runtime.sendMessage({ type: "OPEN_TAB", url });
        });

        body.appendChild(item);
    });
}

function refreshRemindersAuth(authed) {
    const panel = document.getElementById("be-reminders-panel");
    if (!panel) return;
    if (authed) {
        panel.style.display = '';
    } else {
        panel.style.display = 'none';
        panel.classList.remove('be-panel-open');
    }
}


/* =========================================================
   WEB SCRAPER UI
========================================================= */

function initScraperUI() {
    if (document.getElementById('be-scraper-trigger')) return true;

    // Find the Gmail search form to position the trigger next to it
    const searchForm = document.querySelector('form[role="search"]');
    if (!searchForm) return false;

    // Create trigger button (appended to body, positioned via CSS fixed)
    const trigger = document.createElement('button');
    trigger.id = 'be-scraper-trigger';
    trigger.className = 'be-scraper-trigger';
    trigger.title = 'BetterEmail Tools';
    trigger.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
        </svg>
    `;
    document.body.appendChild(trigger);

    // Position the trigger to the right of the search bar
    function positionTrigger() {
        const rect = searchForm.getBoundingClientRect();
        // Use a fixed offset from the top instead of calculating based on height
        // to prevent the icon from moving down when the search bar expands.
        trigger.style.top = (rect.top + 4) + 'px';
        trigger.style.left = (rect.right + 56) + 'px';
    }

    positionTrigger();
    // Reposition on resize/scroll since Gmail header can shift
    window.addEventListener('resize', positionTrigger);
    // Periodic reposition to handle Gmail DOM changes
    setInterval(positionTrigger, 2000);

    // Create the search panel (appended to body for absolute positioning)
    const panel = document.createElement('div');
    panel.id = 'be-scraper-panel';
    panel.className = 'be-scraper-panel';
    panel.innerHTML = `
        <div class="be-scraper-header">
            <div class="be-scraper-title">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                BetterEmail Tools
            </div>
            <button class="be-scraper-close" id="be-scraper-close">&#x2715;</button>
        </div>
        <div class="be-tab-buttons">
            <button class="be-tab-button active" data-tab="lead-finder">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                Lead Finder
            </button>
            <button class="be-tab-button" data-tab="analyzer">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                </svg>
                Email Analyzer
            </button>
        </div>
        <div id="be-tab-lead-finder" class="be-tab-pane active">
            <div id="be-lead-container" class="be-scraper-body">
                <div id="be-lead-locked" class="be-locked-ui" style="display:none;">
                    Please click the BetterEmail extension icon in your toolbar and sign in to unlock Lead Finder.
                </div>
                <div id="be-lead-content">
                    <input type="text" class="be-scraper-input" id="be-scraper-input"
                           placeholder="e.g. UF Computer Science professors">
                    <button class="be-scraper-submit" id="be-scraper-submit">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        Find Leads
                    </button>
                    <div class="be-scraper-status" id="be-scraper-status"></div>
                    <div class="be-scraper-results" id="be-scraper-results"></div>
                </div>
            </div>
        </div>
        <div id="be-tab-analyzer" class="be-tab-pane">
            <div class="be-scraper-body">
                <div id="be-analyzer-locked" class="be-locked-ui" style="display:none;">
                    Please click the BetterEmail extension icon in your toolbar and sign in to unlock Email Analyzer.
                </div>
                <div id="be-analyzer-content" class="be-panel-analyzer-form">
                    <textarea class="be-panel-textarea" id="be-panel-email-input"
                              placeholder="Paste the email you want to analyze..."></textarea>
                    <input type="text" class="be-panel-context-input" id="be-panel-context-input"
                           placeholder="What's this email for? (e.g., job application, follow-up)">
                    <button class="be-panel-analyze-btn" id="be-panel-analyze-btn">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                        </svg>
                        Analyze
                    </button>
                    <div class="be-panel-analyzer-results" id="be-panel-analyzer-results"></div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    // Tab switching logic
    panel.querySelectorAll('.be-tab-button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Deactivate all tabs and panes
            panel.querySelectorAll('.be-tab-button').forEach(b => b.classList.remove('active'));
            panel.querySelectorAll('.be-tab-pane').forEach(p => p.classList.remove('active'));
            // Activate clicked tab and corresponding pane
            btn.classList.add('active');
            const tabId = btn.dataset.tab;
            panel.querySelector(`#be-tab-${tabId}`).classList.add('active');
        });
    });

    // Apply auth lock state
    isAuthenticated().then(authed => {
        const locked = panel.querySelector('#be-lead-locked');
        const content = panel.querySelector('#be-lead-content');
        const analyzerLocked = panel.querySelector('#be-analyzer-locked');
        const analyzerContent = panel.querySelector('#be-analyzer-content');
        if (authed) {
            locked.style.display = 'none';
            content.style.display = 'block';
            analyzerLocked.style.display = 'none';
            analyzerContent.style.display = 'flex';
        } else {
            locked.style.display = 'block';
            content.style.display = 'none';
            analyzerLocked.style.display = 'block';
            analyzerContent.style.display = 'none';
        }
    });

    // Stop Gmail from capturing keyboard events on analyzer inputs
    const panelEmailInput = panel.querySelector('#be-panel-email-input');
    const panelContextInput = panel.querySelector('#be-panel-context-input');
    [panelEmailInput, panelContextInput].forEach(el => {
        ['keydown', 'keyup', 'keypress', 'focus', 'click'].forEach(evt => {
            el.addEventListener(evt, e => e.stopPropagation());
        });
    });

    // Analyzer form submit handler
    const panelAnalyzeBtn = panel.querySelector('#be-panel-analyze-btn');
    const panelResultsEl = panel.querySelector('#be-panel-analyzer-results');

    panelAnalyzeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const emailText = panelEmailInput.value.trim();
        const context = panelContextInput.value.trim();

        if (!emailText) {
            showError(panelResultsEl, "Please paste an email to analyze.");
            return;
        }
        if (!context) {
            showError(panelResultsEl, "Add context (e.g., 'job application') for better analysis.");
            return;
        }

        panelAnalyzeBtn.disabled = true;
        panelAnalyzeBtn.innerHTML = '<div class="be-spinner"></div><span>Analyzing...</span>';
        showLoading(panelResultsEl);

        try {
            const token = await getContentAccessToken();
            if (!token) {
                showError(panelResultsEl, "Please sign in via the BetterEmail popup first.");
                resetPanelAnalyzeBtn(panelAnalyzeBtn);
                return;
            }

            const res = await apiFetch(`${getApiBase()}/analyze-email`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    email: emailText,
                    context,
                    systemPrompt: SYSTEM_PROMPT
                })
            });

            if (res.ok) {
                renderResults(panelResultsEl, res.data.response);
            } else {
                showError(panelResultsEl, res.data.error || "Analysis failed.");
            }
        } catch (err) {
            console.error("[BetterEmail] Panel analyzer error:", err);
            showError(panelResultsEl, "Can't reach server. Is the backend running on localhost:3000?");
        }

        resetPanelAnalyzeBtn(panelAnalyzeBtn);
    });

    // Stop Gmail from capturing keyboard events
    const scraperInput = panel.querySelector('#be-scraper-input');
    ['keydown', 'keyup', 'keypress', 'focus', 'click'].forEach(evt => {
        scraperInput.addEventListener(evt, e => e.stopPropagation());
    });

    // Toggle panel and position it below the trigger
    trigger.addEventListener('click', e => {
        e.stopPropagation();
        // Position panel below the trigger button
        const rect = trigger.getBoundingClientRect();
        panel.style.top = (rect.bottom + 4) + 'px';
        panel.style.right = (window.innerWidth - rect.right) + 'px';
        panel.classList.toggle('be-scraper-panel-open');
    });

    // Close panel
    panel.querySelector('#be-scraper-close').addEventListener('click', () => {
        panel.classList.remove('be-scraper-panel-open');
    });

    // Close when clicking outside
    document.addEventListener('click', e => {
        if (!panel.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) {
            panel.classList.remove('be-scraper-panel-open');
        }
    });

    // Submit handler
    const submitBtn = panel.querySelector('#be-scraper-submit');
    submitBtn.addEventListener('click', () => handleScraperSubmit());

    // Enter key submits
    scraperInput.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') handleScraperSubmit();
    });

    return true;
}

async function handleScraperSubmit() {
    const input = document.getElementById('be-scraper-input');
    const statusEl = document.getElementById('be-scraper-status');
    const resultsEl = document.getElementById('be-scraper-results');
    const submitBtn = document.getElementById('be-scraper-submit');

    const prompt = input.value.trim();
    if (!prompt) {
        statusEl.className = 'be-scraper-status be-scraper-status-error';
        statusEl.textContent = 'Please enter a search goal.';
        return;
    }

    // Loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="be-spinner"></div><span>Searching...</span>';
    resultsEl.innerHTML = '';
    statusEl.className = 'be-scraper-status be-scraper-status-loading';
    statusEl.textContent = 'Checking cache...';

    try {
        const token = await getContentAccessToken();
        if (!token) {
            statusEl.className = 'be-scraper-status be-scraper-status-error';
            statusEl.textContent = 'Please sign in via the BetterEmail popup first.';
            return;
        }

        const res = await apiFetch(`${getApiBase()}/scrape-emails`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ prompt })
        });

        if (!res.ok) {
            statusEl.className = 'be-scraper-status be-scraper-status-error';
            statusEl.textContent = res.data.error || 'Search failed.';
            return;
        }

        const results = res.data.results || [];
        const source = res.data.source || 'unknown';

        if (results.length === 0) {
            statusEl.className = 'be-scraper-status be-scraper-status-error';
            statusEl.textContent = 'No results found. Try a different search.';
            return;
        }

        // Show source info
        const sourceLabel = source === 'cache' ? 'From cache' :
            source === 'leads_cache' ? 'From saved leads' : 'Live results';
        statusEl.className = 'be-scraper-status be-scraper-status-success';
        statusEl.textContent = `${sourceLabel} — ${results.length} contact${results.length !== 1 ? 's' : ''} found`;

        // Render results table
        let html = '<table class="be-scraper-table">';
        html += '<thead><tr><th>Name</th><th>Email</th><th>Details</th></tr></thead>';
        html += '<tbody>';
        results.forEach(r => {
            html += `<tr>
                <td>${escapeHTML(r.name || 'Unknown')}</td>
                <td><a href="mailto:${escapeHTML(r.email)}">${escapeHTML(r.email)}</a></td>
                <td>${escapeHTML(r.detail || '')}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        resultsEl.innerHTML = html;

    } catch (err) {
        console.error('[BetterEmail] Scraper error:', err);
        statusEl.className = 'be-scraper-status be-scraper-status-error';
        statusEl.textContent = "Can't reach server. Is the backend running on localhost:3000?";
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Find Leads
        `;
    }
}

/* =========================================================
   AUTH REFRESH: LEAD FINDER
========================================================= */

function refreshLeadFinderAuth(authed) {
    const locked = document.getElementById('be-lead-locked');
    const content = document.getElementById('be-lead-content');
    if (locked && content) {
        if (authed) {
            locked.style.display = 'none';
            content.style.display = 'block';
        } else {
            locked.style.display = 'block';
            content.style.display = 'none';
        }
    }

    // Also refresh analyzer tab auth state
    const analyzerLocked = document.getElementById('be-analyzer-locked');
    const analyzerContent = document.getElementById('be-analyzer-content');
    if (analyzerLocked && analyzerContent) {
        if (authed) {
            analyzerLocked.style.display = 'none';
            analyzerContent.style.display = 'flex';
        } else {
            analyzerLocked.style.display = 'block';
            analyzerContent.style.display = 'none';
        }
    }
}


/* =========================================================
   SEMANTIC SEARCH (Gmail content script)
========================================================= */

function getApiBase() {
    return typeof BE_CONFIG !== 'undefined' ? BE_CONFIG.API_URL : 'http://localhost:3000';
}

/**
 * Get a valid access token. In the content script context, auth.js functions
 * are not directly available, so we read from chrome.storage.local.
 */
async function getContentAccessToken() {
    return new Promise((resolve) => {
        chrome.storage.local.get('be_supabase_session', (result) => {
            const session = result.be_supabase_session || null;
            if (!session) return resolve(null);
            resolve(session.access_token || null);
        });
    });
}

async function getContentSession() {
    return new Promise((resolve) => {
        chrome.storage.local.get('be_supabase_session', (result) => {
            resolve(result.be_supabase_session || null);
        });
    });
}

async function handleSemanticSearch() {
    const queryInput = document.querySelector('form[role="search"] input');
    const resultsContainer = document.getElementById('be-semantic-results');

    const query = queryInput?.value?.trim();
    if (!query) return;
    // Position results dropdown below the overlay
    const overlayEl = document.getElementById('be-gmail-search-overlay');
    if (overlayEl) {
        overlayEl.classList.add('is-searching');
        const rect = overlayEl.getBoundingClientRect();
        resultsContainer.style.top = (rect.bottom + 4) + 'px';
        resultsContainer.style.left = rect.left + 'px';
        resultsContainer.style.width = rect.width + 'px';
    }
    resultsContainer.style.display = 'flex';
    resultsContainer.innerHTML = '<div class="be-scraper-status be-scraper-status-loading" style="display:block;">Searching your emails...</div>';

    try {
        const token = await getContentAccessToken();
        if (!token) {
            resultsContainer.innerHTML = '<div class="be-scraper-status be-scraper-status-error" style="display:block;">Please sign in via the BetterEmail popup first.</div>';
            return;
        }

        const response = await apiFetch(`${getApiBase()}/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ query })
        });

        if (!response.ok) {
            resultsContainer.innerHTML = `<div class="be-scraper-status be-scraper-status-error" style="display:block;">${escapeHTML(response.data.error || 'Search failed')}</div>`;
            return;
        }

        renderSemanticResults(resultsContainer, response.data.results);
    } catch (err) {
        resultsContainer.innerHTML = `<div class="be-scraper-status be-scraper-status-error" style="display:block;">Search failed: ${escapeHTML(err.message)}</div>`;
    } finally {
        if (overlayEl) overlayEl.classList.remove('is-searching');
    }
}

function renderSemanticResults(container, results) {
    if (!results || results.length === 0) {
        container.innerHTML = '<div class="be-semantic-empty">No results found. Try a different query or sync more emails.</div>';
        return;
    }

    container.innerHTML = '';

    results.forEach(r => {
        const date = r.internal_date
            ? new Date(r.internal_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '';

        const from = r.from_name
            ? `${escapeHTML(r.from_name)} <${escapeHTML(r.from_email)}>`
            : escapeHTML(r.from_email || 'Unknown');

        const gmailUrl = r.thread_id
            ? `https://mail.google.com/mail/u/0/#inbox/${r.thread_id}`
            : '#';

        const item = document.createElement('div');
        item.className = 'be-semantic-result-item';
        item.innerHTML = `
            <div class="be-semantic-result-header">
                <span class="be-semantic-result-from">${from}</span>
                <span class="be-semantic-result-date">${escapeHTML(date)}</span>
            </div>
            <div class="be-semantic-result-subject">${escapeHTML(r.subject || '(no subject)')}</div>
            <div class="be-semantic-result-snippet">${escapeHTML(r.snippet || '')}</div>
            <a href="${escapeHTML(gmailUrl)}" target="_blank" class="be-semantic-result-open">Open in Gmail</a>
        `;

        container.appendChild(item);
    });
}

async function handleSemanticSync() {
    const syncStatus = document.getElementById('be-semantic-sync-status');
    // Position sync status below the overlay
    const overlayEl = document.getElementById('be-gmail-search-overlay');
    if (overlayEl) {
        const rect = overlayEl.getBoundingClientRect();
        syncStatus.style.position = 'fixed';
        syncStatus.style.top = (rect.bottom + 4) + 'px';
        syncStatus.style.left = rect.left + 'px';
        syncStatus.style.width = rect.width + 'px';
        syncStatus.style.zIndex = '1001';
    }
    syncStatus.style.display = 'block';
    syncStatus.textContent = 'Syncing emails...';
    syncStatus.className = 'be-scraper-status be-scraper-status-loading';

    try {
        const session = await getContentSession();
        if (!session || !session.access_token) {
            syncStatus.textContent = 'Please sign in via the BetterEmail popup first.';
            syncStatus.className = 'be-scraper-status be-scraper-status-error';
            return;
        }

        const response = await apiFetch(`${getApiBase()}/gmail/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                provider_token: session.provider_token,
                provider_refresh_token: session.provider_refresh_token
            })
        });

        if (!response.ok) {
            syncStatus.textContent = response.data.error || 'Sync failed';
            syncStatus.className = 'be-scraper-status be-scraper-status-error';
            return;
        }

        syncStatus.textContent = `Synced ${response.data.processed} emails, ${response.data.queued} queued for indexing.`;
        syncStatus.className = 'be-scraper-status be-scraper-status-success';
    } catch (err) {
        syncStatus.textContent = `Sync failed: ${err.message}`;
        syncStatus.className = 'be-scraper-status be-scraper-status-error';
    }
}


// Initialize scraper UI — keep observing since Gmail may re-render the header on navigation
const scraperObserver = new MutationObserver(() => {
    initScraperUI();
    initSemanticSearchBar();
});
if (!initScraperUI()) {
    scraperObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
} else {
    scraperObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
}

// Also try to inject semantic search bar on load
initSemanticSearchBar();


/* =========================================================
   SEMANTIC SEARCH BAR — toggle overlay on Gmail search
========================================================= */

let isSemanticSearchActive = false;

function toggleSemanticSearch(forceState) {
    const overlay = document.getElementById('be-gmail-search-overlay');
    const toggleBtn = document.getElementById('be-semantic-toggle-btn');
    if (!overlay || !toggleBtn) return;

    isSemanticSearchActive = typeof forceState === 'boolean' ? forceState : !isSemanticSearchActive;

    if (isSemanticSearchActive) {
        overlay.classList.add('be-overlay-active');
        toggleBtn.classList.add('be-toggle-active');
        toggleBtn.title = 'Switch to Gmail Search (Shift)';
        // Focus the semantic input
        const input = document.getElementById('be-semantic-input');
        if (input && !input.disabled) input.focus();
    } else {
        overlay.classList.remove('be-overlay-active');
        toggleBtn.classList.remove('be-toggle-active');
        toggleBtn.title = 'Switch to Semantic Search (Shift)';

        const resultsContainer = document.getElementById('be-semantic-results');
        if (resultsContainer) {
            resultsContainer.style.display = 'none';
            resultsContainer.innerHTML = '';
        }

        // Focus native Gmail search input and reset placeholder
        const nativeInput = document.querySelector('form[role="search"] input');
        if (nativeInput) {
            nativeInput.placeholder = 'Search in mail';
            nativeInput.focus();
        }
    }
}

function initSemanticSearchBar() {
    if (document.getElementById('be-gmail-search-overlay')) return true;

    const searchForm = document.querySelector('form[role="search"]');
    if (!searchForm) return false;

    // Create toggle button positioned next to the search bar
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'be-semantic-toggle-btn';
    toggleBtn.className = 'be-semantic-toggle-btn';
    toggleBtn.title = 'Toggle Semantic Search (Shift)';
    toggleBtn.type = 'button';
    toggleBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
    `;
    document.body.appendChild(toggleBtn);

    // Position toggle button to the left of the scraper trigger
    function positionToggle() {
        const rect = searchForm.getBoundingClientRect();
        // Use a fixed offset from the top instead of calculating based on height
        // to prevent the icon from moving down when the search bar expands.
        toggleBtn.style.top = (rect.top + 4) + 'px';
        toggleBtn.style.left = (rect.right + 12) + 'px';
    }
    positionToggle();
    window.addEventListener('resize', positionToggle);
    setInterval(positionToggle, 2000);

    // Toggle click handler
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSemanticSearch();
    });

    // Create overlay container — HIDDEN by default
    const overlay = document.createElement('div');
    overlay.id = 'be-gmail-search-overlay';
    overlay.className = 'be-gmail-search-overlay';
    overlay.innerHTML = `
        <div class="be-search-wrapper" id="be-search-wrapper"></div>
        <div id="be-semantic-sync-status" class="be-scraper-status"></div>
        <div id="be-semantic-results" class="be-semantic-results be-gmail-search-results" style="display:none;"></div>
    `;

    // Position overlay directly on top of the search form
    const formParent = searchForm.parentElement;
    formParent.style.position = 'relative';
    formParent.insertBefore(overlay, searchForm);

    // Reposition the overlay to cover the search form exactly
    function positionOverlay() {
        const rect = searchForm.getBoundingClientRect();
        const parentRect = formParent.getBoundingClientRect();
        overlay.style.position = 'absolute';
        overlay.style.top = (rect.top - parentRect.top) + 'px';
        overlay.style.left = (rect.left - parentRect.left) + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
    }
    positionOverlay();
    window.addEventListener('resize', positionOverlay);
    setInterval(positionOverlay, 2000);

    const semanticInput = overlay.querySelector('#be-semantic-input');

    // Removed the semanticInput keydown listeners since the custom input is gone.

    // Listen to native Gmail search input for Enter key when semantic search is active
    // and block Gmail's native autocomplete dropdown by intercepting events in the capture phase.
    const nativeSearchInput = searchForm.querySelector('input');
    if (nativeSearchInput) {
        ['keydown', 'keyup', 'keypress', 'input', 'focus', 'click'].forEach(evt => {
            nativeSearchInput.addEventListener(evt, e => {
                if (isSemanticSearchActive) {
                    if (evt === 'keydown' && e.key === 'Enter') {
                        e.preventDefault();
                        handleSemanticSearch();
                    }
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                }
            }, true); // Use capture phase so we run BEFORE Gmail's internal listeners
        });
    }

    // Global Shift to toggle Semantic Search
    // We track whether any key other than Shift was pressed while Shift was held
    let shiftHeld = false;
    let otherKeyPressedWhileShiftHeld = false;

    document.addEventListener('keydown', e => {
        if (e.key === 'Shift') {
            shiftHeld = true;
            otherKeyPressedWhileShiftHeld = false;
        } else if (shiftHeld) {
            otherKeyPressedWhileShiftHeld = true;
        }
    }, true);

    document.addEventListener('keyup', e => {
        if (e.key === 'Shift') {
            shiftHeld = false;
            // Only toggle if they merely tapped Shift, rather than typing a capital letter or shortcut
            if (!otherKeyPressedWhileShiftHeld) {
                // Do not toggle if they are typing in an input other than the search bar itself
                const activeEl = document.activeElement;
                const isWritingEmail = activeEl && (activeEl.isContentEditable || (activeEl.tagName === 'TEXTAREA') || (activeEl.tagName === 'INPUT' && activeEl !== nativeSearchInput));

                if (!isWritingEmail) {
                    toggleSemanticSearch(!isSemanticSearchActive);
                }
            }
        }
    }, true);

    // Removed submitBtn and syncBtn listeners

    // Apply auth lock state
    isAuthenticated().then(authed => {
        applySemanticSearchAuthState(overlay, authed);
    });

    return true;
}

function applySemanticSearchAuthState(overlay, authed) {
    const nativeInput = document.querySelector('form[role="search"] input');

    if (authed) {
        if (nativeInput && isSemanticSearchActive) {
            nativeInput.placeholder = 'Semantic Search: "Email from Nathan about club opportunity"';
        }
        overlay.classList.remove('be-search-locked');

        // Auto-sync emails when authenticated
        handleSemanticSync();
    } else {
        if (nativeInput && isSemanticSearchActive) {
            nativeInput.placeholder = 'Sign in via extension to unlock Semantic Search';
        }
        overlay.classList.add('be-search-locked');
    }
}

function refreshSemanticSearchAuth(authed) {
    const overlay = document.getElementById('be-gmail-search-overlay');
    if (!overlay) return;
    applySemanticSearchAuthState(overlay, authed);
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
