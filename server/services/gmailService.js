/**
 * BetterEmail V2 — Gmail Ingestion Service
 *
 * All functions use dependency injection for testability.
 */

const crypto = require('crypto');

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Fetch message IDs from Gmail. Supports incremental sync via historyId.
 * Returns { messageIds: string[], newHistoryId: string }
 */
async function fetchMessageIds(accessToken, historyId) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const messageIds = [];

    if (historyId) {
        // Incremental sync via history API
        let pageToken = null;
        do {
            const url = new URL(`${GMAIL_API_BASE}/history`);
            url.searchParams.set('startHistoryId', historyId);
            url.searchParams.set('historyTypes', 'messageAdded');
            url.searchParams.set('maxResults', '500');
            if (pageToken) url.searchParams.set('pageToken', pageToken);

            const res = await fetch(url.toString(), { headers });
            if (!res.ok) {
                // If historyId is invalid/expired, fall back to full sync
                if (res.status === 404) break;
                throw new Error(`Gmail history API error: ${res.status}`);
            }

            const data = await res.json();
            const history = data.history || [];

            for (const record of history) {
                for (const msg of record.messagesAdded || []) {
                    messageIds.push(msg.message.id);
                }
            }

            pageToken = data.nextPageToken || null;
        } while (pageToken);

        if (messageIds.length > 0) {
            return { messageIds: [...new Set(messageIds)], newHistoryId: null };
        }
    }

    // Full sync — list recent messages
    let pageToken = null;
    let newHistoryId = null;

    do {
        const url = new URL(`${GMAIL_API_BASE}/messages`);
        url.searchParams.set('maxResults', '100');
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const res = await fetch(url.toString(), { headers });
        if (!res.ok) throw new Error(`Gmail list API error: ${res.status}`);

        const data = await res.json();
        const messages = data.messages || [];

        for (const msg of messages) {
            messageIds.push(msg.id);
        }

        // Capture historyId from first page
        if (!newHistoryId && data.resultSizeEstimate) {
            // We'll get the historyId from individual messages
        }

        pageToken = data.nextPageToken || null;
    } while (pageToken);

    return { messageIds, newHistoryId };
}

/**
 * Fetch a single full message from Gmail.
 */
