-- ============================================================
-- BetterEmailV2 — Semantic Search Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Users table (references Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    gmail_tokens JSONB,          -- { access_token, refresh_token, expiry_date }
    history_id TEXT,             -- Gmail incremental sync cursor
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Gmail messages table
CREATE TABLE IF NOT EXISTS gmail_messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gmail_message_id TEXT NOT NULL,
    thread_id TEXT,
    subject TEXT,
    from_name TEXT,
    from_email TEXT,
    to_emails TEXT[],
    labels TEXT[],
    internal_date TIMESTAMPTZ,
    body_text TEXT,
    body_hash TEXT,               -- SHA-256 for change detection
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS idx_gmail_messages_user_id ON gmail_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_gmail_messages_internal_date ON gmail_messages(user_id, internal_date DESC);

-- 4. Gmail message vectors table
CREATE TABLE IF NOT EXISTS gmail_message_vectors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES gmail_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chunk_type TEXT NOT NULL CHECK (chunk_type IN ('summary', 'chunk')),
    chunk_index INT NOT NULL DEFAULT 0,
    chunk_text TEXT NOT NULL,
    embedding VECTOR(512) NOT NULL,    -- reduced from 1536 via 002_reduce_vector_dimensions.sql
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vectors_user_id ON gmail_message_vectors(user_id);

-- IVFFlat index for fast similarity search (create after initial data load for best results)
-- If you have < 1000 rows, you can skip this and use exact search instead
-- CREATE INDEX IF NOT EXISTS idx_vectors_embedding ON gmail_message_vectors
--     USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 5. Indexing jobs queue
CREATE TABLE IF NOT EXISTS indexing_jobs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES gmail_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'error')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indexing_jobs_status ON indexing_jobs(status) WHERE status = 'pending';

-- ============================================================
-- RLS Policies
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_message_vectors ENABLE ROW LEVEL SECURITY;
-- indexing_jobs uses service-role key, no RLS needed

-- Users: can only read/update their own row
CREATE POLICY users_select ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY users_update ON users FOR UPDATE USING (auth.uid() = id);

-- Gmail messages: users only see their own
CREATE POLICY gmail_messages_select ON gmail_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY gmail_messages_insert ON gmail_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY gmail_messages_update ON gmail_messages FOR UPDATE USING (auth.uid() = user_id);

-- Vectors: users only see their own
CREATE POLICY gmail_vectors_select ON gmail_message_vectors FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY gmail_vectors_insert ON gmail_message_vectors FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY gmail_vectors_delete ON gmail_message_vectors FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- SQL Functions
-- ============================================================

-- Claim a pending indexing job atomically
CREATE OR REPLACE FUNCTION claim_indexing_job()
RETURNS TABLE(
    job_id BIGINT,
    job_message_id BIGINT,
    job_user_id UUID
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    UPDATE indexing_jobs
    SET status = 'processing', updated_at = NOW()
    WHERE id = (
        SELECT id FROM indexing_jobs
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING id AS job_id, message_id AS job_message_id, user_id AS job_user_id;
END;
$$;

-- Vector similarity search with metadata filters
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
