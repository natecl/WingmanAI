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
const { chunkText, buildSummaryText, embedTexts } = require('./services/embeddingService');
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
const multer = require('multer');
const PDFParser = require('pdf2json');

// Extract plain text from a PDF buffer using pdf2json (pure JS, Node 22 compatible)
function extractPdfText(buffer) {
    return new Promise((resolve, reject) => {
        const parser = new PDFParser(null, 1);
        parser.on('pdfParser_dataReady', (pdfData) => {
            try {
                const text = pdfData.Pages
                    .map(page =>
                        page.Texts
                            .map(t => t.R.map(r => decodeURIComponent(r.T)).join(''))
                            .join(' ')
                    )
                    .join('\n')
                    .trim();
                resolve(text);
            } catch (e) {
                reject(new Error('Failed to extract text from PDF'));
            }
        });
        parser.on('pdfParser_dataError', (err) => {
            reject(new Error(err.parserError || 'Failed to parse PDF'));
        });
        parser.parseBuffer(buffer);
    });
}

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
app.use('/draft-personalized-emails', apiLimiter);
app.use('/leads/summarize', apiLimiter);
app.use('/emails/summary', apiLimiter);

// Multer for PDF resume uploads
const resumeUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Only PDF files are allowed'));
    }
});

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

// AI: Classify if an email is a follow-up/reply to a prior conversation
app.post('/ai/classify-followup', requireAuth, async (req, res) => {
    const { subject = '', body = '' } = req.body;
    if (!subject && !body) return res.status(400).json({ error: 'subject or body required' });

    // Fast heuristic — no AI needed for clear Re: replies
    if (/^re:/i.test(subject)) return res.json({ isFollowUp: true, source: 'heuristic' });

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GEMINI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'google/gemini-2.0-flash-001',
                max_tokens: 5,
                messages: [
                    {
                        role: 'system',
                        content: 'You determine if an email is a follow-up or reply to a prior conversation (not a brand-new outreach). Answer only with the word "yes" or "no".'
                    },
                    {
                        role: 'user',
                        content: `Subject: ${subject}\nBody excerpt: ${body.substring(0, 400)}`
                    }
                ]
            })
        });
        const data = await response.json();
        const answer = (data.choices?.[0]?.message?.content || '').toLowerCase().trim();
        res.json({ isFollowUp: answer.startsWith('yes'), source: 'gemini' });
    } catch (err) {
        console.error('[AI classify-followup error]', err.message);
        res.json({ isFollowUp: false, source: 'error' });
    }
});

