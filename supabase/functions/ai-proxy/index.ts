import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Constants & Configuration
// ---------------------------------------------------------------------------
const RATE_LIMIT_GENERATE_PER_HOUR = 30;
const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6 MB max request payload
const TOTAL_REQUEST_DEADLINE_MS = 45000; // ~45s total request deadline
const MAX_TRIAL_CHAT_REQUESTS = 25;
const MAX_TRIAL_BRIEFING_REQUESTS = 50;

// Module-level model cache (reused across requests in the same isolate)
let cachedModel: string | null = null;
let cachedModelResolvedAt = 0;
const MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // ~6 hours

// Preferred Gemini models in priority order (retired 1.5 entries removed)
// Lite models prioritized to prevent 503 high demand errors on free-tier default projects
const PREFERRED_MODELS: string[] = [
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
];

const envModel = Deno.env.get('GEMINI_MODEL');
if (envModel && !PREFERRED_MODELS.includes(envModel)) {
  PREFERRED_MODELS.unshift(envModel);
}

function isModelNotFoundError(status: number, message: string): boolean {
  if (status === 404) return true;
  const lower = (message || '').toLowerCase();
  return (
    lower.includes('not found') ||
    lower.includes('is no longer available') ||
    lower.includes('not supported for generatecontent') ||
    lower.includes('does not exist')
  );
}

async function resolveGeminiModel(apiKey: string, remainingDeadlineMs: number): Promise<string> {
  const now = Date.now();
  if (cachedModel && now - cachedModelResolvedAt < MODEL_CACHE_TTL_MS) {
    return cachedModel;
  }

  const timeoutMs = Math.max(1000, Math.min(20000, remainingDeadlineMs));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const modelsRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': apiKey },
      signal: controller.signal,
    });

    if (modelsRes.ok) {
      const mJson = await modelsRes.json();
      const available: string[] = (mJson.models || [])
        .filter((m: { supportedGenerationMethods?: string[] }) =>
          m.supportedGenerationMethods?.includes('generateContent')
        )
        .map((m: { name: string }) => m.name.replace(/^models\//, ''));

      const match =
        PREFERRED_MODELS.find((p) => available.includes(p)) ||
        available.find((a) => a.includes('flash-lite')) ||
        available.find((a) => a.includes('lite')) ||
        available.find((a) => a.includes('flash')) ||
        available[0];

      if (match) {
        cachedModel = match;
        cachedModelResolvedAt = Date.now();
        console.log(`[ai-proxy] Resolved and cached Gemini model: ${cachedModel}`);
        return cachedModel;
      }
    }
  } catch (err) {
    console.warn('[ai-proxy] Failed to resolve models list:', err);
  } finally {
    clearTimeout(timer);
  }

  // Do NOT cache if call failed or no match found. Use preferred default for this request only.
  return PREFERRED_MODELS[0] || 'gemini-flash-lite-latest';
}

// Allowed CORS origins: strictly localhost:8000 and the production URL
const ALLOWED_ORIGINS = new Set([
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'https://anandavnish.github.io',
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
]);

const envProdUrl = Deno.env.get('PRODUCTION_URL');
if (envProdUrl) {
  try {
    ALLOWED_ORIGINS.add(new URL(envProdUrl).origin);
  } catch {
    ALLOWED_ORIGINS.add(envProdUrl.trim());
  }
}

// ---------------------------------------------------------------------------
// Cryptographic Helpers (AES-256-GCM via Web Crypto API)
// ---------------------------------------------------------------------------
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getEncryptionKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyBytes = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptApiKey(plainKey: string, secret: string): Promise<string> {
  const cryptoKey = await getEncryptionKey(secret);
  // Random 12-byte (96-bit) IV generated per save operation
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plainBytes = new TextEncoder().encode(plainKey);

  const encryptedBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    plainBytes
  );

  // Combine IV (12 bytes) + Ciphertext with GCM auth tag
  const combined = new Uint8Array(iv.length + encryptedBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encryptedBuf), iv.length);

  return toBase64(combined);
}

async function decryptApiKey(encryptedBase64: string, secret: string): Promise<string> {
  const cryptoKey = await getEncryptionKey(secret);
  const combined = fromBase64(encryptedBase64);
  if (combined.byteLength < 13) {
    throw new Error('Corrupted encrypted key data');
  }

  const iv = combined.subarray(0, 12);
  const ciphertextWithTag = combined.subarray(12);

  const decryptedBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decryptedBuf);
}

// ---------------------------------------------------------------------------
// Rate Limiting Helper (ai_usage table: 1-hour window)
// ---------------------------------------------------------------------------
function getHourlyWindowStart(date: Date = new Date()): string {
  const ms = date.getTime();
  const hourMs = 60 * 60 * 1000;
  return new Date(Math.floor(ms / hourMs) * hourMs).toISOString();
}

