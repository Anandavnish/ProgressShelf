import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://lieckszgurlqcujmyrjw.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_9zg42Wb3J6rUuQL5MdmdyA_PjF2gqze'

export const isConfigured = SUPABASE_URL !== '__SUPABASE_URL__' && SUPABASE_URL !== ''
export const supabase = isConfigured ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'sb-progressshelf-auth-token',
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
}) : null
