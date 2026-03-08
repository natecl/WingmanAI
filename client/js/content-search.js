/**
 * Wingman V2 — Semantic Search (sidebar panel + Gmail search overlay)
 */


/* =========================================================
   SEMANTIC SEARCH (sidebar panel)
========================================================= */

function wireSemanticSearch(sidebar) {
    const input = sidebar.querySelector('#wm-sidebar-search-input');
    const searchBtn = sidebar.querySelector('#wm-sidebar-search-btn');
    const syncBtn = sidebar.querySelector('#wm-sidebar-sync-btn');
    const resultsEl = sidebar.querySelector('#wm-sidebar-search-results');

    async function handleSearch() {
        const query = input.value.trim();
        if (!query) return;

        searchBtn.disabled = true;
        searchBtn.textContent = 'Searching...';
        resultsEl.innerHTML = '<div class="wm-sidebar-loading"><div class="wm-sidebar-loading-dots"><div class="wm-sidebar-dot"></div><div class="wm-sidebar-dot"></div><div class="wm-sidebar-dot"></div></div><span>Searching...</span></div>';

        try {
            const token = await getContentAccessToken();
            if (!token) {
                resultsEl.innerHTML = '<div class="wm-sidebar-error">Please sign in first.</div>';
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
                resultsEl.innerHTML = `<div class="wm-sidebar-error">${escapeHTML(response.data.error || 'Search failed')}</div>`;
                return;
            }

            renderSidebarSearchResults(resultsEl, response.data.results);
        } catch (err) {
            resultsEl.innerHTML = `<div class="wm-sidebar-error">Search failed: ${escapeHTML(err.message)}</div>`;
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
    const syncStatus = document.getElementById('wm-sidebar-sync-status');
    if (!syncStatus) return;

    if (!silent) {
        syncStatus.textContent = 'Syncing emails...';
        syncStatus.className = 'wm-sidebar-sync-status';
        syncStatus.style.color = 'var(--wm-text-dim)';
    }

    try {
        const session = await getContentSession();
        if (!session || !session.access_token) {
            if (!silent) {
                syncStatus.textContent = 'Please sign in first.';
                syncStatus.className = 'wm-sidebar-sync-status wm-sync-error';
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
                syncStatus.className = 'wm-sidebar-sync-status wm-sync-error';
            }
            return;
        }

        const queued = response.data.queued || 0;
        syncStatus.textContent = `Synced ${response.data.processed} emails, ${queued} queued for indexing.`;
        syncStatus.className = 'wm-sidebar-sync-status wm-sync-success';

        // Trigger background indexing if there are queued jobs
        if (queued > 0) {
            processIndexingQueue(session.access_token, syncStatus);
        }
    } catch (err) {
        if (!silent) {
            syncStatus.textContent = `Sync failed: ${err.message}`;
            syncStatus.className = 'wm-sidebar-sync-status wm-sync-error';
        }
    }
}

/**
 * Process pending indexing jobs by calling the server endpoint in a loop.
 * Each call processes up to 2 jobs (fits within Vercel Hobby 10s timeout).
 * Runs silently in the background until all jobs are done.
 */
async function processIndexingQueue(token, statusEl) {
    const MAX_ITERATIONS = 50; // safety limit
    let totalProcessed = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        try {
            const res = await apiFetch(`${getApiBase()}/api/process-indexing-jobs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!res.ok) break;

            totalProcessed += res.data.processed || 0;
            const remaining = res.data.remaining || 0;

            if (statusEl) {
                statusEl.textContent = `Indexing emails... ${totalProcessed} done, ${remaining} remaining`;
                statusEl.className = 'wm-sidebar-sync-status';
                statusEl.style.color = 'var(--wm-text-dim)';
            }

            if (remaining === 0) break;

            // Small delay between batches to avoid hammering the server
            await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
            console.error('[Wingman] Indexing error:', err.message);
            break;
        }
    }

    if (statusEl && totalProcessed > 0) {
        statusEl.textContent = `Indexing complete — ${totalProcessed} emails indexed.`;
        statusEl.className = 'wm-sidebar-sync-status wm-sync-success';
    }
}

function renderSidebarSearchResults(container, results) {
    if (!results || results.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:var(--wm-text-dim); font-size:0.82rem; padding:16px 0; font-style:italic;">No results found. Try a different query or sync more emails.</div>';
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
        item.className = 'wm-sidebar-search-result-item';
        item.innerHTML = `
            <div class="wm-sidebar-search-result-header">
                <span class="wm-sidebar-search-result-from">${from}</span>
                <span class="wm-sidebar-search-result-date">${escapeHTML(date)}</span>
            </div>
            <div class="wm-sidebar-search-result-subject">${escapeHTML(r.subject || '(no subject)')}</div>
            <div class="wm-sidebar-search-result-snippet">${escapeHTML(r.snippet || '')}</div>
            <a href="${escapeHTML(gmailUrl)}" target="_blank" class="wm-sidebar-search-result-open">Open in Gmail</a>
        `;
        container.appendChild(item);
    });
}


/* =========================================================
   SEMANTIC SEARCH BAR — toggle overlay on Gmail search
   (kept as standalone feature on top of Gmail search bar)
========================================================= */

let isSemanticSearchActive = false;

function toggleSemanticSearch(forceState) {
    const overlay = document.getElementById('wm-gmail-search-overlay');
    const toggleBtn = document.getElementById('wm-semantic-toggle-btn');
    if (!overlay || !toggleBtn) return;

    isSemanticSearchActive = typeof forceState === 'boolean' ? forceState : !isSemanticSearchActive;

    if (isSemanticSearchActive) {
        overlay.classList.add('wm-overlay-active');
        toggleBtn.classList.add('wm-toggle-active');
        toggleBtn.title = 'Switch to Gmail Search (Shift)';
        const nativeInput = document.querySelector('form[role="search"] input');
        if (nativeInput && !nativeInput.disabled) nativeInput.focus();
    } else {
        overlay.classList.remove('wm-overlay-active');
        toggleBtn.classList.remove('wm-toggle-active');
        toggleBtn.title = 'Switch to Semantic Search (Shift)';

        const resultsContainer = document.getElementById('wm-semantic-results');
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
    if (document.getElementById('wm-gmail-search-overlay')) return true;

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
    toggleBtn.id = 'wm-semantic-toggle-btn';
    toggleBtn.className = 'wm-semantic-toggle-btn';
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
        const helpBtn = document.querySelector('header#gb a[href*="support.google.com"], header#gb a[aria-label*="Support"], header#gb a[aria-label*="Help"]');
        const isSidebarActive = document.body.classList.contains('wm-sidebar-active');

        if (isSidebarActive && helpBtn) {
            // Position cleanly over the help button when sidebar open
            const rect = helpBtn.getBoundingClientRect();
            toggleBtn.style.top = rect.top + 'px';
            toggleBtn.style.left = rect.left + 'px';
            toggleBtn.style.width = rect.width + 'px';
            toggleBtn.style.height = rect.height + 'px';
            toggleBtn.style.background = ''; // Allow CSS hover to work
            toggleBtn.style.boxShadow = 'none';
            helpBtn.style.opacity = '0';
        } else {
            // Default position next to search bar
            if (helpBtn) helpBtn.style.opacity = '1';
            toggleBtn.style.width = '40px';
            toggleBtn.style.height = '40px';
            toggleBtn.style.background = '';
            toggleBtn.style.boxShadow = '';

            const rect = searchForm.getBoundingClientRect();
            toggleBtn.style.top = (rect.top + 4) + 'px';
            toggleBtn.style.left = (rect.right + 12) + 'px';
        }
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
    overlay.id = 'wm-gmail-search-overlay';
    overlay.className = 'wm-gmail-search-overlay';
    overlay.innerHTML = `
        <div id="wm-semantic-sync-status" class="wm-scraper-status"></div>
        <div id="wm-semantic-results" class="wm-semantic-results wm-gmail-search-results" style="display:none;"></div>
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
    const resultsContainer = document.getElementById('wm-semantic-results');
    const overlayEl = document.getElementById('wm-gmail-search-overlay');

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
    resultsContainer.innerHTML = '<div class="wm-scraper-status wm-scraper-status-loading" style="display:block;">Searching your emails...</div>';

    try {
        const token = await getContentAccessToken();
        if (!token) {
            resultsContainer.innerHTML = '<div class="wm-scraper-status wm-scraper-status-error" style="display:block;">Please sign in via Wingman sidebar first.</div>';
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
            resultsContainer.innerHTML = `<div class="wm-scraper-status wm-scraper-status-error" style="display:block;">${escapeHTML(response.data.error || 'Search failed')}</div>`;
            return;
        }

        renderOverlaySemanticResults(resultsContainer, response.data.results);
    } catch (err) {
        resultsContainer.innerHTML = `<div class="wm-scraper-status wm-scraper-status-error" style="display:block;">Search failed: ${escapeHTML(err.message)}</div>`;
    } finally {
        if (overlayEl) overlayEl.classList.remove('is-searching');
    }
}

function renderOverlaySemanticResults(container, results) {
    if (!results || results.length === 0) {
        container.innerHTML = '<div class="wm-semantic-empty">No results found. Try a different query or sync more emails.</div>';
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
        item.className = 'wm-semantic-result-item';
        item.innerHTML = `
            <div class="wm-semantic-result-header">
                <span class="wm-semantic-result-from">${from}</span>
                <span class="wm-semantic-result-date">${escapeHTML(date)}</span>
            </div>
            <div class="wm-semantic-result-subject">${escapeHTML(r.subject || '(no subject)')}</div>
            <div class="wm-semantic-result-snippet">${escapeHTML(r.snippet || '')}</div>
            <a href="${escapeHTML(gmailUrl)}" target="_blank" class="wm-semantic-result-open">Open in Gmail</a>
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
        overlay.classList.remove('wm-search-locked');
    } else {
        if (nativeInput && isSemanticSearchActive) {
            nativeInput.placeholder = 'Sign in via sidebar to unlock Semantic Search';
        }
        overlay.classList.add('wm-search-locked');
    }
}

function refreshSemanticSearchAuth(authed) {
    const overlay = document.getElementById('wm-gmail-search-overlay');
    if (!overlay) return;
    applySemanticSearchAuthState(overlay, authed);
}
