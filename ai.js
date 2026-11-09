// ai.js - Client-side AI proxy integration
// Handles secure Gemini key status, validation, deletion, and structured JSON generation.
// SECURITY GUARANTEE: The API key is NEVER stored in localStorage, sessionStorage, or cached client-side.

import { supabase, isConfigured } from "./supabase-config.js";
import { isGuestMode } from "./auth.js";

/**
 * Extracts a readable error message from a Supabase FunctionsHttpError.
 */
async function extractErrorMessage(error, defaultMsg = 'AI service request failed') {
  if (!error) return defaultMsg;
  try {
    if (error.context && typeof error.context.json === 'function') {
      const errBody = await error.context.json();
      if (errBody?.error) return errBody.error;
    }
  } catch (_) {
    // Fall back to standard error message
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
