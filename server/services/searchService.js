/**
 * BetterEmail V2 — Search Service
 *
 * Vector similarity search with grouping and ranking.
 */

const OpenAI = require('openai');

/**
 * Embed a search query using the same model as indexing.
 */
async function embedQuery(openai, query) {
    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: query,
        dimensions: 512
    });

    return response.data[0].embedding;
}

/**
 * Run vector similarity search via Supabase RPC.
 * Fetches 50 candidates to give the re-ranker more material.
 */
async function vectorSearch(supabase, userId, queryVector, filters) {
    const params = {
        p_user_id: userId,
        p_query_vector: JSON.stringify(queryVector),
        p_match_count: 50,
        p_from_email: filters?.from || null,
        p_after: filters?.after || null,
        p_before: filters?.before || null
    };

    const { data, error } = await supabase.rpc('search_email_vectors', params);

    if (error) throw new Error(`Vector search failed: ${error.message}`);
    return data || [];
}

/**
 * Find the best 250-char window in text that contains the most query keywords.
 * Prepends/appends "..." when the window doesn't start/end at the text boundary.
 */
function extractSnippet(text, queryWords, maxLen = 250) {
    if (!text) return '';
    if (queryWords.length === 0) return text.substring(0, maxLen);

    const lower = text.toLowerCase();
    let bestPos = 0;
    let bestCount = 0;

    for (let i = 0; i <= Math.max(0, text.length - maxLen); i += 40) {
        const window = lower.substring(i, i + maxLen);
        const count = queryWords.filter(w => window.includes(w)).length;
        if (count > bestCount) {
            bestCount = count;
            bestPos = i;
        }
    }

    let snippet = text.substring(bestPos, bestPos + maxLen).trim();
    if (bestPos > 0) snippet = '…' + snippet;
    if (bestPos + maxLen < text.length) snippet += '…';
    return snippet;
}

/**
 * Group search results by gmail_message_id, boost summary + keyword matches,
 * pick the best chunk per message, return top 15 sorted by score.
 *
 * @param {Array}  rows  - Raw rows from vectorSearch
 * @param {string} query - Original user query (for keyword boost)
 */
function groupAndRankResults(rows, query) {
    if (!rows || rows.length === 0) return [];

    // Meaningful keywords (length > 2, ignore stop words)
    const STOP = new Set(['the','and','for','from','about','with','that','this','was','are','have','has','had','not','but','you','your','our','can','will','just','been','were','they','what','when','where','how','its','their','there','here','also','very','more','than','into','out','over','who','him','her','his','she','one','all','any','some','each','then','them','these','those','such','like','time','only','other','after','before','around','because']);
    const queryWords = (query || '')
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP.has(w));

    const grouped = {};

    for (const row of rows) {
        const msgId = row.gmail_message_id;

        if (!grouped[msgId]) {
            grouped[msgId] = {
                gmail_message_id: msgId,
                thread_id: row.thread_id,
                subject: row.subject,
                from_name: row.from_name,
                from_email: row.from_email,
                labels: row.labels,
                internal_date: row.internal_date,
                best_score: 0,
                best_chunk: ''
            };
        }

        let score = row.similarity;

        // Boost summary chunk (already captures subject + from + body intro)
        if (row.chunk_type === 'summary') score *= 1.5;

        // Keyword boost: up to +20% if query terms appear in the chunk
        if (queryWords.length > 0) {
            const chunkLower = (row.chunk_text || '').toLowerCase();
            const hits = queryWords.filter(w => chunkLower.includes(w)).length;
            score *= 1 + Math.min(hits / queryWords.length, 1) * 0.2;
        }

        if (score > grouped[msgId].best_score) {
            grouped[msgId].best_score = score;
            grouped[msgId].best_chunk = row.chunk_text;
        }
    }

    return Object.values(grouped)
        .sort((a, b) => b.best_score - a.best_score)
        .slice(0, 15)
        .map(r => ({
            gmail_message_id: r.gmail_message_id,
            thread_id: r.thread_id,
            subject: r.subject,
            from_name: r.from_name,
            from_email: r.from_email,
            labels: r.labels,
            internal_date: r.internal_date,
            score: Math.min(Math.round(r.best_score * 1000) / 1000, 0.999),
            snippet: extractSnippet(r.best_chunk, queryWords)
        }));
}

module.exports = {
    embedQuery,
    vectorSearch,
    groupAndRankResults,
    extractSnippet
};
