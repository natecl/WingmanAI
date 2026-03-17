/**
 * Wingman V2 — Compose Window Management & UI Helpers
 * Loaded second so escapeHTML / UI helpers are available to all feature modules.
 */


/* =========================================================
   UI HELPERS
========================================================= */

function escapeHTML(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showSidebarLoading(container, text) {
    container.innerHTML = `
        <div class="wm-sidebar-loading">
            <div class="wm-sidebar-loading-dots">
                <div class="wm-sidebar-dot"></div>
                <div class="wm-sidebar-dot"></div>
                <div class="wm-sidebar-dot"></div>
            </div>
            <span>${text || 'Loading...'}</span>
        </div>
    `;
}

function showSidebarError(container, message) {
    container.innerHTML = `
        <div class="wm-sidebar-error">
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

/** Convert AI content string → safe HTML with bullets and bold support. */
function _formatCardContent(text) {
    if (!text) return '';
    const lines = text.split('\n').filter(l => l.trim());
    const isBulletLine = l => /^[-•]\s/.test(l.trim());

    let html = '';
    let inList = false;
    for (const line of lines) {
        const escaped = escapeHTML(line.trim())
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        if (isBulletLine(line)) {
            if (!inList) { html += '<ul class="wm-card-list">'; inList = true; }
            html += `<li>${escaped.replace(/^[-•]\s*/, '')}</li>`;
        } else {
            if (inList) { html += '</ul>'; inList = false; }
            html += `<p>${escaped}</p>`;
        }
    }
    if (inList) html += '</ul>';
    return html;
}

/** Extract "Score: X/10" from the Overall Verdict content. Returns number or null. */
function _parseScore(sections) {
    const verdict = sections.find(s => s.title.toLowerCase().includes('verdict'));
    if (!verdict) return null;
    const m = verdict.content.match(/score[:\s]+(\d+)\s*\/\s*10/i);
    return m ? parseInt(m[1], 10) : null;
}

function renderSidebarResults(container, raw, meta) {
    container.innerHTML = "";

    let jsonStr = raw.trim();
    if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    try {
        const sections = JSON.parse(jsonStr);
        const score = _parseScore(sections);

        const grid = document.createElement("div");
        grid.className = "wm-sidebar-results-grid";

        // History context badge
        if (meta?.recipientEmail) {
            const hBadge = document.createElement('div');
            hBadge.className = 'wm-history-badge';
            if (meta.historyCount > 0) {
                hBadge.innerHTML = `📬 <span>Analysis includes <strong>${meta.historyCount}</strong> past email${meta.historyCount !== 1 ? 's' : ''} with ${escapeHTML(meta.recipientEmail)}</span>`;
                hBadge.classList.add('wm-history-badge--found');
            } else {
                hBadge.innerHTML = `📭 <span>No email history found with ${escapeHTML(meta.recipientEmail)} — sync your inbox to enable this</span>`;
                hBadge.classList.add('wm-history-badge--empty');
            }
            grid.appendChild(hBadge);
        }

        // Score badge header
        if (score !== null) {
            const scoreColor = score >= 8 ? '#34a853' : score >= 6 ? '#f9ab00' : '#ea4335';
            const scoreBadge = document.createElement('div');
            scoreBadge.className = 'wm-score-badge';
            scoreBadge.innerHTML = `
                <div class="wm-score-ring" style="--score-color:${scoreColor}">
                    <span class="wm-score-number">${score}</span>
                    <span class="wm-score-denom">/10</span>
                </div>
                <span class="wm-score-label">Email Score</span>
            `;
            grid.appendChild(scoreBadge);
        }

        const ACCENTS = { grammar: 'accent-blue', tone: 'accent-purple', clarity: 'accent-cyan', suggestion: 'accent-yellow', verdict: 'accent-green' };

        sections.forEach((s, i) => {
            const card = document.createElement("div");
            card.className = "wm-sidebar-result-card";
            card.style.animationDelay = `${i * 0.07}s`;

            const titleLower = s.title.toLowerCase();
            const accent = Object.entries(ACCENTS).find(([k]) => titleLower.includes(k))?.[1] || '';
            if (accent) card.classList.add(accent);

            // Strip "Score: X/10" from verdict display (shown in badge instead)
            const displayContent = s.title.toLowerCase().includes('verdict')
                ? s.content.replace(/^Score:\s*\d+\/10\s*[—\-–]?\s*/i, '')
                : s.content;

            card.innerHTML = `
                <div class="wm-sidebar-card-header">
                    <span class="wm-sidebar-card-icon">${s.icon}</span>
                    <span class="wm-sidebar-card-title">${escapeHTML(s.title)}</span>
                </div>
                <div class="wm-sidebar-card-content">${_formatCardContent(displayContent)}</div>
            `;
            grid.appendChild(card);
        });

        const closeBtn = document.createElement("button");
        closeBtn.className = "wm-sidebar-close-results";
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
        container.innerHTML = `<div class="wm-sidebar-raw-result">${escapeHTML(raw)}</div>`;
    }
}


/* =========================================================
   FIND EDITOR FUNCTIONS (for sidebar analyzer)
========================================================= */

function _wmIsVisible(el) {
    // Check computed style — more reliable than bounding rect for compose windows
    try {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
    } catch (e) { /* ignore */ }
    return true;
}

function findAnyVisibleEditor() {
    const sidebar = document.getElementById('wm-sidebar-wrapper');

    // Priority 1: The active focused compose dialog (our own tracking)
    const activeCompose = document.querySelector('.nH.Hd[role="dialog"].wm-compose-active');
    if (activeCompose) {
        const ed = activeCompose.querySelector('div[contenteditable="true"]');
        if (ed) return ed;
    }

    // Priority 2: Named Gmail selectors (not inside the Wingman sidebar)
    const namedSelectors = [
        '[aria-label="Message Body"]',
        '[aria-label="Body"]',
        '[g_editable="true"]',
        'div.editable[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div.Am.Al.editable',
        'div.aoI[contenteditable="true"]'
    ];
    for (const sel of namedSelectors) {
        for (const ed of document.querySelectorAll(sel)) {
            if (sidebar && sidebar.contains(ed)) continue;
            if (_wmIsVisible(ed)) return ed;
        }
    }

    // Priority 3: Any contenteditable inside any visible dialog
    for (const dialog of document.querySelectorAll('div[role="dialog"]')) {
        if (!_wmIsVisible(dialog)) continue;
        const ed = dialog.querySelector('div[contenteditable="true"]');
        if (ed && _wmIsVisible(ed)) return ed;
    }

    // Priority 4: Last resort — any visible contenteditable not inside the sidebar
    for (const ed of document.querySelectorAll('div[contenteditable="true"]')) {
        if (sidebar && sidebar.contains(ed)) continue;
        if (_wmIsVisible(ed)) return ed;
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
   SCAN FOR COMPOSE WINDOWS (for send button listener & focus tracking)
========================================================= */

function scanForComposeWindows() {
    // 1. Manage Focus Glow States and Auto-minimize
    const composeDialogs = Array.from(document.querySelectorAll('.nH.Hd[role="dialog"]'));

    // Find dialogs we haven't processed yet
    const newDialogs = composeDialogs.filter(dialog => !dialog.classList.contains('wm-focus-injected'));

    // If new compose windows just opened, update focus glow
    if (newDialogs.length > 0) {
        // Remove glow from all previous windows
        document.querySelectorAll('.nH.Hd[role="dialog"].wm-compose-active').forEach(d => {
            d.classList.remove('wm-compose-active');
        });

        // Apply glow to the newest window
        newDialogs[newDialogs.length - 1].classList.add('wm-compose-active');

        // Nudge Gmail to recalculate compose window layout so it accounts
        // for our sidebar offset. Without this, borders/toolbar may not
        // render until the user clicks into the window.
        setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
        setTimeout(() => window.dispatchEvent(new Event('resize')), 400);
    }

    composeDialogs.forEach(dialog => {
        if (!dialog.classList.contains('wm-focus-injected')) {
            dialog.classList.add('wm-focus-injected');

            // Add focus-in listener to make this window glow
            dialog.addEventListener('focusin', () => {
                document.querySelectorAll('.nH.Hd[role="dialog"].wm-compose-active').forEach(d => {
                    d.classList.remove('wm-compose-active');
                });
                dialog.classList.add('wm-compose-active');
            });

            // Allow clicking anywhere on the dialog to trigger focus glow
            dialog.addEventListener('click', () => {
                document.querySelectorAll('.nH.Hd[role="dialog"].wm-compose-active').forEach(d => {
                    d.classList.remove('wm-compose-active');
                });
                dialog.classList.add('wm-compose-active');
            }, true);
        }
    });

    // 2. Add Inline "Analyze" Send Button
    const editors = document.querySelectorAll(
        '[aria-label="Message Body"], ' +
        '[g_editable="true"], ' +
        'div.editable[contenteditable="true"], ' +
        'div[contenteditable="true"][role="textbox"]'
    );

    editors.forEach(editor => {
        const composeBox = editor.closest('div[role="dialog"]') ||
            editor.closest('.M9') ||
            editor.closest('.ip') ||   // inline reply wrapper
            editor.closest('.aDh') ||  // another inline reply wrapper Gmail uses
            editor.closest('form') ||
            editor.closest('.nH.Hd');

        if (composeBox && !composeBox.dataset.wmAttached) {
            composeBox.dataset.wmAttached = "true";
            attachSendListener(composeBox);
            console.log("[Wingman] Send listener attached to compose window");
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

    if (!sendBtn || sendBtn.dataset.wmReminderAttached) return !!sendBtn;

    sendBtn.dataset.wmReminderAttached = "true";
    sendBtn.addEventListener("click", () => {
        const subject = document.querySelector('input[name="subjectbox"]')?.value?.trim() || "";
        const editor = findAnyVisibleEditor();
        const bodySnippet = editor?.innerText?.trim()?.substring(0, 500) || "";
        const currentThreadId = getCurrentThreadId();
        const currentThreadPath = getCurrentThreadPath();
        const pendingThread = { id: currentThreadId, path: currentThreadPath };
        if (!currentThreadPath) watchForSentThread(pendingThread);
        // Extract recipient for smart timing
        const toEmail = composeBox.querySelector('[email]')?.getAttribute('email') || null;
        classifyAndHandleSend(subject, bodySnippet, currentThreadId, pendingThread, toEmail);
    });

    console.log("[Wingman] Send button listener attached");
    return true;
}


/* =========================================================
   COMPOSE WINDOW LAYOUT KEEPER
========================================================= */

// Gmail actively recalculates the "right" style for drafts
// Standard CSS overrides break minimizing and multi-window math.
// This keeper constantly enforces a robust margin offset without breaking native math.
function observeComposeWindows() {
    const SIDEBAR_WIDTH = 350;

    setInterval(() => {
        const isSidebarActive = document.body.classList.contains('wm-sidebar-active');

        // 1. Shift master containers leftwards safely to clear the sidebar
        const masterContainers = document.querySelectorAll('.no, .dw, .inboxsdk__compose');
        masterContainers.forEach(container => {
            if (isSidebarActive) {
                if (container.style.marginRight !== '350px') {
                    container.style.setProperty('margin-right', '350px', 'important');
                    container.style.setProperty('transition', 'margin-right 0.3s ease', 'important');
                }
            } else {
                container.style.removeProperty('margin-right');
                container.style.removeProperty('transition');
            }
        });

        // 2. Handle compose dialogs that overflow into the sidebar zone
        const composeDialogs = document.querySelectorAll('.nH.Hd[role="dialog"]');
        const maxRight = window.innerWidth - SIDEBAR_WIDTH;

        composeDialogs.forEach(dialog => {
            const removeOverrides = () => {
                dialog.classList.remove('wm-fullscreen-compose');
                dialog.style.removeProperty('position');
                dialog.style.removeProperty('left');
                dialog.style.removeProperty('top');
                dialog.style.removeProperty('bottom');
                dialog.style.removeProperty('width');
                dialog.style.removeProperty('max-width');
            };

            if (!isSidebarActive) {
                if (dialog.classList.contains('wm-fullscreen-compose')) {
                    removeOverrides();
                }
                return;
            }

            // Temporarily strip our overrides to read Gmail's native layout.
            // Synchronous reflow before repaint — no flicker.
            const hadOverrides = dialog.classList.contains('wm-fullscreen-compose');
            if (hadOverrides) {
                removeOverrides();
            }

            const rect = dialog.getBoundingClientRect();

            // If the dialog bleeds into the sidebar zone, constrain it.
            // position: fixed is required for left/width to override Gmail's positioning.
            // Use top + bottom instead of explicit height so Gmail's internal
            // toolbar/buttons still reflow naturally within the container.
            if (rect.right > maxRight && rect.width > 500) {
                dialog.classList.add('wm-fullscreen-compose');
                // Center the compose between the left viewport edge and the sidebar
                const PADDING = 24;
                const availableWidth = maxRight;
                const newWidth = availableWidth - (PADDING * 2);
                const newLeft = PADDING;
                dialog.style.setProperty('position', 'fixed', 'important');
                dialog.style.setProperty('left', newLeft + 'px', 'important');
                dialog.style.setProperty('top', rect.top + 'px', 'important');
                dialog.style.setProperty('bottom', '0', 'important');
                dialog.style.setProperty('width', newWidth + 'px', 'important');
                dialog.style.setProperty('max-width', newWidth + 'px', 'important');

                // If we just applied overrides for the first time, nudge Gmail
                // to reflow the compose internals (toolbar, buttons, etc.)
                // by programmatically focusing the subject then the body.
                if (!hadOverrides) {
                    setTimeout(() => {
                        const subj = dialog.querySelector('input[name="subjectbox"]');
                        const body = dialog.querySelector('div[contenteditable="true"]');
                        if (subj) { subj.focus(); subj.click(); }
                        setTimeout(() => { if (body) { body.focus(); body.click(); } }, 50);
                    }, 100);
                }
            }
            // else: Gmail minimized or normal — overrides stay removed
        });
    }, 300);
}