// ---------------------------------------------------------------------------
// Date Parsing & ISO Normalization Helper
// Converts natural dates ("till 17 nov", "17th nov", "November 17") into strict ISO
// ---------------------------------------------------------------------------
function parseDatePatternToIso(
  text: string,
  referenceDateStr: string = '',
  tzOffset: string = ''
): string | null {
  if (!text || typeof text !== 'string') return null;
  let clean = text.trim();
  if (!clean) return null;

  // Clean conversational phrasing and preambles
  clean = clean
    .replace(/^(?:till|by|due|before|on|deadline(?:\s+is|\s+set\s+for)?)\s+/i, '')
    .replace(/,\s*at\s+/i, ' ')
    .replace(/\s+at\s+/i, ' ')
    .trim();

  // If already standard ISO with date & time
  const fullIsoMatch = clean.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i
  );
  if (fullIsoMatch) {
    return clean;
  }

  const monthMap: Record<string, number> = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  const refDate = referenceDateStr ? new Date(referenceDateStr) : new Date();
  const refYear = !isNaN(refDate.getTime()) ? refDate.getFullYear() : new Date().getFullYear();

  // "tomorrow"
  if (/\b(?:by\s+)?tomorrow\b/i.test(clean)) {
    const d = new Date(refDate.getTime() + 86400000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T23:59:59${tzOffset || 'Z'}`;
  }

  // "today"
  if (/\b(?:by\s+)?today\b/i.test(clean)) {
    const yyyy = refDate.getFullYear();
    const mm = String(refDate.getMonth() + 1).padStart(2, '0');
    const dd = String(refDate.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T23:59:59${tzOffset || 'Z'}`;
  }

  // Format YYYY-MM-DD
  const ymdMatch = clean.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}T23:59:59${tzOffset || 'Z'}`;
  }

  // Format DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = clean.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (dmyMatch) {
    const dd = String(parseInt(dmyMatch[1], 10)).padStart(2, '0');
    const mm = String(parseInt(dmyMatch[2], 10)).padStart(2, '0');
    const yyyy = dmyMatch[3];
    return `${yyyy}-${mm}-${dd}T23:59:59${tzOffset || 'Z'}`;
  }

  // Pattern: "17 nov", "17th november", "17 November 2026"
  const dayMonthMatch = clean.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*,?\s*(\d{4}))?\b/i
  );
  if (dayMonthMatch) {
    const day = parseInt(dayMonthMatch[1], 10);
    const monthName = dayMonthMatch[2].toLowerCase();
    const month = monthMap[monthName];
    const year = dayMonthMatch[3] ? parseInt(dayMonthMatch[3], 10) : refYear;
    if (month && day >= 1 && day <= 31) {
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      return `${year}-${mm}-${dd}T23:59:59${tzOffset || 'Z'}`;
    }
  }

  // Pattern: "nov 17", "november 17th", "November 17, 2026"
  const monthDayMatch = clean.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/i
  );
  if (monthDayMatch) {
    const monthName = monthDayMatch[1].toLowerCase();
    const day = parseInt(monthDayMatch[2], 10);
    const month = monthMap[monthName];
    const year = monthDayMatch[3] ? parseInt(monthDayMatch[3], 10) : refYear;
    if (month && day >= 1 && day <= 31) {
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      return `${year}-${mm}-${dd}T23:59:59${tzOffset || 'Z'}`;
    }
  }

  // Fallback: standard Date.parse if it contains a recognizable date
  const parsedMs = Date.parse(clean);
  if (!isNaN(parsedMs) && parsedMs > 0) {
    return new Date(parsedMs).toISOString();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Academic Title & Deliverables Formatting Helpers
// Ensures consistent, high-quality, professional titling and decomposition
// ---------------------------------------------------------------------------
function formatAcademicSubject(subject: string): string {
  if (!subject || typeof subject !== 'string') return '';
  const acronyms: Record<string, string> = {
    mos: 'MOS',
    bee: 'BEE',
    dsa: 'DSA',
    cad: 'CAD',
    cam: 'CAM',
    ai: 'AI',
    ml: 'ML',
    os: 'OS',
    cn: 'CN',
    dbms: 'DBMS',
    toc: 'TOC',
    se: 'SE',
    maths: 'Maths',
    math: 'Math',
  };
  return subject
    .trim()
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (acronyms[lower]) {
        return word.replace(new RegExp(lower, 'i'), acronyms[lower]);
      }
      if (word.length <= 1) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function formatAcademicTitle(rawTitle: string, userPrompt: string = ''): string {
  if (!rawTitle || typeof rawTitle !== 'string') return 'Task Checklist';
  const cleanTitle = rawTitle.trim();
  if (!cleanTitle) return 'Task Checklist';

  // If already formatted in standard completion pattern
  if (/^.+Completion:\s+.+$/i.test(cleanTitle)) {
    return cleanTitle;
  }

  const combinedText = `${cleanTitle} ${userPrompt}`;

  // Detect task type
  let taskType = '';
  if (/\blab\s*files?\b/i.test(combinedText)) {
    taskType = 'Lab File';
  } else if (/\bassignments?\b/i.test(combinedText)) {
    taskType = 'Assignment';
  } else if (/\breports?\b/i.test(combinedText)) {
    taskType = 'Report';
  } else if (/\bprojects?\b/i.test(combinedText)) {
    taskType = 'Project';
  } else if (/\bhomework\b/i.test(combinedText)) {
    taskType = 'Homework';
  } else if (/\bpractical(?:s)?\b/i.test(combinedText)) {
    taskType = 'Practical';
  }

  // Extract subjects
  let subjects: string[] = [];

  const ofMatch = userPrompt.match(
    /\b(?:of|for)\s+([^,]+?)\s+(?:and|&)\s+([^,]+?)(?:\s+(?:create|till|by|deadline|card|in|$|\.))/i
  );
  if (ofMatch) {
    const s1 = ofMatch[1].replace(/\b(?:lab\s*files?|files?)\b/gi, '').trim();
    const s2 = ofMatch[2].replace(/\b(?:lab\s*files?|files?)\b/gi, '').trim();
    if (s1 && s2) {
      subjects = [s1, s2];
    }
  }

  if (subjects.length === 0) {
    const andMatch = userPrompt.match(
      /\b([^,]+?)\s+(?:and|&)\s+([^,]+?)\s+(?:lab\s*files?|assignments?|reports?|tasks?|projects?)\b/i
    );
    if (andMatch) {
      const s1 = andMatch[1].replace(/\b(?:of|for|till|by)\b/gi, '').trim();
      const s2 = andMatch[2].trim();
      if (s1 && s2) {
        subjects = [s1, s2];
      }
    }
  }

  if (subjects.length === 0) {
    const titleClean = cleanTitle
      .replace(/^.+Completion:\s*/i, '')
      .replace(/\s*(?:lab\s*files?|files?|assignments?|reports?|projects?|homework|practicals?|checklist|card)\b/gi, '')
      .trim();

    if (/\b(?:and|&)\b/i.test(titleClean)) {
      const parts = titleClean.split(/\s+(?:and|&)\s+/i).map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        subjects = parts;
      }
    } else if (titleClean) {
      subjects = [titleClean];
    }
  }

  if (taskType && subjects.length > 0) {
    const formatted = subjects.map((s) => formatAcademicSubject(s));
    if (formatted.length > 1) {
      return `${taskType} Completion: ${formatted.join(' & ')}`;
    } else {
      return `${taskType} Completion: ${formatted[0]}`;
    }
  }

  if (/\b(?:checklist|todo|tasks?)\b/i.test(combinedText) && subjects.length > 0) {
    const formatted = subjects.map((s) => formatAcademicSubject(s));
    return `Task Checklist: ${formatted.join(' & ')}`;
  }

  return cleanTitle
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function extractDeliverableItems(
  existingItems: Array<{ text: string; done: boolean }> | undefined,
  title: string,
  userPrompt: string
): Array<{ text: string; done: boolean }> {
  const isDummyStep = (text: string) =>
    !text ||
    /^(?:step|task|item|milestone)\s*\d*$/i.test(text.trim()) ||
    text.trim().toLowerCase() === 'step' ||
    text.trim().toLowerCase() === 'task';

  const validExisting = (existingItems || []).filter(
    (it) => it && typeof it.text === 'string' && it.text.trim() && !isDummyStep(it.text)
  );

  // If existingItems already has multiple distinct valid items (e.g. 16 chapters or user-specified list), keep them!
  if (validExisting.length > 1) {
    return validExisting.map((it) => ({
      text: it.text.trim().slice(0, 120),
      done: Boolean(it.done),
    }));
  }

  // Detect deliverable item type suffix
  const combinedText = `${title || ''} ${userPrompt || ''}`.trim();
  let itemSuffix = 'Task';
  if (/\blab\s*files?\b/i.test(combinedText)) {
    itemSuffix = 'Lab File';
  } else if (/\bassignments?\b/i.test(combinedText)) {
    itemSuffix = 'Assignment';
  } else if (/\breports?\b/i.test(combinedText)) {
    itemSuffix = 'Report';
  } else if (/\bprojects?\b/i.test(combinedText)) {
    itemSuffix = 'Project';
  } else if (/\bhomework\b/i.test(combinedText)) {
    itemSuffix = 'Homework';
  } else if (/\bpractical(?:s)?\b/i.test(combinedText)) {
    itemSuffix = 'Practical';
  }

  // Extract subjects from userPrompt or title
  let subjects: string[] = [];

  const ofMatch = userPrompt.match(
    /\b(?:of|for)\s+([^,]+?)\s+(?:and|&)\s+([^,]+?)(?:\s+(?:create|till|by|deadline|card|in|$|\.))/i
  );
  if (ofMatch) {
    const s1 = ofMatch[1].replace(/\b(?:lab\s*files?|files?)\b/gi, '').trim();
    const s2 = ofMatch[2].replace(/\b(?:lab\s*files?|files?)\b/gi, '').trim();
    if (s1 && s2) {
      subjects = [s1, s2];
    }
  }

  if (subjects.length === 0) {
    const andMatch = userPrompt.match(
      /\b([^,]+?)\s+(?:and|&)\s+([^,]+?)\s+(?:lab\s*files?|assignments?|reports?|tasks?|projects?)\b/i
    );
    if (andMatch) {
      const s1 = andMatch[1].replace(/\b(?:of|for|till|by)\b/gi, '').trim();
      const s2 = andMatch[2].trim();
      if (s1 && s2) {
        subjects = [s1, s2];
      }
    }
  }

  if (subjects.length === 0) {
    const titleClean = (title || '')
      .replace(/^.+Completion:\s*/i, '')
      .replace(/\s+(?:lab\s*files?|files?|assignments?|reports?|checklist|card)\b/gi, '')
      .trim();

    if (/\b(?:and|&)\b/i.test(titleClean)) {
      const parts = titleClean.split(/\s+(?:and|&)\s+/i).map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        subjects = parts;
      }
    } else if (titleClean) {
      subjects = [titleClean];
    }
  }

  if (subjects.length > 1) {
    return subjects.map((s) => ({
      text: `${formatAcademicSubject(s)} ${itemSuffix}`,
      done: false,
    }));
  }

  // If we already have 1 valid non-dummy item, keep it
  if (validExisting.length === 1) {
    return validExisting.map((it) => ({
      text: it.text.trim().slice(0, 120),
      done: Boolean(it.done),
    }));
  }

  // Single subject deliverable
  if (subjects.length === 1 && subjects[0]) {
    const s = formatAcademicSubject(subjects[0]);
    return [{ text: `${s} ${itemSuffix} Submission`, done: false }];
  }

  // Default fallback milestone
  return [{ text: `Complete ${title || 'Task'}`, done: false }];
}

// ---------------------------------------------------------------------------
// Main Edge Function Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');
  const isAllowedOrigin = !origin || ALLOWED_ORIGINS.has(origin);

  // Prepare CORS headers
  const allowOriginHeader = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : (!origin ? 'https://anandavnish.github.io' : '');

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOriginHeader,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };

  const jsonResponse = (data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  };

  // CORS preflight verification
  if (req.method === 'OPTIONS') {
    if (!isAllowedOrigin) {
      return new Response(null, { status: 403 });
    }
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Reject origins outside allowed list
  if (!isAllowedOrigin) {
    return jsonResponse({ error: 'Origin not allowed by CORS policy' }, 403);
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // Guard: Max payload body 6 MB
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'Payload too large: maximum 6 MB allowed.' }, 413);
  }

  let rawBuffer: ArrayBuffer;
  try {
    rawBuffer = await req.arrayBuffer();
  } catch {
    return jsonResponse({ error: 'Failed to read request body' }, 400);
  }

  if (rawBuffer.byteLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'Payload too large: maximum 6 MB allowed.' }, 413);
  }

  // Verify caller Supabase JWT & reject unauthenticated/guest users
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized: missing authorization header' }, 401);
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return jsonResponse({ error: 'Unauthorized: missing bearer token' }, 401);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const AI_KEY_SECRET = Deno.env.get('AI_KEY_SECRET');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[ai-proxy] Server error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  if (!AI_KEY_SECRET) {
    console.error('[ai-proxy] Server error: AI_KEY_SECRET missing');
    return jsonResponse({ error: 'Server encryption configuration error' }, 500);
  }

  // Verify JWT against Supabase Auth service
  const supabaseAuthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authError } = await supabaseAuthClient.auth.getUser(token);
  const user = authData?.user;

  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized: invalid or expired session' }, 401);
  }

  // Reject guest / anonymous users
  if (user.is_anonymous || user.app_metadata?.provider === 'anonymous') {
    return jsonResponse({ error: 'Forbidden: guest accounts are not permitted' }, 403);
  }

  // Admin client for service-role access to user_ai_keys and ai_usage
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: { action?: string; key?: string; task?: string; payload?: unknown };
  try {
    const textBody = new TextDecoder().decode(rawBuffer);
    body = JSON.parse(textBody);
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { action } = body;
  if (!action || typeof action !== 'string') {
    return jsonResponse({ error: 'Missing "action" parameter' }, 400);
  }

  // -------------------------------------------------------------------------
  // ACTION: status -> { connected, last4, isTrial, trial }
  // -------------------------------------------------------------------------
  if (action === 'status') {
    const { data, error } = await supabaseAdmin
      .from('user_ai_keys')
      .select('last4')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[ai-proxy] Failed to retrieve status for user:', user.id);
      return jsonResponse({ error: 'Failed to retrieve key status' }, 500);
    }

    if (data && data.last4) {
      return jsonResponse({
        connected: true,
        last4: data.last4,
        isTrial: false,
        trial: null,
      });
    }

    // Check user_ai_trials for active trial
    const { data: trialData, error: trialError } = await supabaseAdmin
      .from('user_ai_trials')
      .select('trial_active, chat_requests_used, briefing_requests_used')
      .eq('user_id', user.id)
      .maybeSingle();

    if (trialError) {
      console.warn('[ai-proxy] Error checking trial status:', trialError);
    }

    if (trialData && trialData.trial_active) {
      const chatUsed = trialData.chat_requests_used || 0;
      const briefingUsed = trialData.briefing_requests_used || 0;
      const chatRemaining = Math.max(0, MAX_TRIAL_CHAT_REQUESTS - chatUsed);
      const briefingRemaining = Math.max(0, MAX_TRIAL_BRIEFING_REQUESTS - briefingUsed);

      return jsonResponse({
        connected: true,
        last4: null,
        isTrial: true,
        trial: {
          active: true,
          chatRemaining,
          chatTotal: MAX_TRIAL_CHAT_REQUESTS,
          briefingRemaining,
          briefingTotal: MAX_TRIAL_BRIEFING_REQUESTS,
          chatUsed,
          briefingUsed,
        },
      });
    }

    return jsonResponse({ connected: false, last4: null, isTrial: false, trial: null });
  }

  // -------------------------------------------------------------------------
  // ACTION: activate_trial -> initialize user_ai_trials
  // -------------------------------------------------------------------------
  if (action === 'activate_trial') {
    // Check if user already has an active personal key
    const { data: keyRecord } = await supabaseAdmin
      .from('user_ai_keys')
      .select('last4')
      .eq('user_id', user.id)
      .maybeSingle();

    if (keyRecord) {
      return jsonResponse({
        connected: true,
        last4: keyRecord.last4,
        isTrial: false,
        trial: null,
        message: 'Personal key already active',
      });
    }

    // Check existing trial
    const { data: existingTrial } = await supabaseAdmin
      .from('user_ai_trials')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    let chatUsed = 0;
    let briefingUsed = 0;

    if (existingTrial) {
      chatUsed = existingTrial.chat_requests_used || 0;
      briefingUsed = existingTrial.briefing_requests_used || 0;
      const { error: updateErr } = await supabaseAdmin
        .from('user_ai_trials')
        .update({ trial_active: true, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
      if (updateErr) {
        console.error('[ai-proxy] Error updating trial status:', updateErr);
        return jsonResponse({ error: 'Failed to activate trial' }, 500);
      }
    } else {
      const { error: insertErr } = await supabaseAdmin
        .from('user_ai_trials')
        .insert({
          user_id: user.id,
          trial_active: true,
          chat_requests_used: 0,
          briefing_requests_used: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      if (insertErr) {
        console.error('[ai-proxy] Error inserting trial record:', insertErr);
        return jsonResponse({ error: 'Failed to activate trial' }, 500);
      }
    }

    const chatRemaining = Math.max(0, MAX_TRIAL_CHAT_REQUESTS - chatUsed);
    const briefingRemaining = Math.max(0, MAX_TRIAL_BRIEFING_REQUESTS - briefingUsed);

    return jsonResponse({
      connected: true,
      last4: null,
      isTrial: true,
      trial: {
        active: true,
        chatRemaining,
        chatTotal: MAX_TRIAL_CHAT_REQUESTS,
        briefingRemaining,
        briefingTotal: MAX_TRIAL_BRIEFING_REQUESTS,
        chatUsed,
        briefingUsed,
      },
    });
  }

  // -------------------------------------------------------------------------
  // ACTION: save_key { key }
  // -------------------------------------------------------------------------
  if (action === 'save_key') {
    const rawKey = body.key;
    if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
      return jsonResponse({ error: 'A valid non-empty Gemini key is required' }, 400);
    }

    const trimmedKey = rawKey.trim();

    // Validate key with Google Gemini API models endpoint (0 token cost, canonical key validation)
    // Note: API key is sent strictly via x-goog-api-key header, never in the URL.
    const validationUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
    const validationCtrl = new AbortController();
    const validationTimer = setTimeout(() => validationCtrl.abort(), 20000);
    try {
      const validationRes = await fetch(validationUrl, {
        method: 'GET',
        headers: {
          'x-goog-api-key': trimmedKey,
        },
        signal: validationCtrl.signal,
      });

      if (!validationRes.ok) {
        console.warn(`[ai-proxy] Key validation failed with status ${validationRes.status}`);
        let errMsg = 'Invalid Gemini API key. Please check your key in Google AI Studio.';
        try {
          const errJson = await validationRes.json();
          if (errJson?.error?.message) {
            errMsg = errJson.error.message;
          }
        } catch (_) {}
        if (validationRes.status === 429) {
          return jsonResponse({ error: errMsg, code: 'GOOGLE_QUOTA' }, 429);
        }
        return jsonResponse({ error: errMsg }, 400);
      }
    } catch {
      console.error('[ai-proxy] Network failure connecting to Gemini validation endpoint');
      return jsonResponse({ error: 'Failed to reach Gemini API. Please check network connectivity.' }, 502);
    } finally {
      clearTimeout(validationTimer);
    }

    // Encrypt with AES-256-GCM (random 12-byte IV generated per save)
    let encryptedStr: string;
    try {
      encryptedStr = await encryptApiKey(trimmedKey, AI_KEY_SECRET);
    } catch {
      console.error('[ai-proxy] Encryption failure for user:', user.id);
      return jsonResponse({ error: 'Failed to encrypt API key' }, 500);
    }

    const last4 = trimmedKey.slice(-4);

    const { error: saveError } = await supabaseAdmin
      .from('user_ai_keys')
      .upsert(
        {
          user_id: user.id,
          key_encrypted: encryptedStr,
          last4: last4,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (saveError) {
      console.error('[ai-proxy] DB error saving key for user:', user.id);
      return jsonResponse({ error: 'Failed to save encrypted key' }, 500);
    }

    // Return status indicator. Plain key is never logged or returned!
    return jsonResponse({ connected: true, last4 });
  }

  // -------------------------------------------------------------------------
  // ACTION: remove_key -> delete the row
  // -------------------------------------------------------------------------
  if (action === 'remove_key') {
    const { error: deleteError } = await supabaseAdmin
      .from('user_ai_keys')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('[ai-proxy] DB error deleting key for user:', user.id);
      return jsonResponse({ error: 'Failed to remove API key' }, 500);
    }

    return jsonResponse({ connected: false, last4: null });
  }

  // -------------------------------------------------------------------------
  // ACTION: generate { task, payload }
  // -------------------------------------------------------------------------
  if (action === 'generate') {
    const { task, payload } = body;
    if (!task || typeof task !== 'string') {
      return jsonResponse({ error: 'Missing "task" parameter' }, 400);
    }

    const SUPPORTED_TASKS = ['ping', 'create_tracker', 'break_down_goal', 'extract_notes', 'chat', 'daily_briefing'];
    if (!SUPPORTED_TASKS.includes(task)) {
      return jsonResponse(
        { error: `Task "${task}" is not supported. Supported tasks: ${SUPPORTED_TASKS.join(', ')}` },
        400
      );
    }

    const requestStartTime = Date.now();
    let tDecrypt = 0;
    let tLimitCheck = 0;
    let tModelResolve = 0;
    let tGeminiCall = 0;

    // Per-user rate limiting (30 generate calls/hour)
    const tLimitStart = Date.now();
    const windowStart = getHourlyWindowStart();
    const { data: usageData, error: usageSelectError } = await supabaseAdmin
      .from('ai_usage')
      .select('count')
      .eq('user_id', user.id)
      .eq('window_start', windowStart)
      .maybeSingle();

    if (usageSelectError) {
      console.error('[ai-proxy] Error checking usage for user:', user.id);
    }

    const currentCount = usageData?.count ?? 0;
    tLimitCheck = Date.now() - tLimitStart;

    if (currentCount >= RATE_LIMIT_GENERATE_PER_HOUR) {
      return jsonResponse(
        {
          error: `Rate limit exceeded: maximum ${RATE_LIMIT_GENERATE_PER_HOUR} generate calls per hour. Please try again later.`,
          code: 'RATE_LIMIT_HOURLY',
        },
        429
      );
    }

    // Key resolution: Personal key vs. Free Trial key
    let apiKey: string = '';
    let isTrialRequest = false;
    let trialRecord: { chat_requests_used: number; briefing_requests_used: number } | null = null;

    const { data: keyRecord, error: keyQueryError } = await supabaseAdmin
      .from('user_ai_keys')
      .select('key_encrypted')
      .eq('user_id', user.id)
      .maybeSingle();

    if (keyRecord?.key_encrypted) {
      // User has configured personal Gemini key
      const tDecryptStart = Date.now();
      try {
        apiKey = await decryptApiKey(keyRecord.key_encrypted, AI_KEY_SECRET);
      } catch {
        console.error('[ai-proxy] Decryption error for user:', user.id);
        return jsonResponse({ error: 'Failed to decrypt API key. Please re-save your key.' }, 500);
      }
      tDecrypt = Date.now() - tDecryptStart;
    } else {
      // Check trial status
      const { data: trialData, error: trialQueryError } = await supabaseAdmin
        .from('user_ai_trials')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (trialQueryError) {
        console.error('[ai-proxy] Error checking trial record:', trialQueryError);
      }

      if (!trialData || !trialData.trial_active) {
        return jsonResponse({
          error: 'No Gemini API key configured. Please activate your free trial or connect an API key.',
          code: 'NO_KEY_OR_TRIAL',
        }, 400);
      }

      const chatUsed = trialData.chat_requests_used || 0;
      const briefingUsed = trialData.briefing_requests_used || 0;

      if (task === 'daily_briefing') {
        if (briefingUsed >= MAX_TRIAL_BRIEFING_REQUESTS) {
          return jsonResponse({
            error: `Trial limit reached: You have used all ${MAX_TRIAL_BRIEFING_REQUESTS} free Today's Focus updates. Connect your free personal Gemini key from Google AI Studio to continue.`,
            code: 'TRIAL_EXHAUSTED_BRIEFING',
          }, 403);
        }
      } else {
        if (chatUsed >= MAX_TRIAL_CHAT_REQUESTS) {
          return jsonResponse({
            error: `Trial limit reached: You have used all ${MAX_TRIAL_CHAT_REQUESTS} free AI Chat requests. Connect your free personal Gemini key from Google AI Studio to continue.`,
            code: 'TRIAL_EXHAUSTED_CHAT',
          }, 403);
        }
      }

      const trialSecretKey = Deno.env.get('TRIAL_GEMINI_API_KEY') || '';
      if (!trialSecretKey) {
        console.error('[ai-proxy] Server error: TRIAL_GEMINI_API_KEY environment variable is not configured.');
        return jsonResponse({
          error: 'Free trial key is currently being updated on the server. Please try again shortly or connect your personal Gemini key.',
          code: 'TRIAL_KEY_NOT_CONFIGURED',
        }, 503);
      }

      apiKey = trialSecretKey;
      isTrialRequest = true;
      trialRecord = {
        chat_requests_used: chatUsed,
        briefing_requests_used: briefingUsed,
      };
    }

    // Build task-specific prompts and structured JSON schema
    let parts: Array<Record<string, unknown>> = [];
    let cardsContext: any[] = [];
    let responseSchema: Record<string, unknown> = {};
    let userMessage = String((payload as any)?.message || (payload as any)?.text || (payload as any)?.input || '').trim();

    const userLocalDate = typeof (payload as any)?.localDate === 'string' ? (payload as any).localDate : '';
    const userLocalTime = typeof (payload as any)?.localTime === 'string' ? (payload as any).localTime : '';
    const userTimezone = typeof (payload as any)?.timezone === 'string' ? (payload as any).timezone : '';
    const userTzOffset = typeof (payload as any)?.tzOffset === 'string' ? (payload as any).tzOffset : '';
    const userWeekday = typeof (payload as any)?.weekday === 'string' ? (payload as any).weekday : '';
    const currentDateStr =
      typeof payload?.currentDate === 'string' && payload.currentDate
        ? payload.currentDate
        : new Date().toISOString();
    const timeRefContext = `Current user local time: ${userLocalDate || currentDateStr} ${userLocalTime || ''} (${userWeekday || 'today'}, Timezone: ${userTimezone || 'local'}, UTC Offset: ${userTzOffset || '+00:00'}). Reference ISO: ${currentDateStr}.`;

    let userFirstName = '';
    const rawPayloadFirstName = (payload as any)?.firstName || (payload as any)?.userFirstName;
    if (typeof rawPayloadFirstName === 'string' && rawPayloadFirstName.trim()) {
      let candidate = rawPayloadFirstName.trim().split(/\s+/)[0];
      if (candidate.includes('@')) {
        candidate = candidate.split('@')[0].replace(/[0-9_.-]+$/g, '');
      }
      if (candidate && candidate.toLowerCase() !== 'guest' && candidate.toLowerCase() !== 'tracker') {
        userFirstName = candidate.charAt(0).toUpperCase() + candidate.slice(1);
      }
    }
    if (!userFirstName) {
      const metaName =
        user?.user_metadata?.first_name ||
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        user?.user_metadata?.display_name ||
        (payload as any)?.userName ||
        '';
      if (typeof metaName === 'string' && metaName.trim()) {
        let first = metaName.trim().split(/\s+/)[0];
        if (first.includes('@')) {
          first = first.split('@')[0].replace(/[0-9_.-]+$/g, '');
        }
        if (first && first.toLowerCase() !== 'guest' && first.toLowerCase() !== 'tracker') {
          userFirstName = first.charAt(0).toUpperCase() + first.slice(1);
        }
      }
    }

    if (task === 'ping') {
      parts = [{ text: 'Respond with a valid JSON object matching the requested schema for task ping.' }];
      responseSchema = {
        type: 'OBJECT',
        properties: {
          status: { type: 'STRING' },
          task: { type: 'STRING' },
          timestamp: { type: 'STRING' },
          message: { type: 'STRING' },
        },
        required: ['status', 'task', 'timestamp'],
      };
    } else if (task === 'create_tracker') {
      const userInput = String(payload?.input || payload?.text || payload?.prompt || '').trim();
      const hasImage = Boolean(payload?.image?.data && payload?.image?.mimeType);

      if (!userInput && !hasImage) {
        return jsonResponse({ error: 'Please provide text or an image to create a tracker.' }, 400);
      }

      const promptText = `You are an intelligent task planner for ProgressShelf, a personal productivity and progress tracking app.
The user wants to create a new tracker card from text, pasted content, or an attached image.
${timeRefContext}

User Input:
"""
${userInput || '(Image provided without text description)'}
"""

Analyze the user's input and determine the best tracker format:
1. "goal": For measurable numeric progress towards a target number (e.g. pages, chapters, percent, hours, cups, lessons, workouts).
   - "target": Target number (default 100 if percent or unspecified).
   - "unit": Short unit name (e.g. "%", "pages", "chapters", "hours", "lessons").
2. "checklist": For discrete steps, subtasks, habits, packing lists, or routines.
   - "items": Array of actionable items with text field.
3. "note": For informational memos, references, or reflections without discrete checkboxes.
   - "noteText": Formatted note text.

Deadline and Time handling:
- A day starts at midnight 12:00:00 AM (00:00:00) and ends at midnight 11:59:59 PM (23:59:59).
- If the user mentions a target completion date or day without an explicit hour/minute (e.g. "by Friday", "by tomorrow", "this saturday", "in 2 weeks", "by end of next month", "by Nov 20"):
  The deadline MUST be the LAST MOMENT of that date: 11:59:59 PM (23:59:59) in the user's local timezone offset (e.g. "YYYY-MM-DDT23:59:59${userTzOffset || ''}"). NEVER set it to 00:00:00, 09:00:00, 12:00:00, or 17:00:00 unless the user explicitly requested that time.
- If the user mentions only a time without a date (e.g. "by 5pm", "by 18:00", "at 9pm"):
  It refers to TODAY (${userLocalDate || 'current date'}) at that time, formatted as "${userLocalDate || 'YYYY-MM-DD'}THH:MM:00${userTzOffset || ''}".
- If the user specifies both a date and an exact time (e.g. "tomorrow at 5pm", "this saturday by 3:30 PM"):
  Set "deadline" to that exact date and time with the user's timezone offset, e.g. "YYYY-MM-DDTHH:MM:00${userTzOffset || ''}".
- If no deadline is specified, set "deadline" to "".

Recurring / Habit handling:
- If the user describes a recurring daily habit or checklist (e.g. "daily workout", "every morning at 8am", "repeat every day"), set "isRecurring": true, "resetTime": "08:00". Otherwise set "isRecurring": false, "resetTime": "".

Provide a concise title, type ("goal", "checklist", or "note"), relevant fields, and a 1-sentence friendly explanation.`;

      parts = [{ text: promptText }];
      if (hasImage) {
        parts.push({
          inlineData: {
            mimeType: String(payload.image.mimeType),
            data: String(payload.image.data),
          },
        });
      }

      responseSchema = {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          type: { type: 'STRING' },
          preset: { type: 'STRING' },
          unit: { type: 'STRING' },
          target: { type: 'NUMBER' },
          currentProgress: { type: 'NUMBER' },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                text: { type: 'STRING' },
              },
              required: ['text'],
            },
          },
          noteText: { type: 'STRING' },
          deadline: { type: 'STRING' },
          isRecurring: { type: 'BOOLEAN' },
          resetTime: { type: 'STRING' },
          explanation: { type: 'STRING' },
        },
        required: ['title', 'type', 'explanation'],
      };
    } else if (task === 'break_down_goal') {
      const goalText = String(payload?.goal || payload?.text || payload?.input || '').trim();
      if (!goalText) {
        return jsonResponse({ error: 'A goal description is required to break down.' }, 400);
      }

      const promptText = `You are an expert productivity coach for ProgressShelf.
Break down the following goal into 4 to 7 clear, sequential, highly actionable checklist milestones.
Each milestone step must be concise, concrete, and begin with an action verb.
Current reference date: ${currentDateStr}.

Goal to break down:
"""
${goalText}
"""

Suggest a realistic completion timeframe in days in "suggestedDeadlineDays" (e.g. 7, 14, 21, 30).
Provide an inspiring, actionable 1-sentence summary in "explanation".`;

      parts = [{ text: promptText }];
      responseSchema = {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          type: { type: 'STRING' },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                text: { type: 'STRING' },
              },
              required: ['text'],
            },
          },
          suggestedDeadlineDays: { type: 'INTEGER' },
          explanation: { type: 'STRING' },
        },
        required: ['title', 'type', 'items', 'explanation'],
      };
    } else if (task === 'extract_notes') {
      const noteContent = String(payload?.noteText || payload?.text || payload?.notes || payload?.input || '').trim();
      if (!noteContent) {
        return jsonResponse({ error: 'Note text is required to extract action items.' }, 400);
      }

      const promptText = `You are an executive assistant for ProgressShelf.
Extract all concrete todo items and action steps from the provided notes into a clean checklist.
Filter out general narrative, conversational filler, and non-actionable remarks.
Each checklist item must start with an action verb and describe a clear, verifiable outcome.
Current reference date: ${currentDateStr}.

Notes to extract tasks from:
"""
${noteContent}
"""

Provide an appropriate title for the task checklist in "title", the checklist items in "items", and a 1-sentence summary in "summary".`;

      parts = [{ text: promptText }];
      responseSchema = {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          type: { type: 'STRING' },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                text: { type: 'STRING' },
              },
              required: ['text'],
            },
          },
          summary: { type: 'STRING' },
        },
        required: ['title', 'type', 'items', 'summary'],
      };
    } else if (task === 'chat') {
      userMessage = String(payload?.message || payload?.text || payload?.input || '').trim();
      if (!userMessage && !payload?.image?.data) {
        return jsonResponse({ error: 'Message text or image is required.' }, 400);
      }

      cardsContext = Array.isArray(payload?.cards) ? payload.cards : [];
      const historyContext = Array.isArray(payload?.history) ? payload.history : [];

      const promptText = `You are an intelligent, friendly, and proactive personal AI companion for ProgressShelf, a personal progress and habit tracking app.
The user is having a conversation with you.${userFirstName ? ` The user's first name is "${userFirstName}".` : ''}
${timeRefContext}

The user's current cards and trackers:
${JSON.stringify(cardsContext, null, 2)}

Recent conversation history:
${historyContext.map((h: { role?: string; text?: string }) => `${h.role || 'user'}: ${h.text || ''}`).join('\n')}

User message:
"""
${userMessage}
"""

Guidelines:
1. Always converse naturally, warmly, and helpfully with the user in "message" using Markdown formatting (bolding, lists, bullet points).${userFirstName ? `\n   - The user's first name is "${userFirstName}". You KNOW their name. If the user asks "do you know my name?", who they are, or what their name is, ALWAYS confirm warmly that their name is "${userFirstName}". NEVER say you don't have their name stored or don't know who they are.\n   - When greeting or addressing the user (such as responding to "hi", "hello", "good morning", welcoming them back, or beginning a response), ALWAYS greet them warmly by their first name "${userFirstName}" (e.g. "Hi ${userFirstName}!", "Hello ${userFirstName}!", "Good morning ${userFirstName}!"). NEVER use generic "there" (NEVER say "Hi there", "Hello there", "Hey there", or "Good morning there").` : ''}
   - When proposing actions ("hasAction": true), keep "message" concise and friendly (1-2 sentences) confirming what was planned using the polished card title (e.g. "I've created your checklist for **Lab File Completion: Fluid & Surveying** with the deadline set for November 17, Anand!"). Do NOT duplicate or re-list all checklist items in "message", because the confirmation sheet already presents every item to the user.
2. You have FULL ACCESS to inspect, discuss, recommend, create, update, or delete the user's cards.
3. If the user asks about their trackers, habits, stats, or general questions:
   - Provide a direct, thorough answer in "message", referencing their actual cards by title.
   - Set "hasAction": false, "actions": [].
4. Semantic Understanding of Card Types:
   Every tracker card in ProgressShelf belongs to one of three distinct semantic categories:
   a) "checklist": For discrete items, syllabus chapters, tasks, steps, packing items, or milestones to check off individually.
      - "cardType": "checklist"
      - "items": Array of actionable items with text field: [{ "text": "Item / Chapter text", "done": false }].
      - You MUST extract EVERY individual item, chapter, or subtask into "items". Do NOT truncate to a single item and do NOT put items in noteText.
      - Title Quality & Natural Academic Formatting:
        Make titles action-oriented, professional, and academically complete. NEVER output plain, robotic, or raw concatenations like "Fluid and Surveying Lab Files" or "Soil and MOS Lab File".
        * Multi-subject tasks: Format as "{Task Type} Completion: {Subject 1} & {Subject 2}" (e.g., "Lab File Completion: Fluid & Surveying", "Lab File Completion: Soil & MOS").
        * Single-subject tasks: Format as "{Task Type} Completion: {Subject}" (e.g., "Lab File Completion: Fluid").
        * Always preserve and capitalize subject acronyms and abbreviations properly (e.g., MOS, BEE, DSA, CAD, Fluid, Surveying, Soil).
      - Checklist Items Formatting & Decomposition:
        * Multi-subject or combined requests: Decompose each subject into its own direct deliverable item in "items":
          e.g., [{ "text": "Fluid Lab File", "done": false }, { "text": "Surveying Lab File", "done": false }]
          e.g., [{ "text": "Soil Lab File", "done": false }, { "text": "MOS Lab File", "done": false }]
        * Single-subject requests: [{ "text": "Fluid Lab File Submission", "done": false }]
      - If the user asks for a checklist for a general project or task without specific items, decompose it into 2 to 4 logical milestones or subtasks. NEVER leave "items" empty for a checklist, and NEVER output generic placeholders like "Step 1"!
      - For checklists: NEVER set "unit", "target", or "preset". Leave "unit" as "" or omit it entirely. NEVER write "n/a", "%n/a", or explanations inside "unit"!
   b) "goal": For quantifiable numeric progress along a scale towards a target number (e.g. pages, hours, kilometers, problems, chapters).
      - "cardType": "goal"
      - "target": Target goal number. You MUST calculate or extract the real number from context (e.g. 22 chapters -> target: 22; 150 pages -> target: 150). NEVER leave target blank or set arbitrary numbers.
      - "unit": Short concise unit name (e.g. 'chapters', 'pages', 'hours', 'problems', 'tasks', 'km', '%').
      - "preset": 'Time' | 'Pages' | 'Chapters' | 'Lectures' | 'Videos' | 'Problems' | 'Tasks' | 'Books' | 'Custom'.
      - "currentProgress": Starting number (default 0).
   c) "note": For informational memos, references, study notes, or reflections without discrete checkboxes or numeric progress.
      - "cardType": "note"
      - "noteText": Formatted markdown text.
