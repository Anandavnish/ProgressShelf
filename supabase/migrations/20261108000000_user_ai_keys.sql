-- Migration: 20261108000000_user_ai_keys.sql
-- Description: Secure Gemini key storage and rate limiting usage tracking

-- 1. Table: user_ai_keys
-- Stores user encrypted Gemini API keys with last4 for UI indication.
-- Only accessible via service_role (RLS enabled, zero policies for anon/authenticated).
CREATE TABLE IF NOT EXISTS public.user_ai_keys (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  key_encrypted TEXT NOT NULL,
  last4 TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.user_ai_keys ENABLE ROW LEVEL SECURITY;

-- Deny all access to anon and authenticated clients; only service_role can access
REVOKE ALL ON TABLE public.user_ai_keys FROM anon, authenticated;
GRANT ALL ON TABLE public.user_ai_keys TO postgres, service_role;

-- 2. Table: ai_usage
-- Tracks per-user generation requests in 1-hour windows for rate limiting.
-- Only accessible via service_role.
CREATE TABLE IF NOT EXISTS public.ai_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, window_start)
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- Deny all access to anon and authenticated clients; only service_role can access
REVOKE ALL ON TABLE public.ai_usage FROM anon, authenticated;
GRANT ALL ON TABLE public.ai_usage TO postgres, service_role;

-- Index on window_start for efficient window lookups and periodic cleanup
CREATE INDEX IF NOT EXISTS idx_ai_usage_window_start ON public.ai_usage (window_start);
