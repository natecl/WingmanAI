require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Email Analyzer endpoint
app.post('/analyze-email', async (req, res) => {
    try {
        const { email, context } = req.body;

        if (!email || !context) {
            return res.status(400).json({ error: 'Both email and context are required' });
        }

        const systemPrompt = `You are an expert email analyzer. The user will provide an email they have written and the context/purpose of the email. Analyze the email and provide actionable feedback on:

1. **Grammar & Spelling**: Identify any grammar, spelling, or punctuation errors.
2. **Tone & Formality**: Evaluate whether the tone is appropriate for the given context.
3. **Clarity & Structure**: Assess how clear and well-organized the email is.
4. **Suggestions**: Provide specific, actionable suggestions for improvement.

Be concise but thorough. Format your response with clear sections.`;

        const userMessage = `Context/Purpose: ${context}\n\nEmail to analyze:\n${email}`;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GEMINI_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "google/gemini-2.0-flash-001",
                "messages": [
                    { "role": "system", "content": systemPrompt },
                    { "role": "user", "content": userMessage }
                ]
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('OpenRouter API Error:', data);
            return res.status(response.status).json({ error: data.error?.message || 'Failed to call OpenRouter API' });
        }

        const aiResponse = data.choices[0].message.content;
        res.json({ response: aiResponse });
    } catch (error) {
        console.error('Error generating response:', error);
        res.status(500).json({ error: 'Failed to generate response' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
