require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const FirecrawlApp = require('@mendable/firecrawl-js').default;
const {
    normalizePrompt,
    generateCacheKey,
    checkPromptCache,
    checkEmailLeads,
    searchForUrls,
    filterUrls,
    scrapeEmails,
    upsertResults
} = require('./services/scraperService');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Email Analyzer endpoint
app.post('/analyze-email', async (req, res) => {
    try {
        const { email, context, systemPrompt: clientPrompt } = req.body;

        if (!email || !context) {
            return res.status(400).json({ error: 'Both email and context are required' });
        }

        const defaultPrompt = `You are an expert email analyzer. The user will provide an email they have written and the context/purpose of the email. Analyze the email and provide actionable feedback on:

1. **Grammar & Spelling**: Identify any grammar, spelling, or punctuation errors.
2. **Tone & Formality**: Evaluate whether the tone is appropriate for the given context.
3. **Clarity & Structure**: Assess how clear and well-organized the email is.
4. **Suggestions**: Provide specific, actionable suggestions for improvement.

Be concise but thorough. Format your response with clear sections.`;

        const systemPrompt = clientPrompt || defaultPrompt;

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

// Web Scraper endpoint
app.post('/scrape-emails', async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
            return res.status(400).json({ error: 'A non-empty "prompt" field is required' });
        }

        // Validate required env vars
        const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
        for (const v of requiredVars) {
            if (!process.env[v]) {
                console.error(`Missing env var: ${v}`);
                return res.status(500).json({ error: 'Server configuration error' });
            }
        }

        // Initialize clients
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const apiKey = process.env.OpenAI_Search_4oMini_Api_Key;
        const isOpenRouter = apiKey && apiKey.startsWith('sk-or-v1');

        const openai = new OpenAI({
            apiKey: apiKey,
            baseURL: isOpenRouter ? "https://openrouter.ai/api/v1" : undefined,
            defaultHeaders: isOpenRouter ? {
                "HTTP-Referer": "http://localhost:3000", // Required by OpenRouter
                "X-Title": "BetterEmail V2" // Optional
            } : undefined
        });

        const firecrawl = new FirecrawlApp({
            apiKey: process.env.Firecrawl_Api_Key
        });

        // Step 1: Normalize prompt and generate cache key
        const { normalized, domain } = normalizePrompt(prompt);
        const cacheKey = generateCacheKey(domain, normalized);

        // Step 2: Check prompt cache (< 3 days old)
        const cachedResult = await checkPromptCache(supabase, cacheKey);
        if (cachedResult) {
            return res.json({ results: cachedResult, source: 'cache' });
        }

        // Step 3: Check email_leads table for existing domain data
        const existingLeads = await checkEmailLeads(supabase, domain);
        if (existingLeads && existingLeads.length >= 10) {
            return res.json({ results: existingLeads, source: 'leads_cache' });
        }

        // Step 4: Full pipeline - Search → Filter → Scrape
        const candidateUrls = await searchForUrls(openai, prompt);
        const filteredUrls = await filterUrls(openai, candidateUrls, prompt);
        const scrapedResults = await scrapeEmails(firecrawl, filteredUrls);

        // Step 5: Save results to database
        await upsertResults(supabase, domain, normalized, cacheKey, scrapedResults, filteredUrls);

        res.json({ results: scrapedResults, source: 'live' });
    } catch (error) {
        console.error('Scrape error:', error);
        res.status(500).json({ error: 'Failed to process scraping request' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

module.exports = app;