// AI: Summarize an email subject/body in 4-6 words
app.post('/ai/summarize-email', requireAuth, async (req, res) => {
    const { subject = '', body = '' } = req.body;
    if (!subject && !body) return res.status(400).json({ error: 'subject or body required' });

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GEMINI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'google/gemini-2.0-flash-001',
                max_tokens: 20,
                messages: [
                    {
                        role: 'system',
                        content: 'Generate a 4-6 word summary of this email\'s core topic. Output only the summary phrase, no punctuation at the end, no quotes.'
                    },
                    {
                        role: 'user',
                        content: `Subject: ${subject}\nBody excerpt: ${body.substring(0, 400)}`
                    }
                ]
            })
        });
        const data = await response.json();
        const summary = (data.choices?.[0]?.message?.content || '').trim().replace(/[".]+$/, '').substring(0, 60);
        res.json({ summary: summary || subject });
    } catch (err) {
        console.error('[AI summarize-email error]', err.message);
        res.json({ summary: subject || 'Email reminder' });
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
                    if (msgErr.code === 'GMAIL_AUTH_ERROR') {
                        console.warn(`[Sync] Gmail token expired for user ${req.userId} — stopping batch. User needs to re-authenticate.`);
                        break; // All subsequent messages will also fail — abort now
                    }
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
            .select('resume_text, resume_summary')
            .eq('id', req.userId)
            .single();
        // PGRST116 = "0 rows" — user exists in auth but has no profile row yet; treat as empty
        if (error && error.code !== 'PGRST116') return res.status(500).json({ error: 'Failed to fetch resume' });
        res.json({ resume_text: data?.resume_text || '', resume_summary: data?.resume_summary || '' });
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

// Upload a PDF resume, extract text, and save it
app.post('/user/resume/upload', requireAuth, (req, res, next) => {
    resumeUpload.single('resume')(req, res, (err) => {
        if (err) {
            if (err.message === 'Only PDF files are allowed')
                return res.status(400).json({ error: err.message });
            if (err.code === 'LIMIT_FILE_SIZE')
                return res.status(400).json({ error: 'File too large. Max 5 MB.' });
            return res.status(400).json({ error: 'Upload error: ' + err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

        let resume_text;
        try {
            resume_text = await extractPdfText(req.file.buffer);
        } catch (e) {
            console.error('[PDF Parse Error]', e.message);
            return res.status(400).json({ error: 'Could not parse PDF. Ensure it is a valid, text-based PDF.' });
        }

        resume_text = resume_text.trim();
        if (!resume_text) return res.status(400).json({ error: 'PDF appears to be empty or image-only.' });
        if (resume_text.length > 20000) return res.status(400).json({ error: 'Resume text exceeds 20,000 characters. Use a shorter resume.' });

        // Generate AI summary (non-fatal — upload still succeeds if this fails)
        let resume_summary = '';
        try {
            const summaryResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.CLAUDE_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'anthropic/claude-sonnet-4-5',
                    max_tokens: 300,
                    messages: [
                        {
                            role: 'system',
                            content: 'Summarize this resume in 3-4 sentences. Cover: current experience level, top skills, and career focus. Be professional and concise.'
                        },
                        { role: 'user', content: resume_text }
                    ]
                })
            });
            if (summaryResp.ok) {
                const sd = await summaryResp.json();
                resume_summary = sd.choices?.[0]?.message?.content?.trim() || '';
            } else {
                const errBody = await summaryResp.json().catch(() => ({}));
                console.error('[Resume Summary Error] OpenRouter returned', summaryResp.status, JSON.stringify(errBody).slice(0, 300));
            }
        } catch (e) {
            console.error('[Resume Summary Error]', e.message);
        }

        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { error } = await supabase
            .from('users')
            .upsert(
                { id: req.userId, email: req.userEmail, resume_text, resume_summary, updated_at: new Date().toISOString() },
                { onConflict: 'id' }
            );
        if (error) return res.status(500).json({ error: 'Failed to save resume' });

        res.json({ success: true, characters: resume_text.length, summary: resume_summary });
    } catch (error) {
        console.error('Resume upload error:', error);
        res.status(500).json({ error: 'Failed to upload resume' });
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
                max_tokens: 500,
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

// Draft personalized emails to up to 3 leads using arXiv research + user resume
app.post('/draft-personalized-emails', requireAuth, async (req, res) => {
    try {
        const { leads, purpose } = req.body;
        if (!Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({ error: 'leads array is required' });
        }

        const topLeads = leads.slice(0, 3);

        // Validate lead fields
        for (const lead of topLeads) {
            if (!lead.email || typeof lead.email !== 'string') {
                return res.status(400).json({ error: 'Each lead must have an email field' });
            }
        }

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('resume_text')
            .eq('id', req.userId)
            .single();

        if (userError || !userData?.resume_text) {
            return res.status(400).json({ error: 'No resume saved. Add your resume in the Settings tab first.' });
        }

        const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

        const drafts = await Promise.all(topLeads.map(async (lead) => {
            const name = (lead.name || '').trim();
            const detail = (lead.detail || '').trim();

            // ── Deep research pipeline: run all 3 sources in parallel ──────────
            const [arxivResult, profileResult, webResult] = await Promise.allSettled([

                // 1. arXiv author search — find their papers
                (async () => {
                    const q = encodeURIComponent(`${name} ${detail}`);
                    const scraped = await firecrawl.scrapeUrl(
                        `https://arxiv.org/search/?query=${q}&searchtype=author`,
                        { formats: ['markdown'] }
                    );
                    return scraped?.markdown?.substring(0, 3500) || '';
                })(),

                // 2. Source profile page — their faculty/department page
                lead.sourceUrl
                    ? (async () => {
                        const scraped = await firecrawl.scrapeUrl(lead.sourceUrl, { formats: ['markdown'] });
                        return scraped?.markdown?.substring(0, 3000) || '';
                    })()
                    : Promise.resolve(''),

                // 3. Web search — find personal site, Google Scholar, GitHub, etc.
                (async () => {
                    const searchRes = await firecrawl.search(
                        `"${name}" ${detail} research publications`,
                        { limit: 6 }
                    );
                    if (!searchRes?.data?.length) return '';

                    // Block social media and other sites Firecrawl can't scrape
                    const BLOCKED = ['facebook.com', 'twitter.com', 'x.com', 'instagram.com',
                        'tiktok.com', 'reddit.com', 'linkedin.com', 'youtube.com', 'wikipedia.org'];

                    const urls = searchRes.data
                        .map(r => r.url)
                        .filter(u => {
                            if (!u || u.includes('arxiv.org') || u === lead.sourceUrl) return false;
                            return !BLOCKED.some(d => u.includes(d));
                        })
                        .slice(0, 3);

                    const scraped = await Promise.allSettled(
                        urls.map(u => firecrawl.scrapeUrl(u, { formats: ['markdown'] }))
                    );
                    return scraped
                        .filter(r => r.status === 'fulfilled' && r.value?.markdown)
                        .map(r => r.value.markdown.substring(0, 2000))
                        .join('\n\n---\n\n');
                })()
            ]);

            const researchParts = [];
            if (arxivResult.status === 'fulfilled' && arxivResult.value)
                researchParts.push(`arXiv publications:\n${arxivResult.value}`);
            if (profileResult.status === 'fulfilled' && profileResult.value)
                researchParts.push(`Academic profile:\n${profileResult.value}`);
            if (webResult.status === 'fulfilled' && webResult.value)
                researchParts.push(`Additional web research:\n${webResult.value}`);

            const contextBlock = researchParts.join('\n\n===\n\n');

            // ── Claude prompt — forces specific, research-grounded writing ─────
            const systemPrompt = `You are an expert at writing highly personalized outreach emails that get replies. Your emails stand out because they demonstrate genuine knowledge of the recipient's work.

Write a cold email from the sender to the recipient. You MUST follow every rule below:
- **Cite specific work**: Name at least one specific paper title, project name, tool, or dataset from the research context. Do not just mention their general field.
- **Resume connection**: Identify the single most relevant skill, project, or experience from the sender's resume and make an explicit, concrete connection to the recipient's research — say exactly why it's relevant.
- **Purpose first**: If an email purpose/goal is stated, build the entire email around achieving that goal. Make it the opening hook.
- **No generic phrases**: Never use "I came across your work", "I am reaching out", "I hope this email finds you well", or similar filler openers. Start with something specific.
- **Tight and compelling**: 160–220 words in the body. Every sentence must earn its place.
- **Output**: Valid JSON with exactly two fields — "subject" (string, specific and compelling, not generic) and "body" (string, plain text, no greeting like "Dear X" or "Hi", no signature — just the body paragraphs).`;

            const purposeSection = purpose ? `\n\nEmail purpose/goal (make this the central focus): ${purpose}` : '';
            const userMessage = `SENDER RESUME:\n${userData.resume_text.substring(0, 4000)}\n\n===\n\nRECIPIENT: ${name}${detail ? ` — ${detail}` : ''}\nEMAIL: ${lead.email}\n\n===\n\nRESEARCH CONTEXT (use specific details from this):\n${contextBlock || 'No research context found — rely on resume and recipient name/role.'}${purposeSection}`;

            try {
                const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.CLAUDE_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'anthropic/claude-sonnet-4-5',
                        max_tokens: 900,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userMessage }
                        ]
                    })
                });

                const aiData = await aiRes.json();
                const raw = aiData.choices?.[0]?.message?.content || '{}';
                // Strip markdown code fences the model sometimes wraps around JSON
                const content = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
                const parsed = JSON.parse(content);

                return {
                    name,
                    email: lead.email,
                    subject: (parsed.subject || 'Hello from a fellow researcher').substring(0, 150),
                    body: parsed.body || `Hi,\n\nI came across your work and wanted to reach out.`
                };
            } catch (err) {
                console.error(`[Draft] Claude failed for ${name}:`, err.message);
                return {
                    name,
                    email: lead.email,
                    subject: `Hello from a fellow researcher`,
                    body: `Hi ${name},\n\nI came across your work and wanted to reach out.`
                };
            }
        }));

        res.json({ drafts });
    } catch (error) {
        console.error('[Draft personalized] Error:', error);
        res.status(500).json({ error: 'Failed to draft personalized emails' });
    }
});

