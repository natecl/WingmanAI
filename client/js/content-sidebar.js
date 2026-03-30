/**
 * Wingman V2 — Sidebar Injection, HTML, Events & Auth State
 */


/* =========================================================
   SIDEBAR INJECTION
========================================================= */

function injectSidebar() {
    if (document.getElementById('wm-sidebar-wrapper')) return;

    // Create sidebar wrapper
    const sidebar = document.createElement('div');
    sidebar.id = 'wm-sidebar-wrapper';
    sidebar.innerHTML = buildSidebarHTML();
    document.body.appendChild(sidebar);

    // Create toggle button (for collapsed state)
    const toggle = document.createElement('button');
    toggle.id = 'wm-sidebar-toggle';
    toggle.title = 'Open Wingman';
    toggle.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
        </svg>
    `;
    document.body.appendChild(toggle);

    // Shift Gmail layout
    document.body.classList.add('wm-sidebar-active');
    document.documentElement.classList.add('wm-sidebar-active');

    // Wire up all sidebar functionality
    wireSidebarEvents(sidebar, toggle);

    // Initialize auth state
    refreshSidebarAuth();

    // Initialize semantic search bar (kept as overlay on Gmail search)
    initSemanticSearchBar();

    console.log("[Wingman] Sidebar injected");
}


/* =========================================================
   SIDEBAR HTML BUILDER
========================================================= */

function buildSidebarHTML() {
    return `
        <!-- Header -->
        <div class="wm-sidebar-header">
            <div class="wm-sidebar-header-left">
                <div class="wm-sidebar-logo-dot"></div>
                <h1>Wingman</h1>
            </div>
            <div class="wm-sidebar-header-right">
                <span id="wm-sidebar-user-email" class="wm-sidebar-user-email" style="display:none;"></span>
                <button id="wm-sidebar-signout" class="wm-sidebar-signout-btn" title="Sign out" style="display:none;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                        <polyline points="16 17 21 12 16 7"/>
                        <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                </button>
                <button id="wm-sidebar-collapse" class="wm-sidebar-collapse-btn" title="Minimize sidebar">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"/>
                    </svg>
                </button>
            </div>
        </div>

        <!-- Auth card (shown when signed out) -->
        <div id="wm-sidebar-auth-card" class="wm-sidebar-auth-card" style="display:none;">
            <div class="wm-sidebar-auth-inner">
                <h2>Sign in to unlock Wingman</h2>
                <p>Sign in with Google to access all features.</p>
                <button id="wm-sidebar-signin" class="wm-sidebar-auth-btn">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    Sign in with Google
                </button>
            </div>
        </div>

        <!-- Tab navigation (shown when signed in) -->
        <div class="wm-sidebar-tabs" id="wm-sidebar-tabs" style="display:none;">
            <button class="wm-sidebar-tab wm-sidebar-tab-active" data-tab="main">Main</button>
            <button class="wm-sidebar-tab" data-tab="leads">Research</button>
            <button class="wm-sidebar-tab" data-tab="search">Search</button>
            <button class="wm-sidebar-tab" data-tab="media">Media</button>
            <button class="wm-sidebar-tab" data-tab="settings">Settings</button>
        </div>

        <!-- Main Panel -->
        <div class="wm-sidebar-panel wm-sidebar-panel-active" id="wm-sidebar-panel-main">
            <!-- Inbox Summary -->
            <div class="wm-sidebar-card" id="wm-inbox-summary-card">
                <div class="wm-sidebar-section-title">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
                        <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
                    </svg>
                    <span>Inbox</span>
                    <span class="wm-inbox-priority-count" id="wm-inbox-priority-count" style="display:none;"></span>
                </div>
                <div id="wm-inbox-summary-list">
                    <div class="wm-inbox-loading"><span class="wm-lead-summary-loading">Loading emails...</span></div>
                </div>
            </div>

            <!-- Priority Contacts -->
            <div class="wm-sidebar-card">
                <div class="wm-sidebar-section-title">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                    <span>Priority Contacts</span>
                </div>
                <div class="wm-priority-swatches" id="wm-priority-swatches"></div>
                <div class="wm-priority-add-row">
                    <input type="text" class="wm-priority-input" id="wm-priority-input"
                        placeholder="Name or email address...">
                    <button class="wm-priority-add-btn" id="wm-priority-add-btn">Add</button>
                </div>
                <div class="wm-priority-list" id="wm-priority-list"></div>
            </div>

            <!-- Reminders -->
            <div class="wm-sidebar-card">
                <div class="wm-sidebar-reminders-header">
                    <div class="wm-sidebar-reminders-title">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                        </svg>
                        <span>Follow-up Reminders</span>
                    </div>
                    <span class="wm-sidebar-reminders-badge" id="wm-sidebar-reminders-badge" style="display:none;">0</span>
                </div>
                <div id="wm-sidebar-reminders-list"></div>
            </div>

            <!-- Compose Analyzer -->
            <div class="wm-sidebar-card">
                <div class="wm-sidebar-compose-section">
                    <div class="wm-sidebar-section-title">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                        </svg>
                        <span>Email Analyzer</span>
                    </div>
                    <input type="text" class="wm-sidebar-context-input" id="wm-sidebar-context"
                        placeholder="What's this email for? (e.g., job application, follow-up)">
                    <div class="wm-sidebar-compose-hint">Open a compose window, then click Analyze to review your email.</div>
                    <div class="wm-sidebar-compose-actions">
                        <button class="wm-sidebar-analyze-btn" id="wm-sidebar-analyze-btn">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                            </svg>
                            Analyze
                        </button>
                        <button class="wm-sidebar-draft-btn" id="wm-sidebar-draft-btn">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                            Draft
                        </button>
                    </div>
                    <div class="wm-sidebar-results-area" id="wm-sidebar-analyzer-results"></div>
                </div>
            </div>
        </div>

        <!-- Research Finder Panel -->
        <div class="wm-sidebar-panel" id="wm-sidebar-panel-leads">
            <div class="wm-sidebar-card">
                <div class="wm-sidebar-section-title">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <span>Research Finder</span>
                </div>
                <div class="wm-sidebar-lead-hint">
                    Match your research interests with professors at your university, then draft personalized outreach.
                </div>
                <input type="text" class="wm-sidebar-lead-input" id="wm-sidebar-lead-input"
                    placeholder="Research area of interest (e.g. computer vision, robotics, NLP)">
                <input type="text" class="wm-sidebar-lead-input" id="wm-sidebar-lead-org"
                    placeholder="University (e.g. University of Florida, UF, MIT)">
                <input type="number" class="wm-sidebar-lead-input wm-sidebar-lead-count" id="wm-sidebar-lead-count"
                    min="1" max="10" value="5" placeholder="Professors to contact (max 10)">
                <button class="wm-sidebar-lead-btn" id="wm-sidebar-lead-btn">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 2L11 13"/>
                        <path d="M22 2L15 22L11 13L2 9L22 2Z"/>
                    </svg>
                    Find Professors &amp; Send
                </button>
                <div class="wm-sidebar-lead-status" id="wm-sidebar-lead-status"></div>
                <div class="wm-sidebar-lead-log" id="wm-sidebar-lead-log"></div>
            </div>
        </div>

        <!-- Semantic Search Panel -->
        <div class="wm-sidebar-panel" id="wm-sidebar-panel-search">
            <div class="wm-sidebar-card">
                <div class="wm-sidebar-section-title">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <span>Semantic Search</span>
                </div>
                <input type="text" class="wm-sidebar-search-input" id="wm-sidebar-search-input"
                    placeholder='e.g. "Email from Nathan about club opportunity"'>
                <div class="wm-sidebar-search-actions">
                    <button class="wm-sidebar-search-btn" id="wm-sidebar-search-btn">Search</button>
                    <button class="wm-sidebar-sync-btn" id="wm-sidebar-sync-btn">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"/>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                        Sync
                    </button>
                </div>
                <div class="wm-sidebar-sync-status" id="wm-sidebar-sync-status"></div>
                <div class="wm-sidebar-search-results" id="wm-sidebar-search-results"></div>
            </div>
        </div>

        <!-- Media Panel -->
        <div class="wm-sidebar-panel" id="wm-sidebar-panel-media">
            <div class="wm-sidebar-card">
                <div class="wm-sidebar-section-title">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span>Media</span>
                </div>
                <div class="wm-media-toolbar">
                    <input type="text" class="wm-media-search-input" id="wm-media-search"
                        placeholder="Search files...">
                    <button class="wm-media-upload-btn" id="wm-media-upload-btn">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="16 16 12 12 8 16"/>
                            <line x1="12" y1="12" x2="12" y2="21"/>
                            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                        </svg>
                        Upload
                    </button>
                    <input type="file" id="wm-media-file-input" accept=".pdf,image/*" style="display:none;">
                </div>
                <div class="wm-media-sort-row">
                    <span class="wm-media-sort-label">Sort:</span>
                    <button class="wm-media-sort-btn wm-media-sort-active" data-sort="newest">Newest</button>
                    <button class="wm-media-sort-btn" data-sort="oldest">Oldest</button>
                    <button class="wm-media-sort-btn" data-sort="name">Name</button>
                    <button class="wm-media-sort-btn" data-sort="size">Size</button>
                </div>
                <div class="wm-media-filters" id="wm-media-filters">
                    <button class="wm-media-filter-btn wm-media-filter-active" data-filter="all">All</button>
                    <button class="wm-media-filter-btn wm-media-filter-important" data-filter="important">⭐ Important</button>
                    <button class="wm-media-filter-btn" data-filter="pdf">PDF</button>
                    <button class="wm-media-filter-btn" data-filter="image">Images</button>
                    <button class="wm-media-filter-btn" data-filter="jpeg">JPEG</button>
                    <button class="wm-media-filter-btn" data-filter="png">PNG</button>
                </div>
                <div class="wm-media-daterange">
                    <div class="wm-media-daterange-inputs">
                        <div class="wm-media-date-field">
                            <label class="wm-media-date-label">From</label>
                            <input type="date" class="wm-media-date-input" id="wm-media-date-from">
                        </div>
                        <span class="wm-media-date-sep">→</span>
                        <div class="wm-media-date-field">
                            <label class="wm-media-date-label">To</label>
                            <input type="date" class="wm-media-date-input" id="wm-media-date-to">
                        </div>
                        <button class="wm-media-date-clear" id="wm-media-date-clear" title="Clear date range">✕</button>
                    </div>
                </div>
                <div class="wm-media-upload-status" id="wm-media-upload-status"></div>
                <div class="wm-media-list" id="wm-media-list"></div>
                <div class="wm-media-empty" id="wm-media-empty">
                    <div class="wm-media-empty-icon">🖼️</div>
                    <div class="wm-media-empty-text">No media yet.<br>Attachments from your emails will appear here after syncing.</div>
                </div>
            </div>
        </div>

        <!-- Settings Panel -->
        <div class="wm-sidebar-panel" id="wm-sidebar-panel-settings">
            <div class="wm-sidebar-card">
                <h3 class="wm-sidebar-settings-title">Your Resume</h3>
                <div class="wm-sidebar-resume-on-file" id="wm-sidebar-resume-on-file">
                    Resume on file — upload a new PDF to replace it.
                </div>
                <p class="wm-sidebar-settings-desc">Upload your resume as a PDF. Wingman will use it to draft personalized outreach emails directly in Gmail.</p>
                <div class="wm-sidebar-upload-zone" id="wm-sidebar-upload-zone">
                    <input type="file" id="wm-sidebar-resume-file" accept=".pdf" style="display:none;">
                    <div class="wm-sidebar-upload-icon">📄</div>
                    <div class="wm-sidebar-upload-text">Drop your PDF here or <span class="wm-sidebar-upload-link" id="wm-sidebar-upload-browse">browse</span></div>
                    <div class="wm-sidebar-upload-hint">Max 5 MB · text-based PDFs only</div>
                </div>
                <div class="wm-sidebar-file-chosen" id="wm-sidebar-file-chosen">
                    <span class="wm-sidebar-file-icon">📎</span>
                    <span class="wm-sidebar-file-name" id="wm-sidebar-file-name"></span>
                    <button class="wm-sidebar-file-remove" id="wm-sidebar-file-remove">✕</button>
                </div>
                <button id="wm-sidebar-resume-save" class="wm-sidebar-resume-save" disabled>Upload Resume</button>
                <div id="wm-sidebar-resume-status" class="wm-sidebar-resume-status"></div>
                <div class="wm-sidebar-resume-summary" id="wm-sidebar-resume-summary">
                    <div class="wm-sidebar-summary-label">AI Summary</div>
                    <div class="wm-sidebar-summary-text" id="wm-sidebar-summary-text"></div>
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
    sidebar.querySelector('#wm-sidebar-collapse').addEventListener('click', () => {
        sidebar.classList.add('wm-sidebar-collapsed');
        document.body.classList.remove('wm-sidebar-active');
        document.documentElement.classList.remove('wm-sidebar-active');
    });

    toggle.addEventListener('click', () => {
        sidebar.classList.remove('wm-sidebar-collapsed');
        document.body.classList.add('wm-sidebar-active');
        document.documentElement.classList.add('wm-sidebar-active');
    });

    // --- Tab switching ---
    sidebar.querySelectorAll('.wm-sidebar-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            sidebar.querySelectorAll('.wm-sidebar-tab').forEach(t => t.classList.remove('wm-sidebar-tab-active'));
            sidebar.querySelectorAll('.wm-sidebar-panel').forEach(p => p.classList.remove('wm-sidebar-panel-active'));
            tab.classList.add('wm-sidebar-tab-active');
            sidebar.querySelector(`#wm-sidebar-panel-${tab.dataset.tab}`).classList.add('wm-sidebar-panel-active');
        });
    });

    // --- Sign in ---
    sidebar.querySelector('#wm-sidebar-signin').addEventListener('click', async () => {
        const btn = sidebar.querySelector('#wm-sidebar-signin');
        btn.disabled = true;
        btn.textContent = 'Signing in...';
        try {
            await signInWithGoogle();
            await refreshSidebarAuth();
        } catch (err) {
            console.error('[Wingman] Sign-in failed:', err);
            alert('Sign-in error: ' + err.message);
        }
        btn.disabled = false;
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Sign in with Google
        `;
    });

    // --- Sign out ---
    sidebar.querySelector('#wm-sidebar-signout').addEventListener('click', async () => {
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
    wireMediaTab(sidebar);
    wireReminders();
    wirePriorityContacts(sidebar);
}


/* =========================================================
   AUTH STATE MANAGEMENT
========================================================= */

async function refreshSidebarAuth() {
    const sidebar = document.getElementById('wm-sidebar-wrapper');
    if (!sidebar) return;

    const session = await getContentSession();
    const authed = !!(session && session.access_token);

    const authCard = sidebar.querySelector('#wm-sidebar-auth-card');
    const tabs = sidebar.querySelector('#wm-sidebar-tabs');
    const userEmail = sidebar.querySelector('#wm-sidebar-user-email');
    const signoutBtn = sidebar.querySelector('#wm-sidebar-signout');
    const panels = sidebar.querySelectorAll('.wm-sidebar-panel');

    if (authed) {
        authCard.style.display = 'none';
        tabs.style.display = 'flex';
        if (session.user && session.user.email) {
            userEmail.textContent = session.user.email;
            userEmail.style.display = 'inline';
        }
        signoutBtn.style.display = 'flex';
        panels.forEach(p => {
            if (p.classList.contains('wm-sidebar-panel-active')) p.style.display = '';
        });
        // Load resume data
        loadSidebarResume(session.access_token);
        // Auto-sync emails
        handleSidebarSync(true);
        // Load inbox summary
        loadEmailSummary(sidebar);
    } else {
        authCard.style.display = 'flex';
        tabs.style.display = 'none';
        userEmail.style.display = 'none';
        signoutBtn.style.display = 'none';
        // Hide all panels
        panels.forEach(p => p.classList.remove('wm-sidebar-panel-active'));
    }

    // Also refresh semantic search overlay auth
    refreshSemanticSearchAuth(authed);
}


/* =========================================================
   INBOX EMAIL SUMMARY — GMAIL HIGHLIGHT + DISMISS
========================================================= */

// Map of threadId → { subject, from } for high-priority emails.
// Storing metadata allows text-content matching when data attributes aren't available.
const _wmHighPriorityEmails = new Map();
let _wmGmailObserver = null;
let _wmHighlightTimeout = null;

// Gmail API returns hex thread IDs. Gmail's DOM may use decimal or "thread-f:DECIMAL".
function _wmThreadIdVariants(hexId) {
    if (!hexId) return [];
    const variants = [hexId];
    try {
        const dec = BigInt('0x' + hexId).toString();
        variants.push(dec);
        variants.push('thread-f:' + dec);
        variants.push('thread-a:r-' + dec);
    } catch (_) {}
    return variants;
}

// Inject styles for the amber marker strip inserted into priority rows.
function _wmEnsureHighlightCSS() {
    if (document.getElementById('wm-priority-style')) return;
    const s = document.createElement('style');
    s.id = 'wm-priority-style';
    s.textContent = `
        .wm-priority-marker {
            display: block !important;
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 4px !important;
            height: 100% !important;
            min-height: 20px !important;
            background: #f59e0b !important;
            pointer-events: none !important;
            z-index: 9999 !important;
        }
        tr.wm-priority-row > td,
        tr.wm-priority-row > td > div,
        tr.wm-priority-row > td > div > div {
            background-color: rgba(245,158,11,0.14) !important;
            background: rgba(245,158,11,0.14) !important;
        }
    `;
    document.head.appendChild(s);
}

// Find a Gmail inbox row using multiple strategies.
// emailData = { subject, from } is used for content-based fallback.
// Returns true if an element is inside the Wingman sidebar (not a Gmail inbox element).
function _wmIsOwnElement(el) {
    return !!(el && el.closest('#wm-sidebar-wrapper'));
}

function _wmFindGmailRow(threadId, emailData) {
    const variants = _wmThreadIdVariants(threadId);

    // Strategy 1: data-thread-id attribute — must NOT be inside our own sidebar
    for (const v of variants) {
        for (const el of document.querySelectorAll(`[data-thread-id="${v}"]`)) {
            if (_wmIsOwnElement(el)) continue;
            const r = el.closest('tr') || el;
            if (r.tagName === 'TR') return r;
        }
    }

    // Strategy 2: data-legacy-thread-id
    for (const v of variants) {
        for (const el of document.querySelectorAll(`[data-legacy-thread-id="${v}"]`)) {
            if (_wmIsOwnElement(el)) continue;
            const r = el.closest('tr') || el;
            if (r.tagName === 'TR') return r;
        }
    }

    // Strategy 3: anchor href containing any variant (outside sidebar)
    for (const v of variants) {
        for (const link of document.querySelectorAll(`a[href*="${v}"]`)) {
            if (_wmIsOwnElement(link)) continue;
            const row = link.closest('tr');
            if (row) return row;
        }
    }

    // Strategy 4: scan Gmail inbox <tr> rows (zA = unread, zE = read) for variant in innerHTML
    for (const row of document.querySelectorAll('tr.zA, tr.zE')) {
        for (const v of variants) {
            if (row.innerHTML.includes(v)) return row;
        }
    }

    // Strategy 5: text-content match on Gmail inbox rows (first 20 chars of subject)
    if (emailData && emailData.subject) {
        const needle = emailData.subject.toLowerCase().trim().substring(0, 20);
        if (needle.length > 5) {
            for (const row of document.querySelectorAll('tr.zA, tr.zE')) {
                if (row.textContent.toLowerCase().includes(needle)) return row;
            }
        }
    }

    return null;
}

function _wmHighlightRow(row) {
    if (!row) return;
    // Do NOT skip rows that already have data-wm-priority — stale attribute from
    // a previous extension load could prevent the marker from ever being inserted.
    row.setAttribute('data-wm-priority', '1');
    row.classList.add('wm-priority-row');
    // Inject a solid amber strip into the first <td>.
    // This is a brand-new element; Gmail has no styles on it, so it is always visible.
    // box-shadow on <tr> works in Chrome even with border-collapse
    row.style.setProperty('box-shadow', 'inset 4px 0 0 #f59e0b', 'important');
    // Also inject a marker div into the first <td> as a belt-and-suspenders fallback
    const firstTd = row.querySelector('td');
    if (firstTd && !firstTd.querySelector('.wm-priority-marker')) {
        // Set position:relative inline so the absolute marker is anchored to this cell
        firstTd.style.setProperty('position', 'relative', 'important');
        const marker = document.createElement('div');
        marker.className = 'wm-priority-marker';
        firstTd.prepend(marker);
    }
}

function _wmUnhighlightRow(row) {
    if (!row) return;
    row.removeAttribute('data-wm-priority');
    row.classList.remove('wm-priority-row');
    row.style.removeProperty('box-shadow');
    const marker = row.querySelector('.wm-priority-marker');
    if (marker) marker.remove();
    const firstTd = row.querySelector('td');
    if (firstTd) firstTd.style.removeProperty('position');
}

function applyGmailHighlights() {
    _wmEnsureHighlightCSS();
    if (!_wmHighPriorityEmails.size) return;
    _wmHighPriorityEmails.forEach((emailData, threadId) => {
        const row = _wmFindGmailRow(threadId, emailData);
        if (row) _wmHighlightRow(row);
    });
}

function setupGmailHighlightObserver() {
    if (_wmGmailObserver) return;
    _wmGmailObserver = new MutationObserver(() => {
        clearTimeout(_wmHighlightTimeout);
        _wmHighlightTimeout = setTimeout(applyGmailHighlights, 400);
    });
    _wmGmailObserver.observe(document.body, { childList: true, subtree: true });
}

function _wmFadeRemoveItem(item) {
    if (!item) return;
    item.style.transition = 'opacity 0.35s ease, max-height 0.35s ease, margin 0.35s ease, padding 0.35s ease';
    item.style.overflow = 'hidden';
    item.style.opacity = '0';
    item.style.maxHeight = '0';
    item.style.marginBottom = '0';
    item.style.padding = '0';
    setTimeout(() => item.remove(), 380);
}

// Called when user sends a reply. threadId may be null for popup-compose replies,
// so also match by subject (stripped of Re: prefix).
function dismissInboxItem(threadId, subject) {
    // Remove from highlight set and Gmail row
    if (threadId) {
        const emailData = _wmHighPriorityEmails.get(threadId);
        _wmHighPriorityEmails.delete(threadId);
        _wmUnhighlightRow(_wmFindGmailRow(threadId, emailData));
    }

    // Find sidebar item by threadId first, fall back to subject match
    let item = threadId
        ? document.querySelector(`.wm-inbox-item-link[data-thread-id="${threadId}"]`)
        : null;

    if (!item && subject) {
        const normalize = s => s.replace(/^(re:\s*)+/i, '').toLowerCase().trim();
        const clean = normalize(subject);
        for (const el of document.querySelectorAll('.wm-inbox-item-link')) {
            if (normalize(el.dataset.subject || '') === clean) {
                item = el;
                // Also remove from highlight set by its thread ID
                const tid = el.dataset.threadId;
                if (tid) {
                    const emailData = _wmHighPriorityEmails.get(tid);
                    _wmHighPriorityEmails.delete(tid);
                    _wmUnhighlightRow(_wmFindGmailRow(tid, emailData));
                }
                break;
            }
        }
    }

    _wmFadeRemoveItem(item);
}

/* =========================================================
   INBOX DISMISS — persistent storage helpers
========================================================= */

function _wmGetDismissedIds() {
    return new Promise(resolve => {
        chrome.storage.local.get('wm_dismissed_inbox', result => {
            resolve(result.wm_dismissed_inbox || []);
        });
    });
}

function _wmSaveDismissedId(threadId) {
    if (!threadId) return;
    _wmGetDismissedIds().then(existing => {
        if (!existing.includes(threadId)) {
            chrome.storage.local.set({ wm_dismissed_inbox: [...existing, threadId] });
        }
    });
}

/* =========================================================
   INBOX EMAIL SUMMARY
========================================================= */

function formatRelativeTime(dateStr) {
    const date = new Date(typeof dateStr === 'number' ? dateStr : dateStr);
    if (isNaN(date.getTime())) return '';
    const now = Date.now();
    const diff = now - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function loadEmailSummary(sidebar) {
    const listEl = sidebar.querySelector('#wm-inbox-summary-list');
    const countEl = sidebar.querySelector('#wm-inbox-priority-count');
    if (!listEl) return;

    listEl.innerHTML = '<div class="wm-inbox-loading"><span class="wm-lead-summary-loading">Loading emails...</span></div>';

    try {
        const token = await getContentAccessToken();
        const res = await apiFetch(`${getApiBase()}/emails/summary`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(res.data?.error || 'Request failed');
        const dismissed = new Set(await _wmGetDismissedIds());
        const emails = (res.data?.emails || []).filter(e => !dismissed.has(e.thread_id));

        if (!emails.length) {
            listEl.innerHTML = '<div class="wm-inbox-empty">No emails found. Sync your inbox first.</div>';
            return;
        }

        const highCount = emails.filter(e => e.priority === 'high').length;
        if (highCount > 0) {
            countEl.textContent = `${highCount} priority`;
            countEl.style.display = 'inline';
        } else {
            countEl.style.display = 'none';
        }

        const high   = emails.filter(e => e.priority === 'high');
        const medium = emails.filter(e => e.priority === 'medium');
        const low    = emails.filter(e => e.priority === 'low');

        // Register high-priority threads for Gmail highlighting
        _wmHighPriorityEmails.clear();
        high.forEach(e => {
            if (e.thread_id) _wmHighPriorityEmails.set(e.thread_id, {
                subject: e.subject || '',
                from: e.from_name || e.from_email || ''
            });
        });

        // Highlight priority contact emails using user-defined colors
        applyContactPriorityFromEmails(emails);

        function renderItem(email) {
            const priorityClass = email.priority === 'high' ? 'wm-inbox-high'
                : email.priority === 'medium' ? 'wm-inbox-medium'
                : 'wm-inbox-low';
            const from = email.from_name || email.from_email || 'Unknown';
            const subject = email.subject || '(no subject)';
            const time = formatRelativeTime(email.internal_date);
            const reason = email.reason || '';
            return `
                <div class="wm-inbox-item ${priorityClass} wm-inbox-item-link" data-thread-id="${escapeHTML(email.thread_id || '')}" data-subject="${escapeHTML(email.subject || '')}">
                    <button class="wm-inbox-dismiss-btn" title="Dismiss">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                    <div class="wm-inbox-item-header">
                        <span class="wm-inbox-priority-dot"></span>
                        <span class="wm-inbox-from" title="${escapeHTML(from)}">${escapeHTML(from)}</span>
                        <span class="wm-inbox-time">${time}</span>
                    </div>
                    <div class="wm-inbox-subject">${escapeHTML(subject)}</div>
                    ${reason ? `<div class="wm-inbox-reason">${escapeHTML(reason)}</div>` : ''}
                </div>
            `;
        }

        function renderCollapsible(id, labelClass, labelText, items, open = false) {
            return `
                <div class="wm-inbox-tier-label ${labelClass} wm-inbox-tier-collapsible${open ? ' wm-inbox-tier-open' : ''}" data-target="${id}">
                    <svg class="wm-inbox-chevron" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="9 18 15 12 9 6"/>
                    </svg>
                    ${labelText}
                    <span class="wm-inbox-tier-count">${items.length}</span>
                </div>
                <div id="${id}" class="wm-inbox-collapsible-section" style="display:${open ? 'block' : 'none'};">
                    ${items.map(renderItem).join('')}
                </div>
            `;
        }

        const sections = [];
        if (high.length)   sections.push(renderCollapsible('wm-inbox-high-items', 'wm-inbox-tier-high', 'Priority', high, true));
        if (medium.length) sections.push(renderCollapsible('wm-inbox-medium-items', 'wm-inbox-tier-medium', 'Regular', medium));
        if (low.length)    sections.push(renderCollapsible('wm-inbox-low-items', 'wm-inbox-tier-low', 'Newsletters & Notifications', low));
        listEl.innerHTML = sections.join('');

        // Apply Gmail row highlights and keep them live
        applyGmailHighlights();
        setupGmailHighlightObserver();

        // Wire collapse toggles
        listEl.querySelectorAll('.wm-inbox-tier-collapsible').forEach(label => {
            label.addEventListener('click', () => {
                const target = listEl.querySelector(`#${label.dataset.target}`);
                const isOpen = target.style.display !== 'none';
                target.style.display = isOpen ? 'none' : 'block';
                label.classList.toggle('wm-inbox-tier-open', !isOpen);
            });
        });

        // Wire dismiss X buttons
        listEl.querySelectorAll('.wm-inbox-dismiss-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const item = btn.closest('.wm-inbox-item');
                const threadId = item?.dataset.threadId;
                _wmSaveDismissedId(threadId);
                if (threadId) {
                    const emailData = _wmHighPriorityEmails.get(threadId);
                    _wmHighPriorityEmails.delete(threadId);
                    _wmUnhighlightRow(_wmFindGmailRow(threadId, emailData));
                }
                _wmFadeRemoveItem(item);
            });
        });

        // Wire email item clicks — navigate to the Gmail thread
        listEl.querySelectorAll('.wm-inbox-item-link').forEach(item => {
            item.addEventListener('click', () => {
                const threadId = item.dataset.threadId;
                if (!threadId) return;
                const base = window.location.origin + window.location.pathname;
                window.location.href = base + '#inbox/' + threadId;
            });
        });
    } catch (err) {
        console.error('[Wingman] Inbox summary failed:', err);
        listEl.innerHTML = '<div class="wm-inbox-empty">Could not load inbox summary.</div>';
    }
}
