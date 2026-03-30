-- ============================================================
-- BetterEmailV2 — Add HNSW vector index for fast similarity search
-- Run this in Supabase SQL Editor AFTER 002_reduce_vector_dimensions.sql
--
-- HNSW (Hierarchical Navigable Small World) is better than IVFFlat for:
--  • Dynamic inserts (no need to specify lists count in advance)
--  • Consistent sub-millisecond query latency
--  • Better recall vs IVFFlat at same speed
-- ============================================================

-- Create HNSW index on the 512d embedding column.
-- m=16 and ef_construction=64 are standard defaults with good recall/speed balance.
CREATE INDEX IF NOT EXISTS idx_vectors_embedding
ON gmail_message_vectors
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Also ensure the user_id index exists for the WHERE clause filter.
CREATE INDEX IF NOT EXISTS idx_vectors_user_id
ON gmail_message_vectors(user_id);
