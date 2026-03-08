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
 */
async function vectorSearch(supabase, userId, queryVector, filters) {
    const params = {
        p_user_id: userId,
        p_query_vector: JSON.stringify(queryVector),
        p_match_count: 20,
        p_from_email: filters?.from || null,
        p_after: filters?.after || null,
        p_before: filters?.before || null
    };

    const { data, error } = await supabase.rpc('search_email_vectors', params);

    if (error) throw new Error(`Vector search failed: ${error.message}`);
    return data || [];
}

/**
 * Group search results by gmail_message_id, boost summary matches,
 * pick the best chunk per message, return top 10 sorted by score.
 */
function groupAndRankResults(rows) {
    if (!rows || rows.length === 0) return [];

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

        // Boost summary matches by 1.5x
        const score = row.chunk_type === 'summary'
            ? row.similarity * 1.5
            : row.similarity;

        if (score > grouped[msgId].best_score) {
            grouped[msgId].best_score = score;
            grouped[msgId].best_chunk = row.chunk_text;
        }
    }

    // Convert to array, sort by score descending, take top 10
    return Object.values(grouped)
        .sort((a, b) => b.best_score - a.best_score)
        .slice(0, 10)
        .map(r => ({
            gmail_message_id: r.gmail_message_id,
            thread_id: r.thread_id,
            subject: r.subject,
            from_name: r.from_name,
            from_email: r.from_email,
            labels: r.labels,
            internal_date: r.internal_date,
            score: Math.round(r.best_score * 1000) / 1000,
            snippet: r.best_chunk.substring(0, 200)
        }));
}

module.exports = {
    embedQuery,
    vectorSearch,
    groupAndRankResults
};
