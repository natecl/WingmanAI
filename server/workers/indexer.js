/**
 * BetterEmail V2 — Background Indexing Worker
 *
 * Standalone Node process that polls indexing_jobs, embeds messages,
 * and stores vectors in gmail_message_vectors.
 *
 * Usage: node workers/indexer.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { chunkText, buildSummaryText, embedTexts } = require('../services/embeddingService');
const logger = require('../lib/logger');
const metrics = require('../lib/metrics');

const POLL_INTERVAL_MS = 5000; // 5 seconds

// Initialize clients
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

/**
 * Process a single indexing job.
 */
async function processJob(job) {
    const { job_id, job_message_id, job_user_id } = job;

    const jobTimer = metrics.startTimer();
    logger.info({ job_id, message_id: job_message_id, user_id: job_user_id }, 'job_start');

    try {
        // Fetch the message
        const { data: msg, error: msgError } = await supabase
            .from('gmail_messages')
            .select('*')
            .eq('id', job_message_id)
            .single();

        if (msgError || !msg) {
            throw new Error(`Message ${job_message_id} not found`);
        }

        // Build summary text
        const summaryText = buildSummaryText(msg);

        // Chunk the body
        const chunks = chunkText(msg.body_text || '');

        // Prepare all texts to embed (summary first, then chunks)
        const textsToEmbed = [summaryText, ...chunks].filter(t => t.trim());

        if (textsToEmbed.length === 0) {
            logger.warn({ job_id }, 'job_no_text_skip');
            await markJobDone(job_id);
            return;
        }

        // Embed all texts in one batch
        const embedTimer = metrics.startTimer();
        const embeddings = await embedTexts(openai, textsToEmbed);
        const embedMs = embedTimer();
        metrics.recordLatency('embedding', embedMs);

        // Delete old vectors for this message (re-indexing)
        await supabase
            .from('gmail_message_vectors')
            .delete()
            .eq('message_id', job_message_id);

        // Insert new vectors
        const vectorRows = embeddings.map((embedding, idx) => ({
            message_id: job_message_id,
            user_id: job_user_id,
            chunk_type: idx === 0 ? 'summary' : 'chunk',
            chunk_index: idx === 0 ? 0 : idx - 1,
            chunk_text: textsToEmbed[idx],
            embedding: JSON.stringify(embedding)
        }));

        const { error: insertError } = await supabase
            .from('gmail_message_vectors')
            .insert(vectorRows);

        if (insertError) {
            throw new Error(`Vector insert failed: ${insertError.message}`);
        }

        await markJobDone(job_id);
        metrics.inc('embedding', 'jobs_processed');
        metrics.inc('embedding', 'texts_embedded', vectorRows.length);
        logger.info({ job_id, vectors: vectorRows.length, embed_ms: embedMs, total_ms: jobTimer() }, 'job_done');

    } catch (err) {
        metrics.inc('embedding', 'errors');
        logger.error({ job_id, err: err.message }, 'job_error');
        await markJobError(job_id, err.message);
    }
}

async function markJobDone(jobId) {
    await supabase
        .from('indexing_jobs')
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('id', jobId);
}

async function markJobError(jobId, errorMessage) {
    await supabase
        .from('indexing_jobs')
        .update({
            status: 'error',
            error_message: errorMessage.substring(0, 500),
            updated_at: new Date().toISOString()
        })
        .eq('id', jobId);
}

/**
 * Main polling loop.
 */
async function poll() {
    try {
        // Claim a job atomically
        const { data, error } = await supabase.rpc('claim_indexing_job');

        if (error) {
            console.error('Failed to claim job:', error.message);
            return;
        }

        if (!data || data.length === 0) {
            // No pending jobs
            return;
        }

        const job = data[0];
        await processJob(job);

    } catch (err) {
        logger.error({ err: err.message }, 'poll_error');
    }
}

/**
 * Start the worker.
 */
async function start() {
    logger.info({ poll_interval_s: POLL_INTERVAL_MS / 1000 }, 'worker_started');

    // Run immediately, then poll
    await poll();

    setInterval(poll, POLL_INTERVAL_MS);
}

start();