5. The Confidence & Ambiguity Protocol (Ask when guessing score is low):
   - High Confidence: The user explicitly specified the tracker format (e.g. requested a "checklist", "goal", or "note") OR the content clearly maps directly to one format.
     -> Propose the action with "cardType" set to "checklist", "goal", or "note", and all required fields fully populated.
   - Low Confidence / Ambiguity: The input could reasonably be tracked in multiple ways (e.g. a list of chapters that could be a checklist of tasks OR a numeric counter 0/22; a recipe that could be a grocery checklist OR a reference note).
     -> DO NOT GUESS BLINDLY or force an arbitrary card type.
     -> Set "hasAction": false, "actions": [].
     -> In "message", ask a warm, natural clarifying question presenting the best options (e.g. "I found 22 math chapters. Would you prefer to track this as a **Checklist** (checking off each chapter individually) or as a **Numeric Goal** (0 of 22 chapters complete)?").
6. Proposing actions ("actions" array, max 10 items):
   - Allowed action types: "create" | "update" | "delete".
   - "create": Creating a brand new tracker. MUST specify "title", "cardType" ('checklist' | 'goal' | 'note'), and its type-specific fields ("items" for checklist, "target"/"unit" for goal, "noteText" for note).
   - "update": Updating/editing an existing card. MUST specify "cardId" matching an existing card from the user's cards.
   - "reschedule": Rescheduling is an "update" action specifying "cardId" and a new "deadline".
   - "delete": Deleting an existing card. Specify "cardId" and title.
   - "plan_day" & "clean_overdue": These are NOT action types. Provide detailed planning advice in Markdown "message", and put concrete proposed card creations or updates into the "actions" array.
   - Batch / Multi-Card Requests: If user asks for multiple cards, return EACH individual action in "actions".