async function fetchMessage(accessToken, messageId) {
    const res = await fetch(`${GMAIL_API_BASE}/messages/${messageId}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (res.status === 401 || res.status === 403) {
        const err = new Error(`Gmail token expired or unauthorized (${res.status})`);
        err.code = 'GMAIL_AUTH_ERROR';
        err.status = res.status;
        throw err;
    }
    if (!res.ok) throw new Error(`Gmail get message error: ${res.status}`);
    return res.json();
}

/**
 * Recursively extract plain text from MIME payload.
 * Falls back to HTML stripping if no plain text found.
 */
function extractBodyText(payload) {
    if (!payload) return '';

    // Simple body (no parts)
    if (payload.body && payload.body.data) {
        const mimeType = payload.mimeType || '';
        const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf-8');

        if (mimeType === 'text/plain') return decoded;
        if (mimeType === 'text/html') return stripHtml(decoded);
        return decoded;
    }

    // Multipart — recurse into parts
    if (payload.parts && payload.parts.length > 0) {
        // Prefer text/plain
        for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                return Buffer.from(part.body.data, 'base64url').toString('utf-8');
            }
        }

        // Fall back to HTML
        for (const part of payload.parts) {
            if (part.mimeType === 'text/html' && part.body && part.body.data) {
                return stripHtml(Buffer.from(part.body.data, 'base64url').toString('utf-8'));
            }
        }

        // Recurse into nested multipart
        for (const part of payload.parts) {
            const text = extractBodyText(part);
            if (text) return text;
        }
    }

    return '';
}

/**
 * Strip HTML tags, style/script blocks, and decode common entities.
 */
function stripHtml(html) {
    if (!html) return '';

    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Remove quoted replies, signatures, and forwarded headers from body text.
 */
function cleanBodyText(text) {
    if (!text) return '';

    let cleaned = text;

    // Remove "On ... wrote:" quoted replies (multiline)
    cleaned = cleaned.replace(/On\s+.{10,80}\s+wrote:\s*[\s\S]*/i, '');

    // Remove forwarded headers
    cleaned = cleaned.replace(/------+\s*Forwarded message\s*------+[\s\S]*/i, '');

    // Remove signature blocks ("-- " followed by content)
    cleaned = cleaned.replace(/\n-- \n[\s\S]*/m, '');

    // Collapse excessive newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}

/**
 * Compute SHA-256 hash of text for change detection.
 */
function computeBodyHash(text) {
    if (!text) return null;
    return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Case-insensitive header lookup.
 */
function getHeader(headers, name) {
    if (!headers || !Array.isArray(headers)) return null;
    const lower = name.toLowerCase();
    const found = headers.find(h => h.name.toLowerCase() === lower);
    return found ? found.value : null;
}

/**
 * Parse "Name <email>" format. Returns { name, email }.
 */
function parseFrom(fromHeader) {
    if (!fromHeader) return { name: '', email: '' };

    const match = fromHeader.match(/^(.*?)\s*<([^>]+)>$/);
    if (match) {
        return {
            name: match[1].replace(/^["']|["']$/g, '').trim(),
            email: match[2].trim()
        };
    }

    // Just an email address
    if (fromHeader.includes('@')) {
        return { name: '', email: fromHeader.trim() };
    }

    return { name: fromHeader.trim(), email: '' };
}

/**
 * Upsert a message into gmail_messages. Queues to indexing_jobs if new or changed.
 * Returns 'new' | 'unchanged' | 'changed'.
 */
async function upsertMessage(supabase, userId, msgData) {
    const { gmailMessageId, threadId, subject, fromName, fromEmail, toEmails, labels, internalDate, bodyText, bodyHash } = msgData;

    // Check if message exists
    const { data: existing } = await supabase
        .from('gmail_messages')
        .select('id, body_hash')
        .eq('user_id', userId)
        .eq('gmail_message_id', gmailMessageId)
        .single();

    if (existing && existing.body_hash === bodyHash) {
        return 'unchanged';
    }

    const row = {
        user_id: userId,
        gmail_message_id: gmailMessageId,
        thread_id: threadId,
        subject,
        from_name: fromName,
        from_email: fromEmail,
        to_emails: toEmails,
        labels,
        internal_date: internalDate,
        body_text: bodyText,
        body_hash: bodyHash,
        updated_at: new Date().toISOString()
    };

    const { data: upserted, error } = await supabase
        .from('gmail_messages')
        .upsert(row, { onConflict: 'user_id,gmail_message_id' })
        .select('id')
        .single();

    if (error) throw new Error(`Upsert failed: ${error.message}`);

    // Queue for indexing
    await supabase.from('indexing_jobs').insert({
        message_id: upserted.id,
        user_id: userId,
        status: 'pending'
    });

    return existing ? 'changed' : 'new';
}

/**
 * Store Gmail OAuth tokens in the users table.
 */
async function storeGmailTokens(supabase, userId, email, tokens) {
    await supabase.from('users').upsert({
        id: userId,
        email,
        gmail_tokens: tokens,
        updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
}

/**
 * Retrieve stored Gmail tokens and history_id for a user.
 */
async function getGmailTokens(supabase, userId) {
    const { data, error } = await supabase
        .from('users')
        .select('gmail_tokens, history_id')
        .eq('id', userId)
        .single();

    if (error || !data) return null;
    return data;
}

/**
 * MIME types we extract and store as media during Gmail sync.
 */
const MEDIA_ATTACHMENT_TYPES = new Set([
    'application/pdf',
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'
]);

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Recursively walk a Gmail message payload and return metadata for every
 * attachment whose MIME type we support and that fits within the size limit.
 * Returns [{ filename, mimeType, attachmentId, size }]
 */
function extractAttachmentMeta(payload) {
    const results = [];

    function walk(part) {
        if (!part) return;
        const filename     = part.filename;
        const mimeType     = (part.mimeType || '').toLowerCase();
        const attachmentId = part.body?.attachmentId;
        const size         = part.body?.size || 0;

        if (filename && attachmentId && MEDIA_ATTACHMENT_TYPES.has(mimeType) && size <= MAX_ATTACHMENT_BYTES) {
            results.push({ filename, mimeType, attachmentId, size });
        }

        for (const child of (part.parts || [])) {
            walk(child);
        }
    }

    walk(payload);
    return results;
}

/**
 * Fetch the binary data of a Gmail attachment.
 * Returns a Node.js Buffer.
 */
async function fetchAttachmentData(accessToken, messageId, attachmentId) {
    const res = await fetch(
        `${GMAIL_API_BASE}/messages/${messageId}/attachments/${attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`Gmail attachment fetch error: ${res.status}`);
    const json = await res.json();
    // Gmail returns base64url encoding; convert to standard base64 before decoding
    const base64 = (json.data || '').replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64');
}

module.exports = {
    fetchMessageIds,
    fetchMessage,
    extractBodyText,
    stripHtml,
    cleanBodyText,
    computeBodyHash,
    getHeader,
    parseFrom,
    upsertMessage,
    storeGmailTokens,
    getGmailTokens,
    extractAttachmentMeta,
    fetchAttachmentData
};
