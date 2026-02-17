const form = document.getElementById('analyze-form');
const emailInput = document.getElementById('email-input');
const contextInput = document.getElementById('context-input');
const analyzeBtn = document.getElementById('analyze-btn');
const resultsContainer = document.getElementById('results-container');

function showError(message) {
    resultsContainer.innerHTML = `<div class="error-card"><span class="error-text">${message}</span></div>`;
}

function showLoading() {
    resultsContainer.innerHTML = `
        <div class="loading-indicator">
            <div class="loading-dots">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
            </div>
            <span>Analyzing your email...</span>
        </div>
    `;
}

function renderSections(sections) {
    resultsContainer.innerHTML = '';
    sections.forEach((section) => {
        const card = document.createElement('div');
        card.className = 'section-card';
        card.innerHTML = `
            <div class="section-card-header">
                <span class="section-icon">${section.icon}</span>
                <span class="section-title">${section.title}</span>
            </div>
            <div class="section-content">${section.content}</div>
        `;
        resultsContainer.appendChild(card);
    });
}

function renderRawText(text) {
    resultsContainer.innerHTML = `<div class="raw-card">${text}</div>`;
}

const SYSTEM_PROMPT = `You are an expert email analyzer. The user will provide an email they have written and the context/purpose of the email.

Analyze the email and respond with a JSON array. Each element must have these fields:
- "title": section name
- "icon": a single emoji representing the section
- "content": your analysis (2-4 concise sentences)

Return exactly these 5 sections in order:
1. Grammar & Spelling — identify any grammar, spelling, or punctuation errors.
2. Tone & Formality — evaluate whether the tone is appropriate for the given context.
3. Clarity & Structure — assess how clear and well-organized the email is.
4. Suggestions — provide specific, actionable improvements.
5. Overall Verdict — a brief overall assessment.

IMPORTANT: Return ONLY the JSON array. No markdown, no code fences, no extra text.`;

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const context = contextInput.value.trim();

    if (!email || !context) {
        showError('Please provide both an email and context.');
        return;
    }

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing...';
    showLoading();

    try {
        const response = await fetch('http://localhost:3000/analyze-email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                context,
                systemPrompt: SYSTEM_PROMPT
            })
        });

        const data = await response.json();

        if (!response.ok) {
            showError(data.error || 'Analysis failed. Please try again.');
            return;
        }

        const raw = data.response;

        // Strip markdown code fences if present
        let jsonStr = raw.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }

        try {
            const sections = JSON.parse(jsonStr);
            if (Array.isArray(sections) && sections.length > 0 && sections[0].title) {
                renderSections(sections);
            } else {
                renderRawText(raw);
            }
        } catch {
            renderRawText(raw);
        }
    } catch (error) {
        showError('Could not connect to the server. Make sure the BetterEmail server is running.');
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Analyze';
    }
});
