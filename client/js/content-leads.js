/**
 * Wingman V2 — Lead Finder Agent
 * Scrapes leads, drafts personalized emails, and auto-sends via Gmail API.
 */


/* =========================================================
   HELPERS
========================================================= */

function appendLog(logEl, message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `wm-lead-log-entry log-${type}`;
    entry.textContent = message;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
}

async function getProviderToken() {
    return new Promise((resolve) => {
        chrome.storage.local.get('wm_supabase_session', (result) => {
            const session = result['wm_supabase_session'];
            resolve(session?.provider_token || null);
        });
    });
}

function resetLeadFinderButton(btn) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('d', 'M22 2L11 13');
    const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path2.setAttribute('d', 'M22 2L15 22L11 13L2 9L22 2Z');
    svg.appendChild(path1);
    svg.appendChild(path2);
    btn.textContent = '';
    btn.appendChild(svg);
    btn.appendChild(document.createTextNode(' Find & Send'));
}


/* =========================================================
   LEAD FINDER AGENT (sidebar)
========================================================= */

function wireLeadFinder(sidebar) {
    const input = sidebar.querySelector('#wm-sidebar-lead-input');
    const orgInput = sidebar.querySelector('#wm-sidebar-lead-org');
    const countInput = sidebar.querySelector('#wm-sidebar-lead-count');
    const btn = sidebar.querySelector('#wm-sidebar-lead-btn');
    const statusEl = sidebar.querySelector('#wm-sidebar-lead-status');
    const logEl = sidebar.querySelector('#wm-sidebar-lead-log');

    let running = false;

    async function runAgent() {
        if (running) return;

        // --- Validate inputs ---
        const query = input.value.trim();
        if (!query) {
            statusEl.className = 'wm-sidebar-lead-status wm-status-error';
            statusEl.textContent = 'Please enter a search query.';
            return;
        }

        const count = Math.min(Math.max(parseInt(countInput.value) || 5, 1), 10);
        countInput.value = count;

        const org = orgInput.value.trim();

        // --- Pre-flight checks ---
        const token = await getContentAccessToken();
        if (!token) {
            statusEl.className = 'wm-sidebar-lead-status wm-status-error';
            statusEl.textContent = 'Please sign in first.';
            return;
        }

        const providerToken = await getProviderToken();
        if (!providerToken) {
            statusEl.className = 'wm-sidebar-lead-status wm-status-error';
            statusEl.textContent = 'Gmail access required. Sign out and back in to refresh.';
            return;
        }

        // --- Start agent ---
        running = true;
        logEl.textContent = '';
        statusEl.className = 'wm-sidebar-lead-status wm-status-loading';
        statusEl.textContent = 'Agent running...';
        btn.disabled = true;
        const spinner = document.createElement('div');
        spinner.className = 'wm-sidebar-spinner';
        btn.textContent = '';
        btn.appendChild(spinner);
        btn.appendChild(document.createTextNode(' Running...'));

        try {
            // -- Step 1: Scrape leads --
            const searchPrompt = org ? `${query} at ${org}` : query;
            appendLog(logEl, `Searching for leads: "${searchPrompt}"...`, 'info');

            const scrapeRes = await apiFetch(`${getApiBase()}/scrape-emails`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ prompt: searchPrompt })
            });

            if (!scrapeRes.ok) {
                appendLog(logEl, (scrapeRes.data && scrapeRes.data.error) || 'Search failed.', 'error');
                statusEl.className = 'wm-sidebar-lead-status wm-status-error';
                statusEl.textContent = 'Search failed.';
                return;
            }

            const allResults = (scrapeRes.data && scrapeRes.data.results) || [];
            if (allResults.length === 0) {
                appendLog(logEl, 'No leads found. Try a different search.', 'error');
                statusEl.className = 'wm-sidebar-lead-status wm-status-error';
                statusEl.textContent = 'No results found.';
                return;
            }

            const selectedLeads = allResults.slice(0, count);
            appendLog(logEl, `Found ${allResults.length} leads. Selected top ${selectedLeads.length}.`, 'success');

            // -- Step 2: Draft personalized emails --
            appendLog(logEl, `Drafting ${selectedLeads.length} personalized emails...`, 'info');

            const draftRes = await apiFetch(`${getApiBase()}/draft-personalized-emails`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ leads: selectedLeads, limit: count })
            });

            if (!draftRes.ok) {
                const errMsg = (draftRes.data && draftRes.data.error) || 'Failed to draft emails.';
                appendLog(logEl, errMsg, 'error');
                if (errMsg.includes('resume')) {
                    appendLog(logEl, 'Upload your resume in the Settings tab first.', 'error');
                }
                statusEl.className = 'wm-sidebar-lead-status wm-status-error';
                statusEl.textContent = 'Drafting failed.';
                return;
            }

            const drafts = (draftRes.data && draftRes.data.drafts) || [];
            if (drafts.length === 0) {
                appendLog(logEl, 'No drafts were generated.', 'error');
                statusEl.className = 'wm-sidebar-lead-status wm-status-error';
                statusEl.textContent = 'No drafts generated.';
                return;
            }

            appendLog(logEl, `Drafted ${drafts.length} personalized emails.`, 'success');

            // -- Step 3: Auto-send via Gmail API --
            appendLog(logEl, `Sending ${drafts.length} emails...`, 'info');

            const sendRes = await apiFetch(`${getApiBase()}/gmail/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ provider_token: providerToken, drafts: drafts })
            });

            if (!sendRes.ok) {
                appendLog(logEl, (sendRes.data && sendRes.data.error) || 'Failed to send emails.', 'error');
                statusEl.className = 'wm-sidebar-lead-status wm-status-error';
                statusEl.textContent = 'Sending failed.';
                return;
            }

            const sendResults = (sendRes.data && sendRes.data.results) || [];
            let sentCount = 0;
            for (const result of sendResults) {
                if (result.success) {
                    sentCount++;
                    appendLog(logEl, `Sent to ${result.email}`, 'success');
                } else {
                    appendLog(logEl, `Failed: ${result.email} -- ${result.error}`, 'error');
                }
            }

            appendLog(logEl, `Done! ${sentCount}/${sendResults.length} emails sent successfully.`, sentCount > 0 ? 'success' : 'error');
            statusEl.className = `wm-sidebar-lead-status ${sentCount > 0 ? 'wm-status-success' : 'wm-status-error'}`;
            statusEl.textContent = `${sentCount}/${sendResults.length} emails sent`;

        } catch (err) {
            console.error('[Wingman] Lead finder agent error:', err);
            appendLog(logEl, "Can't reach server. Is the backend running?", 'error');
            statusEl.className = 'wm-sidebar-lead-status wm-status-error';
            statusEl.textContent = 'Agent error.';
        } finally {
            running = false;
            btn.disabled = false;
            resetLeadFinderButton(btn);
        }
    }

    btn.addEventListener('click', runAgent);

    // Enter key on any input triggers the agent
    [input, orgInput, countInput].forEach(function(el) {
        el.addEventListener('keydown', function(e) {
            e.stopPropagation();
            if (e.key === 'Enter') runAgent();
        });
    });
}
