require('dotenv').config({ override: true });
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
    searchWithFirecrawl,
    scrapeEmails,
    upsertResults
} = require('./services/scraperService');
const { requireAuth } = require('./middleware/auth');
const {
    fetchMessageIds,
    fetchMessage,
    extractBodyText,
    cleanBodyText,
    computeBodyHash,
    getHeader,
    parseFrom,
    upsertMessage,
    storeGmailTokens,
    getGmailTokens
} = require('./services/gmailService');
const {
    embedQuery,
    vectorSearch,
    groupAndRankResults
} = require('./services/searchService');

const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' }
});
app.use('/analyze-email', apiLimiter);
app.use('/scrape-emails', apiLimiter);
app.use('/gmail/sync', apiLimiter);
app.use('/search', apiLimiter);
app.use('/user/resume', apiLimiter);
app.use('/draft-email', apiLimiter);

// Email Analyzer endpoint
app.post('/analyze-email', requireAuth, async (req, res) => {
    try {
        const { email, context } = req.body;

        if (!email || !context) {
            return res.status(400).json({ error: 'Both email and context are required' });
        }

        // Input length validation
        if (email.length > 10000) {
            return res.status(400).json({ error: 'Email text must be 10,000 characters or less' });
        }
        if (context.length > 2000) {
            return res.status(400).json({ error: 'Context must be 2,000 characters or less' });
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

// Web Scraper endpoint
app.post('/scrape-emails', requireAuth, async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
            return res.status(400).json({ error: 'A non-empty "prompt" field is required' });
        }

        if (prompt.length > 1000) {
            return res.status(400).json({ error: 'Prompt must be 1,000 characters or less' });
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

        // Step 4: Full pipeline - Firecrawl Search → Scrape
        const searchedUrls = await searchWithFirecrawl(firecrawl, prompt);
        const scrapedResults = await scrapeEmails(firecrawl, searchedUrls);

        // Step 5: Save results to database
        await upsertResults(supabase, domain, normalized, cacheKey, scrapedResults, searchedUrls);

        res.json({ results: scrapedResults, source: 'live' });
    } catch (error) {
        console.error('Scrape error:', error);
        res.status(500).json({ error: 'Failed to process scraping request' });
    }
});

// Gmail Sync endpoint
app.post('/gmail/sync', requireAuth, async (req, res) => {
    console.log(`[Sync Debug] Received sync request from userId: ${req.userId}. Body keys:`, Object.keys(req.body));
    try {
        const { provider_token, provider_refresh_token } = req.body;

        if (!provider_token) {
            console.error('[Sync Error] provider_token is missing from request body.');
            return res.status(400).json({ error: 'provider_token is required' });
        }

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        // Always ensure user row exists (prevents foreign key violations on gmail_messages)
        await storeGmailTokens(supabase, req.userId, req.userEmail, {
            access_token: provider_token,
            refresh_token: provider_refresh_token || null
        });

        // Get user's current history_id for incremental sync
        const userData = await getGmailTokens(supabase, req.userId);
        const historyId = userData?.history_id || null;
        console.log(`[Sync Debug] Stored history_id for user: ${historyId}`);

        // Fetch message IDs from Gmail
        const { messageIds } = await fetchMessageIds(provider_token, historyId);
        console.log(`[Sync Debug] fetchMessageIds returned ${messageIds.length} IDs.`);

        // Send immediate response to prevent Chrome MV3 service worker timeout (30s limit)
        res.json({ processed: 0, queued: messageIds.length, status: 'Background sync started' });

        // Process all the heavy message downloading and parsing entirely in the background
        setTimeout(async () => {
            let processed = 0;
            let queued = 0;
            let newHistoryId = null;

            console.log(`[Sync Debug] Starting background processing for ${messageIds.length} messages...`);

            for (const msgId of messageIds) {
                try {
                    const gmailMsg = await fetchMessage(provider_token, msgId);
                    const headers = gmailMsg.payload?.headers || [];

                    const subject = getHeader(headers, 'Subject') || '(no subject)';
                    const fromHeader = getHeader(headers, 'From') || '';
                    const toHeader = getHeader(headers, 'To') || '';
                    const { name: fromName, email: fromEmail } = parseFrom(fromHeader);

                    const toEmails = toHeader
                        .split(',')
                        .map(t => t.trim())
                        .filter(Boolean);

                    const rawBody = extractBodyText(gmailMsg.payload);
                    const bodyText = cleanBodyText(rawBody);
                    // Generate hash to avoid duplicate processing
                    const bodyHash = computeBodyHash(bodyText);

                    // Track the latest historyId
                    if (gmailMsg.historyId) {
                        if (!newHistoryId || BigInt(gmailMsg.historyId) > BigInt(newHistoryId)) {
                            newHistoryId = gmailMsg.historyId;
                        }
                    }

                    const result = await upsertMessage(supabase, req.userId, {
                        gmailMessageId: msgId,
                        threadId: gmailMsg.threadId,
                        subject,
                        fromName,
                        fromEmail,
                        toEmails,
                        labels: gmailMsg.labelIds || [],
                        internalDate: new Date(parseInt(gmailMsg.internalDate)).toISOString(),
                        bodyText,
                        bodyHash
                    });

                    processed++;
                    if (result === 'new' || result === 'changed') queued++;
                } catch (msgErr) {
                    console.error(`Failed to process message ${msgId}:`, msgErr.message);
                }
            }

            // Update history_id for next incremental sync
            if (newHistoryId) {
                try {
                    await supabase.from('users').update({
                        history_id: newHistoryId,
                        updated_at: new Date().toISOString()
                    }).eq('id', req.userId);
                } catch (err) {
                    console.error(`Failed to update history_id for user ${req.userId}`, err);
                }
            }
            console.log(`[Sync Debug] Background processing complete. Processed: ${processed}, Queued for vector embedding: ${queued}`);
        }, 0);
    } catch (error) {
        console.error('Gmail sync error:', error);
        res.status(500).json({ error: 'Failed to sync emails' });
    }
});

// Semantic Search endpoint
app.post('/search', requireAuth, async (req, res) => {
    try {
        const { query, filters } = req.body;

        if (!query || typeof query !== 'string' || !query.trim()) {
            return res.status(400).json({ error: 'A non-empty "query" is required' });
        }

        if (query.length > 500) {
            return res.status(400).json({ error: 'Query must be 500 characters or less' });
        }

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const embeddingApiKey = process.env.OPENAI_EMBEDDING_API_KEY;
        const isEmbeddingOpenRouter = embeddingApiKey && embeddingApiKey.startsWith('sk-or-v1');
        const openai = new OpenAI({
            apiKey: embeddingApiKey,
            baseURL: isEmbeddingOpenRouter ? "https://openrouter.ai/api/v1" : undefined,
            defaultHeaders: isEmbeddingOpenRouter ? {
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "BetterEmail V2"
            } : undefined
        });

        // Embed the query
        const queryVector = await embedQuery(openai, query.trim());
        console.log(`[Search Debug] Embedded query, dimensions: ${queryVector ? queryVector.length : 'null'}`);

        // Run vector search
        console.log(`[Search Debug] Running vectorSearch for userId: ${req.userId} with filters:`, filters);
        const rawResults = await vectorSearch(supabase, req.userId, queryVector, filters || {});
        console.log(`[Search Debug] rawResults length from Supabase: ${rawResults ? rawResults.length : 'null'}`);

        // Group, rank, and return
        const results = groupAndRankResults(rawResults);
        console.log(`[Search Debug] Final grouped results count: ${results.length}`);

        res.json({ results });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get user's saved resume
app.get('/user/resume', requireAuth, async (req, res) => {
    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        const { data, error } = await supabase
            .from('users')
            .select('resume_text')
            .eq('id', req.userId)
            .single();
        if (error) return res.status(500).json({ error: 'Failed to fetch resume' });
        res.json({ resume_text: data?.resume_text || '' });
    } catch (error) {
        console.error('Get resume error:', error);
        res.status(500).json({ error: 'Failed to fetch resume' });
    }
});

// Save user's resume
app.put('/user/resume', requireAuth, async (req, res) => {
    try {
        const { resume_text } = req.body;
        if (typeof resume_text !== 'string') {
            return res.status(400).json({ error: 'resume_text must be a string' });
        }
        if (resume_text.length > 20000) {
            return res.status(400).json({ error: 'Resume must be 20,000 characters or less' });
        }
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        const { error } = await supabase
            .from('users')
            .update({ resume_text, updated_at: new Date().toISOString() })
            .eq('id', req.userId);
        if (error) return res.status(500).json({ error: 'Failed to save resume' });
        res.json({ success: true });
    } catch (error) {
        console.error('Save resume error:', error);
        res.status(500).json({ error: 'Failed to save resume' });
    }
});

// Draft an email using the user's saved resume + a job description
app.post('/draft-email', requireAuth, async (req, res) => {
    try {
        const { jobDescription } = req.body;
        if (!jobDescription || typeof jobDescription !== 'string' || !jobDescription.trim()) {
            return res.status(400).json({ error: 'jobDescription is required' });
        }
        if (jobDescription.length > 2000) {
            return res.status(400).json({ error: 'Job description must be 2,000 characters or less' });
        }

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        const { data, error } = await supabase
            .from('users')
            .select('resume_text')
            .eq('id', req.userId)
            .single();

        if (error || !data?.resume_text) {
            return res.status(400).json({ error: 'No resume saved. Add your resume in the Settings tab first.' });
        }

        const systemPrompt = `You are an expert at writing professional outreach emails. Given a person's resume and a job description or context, write a concise, personalized email body. Output ONLY the email body (no subject line, no greeting like "Dear X", no signature). Under 200 words. Reference specific relevant experience from the resume.`;

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.CLAUDE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'anthropic/claude-sonnet-4-5',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Resume:\n${data.resume_text}\n\nJob/Context:\n${jobDescription}` }
                ]
            })
        });

        const aiData = await response.json();
        if (!response.ok) {
            console.error('Draft API error:', aiData);
            return res.status(response.status).json({ error: aiData.error?.message || 'Draft failed' });
        }

        res.json({ draft: aiData.choices[0].message.content });
    } catch (error) {
        console.error('Draft email error:', error);
        res.status(500).json({ error: 'Failed to draft email' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

module.exports = app;
