-- Migration: 20261115000000_user_ai_trials.sql
-- Description: Zero-setup AI trial tracking table with lifetime quota limits

CREATE TABLE IF NOT EXISTS public.user_ai_trials (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  trial_active BOOLEAN NOT NULL DEFAULT true,
  chat_requests_used INTEGER NOT NULL DEFAULT 0,
  briefing_requests_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.user_ai_trials ENABLE ROW LEVEL SECURITY;

-- Deny all access to anon and authenticated clients; only service_role can access
REVOKE ALL ON TABLE public.user_ai_trials FROM anon, authenticated;
GRANT ALL ON TABLE public.user_ai_trials TO postgres, service_role;

-- Index on user_id
CREATE INDEX IF NOT EXISTS idx_user_ai_trials_user ON public.user_ai_trials(user_id);