// Fetch recent emails with AI priority scoring for the sidebar inbox summary
app.get('/emails/summary', requireAuth, async (req, res) => {
    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

        const { data: emails, error } = await supabase
            .from('gmail_messages')
            .select('gmail_message_id, thread_id, subject, from_name, from_email, internal_date, labels, body_text')
            .eq('user_id', req.userId)
            .contains('labels', ['INBOX'])
            .not('labels', 'cs', '{"SENT"}')
            .not('labels', 'cs', '{"DRAFT"}')
            .neq('from_email', req.userEmail)
            .order('internal_date', { ascending: false })
            .limit(20);

        if (error) return res.status(500).json({ error: 'Failed to fetch emails' });
        if (!emails?.length) return res.json({ emails: [] });

        // ── Pre-classify without AI ──────────────────────────────────────────
        // Only classify as low when we are 100% certain it is machine-generated.
        // CATEGORY_PROMOTIONS is the only Gmail label that reliably means no real person.
        // Sender pattern must be unambiguously robotic (noreply / mailer-daemon).
        const DEFINITE_AUTO_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_PURCHASES']);
        const DEFINITE_AUTO_SENDER_RE = /(?:^|[\+.])(?:no.?reply|donotreply|mailer.daemon|bounce[sd]?|postmaster)@/i;

        const preClassified = new Map(); // index (1-based) → { priority, reason }
        const needsAI = []; // { email, originalIndex }

        emails.forEach((email, i) => {
            const labels = email.labels || [];
            const fromEmail = (email.from_email || '').toLowerCase();

            if (labels.some(l => DEFINITE_AUTO_LABELS.has(l)) || DEFINITE_AUTO_SENDER_RE.test(fromEmail)) {
                preClassified.set(i + 1, { priority: 'low', reason: 'Automated sender' });
            } else {
                needsAI.push({ email, originalIndex: i + 1 });
            }
        });

        // ── AI-score only non-automated emails ──────────────────────────────
        let aiScores = new Map(); // originalIndex → { priority, reason }

        if (needsAI.length > 0) {
            const emailList = needsAI.map(({ email, originalIndex }, j) =>
                `${j + 1}. From: ${email.from_name || email.from_email} | Subject: "${email.subject || '(no subject)'}"` +
                `\n   Preview: ${(email.body_text || '').substring(0, 150).replace(/\n/g, ' ')}`
            ).join('\n\n');

            const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.GEMINI_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'google/gemini-2.0-flash-001',
                    max_tokens: 600,
                    messages: [{
                        role: 'user',
                        content: `Score each email by urgency/importance for the recipient.
Return a JSON array only. Each item: {"index":N,"priority":"high|medium|low","reason":"max 6 words"}.

- "high": needs a reply or action — interview, job offer, professor/advisor, deadline, question directed at you, urgent request
- "medium": personal or informational message from a real individual — classmates, friends, colleagues, genuine human-written communication
- "low": marketing, advertising, promotional offers, sales pitches, newsletters, bulk/impersonal content — even if sent from a real email address

RULE: If the email is a personal message written specifically for you by a real person, it CANNOT be "low". Only use "low" for clearly impersonal, marketing, or advertising content.

Emails:
${emailList}

Return ONLY the JSON array.`
                    }]
                })
            });

            const aiData = await aiRes.json();
            const raw = aiData.choices?.[0]?.message?.content || '[]';
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
            let scores = [];
            try { scores = JSON.parse(cleaned); } catch (_) {}

            needsAI.forEach(({ originalIndex }, j) => {
                const score = scores.find(s => s.index === j + 1);
                const p = score?.priority;
                const priority = p === 'high' ? 'high' : p === 'low' ? 'low' : 'medium';
                aiScores.set(originalIndex, { priority, reason: score?.reason || '' });
            });
        }

        const result = emails.map((email, i) => {
            const idx = i + 1;
            const score = preClassified.get(idx) || aiScores.get(idx) || { priority: 'medium', reason: '' };
            return {
                gmail_message_id: email.gmail_message_id,
                thread_id: email.thread_id,
                subject: email.subject || '(no subject)',
                from_name: email.from_name || email.from_email,
                from_email: email.from_email,
                internal_date: email.internal_date,
                priority: score.priority,
                reason: score.reason
            };
        });

        // High priority first, then medium, then low; date-sorted within each tier
        const order = { high: 0, medium: 1, low: 2 };
        result.sort((a, b) => {
            const d = order[a.priority] - order[b.priority];
            return d !== 0 ? d : new Date(b.internal_date) - new Date(a.internal_date);
        });

        res.json({ emails: result });
    } catch (error) {
        console.error('[Emails summary] Error:', error);
        res.status(500).json({ error: 'Failed to load email summary' });
    }
});

