/**
 * BetterEmailV2 — Priority Contacts
 * Users add names/emails; matching Gmail rows get a colored left-border highlight.
 */

const PRIORITY_COLORS = ['#ff6b6b', '#ff9f43', '#ffd32a', '#26de81', '#45aaf2', '#a29bfe'];

let _priorities       = [];   // [{ id, value, color }]
let _selectedColor    = PRIORITY_COLORS[0];
let _priorityObserver = null;

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
   GMAIL HIGHLIGHTING
========================================================= */

let _highlightTimer = null;

function scheduleHighlight() {
    clearTimeout(_highlightTimer);
    _highlightTimer = setTimeout(applyPriorityHighlights, 120);
}

function applyPriorityHighlights() {
    // Clear existing
    document.querySelectorAll('.wm-priority-row').forEach(el => {
        el.classList.remove('wm-priority-row');
        el.style.removeProperty('--wm-ph-color');
    });

    if (!_priorities.length) return;

    // Gmail email rows: class zA
    document.querySelectorAll('tr.zA').forEach(row => {
        // Sender element has an [email] attribute Gmail populates
        const senderEl = row.querySelector('[email]');
        if (!senderEl) return;

        const senderEmail = (senderEl.getAttribute('email') || '').toLowerCase();
        const senderName  = (senderEl.textContent || '').toLowerCase();

        for (const p of _priorities) {
            const val = p.value.toLowerCase().trim();
            if (!val) continue;
            if (senderEmail.includes(val) || senderName.includes(val)) {
                row.classList.add('wm-priority-row');
                row.style.setProperty('--wm-ph-color', p.color);
                break;
            }
        }
    });
}

function startPriorityObserver() {
    if (_priorityObserver) return;
    _priorityObserver = new MutationObserver(scheduleHighlight);
    _priorityObserver.observe(document.body, { childList: true, subtree: true });
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
            applyPriorityHighlights();
        });
    });
}

/* =========================================================
   WIRE
========================================================= */

async function wirePriorityContacts(sidebar) {
    await loadPriorities();
    renderPriorityList(sidebar);
    applyPriorityHighlights();
    startPriorityObserver();

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

    // Add button
    const input  = sidebar.querySelector('#wm-priority-input');
    const addBtn = sidebar.querySelector('#wm-priority-add-btn');

    async function addPriority() {
        const val = input.value.trim();
        if (!val) return;
        _priorities.push({ id: 'wm_p_' + Date.now(), value: val, color: _selectedColor });
        await savePriorities();
        input.value = '';
        renderPriorityList(sidebar);
        applyPriorityHighlights();
    }

    addBtn.addEventListener('click', addPriority);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') addPriority(); });
}
