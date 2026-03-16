/**
 * BetterEmailV2 — Media Tab
 * Displays PDFs and images stored from email attachments (auto) and manual uploads.
 */

/* =========================================================
   HELPERS
========================================================= */

function _mediaFileIcon(mimeType) {
    if (!mimeType) return '📎';
    if (mimeType === 'application/pdf') return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    return '📎';
}

function _mediaFormatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function _mediaFormatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function _mediaEsc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* =========================================================
   LOAD & RENDER
========================================================= */

// Cache fetched files so filter buttons don't re-fetch
let _mediaCache = [];
let _mediaActiveFilter = 'all';

function _mediaMatchesFilter(file, filter) {
    if (filter === 'all')   return true;
    if (filter === 'pdf')   return file.type === 'application/pdf';
    if (filter === 'image') return file.type && file.type.startsWith('image/');
    if (filter === 'jpeg')  return file.type === 'image/jpeg' || file.type === 'image/jpg';
    if (filter === 'png')   return file.type === 'image/png';
    return true;
}

function renderMediaList(sidebar, files) {
    const list  = sidebar.querySelector('#wm-media-list');
    const empty = sidebar.querySelector('#wm-media-empty');
    if (!list) return;

    const filtered = files.filter(f => _mediaMatchesFilter(f, _mediaActiveFilter));

    if (!filtered.length) {
        list.innerHTML = '';
        if (empty) empty.style.display = 'flex';
        return;
    }

    if (empty) empty.style.display = 'none';
    list.innerHTML = filtered.map(renderMediaItem).join('');

    list.querySelectorAll('.wm-media-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const item = btn.closest('.wm-media-item');
            if (!item) return;
            btn.disabled = true;
            await deleteMediaFile(sidebar, item.dataset.id, item);
        });
    });

    list.querySelectorAll('.wm-media-item').forEach(item => {
        item.addEventListener('click', () => {
            const url = item.dataset.url;
            if (url) chrome.runtime.sendMessage({ type: 'OPEN_TAB', url });
        });
    });
}

