/**
 * BetterEmailV2 — Priority Contacts
 * Highlights Gmail inbox rows whose sender matches a saved contact.
 * Uses the same absolute-marker pattern as the existing _wmHighlightRow system.
 */

const PRIORITY_COLORS = ['#ff6b6b', '#ff9f43', '#ffd32a', '#26de81', '#45aaf2', '#a29bfe'];

let _priorities    = [];
let _selectedColor = PRIORITY_COLORS[0];

/* =========================================================
   STORAGE
========================================================= */

function loadPriorities() {
    return new Promise(resolve => {
        try {
            chrome.storage.local.get('wm_priorities', result => {
                _priorities = result.wm_priorities || [];
                resolve(_priorities);
            });
        } catch { resolve([]); }
    });
}

function savePriorities() {
    return new Promise(resolve => {
        try {
            chrome.storage.local.set({ wm_priorities: _priorities }, resolve);
        } catch { resolve(); }
    });
}

/* =========================================================
   GMAIL ROW HIGHLIGHTING
   Driven by email data from the inbox API (same thread-ID approach
   as the existing _wmHighlightRow system).
========================================================= */

// threadId → color, populated from inbox email data
const _contactPriorityThreads = new Map();
let _lastInboxEmails = [];

function _highlightContactRow(row, color) {
    if (!row) return;
    row.setAttribute('data-wm-contact-priority', '1');
    row.style.setProperty('box-shadow', `inset 4px 0 0 ${color}`, 'important');
    const firstTd = row.querySelector('td');
    if (firstTd && !firstTd.querySelector('.wm-contact-priority-marker')) {
        firstTd.style.setProperty('position', 'relative', 'important');
        const marker = document.createElement('div');
        marker.className = 'wm-contact-priority-marker';
        marker.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:4px;background:${color};z-index:10;pointer-events:none`;
        firstTd.prepend(marker);
    }
}

function _clearContactHighlights() {
    document.querySelectorAll('[data-wm-contact-priority]').forEach(row => {
        row.removeAttribute('data-wm-contact-priority');
        row.style.removeProperty('box-shadow');
        const marker = row.querySelector('.wm-contact-priority-marker');
        if (marker) marker.remove();
        const firstTd = row.querySelector('td');
        if (firstTd) firstTd.style.removeProperty('position');
    });
}

// Called from content-sidebar.js after inbox emails load.
// emails = [{ thread_id, from_name, from_email, subject, ... }]
function applyContactPriorityFromEmails(emails) {
    if (emails?.length) _lastInboxEmails = emails;
    _contactPriorityThreads.clear();
    if (!_priorities.length || !_lastInboxEmails.length) return;
    emails = _lastInboxEmails;

    for (const email of emails) {
        const senderName  = (email.from_name  || '').toLowerCase();
        const senderEmail = (email.from_email || '').toLowerCase();

        for (const p of _priorities) {
            const val = p.value.toLowerCase().trim();
            if (!val) continue;
            if (senderName.includes(val) || senderEmail.includes(val)) {
                if (email.thread_id) {
                    _contactPriorityThreads.set(email.thread_id, {
                        color: p.color,
                        subject: email.subject || '',
                        from: email.from_name || email.from_email || ''
                    });
                }
                break;
            }
        }
    }

    applyContactPriorityHighlights();
}

function applyContactPriorityHighlights() {
    _clearContactHighlights();
    if (!_contactPriorityThreads.size) return;

    _contactPriorityThreads.forEach(({ color, subject, from }, threadId) => {
        // Use the same reliable 5-strategy row finder as the inbox system
        const row = _wmFindGmailRow(threadId, { subject, from });
        _highlightContactRow(row, color);
    });
}

// Re-apply when Gmail re-renders the list
let _contactObserver    = null;
let _contactHighlightTimer = null;

function startContactPriorityObserver() {
    if (_contactObserver) return;
    _contactObserver = new MutationObserver(() => {
        clearTimeout(_contactHighlightTimer);
        _contactHighlightTimer = setTimeout(applyContactPriorityHighlights, 400);
    });
    _contactObserver.observe(document.body, { childList: true, subtree: true });
}

/* =========================================================
   RENDER SIDEBAR LIST
========================================================= */

function renderPriorityList(sidebar) {
    const list = sidebar.querySelector('#wm-priority-list');
    if (!list) return;

    if (!_priorities.length) {
        list.innerHTML = '<div class="wm-priority-empty">No priority contacts yet.</div>';
        return;
    }

    list.innerHTML = _priorities.map(p => `
        <div class="wm-priority-item" data-id="${p.id}">
            <button class="wm-priority-dot wm-priority-dot-btn" data-id="${p.id}"
                    style="background:${p.color}" title="Change color"></button>
            <div class="wm-priority-color-picker" id="wm-pc-${p.id}" style="display:none;">
                ${PRIORITY_COLORS.map(c => `
                    <button class="wm-priority-swatch${c === p.color ? ' wm-priority-swatch-active' : ''}"
                            data-color="${c}" data-pid="${p.id}" style="background:${c}"></button>
                `).join('')}
            </div>
            <span class="wm-priority-value">${escapeHTML(p.value)}</span>
            <button class="wm-priority-remove" data-id="${p.id}" title="Remove">✕</button>
        </div>
    `).join('');

    // Dot click → toggle color picker
    list.querySelectorAll('.wm-priority-dot-btn').forEach(dot => {
        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            const picker = list.querySelector(`#wm-pc-${dot.dataset.id}`);
            const isOpen = picker.style.display !== 'none';
            // Close all pickers first
            list.querySelectorAll('.wm-priority-color-picker').forEach(p => p.style.display = 'none');
            if (!isOpen) picker.style.display = 'flex';
        });
    });

    // Swatch click → update color
    list.querySelectorAll('.wm-priority-color-picker .wm-priority-swatch').forEach(sw => {
        sw.addEventListener('click', async (e) => {
            e.stopPropagation();
            const pid = sw.dataset.pid;
            const color = sw.dataset.color;
            const p = _priorities.find(p => p.id === pid);
            if (!p) return;
            p.color = color;
            await savePriorities();
            renderPriorityList(sidebar);
            applyContactPriorityFromEmails();
        });
    });

    // Click outside closes all pickers
    document.addEventListener('click', () => {
        list.querySelectorAll('.wm-priority-color-picker').forEach(p => p.style.display = 'none');
    }, { once: true });

    list.querySelectorAll('.wm-priority-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            _priorities = _priorities.filter(p => p.id !== btn.dataset.id);
            await savePriorities();
            renderPriorityList(sidebar);
            applyContactPriorityFromEmails();
        });
    });
}