// Generate brief AI research summaries for up to 3 leads (Gemini Flash)
app.post('/leads/summarize', requireAuth, async (req, res) => {
    try {
        const { leads } = req.body;
        if (!Array.isArray(leads) || leads.length === 0)
            return res.status(400).json({ error: 'leads array is required' });

        const topLeads = leads.slice(0, 3);
        const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

        const BLOCKED = ['facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'youtube.com'];

        const summaries = await Promise.allSettled(topLeads.map(async (lead) => {
            const name = (lead.name || '').trim();
            const detail = (lead.detail || '').trim();

            // Gather context — profile page first, then a web search fallback
            let context = detail;
            try {
                if (lead.sourceUrl) {
                    const scraped = await firecrawl.scrapeUrl(lead.sourceUrl, { formats: ['markdown'] });
                    if (scraped?.markdown) context = scraped.markdown.substring(0, 2500);
                } else {
                    const searchRes = await firecrawl.search(`"${name}" ${detail} research`, { limit: 4 });
                    const url = searchRes?.data
                        ?.map(r => r.url)
                        .find(u => u && !BLOCKED.some(d => u.includes(d)));
                    if (url) {
                        const scraped = await firecrawl.scrapeUrl(url, { formats: ['markdown'] });
                        if (scraped?.markdown) context = scraped.markdown.substring(0, 2500);
                    }
                }
            } catch (_) { /* use whatever context we have */ }

            const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GEMINI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'google/gemini-2.0-flash-001',
                    max_tokens: 120,
                    messages: [{
                        role: 'user',
                        content: `Write a 1–2 sentence research summary for ${name || 'this person'} (${detail}). Focus on their specific research topics, methods, or notable projects — be concrete, not generic. Use the context below.\n\nContext:\n${context}\n\nOutput only the summary.`
                    }]
                })
            });
            const aiData = await aiRes.json();
            const summary = aiData.choices?.[0]?.message?.content?.trim() || detail;
            return { email: lead.email, summary };
        }));

        const result = summaries.map((s, i) =>
            s.status === 'fulfilled' ? s.value : { email: topLeads[i].email, summary: topLeads[i].detail || '' }
        );

        res.json({ summaries: result });
    } catch (error) {
        console.error('[Leads summarize] Error:', error);
        res.status(500).json({ error: 'Failed to summarize leads' });
    }
});

