/**
 * BetterEmail V2
 * Copilot Sidebar — Content Script
 */

console.log("[BetterEmail] Content script loaded — v3.0 (Sidebar Copilot)");


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

function getApiBase() {
    return typeof BE_CONFIG !== 'undefined' ? BE_CONFIG.API_URL : 'http://localhost:3000';
}

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

// Listen for auth state changes and refresh sidebar
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.be_supabase_session) {
        console.log("[BetterEmail] Auth state changed, refreshing sidebar");
        refreshSidebarAuth();
    }
});


/* =========================================================
   SYSTEM PROMPT
========================================================= */

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
    console.log("[BetterEmail] Initializing sidebar...");

    // Inject the sidebar
    injectSidebar();

    // Check every second for compose windows (still needed for send-button listener)
    setInterval(scanForComposeWindows, 1000);

    // Also watch for DOM changes
    const observer = new MutationObserver(scanForComposeWindows);
    observer.observe(document.body, { childList: true, subtree: true });
}

if (document.body) {
    init();
} else {
    document.addEventListener('DOMContentLoaded', init);
}


/* =========================================================
   SIDEBAR INJECTION
========================================================= */

function injectSidebar() {
    if (document.getElementById('be-sidebar-wrapper')) return;

    // Create sidebar wrapper
    const sidebar = document.createElement('div');
    sidebar.id = 'be-sidebar-wrapper';
    sidebar.innerHTML = buildSidebarHTML();
    document.body.appendChild(sidebar);

    // Create toggle button (for collapsed state)
    const toggle = document.createElement('button');
    toggle.id = 'be-sidebar-toggle';
    toggle.title = 'Open BetterEmail';
    toggle.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
        </svg>
    `;
    document.body.appendChild(toggle);

    // Shift Gmail layout
    document.body.classList.add('be-sidebar-active');

    // Wire up all sidebar functionality
    wireSidebarEvents(sidebar, toggle);

    // Initialize auth state
    refreshSidebarAuth();

    // Initialize semantic search bar (kept as overlay on Gmail search)
    initSemanticSearchBar();

    console.log("[BetterEmail] Sidebar injected");
}


/* =========================================================
   SIDEBAR HTML BUILDER
========================================================= */

function buildSidebarHTML() {
    return `
        <!-- Header -->
        <div class="be-sidebar-header">
            <div class="be-sidebar-header-left">
                <div class="be-sidebar-logo-dot"></div>
                <h1>BetterEmail</h1>
            </div>
            <div class="be-sidebar-header-right">
                <span id="be-sidebar-user-email" class="be-sidebar-user-email" style="display:none;"></span>
                <button id="be-sidebar-signout" class="be-sidebar-signout-btn" title="Sign out" style="display:none;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                        <polyline points="16 17 21 12 16 7"/>
                        <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                </button>
                <button id="be-sidebar-collapse" class="be-sidebar-collapse-btn" title="Minimize sidebar">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"/>
                    </svg>
                </button>
            </div>
        </div>

        <!-- Auth card (shown when signed out) -->
        <div id="be-sidebar-auth-card" class="be-sidebar-auth-card" style="display:none;">
            <div class="be-sidebar-auth-inner">
                <h2>Sign in to unlock BetterEmail</h2>
                <p>Sign in with Google to access all features.</p>
                <button id="be-sidebar-signin" class="be-sidebar-auth-btn">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    Sign in with Google
                </button>
            </div>
        </div>

        <!-- Tab navigation (shown when signed in) -->
        <div class="be-sidebar-tabs" id="be-sidebar-tabs" style="display:none;">
            <button class="be-sidebar-tab be-sidebar-tab-active" data-tab="main">Main</button>
            <button class="be-sidebar-tab" data-tab="leads">Leads</button>
            <button class="be-sidebar-tab" data-tab="search">Search</button>
            <button class="be-sidebar-tab" data-tab="settings">Settings</button>
        </div>

        <!-- Main Panel -->
        <div class="be-sidebar-panel be-sidebar-panel-active" id="be-sidebar-panel-main">
            <!-- Reminders -->
            <div class="be-sidebar-card">
                <div class="be-sidebar-reminders-header">
                    <div class="be-sidebar-reminders-title">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                        </svg>
                        <span>Follow-up Reminders</span>
                    </div>
                    <span class="be-sidebar-reminders-badge" id="be-sidebar-reminders-badge" style="display:none;">0</span>
                </div>
                <div id="be-sidebar-reminders-list"></div>
            </div>

            <!-- Compose Analyzer -->
            <div class="be-sidebar-card">
                <div class="be-sidebar-compose-section">
                    <div class="be-sidebar-section-title">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                        </svg>
                        <span>Email Analyzer</span>
                    </div>
                    <input type="text" class="be-sidebar-context-input" id="be-sidebar-context"
                        placeholder="What's this email for? (e.g., job application, follow-up)">
                    <div class="be-sidebar-compose-hint">Open a compose window, then click Analyze to review your email.</div>
                    <div class="be-sidebar-compose-actions">
                        <button class="be-sidebar-analyze-btn" id="be-sidebar-analyze-btn">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                            </svg>
                            Analyze
                        </button>
                        <button class="be-sidebar-draft-btn" id="be-sidebar-draft-btn">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                            Draft
                        </button>
                    </div>
                    <div class="be-sidebar-results-area" id="be-sidebar-analyzer-results"></div>
                </div>
            </div>
        </div>

        <!-- Lead Finder Panel -->
        <div class="be-sidebar-panel" id="be-sidebar-panel-leads">
            <div class="be-sidebar-card">
                <div class="be-sidebar-section-title">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <span>Lead Finder</span>
                </div>
                <input type="text" class="be-sidebar-lead-input" id="be-sidebar-lead-input"
                    placeholder="e.g. UF Computer Science professors">
                <button class="be-sidebar-lead-btn" id="be-sidebar-lead-btn">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    Find Leads
                </button>
                <div class="be-sidebar-lead-status" id="be-sidebar-lead-status"></div>
                <div class="be-sidebar-lead-results" id="be-sidebar-lead-results"></div>
            </div>
        </div>

        <!-- Semantic Search Panel -->
        <div class="be-sidebar-panel" id="be-sidebar-panel-search">
            <div class="be-sidebar-card">
                <div class="be-sidebar-section-title">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <span>Semantic Search</span>
                </div>
                <input type="text" class="be-sidebar-search-input" id="be-sidebar-search-input"
                    placeholder='e.g. "Email from Nathan about club opportunity"'>
                <div class="be-sidebar-search-actions">
                    <button class="be-sidebar-search-btn" id="be-sidebar-search-btn">Search</button>
                    <button class="be-sidebar-sync-btn" id="be-sidebar-sync-btn">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"/>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                        Sync
                    </button>
                </div>
                <div class="be-sidebar-sync-status" id="be-sidebar-sync-status"></div>
                <div class="be-sidebar-search-results" id="be-sidebar-search-results"></div>
            </div>
        </div>

        <!-- Settings Panel -->
        <div class="be-sidebar-panel" id="be-sidebar-panel-settings">
            <div class="be-sidebar-card">
                <h3 class="be-sidebar-settings-title">Your Resume</h3>
                <div class="be-sidebar-resume-on-file" id="be-sidebar-resume-on-file">
                    Resume on file — upload a new PDF to replace it.
                </div>
                <p class="be-sidebar-settings-desc">Upload your resume as a PDF. BetterEmail will use it to draft personalized outreach emails directly in Gmail.</p>
                <div class="be-sidebar-upload-zone" id="be-sidebar-upload-zone">
                    <input type="file" id="be-sidebar-resume-file" accept=".pdf" style="display:none;">
                    <div class="be-sidebar-upload-icon">📄</div>
                    <div class="be-sidebar-upload-text">Drop your PDF here or <span class="be-sidebar-upload-link" id="be-sidebar-upload-browse">browse</span></div>
                    <div class="be-sidebar-upload-hint">Max 5 MB · text-based PDFs only</div>
                </div>
                <div class="be-sidebar-file-chosen" id="be-sidebar-file-chosen">
                    <span class="be-sidebar-file-icon">📎</span>
                    <span class="be-sidebar-file-name" id="be-sidebar-file-name"></span>
                    <button class="be-sidebar-file-remove" id="be-sidebar-file-remove">✕</button>
                </div>
                <button id="be-sidebar-resume-save" class="be-sidebar-resume-save" disabled>Upload Resume</button>
                <div id="be-sidebar-resume-status" class="be-sidebar-resume-status"></div>
                <div class="be-sidebar-resume-summary" id="be-sidebar-resume-summary">
                    <div class="be-sidebar-summary-label">AI Summary</div>
                    <div class="be-sidebar-summary-text" id="be-sidebar-summary-text"></div>
                </div>
            </div>
        </div>
    `;
}


/* =========================================================
   SIDEBAR EVENT WIRING
========================================================= */

function wireSidebarEvents(sidebar, toggle) {
    // --- Collapse / Expand ---
    sidebar.querySelector('#be-sidebar-collapse').addEventListener('click', () => {
        sidebar.classList.add('be-sidebar-collapsed');
        document.body.classList.remove('be-sidebar-active');
    });

    toggle.addEventListener('click', () => {
        sidebar.classList.remove('be-sidebar-collapsed');
        document.body.classList.add('be-sidebar-active');
    });

    // --- Tab switching ---
    sidebar.querySelectorAll('.be-sidebar-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            sidebar.querySelectorAll('.be-sidebar-tab').forEach(t => t.classList.remove('be-sidebar-tab-active'));
            sidebar.querySelectorAll('.be-sidebar-panel').forEach(p => p.classList.remove('be-sidebar-panel-active'));
            tab.classList.add('be-sidebar-tab-active');
            sidebar.querySelector(`#be-sidebar-panel-${tab.dataset.tab}`).classList.add('be-sidebar-panel-active');
        });
    });

    // --- Sign in ---
    sidebar.querySelector('#be-sidebar-signin').addEventListener('click', async () => {
        const btn = sidebar.querySelector('#be-sidebar-signin');
        btn.disabled = true;
        btn.textContent = 'Signing in...';
        try {
            await signInWithGoogle();
            await refreshSidebarAuth();
        } catch (err) {
            console.error('[BetterEmail] Sign-in failed:', err);
            alert('Sign-in error: ' + err.message);
        }
        btn.disabled = false;
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Sign in with Google
        `;
    });

    // --- Sign out ---
    sidebar.querySelector('#be-sidebar-signout').addEventListener('click', async () => {
        chrome.runtime.sendMessage({ type: "SIGN_OUT" }, () => {
            refreshSidebarAuth();
        });
    });

    // --- Stop Gmail keyboard capture on all sidebar inputs ---
    sidebar.querySelectorAll('input, textarea, select').forEach(el => {
        ['keydown', 'keyup', 'keypress', 'focus', 'click'].forEach(evt => {
            el.addEventListener(evt, e => e.stopPropagation());
        });
    });

    // --- Wire up features ---
    wireAnalyzer(sidebar);
    wireLeadFinder(sidebar);
    wireSemanticSearch(sidebar);
    wireResumeUpload(sidebar);
    wireReminders();
}


/* =========================================================
   AUTH STATE MANAGEMENT
========================================================= */

async function refreshSidebarAuth() {
    const sidebar = document.getElementById('be-sidebar-wrapper');
    if (!sidebar) return;

    const session = await getContentSession();
    const authed = !!(session && session.access_token);

    const authCard = sidebar.querySelector('#be-sidebar-auth-card');
    const tabs = sidebar.querySelector('#be-sidebar-tabs');
    const userEmail = sidebar.querySelector('#be-sidebar-user-email');
    const signoutBtn = sidebar.querySelector('#be-sidebar-signout');
    const panels = sidebar.querySelectorAll('.be-sidebar-panel');

    if (authed) {
        authCard.style.display = 'none';
        tabs.style.display = 'flex';
        if (session.user && session.user.email) {
            userEmail.textContent = session.user.email;
            userEmail.style.display = 'inline';
        }
        signoutBtn.style.display = 'flex';
        panels.forEach(p => {
            if (p.classList.contains('be-sidebar-panel-active')) p.style.display = '';
        });
        // Load resume data
        loadSidebarResume(session.access_token);
        // Auto-sync emails
        handleSidebarSync(true);
    } else {
        authCard.style.display = 'flex';
        tabs.style.display = 'none';
        userEmail.style.display = 'none';
        signoutBtn.style.display = 'none';
        // Hide all panels
        panels.forEach(p => p.classList.remove('be-sidebar-panel-active'));
    }

    // Also refresh semantic search overlay auth
    refreshSemanticSearchAuth(authed);
}


/* =========================================================
   COMPOSE ANALYZER (sidebar)
========================================================= */

function wireAnalyzer(sidebar) {
    const analyzeBtn = sidebar.querySelector('#be-sidebar-analyze-btn');
    const draftBtn = sidebar.querySelector('#be-sidebar-draft-btn');
    const contextInput = sidebar.querySelector('#be-sidebar-context');
    const resultsArea = sidebar.querySelector('#be-sidebar-analyzer-results');

    analyzeBtn.addEventListener('click', async () => {
        const editor = findAnyVisibleEditor();
        const emailText = editor ? getEditorContent(editor) : '';
        const context = contextInput.value.trim();

        if (!emailText) {
            showSidebarError(resultsArea, "Open a compose window and write your email first, then click Analyze.");
            return;
        }
        if (!context) {
            showSidebarError(resultsArea, "Add context (e.g., 'job application') for better analysis.");
            return;
        }

        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<div class="be-sidebar-spinner"></div><span>Analyzing...</span>';
        showSidebarLoading(resultsArea, 'Analyzing your email...');

        try {
            const token = await getContentAccessToken();
            if (!token) {
                showSidebarError(resultsArea, "Please sign in first.");
                resetBtn(analyzeBtn, 'Analyze', 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z');
                return;
            }

            const res = await apiFetch(`${getApiBase()}/analyze-email`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ email: emailText, context, systemPrompt: SYSTEM_PROMPT })
            });

            if (res.ok) {
                renderSidebarResults(resultsArea, res.data.response);
            } else {
                showSidebarError(resultsArea, res.data.error || "Analysis failed.");
            }
        } catch (err) {
            console.error("[BetterEmail] Analyze error:", err);
            showSidebarError(resultsArea, "Can't reach server. Is the backend running?");
        }

        resetBtn(analyzeBtn, 'Analyze', 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z');
    });

    draftBtn.addEventListener('click', async () => {
        const jobDesc = prompt('What is this email for?\n(e.g. "Software Engineer role at Google", "cold email to UF professor about research")');
        if (!jobDesc || !jobDesc.trim()) return;

        draftBtn.disabled = true;
        draftBtn.innerHTML = '<div class="be-sidebar-spinner"></div><span>Drafting...</span>';
        showSidebarLoading(resultsArea, 'Drafting your email...');

        const token = await getContentAccessToken();
        if (!token) {
            showSidebarError(resultsArea, 'Please sign in first.');
            resetBtn(draftBtn, 'Draft', 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z');
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
                const editor = findAnyVisibleEditor();
                if (editor) {
                    editor.focus();
                    document.execCommand('selectAll');
                    document.execCommand('insertText', false, draft);
                }
                resultsArea.innerHTML = '';
            } else {
                showSidebarError(resultsArea, res.data?.error || 'Draft failed. Make sure your resume is saved in Settings.');
            }
        } catch (err) {
            console.error('[BetterEmail] Draft error:', err);
            showSidebarError(resultsArea, "Can't reach server. Is the backend running?");
        }

        resetBtn(draftBtn, 'Draft', 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z');
    });
}


/* =========================================================
   LEAD FINDER (sidebar)
========================================================= */

function wireLeadFinder(sidebar) {
    const input = sidebar.querySelector('#be-sidebar-lead-input');
    const btn = sidebar.querySelector('#be-sidebar-lead-btn');
    const statusEl = sidebar.querySelector('#be-sidebar-lead-status');
    const resultsEl = sidebar.querySelector('#be-sidebar-lead-results');

    async function handleSubmit() {
        const prompt = input.value.trim();
        if (!prompt) {
            statusEl.className = 'be-sidebar-lead-status be-status-error';
            statusEl.textContent = 'Please enter a search goal.';
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<div class="be-sidebar-spinner"></div><span>Searching...</span>';
        resultsEl.innerHTML = '';
        statusEl.className = 'be-sidebar-lead-status be-status-loading';
        statusEl.textContent = 'Checking cache...';

        try {
            const token = await getContentAccessToken();
            if (!token) {
                statusEl.className = 'be-sidebar-lead-status be-status-error';
                statusEl.textContent = 'Please sign in first.';
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
                statusEl.className = 'be-sidebar-lead-status be-status-error';
                statusEl.textContent = res.data.error || 'Search failed.';
                return;
            }

            const results = res.data.results || [];
            const source = res.data.source || 'unknown';

            if (results.length === 0) {
                statusEl.className = 'be-sidebar-lead-status be-status-error';
                statusEl.textContent = 'No results found. Try a different search.';
                return;
            }

            const sourceLabel = source === 'cache' ? 'From cache' :
                source === 'leads_cache' ? 'From saved leads' : 'Live results';
            statusEl.className = 'be-sidebar-lead-status be-status-success';
            statusEl.textContent = `${sourceLabel} — ${results.length} contact${results.length !== 1 ? 's' : ''} found`;

            let html = '<table class="be-sidebar-lead-table">';
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
            console.error('[BetterEmail] Lead finder error:', err);
            statusEl.className = 'be-sidebar-lead-status be-status-error';
            statusEl.textContent = "Can't reach server. Is the backend running?";
        } finally {
            btn.disabled = false;
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                Find Leads
            `;
        }
    }

    btn.addEventListener('click', handleSubmit);
    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') handleSubmit();
    });
}


