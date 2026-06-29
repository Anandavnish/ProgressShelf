-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Trackers table
CREATE TABLE trackers (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('goal', 'checklist', 'note')),
  preset TEXT,
  levels JSONB,
  target_smallest NUMERIC NOT NULL DEFAULT 1,
  current_smallest NUMERIC NOT NULL DEFAULT 0,
  items JSONB,
  text TEXT,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  deadline_at TIMESTAMPTZ,
  deadline_set_at TIMESTAMPTZ,
  notify_at TIMESTAMPTZ,
  notified BOOLEAN NOT NULL DEFAULT FALSE,
  notify_percent NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FCM tokens table
CREATE TABLE fcm_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  browser_hint TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE trackers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fcm_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their trackers" ON trackers
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their tokens" ON fcm_tokens
  FOR ALL USING (auth.uid() = user_id);

-- Explicitly grant permissions to API roles
GRANT ALL ON TABLE public.trackers TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.fcm_tokens TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE trackers;

-- Run notify edge function every 1 minute
SELECT cron.schedule(
  'notify-deadlines',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://lieckszgurlqcujmyrjw.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
