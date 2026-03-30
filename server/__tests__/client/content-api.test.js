describe('client content API auth helpers', () => {
    let storageState;
    let contentApi;

    beforeEach(() => {
        jest.resetModules();
        storageState = {
            wm_supabase_session: {
                access_token: 'expired-access-token',
                refresh_token: 'refresh-token',
                expires_at: 1,
                provider_token: 'gmail-provider-token'
            }
        };

        global.BE_CONFIG = {
            API_URL: 'https://api.example.com'
        };

        global.refreshAccessToken = jest.fn().mockResolvedValue({
            access_token: 'fresh-access-token',
            refresh_token: 'refresh-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            provider_token: 'gmail-provider-token'
        });

        global.chrome = {
            runtime: {
                sendMessage: jest.fn(),
                lastError: null
            },
            storage: {
                local: {
                    get: jest.fn((key, callback) => callback({ [key]: storageState[key] || null }))
                },
                onChanged: {
                    addListener: jest.fn()
                }
            }
        };

        global.refreshSidebarAuth = jest.fn();

        contentApi = require('../../../client/js/content-api.js');
    });

    afterEach(() => {
        delete global.WM_CONFIG;
        delete global.BE_CONFIG;
        delete global.refreshAccessToken;
        delete global.chrome;
        delete global.refreshSidebarAuth;
    });

    test('refreshes an expired stored session before returning the access token', async () => {
        const token = await contentApi.getContentAccessToken();

        expect(global.refreshAccessToken).toHaveBeenCalledWith('refresh-token');
        expect(token).toBe('fresh-access-token');
    });

    test('returns the stored token without refreshing when the session is still valid', async () => {
        storageState.wm_supabase_session = {
            access_token: 'valid-access-token',
            refresh_token: 'refresh-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600
        };

        const token = await contentApi.getContentAccessToken();

        expect(global.refreshAccessToken).not.toHaveBeenCalled();
        expect(token).toBe('valid-access-token');
    });

    test('reads API config from BE_CONFIG when WM_CONFIG is absent', async () => {
        expect(contentApi.getApiBase()).toBe('https://api.example.com');
    });
});
