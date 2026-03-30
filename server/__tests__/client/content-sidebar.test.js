describe('client sidebar tab activation helpers', () => {
    let helpers;
    let sidebar;

    beforeEach(() => {
        jest.resetModules();

        global.document = {
            querySelector: jest.fn(),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn()
        };
        global.window = {};
        global.chrome = {
            storage: { local: { get: jest.fn() } },
            runtime: { sendMessage: jest.fn() }
        };

        helpers = require('../../../client/js/content-sidebar.js');

        const makeClassList = (initial = []) => {
            const set = new Set(initial);
            return {
                add: jest.fn((v) => set.add(v)),
                remove: jest.fn((v) => set.delete(v)),
                contains: jest.fn((v) => set.has(v))
            };
        };

        const mainTab = { classList: makeClassList(['wm-sidebar-tab']) };
        const researchTab = { classList: makeClassList(['wm-sidebar-tab']) };
        const mainPanel = { classList: makeClassList(['wm-sidebar-panel']) };
        const researchPanel = { classList: makeClassList(['wm-sidebar-panel']) };
        const tabs = [mainTab, researchTab];
        const panels = [mainPanel, researchPanel];

        sidebar = {
            querySelector: jest.fn((selector) => {
                if (selector === '.wm-sidebar-tab.wm-sidebar-tab-active') return null;
                if (selector === '.wm-sidebar-panel.wm-sidebar-panel-active') return null;
                if (selector === '.wm-sidebar-tab[data-tab="main"]') return mainTab;
                if (selector === '.wm-sidebar-tab[data-tab="leads"]') return researchTab;
                if (selector === '#wm-sidebar-panel-main') return mainPanel;
                if (selector === '#wm-sidebar-panel-leads') return researchPanel;
                return null;
            }),
            querySelectorAll: jest.fn((selector) => {
                if (selector === '.wm-sidebar-tab') return tabs;
                if (selector === '.wm-sidebar-panel') return panels;
                return [];
            })
        };
    });

    afterEach(() => {
        delete global.document;
        delete global.window;
        delete global.chrome;
    });

    test('ensureSidebarHasActiveTab activates the Main tab when nothing is active', () => {
        helpers.ensureSidebarHasActiveTab(sidebar, 'main');

        expect(sidebar.querySelector).toHaveBeenCalledWith('.wm-sidebar-tab[data-tab="main"]');
        expect(sidebar.querySelector).toHaveBeenCalledWith('#wm-sidebar-panel-main');
    });
});
