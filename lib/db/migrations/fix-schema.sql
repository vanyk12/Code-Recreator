-- ============================================================
-- Run this in Neon SQL Editor to sync table schema with Drizzle
-- ============================================================

-- 1. Ensure messages table has all required columns
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tokens_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done';

-- 2. Ensure settings table has all required columns
ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

-- 3. Ensure chats table has all required columns
ALTER TABLE chats ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT 'anthropic/claude-3.5-sonnet';
ALTER TABLE chats ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

-- Verify
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name IN ('messages', 'chats', 'settings')
ORDER BY table_name, ordinal_position;