/* =========================================================
   SEMANTIC SEARCH (sidebar panel)
========================================================= */

function wireSemanticSearch(sidebar) {
    const input = sidebar.querySelector('#be-sidebar-search-input');
    const searchBtn = sidebar.querySelector('#be-sidebar-search-btn');
    const syncBtn = sidebar.querySelector('#be-sidebar-sync-btn');
    const resultsEl = sidebar.querySelector('#be-sidebar-search-results');
    const syncStatus = sidebar.querySelector('#be-sidebar-sync-status');

    async function handleSearch() {
        const query = input.value.trim();
        if (!query) return;

        searchBtn.disabled = true;
        searchBtn.textContent = 'Searching...';
        resultsEl.innerHTML = '<div class="be-sidebar-loading"><div class="be-sidebar-loading-dots"><div class="be-sidebar-dot"></div><div class="be-sidebar-dot"></div><div class="be-sidebar-dot"></div></div><span>Searching...</span></div>';

        try {
            const token = await getContentAccessToken();
            if (!token) {
                resultsEl.innerHTML = '<div class="be-sidebar-error">Please sign in first.</div>';
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
                resultsEl.innerHTML = `<div class="be-sidebar-error">${escapeHTML(response.data.error || 'Search failed')}</div>`;
                return;
            }

            renderSidebarSearchResults(resultsEl, response.data.results);
        } catch (err) {
            resultsEl.innerHTML = `<div class="be-sidebar-error">Search failed: ${escapeHTML(err.message)}</div>`;
        } finally {
            searchBtn.disabled = false;
            searchBtn.textContent = 'Search';
        }
    }

    searchBtn.addEventListener('click', handleSearch);
    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') handleSearch();
    });

    syncBtn.addEventListener('click', () => handleSidebarSync(false));
}

