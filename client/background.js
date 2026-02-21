/**
 * BetterEmail V2 - Background Service Worker
 * Handles follow-up reminder scheduling and notifications
 */
console.log("[BetterEmail BG] Service worker loaded — v2.1");

/* =========================================================
   MESSAGE HANDLER — receives SET_REMINDER from content.js
========================================================= */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SET_REMINDER") {
        // Store reminder metadata
        chrome.storage.local.get("be_reminders", ({ be_reminders = [] }) => {
            be_reminders.push({
                id: msg.id,
                subject: msg.subject,
                dueTime: msg.dueTime
            });
            chrome.storage.local.set({ be_reminders });
        });

        // Schedule the alarm
        chrome.alarms.create(msg.id, { when: msg.dueTime });
        sendResponse({ success: true });
    } else if (msg.type === "SIGN_IN") {
        signInWithGoogleBackground()
            .then(session => sendResponse({ session }))
            .catch(error => sendResponse({ error: error.message }));
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

const BE_CONFIG = {
    SUPABASE_URL: 'https://mtokobzepmfgxfnrrpep.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10b2tvYnplcG1mZ3hmbnJycGVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NzA4MjUsImV4cCI6MjA4NzE0NjgyNX0.Exsg7_fhXYruLC2ZMPWr4byU-7OrrcM_hInW0tJ98Gw'
};

async function signInWithGoogleBackground() {
    const redirectUrl = chrome.identity.getRedirectURL();

    // Build Supabase OAuth URL
    const authUrl = new URL(`${BE_CONFIG.SUPABASE_URL}/auth/v1/authorize`);
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
    const userResponse = await fetch(`${BE_CONFIG.SUPABASE_URL}/auth/v1/user`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'apikey': BE_CONFIG.SUPABASE_ANON_KEY
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
        chrome.storage.local.set({ 'be_supabase_session': session }, resolve);
    });

    return session;
}


/* =========================================================
   ALARM HANDLER — fires notification when reminder is due
========================================================= */

chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith("be_reminder_")) return;

    chrome.storage.local.get("be_reminders", ({ be_reminders = [] }) => {
        const idx = be_reminders.findIndex(r => r.id === alarm.name);
        if (idx === -1) return;

        const reminder = be_reminders[idx];

        // Mark as fired so it stays visible in the popup with urgent styling
        be_reminders[idx] = { ...reminder, fired: true };
        chrome.storage.local.set({ be_reminders });

        chrome.notifications.create(alarm.name, {
            type: "basic",
            iconUrl: "icons/icon48.png",
            title: "BetterEmail: Follow-up Reminder",
            message: `No reply yet on: "${reminder.subject}". Time to follow up!`,
            buttons: [{ title: "Open Gmail" }],
            requireInteraction: true
        });
    });
});


/* =========================================================
   NOTIFICATION CLICK HANDLERS — open Gmail
========================================================= */

chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
    if (btnIdx === 0) {
        chrome.tabs.create({ url: "https://mail.google.com" });
    }
    chrome.notifications.clear(notifId);
});

chrome.notifications.onClicked.addListener((notifId) => {
    chrome.tabs.create({ url: "https://mail.google.com" });
    chrome.notifications.clear(notifId);
});
