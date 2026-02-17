/**
 * BetterEmail V2
 * Gmail Compose Analyzer - Content Script
 */

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

let widgetInjected = false;


/* =========================================================
   INIT WHEN GMAIL READY
========================================================= */

function waitForGmail() {
    if (document.body) {
        injectFloatingWidget();
    } else {
        setTimeout(waitForGmail, 300);
    }
}

waitForGmail();


/* =========================================================
   INJECT FLOATING WIDGET (ONCE)
========================================================= */

function injectFloatingWidget() {
    if (widgetInjected) return;
    widgetInjected = true;

    const widget = document.createElement("div");
    widget.id = "be-analyzer-widget";

    widget.innerHTML = `
        <div id="be-panel">
            <div id="be-header">
                <div class="be-logo-dot"></div>
                <h3>BetterEmail</h3>
            </div>
            <div id="be-content">
                <form id="be-form">
                    <textarea id="be-email-input" placeholder="Paste your email here or click 'Grab from Compose'..."></textarea>
                    <input type="text" id="be-context-input" placeholder="Context (e.g., job application, follow-up)">
                    <button type="button" id="be-grab-btn">Grab from Compose</button>
                    <button type="submit" id="be-analyze-btn">Analyze Email</button>
                </form>
                <div id="be-results"></div>
            </div>
        </div>
        <button id="be-toggle-btn" title="BetterEmail Analyzer">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
            </svg>
        </button>
    `;

    document.body.appendChild(widget);

    // Toggle panel visibility
    const toggleBtn = widget.querySelector("#be-toggle-btn");
    toggleBtn.addEventListener("click", () => {
        widget.classList.toggle("be-expanded");
    });

    // Grab email from compose
    const grabBtn = widget.querySelector("#be-grab-btn");
    const emailInput = widget.querySelector("#be-email-input");

    grabBtn.addEventListener("click", () => {
        const emailText = getEmailFromCompose();
        if (emailText) {
            emailInput.value = emailText;
            showSuccess(widget.querySelector("#be-results"), "Email grabbed successfully!");
        } else {
            showError(widget.querySelector("#be-results"), "Open a compose window and type some content first, then click 'Grab from Compose'.");
        }
    });

    // Analyze button
    const form = widget.querySelector("#be-form");
    const contextInput = widget.querySelector("#be-context-input");
    const analyzeBtn = widget.querySelector("#be-analyze-btn");
    const results = widget.querySelector("#be-results");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const email = emailInput.value.trim();
        const context = contextInput.value.trim();

        if (!email) {
            showError(results, "Please paste an email or grab from compose.");
            return;
        }

        if (!context) {
            showError(results, "Please provide context for the email.");
            return;
        }

        analyzeBtn.disabled = true;
        analyzeBtn.textContent = "Analyzing...";
        showLoading(results);

        try {
            const res = await fetch("http://localhost:3000/analyze-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email,
                    context,
                    systemPrompt: SYSTEM_PROMPT
                })
            });

            const data = await res.json();

            if (res.ok) {
                renderResults(results, data.response);
            } else {
                showError(results, data.error || "Analysis failed.");
            }

        } catch {
            showError(results, "Server not reachable. Is the backend running?");
        }

        analyzeBtn.disabled = false;
        analyzeBtn.textContent = "Analyze Email";
    });
}


/* =========================================================
   GET EMAIL FROM ACTIVE COMPOSE
========================================================= */

function getEmailFromCompose() {
    // Multiple selectors to handle different Gmail versions and locales
    const editorSelectors = [
        '[aria-label="Message Body"]',
        '[aria-label="Body"]',
        '[g_editable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        '.editable[contenteditable="true"]',
        'div.Am.Al.editable',
        'div[aria-label*="essage"]', // Partial match for "Message"
        'div[contenteditable="true"][tabindex]'
    ];

    // Try compose dialogs first (new email / reply popup)
    const composeDialogs = document.querySelectorAll('div[role="dialog"]');
    
    for (const dialog of composeDialogs) {
        for (const selector of editorSelectors) {
            const editor = dialog.querySelector(selector);
            if (editor) {
                const text = editor.innerText.trim();
                if (text) return text;
            }
        }
    }

    // Try inline compose (reply in thread)
    for (const selector of editorSelectors) {
        const editors = document.querySelectorAll(selector);
        for (const editor of editors) {
            const text = editor.innerText.trim();
            if (text) return text;
        }
    }

    return null;
}


/* =========================================================
   SHOW LOADING
========================================================= */

function showLoading(container) {
    container.className = "visible";
    container.innerHTML = `
        <div class="be-loading">
            <div class="be-dot"></div>
            <div class="be-dot"></div>
            <div class="be-dot"></div>
            <span>Analyzing...</span>
        </div>
    `;
}


/* =========================================================
   SHOW ERROR
========================================================= */

function showError(container, message) {
    container.className = "visible";
    container.innerHTML = `
        <div class="be-section-card" style="border-color: rgba(255, 107, 107, 0.3);">
            <div class="be-section-content" style="color: #ff6b6b;">${message}</div>
        </div>
    `;
}


/* =========================================================
   SHOW SUCCESS
========================================================= */

function showSuccess(container, message) {
    container.className = "visible";
    container.innerHTML = `
        <div class="be-section-card" style="border-color: rgba(107, 255, 139, 0.3);">
            <div class="be-section-content" style="color: #6bff8b;">${message}</div>
        </div>
    `;
    // Auto-hide after 2 seconds
    setTimeout(() => {
        container.innerHTML = "";
        container.className = "";
    }, 2000);
}


/* =========================================================
   RENDER RESULTS
========================================================= */

function renderResults(container, raw) {
    container.className = "visible";
    container.innerHTML = "";

    let jsonStr = raw.trim();

    if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    try {
        const sections = JSON.parse(jsonStr);

        sections.forEach(s => {
            const card = document.createElement("div");
            card.className = "be-section-card";

            card.innerHTML = `
                <div class="be-section-title">${s.icon} ${s.title}</div>
                <div class="be-section-content">${s.content}</div>
            `;

            container.appendChild(card);
        });

    } catch {
        container.innerHTML = `
            <div class="be-section-card">
                <div class="be-section-content">${raw}</div>
            </div>
        `;
    }
}
