/**
 * Wingman V2 — API Proxy & Auth Helpers
 * Loaded first so apiFetch/auth functions are available to all other modules.
 */

console.log("[Wingman] Content script loaded — v3.0 (Sidebar Copilot)");


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

const REFRESH_MSG = 'Extension was reloaded — please refresh this Gmail tab (Ctrl+Shift+R or Cmd+Shift+R)';

function getRuntimeConfig() {
    if (typeof WM_CONFIG !== 'undefined') return WM_CONFIG;
    if (typeof BE_CONFIG !== 'undefined') return BE_CONFIG;
    return null;
}

function chromeStorageGet(key) {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.get(key, (result) => {
                if (chrome.runtime.lastError) {
                    const msg = chrome.runtime.lastError.message || '';
                    return reject(new Error(msg.includes('Extension context invalidated') ? REFRESH_MSG : msg));
                }
                resolve(result[key] || null);
            });
        } catch (err) {
            reject(new Error(err.message && err.message.includes('Extension context invalidated') ? REFRESH_MSG : err.message));
        }
    });
}

async function isAuthenticated() {
    try {
        const session = await getContentSession();
        return !!(session && session.access_token);
    } catch { return false; }
}

function getApiBase() {
    const config = getRuntimeConfig();
    return config?.API_URL || 'https://wingman-lyart-seven.vercel.app';
}

async function getContentAccessToken() {
    try {
        const session = await getContentSession();
        return session ? (session.access_token || null) : null;
    } catch { return null; }
}

async function getContentSession() {
    try {
        const session = await chromeStorageGet('wm_supabase_session');
        if (!session) return null;

        const now = Math.floor(Date.now() / 1000);
        const isExpired = !!session.expires_at && now >= session.expires_at - 60;

        if (!isExpired) return session;
        if (typeof refreshAccessToken !== 'function') return null;

        return await refreshAccessToken(session.refresh_token);
    } catch {
        return null;
    }
}

// Listen for auth state changes and refresh sidebar
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.wm_supabase_session) {
        console.log("[Wingman] Auth state changed, refreshing sidebar");
        refreshSidebarAuth();
    }
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        apiFetch,
        chromeStorageGet,
        getRuntimeConfig,
        isAuthenticated,
        getApiBase,
        getContentAccessToken,
        getContentSession
    };
}
