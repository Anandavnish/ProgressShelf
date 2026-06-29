import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = '__SUPABASE_URL__'
const SUPABASE_PUBLISHABLE_KEY = '__SUPABASE_PUBLISHABLE_KEY__'

export const isConfigured = SUPABASE_URL !== '__SUPABASE_URL__' && SUPABASE_URL !== ''
export const supabase = isConfigured ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null
