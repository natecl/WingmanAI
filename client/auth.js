/**
 * Wingman V2 — Supabase Auth Helper
 *
 * Uses chrome.identity.launchWebAuthFlow for Google OAuth,
 * then exchanges the token with Supabase Auth.
 * Session stored in chrome.storage.local (key: wm_supabase_session).
 */

const AUTH_STORAGE_KEY = 'wm_supabase_session';

/**
 * Get the current stored session (if any).
 * Returns { access_token, refresh_token, user, provider_token, provider_refresh_token, expires_at } or null.
 */
async function getSession() {
    return new Promise((resolve) => {
        chrome.storage.local.get(AUTH_STORAGE_KEY, (result) => {
            resolve(result[AUTH_STORAGE_KEY] || null);
        });
    });
}

/**
 * Save session to chrome.storage.local.
 */
async function saveSession(session) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [AUTH_STORAGE_KEY]: session }, resolve);
    });
}

/**
 * Clear session from storage.
 */
async function clearSession() {
    return new Promise((resolve) => {
        chrome.storage.local.remove(AUTH_STORAGE_KEY, resolve);
    });
}

/**
 * Get a valid Supabase access token, refreshing if expired.
 */
async function getAccessToken() {
    const session = await getSession();
    if (!session) return null;

    // Check if token is expired (with 60s buffer)
    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at && now >= session.expires_at - 60) {
        const refreshed = await refreshAccessToken(session.refresh_token);
        return refreshed ? refreshed.access_token : null;
    }

    return session.access_token;
}

/**
 * Refresh the Supabase session using the refresh token.
 */
async function refreshAccessToken(refreshToken) {
    if (!refreshToken) return null;

    try {
        const existingSession = await getSession();
        const response = await fetch(`${WM_CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': WM_CONFIG.SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ refresh_token: refreshToken })
        });

        if (!response.ok) {
            await clearSession();
            return null;
        }

        const data = await response.json();
        const session = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: data.expires_at,
            user: data.user,
            // Supabase refresh responses may omit provider tokens. Preserve the
            // original Gmail credentials so Gmail API features keep working.
            provider_token: data.provider_token || existingSession?.provider_token || null,
            provider_refresh_token: data.provider_refresh_token || existingSession?.provider_refresh_token || null
        };

        await saveSession(session);
        return session;
    } catch (err) {
        console.error('Wingman: Token refresh failed', err);
        await clearSession();
        return null;
    }
}

/**
 * Sign in with Google via Supabase OAuth + chrome.identity.launchWebAuthFlow.
 * Returns the session object or throws.
 */
async function signInWithGoogle() {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "SIGN_IN" }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (!response) {
                reject(new Error("No response from background script"));
                return;
            }
            if (response.error) {
                reject(new Error(response.error));
                return;
            }
            resolve(response.session);
        });
    });
}

/**
 * Sign out — clear stored session.
 */
async function signOut() {
    const session = await getSession();

    // Attempt to sign out from Supabase (best-effort)
    if (session && session.access_token) {
        try {
            await fetch(`${WM_CONFIG.SUPABASE_URL}/auth/v1/logout`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'apikey': WM_CONFIG.SUPABASE_ANON_KEY
                }
            });
        } catch {
            // Ignore errors on sign-out
        }
    }

    await clearSession();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getSession,
        saveSession,
        clearSession,
        getAccessToken,
        refreshAccessToken,
        signInWithGoogle,
        signOut
    };
}