async function loadMediaFiles(sidebar, search = '') {
    const list  = sidebar.querySelector('#wm-media-list');
    const empty = sidebar.querySelector('#wm-media-empty');
    if (!list) return;

    list.innerHTML = '<div class="wm-media-loading">Loading files...</div>';
    if (empty) empty.style.display = 'none';

    try {
        const token = await getContentAccessToken();
        const qs    = search ? `?search=${encodeURIComponent(search)}` : '';
        const res   = await apiFetch(`${getApiBase()}/user/media${qs}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(res.data?.error || 'Request failed');
        _mediaCache = res.data?.files || [];
        renderMediaList(sidebar, _mediaCache);

    } catch (err) {
        console.error('[Media] Load failed:', err);
        list.innerHTML = '<div class="wm-media-error">Could not load files.</div>';
    }
}

function renderMediaItem(file) {
    const icon    = _mediaFileIcon(file.type);
    const size    = _mediaFormatSize(file.size);
    const date    = _mediaFormatDate(file.created_at);
    const name    = _mediaEsc(file.name);
    const url     = _mediaEsc(file.url || '');
    const isImg   = file.type && file.type.startsWith('image/');
    const badge   = file.from_email
        ? `<span class="wm-media-source-badge">from email</span>`
        : '';

    return `
        <div class="wm-media-item" data-id="${_mediaEsc(file.id)}" data-url="${url}" title="${name}">
            <div class="wm-media-thumb">
                ${isImg && file.url
                    ? `<img src="${url}" alt="${name}" class="wm-media-img-thumb"
                           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                    : ''}
                <div class="wm-media-icon-thumb"
                     style="${isImg && file.url ? 'display:none' : ''}">${icon}</div>
            </div>
            <div class="wm-media-info">
                <div class="wm-media-name">${name}</div>
                <div class="wm-media-meta">${size} · ${date} ${badge}</div>
            </div>
            <button class="wm-media-delete-btn" title="Delete file">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
            </button>
        </div>
    `;
}

/* =========================================================
   UPLOAD (manual)
========================================================= */

const ALLOWED_MEDIA_TYPES_CLIENT = new Set([
    'application/pdf',
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'
]);

async function uploadMediaFile(sidebar, file) {
    const statusEl  = sidebar.querySelector('#wm-media-upload-status');
    const uploadBtn = sidebar.querySelector('#wm-media-upload-btn');
    const searchVal = (sidebar.querySelector('#wm-media-search')?.value || '').trim();

    function setStatus(msg, isErr = false) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.className   = 'wm-media-upload-status ' + (isErr ? 'wm-status-err' : 'wm-status-ok');
    }

    if (!ALLOWED_MEDIA_TYPES_CLIENT.has(file.type)) {
        setStatus('Unsupported type. Allowed: PDF, JPEG, PNG, GIF, WebP, SVG', true);
        return;
    }
    if (file.size > 20 * 1024 * 1024) {
        setStatus('File too large. Max 20 MB.', true);
        return;
    }

    uploadBtn.disabled = true;
    setStatus('Uploading...');

    try {
        const token  = await getContentAccessToken();
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            chrome.runtime.sendMessage({
                type: 'FILE_UPLOAD',
                url: `${getApiBase()}/user/media/upload`,
                token,
                fileData: base64,
                fileName: file.name,
                fileType: file.type,
                fieldName: 'media'
            }, (response) => {
                uploadBtn.disabled = false;
                if (response && response.ok) {
                    setStatus(`Uploaded: ${file.name}`);
                    _mediaActiveFilter = 'all';
                    sidebar.querySelectorAll('.wm-media-filter-btn').forEach(b => {
                        b.classList.toggle('wm-media-filter-active', b.dataset.filter === 'all');
                    });
                    loadMediaFiles(sidebar, searchVal);
                } else {
                    setStatus(response?.data?.error || 'Upload failed.', true);
                }
            });
        };
        reader.onerror = () => { uploadBtn.disabled = false; setStatus('Could not read file.', true); };
        reader.readAsDataURL(file);
    } catch (err) {
        uploadBtn.disabled = false;
        setStatus('Upload error: ' + err.message, true);
    }
}

/* =========================================================
   DELETE
========================================================= */

async function deleteMediaFile(sidebar, id, itemEl) {
    try {
        const token = await getContentAccessToken();
        const res   = await apiFetch(`${getApiBase()}/user/media/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(res.data?.error || 'Delete failed');

        // Remove from cache
        _mediaCache = _mediaCache.filter(f => f.id !== id);

        itemEl.style.transition = 'opacity 0.25s, max-height 0.25s';
        itemEl.style.overflow   = 'hidden';
        itemEl.style.opacity    = '0';
        itemEl.style.maxHeight  = '0';
        setTimeout(() => {
            itemEl.remove();
            const list = sidebar.querySelector('#wm-media-list');
            if (list && !list.querySelector('.wm-media-item')) {
                const empty = sidebar.querySelector('#wm-media-empty');
                if (empty) empty.style.display = 'flex';
            }
        }, 260);
    } catch (err) {
        console.error('[Media] Delete failed:', err);
        const btn = itemEl?.querySelector('.wm-media-delete-btn');
        if (btn) btn.disabled = false;
    }
}

/* =========================================================
   WIRE
========================================================= */

function wireMediaTab(sidebar) {
    // Load when the Media tab is clicked
    sidebar.querySelectorAll('.wm-sidebar-tab').forEach(tab => {
        if (tab.dataset.tab === 'media') {
            tab.addEventListener('click', () => loadMediaFiles(sidebar));
        }
    });

    // Filter buttons
    sidebar.querySelectorAll('.wm-media-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            sidebar.querySelectorAll('.wm-media-filter-btn').forEach(b => b.classList.remove('wm-media-filter-active'));
            btn.classList.add('wm-media-filter-active');
            _mediaActiveFilter = btn.dataset.filter;
            renderMediaList(sidebar, _mediaCache);
        });
    });

    // Search — debounced
    const searchInput = sidebar.querySelector('#wm-media-search');
    let searchTimer;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadMediaFiles(sidebar, searchInput.value.trim()), 350);
    });

    // Upload button → hidden file input
    const fileInput = sidebar.querySelector('#wm-media-file-input');
    const uploadBtn = sidebar.querySelector('#wm-media-upload-btn');
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) uploadMediaFile(sidebar, file);
        fileInput.value = '';
    });

    // Drag-and-drop onto the panel
    const panel = sidebar.querySelector('#wm-sidebar-panel-media');
    panel.addEventListener('dragover',  (e) => { e.preventDefault(); panel.classList.add('wm-media-drag-over'); });
    panel.addEventListener('dragleave', ()  => panel.classList.remove('wm-media-drag-over'));
    panel.addEventListener('drop',      (e) => {
        e.preventDefault();
        panel.classList.remove('wm-media-drag-over');
        const file = e.dataTransfer?.files?.[0];
        if (file) uploadMediaFile(sidebar, file);
    });
}
