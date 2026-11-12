import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Constants & Configuration
// ---------------------------------------------------------------------------
const RATE_LIMIT_GENERATE_PER_HOUR = 30;
const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6 MB max request payload
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';

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
    let validationRes: Response;
    try {
      validationRes = await fetch(validationUrl, {
        method: 'GET',
        headers: {
          'x-goog-api-key': trimmedKey,
        },
      });
    } catch {
      console.error('[ai-proxy] Network failure connecting to Gemini validation endpoint');
      return jsonResponse({ error: 'Failed to reach Gemini API. Please check network connectivity.' }, 502);
    }

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

    // Per-user rate limiting (30 generate calls/hour)
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
    if (currentCount >= RATE_LIMIT_GENERATE_PER_HOUR) {
      return jsonResponse(
        { error: `Rate limit exceeded: maximum ${RATE_LIMIT_GENERATE_PER_HOUR} generate calls per hour.` },
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
    try {
      apiKey = await decryptApiKey(keyRecord.key_encrypted, AI_KEY_SECRET);
    } catch {
      console.error('[ai-proxy] Decryption error for user:', user.id);
      return jsonResponse({ error: 'Failed to decrypt API key. Please re-save your key.' }, 500);
    }

    // Build task-specific prompts and structured JSON schema
    let parts: Array<Record<string, unknown>> = [];
    let responseSchema: Record<string, unknown> = {};

    const currentDateStr =
      typeof payload?.currentDate === 'string' && payload.currentDate
        ? payload.currentDate
        : new Date().toISOString();

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
Current reference date and time: ${currentDateStr}.

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

Deadline handling:
- If the user mentions a target completion date or relative time (e.g. "by Friday", "by tomorrow at 5pm", "in 2 weeks", "by end of next month"), calculate and output the exact deadline as an ISO 8601 string (e.g. "2026-11-15T17:00:00.000Z") in "deadline".
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
          unit: { type: 'STRING' },
          target: { type: 'NUMBER' },
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
Current reference date and time: ${currentDateStr}.

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
5. If the user asks to break down or edit a card but did NOT specify which one and it's ambiguous:
   - Ask them politely in "message" which of their cards they want to focus on (mentioning their card titles), and set "hasAction": false, "action": null.
6. Provide a concise rationale in action.explanation if an action is suggested.`;

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
              unit: { type: 'STRING' },
              target: { type: 'NUMBER' },
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

    // Dynamic model resolution: query models list to use the exact working model
    let candidateModels: string[] = [];
    const preferredOrder = [
      'gemini-3.8-flash',
      'gemini-2.0-flash',
      'gemini-2.0-flash-001',
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash',
      'gemini-2.5-flash',
      'gemini-1.5-pro',
    ];

    try {
      const modelsRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': apiKey },
      });
      if (modelsRes.ok) {
        const mJson = await modelsRes.json();
        const available: string[] = (mJson.models || [])
          .filter((m: { supportedGenerationMethods?: string[] }) =>
            m.supportedGenerationMethods?.includes('generateContent')
          )
          .map((m: { name: string }) => m.name.replace(/^models\//, ''));

        console.log('[ai-proxy] Available models for user key:', available);
        candidateModels = [
          ...preferredOrder.filter((p) => available.includes(p)),
          ...available.filter((a) => !preferredOrder.includes(a) && a.includes('flash')),
          ...available.filter((a) => !preferredOrder.includes(a) && !a.includes('flash')),
        ];
      }
    } catch (e) {
      console.warn('[ai-proxy] Error querying available models:', e);
    }

    if (!candidateModels.length) {
      candidateModels = preferredOrder;
    }

    // Execute structured JSON Gemini call with automatic model fallback
    // Note: x-goog-api-key header is used; key is never in URL.
    // Guard: Never log card text, payload, or decrypted keys.
    let geminiJson: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null = null;
    let lastError = 'Gemini generation request failed';
    let lastStatus = 502;

    for (const modelToTry of candidateModels) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelToTry}:generateContent`;
      try {
        const geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        });

        if (geminiRes.ok) {
          geminiJson = await geminiRes.json();
          break; // Succeeded!
        }

        lastStatus = geminiRes.status;
        try {
          const errJson = await geminiRes.json();
          if (errJson?.error?.message) {
            lastError = errJson.error.message;
          }
        } catch (_) {}

        console.warn(`[ai-proxy] Model ${modelToTry} call failed (${lastStatus}): ${lastError}. Trying fallback model...`);

        // If credentials are completely invalid or rate limit hit, do not loop
        if (lastStatus === 401 || (lastError && lastError.toLowerCase().includes('api key not valid'))) {
          break;
        }
      } catch (networkErr) {
        console.warn(`[ai-proxy] Network failure trying model ${modelToTry}:`, networkErr);
      }
    }

    if (!geminiJson) {
      console.error(`[ai-proxy] All candidate models failed. Last status: ${lastStatus}, error: ${lastError}`);
      const returnStatus = (typeof lastStatus === 'number' && lastStatus >= 400 && lastStatus <= 599) ? lastStatus : 502;
      return jsonResponse({ error: lastError, status: returnStatus }, returnStatus);
    }

    const candidateText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      return jsonResponse({ error: 'No content received from Gemini model' }, 502);
    }

    let parsedResult: unknown;
    try {
      parsedResult = JSON.parse(candidateText);
    } catch {
      return jsonResponse({ error: 'Failed to parse structured JSON from model output' }, 502);
    }

    // Increment user rate limit usage upon successful execution
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

    // Return parsed JSON
    return jsonResponse(parsedResult, 200);
  }

  return jsonResponse({ error: `Unsupported action: "${action}"` }, 400);
});