async function handleSidebarSync(silent) {
    const syncStatus = document.getElementById('be-sidebar-sync-status');
    if (!syncStatus) return;

    if (!silent) {
        syncStatus.textContent = 'Syncing emails...';
        syncStatus.className = 'be-sidebar-sync-status';
        syncStatus.style.color = 'var(--be-text-dim)';
    }

    try {
        const session = await getContentSession();
        if (!session || !session.access_token) {
            if (!silent) {
                syncStatus.textContent = 'Please sign in first.';
                syncStatus.className = 'be-sidebar-sync-status be-sync-error';
            }
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
            if (!silent) {
                syncStatus.textContent = response.data.error || 'Sync failed';
                syncStatus.className = 'be-sidebar-sync-status be-sync-error';
            }
            return;
        }

        syncStatus.textContent = `Synced ${response.data.processed} emails, ${response.data.queued} queued for indexing.`;
        syncStatus.className = 'be-sidebar-sync-status be-sync-success';
    } catch (err) {
        if (!silent) {
            syncStatus.textContent = `Sync failed: ${err.message}`;
            syncStatus.className = 'be-sidebar-sync-status be-sync-error';
        }
    }
}

function renderSidebarSearchResults(container, results) {
    if (!results || results.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:var(--be-text-dim); font-size:0.82rem; padding:16px 0; font-style:italic;">No results found. Try a different query or sync more emails.</div>';
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
        item.className = 'be-sidebar-search-result-item';
        item.innerHTML = `
            <div class="be-sidebar-search-result-header">
                <span class="be-sidebar-search-result-from">${from}</span>
                <span class="be-sidebar-search-result-date">${escapeHTML(date)}</span>
            </div>
            <div class="be-sidebar-search-result-subject">${escapeHTML(r.subject || '(no subject)')}</div>
            <div class="be-sidebar-search-result-snippet">${escapeHTML(r.snippet || '')}</div>
            <a href="${escapeHTML(gmailUrl)}" target="_blank" class="be-sidebar-search-result-open">Open in Gmail</a>
        `;
        container.appendChild(item);
    });
}