// Process pending indexing jobs (serverless-compatible replacement for workers/indexer.js)
// Called by: Vercel Cron (with CRON_SECRET) or client (with Supabase JWT)
app.post('/api/process-indexing-jobs', async (req, res) => {
    try {
        // Auth: accept either CRON_SECRET or valid Supabase JWT
        const authHeader = req.headers['authorization'] || '';
        const cronSecret = process.env.CRON_SECRET;
        const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

        if (!isCron) {
            // Fall back to Supabase JWT auth
            try {
                await new Promise((resolve, reject) => {
                    requireAuth(req, res, (err) => err ? reject(err) : resolve());
                });
            } catch {
                return res.status(401).json({ error: 'Unauthorized' });
            }
        }

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const embeddingApiKey = process.env.OPENAI_EMBEDDING_API_KEY;
        const isEmbeddingOpenRouter = embeddingApiKey && embeddingApiKey.startsWith('sk-or-v1');
        const openaiClient = new OpenAI({
            apiKey: embeddingApiKey,
            baseURL: isEmbeddingOpenRouter ? "https://openrouter.ai/api/v1" : undefined,
            defaultHeaders: isEmbeddingOpenRouter ? {
                "HTTP-Referer": process.env.VERCEL_URL || "http://localhost:3000",
                "X-Title": "BetterEmail V2"
            } : undefined
        });

        const BATCH_SIZE = 5; // 512d embeddings are fast enough for 5 jobs in 10s
        let processed = 0, errors = 0;

        for (let i = 0; i < BATCH_SIZE; i++) {
            const { data, error } = await supabase.rpc('claim_indexing_job');
            if (error || !data || data.length === 0) break;

            const job = data[0];
            const { job_id, job_message_id, job_user_id } = job;

            try {
                // Fetch the message
                const { data: msg, error: msgError } = await supabase
                    .from('gmail_messages')
                    .select('*')
                    .eq('id', job_message_id)
                    .single();

                if (msgError || !msg) throw new Error(`Message ${job_message_id} not found`);

                // Build summary + chunks
                const summaryText = buildSummaryText(msg);
                const chunks = chunkText(msg.body_text || '');
                const textsToEmbed = [summaryText, ...chunks].filter(t => t.trim());

                if (textsToEmbed.length === 0) {
                    await supabase.from('indexing_jobs')
                        .update({ status: 'done', updated_at: new Date().toISOString() })
                        .eq('id', job_id);
                    processed++;
                    continue;
                }

                // Embed all texts
                const embeddings = await embedTexts(openaiClient, textsToEmbed);

                // Delete old vectors, insert new ones
                await supabase.from('gmail_message_vectors')
                    .delete().eq('message_id', job_message_id);

                const vectorRows = embeddings.map((embedding, idx) => ({
                    message_id: job_message_id,
                    user_id: job_user_id,
                    chunk_type: idx === 0 ? 'summary' : 'chunk',
                    chunk_index: idx === 0 ? 0 : idx - 1,
                    chunk_text: textsToEmbed[idx],
                    embedding: JSON.stringify(embedding)
                }));

                const { error: insertError } = await supabase
                    .from('gmail_message_vectors').insert(vectorRows);

                if (insertError) throw new Error(`Vector insert failed: ${insertError.message}`);

                await supabase.from('indexing_jobs')
                    .update({ status: 'done', updated_at: new Date().toISOString() })
                    .eq('id', job_id);

                processed++;
                console.log(`[Indexing] Job ${job_id} done — ${vectorRows.length} vectors stored`);

            } catch (err) {
                console.error(`[Indexing] Job ${job_id} error:`, err.message);
                await supabase.from('indexing_jobs')
                    .update({ status: 'error', error_message: err.message.substring(0, 500), updated_at: new Date().toISOString() })
                    .eq('id', job_id);
                errors++;
            }
        }

        // Count remaining pending jobs
        const { count } = await supabase
            .from('indexing_jobs')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending');

        res.json({ processed, errors, remaining: count || 0 });

    } catch (error) {
        console.error('[Indexing] Endpoint error:', error);
        res.status(500).json({ error: 'Failed to process indexing jobs' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

module.exports = app;
