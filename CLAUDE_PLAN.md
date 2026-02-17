# Implementation Plan: Secure Extension API Key via Server Proxy

## Goal
Modify the browser extension to call the local Express server instead of calling the OpenRouter API directly. This keeps the API key secure on the server.

## Proposed Changes

### 1. Backend Update: `server.js`
Modify the `/analyze-email` endpoint to accept a `systemPrompt` from the client.

- **File**: `server.js`
- **Changes**:
  - Update `app.post('/analyze-email', ...)` to destructure `systemPrompt` from `req.body`.
  - If `systemPrompt` is provided, use it in the OpenRouter `messages` array instead of the default one.

### 2. Extension Update: `extension/popup.js`
Update the network logic to point to the local server.

- **File**: `extension/popup.js`
- **Changes**:
  - Update the `fetch` URL to `http://localhost:3000/analyze-email`.
  - Remove `getApiKey()` calls and "No API key set" error handling.
  - Update the request body to include `systemPrompt: SYSTEM_PROMPT`, `email`, and `context`.
  - Remove the `Authorization` header (the server will inject it).

### 3. Extension UI Cleanup
Remove the now-unnecessary settings/options.

- **Files**: 
  - `extension/popup.html`: Remove the settings gear icon (`<button id="settings-btn">`).
  - `extension/popup.js`: Remove the `settingsBtn` event listener.
  - `extension/options.html` [DELETE]
  - `extension/options.js` [DELETE]
  - `extension/options.css` [DELETE]

## Verification
- Run `node server.js`.
- Open the extension popup.
- Verify that clicking "Analyze" works immediately without asking for a key.
- Verify that the server logs show the request being proxied successfully.
