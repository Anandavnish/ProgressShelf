import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Constants & Configuration
// ---------------------------------------------------------------------------
const RATE_LIMIT_GENERATE_PER_HOUR = 30;
const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6 MB max request payload
const TOTAL_REQUEST_DEADLINE_MS = 45000; // ~45s total request deadline

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
  // ACTION: status -> { connected, last4 }
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

    if (!data) {
      return jsonResponse({ connected: false, last4: null });
    }

    return jsonResponse({ connected: true, last4: data.last4 });
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

    const SUPPORTED_TASKS = ['ping', 'create_tracker', 'break_down_goal', 'extract_notes', 'chat'];
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

    // Fetch user's encrypted key
    const { data: keyRecord, error: keyQueryError } = await supabaseAdmin
      .from('user_ai_keys')
      .select('key_encrypted')
      .eq('user_id', user.id)
      .maybeSingle();

    if (keyQueryError || !keyRecord?.key_encrypted) {
      return jsonResponse({ error: 'No Gemini API key configured. Please configure an API key first.' }, 400);
    }

    // Decrypt key server-side
    let apiKey: string;
    const tDecryptStart = Date.now();
    try {
      apiKey = await decryptApiKey(keyRecord.key_encrypted, AI_KEY_SECRET);
    } catch {
      console.error('[ai-proxy] Decryption error for user:', user.id);
      return jsonResponse({ error: 'Failed to decrypt API key. Please re-save your key.' }, 500);
    }
    tDecrypt = Date.now() - tDecryptStart;

    // Build task-specific prompts and structured JSON schema
    let parts: Array<Record<string, unknown>> = [];
    let responseSchema: Record<string, unknown> = {};

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
      const userMessage = String(payload?.message || payload?.text || payload?.input || '').trim();
      if (!userMessage && !payload?.image?.data) {
        return jsonResponse({ error: 'Message text or image is required.' }, 400);
      }

      const cardsContext = Array.isArray(payload?.cards) ? payload.cards : [];
      const historyContext = Array.isArray(payload?.history) ? payload.history : [];

      const promptText = `You are an intelligent, friendly, and proactive personal AI companion for ProgressShelf, a personal progress and habit tracking app.
The user is having a conversation with you.
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
1. Always converse naturally, warmly, and helpfully with the user in "message" using Markdown formatting (bolding, lists, bullet points).
2. You have FULL ACCESS to inspect, discuss, recommend, create, update, or delete the user's cards.
3. If the user asks about their trackers, habits, stats, or general questions:
   - Provide a direct, thorough answer in "message", referencing their actual cards by title.
   - Set "hasAction": false, "action": null.
4. If the user wants to take action:
   - "create": Creating a brand new tracker (goal, checklist, or note). Set action with title, cardType, target/items/noteText, deadline (if any), repeat (if habit).
   - "breakdown": Breaking down a goal or existing card into 4-7 actionable checklist steps.
   - "update": Updating/editing an existing card (changing title, editing items, updating note, rescheduling deadline). Provide the cardId of the target card.
   - "delete": Deleting an existing card. Specify cardId and title.
   - "plan_day": When user asks to plan their day, organize today's priorities based on active cards and deadlines, explain in "message", and suggest a checklist plan in action.
   - "clean_overdue": When user asks to clean up overdue tasks, identify overdue trackers, explain what to do in "message", and suggest actions in action.
   - Deadline rules for action.deadline:
     * A day starts at midnight 12:00:00 AM (00:00:00) and ends at midnight 11:59:59 PM (23:59:59).
     * If the user mentions a target date or day without an explicit hour/minute (e.g. "this saturday", "by tomorrow", "by Friday", "by next Monday", "by Nov 20"):
       Calculate that date and set the deadline to the LAST MOMENT of that date: 11:59:59 PM (23:59:59) in the user's local timezone offset: "YYYY-MM-DDT23:59:59${userTzOffset || ''}". Never set it to 00:00:00, 09:00:00, or 12:00:00.
     * If the user mentions only a time without a date (e.g. "by 5pm", "by 18:00", "at 9pm"):
       It refers to TODAY (${userLocalDate || 'current date'}) at that time: "${userLocalDate || 'YYYY-MM-DD'}THH:MM:00${userTzOffset || ''}".
     * If both date and time are specified (e.g. "tomorrow at 5pm", "this saturday by 3:30 PM"):
       Set the deadline to that exact date and time with offset: "YYYY-MM-DDTHH:MM:00${userTzOffset || ''}".
     * If no deadline is specified, set "deadline" to "".
5. If the user asks to break down or edit a card but did NOT specify which one and it's ambiguous:
   - Ask them politely in "message" which of their cards they want to focus on (mentioning their card titles), and set "hasAction": false, "action": null.
6. For numeric goals/habits ("cardType": "goal"):
   - "preset": Select the best preset type: 'Time' (for habits/trackers measured in minutes or hours), 'Pages', 'Chapters', 'Lectures', 'Videos', 'Problems', 'Tasks', 'Books', or 'Custom'.
   - "unit": MUST BE A SHORT CONCISE WORD (e.g. 'mins', 'hours', 'pages', 'chapters', 'tasks', 'problems', '%'). NEVER put internal reasoning, sentences, or thoughts in "unit".
   - "target": Target goal number (e.g. 30).
   - "currentProgress": Starting progress amount (default 0).
7. Provide a concise rationale in action.explanation if an action is suggested.`;

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
          action: {
            type: 'OBJECT',
            nullable: true,
            properties: {
              type: { type: 'STRING' },
              cardId: { type: 'STRING' },
              title: { type: 'STRING' },
              cardType: { type: 'STRING' },
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
          },
        },
        required: ['message', 'hasAction'],
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

      const maxOutputTokens = task === 'chat' ? 2048 : 4096;
      const generationConfig: Record<string, unknown> = {
        responseMimeType: 'application/json',
        responseSchema,
        maxOutputTokens,
      };

      // Minimize or disable thinking
      // Gemini 3.x, 4.x, and -latest models use thinkingLevel: "minimal"; 2.5 models use thinkingBudget: 0
      if (!omitThinking) {
        if (activeModel.includes('2.5')) {
          generationConfig.thinkingConfig = { thinkingBudget: 0 };
        } else {
          generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
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
      return jsonResponse({ error: lastError, status: returnStatus }, returnStatus);
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

    return jsonResponse(parsedResult, 200);
  }

  return jsonResponse({ error: `Unsupported action: "${action}"` }, 400);
});
