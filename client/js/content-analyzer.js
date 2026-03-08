/**
 * Wingman V2 — Compose Analyzer & Email Drafter (sidebar)
 */


/* =========================================================
   SYSTEM PROMPT (email analyzer)
========================================================= */

const SYSTEM_PROMPT = `You are an expert email analyzer. The user will provide an email they have written and the context/purpose of the email.
Analyze the email and respond with a JSON array. Each element must have:
- "title"
- "icon"
- "content"
Return exactly these 5 sections in order:
1. Grammar & Spelling
2. Tone & Formality
3. Clarity & Structure
4. Suggestions
5. Overall Verdict
Return ONLY the JSON array.`;


/* =========================================================
   COMPOSE ANALYZER (sidebar)
========================================================= */

function wireAnalyzer(sidebar) {
    const analyzeBtn = sidebar.querySelector('#wm-sidebar-analyze-btn');
    const draftBtn = sidebar.querySelector('#wm-sidebar-draft-btn');
    const contextInput = sidebar.querySelector('#wm-sidebar-context');
    const resultsArea = sidebar.querySelector('#wm-sidebar-analyzer-results');

    analyzeBtn.addEventListener('click', async () => {
        const editor = findAnyVisibleEditor();
        const emailText = editor ? getEditorContent(editor) : '';
        const context = contextInput.value.trim();

        if (!editor) {
            showSidebarError(resultsArea, "No compose window detected. Open a Gmail compose or reply box, then click Analyze.");
            return;
        }
        if (!emailText) {
            showSidebarError(resultsArea, "Your compose window appears to be empty. Write your email first, then click Analyze.");
            return;
        }
        if (!context) {
            showSidebarError(resultsArea, "Add context (e.g., 'job application') for better analysis.");
            return;
        }

        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<div class="wm-sidebar-spinner"></div><span>Analyzing...</span>';
        showSidebarLoading(resultsArea, 'Analyzing your email...');

        try {
            const token = await getContentAccessToken();
            if (!token) {
                showSidebarError(resultsArea, "Please sign in first.");
                resetBtn(analyzeBtn, 'Analyze', 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z');
                return;
            }

            const res = await apiFetch(`${getApiBase()}/analyze-email`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ email: emailText, context, systemPrompt: SYSTEM_PROMPT })
            });

            if (res.ok) {
                renderSidebarResults(resultsArea, res.data.response);
            } else {
                showSidebarError(resultsArea, res.data.error || "Analysis failed.");
            }
        } catch (err) {
            console.error("[Wingman] Analyze error:", err);
            showSidebarError(resultsArea, "Can't reach server. Is the backend running?");
        }

        resetBtn(analyzeBtn, 'Analyze', 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z');
    });

    draftBtn.addEventListener('click', () => {
        // Show inline prompt panel in the results area instead of browser prompt()
        resultsArea.innerHTML = `
            <div class="wm-draft-prompt-panel">
                <div class="wm-draft-prompt-label">What is this email for?</div>
                <input type="text" class="wm-draft-prompt-input" placeholder='e.g. "Software Engineer role at Google"' />
                <div class="wm-draft-prompt-actions">
                    <button class="wm-draft-prompt-cancel">Cancel</button>
                    <button class="wm-draft-prompt-submit">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Draft
                    </button>
                </div>
            </div>
        `;

        const input = resultsArea.querySelector('.wm-draft-prompt-input');
        const cancelBtn = resultsArea.querySelector('.wm-draft-prompt-cancel');
        const submitBtn = resultsArea.querySelector('.wm-draft-prompt-submit');

        // Auto-focus the input
        setTimeout(() => input.focus(), 50);

        cancelBtn.addEventListener('click', () => { resultsArea.innerHTML = ''; });

        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') submitBtn.click();
            if (e.key === 'Escape') { resultsArea.innerHTML = ''; }
        });

        submitBtn.addEventListener('click', async () => {
            const jobDesc = input.value.trim();
            if (!jobDesc) {
                input.style.borderColor = '#ff6b6b';
                input.setAttribute('placeholder', 'Please describe the email purpose...');
                return;
            }

            draftBtn.disabled = true;
            draftBtn.innerHTML = '<div class="wm-sidebar-spinner"></div><span>Drafting...</span>';
            showSidebarLoading(resultsArea, 'Drafting your email...');

            const token = await getContentAccessToken();
            if (!token) {
                showSidebarError(resultsArea, 'Please sign in first.');
                resetBtn(draftBtn, 'Draft', 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z');
                return;
            }

            try {
                const res = await apiFetch(`${getApiBase()}/draft-email`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ jobDescription: jobDesc })
                });

                if (res.ok) {
                    const draft = res.data.draft || '';
                    const editor = findAnyVisibleEditor();
                    if (editor) {
                        editor.focus();
                        document.execCommand('selectAll');
                        document.execCommand('insertText', false, draft);
                    }
                    resultsArea.innerHTML = '';
                } else {
                    showSidebarError(resultsArea, res.data?.error || 'Draft failed. Make sure your resume is saved in Settings.');
                }
            } catch (err) {
                console.error('[Wingman] Draft error:', err);
                showSidebarError(resultsArea, "Can't reach server. Is the backend running?");
            }

            resetBtn(draftBtn, 'Draft', 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z');
        });
    });
}
