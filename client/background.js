/**
 * Wingman V2 - Background Service Worker
 * Handles follow-up reminder scheduling and notifications
 */
console.log("[Wingman BG] Service worker loaded — v2.1");

/* =========================================================
   MESSAGE HANDLER — receives SET_REMINDER from content.js
========================================================= */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "SET_REMINDER") {
        // Store reminder metadata
        chrome.storage.local.get("wm_reminders", ({ wm_reminders = [] }) => {
            wm_reminders.push({
                id: msg.id,
                subject: msg.subject,
                summary: msg.summary || null,
                dueTime: msg.dueTime,
                threadId: msg.threadId || null,
                threadPath: msg.threadPath || null
            });
            chrome.storage.local.set({ wm_reminders });
        });

        // Schedule the alarm
        chrome.alarms.create(msg.id, { when: msg.dueTime });
        sendResponse({ success: true });
    } else if (msg.type === "CLEAR_ALARM") {
        // Proxy for content scripts which can't access chrome.alarms directly
        chrome.alarms.clear(msg.id);
        sendResponse({ success: true });
    } else if (msg.type === "CLEAR_NOTIFICATION") {
        // Proxy for content scripts which can't access chrome.notifications directly
        chrome.notifications.clear(msg.id);
        sendResponse({ success: true });
    } else if (msg.type === "OPEN_TAB") {
        // Proxy for content scripts which can't access chrome.tabs directly
        chrome.tabs.create({ url: msg.url });
        sendResponse({ success: true });
    } else if (msg.type === "SIGN_IN") {
        signInWithGoogleBackground()
            .then(session => sendResponse({ session }))
            .catch(error => sendResponse({ error: error.message }));
    } else if (msg.type === "SIGN_OUT") {
        (async () => {
            try {
                const result = await new Promise(r => chrome.storage.local.get('wm_supabase_session', r));
                const session = result.wm_supabase_session || null;
                if (session && session.access_token) {
                    try {
                        await fetch(`${WM_CONFIG.SUPABASE_URL}/auth/v1/logout`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${session.access_token}`,
                                'apikey': WM_CONFIG.SUPABASE_ANON_KEY
                            }
                        });
                    } catch { /* ignore */ }
                }
                await new Promise(r => chrome.storage.local.remove('wm_supabase_session', r));
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ error: err.message });
            }
        })();
    } else if (msg.type === "FILE_UPLOAD") {
        // Proxy file uploads — content scripts can't send FormData directly
        (async () => {
            try {
                const formData = new FormData();
                // Convert base64 back to a Blob
                const byteChars = atob(msg.fileData);
                const byteArray = new Uint8Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) {
                    byteArray[i] = byteChars.charCodeAt(i);
                }
                const blob = new Blob([byteArray], { type: msg.fileType || 'application/pdf' });
                formData.append(msg.fieldName || 'resume', blob, msg.fileName || 'file.pdf');

                const headers = {};
                if (msg.token) headers['Authorization'] = `Bearer ${msg.token}`;

                const res = await fetch(msg.url, {
                    method: 'POST',
                    headers,
                    body: formData
                });
                const data = await res.json();
                sendResponse({ ok: res.ok, status: res.status, data });
            } catch (err) {
                sendResponse({ ok: false, status: 0, error: err.message });
            }
        })();
    } else if (msg.type === "API_FETCH") {
        // Proxy API requests from content scripts through the background
        // to avoid mixed-content (HTTPS→HTTP) and CORS issues
        (async () => {
            try {
                const res = await fetch(msg.url, {
                    method: msg.method || 'GET',
                    headers: msg.headers || {},
                    body: msg.body || undefined
                });
                const data = await res.json();
                sendResponse({ ok: res.ok, status: res.status, data });
            } catch (err) {
                sendResponse({ ok: false, status: 0, error: err.message });
            }
        })();
    }
    return true; // Keep message channel open for async sendResponse
});

/* =========================================================
   AUTH HELPER — runs in background to prevent popup termination
========================================================= */

const WM_CONFIG = {
    SUPABASE_URL: 'https://mtokobzepmfgxfnrrpep.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10b2tvYnplcG1mZ3hmbnJycGVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NzA4MjUsImV4cCI6MjA4NzE0NjgyNX0.Exsg7_fhXYruLC2ZMPWr4byU-7OrrcM_hInW0tJ98Gw',
    API_URL: 'https://wingman-lyart-seven.vercel.app'
};

async function signInWithGoogleBackground() {
    const redirectUrl = chrome.identity.getRedirectURL();

    // Build Supabase OAuth URL
    const authUrl = new URL(`${WM_CONFIG.SUPABASE_URL}/auth/v1/authorize`);
    authUrl.searchParams.set('provider', 'google');
    authUrl.searchParams.set('redirect_to', redirectUrl);
    authUrl.searchParams.set('scopes', 'email profile https://www.googleapis.com/auth/gmail.readonly');

    // Launch Chrome identity flow
    const responseUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
            { url: authUrl.toString(), interactive: true },
            (callbackUrl) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(callbackUrl);
                }
            }
        );
    });

    // Parse the callback URL for tokens
    const url = new URL(responseUrl);
    const hashParams = new URLSearchParams(url.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    const expiresIn = parseInt(hashParams.get('expires_in') || '3600', 10);
    const providerToken = hashParams.get('provider_token');
    const providerRefreshToken = hashParams.get('provider_refresh_token');

    const errorDesc = hashParams.get('error_description') || url.searchParams.get('error_description') || hashParams.get('error') || url.searchParams.get('error');
    if (errorDesc) {
        throw new Error(errorDesc.replace(/\+/g, ' '));
    }

    if (!accessToken) {
        throw new Error('No access token received. URL: ' + responseUrl.substring(0, 100));
    }

    // Fetch user info from Supabase
    const userResponse = await fetch(`${WM_CONFIG.SUPABASE_URL}/auth/v1/user`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'apikey': WM_CONFIG.SUPABASE_ANON_KEY
        }
    });

    const user = userResponse.ok ? await userResponse.json() : null;

    const session = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
        user,
        provider_token: providerToken,
        provider_refresh_token: providerRefreshToken
    };

    // Save session to storage
    await new Promise((resolve) => {
        chrome.storage.local.set({ 'wm_supabase_session': session }, resolve);
    });

    return session;
}


/* =========================================================
   AUTO SYNC — periodic background email sync
========================================================= */

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('wm_auto_sync', { periodInMinutes: 30 });
});

chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create('wm_auto_sync', { periodInMinutes: 30 });
});

async function doBackgroundSync() {
    const result = await new Promise(r => chrome.storage.local.get('wm_supabase_session', r));
    const session = result.wm_supabase_session;
    if (!session?.access_token || !session?.provider_token) return;

    try {
        await fetch(`${WM_CONFIG.API_URL}/gmail/sync`, {
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
        console.log('[Wingman BG] Auto-sync complete');
    } catch (err) {
        console.error('[Wingman BG] Auto-sync failed:', err.message);
    }
}

/* =========================================================
   ALARM HANDLER — fires notification when reminder is due
========================================================= */

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'wm_auto_sync') {
        doBackgroundSync();
        return;
    }

    if (!alarm.name.startsWith("wm_reminder_")) return;

    chrome.storage.local.get("wm_reminders", ({ wm_reminders = [] }) => {
        const idx = wm_reminders.findIndex(r => r.id === alarm.name);
        if (idx === -1) return;

        const reminder = wm_reminders[idx];

        // Mark as fired so it stays visible in the popup with urgent styling
        wm_reminders[idx] = { ...reminder, fired: true };
        chrome.storage.local.set({ wm_reminders });

        chrome.notifications.create(alarm.name, {
            type: "basic",
            iconUrl: "icons/icon48.png",
            title: "Wingman: Follow-up Reminder",
            message: `No reply yet on: "${reminder.subject}". Time to follow up!`,
            buttons: [{ title: "Open Gmail" }],
            requireInteraction: true
        });
    });
});


/* =========================================================
   NOTIFICATION CLICK HANDLERS — open Gmail
========================================================= */

const GMAIL_THREAD_ID_RE = /^[A-Za-z0-9_\-]{8,}$/;

function reminderUrl(reminder) {
    if (reminder?.threadPath) return `https://mail.google.com/mail/u/0/#${reminder.threadPath}`;
    // Only use threadId if it's a URL-navigable ID — not internal "thread-f:..." format
    if (reminder?.threadId && GMAIL_THREAD_ID_RE.test(reminder.threadId)) {
        return `https://mail.google.com/mail/u/0/#inbox/${reminder.threadId}`;
    }
    // Fallback: search Sent folder by subject
    if (reminder?.subject) {
        const clean = reminder.subject.replace(/"/g, "'");
        const encoded = `in:sent+subject:%22${clean.replace(/ /g, '+')}%22`;
        return `https://mail.google.com/mail/u/0/#search/${encoded}`;
    }
    return "https://mail.google.com/mail/u/0/#sent";
}

chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
    if (btnIdx === 0) {
        chrome.storage.local.get("wm_reminders", ({ wm_reminders = [] }) => {
            const reminder = wm_reminders.find(r => r.id === notifId);
            chrome.tabs.create({ url: reminderUrl(reminder) });
        });
    }
    chrome.notifications.clear(notifId);
});

chrome.notifications.onClicked.addListener((notifId) => {
    chrome.storage.local.get("wm_reminders", ({ wm_reminders = [] }) => {
        const reminder = wm_reminders.find(r => r.id === notifId);
        chrome.tabs.create({ url: reminderUrl(reminder) });
    });
    chrome.notifications.clear(notifId);
});