7. Strict Deadline Formatting:
   - If the user mentions ANY deadline, target date, or timeframe in their prompt (e.g. "till 17 nov", "by 17 nov", "due Friday", "by tomorrow", "deadline 17 Nov"):
     You MUST calculate and populate the "deadline" field in EVERY proposed action object in "actions"! NEVER mention a deadline in "message" while leaving "deadline" empty in "actions"!
   - A day starts at midnight 12:00:00 AM (00:00:00) and ends at midnight 11:59:59 PM (23:59:59).
   - If the user mentions a target date or day without an explicit hour/minute (e.g. "this saturday", "by tomorrow", "by Friday", "by next Monday", "by Nov 20", "17 nov", "till 17 nov"):
     Calculate that date and set the deadline to the LAST MOMENT of that date: 11:59:59 PM (23:59:59) in the user's local timezone offset formatted strictly as ISO-8601: "YYYY-MM-DDT23:59:59${userTzOffset || ''}".
   - If user mentions only a time without a date: "${userLocalDate || 'YYYY-MM-DD'}THH:MM:00${userTzOffset || ''}".
   - If both date and time are specified: "YYYY-MM-DDTHH:MM:00${userTzOffset || ''}".
   - If no deadline is specified, set "deadline" to "".
   - NEVER format deadline as natural language or include the word "at". Machine fields must be ISO-8601 strings.
