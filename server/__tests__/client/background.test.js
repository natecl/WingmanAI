describe('client background OAuth scopes', () => {
    let background;

    beforeEach(() => {
        jest.resetModules();

        global.fetch = jest.fn();
        global.chrome = {
            runtime: {
                onMessage: { addListener: jest.fn() },
                lastError: null
            },
            alarms: {
                create: jest.fn(),
                clear: jest.fn(),
                onAlarm: { addListener: jest.fn() }
            },
            notifications: {
                clear: jest.fn(),
                create: jest.fn(),
                onButtonClicked: { addListener: jest.fn() },
                onClicked: { addListener: jest.fn() }
            },
            tabs: { create: jest.fn() },
            storage: {
                local: {
                    get: jest.fn(),
                    set: jest.fn(),
                    remove: jest.fn()
                }
            },
            identity: {
                getRedirectURL: jest.fn(),
                launchWebAuthFlow: jest.fn()
            }
        };
        global.chrome.runtime.onInstalled = { addListener: jest.fn() };
        global.chrome.runtime.onStartup = { addListener: jest.fn() };

        background = require('../../../client/background.js');
    });

    afterEach(() => {
        delete global.fetch;
        delete global.chrome;
    });

    test('includes Gmail send scope in the Google OAuth scope string', () => {
        expect(background.getGoogleOAuthScopeString()).toContain('https://www.googleapis.com/auth/gmail.send');
        expect(background.GMAIL_OAUTH_SCOPES).toContain('https://www.googleapis.com/auth/gmail.readonly');
    });
});