/* =========================================================
   RESUME UPLOAD (sidebar settings)
========================================================= */

function wireResumeUpload(sidebar) {
    const fileInput = sidebar.querySelector('#be-sidebar-resume-file');
    const uploadZone = sidebar.querySelector('#be-sidebar-upload-zone');
    const fileChosen = sidebar.querySelector('#be-sidebar-file-chosen');
    const fileName = sidebar.querySelector('#be-sidebar-file-name');
    const fileRemove = sidebar.querySelector('#be-sidebar-file-remove');
    const saveBtn = sidebar.querySelector('#be-sidebar-resume-save');
    const statusEl = sidebar.querySelector('#be-sidebar-resume-status');

    sidebar.querySelector('#be-sidebar-upload-browse').addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('be-sidebar-upload-drag'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('be-sidebar-upload-drag'));
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('be-sidebar-upload-drag');
        const file = e.dataTransfer?.files?.[0];
        if (file) setResumeFile(file);
    });
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) setResumeFile(file);
    });

    function setResumeFile(file) {
        if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
            statusEl.textContent = 'Please select a PDF file.';
            statusEl.className = 'be-sidebar-resume-status be-status-err';
            return;
        }
        fileName.textContent = file.name;
        uploadZone.style.display = 'none';
        fileChosen.style.display = 'flex';
        saveBtn.disabled = false;
        statusEl.textContent = '';
        statusEl.className = 'be-sidebar-resume-status';
    }

    fileRemove.addEventListener('click', () => {
        fileInput.value = '';
        uploadZone.style.display = 'flex';
        fileChosen.style.display = 'none';
        saveBtn.disabled = true;
        statusEl.textContent = '';
        statusEl.className = 'be-sidebar-resume-status';
    });

    saveBtn.addEventListener('click', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        statusEl.textContent = 'Uploading...';
        statusEl.className = 'be-sidebar-resume-status';
        saveBtn.disabled = true;

        try {
            const token = await getContentAccessToken();
            if (!token) {
                statusEl.textContent = 'Not signed in.';
                statusEl.className = 'be-sidebar-resume-status be-status-err';
                saveBtn.disabled = false;
                return;
            }

            // Read file as base64, send through background's FILE_UPLOAD proxy
            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = reader.result.split(',')[1];
                try {
                    const res = await new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage({
                            type: "FILE_UPLOAD",
                            url: `${getApiBase()}/user/resume/upload`,
                            token,
                            fileData: base64,
                            fileName: file.name,
                            fileType: file.type,
                            fieldName: 'resume'
                        }, (response) => {
                            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                            if (!response) return reject(new Error('No response'));
                            resolve(response);
                        });
                    });

                    if (res.ok) {
                        statusEl.textContent = res.data.summary
                            ? `Resume uploaded! AI summary generated. (${res.data.characters?.toLocaleString() || '?'} chars)`
                            : `Resume saved. AI summary unavailable.`;
                        statusEl.className = 'be-sidebar-resume-status be-status-ok';
                        const t = await getContentAccessToken();
                        if (t) await loadSidebarResume(t);
                    } else {
                        statusEl.textContent = res.data?.error || 'Upload failed.';
                        statusEl.className = 'be-sidebar-resume-status be-status-err';
                    }
                } catch (err) {
                    statusEl.textContent = 'Could not reach server.';
                    statusEl.className = 'be-sidebar-resume-status be-status-err';
                }
                saveBtn.disabled = false;
            };
            reader.readAsDataURL(file);
        } catch (err) {
            statusEl.textContent = 'Could not reach server.';
            statusEl.className = 'be-sidebar-resume-status be-status-err';
            saveBtn.disabled = false;
        }
    });
}