8. Provide a concise explanation in "explanation" for each action.`;

      parts = [{ text: promptText }];
      if (payload?.image?.data && payload?.image?.mimeType) {
        parts.push({
          inlineData: {
            mimeType: String(payload.image.mimeType),
            data: String(payload.image.data),
          },
        });
      }

      responseSchema = {
        type: 'OBJECT',
        properties: {
          message: { type: 'STRING' },
          hasAction: { type: 'BOOLEAN' },
          actions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['create', 'update', 'delete'] },
                cardId: { type: 'STRING' },
                title: { type: 'STRING' },
                cardType: { type: 'STRING', enum: ['goal', 'checklist', 'note'] },
                preset: { type: 'STRING' },
                unit: { type: 'STRING' },
                target: { type: 'NUMBER' },
                currentProgress: { type: 'NUMBER' },
                items: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      text: { type: 'STRING' },
                      done: { type: 'BOOLEAN' },
                    },
                    required: ['text'],
                  },
                },
                noteText: { type: 'STRING' },
                deadline: { type: 'STRING' },
                isRecurring: { type: 'BOOLEAN' },
                resetTime: { type: 'STRING' },
                explanation: { type: 'STRING' },
              },
              required: ['type', 'title', 'cardType'],
            },
          },
        },
        required: ['message', 'hasAction', 'actions'],
      };
    } else if (task === 'daily_briefing') {
      cardsContext = Array.isArray(payload?.cards) ? payload.cards : [];

      const promptText = `You are an intelligent, proactive, and encouraging personal productivity companion for ProgressShelf.
