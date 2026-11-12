// ai.js - Client-side AI proxy integration
// Handles secure Gemini key status, validation, deletion, and structured JSON generation.
// SECURITY GUARANTEE: The API key is NEVER stored in localStorage, sessionStorage, or cached client-side.

import { supabase, isConfigured } from "./supabase-config.js?v=3.2";
import { isGuestMode } from "./auth.js?v=3.2";

/**
 * Extracts a readable error message from a Supabase FunctionsHttpError.
 */
async function extractErrorMessage(error, defaultMsg = 'AI service request failed') {
  if (!error) return defaultMsg;
  console.error('[ai] Edge function error details:', error, error.context);

  try {
    if (error.context) {
      const ctx = error.context;
      const status = ctx.status;

      let rawText = '';
      if (typeof ctx.text === 'function') {
        try {
          rawText = await ctx.text();
        } catch (_) {}
      } else if (typeof ctx.json === 'function') {
        try {
          const j = await ctx.json();
          rawText = JSON.stringify(j);
        } catch (_) {}
      }

      if (rawText) {
        try {
          const parsed = JSON.parse(rawText);
          if (typeof parsed === 'string') return parsed;
          if (typeof parsed?.error === 'string') return parsed.error;
          if (parsed?.error?.message) return parsed.error.message;
          if (parsed?.message) return parsed.message;
        } catch (_) {
          // If plain text (not JSON), return cleanly if short
          if (rawText.length < 250 && !rawText.includes('<html') && !rawText.includes('<!DOCTYPE')) {
            return `AI Service Error (${status || 'HTTP'}): ${rawText.trim()}`;
          }
        }
      }

      if (status === 429) {
        return 'Rate limit exceeded: maximum 30 AI calls per hour. Please try again later.';
      }
      if (status === 401) {
        return 'Authentication required or session expired. Please sign in again.';
      }
      if (status === 502 || status === 504) {
        return 'The AI service timed out or is temporarily unreachable. Please try again.';
      }
      if (status) {
        return `AI service error (${status}). Please try again.`;
      }
    }
  } catch (err) {
    console.warn('[ai] Error extracting message from error context:', err);
  }

  return error.message || defaultMsg;
}

/**
 * Checks whether an AI key is configured for the active user.
 * @returns {Promise<{ connected: boolean, last4: string | null }>}
 */
export async function aiStatus() {
  if (!isConfigured || !supabase || isGuestMode()) {
    return { connected: false, last4: null };
  }

  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { action: 'status' }
  });

  if (error) {
    const message = await extractErrorMessage(error, 'Failed to fetch AI key status');
    throw new Error(message);
  }

  return {
    connected: Boolean(data?.connected),
    last4: data?.last4 || null
  };
}

/**
 * Validates and securely saves the user's Gemini key on the server.
 * The raw key is transmitted securely over TLS directly to the Edge Function,
 * validated against Gemini with a minimal request, encrypted with AES-256-GCM,
 * and stored in the database. It is NEVER persisted in browser storage.
 * 
 * @param {string} key - Gemini API key
 * @returns {Promise<{ connected: boolean, last4: string }>}
 */
export async function aiSaveKey(key) {
  if (!isConfigured || !supabase || isGuestMode()) {
    throw new Error('Please sign in to save your Gemini API key. Guest accounts are not supported.');
  }

  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error('A valid Gemini API key is required.');
  }

  const trimmedKey = key.trim();

  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: {
      action: 'save_key',
      key: trimmedKey
    }
  });

  if (error) {
    const message = await extractErrorMessage(error, 'Failed to save Gemini API key');
    throw new Error(message);
  }

  return {
    connected: Boolean(data?.connected),
    last4: data?.last4 || trimmedKey.slice(-4)
  };
}

/**
 * Removes the saved Gemini key for the active user.
 * @returns {Promise<{ connected: boolean, last4: null }>}
 */
export async function aiRemoveKey() {
  if (!isConfigured || !supabase || isGuestMode()) {
    return { connected: false, last4: null };
  }

  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { action: 'remove_key' }
  });

  if (error) {
    const message = await extractErrorMessage(error, 'Failed to remove Gemini API key');
    throw new Error(message);
  }

  return {
    connected: false,
    last4: null
  };
}

/**
 * Calls Gemini via the ai-proxy Edge Function with structured JSON output.
 * Currently supports task "ping".
 * 
 * @param {string} task - e.g. "ping"
 * @param {Record<string, any>} [payload={}] - Additional context or data
 * @returns {Promise<any>} Parsed JSON response from Gemini
 */
export async function aiGenerate(task, payload = {}) {
  if (!isConfigured || !supabase || isGuestMode()) {
    throw new Error('Please sign in to use AI features.');
  }

  if (!task || typeof task !== 'string') {
    throw new Error('An AI task name is required.');
  }

  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: {
      action: 'generate',
      task,
      payload
    }
  });

  if (error) {
    const message = await extractErrorMessage(error, 'AI generation request failed');
    throw new Error(message);
  }

  return data;
}
