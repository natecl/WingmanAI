/**
 * BetterEmailV2 - Gmail Integrated Content Script
 */

const SYSTEM_PROMPT = `You are an expert email analyzer. The user will provide an email they have written and the context/purpose of the email.
Analyze the email and respond with a JSON array. Each element must have these fields:
- "title": section name
- "icon": a single emoji representing the section
- "content": your analysis (2-4 concise sentences)
Return exactly these 5 sections in order:
1. Grammar & Spelling
2. Tone & Formality
3. Clarity & Structure
4. Suggestions
5. Overall Verdict
Return ONLY the JSON array.`;

function init() {
    // Inject the widget container
    const widget = document.createElement('div');
    widget.id = 'be-analyzer-widget';
    widget.innerHTML = `
        <div id="be-panel">
            <div id="be-header">
                <div class="be-logo-dot"></div>
                <h3>Email Analyzer</h3>
            </div>
            <div id="be-content">
                <form id="be-form">
                    <textarea id="be-email-input" placeholder="Paste email or start typing..."></textarea>
                    <input type="text" id="be-context-input" placeholder="Context (e.g. Job application)">
                    <button type="submit" id="be-analyze-btn">Analyze with AI</button>
                </form>
                <div id="be-results"></div>
            </div>
        </div>
        <button id="be-toggle-btn" title="Toggle Email Analyzer">
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>
        </button>
    `;

    document.body.appendChild(widget);

    const toggleBtn = document.getElementById('be-toggle-btn');
    const form = document.getElementById('be-form');
    const emailInput = document.getElementById('be-email-input');
    const contextInput = document.getElementById('be-context-input');
    const analyzeBtn = document.getElementById('be-analyze-btn');
    const resultsContainer = document.getElementById('be-results');

    // Toggle Expansion
    toggleBtn.addEventListener('click', () => {
        widget.classList.toggle('be-expanded');
    });

    // Form Submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = emailInput.value.trim();
        const context = contextInput.value.trim();

        if (!email || !context) return;

        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Thinking...';
        resultsContainer.innerHTML = '<div class="be-loading"><div class="be-dot"></div><div class="be-dot"></div><div class="be-dot"></div></div>';
        resultsContainer.classList.add('visible');

        try {
            const response = await fetch('http://localhost:3000/analyze-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, context, systemPrompt: SYSTEM_PROMPT })
            });

            const data = await response.json();

            if (response.ok) {
                renderResults(data.response);
            } else {
                resultsContainer.innerHTML = `<div class="be-error">Error: ${data.error || 'Failed to analyze'}</div>`;
            }
        } catch (err) {
            resultsContainer.innerHTML = '<div class="be-error">Error: Could not connect to local server. Make sure it is running!</div>';
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'Analyze with AI';
        }
    });

    function renderResults(raw) {
        resultsContainer.innerHTML = '';
        let jsonStr = raw.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }

        try {
            const sections = JSON.parse(jsonStr);
            sections.forEach(s => {
                const card = document.createElement('div');
                card.className = 'be-section-card';
                card.innerHTML = `
                    <div class="be-section-title"><span>${s.icon}</span> ${s.title}</div>
                    <div class="be-section-content">${s.content}</div>
                `;
                resultsContainer.appendChild(card);
            });
        } catch (e) {
            resultsContainer.innerHTML = `<div class="be-section-content">${raw}</div>`;
        }
    }
}

// Start injection
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