Analyze the user's active cards, habits, checklist items, and deadlines to generate a clear, motivating "Today's Breakdown / Daily Focus" briefing.${userFirstName ? ` The user's first name is "${userFirstName}".` : ''}
${timeRefContext}

The user's current cards and trackers:
${JSON.stringify(cardsContext, null, 2)}

Instructions:
1. "headline": A friendly, motivating, and personalized 1-2 sentence overview of where the user stands today.
   - ALWAYS start with a time-appropriate greeting followed by the user's first name "${userFirstName || ''}"${userFirstName ? ` (e.g. "Good morning ${userFirstName}!", "Good afternoon ${userFirstName}!", or "Good evening ${userFirstName}!" based on user local time)` : ' (e.g. "Good morning!", "Good afternoon!", or "Good evening!" based on user local time)'}.
   - Follow the greeting with a motivating breakdown of active cards and deadlines for today.
   - Example: "${userFirstName ? `Good morning ${userFirstName}! ` : 'Good morning! '}You have 2 daily habits ready and 1 important deadline approaching this evening."
   - NEVER use generic "there" (NEVER say "Good morning there", "Hi there", or "Hello there").
2. "priorities": An array of 2 to 5 specific, high-leverage focus items for today:
   - "title": Action-oriented short title (e.g. "Complete 30 mins Daily Reading", "Submit College Report").
   - "badge": A short tag like "Habit", "Overdue", "Due Today", "Urgent", or "Next Up".
   - "detail": 1 short sentence explaining why or what to do next.
