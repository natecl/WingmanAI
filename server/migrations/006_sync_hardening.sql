-- ============================================================
-- 006_sync_hardening.sql
-- Idempotent Gmail sync protection
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Remove duplicate pending/processing indexing jobs,
--    keeping the most-recent one per message.
DELETE FROM indexing_jobs
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY message_id
                   ORDER BY
                       CASE status
                           WHEN 'processing' THEN 0
                           WHEN 'pending'    THEN 1
                           WHEN 'error'      THEN 2
                           ELSE 3
                       END,
                       created_at DESC
               ) AS rn
        FROM indexing_jobs
    ) ranked
    WHERE rn > 1
);

-- 2. Add unique constraint on message_id so each message
--    can only have one indexing job at a time.
ALTER TABLE indexing_jobs
    DROP CONSTRAINT IF EXISTS uq_indexing_jobs_message_id;

ALTER TABLE indexing_jobs
    ADD CONSTRAINT uq_indexing_jobs_message_id UNIQUE (message_id);

-- 3. Add last_synced_at column to users so we can detect
--    stale history_id (Gmail invalidates after ~7 days).
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- 4. Add gmail_message_id to indexing_jobs for easier debugging
--    (currently only message_id FK exists).
ALTER TABLE indexing_jobs
    ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