/* =========================================================
   WIRE
========================================================= */

async function wirePriorityContacts(sidebar) {
    await loadPriorities();
    renderPriorityList(sidebar);
    startContactPriorityObserver();

    // Color swatches
    const swatchContainer = sidebar.querySelector('#wm-priority-swatches');
    if (swatchContainer) {
        swatchContainer.innerHTML = PRIORITY_COLORS.map(c => `
            <button class="wm-priority-swatch${c === _selectedColor ? ' wm-priority-swatch-active' : ''}"
                    data-color="${c}" style="background:${c}" title="${c}"></button>
        `).join('');

        swatchContainer.querySelectorAll('.wm-priority-swatch').forEach(sw => {
            sw.addEventListener('click', () => {
                _selectedColor = sw.dataset.color;
                swatchContainer.querySelectorAll('.wm-priority-swatch')
                    .forEach(s => s.classList.toggle('wm-priority-swatch-active', s.dataset.color === _selectedColor));
            });
        });
    }

    const input  = sidebar.querySelector('#wm-priority-input');
    const addBtn = sidebar.querySelector('#wm-priority-add-btn');

    async function addPriority() {
        const val = input.value.trim();
        if (!val) return;
        _priorities.push({ id: 'wm_p_' + Date.now(), value: val, color: _selectedColor });
        await savePriorities();
        input.value = '';
        renderPriorityList(sidebar);
        applyContactPriorityHighlights();
    }

    addBtn.addEventListener('click', addPriority);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') addPriority(); });
}