3. "actionPills": An array of 2 to 4 quick action shortcuts or questions the user might want to tap (e.g. "Plan my day", "Break down my biggest goal", "Clean up overdue tasks").
4. If the user has no cards, provide a warm welcome with encouraging suggestions on how to set up their first habit or goal.`;

      parts = [{ text: promptText }];

      responseSchema = {
        type: 'OBJECT',
        properties: {
          headline: { type: 'STRING' },
          priorities: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                title: { type: 'STRING' },
                badge: { type: 'STRING' },
                detail: { type: 'STRING' },
              },
              required: ['title', 'detail'],
            },
          },
          actionPills: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        required: ['headline', 'priorities', 'actionPills'],
      };
    }

    // Resolve Gemini model (cached module-level variable, refreshed ~6h or on model-not-found)
    const tResolveStart = Date.now();
    let activeModel = await resolveGeminiModel(
      apiKey,
      TOTAL_REQUEST_DEADLINE_MS - (Date.now() - requestStartTime)
    );
    tModelResolve = Date.now() - tResolveStart;

    const hasImage = Boolean(payload?.image?.data && payload?.image?.mimeType);
    const perCallTimeoutMs = hasImage ? 30000 : 20000;
    const MAX_GEMINI_ATTEMPTS = 3;
    let geminiAttempts = 0;
    let fallbackModelTried = false;
    let retriedInvalidJson = false;
    let omitThinking = false;

    let geminiJson: { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }> } | null = null;
    let candidateText: string | null = null;
    let parsedResult: unknown = null;
    let lastError = 'Gemini generation request failed';
    let lastStatus = 502;
    let isTimeout = false;

    const tGeminiStart = Date.now();

    while (geminiAttempts < MAX_GEMINI_ATTEMPTS) {
      const totalElapsed = Date.now() - requestStartTime;
      const totalRemaining = TOTAL_REQUEST_DEADLINE_MS - totalElapsed;
      if (totalRemaining <= 0) {
        isTimeout = true;
        break;
      }

      const callTimeout = Math.min(perCallTimeoutMs, totalRemaining);
      const abortCtrl = new AbortController();
      const abortTimer = setTimeout(() => abortCtrl.abort(), callTimeout);

      geminiAttempts++;

      const maxOutputTokens = task === 'daily_briefing' ? 1024 : 8192;
      const generationConfig: Record<string, unknown> = {
        responseMimeType: 'application/json',
        responseSchema,
        maxOutputTokens,
      };

      // Minimize or disable thinking to preserve token budget for large payloads and eliminate latency
      // Gemini 2.0, 2.5, flash-lite, and latest models use thinkingBudget: 0
      // Gemini 3.x, 4.x models use thinkingLevel: "minimal"
      if (!omitThinking) {
        if (activeModel.includes('3.') || activeModel.includes('4.')) {
          generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
        } else {
          generationConfig.thinkingConfig = { thinkingBudget: 0 };
        }
      }

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent`;
      let resOk = false;
      let rawJson: any = null;

      try {
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig,
          }),
          signal: abortCtrl.signal,
        });

        lastStatus = res.status;
        resOk = res.ok;

        if (res.ok) {
          rawJson = await res.json();
        } else {
          try {
            const errJson = await res.json();
            if (errJson?.error?.message) {
              lastError = errJson.error.message;
            }
          } catch (_) {
            try {
              const errText = await res.text();
              if (errText) lastError = errText;
            } catch (_) {}
          }
        }
      } catch (fetchErr: unknown) {
        const isAbort =
          (fetchErr as { name?: string })?.name === 'AbortError' ||
          abortCtrl.signal.aborted;

        if (isAbort || Date.now() - requestStartTime >= TOTAL_REQUEST_DEADLINE_MS) {
          isTimeout = true;
          // If call timed out but total request deadline has enough time, try fallback model once
          if (
            !fallbackModelTried &&
            geminiAttempts < MAX_GEMINI_ATTEMPTS &&
            TOTAL_REQUEST_DEADLINE_MS - (Date.now() - requestStartTime) > 15000
          ) {
            fallbackModelTried = true;
            cachedModel = null;
            cachedModelResolvedAt = 0;
            const fallback = PREFERRED_MODELS.find((m) => m !== activeModel) || 'gemini-3.5-flash-lite';
            console.warn(`[ai-proxy] Call timed out on ${activeModel}. Trying fallback model: ${fallback}`);
            activeModel = fallback;
            isTimeout = false;
            continue;
          }
          break;
        }

        console.warn(`[ai-proxy] Network or body read error on attempt ${geminiAttempts}:`, fetchErr);
        lastStatus = 503;
        lastError = 'Network failure connecting to Gemini';

        if (
          geminiAttempts < MAX_GEMINI_ATTEMPTS &&
          TOTAL_REQUEST_DEADLINE_MS - (Date.now() - requestStartTime) > 1000
        ) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        break;
      } finally {
        clearTimeout(abortTimer);
      }

      if (resOk) {
        geminiJson = rawJson;

        // Check candidates & blocked finishReason
        const candidate = geminiJson?.candidates?.[0];
        const finishReason = candidate?.finishReason;

        // If finishReason is MAX_TOKENS, don't retry the same call; return code 'TOO_LONG' with a clear message
        if (finishReason === 'MAX_TOKENS') {
          console.warn('[ai-proxy] Generation stopped due to MAX_TOKENS');
          tGeminiCall = Date.now() - tGeminiStart;
          const tTotal = Date.now() - requestStartTime;
          console.log(
            `[ai-proxy] Timings (ms) - decrypt: ${tDecrypt}ms, limit_check: ${tLimitCheck}ms, model_resolve: ${tModelResolve}ms, gemini_call: ${tGeminiCall}ms, total: ${tTotal}ms`
          );

          if (task === 'chat') {
            return jsonResponse(
              {
                message:
                  "The response was too long to complete and was cut short. Please ask a more specific or concise question.",
                hasAction: false,
                actions: [],
                action: null,
                code: 'TOO_LONG',
              },
              200
            );
          }
          return jsonResponse(
            {
              error:
                'The generated response exceeded the maximum token limit. Please break down your request into smaller parts.',
              code: 'TOO_LONG',
            },
            422
          );
        }

        const isBlocked =
          finishReason &&
          finishReason !== 'STOP';

        candidateText = candidate?.content?.parts?.[0]?.text ?? null;
        console.log('[ai-proxy] Raw candidate response text:', candidateText ? candidateText.slice(0, 600) : 'null');

        if (!candidate || isBlocked || !candidateText) {
          console.warn(`[ai-proxy] Empty or blocked candidate. finishReason: ${finishReason}`);
          tGeminiCall = Date.now() - tGeminiStart;
          const tTotal = Date.now() - requestStartTime;
          console.log(
            `[ai-proxy] Timings (ms) - decrypt: ${tDecrypt}ms, limit_check: ${tLimitCheck}ms, model_resolve: ${tModelResolve}ms, gemini_call: ${tGeminiCall}ms, total: ${tTotal}ms`
          );

          if (task === 'chat') {
            return jsonResponse(
              {
                message:
                  "I'm sorry, I wasn't able to complete that request due to content safety or policy restrictions. Please try phrasing your request differently.",
                hasAction: false,
                actions: [],
                action: null,
                code: 'BLOCKED',
              },
              200
            );
          }
          return jsonResponse(
            {
              error: 'The request could not be processed due to content safety or policy restrictions.',
              code: 'BLOCKED',
            },
            422
          );
        }

        // Validate JSON parsing; retry once if invalid, otherwise return friendly message with no action
        try {
          parsedResult = JSON.parse(candidateText);
          break; // Successfully parsed!
        } catch (jsonErr) {
          console.warn(`[ai-proxy] JSON parse failed on candidate text:`, jsonErr);
          if (!retriedInvalidJson && geminiAttempts < MAX_GEMINI_ATTEMPTS) {
            retriedInvalidJson = true;
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }

          tGeminiCall = Date.now() - tGeminiStart;
          const tTotal = Date.now() - requestStartTime;
          console.log(
            `[ai-proxy] Timings (ms) - decrypt: ${tDecrypt}ms, limit_check: ${tLimitCheck}ms, model_resolve: ${tModelResolve}ms, gemini_call: ${tGeminiCall}ms, total: ${tTotal}ms`
          );

          if (task === 'chat') {
            return jsonResponse(
              {
                message:
                  "I received a response, but couldn't format it properly. Please try again or rephrase your request.",
                hasAction: false,
                actions: [],
                action: null,
                code: 'BAD_FORMAT',
              },
              200
            );
          }
          return jsonResponse(
            {
              error: 'Failed to format structured data. Please try again or rephrase your request.',
              code: 'BAD_FORMAT',
            },
            422
          );
        }
      }

      console.warn(`[ai-proxy] Attempt ${geminiAttempts} failed (${lastStatus}): ${lastError}`);

      // Handle thinkingConfig format or unsupported errors without failing
      if (
        lastStatus === 400 &&
        !omitThinking &&
        generationConfig.thinkingConfig
      ) {
        if ((generationConfig.thinkingConfig as { thinkingLevel?: string })?.thinkingLevel) {
          console.log('[ai-proxy] thinkingLevel returned 400. Retrying with thinkingBudget: 0...');
          generationConfig.thinkingConfig = { thinkingBudget: 0 };
        } else {
          console.log('[ai-proxy] Model does not support thinkingConfig (status 400). Retrying without thinkingConfig...');
          omitThinking = true;
        }
        continue;
      }

      // 429 mapping: tell apart Google's quota error from our hourly limit
      if (lastStatus === 429) {
        const lower = (lastError || '').toLowerCase();
        if (lower.includes('quota') || lower.includes('free_tier') || lower.includes('resource_exhausted')) {
          lastError = 'Your Gemini free-tier quota is used up for now. It usually resets daily. Try again later or use another key.';
        }
        break;
      }

      // No retry on 400/401/429
      if (lastStatus === 400 || lastStatus === 401) {
        break;
      }

      // Model-not-found: refresh cache and try at most one fallback model
      if (isModelNotFoundError(lastStatus, lastError)) {
        console.warn(`[ai-proxy] Model ${activeModel} not found. Invalidating cache.`);
        cachedModel = null;
        cachedModelResolvedAt = 0;

        if (!fallbackModelTried && geminiAttempts < MAX_GEMINI_ATTEMPTS) {
          fallbackModelTried = true;
          const fallback = PREFERRED_MODELS.find((m) => m !== activeModel) || 'gemini-3.5-flash-lite';
          console.log(`[ai-proxy] Trying fallback model: ${fallback}`);
          activeModel = fallback;
          continue;
        }
        break;
      }

      // Retry Gemini once or twice with short backoff on 500/503 only
      if (lastStatus === 500 || lastStatus === 503) {
        if (
          geminiAttempts < MAX_GEMINI_ATTEMPTS &&
          TOTAL_REQUEST_DEADLINE_MS - (Date.now() - requestStartTime) > 1000
        ) {
          console.log(`[ai-proxy] Transient error ${lastStatus}. Retrying after short backoff...`);
          await new Promise((r) => setTimeout(r, 600));

          // If high demand 503 on current model and fallback not tried yet, switch to fallback model
          if (lastStatus === 503 && !fallbackModelTried) {
            fallbackModelTried = true;
            cachedModel = null;
            cachedModelResolvedAt = 0;
            const fallback = PREFERRED_MODELS.find((m) => m !== activeModel) || 'gemini-3.5-flash-lite';
            console.warn(`[ai-proxy] Switching from 503 model ${activeModel} to fallback: ${fallback}`);
            activeModel = fallback;
          }

          continue;
        }
        break;
      }

      // Any other error: do not retry
      break;
    }

    tGeminiCall = Date.now() - tGeminiStart;
    const tTotal = Date.now() - requestStartTime;

    console.log(
      `[ai-proxy] Timings (ms) - decrypt: ${tDecrypt}ms, limit_check: ${tLimitCheck}ms, model_resolve: ${tModelResolve}ms, gemini_call: ${tGeminiCall}ms, total: ${tTotal}ms`
    );

    // Total request deadline or per-call timeout
    if (isTimeout || (Date.now() - requestStartTime >= TOTAL_REQUEST_DEADLINE_MS && !parsedResult)) {
      console.warn(`[ai-proxy] Request timed out after ${tTotal}ms`);
      return jsonResponse({ error: 'timeout', code: 'TIMEOUT' }, 504);
    }

    if (!parsedResult) {
      console.error(`[ai-proxy] Gemini call failed permanently (${lastStatus}): ${lastError}`);
      const returnStatus =
        typeof lastStatus === 'number' && lastStatus >= 400 && lastStatus <= 599
          ? lastStatus
          : 502;
      return jsonResponse(
        {
          error: lastError,
          status: returnStatus,
          ...(lastStatus === 429 ? { code: 'GOOGLE_QUOTA' } : {}),
        },
        returnStatus
      );
    }

    // Backend validation and sanitization for chat actions:
    // 1. Validate that cardId exists in the user cards sent (for update and delete)
    // 2. Truncate strings (title, noteText, explanation, unit, items)
    // 3. Ensure numbers are finite
    // 4. Maximum 10 actions
    // 5. Populate both 'actions' array and legacy 'action' (for client transition)
    if (task === 'chat' && parsedResult && typeof parsedResult === 'object') {
      const validCardIds = new Set(
        cardsContext.map((c: { id?: string | number }) => String(c?.id))
      );
      let rawActions: unknown[] = [];

      const pr = parsedResult as Record<string, unknown>;
      if (Array.isArray(pr.actions)) {
        rawActions = pr.actions;
      } else if (pr.action && typeof pr.action === 'object') {
        rawActions = [pr.action];
      }

      // Cap at 10 actions maximum
      rawActions = rawActions.slice(0, 10);

      const validatedActions: Array<Record<string, unknown>> = [];

      for (const item of rawActions) {
        if (!item || typeof item !== 'object') continue;
        const act = item as Record<string, unknown>;
        const actType = String(act.type || '').toLowerCase().trim();
        if (!['create', 'update', 'delete'].includes(actType)) continue;

        const cardId = act.cardId ? String(act.cardId).trim() : '';

        // For update and delete: cardId MUST exist in the cards sent
        if (['update', 'delete'].includes(actType)) {
          if (!cardId || !validCardIds.has(cardId)) {
            console.warn(
              `[ai-proxy] Dropping ${actType} action: cardId "${cardId}" not found in user cards.`
            );
            continue;
          }
        }

        // For delete: only type, cardId, and title
        if (actType === 'delete') {
          validatedActions.push({
            type: 'delete',
            cardId,
            title: typeof act.title === 'string' && act.title.trim() ? act.title.slice(0, 120).trim() : undefined,
          });
          continue;
        }

        // For update: include only fields the model provided, never change cardType
        if (actType === 'update') {
          let safeItems: Array<{ text: string; done: boolean }> | undefined = undefined;
          if (Array.isArray(act.items)) {
            safeItems = act.items
              .filter((it) => it && typeof it === 'object')
              .map((it: { text?: unknown; done?: unknown }) => ({
                text: typeof it.text === 'string' ? it.text.slice(0, 120).trim() : '',
                done: Boolean(it.done),
              }))
              .filter((it) => it.text.length > 0)
              .slice(0, 20);
          }

          validatedActions.push({
            type: 'update',
            cardId,
            title: typeof act.title === 'string' && act.title.trim() ? act.title.slice(0, 120).trim() : undefined,
            cardType: undefined,
            preset: typeof act.preset === 'string' && act.preset.trim() ? act.preset.slice(0, 30).trim() : undefined,
            unit: typeof act.unit === 'string' && act.unit.trim() ? act.unit.slice(0, 20).trim() : undefined,
            target:
              typeof act.target === 'number' && Number.isFinite(act.target)
                ? act.target
                : undefined,
            currentProgress:
              typeof act.currentProgress === 'number' && Number.isFinite(act.currentProgress)
                ? act.currentProgress
                : undefined,
            items: safeItems && safeItems.length > 0 ? safeItems : undefined,
            noteText:
              typeof act.noteText === 'string' && act.noteText.trim() ? act.noteText.slice(0, 500).trim() : undefined,
            deadline:
              typeof act.deadline === 'string' && act.deadline.trim()
                ? (parseDatePatternToIso(act.deadline, currentDateStr, userTzOffset) || act.deadline.slice(0, 40).trim())
                : undefined,
            isRecurring: typeof act.isRecurring === 'boolean' ? act.isRecurring : undefined,
            resetTime:
              typeof act.resetTime === 'string' && act.resetTime.trim() ? act.resetTime.slice(0, 10).trim() : undefined,
            explanation:
              typeof act.explanation === 'string' && act.explanation.trim()
                ? act.explanation.slice(0, 300).trim()
                : undefined,
          });
          continue;
        }

        // For create: intelligent cardType, target extraction, and deadline normalization
        const rawTitleCandidate =
          typeof act.title === 'string' ? act.title.slice(0, 120).trim() : '';
        const safeTitle = formatAcademicTitle(rawTitleCandidate, userMessage);
        const safeNoteText =
          typeof act.noteText === 'string' ? act.noteText.slice(0, 500).trim() : '';
        const safeExplanation =
          typeof act.explanation === 'string'
            ? act.explanation.slice(0, 300).trim()
            : '';
        const rawUnit =
          typeof act.unit === 'string' ? act.unit.slice(0, 20).trim() : '';

        // Checklist items extraction (support up to 50 items for syllabi / large lists)
        let rawItems: Array<{ text: string; done: boolean }> | undefined = undefined;
        if (Array.isArray(act.items)) {
          rawItems = act.items
            .filter((it) => it && typeof it === 'object')
            .map((it: { text?: unknown; done?: unknown }) => ({
              text: typeof it.text === 'string' ? it.text.slice(0, 120).trim() : '',
              done: Boolean(it.done),
            }))
            .filter((it) => it.text.length > 0)
            .slice(0, 50);
        }

        // Intelligent Card Type inference
        const rawCardType = String(act.cardType || '').toLowerCase().trim();
        let safeCardType: 'goal' | 'checklist' | 'note' = 'goal';

        // High priority: user explicitly requested checklist format or AI reply confirmed checklist
        if (
          /\b(?:checklist|check\s*list|in\s+check\s*listype)\b/i.test(userMessage) ||
          /\b(?:checklist|check\s*list)\b/i.test(String(pr.message || ''))
        ) {
          safeCardType = 'checklist';
        } else if (['goal', 'checklist', 'note'].includes(rawCardType)) {
          safeCardType = rawCardType as 'goal' | 'checklist' | 'note';
        } else if (
          /\b(?:todo|to-do|tasks?)\b/i.test(userMessage) ||
          /\b(?:checklist|check\s*list|todo|task)\b/i.test(safeTitle) ||
          (rawItems && rawItems.length > 0)
        ) {
          safeCardType = 'checklist';
        } else if (safeNoteText && !rawUnit && typeof act.target !== 'number') {
          safeCardType = 'note';
        } else {
          safeCardType = 'goal';
        }

        // If card is a checklist, ensure items are populated; if rawItems is empty but noteText has lines, extract lines
        let safeItems: Array<{ text: string; done: boolean }> | undefined = undefined;
        if (safeCardType === 'checklist') {
          if ((!rawItems || rawItems.length === 0) && safeNoteText) {
            const lines = safeNoteText
              .split(/\r?\n/)
              .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
              .filter((l) => l.length > 0);
            if (lines.length > 0) {
              rawItems = lines.slice(0, 50).map((l) => ({ text: l.slice(0, 120), done: false }));
            }
          }

          safeItems = extractDeliverableItems(rawItems, safeTitle, userMessage);
        }

        // Sanitize unit
        let safeUnit = '';
        if (safeCardType === 'goal' && typeof act.unit === 'string') {
          let u = act.unit.trim().slice(0, 20);
          if (u.includes('n/a') || u.includes('%n/a') || u.includes('/') || u.length > 15) {
            u = '%';
          }
          safeUnit = u;
        }

        // Finite numbers check (NO arbitrary 100% blind default!)
        let safeTarget: number | undefined = undefined;
        let safeCurrent: number | undefined = undefined;
        if (safeCardType === 'goal') {
          if (typeof act.target === 'number' && Number.isFinite(act.target)) {
            safeTarget = act.target;
          } else if (safeItems && safeItems.length > 0) {
            safeTarget = safeItems.length;
          } else {
            safeTarget = 100;
          }
          safeCurrent =
            typeof act.currentProgress === 'number' && Number.isFinite(act.currentProgress)
              ? act.currentProgress
              : 0;
        } else if (safeCardType === 'checklist') {
          safeTarget = safeItems ? safeItems.length : 1;
          safeCurrent = 0;
        }

        // Deadline normalization & extraction
        let safeDeadline: string | undefined = undefined;
        if (typeof act.deadline === 'string' && act.deadline.trim()) {
          safeDeadline =
            parseDatePatternToIso(act.deadline, currentDateStr, userTzOffset) ||
            act.deadline.slice(0, 40).trim();
        }

        // Proactive extraction: if model omitted deadline from action, extract from AI message or user message
        if (!safeDeadline) {
          const extractedFromAiReply = parseDatePatternToIso(
            String(pr.message || ''),
            currentDateStr,
            userTzOffset
          );
          const extractedFromUserMsg = parseDatePatternToIso(
            userMessage,
            currentDateStr,
            userTzOffset
          );
          safeDeadline = extractedFromAiReply || extractedFromUserMsg || undefined;
        }

        const validItem: Record<string, unknown> = {
          type: 'create',
          cardId: undefined,
          title: safeTitle,
          cardType: safeCardType,
          preset: safeCardType === 'goal' && typeof act.preset === 'string' && act.preset.trim() ? act.preset.slice(0, 30).trim() : undefined,
          unit: safeCardType === 'goal' ? safeUnit : undefined,
          target: safeCardType === 'goal' ? safeTarget : undefined,
          currentProgress: safeCardType === 'goal' ? safeCurrent : undefined,
          items: safeCardType === 'checklist' ? safeItems : undefined,
          noteText: safeCardType === 'note' ? safeNoteText : undefined,
          deadline: safeDeadline,
          isRecurring: Boolean(act.isRecurring),
          resetTime:
            typeof act.resetTime === 'string' && act.resetTime.trim() ? act.resetTime.slice(0, 10).trim() : undefined,
          explanation: safeExplanation,
        };

        // Smoothly update conversational message to reference polished title
        if (
          typeof pr.message === 'string' &&
          safeTitle &&
          rawTitleCandidate &&
          rawTitleCandidate.toLowerCase() !== safeTitle.toLowerCase()
        ) {
          const escRegex = rawTitleCandidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          pr.message = pr.message.replace(new RegExp(`\\b${escRegex}\\b`, 'gi'), `**${safeTitle}**`);
        }

        validatedActions.push(validItem);
      }

      pr.actions = validatedActions;
      pr.hasAction = validatedActions.length > 0;
      // Client transition: preserve legacy single action pointing to first item
      pr.action = validatedActions.length > 0 ? validatedActions[0] : null;
    }

    // Count a request against the hourly limit only if the Gemini call succeeded
    await supabaseAdmin
      .from('ai_usage')
      .upsert(
        {
          user_id: user.id,
          window_start: windowStart,
          count: currentCount + 1,
        },
        { onConflict: 'user_id,window_start' }
      );

    // If request was executed under free trial, increment usage counter in user_ai_trials
    if (isTrialRequest && trialRecord) {
      const isBriefing = task === 'daily_briefing';
      const newChatUsed = isBriefing ? trialRecord.chat_requests_used : trialRecord.chat_requests_used + 1;
      const newBriefingUsed = isBriefing ? trialRecord.briefing_requests_used + 1 : trialRecord.briefing_requests_used;

      await supabaseAdmin
        .from('user_ai_trials')
        .update({
          chat_requests_used: newChatUsed,
          briefing_requests_used: newBriefingUsed,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      // Attach trial status to response object if it is an object
      if (parsedResult && typeof parsedResult === 'object') {
        (parsedResult as any)._trial = {
          isTrial: true,
          chatRemaining: Math.max(0, MAX_TRIAL_CHAT_REQUESTS - newChatUsed),
          chatTotal: MAX_TRIAL_CHAT_REQUESTS,
          briefingRemaining: Math.max(0, MAX_TRIAL_BRIEFING_REQUESTS - newBriefingUsed),
          briefingTotal: MAX_TRIAL_BRIEFING_REQUESTS,
          chatUsed: newChatUsed,
          briefingUsed: newBriefingUsed,
        };
      }
    }

    // Format title and deliverables for create_tracker
    if (task === 'create_tracker' && parsedResult && typeof parsedResult === 'object') {
      const pr = parsedResult as Record<string, unknown>;
      const userInput = String(payload?.input || payload?.text || payload?.prompt || '');
      if (typeof pr.title === 'string') {
        pr.title = formatAcademicTitle(pr.title, userInput);
      }
      if (pr.type === 'checklist') {
        const rawItems = Array.isArray(pr.items) ? (pr.items as Array<{ text: string; done: boolean }>) : [];
        pr.items = extractDeliverableItems(rawItems, String(pr.title || ''), userInput);
      }
    }

    return jsonResponse(parsedResult, 200);
  }

  return jsonResponse({ error: `Unsupported action: "${action}"` }, 400);
});
