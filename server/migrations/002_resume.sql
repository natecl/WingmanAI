-- Migration 002: Add resume_text column to users table
-- Run this in the Supabase SQL editor

ALTER TABLE users ADD COLUMN IF NOT EXISTS resume_text TEXT;
