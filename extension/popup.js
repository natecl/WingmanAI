/**
 * BetterEmail V2
 * Extension Popup Controller
 */

const API_URL = "http://localhost:3000/analyze-email";

/* =====================================================
   DOM REFERENCES
===================================================== */

const form = document.getElementById("analyze-form");
const emailInput = document.getElementById("email-input");
const contextInput = document.getElementById("context-input");
const analyzeBtn = document.getElementById("analyze-btn");
const resultsContainer = document.getElementById("results-container");


/* =====================================================
   SYSTEM PROMPT
===================================================== */

const SYSTEM_PROMPT = `You are an expert email analyzer. The user will provide an email they have written and the context/purpose of the email.

Analyze the email and respond with a JSON array. Each element must have:
- "title"
- "icon"
- "content"

Return exactly these 5 sections in order:
1. Grammar & Spelling — identify any grammar, spelling, or punctuation errors.
2. Tone & Formality — evaluate whether the tone is appropriate for the given context.
3. Clarity & Structure — assess how clear and well-organized the email is.
4. Suggestions — provide specific, actionable improvements.
5. Overall Verdict — a brief overall assessment.

IMPORTANT: Return ONLY the JSON array.`;


/* =====================================================
   UI HELPERS
===================================================== */

function setLoading(isLoading) {
    analyzeBtn.disabled = isLoading;
    analyzeBtn.textContent = isLoading ? "Analyzing..." : "Analyze";
}

function showError(message) {
    resultsContainer.innerHTML = `
        <div class="error-card">
            <span class="error-text">${message}</span>
        </div>
    `;
}

function showLoadingIndicator() {
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
    resultsContainer.innerHTML = "";

    sections.forEach(section => {
        const card = document.createElement("div");
        card.className = "section-card";

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
    resultsContainer.innerHTML = `
        <div class="raw-card">${text}</div>
    `;
}


/* =====================================================
   RESPONSE PARSING
===================================================== */

function cleanModelOutput(raw) {
    let text = raw.trim();

    if (text.startsWith("```")) {
        text = text
            .replace(/^```(?:json)?\s*/, "")
            .replace(/\s*```$/, "");
    }

    return text;
}

function tryParseSections(raw) {
    try {
        const cleaned = cleanModelOutput(raw);
        const parsed = JSON.parse(cleaned);

        if (Array.isArray(parsed) && parsed.length && parsed[0].title) {
            return parsed;
        }

        return null;
    } catch {
        return null;
    }
}


/* =====================================================
   API CALL
===================================================== */

async function analyzeEmail(email, context) {

    const response = await fetch(API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            email,
            context,
            systemPrompt: SYSTEM_PROMPT
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Analysis failed");
    }

    return data.response;
}


/* =====================================================
   FORM SUBMIT HANDLER
===================================================== */

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const context = contextInput.value.trim();

    if (!email || !context) {
        showError("Please provide both an email and context.");
        return;
    }

    setLoading(true);
    showLoadingIndicator();

    try {

        const raw = await analyzeEmail(email, context);
        const sections = tryParseSections(raw);

        if (sections) {
            renderSections(sections);
        } else {
            renderRawText(raw);
        }

    } catch (err) {
        showError(
            err.message ||
            "Could not connect to server. Make sure BetterEmail backend is running."
        );
    }

    setLoading(false);
});
