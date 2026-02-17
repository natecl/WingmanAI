/**
 * BetterEmail V2 - Background Service Worker
 * Handles follow-up reminder scheduling and notifications
 */

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
    }
    return true; // Keep message channel open for async sendResponse
});


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
