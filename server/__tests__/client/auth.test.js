describe('client auth helpers', () => {
    let storageState;
    let auth;

    beforeEach(() => {
        jest.resetModules();
        storageState = {
            wm_supabase_session: {
                access_token: 'old-access-token',
                refresh_token: 'old-refresh-token',
                expires_at: 100,
                user: { id: 'user-1' },
                provider_token: 'gmail-provider-token',
                provider_refresh_token: 'gmail-provider-refresh-token'
            }
        };

        global.BE_CONFIG = {
            SUPABASE_URL: 'https://test.supabase.co',
            SUPABASE_ANON_KEY: 'test-anon-key'
        };

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                access_token: 'new-access-token',
                refresh_token: 'new-refresh-token',
                expires_at: 999999,
                user: { id: 'user-1' }
            })
        });

        global.chrome = {
            runtime: { sendMessage: jest.fn() },
            storage: {
                local: {
                    get: jest.fn((key, callback) => callback({ [key]: storageState[key] || null })),
                    set: jest.fn((value, callback) => {
                        Object.assign(storageState, value);
                        if (callback) callback();
                    }),
                    remove: jest.fn((_key, callback) => {
                        delete storageState.wm_supabase_session;
                        if (callback) callback();
                    })
                }
            }
        };

        auth = require('../../../client/auth.js');
    });

    afterEach(() => {
        delete global.WM_CONFIG;
        delete global.BE_CONFIG;
        delete global.fetch;
        delete global.chrome;
    });

    test('preserves Gmail provider tokens when refreshing Supabase access token', async () => {
        const session = await auth.refreshAccessToken('old-refresh-token');

        expect(global.fetch).toHaveBeenCalledWith(
            'https://test.supabase.co/auth/v1/token?grant_type=refresh_token',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    apikey: 'test-anon-key'
                })
            })
        );
        expect(session).toEqual(expect.objectContaining({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            provider_token: 'gmail-provider-token',
            provider_refresh_token: 'gmail-provider-refresh-token'
        }));
        expect(storageState.wm_supabase_session.provider_token).toBe('gmail-provider-token');
        expect(storageState.wm_supabase_session.provider_refresh_token).toBe('gmail-provider-refresh-token');
    });

    test('reads auth config from BE_CONFIG when WM_CONFIG is absent', () => {
        expect(auth.getAuthConfig()).toEqual({
            SUPABASE_URL: 'https://test.supabase.co',
            SUPABASE_ANON_KEY: 'test-anon-key'
        });
    });
});