async function loadSidebarResume(token) {
    try {
        const res = await apiFetch(`${getApiBase()}/user/resume`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = res.data;
            const indicator = document.getElementById('be-sidebar-resume-on-file');
            const summary = document.getElementById('be-sidebar-resume-summary');
            const summaryText = document.getElementById('be-sidebar-summary-text');
            if (indicator) indicator.style.display = data.resume_text ? 'block' : 'none';
            if (data.resume_summary) {
                if (summaryText) summaryText.textContent = data.resume_summary;
                if (summary) summary.style.display = 'flex';
            } else {
                if (summary) summary.style.display = 'none';
            }
        }
    } catch (err) {
        console.error('[BetterEmail] Failed to load resume:', err);
    }
}


/* =========================================================
   REMINDERS (sidebar)
========================================================= */

function wireReminders() {
    // Load reminders on init
    chrome.storage.local.get("be_reminders", ({ be_reminders = [] }) => {
        renderSidebarReminders(be_reminders);
    });

    // Re-render whenever storage changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.be_reminders) {
            renderSidebarReminders(changes.be_reminders.newValue || []);
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
    const list = document.getElementById("be-sidebar-reminders-list");
    const badge = document.getElementById("be-sidebar-reminders-badge");
    if (!list || !badge) return;

    if (!reminders || reminders.length === 0) {
        badge.style.display = "none";
        list.innerHTML = `
            <div class="be-sidebar-ri-empty">
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

    sorted.forEach(r => {
        const isFired = r.fired === true;
        const { label, overdue } = isFired ? { label: "Follow up now!", overdue: true } : formatReminderTime(r.dueTime);

        const item = document.createElement("div");
        item.className = "be-sidebar-reminder-item" + (isFired ? " be-ri-fired" : "");
        item.innerHTML = `
            <div class="be-sidebar-ri-dot ${isFired ? "be-ri-dot-fired" : ""}"></div>
            <div class="be-sidebar-ri-info">
                <div class="be-sidebar-ri-subject" title="${escapeHTML(r.subject)}">${escapeHTML(r.subject)}</div>
                <div class="be-sidebar-ri-due ${isFired ? "be-ri-due-fired" : ""}">${label}</div>
            </div>
            <button class="be-sidebar-ri-dismiss" title="Dismiss">&#x2715;</button>
        `;

        item.querySelector(".be-sidebar-ri-dismiss").addEventListener("click", e => {
            e.stopPropagation();
            chrome.runtime.sendMessage({ type: "CLEAR_ALARM", id: r.id });
            chrome.storage.local.get("be_reminders", ({ be_reminders = [] }) => {
                chrome.storage.local.set({ be_reminders: be_reminders.filter(rem => rem.id !== r.id) });
            });
            item.classList.add("be-ri-removing");
            setTimeout(() => item.remove(), 250);
        });

        // Click on item opens the thread
        item.style.cursor = 'pointer';
        item.addEventListener("click", e => {
            if (e.target.closest(".be-sidebar-ri-dismiss")) return;
            const url = contentReminderUrl(r);
            chrome.runtime.sendMessage({ type: "OPEN_TAB", url });
        });

        list.appendChild(item);
    });
}


/* =========================================================
   UI HELPERS
========================================================= */

function escapeHTML(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showSidebarLoading(container, text) {
    container.innerHTML = `
        <div class="be-sidebar-loading">
            <div class="be-sidebar-loading-dots">
                <div class="be-sidebar-dot"></div>
                <div class="be-sidebar-dot"></div>
                <div class="be-sidebar-dot"></div>
            </div>
            <span>${text || 'Loading...'}</span>
        </div>
    `;
}

function showSidebarError(container, message) {
    container.innerHTML = `
        <div class="be-sidebar-error">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>${message}</span>
        </div>
    `;
}

function resetBtn(btn, label, pathD) {
    btn.disabled = false;
    btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="${pathD}"/>
        </svg>
        ${label}
    `;
}

function renderSidebarResults(container, raw) {
    container.innerHTML = "";

    let jsonStr = raw.trim();
    if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    try {
        const sections = JSON.parse(jsonStr);

        const grid = document.createElement("div");
        grid.className = "be-sidebar-results-grid";

        sections.forEach((s, i) => {
            const card = document.createElement("div");
            card.className = "be-sidebar-result-card";
            card.style.animationDelay = `${i * 0.08}s`;

            let accent = "";
            const title = s.title.toLowerCase();
            if (title.includes("grammar")) accent = "accent-blue";
            else if (title.includes("tone")) accent = "accent-purple";
            else if (title.includes("clarity")) accent = "accent-cyan";
            else if (title.includes("suggestion")) accent = "accent-yellow";
            else if (title.includes("verdict")) accent = "accent-green";

            if (accent) card.classList.add(accent);

            card.innerHTML = `
                <div class="be-sidebar-card-header">
                    <span class="be-sidebar-card-icon">${s.icon}</span>
                    <span class="be-sidebar-card-title">${s.title}</span>
                </div>
                <div class="be-sidebar-card-content">${s.content}</div>
            `;

            grid.appendChild(card);
        });

        const closeBtn = document.createElement("button");
        closeBtn.className = "be-sidebar-close-results";
        closeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            Close
        `;
        closeBtn.addEventListener("click", () => { container.innerHTML = ""; });

        container.appendChild(grid);
        container.appendChild(closeBtn);
    } catch (e) {
        container.innerHTML = `<div class="be-sidebar-raw-result">${escapeHTML(raw)}</div>`;
    }
}


/* =========================================================
   FIND EDITOR FUNCTIONS (for sidebar analyzer)
========================================================= */

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
            if (rect.width > 100 && rect.height > 30 && rect.top > 0) {
                return editor;
            }
        }
    }
    return null;
}

function getEditorContent(editor) {
    let content = editor.innerText?.trim() || "";
    if (content) return content;
    content = editor.textContent?.trim() || "";
    if (content) return content;
    const temp = document.createElement("div");
    temp.innerHTML = editor.innerHTML || "";
    return temp.textContent?.trim() || "";
}


/* =========================================================
   SCAN FOR COMPOSE WINDOWS (for send button listener only)
========================================================= */

function scanForComposeWindows() {
    const editors = document.querySelectorAll(
        '[aria-label="Message Body"], ' +
        '[g_editable="true"], ' +
        'div.editable[contenteditable="true"], ' +
        'div[contenteditable="true"][role="textbox"]'
    );

    editors.forEach(editor => {
        const composeBox = editor.closest('div[role="dialog"]') ||
            editor.closest('.M9') ||
            editor.closest('form') ||
            editor.closest('.nH.Hd');

        if (composeBox && !composeBox.dataset.beAttached) {
            composeBox.dataset.beAttached = "true";
            attachSendListener(composeBox);
            console.log("[BetterEmail] Send listener attached to compose window");
        }
    });
}


/* =========================================================
   FOLLOW-UP REMINDER (toast after sending)
========================================================= */

function attachSendListener(composeBox) {
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

    for (const sel of sendSelectors) {
        const el = composeBox.querySelector(sel);
        if (el) { sendBtn = el; break; }
    }

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
        const currentThreadId = getCurrentThreadId();
        const currentThreadPath = getCurrentThreadPath();
        if (currentThreadId) autoDismissReminderForThread(currentThreadId);
        const pendingThread = { id: currentThreadId, path: currentThreadPath };
        if (!currentThreadPath) watchForSentThread(pendingThread);
        setTimeout(() => showReminderPrompt(subject, pendingThread), 600);
    });

    console.log("[BetterEmail] Send button listener attached");
    return true;
}

async function showReminderPrompt(subject, pendingThread = {}) {
    if (!(await isAuthenticated())) return;

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
    attachQuickOptionListeners(toast, subject, pendingThread);
}

function attachQuickOptionListeners(toast, subject, pendingThread = {}) {
    toast.querySelector("[data-dismiss]").addEventListener("click", () => dismissToast(toast));

    toast.querySelectorAll("[data-ms]").forEach(btn => {
        btn.addEventListener("click", () => {
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

    numInput.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Enter") toast.querySelector(".be-custom-set").click();
    });

    toast.querySelector(".be-custom-back").addEventListener("click", () => {
        options.innerHTML = `
            <button class="be-reminder-btn" data-ms="${1 * 24 * 60 * 60 * 1000}" data-label="1 day">1 Day</button>
            <button class="be-reminder-btn" data-ms="${3 * 24 * 60 * 60 * 1000}" data-label="3 days">3 Days</button>
            <button class="be-reminder-btn" data-ms="${7 * 24 * 60 * 60 * 1000}" data-label="1 week">1 Week</button>
            <button class="be-reminder-btn be-reminder-custom-trigger">Custom</button>
            <button class="be-reminder-btn be-reminder-skip" data-dismiss>Skip</button>
        `;
        attachQuickOptionListeners(toast, subject, pendingThread);
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
    const threadId = capturedThreadId || getCurrentThreadId();
    const threadPath = capturedThreadPath || getCurrentThreadPath();
    try {
        chrome.runtime.sendMessage({ type: "SET_REMINDER", id, subject, dueTime, threadId, threadPath });
    } catch (e) {
        console.warn("[BetterEmail] Extension context invalidated — please refresh the page.", e);
    }
}

const GMAIL_THREAD_ID_RE = /^[A-Za-z0-9_\-]{8,}$/;

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

function autoDismissReminderForThread(threadId) {
    chrome.storage.local.get("be_reminders", ({ be_reminders = [] }) => {
        const toRemove = be_reminders.filter(r => r.threadId === threadId);
        if (toRemove.length === 0) return;
        const updated = be_reminders.filter(r => r.threadId !== threadId);
        chrome.storage.local.set({ be_reminders: updated });
        toRemove.forEach(r => chrome.runtime.sendMessage({ type: "CLEAR_ALARM", id: r.id }));
    });
}


/* =========================================================
   SEMANTIC SEARCH BAR — toggle overlay on Gmail search
   (kept as standalone feature on top of Gmail search bar)
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
        const nativeInput = document.querySelector('form[role="search"] input');
        if (nativeInput && !nativeInput.disabled) nativeInput.focus();
    } else {
        overlay.classList.remove('be-overlay-active');
        toggleBtn.classList.remove('be-toggle-active');
        toggleBtn.title = 'Switch to Semantic Search (Shift)';

        const resultsContainer = document.getElementById('be-semantic-results');
        if (resultsContainer) {
            resultsContainer.style.display = 'none';
            resultsContainer.innerHTML = '';
        }

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
    if (!searchForm) {
        // Retry via observer
        const obs = new MutationObserver(() => {
            if (initSemanticSearchBar()) obs.disconnect();
        });
        obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
        return false;
    }

    // Create toggle button
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

    function positionToggle() {
        const rect = searchForm.getBoundingClientRect();
        toggleBtn.style.top = (rect.top + 4) + 'px';
        toggleBtn.style.left = (rect.right + 12) + 'px';
    }
    positionToggle();
    window.addEventListener('resize', positionToggle);
    setInterval(positionToggle, 2000);

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSemanticSearch();
    });

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'be-gmail-search-overlay';
    overlay.className = 'be-gmail-search-overlay';
    overlay.innerHTML = `
        <div id="be-semantic-sync-status" class="be-scraper-status"></div>
        <div id="be-semantic-results" class="be-semantic-results be-gmail-search-results" style="display:none;"></div>
    `;

    const formParent = searchForm.parentElement;
    formParent.style.position = 'relative';
    formParent.insertBefore(overlay, searchForm);

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

    // Listen to native Gmail search input for semantic search
    const nativeSearchInput = searchForm.querySelector('input');
    if (nativeSearchInput) {
        ['keydown', 'keyup', 'keypress', 'input', 'focus', 'click'].forEach(evt => {
            nativeSearchInput.addEventListener(evt, e => {
                if (isSemanticSearchActive) {
                    if (evt === 'keydown' && e.key === 'Enter') {
                        e.preventDefault();
                        handleOverlaySemanticSearch();
                    }
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                }
            }, true);
        });
    }

    // Global Shift to toggle
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
            if (!otherKeyPressedWhileShiftHeld) {
                const activeEl = document.activeElement;
                const isWritingEmail = activeEl && (activeEl.isContentEditable || (activeEl.tagName === 'TEXTAREA') || (activeEl.tagName === 'INPUT' && activeEl !== nativeSearchInput));
                if (!isWritingEmail) {
                    toggleSemanticSearch(!isSemanticSearchActive);
                }
            }
        }
    }, true);

    // Apply auth lock state
    isAuthenticated().then(authed => {
        applySemanticSearchAuthState(overlay, authed);
    });

    return true;
}

async function handleOverlaySemanticSearch() {
    const queryInput = document.querySelector('form[role="search"] input');
    const resultsContainer = document.getElementById('be-semantic-results');
    const overlayEl = document.getElementById('be-gmail-search-overlay');

    const query = queryInput?.value?.trim();
    if (!query) return;

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
            resultsContainer.innerHTML = '<div class="be-scraper-status be-scraper-status-error" style="display:block;">Please sign in via BetterEmail sidebar first.</div>';
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

        renderOverlaySemanticResults(resultsContainer, response.data.results);
    } catch (err) {
        resultsContainer.innerHTML = `<div class="be-scraper-status be-scraper-status-error" style="display:block;">Search failed: ${escapeHTML(err.message)}</div>`;
    } finally {
        if (overlayEl) overlayEl.classList.remove('is-searching');
    }
}

function renderOverlaySemanticResults(container, results) {
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

function applySemanticSearchAuthState(overlay, authed) {
    const nativeInput = document.querySelector('form[role="search"] input');
    if (authed) {
        if (nativeInput && isSemanticSearchActive) {
            nativeInput.placeholder = 'Semantic Search: "Email from Nathan about club opportunity"';
        }
        overlay.classList.remove('be-search-locked');
    } else {
        if (nativeInput && isSemanticSearchActive) {
            nativeInput.placeholder = 'Sign in via sidebar to unlock Semantic Search';
        }
        overlay.classList.add('be-search-locked');
    }
}

function refreshSemanticSearchAuth(authed) {
    const overlay = document.getElementById('be-gmail-search-overlay');
    if (!overlay) return;
    applySemanticSearchAuthState(overlay, authed);
}
