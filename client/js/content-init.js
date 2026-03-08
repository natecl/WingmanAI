/**
 * Wingman V2 — Init (entry point)
 * Loaded last so all functions from other modules are available.
 */


/* =========================================================
   INIT
========================================================= */

function init() {
    console.log("[Wingman] Initializing sidebar...");

    // Inject the sidebar
    injectSidebar();

    // Check every second for compose windows
    setInterval(scanForComposeWindows, 1000);

    // Also watch for DOM changes (attributes needed because Gmail may add
    // role="dialog" or class="Hd" after initial element creation)
    let _wmScanTimer = null;
    const debouncedScan = () => {
        if (_wmScanTimer) return;
        _wmScanTimer = setTimeout(() => { _wmScanTimer = null; scanForComposeWindows(); }, 50);
    };
    const observer = new MutationObserver(debouncedScan);
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['role', 'class']
    });

    // Safely enforce compose window offset mathematically against Gmail's engine
    observeComposeWindows();

    // Auto-sync emails every 5 minutes while Gmail is open
    setInterval(() => handleSidebarSync(true), 5 * 60 * 1000);
}

if (document.body) {
    init();
} else {
    document.addEventListener('DOMContentLoaded', init);
}
