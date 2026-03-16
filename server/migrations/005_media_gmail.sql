-- 005_media_gmail.sql
-- Adds Gmail source columns to user_media so attachments can be deduplicated
-- across incremental syncs and linked back to their originating message.

ALTER TABLE user_media
    ADD COLUMN IF NOT EXISTS gmail_message_id    TEXT,
    ADD COLUMN IF NOT EXISTS gmail_attachment_id TEXT;

-- Unique index ensures the same Gmail attachment is never stored twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_media_gmail_attachment
    ON user_media (user_id, gmail_attachment_id)
    WHERE gmail_attachment_id IS NOT NULL;
