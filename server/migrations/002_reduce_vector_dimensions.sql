-- ============================================================
-- BetterEmailV2 — Reduce vector dimensions from 1536 to 512
-- Run this in Supabase SQL Editor
--
-- This migration:
-- 1. Drops existing vectors (must be re-indexed with 512d)
-- 2. Changes the column type from vector(1536) to vector(512)
-- 3. Updates the search function parameter type
-- 4. Resets pending indexing jobs so they get re-processed
-- ============================================================

-- 1. Delete all existing vectors (they are 1536d, incompatible with 512d)
DELETE FROM gmail_message_vectors;

-- 2. Alter column type
ALTER TABLE gmail_message_vectors
    ALTER COLUMN embedding TYPE VECTOR(512);

-- 3. Update the search function to accept 512d vectors
CREATE OR REPLACE FUNCTION search_email_vectors(
    p_user_id UUID,
    p_query_vector VECTOR(512),
    p_match_count INT DEFAULT 20,
    p_from_email TEXT DEFAULT NULL,
    p_after TIMESTAMPTZ DEFAULT NULL,
    p_before TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(
    vector_id BIGINT,
    message_id BIGINT,
    gmail_message_id TEXT,
    thread_id TEXT,
    subject TEXT,
    from_name TEXT,
    from_email TEXT,
    labels TEXT[],
    internal_date TIMESTAMPTZ,
    chunk_type TEXT,
    chunk_text TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.id AS vector_id,
        v.message_id,
        m.gmail_message_id,
        m.thread_id,
        m.subject,
        m.from_name,
        m.from_email,
        m.labels,
        m.internal_date,
        v.chunk_type,
        v.chunk_text,
        1 - (v.embedding <=> p_query_vector) AS similarity
    FROM gmail_message_vectors v
    JOIN gmail_messages m ON v.message_id = m.id
    WHERE v.user_id = p_user_id
      AND (p_from_email IS NULL OR m.from_email ILIKE '%' || p_from_email || '%')
      AND (p_after IS NULL OR m.internal_date >= p_after)
      AND (p_before IS NULL OR m.internal_date <= p_before)
    ORDER BY v.embedding <=> p_query_vector ASC
    LIMIT p_match_count;
END;
$$;

-- 4. Reset all indexing jobs to pending so emails get re-indexed with 512d
UPDATE indexing_jobs SET status = 'pending', updated_at = NOW()
WHERE status IN ('done', 'error');
