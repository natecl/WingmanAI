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
   Uses the same absolute-marker-in-first-td pattern as _wmHighlightRow.
   Matches by scanning the sender cell text content of each row.
========================================================= */

function _clearContactHighlights() {
    document.querySelectorAll('[data-wm-contact-priority]').forEach(row => {
        row.removeAttribute('data-wm-contact-priority');
        row.style.removeProperty('box-shadow');
        const marker = row.querySelector('.wm-contact-priority-marker');
        if (marker) marker.remove();
        const firstTd = row.querySelector('td');
        if (firstTd && !row.hasAttribute('data-wm-priority')) {
            firstTd.style.removeProperty('position');
        }
    });
}

function _getSenderText(row) {
    // Gmail puts sender info in a span with an [email] attribute when available.
    // Fall back to the full row text so we always get something.
    const senderSpan = row.querySelector('span[email]');
    if (senderSpan) {
        return (senderSpan.getAttribute('email') + ' ' + senderSpan.textContent).toLowerCase();
    }
    // Fallback: use the full row text (same approach as _wmFindGmailRow strategy 5)
    return row.textContent.toLowerCase();
}

function applyContactPriorityHighlights() {
    _clearContactHighlights();
    if (!_priorities.length) return;

    document.querySelectorAll('tr.zA, tr.zE').forEach(row => {
        // Skip rows already highlighted by the inbox-summary system
        if (row.hasAttribute('data-wm-priority')) return;

        const senderText = _getSenderText(row);

        for (const p of _priorities) {
            const val = p.value.toLowerCase().trim();
            if (!val) continue;
            if (!senderText.includes(val)) continue;

            row.setAttribute('data-wm-contact-priority', p.id);

            // Primary: box-shadow on the <tr> itself — same inline-style approach
            // as _wmHighlightRow, which works even when td has overflow:hidden
            row.style.setProperty('box-shadow', `inset 4px 0 0 ${p.color}`, 'important');

            // Belt-and-suspenders: also inject a marker div into the first <td>
            const firstTd = row.querySelector('td');
            if (firstTd && !firstTd.querySelector('.wm-contact-priority-marker')) {
                firstTd.style.setProperty('position', 'relative', 'important');
                const marker = document.createElement('div');
                marker.className = 'wm-contact-priority-marker';
                marker.style.cssText = [
                    'position:absolute',
                    'left:0', 'top:0', 'bottom:0',
                    'width:4px',
                    `background:${p.color}`,
                    'z-index:10',
                    'pointer-events:none'
                ].join(';');
                firstTd.prepend(marker);
            }
            break;
        }
    });
}

// Debounced observer — re-applies when Gmail re-renders the list
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
            <span class="wm-priority-dot" style="background:${p.color}"></span>
            <span class="wm-priority-value">${escapeHTML(p.value)}</span>
            <button class="wm-priority-remove" data-id="${p.id}" title="Remove">✕</button>
        </div>
    `).join('');

    list.querySelectorAll('.wm-priority-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            _priorities = _priorities.filter(p => p.id !== btn.dataset.id);
            await savePriorities();
            renderPriorityList(sidebar);
            applyContactPriorityHighlights();
        });
    });
}

/* =========================================================
   WIRE
========================================================= */

async function wirePriorityContacts(sidebar) {
    await loadPriorities();
    renderPriorityList(sidebar);
    applyContactPriorityHighlights();
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
