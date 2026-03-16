/**
 * BetterEmail V2 — Embedding Service
 *
 * Text chunking and OpenAI embedding functions for the indexing pipeline.
 */

/**
 * Split body text into chunks of 300-800 tokens (approx 4 chars/token).
 * Splits on paragraph boundaries, merges short paragraphs, splits oversized by sentence.
 */
function chunkText(text) {
    if (!text || !text.trim()) return [];

    const MIN_CHARS = 300 * 4;  // ~300 tokens
    const MAX_CHARS = 800 * 4;  // ~800 tokens

    // Split on double newlines (paragraphs)
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

    if (paragraphs.length === 0) return [];

    const chunks = [];
    let current = '';

    for (const para of paragraphs) {
        const trimmed = para.trim();

        // If this paragraph alone exceeds max, split by sentences
        if (trimmed.length > MAX_CHARS) {
            // Flush current buffer first
            if (current.trim()) {
                chunks.push(current.trim());
                current = '';
            }

            // Split oversized paragraph by sentences
            const sentences = trimmed.match(/[^.!?]+[.!?]+\s*/g) || [trimmed];
            let sentBuf = '';

            for (const sent of sentences) {
                if ((sentBuf + sent).length > MAX_CHARS && sentBuf.trim()) {
                    chunks.push(sentBuf.trim());
                    sentBuf = sent;
                } else {
                    sentBuf += sent;
                }
            }

            if (sentBuf.trim()) {
                current = sentBuf;
            }

            continue;
        }

        // Would appending exceed max?
        if ((current + '\n\n' + trimmed).length > MAX_CHARS && current.trim()) {
            chunks.push(current.trim());
            current = trimmed;
        } else {
            current = current ? current + '\n\n' + trimmed : trimmed;
        }
    }

    // Flush remaining
    if (current.trim()) {
        chunks.push(current.trim());
    }

    // Merge final chunk if too short and there's a previous chunk
    if (chunks.length > 1 && chunks[chunks.length - 1].length < MIN_CHARS) {
        const last = chunks.pop();
        chunks[chunks.length - 1] += '\n\n' + last;
    }

    return chunks;
}

/**
 * Build a summary text from message metadata for the "summary" embedding.
 * Format: "Subject: ...\nFrom: ...\n{first 400 chars of body}"
 */
function buildSummaryText(msg) {
    const parts = [];

    if (msg.subject) parts.push(`Subject: ${msg.subject}`);
    if (msg.from_name || msg.from_email) {
        const from = msg.from_name ? `${msg.from_name} <${msg.from_email}>` : msg.from_email;
        parts.push(`From: ${from}`);
    }

    if (msg.body_text) {
        const bodyPreview = msg.body_text.substring(0, 400);
        parts.push(bodyPreview);
    }

    return parts.join('\n');
}

/**
 * Batch embed texts using OpenAI text-embedding-3-small (512 dimensions).
 * 512d is 3x faster for storage/search with minimal quality loss
 * (model uses Matryoshka Representation Learning for native dim reduction).
 */
async function embedTexts(openai, texts) {
    if (!texts || texts.length === 0) return [];

    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts,
        dimensions: 1536
    });

    return response.data.map(d => d.embedding);
}

module.exports = {
    chunkText,
    buildSummaryText,
    embedTexts
};
