/**
 * ProgressShelf AI Assistant UI Module
 * Handles the conversational assistant drawer panel, Connect Gemini flow, AI Settings modal,
 * full card awareness, and interactive Shared Confirmation Sheets for create, update, breakdown, and delete.
 */

import { isGuestMode, exitGuestMode, loginWithGoogle } from "./auth.js?v=3.3";
import { aiStatus, aiSaveKey, aiRemoveKey, aiGenerate } from "./ai.js?v=4.0";

export let isAssistantPanelOpen = false;
export function isAssistantOpen() {
  return isAssistantPanelOpen;
}

let currentAiStatus = null;
let isGenerating = false;
let attachedImage = null; // { name: string, mimeType: string, data: string, dataUrl: string } | null
let threadHtml = ''; // Preserves conversation history while panel is open
let conversationHistory = []; // [{ role: 'user' | 'model', text: string }]
let activeSessionId = null;

const STORAGE_KEY_HISTORY_ENABLED = 'ps_ai_save_history';
const STORAGE_KEY_CHAT_SESSIONS = 'ps_ai_chat_sessions';

export function isAiHistoryEnabled() {
  return localStorage.getItem(STORAGE_KEY_HISTORY_ENABLED) === 'true';
}

export function setAiHistoryEnabled(enabled) {
  localStorage.setItem(STORAGE_KEY_HISTORY_ENABLED, enabled ? 'true' : 'false');
}

/**
 * Strips base64/data-URL images from HTML to keep chat history lightweight and prevent storage overflow.
 * Replaces user image tags with an elegant [Attached image] pill.
 * @param {string} html
 * @returns {string}
 */
export function stripImagesFromThreadHtml(html) {
  if (!html || typeof html !== 'string') return '';
  let clean = html.replace(/<img[^>]*class=["'][^"']*assistant-msg-user-img[^"']*["'][^>]*>/gi, () => {
    return `<div class="assistant-msg-attachment-pill" title="Image was attached (not stored in history)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
        <circle cx="9" cy="9" r="2"/>
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
      </svg>
      <span>Attached image</span>
    </div>`;
  });
  clean = clean.replace(/src=["']data:image\/[^"']+["']/gi, 'src=""');
  return clean;
}

export function getChatSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHAT_SESSIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    let mutated = false;
    const sanitized = parsed.map(s => {
      if (!s) return s;
      if (s.threadHtml && s.threadHtml.includes('data:image/')) {
        s.threadHtml = stripImagesFromThreadHtml(s.threadHtml);
        mutated = true;
      }
      if (Array.isArray(s.history)) {
        s.history = s.history.map(h => {
          if (h && typeof h.text === 'string' && h.text.startsWith('data:image')) {
            mutated = true;
            return { ...h, text: '[Attached image]' };
          }
          return h;
        });
      }
      return s;
    });
    if (mutated) {
      try {
        localStorage.setItem(STORAGE_KEY_CHAT_SESSIONS, JSON.stringify(sanitized));
      } catch (_) {}
    }
    return sanitized;
  } catch (_) {
    return [];
  }
}

export function saveChatSessions(sessions) {
  try {
    const sanitized = Array.isArray(sessions) ? sessions.map(s => {
      const cleanSession = { ...s };
      if (cleanSession.threadHtml) {
        cleanSession.threadHtml = stripImagesFromThreadHtml(cleanSession.threadHtml);
      }
      if (Array.isArray(cleanSession.history)) {
        cleanSession.history = cleanSession.history.map(h => ({
          role: h.role,
          text: (typeof h.text === 'string' && h.text.startsWith('data:image')) ? '[Attached image]' : (h.text || '')
        }));
      }
      return cleanSession;
    }) : [];
    localStorage.setItem(STORAGE_KEY_CHAT_SESSIONS, JSON.stringify(sanitized));
  } catch (e) {
    console.warn('[Assistant] Failed to save chat sessions:', e);
  }
}

export function clearAllChatSessions() {
  localStorage.removeItem(STORAGE_KEY_CHAT_SESSIONS);
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function normalizeAiDeadline(deadlineStr) {
  if (!deadlineStr || typeof deadlineStr !== 'string') return null;
  const trimmed = deadlineStr.trim();
  if (!trimmed) return null;

  // Case A: Pure date string "YYYY-MM-DD" -> defaults to 11:59:59 PM (end of that date)
  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, yyyy, mm, dd] = dateOnlyMatch;
    const localD = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 23, 59, 59, 999);
    return localD.getTime();
  }

  // Case B: Time only "HH:MM" or "HH:MM:SS" -> defaults to today at that time
  const timeOnlyMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeOnlyMatch) {
    const [, hh, min, ss] = timeOnlyMatch;
    const today = new Date();
    today.setHours(Number(hh), Number(min), ss ? Number(ss) : 0, 0);
    return today.getTime();
  }

  // Case C: DateTime string with 00:00:00 (midnight at start of day)
  // Per requirement: day starts at 12:00 AM and ends at 11:59 PM.
  // When AI specifies a date deadline that starts at 00:00, convert it to the last moment of that date (23:59:59).
  const startOfDayMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T00:00(?::00(?:\.000)?)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (startOfDayMatch) {
    const [, yyyy, mm, dd] = startOfDayMatch;
    const localD = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 23, 59, 59, 999);
    return localD.getTime();
  }

  // Case D: Standard ISO string or timestamp with specific time
  const parsed = new Date(trimmed).getTime();
  if (!isNaN(parsed)) {
    return parsed;
  }

  return null;
}

let deps = {
  closeAllMenus: () => {},
  openModal: () => {},
  showToast: () => {},
  escapeHtml: (s) => safeEscapeHtml(s),
  handleCreateBarFromAi: async () => {},
  handleEditBarFromAi: async () => {},
  handleDeleteBarFromAi: async () => {},
  getLiveBars: () => [],
  getUserId: () => null,
  getUserFirstName: () => '',
  updateUserSettings: async () => {},
  getUserSettings: async () => ({}),
  onHomeBriefingVisibilityChanged: () => {}
};

function getActiveUserFirstName() {
  function clean(raw) {
    if (typeof raw !== 'string') return '';
    let s = raw.trim().split(/\s+/)[0] || '';
    if (s.includes('@')) {
      s = s.split('@')[0].replace(/[0-9_.-]+$/g, '');
    }
    if (s && s.toLowerCase() !== 'guest' && s.toLowerCase() !== 'tracker user' && s.toLowerCase() !== 'tracker') {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    return '';
  }
  if (typeof deps.getUserFirstName === 'function') {
    const fn = deps.getUserFirstName();
    const cleaned = clean(fn);
    if (cleaned) return cleaned;
  }
  const profileEl = document.getElementById('profile-name');
  if (profileEl && profileEl.textContent) {
    const fromEl = clean(profileEl.textContent);
    if (fromEl) return fromEl;
  }
  return '';
}

function getTimeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getPersonalizedGreetingHeadline(rawHeadline) {
  const name = getActiveUserFirstName();
  const timeGreeting = getTimeOfDayGreeting();
  const defaultBase = 'Keep track of your active goals and daily habits right here.';

  if (!rawHeadline || rawHeadline.trim() === 'Keep track of your active goals and daily habits right here.' || rawHeadline.trim() === 'Here is your progress breakdown for today:') {
    return name ? `${timeGreeting}, ${name}! ${defaultBase}` : `${timeGreeting}! ${defaultBase}`;
  }

  // If the headline already contains the user's name, return as is
  if (name && rawHeadline.toLowerCase().includes(name.toLowerCase())) {
    return rawHeadline;
  }

  // If the headline starts with a greeting like "Good morning", "Hi", "Hello", inject name
  const greetingRegex = /^(Good morning|Good afternoon|Good evening|Hi|Hello|Hey)(?: there)?([!,.]?\s*)/i;
  if (name && greetingRegex.test(rawHeadline)) {
    return rawHeadline.replace(greetingRegex, `${timeGreeting}, ${name}! `);
  }

  // If no greeting at all and user has a name, prepend greeting
  if (name && !/^(Good|Hi|Hello|Hey)\b/i.test(rawHeadline)) {
    return `${timeGreeting}, ${name}! ${rawHeadline}`;
  }

  return rawHeadline;
}

function safeEscapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeHtml(str) {
  return deps.escapeHtml ? deps.escapeHtml(str) : safeEscapeHtml(str);
}

function closeAllMenus() {
  if (typeof deps.closeAllMenus === "function") {
    deps.closeAllMenus();
  } else if (typeof window.closeAllMenus === "function") {
    window.closeAllMenus();
  }
}

function openModal(modal) {
  if (typeof deps.openModal === "function") {
    deps.openModal(modal);
  } else if (typeof window.openModal === "function") {
    window.openModal(modal);
  }
}

function showToast(msg, type) {
  if (typeof deps.showToast === "function") {
    deps.showToast(msg, type);
  } else if (typeof window.showToast === "function") {
    window.showToast(msg, type);
  }
}

/**
 * Lightweight safe markdown-to-HTML parser for conversational replies.
 */
function renderMarkdownText(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);

  // Bold: **text** or __text__
  let formatted = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/__(.*?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
  formatted = formatted.replace(/_(.*?)_/g, '<em>$1</em>');

  // Inline code: `code`
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Line breaks & paragraphs / lists
  const lines = formatted.split('\n');
  let result = '';
  let inList = false;

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) {
        result += '<ul>';
        inList = true;
      }
      result += `<li>${trimmed.substring(2)}</li>`;
    } else if (/^\d+\.\s/.test(trimmed)) {
      if (!inList) {
        result += '<ol>';
        inList = true;
      }
      result += `<li>${trimmed.replace(/^\d+\.\s/, '')}</li>`;
    } else {
      if (inList) {
        result += '</ul>';
        inList = false;
      }
      if (trimmed.length > 0) {
        result += `<p>${trimmed}</p>`;
      }
    }
  }

  if (inList) result += '</ul>';
  return result;
}

export function formatAiErrorMessage(err) {
  if (!navigator.onLine) {
    return 'You appear to be offline. Check your network connection.';
  }
  const rawMsg = (err && err.message) ? String(err.message).trim() : 'AI service request failed';
  const lower = rawMsg.toLowerCase();
  if (lower.includes('free-tier') || lower.includes('free_tier') || (lower.includes('quota') && lower.includes('used up')) || (lower.includes('quota') && lower.includes('exceeded'))) {
    return 'Your Gemini free-tier quota is used up for now. It usually resets daily. Try again later or use another key.';
  }
  if (lower.includes('rate limit') || lower.includes('rate_limit') || lower.includes('too many requests') || lower.includes('429') || lower.includes('hourly')) {
    return 'Rate limit exceeded: maximum 30 AI calls per hour. Please try again later.';
  }
  if (lower.includes('invalid key') || lower.includes('invalid api key') || lower.includes('api_key_invalid') || lower.includes('api key not valid')) {
    return 'Invalid Gemini API key. Check your key in Google AI Studio.';
  }
  if (lower.includes('non-2xx') || lower.includes('edge function returned a non-2xx')) {
    return 'The AI service encountered an error processing your request. Please try again.';
  }
  return rawMsg;
}

export function renderSkeletonAssistant() {
  const container = document.getElementById('assistant-content');
  if (!container) return;
  container.innerHTML = `
    <div class="assistant-state-panel assistant-connected-view">
      <div class="assistant-connected-header">
        <div class="assistant-connected-badge assistant-skeleton" style="width: 90px; height: 24px; border-radius: 12px;"></div>
        <div class="assistant-skeleton" style="width: 70px; height: 24px; border-radius: 6px;"></div>
      </div>
      <div id="assistant-daily-briefing-wrap" class="assistant-daily-briefing-wrap">
        <div class="briefing-skeleton-card">
          <div class="briefing-skeleton-row">
            <div class="briefing-skeleton-line" style="width: 110px; height: 18px;"></div>
            <div class="briefing-skeleton-line" style="width: 24px; height: 24px; border-radius: 6px;"></div>
          </div>
          <div class="briefing-skeleton-line" style="width: 90%; height: 16px;"></div>
          <div class="briefing-skeleton-line" style="width: 75%; height: 14px;"></div>
        </div>
      </div>
    </div>
  `;
}

/* ==========================================================================
   DAILY BRIEFING / TODAY'S FOCUS MODULE
   ========================================================================== */

export const STORAGE_KEY_DAILY_BRIEFING = 'progressshelf_assistant_daily_briefing';
let cachedDailyBriefing = null;
let isFetchingBriefing = false;
let isBriefingExpandedInChat = false;
let triggerSubmitPrompt = null;

export function getTodayLocalDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function computeCardsHash(bars) {
  if (!Array.isArray(bars) || bars.length === 0) return 'empty';
  const tokens = bars.map(b => {
    const id = b.id || '';
    const title = b.title || '';
    const prog = `${b.currentSmallest ?? ''}/${b.targetSmallest ?? ''}`;
    const comp = b.completed ? '1' : '0';
    const dead = b.deadlineAt || '';
    const rep = b.repeat || '';
    const upd = b.updatedAt || '';
    return `${id}:${title}:${prog}:${comp}:${dead}:${rep}:${upd}`;
  });
  return tokens.sort().join('|');
}

export function getCachedBriefing() {
  if (cachedDailyBriefing && cachedDailyBriefing.data) {
    return cachedDailyBriefing;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DAILY_BRIEFING);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data) {
        cachedDailyBriefing = parsed;
        return parsed;
      }
    }
  } catch (_) {}
  return null;
}

export function saveCachedBriefing(cacheObj) {
  cachedDailyBriefing = cacheObj;
  try {
    localStorage.setItem(STORAGE_KEY_DAILY_BRIEFING, JSON.stringify(cacheObj));
  } catch (_) {}

  try {
    const uid = deps.getUserId ? deps.getUserId() : null;
    if (uid && typeof deps.updateUserSettings === 'function') {
      deps.updateUserSettings(uid, { daily_briefing: cacheObj }).catch(err => {
        console.warn('[Assistant] Failed to sync briefing to Supabase settings:', err);
      });
    }
  } catch (_) {}
}

export const STORAGE_KEY_HIDE_HOME_BRIEFING = 'progressshelf_hide_home_briefing';
export const STORAGE_KEY_DISMISS_GUEST_AI_CARD = 'progressshelf_dismiss_guest_ai_card';
export const STORAGE_KEY_DISMISS_UNCONFIGURED_AI_CARD = 'progressshelf_dismiss_unconfigured_ai_card';

export function isGuestAiCardDismissed() {
  return localStorage.getItem(STORAGE_KEY_DISMISS_GUEST_AI_CARD) === 'true';
}

export function setGuestAiCardDismissed(dismissed) {
  if (dismissed) {
    localStorage.setItem(STORAGE_KEY_DISMISS_GUEST_AI_CARD, 'true');
  } else {
    localStorage.removeItem(STORAGE_KEY_DISMISS_GUEST_AI_CARD);
  }
  if (typeof deps.onHomeBriefingVisibilityChanged === 'function') {
    deps.onHomeBriefingVisibilityChanged();
  }
}

export function isUnconfiguredAiCardDismissed() {
  return localStorage.getItem(STORAGE_KEY_DISMISS_UNCONFIGURED_AI_CARD) === 'true';
}

export function setUnconfiguredAiCardDismissed(dismissed) {
  if (dismissed) {
    localStorage.setItem(STORAGE_KEY_DISMISS_UNCONFIGURED_AI_CARD, 'true');
  } else {
    localStorage.removeItem(STORAGE_KEY_DISMISS_UNCONFIGURED_AI_CARD);
  }
  if (typeof deps.onHomeBriefingVisibilityChanged === 'function') {
    deps.onHomeBriefingVisibilityChanged();
  }
}

export function isHomeBriefingHidden() {
  return localStorage.getItem(STORAGE_KEY_HIDE_HOME_BRIEFING) === 'true';
}

export function setHomeBriefingHidden(hidden) {
  localStorage.setItem(STORAGE_KEY_HIDE_HOME_BRIEFING, hidden ? 'true' : 'false');
  try {
    const uid = deps.getUserId ? deps.getUserId() : null;
    if (uid && typeof deps.updateUserSettings === 'function') {
      deps.updateUserSettings(uid, { hide_home_briefing: hidden }).catch(err => {
        console.warn('[Assistant] Failed to sync hide_home_briefing setting:', err);
      });
    }
  } catch (_) {}

  if (typeof deps.onHomeBriefingVisibilityChanged === 'function') {
    deps.onHomeBriefingVisibilityChanged();
  }
}

export function setHomeBriefingHiddenFromRemote(hidden) {
  if (hidden === undefined || hidden === null) return;
  const current = isHomeBriefingHidden();
  if (current !== Boolean(hidden)) {
    localStorage.setItem(STORAGE_KEY_HIDE_HOME_BRIEFING, hidden ? 'true' : 'false');
    if (typeof deps.onHomeBriefingVisibilityChanged === 'function') {
      deps.onHomeBriefingVisibilityChanged();
    }
  }
}

export function setCachedBriefingFromSupabase(remoteBriefing) {
  if (!remoteBriefing || !remoteBriefing.data || !remoteBriefing.date) return;
  const local = getCachedBriefing();
  if (!local || (remoteBriefing.updatedAt && (!local.updatedAt || remoteBriefing.updatedAt > local.updatedAt))) {
    cachedDailyBriefing = remoteBriefing;
    try {
      localStorage.setItem(STORAGE_KEY_DAILY_BRIEFING, JSON.stringify(remoteBriefing));
    } catch (_) {}

    const wrap = document.getElementById('assistant-daily-briefing-wrap');
    if (wrap) {
      const activeNow = Boolean(threadHtml && threadHtml.trim().length > 0);
      renderBriefingContainer(wrap, remoteBriefing.data, remoteBriefing.updatedAt, activeNow);
    }

    const homeCard = document.getElementById('home-daily-briefing-card');
    if (homeCard && !isHomeBriefingHidden()) {
      getHomeBriefingCardElement();
    }
  }
}

export function isBriefingValid(cached, currentBars) {
  if (!cached || !cached.data || !cached.date) return false;
  if (cached.date !== getTodayLocalDateStr()) return false;
  const expectedHash = computeCardsHash(currentBars);
  if (cached.cardHash !== expectedHash) return false;
  return true;
}

function formatBriefingTime(timestamp) {
  if (!timestamp) return '';
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function getBriefingBadgeClass(badge) {
  const b = (badge || '').toLowerCase();
  if (b.includes('habit')) return 'badge-habit';
  if (b.includes('overdue')) return 'badge-overdue';
  if (b.includes('urgent') || b.includes('today')) return 'badge-urgent';
  return 'badge-default';
}

function renderBriefingFullCardMarkup(data, updatedAt) {
  const timeStr = formatBriefingTime(updatedAt);
  const headline = getPersonalizedGreetingHeadline(data.headline);
  const priorities = Array.isArray(data.priorities) ? data.priorities : [];
  const pills = Array.isArray(data.actionPills) ? data.actionPills : [];

  let prioritiesHtml = '';
  if (priorities.length > 0) {
    prioritiesHtml = `
      <div class="briefing-priorities-list">
        ${priorities.map(p => {
          const badgeClass = getBriefingBadgeClass(p.badge);
          const badgeMarkup = p.badge ? `<span class="briefing-priority-badge ${badgeClass}">${escapeHtml(p.badge)}</span>` : '';
          return `
            <div class="briefing-priority-item">
              ${badgeMarkup}
              <div class="briefing-priority-text">
                <span class="briefing-priority-title">${escapeHtml(p.title || '')}</span>
                ${p.detail ? `<span class="briefing-priority-detail">${escapeHtml(p.detail)}</span>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  let pillsHtml = '';
  if (pills.length > 0) {
    pillsHtml = `
      <div class="briefing-pills-row">
        ${pills.map(pill => `
          <button type="button" class="briefing-action-pill" data-action="${escapeHtml(pill)}">
            <span>✦</span>
            <span>${escapeHtml(pill)}</span>
          </button>
        `).join('')}
      </div>
    `;
  }

  return `
    <div class="daily-briefing-card">
      <div class="briefing-header">
        <div class="briefing-title-wrap">
          <svg class="briefing-sparkle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
          </svg>
          <span class="briefing-title">Today's Focus</span>
          ${timeStr ? `<span class="briefing-timestamp">· ${timeStr}</span>` : ''}
        </div>
        <button type="button" class="btn-briefing-refresh ${isFetchingBriefing ? 'spinning' : ''}" title="Refresh Today's Breakdown">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
        </button>
      </div>
      <p class="briefing-headline">${escapeHtml(headline)}</p>
      ${prioritiesHtml}
      ${pillsHtml}
    </div>
  `;
}

function renderBriefingCollapsedMarkup(data, updatedAt) {
  const priorities = Array.isArray(data.priorities) ? data.priorities : [];
  const count = priorities.length;
  const countText = count > 0 ? `${count} ${count === 1 ? 'priority' : 'priorities'}` : 'Up to date';

  return `
    <div class="briefing-collapsed-banner">
      <div class="briefing-collapsed-info">
        <svg class="briefing-sparkle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
        </svg>
        <span class="briefing-collapsed-text">Today's Focus: ${countText}</span>
      </div>
      <div class="briefing-collapsed-actions">
        <button type="button" class="btn-briefing-toggle" id="btn-briefing-toggle">
          ${isBriefingExpandedInChat ? 'Collapse ▴' : 'Expand ▾'}
        </button>
        <button type="button" class="btn-briefing-refresh ${isFetchingBriefing ? 'spinning' : ''}" title="Refresh Today's Breakdown">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
        </button>
      </div>
    </div>
    ${isBriefingExpandedInChat ? `<div class="briefing-expanded-drawer">${renderBriefingFullCardMarkup(data, updatedAt)}</div>` : ''}
  `;
}

function renderBriefingSkeletonMarkup() {
  return `
    <div class="briefing-skeleton-card">
      <div class="briefing-skeleton-row">
        <div class="briefing-skeleton-line" style="width: 120px; height: 18px;"></div>
        <div class="briefing-skeleton-line" style="width: 22px; height: 22px; border-radius: 6px;"></div>
      </div>
      <div class="briefing-skeleton-line" style="width: 90%; height: 16px;"></div>
      <div class="briefing-skeleton-line" style="width: 75%; height: 14px;"></div>
      <div style="display: flex; gap: 6px; margin-top: 4px;">
        <div class="briefing-skeleton-line" style="width: 80px; height: 24px; border-radius: 12px;"></div>
        <div class="briefing-skeleton-line" style="width: 95px; height: 24px; border-radius: 12px;"></div>
      </div>
    </div>
  `;
}

function attachBriefingListeners(wrap) {
  if (!wrap) return;

  wrap.querySelectorAll('.btn-briefing-refresh').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      fetchAndRenderDailyBriefing(true);
    });
  });

  const toggleBtn = wrap.querySelector('#btn-briefing-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isBriefingExpandedInChat = !isBriefingExpandedInChat;
      const cached = getCachedBriefing();
      if (cached && cached.data) {
        renderBriefingContainer(wrap, cached.data, cached.updatedAt, Boolean(threadHtml && threadHtml.trim().length > 0));
      }
    });
  }

  wrap.querySelectorAll('.briefing-action-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const actionText = pill.getAttribute('data-action') || pill.textContent.trim().replace(/^✦\s*/, '');
      const textarea = document.getElementById('assistant-input');
      if (textarea && actionText) {
        textarea.value = actionText;
        updateAssistantControlsState();
        if (typeof triggerSubmitPrompt === 'function') {
          triggerSubmitPrompt();
        } else {
          const sendBtn = document.getElementById('btn-assistant-send');
          if (sendBtn) sendBtn.click();
        }
      }
    });
  });
}

function renderBriefingContainer(wrap, data, updatedAt, isChatActive) {
  if (!wrap) return;
  if (isChatActive) {
    wrap.innerHTML = renderBriefingCollapsedMarkup(data, updatedAt);
  } else {
    wrap.innerHTML = renderBriefingFullCardMarkup(data, updatedAt);
  }
  attachBriefingListeners(wrap);
}

export function updateBriefingDisplayMode(isChatActive) {
  const wrap = document.getElementById('assistant-daily-briefing-wrap');
  if (!wrap) return;
  const cached = getCachedBriefing();
  if (cached && cached.data) {
    renderBriefingContainer(wrap, cached.data, cached.updatedAt, isChatActive);
  }
}

export async function fetchAndRenderDailyBriefing(forceRefresh = false) {
  const wrap = document.getElementById('assistant-daily-briefing-wrap');
  const homeCard = document.getElementById('home-daily-briefing-card');

  // If neither wrap nor homeCard is in the DOM, nothing to render
  if (!wrap && !homeCard) return;

  if (isGuestMode() || !currentAiStatus || !currentAiStatus.connected) {
    if (wrap) wrap.innerHTML = '';
    if (homeCard) getHomeBriefingCardElement();
    return;
  }

  // If initial bars have not yet loaded from remote database, wait for realtime sync to deliver them
  if (typeof deps.hasInitialBarsLoaded === 'function' && !deps.hasInitialBarsLoaded() && !isGuestMode()) {
    return;
  }

  const currentBars = typeof deps.getLiveBars === 'function' ? deps.getLiveBars() : [];
  const isChatActive = Boolean(threadHtml && threadHtml.trim().length > 0);

  if (!forceRefresh) {
    const cached = getCachedBriefing();
    if (cached && isBriefingValid(cached, currentBars)) {
      if (wrap) renderBriefingContainer(wrap, cached.data, cached.updatedAt, isChatActive);
      if (homeCard) getHomeBriefingCardElement();
      return;
    }
  }

  if (isFetchingBriefing) return;
  isFetchingBriefing = true;

  if (wrap) {
    const existingCard = wrap.querySelector('.daily-briefing-card, .briefing-collapsed-banner');
    if (!existingCard) {
      wrap.innerHTML = renderBriefingSkeletonMarkup();
    }
  }
  if (homeCard) {
    const existingCard = homeCard.querySelector('.home-briefing-header');
    if (!existingCard) {
      homeCard.className = 'card-home-briefing card-home-briefing-skeleton';
      homeCard.innerHTML = renderBriefingSkeletonMarkup();
    }
  }

  document.querySelectorAll('.btn-briefing-refresh').forEach(b => b.classList.add('spinning'));

  try {
    const cardsSummary = currentBars.map(b => ({
      title: b.title || 'Untitled',
      type: b.type || (b.repeat ? 'habit' : (b.checklist ? 'checklist' : 'tracker')),
      current: b.currentSmallest ?? b.current ?? 0,
      target: b.targetSmallest ?? b.target ?? 1,
      unit: b.unit || '',
      completed: Boolean(b.completed),
      deadlineAt: b.deadlineAt || null,
      isOverdue: Boolean(b.deadlineAt && new Date(b.deadlineAt) < new Date() && !b.completed),
      isHabit: Boolean(b.repeat),
      resetTime: b.resetTime || null
    }));

    const now = new Date();
    const timeContext = `Local User Time: ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, Date: ${now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}`;

    const activeFirstName = typeof getActiveUserFirstName === 'function' ? getActiveUserFirstName() : '';
    const result = await aiGenerate('daily_briefing', {
      cards: cardsSummary,
      timeContext: timeContext,
      firstName: activeFirstName || undefined,
      userFirstName: activeFirstName || undefined
    });

    if (result && (result.headline || Array.isArray(result.priorities))) {
      const cacheObj = {
        date: getTodayLocalDateStr(),
        cardHash: computeCardsHash(currentBars),
        updatedAt: Date.now(),
        data: {
          headline: result.headline || '',
          priorities: Array.isArray(result.priorities) ? result.priorities : [],
          actionPills: Array.isArray(result.actionPills) ? result.actionPills : []
        }
      };
      saveCachedBriefing(cacheObj);
      const activeNow = Boolean(threadHtml && threadHtml.trim().length > 0);
      if (wrap) {
        renderBriefingContainer(wrap, cacheObj.data, cacheObj.updatedAt, activeNow);
      }
      if (homeCard) {
        getHomeBriefingCardElement();
      }
    }
  } catch (err) {
    console.warn('[Assistant] Failed to fetch daily briefing:', err);
    const cached = getCachedBriefing();
    if (cached && cached.data) {
      if (wrap) renderBriefingContainer(wrap, cached.data, cached.updatedAt, isChatActive);
      if (homeCard) getHomeBriefingCardElement();
    } else {
      if (wrap) {
        wrap.innerHTML = `
          <div class="daily-briefing-card">
            <div class="briefing-header">
              <div class="briefing-title-wrap">
                <svg class="briefing-sparkle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                <span class="briefing-title">Today's Focus</span>
              </div>
              <button type="button" class="btn-briefing-refresh" title="Retry">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
              </button>
            </div>
            <p class="briefing-headline">Keep track of your active goals and daily habits right here.</p>
          </div>
        `;
        attachBriefingListeners(wrap);
      }
      if (homeCard) {
        getHomeBriefingCardElement();
      }
    }
  } finally {
    isFetchingBriefing = false;
    document.querySelectorAll('.btn-briefing-refresh').forEach(b => b.classList.remove('spinning'));
  }
}

/**
 * Returns the DOM element for the AI card on the home dashboard.
 * Supports 3 states:
 * 1. Guest user: asks user to sign in via Google account (with dismiss cross).
 * 2. Logged-in user without Gemini key: asks user to connect key (with dismiss cross).
 * 3. Logged-in user with active Gemini key: fully functional Today's Focus card (exact copy
 *    from assistant drawer, with refresh, pills, and cross button that turns off Today's Focus and lets them know).
 */
export function getHomeBriefingCardElement() {
  let el = document.getElementById('home-daily-briefing-card');
  if (!el) {
    el = document.createElement('div');
    el.id = 'home-daily-briefing-card';
  }

  // -------------------------------------------------------------
  // STATE 1: Guest User (not signed in / guest mode)
  // -------------------------------------------------------------
  const isGuest = isGuestMode() || !deps.getUserId || !deps.getUserId();
  if (isGuest) {
    if (isGuestAiCardDismissed()) {
      if (el.parentNode) el.remove();
      return null;
    }

    el.className = 'card-progress card-home-briefing card-home-ai-guest';
    el.innerHTML = `
      <div class="home-briefing-header">
        <div class="home-briefing-title-wrap" role="button" tabindex="0" title="Sign in to unlock AI">
          <svg class="briefing-sparkle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
          </svg>
          <span class="briefing-title">Unlock AI Assistant</span>
        </div>
        <button type="button" class="btn-home-briefing-hide" title="Dismiss card" aria-label="Dismiss card">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <p class="briefing-headline">Sign in with Google to get daily focus breakdowns, smart habit recommendations, and AI card management.</p>
      <div class="home-briefing-cta-footer">
        <button type="button" class="btn btn-primary btn-sm btn-home-login-google">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink: 0;">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
          </svg>
          <span>Sign in with Google</span>
        </button>
      </div>
    `;

    const hideBtn = el.querySelector('.btn-home-briefing-hide');
    if (hideBtn) {
      hideBtn.onclick = (e) => {
        e.stopPropagation();
        setGuestAiCardDismissed(true);
        showUndoToast({
          message: "AI card dismissed.",
          onUndo: () => setGuestAiCardDismissed(false),
          duration: 7000
        });
      };
    }

    const loginBtn = el.querySelector('.btn-home-login-google');
    const titleWrap = el.querySelector('.home-briefing-title-wrap');
    const handleLogin = (e) => {
      e.stopPropagation();
      loginWithGoogle();
    };
    if (loginBtn) loginBtn.onclick = handleLogin;
    if (titleWrap) titleWrap.onclick = handleLogin;

    return el;
  }

  // -------------------------------------------------------------
  // STATE 2: Logged-in user without Gemini API key
  // -------------------------------------------------------------
  const isAiConnected = !!(currentAiStatus && currentAiStatus.connected);
  if (!isAiConnected) {
    if (isUnconfiguredAiCardDismissed()) {
      if (el.parentNode) el.remove();
      return null;
    }

    el.className = 'card-progress card-home-briefing card-home-ai-unconfigured';
    el.innerHTML = `
      <div class="home-briefing-header">
        <div class="home-briefing-title-wrap" role="button" tabindex="0" title="Connect Gemini Key">
          <svg class="briefing-sparkle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
          </svg>
          <span class="briefing-title">Activate AI Companion</span>
        </div>
        <button type="button" class="btn-home-briefing-hide" title="Dismiss card" aria-label="Dismiss card">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <p class="briefing-headline">Connect your free Gemini API key to activate daily focus breakdowns, habit tracking, and goal planning.</p>
      <div class="home-briefing-cta-footer">
        <button type="button" class="btn btn-primary btn-sm btn-home-connect-key">
          <span>Connect Gemini Key</span>
        </button>
      </div>
    `;

    const hideBtn = el.querySelector('.btn-home-briefing-hide');
    if (hideBtn) {
      hideBtn.onclick = (e) => {
        e.stopPropagation();
        setUnconfiguredAiCardDismissed(true);
        showUndoToast({
          message: "AI card dismissed.",
          onUndo: () => setUnconfiguredAiCardDismissed(false),
          duration: 7000
        });
      };
    }

    const connectBtn = el.querySelector('.btn-home-connect-key');
    const titleWrap = el.querySelector('.home-briefing-title-wrap');
    const handleConnect = (e) => {
      e.stopPropagation();
      openAiSettingsModal();
    };
    if (connectBtn) connectBtn.onclick = handleConnect;
    if (titleWrap) titleWrap.onclick = handleConnect;

    return el;
  }

  // -------------------------------------------------------------
  // STATE 3: Signed in + Gemini active -> Today's Focus Card
  // -------------------------------------------------------------
  if (isHomeBriefingHidden()) {
    if (el.parentNode) el.remove();
    return null;
  }

  const cached = getCachedBriefing();
  const currentBars = typeof deps.getLiveBars === 'function' ? deps.getLiveBars() : [];

  if (!cached || !isBriefingValid(cached, currentBars)) {
    if (!isFetchingBriefing) {
      const hasLoaded = typeof deps.hasInitialBarsLoaded !== 'function' || deps.hasInitialBarsLoaded();
      if (hasLoaded) {
        setTimeout(() => {
          fetchAndRenderDailyBriefing(false);
        }, 50);
      }
    }
  }

  if (isFetchingBriefing && (!cached || !cached.data)) {
    el.className = 'card-progress card-home-briefing card-home-briefing-skeleton';
    el.innerHTML = renderBriefingSkeletonMarkup();
    return el;
  }

  const data = cached && cached.data ? cached.data : {
    headline: "Keep track of your active goals and daily habits right here.",
    priorities: [],
    actionPills: ["Plan my day", "Clean up overdue", "Break down a goal"]
  };
  const timeStr = formatBriefingTime(cached ? cached.updatedAt : null);

  el.className = 'card-progress card-home-briefing card-home-briefing-active';
  const priorities = Array.isArray(data.priorities) ? data.priorities : [];
  const pills = Array.isArray(data.actionPills) ? data.actionPills : [];

  let prioritiesHtml = '';
  if (priorities.length > 0) {
    prioritiesHtml = `
      <div class="briefing-priorities-list">
        ${priorities.slice(0, 3).map(p => {
          const badgeClass = getBriefingBadgeClass(p.badge);
          const badgeMarkup = p.badge ? `<span class="briefing-priority-badge ${badgeClass}">${escapeHtml(p.badge)}</span>` : '';
          return `
            <div class="briefing-priority-item">
              ${badgeMarkup}
              <div class="briefing-priority-text">
                <span class="briefing-priority-title">${escapeHtml(p.title || '')}</span>
                ${p.detail ? `<span class="briefing-priority-detail">${escapeHtml(p.detail)}</span>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  let pillsHtml = '';
  if (pills.length > 0) {
    pillsHtml = `
      <div class="home-briefing-actions-panel">
        <div class="home-briefing-actions-header">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
          </svg>
          <span>QUICK ACTIONS</span>
        </div>
        <div class="briefing-pills-col">
          ${pills.map(pill => `
            <button type="button" class="briefing-action-pill" data-action="${escapeHtml(pill)}">
              <span class="pill-sparkle">✦</span>
              <span class="pill-label">${escapeHtml(pill)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="home-briefing-header">
      <div class="home-briefing-title-wrap" role="button" tabindex="0" title="Open AI Assistant">
        <svg class="briefing-sparkle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
        </svg>
        <span class="briefing-title">Today's Focus</span>
        ${timeStr ? `<span class="briefing-timestamp">· ${timeStr}</span>` : ''}
        <span class="home-briefing-open-badge" title="Open AI Assistant">
          <span>AI</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>
        </span>
      </div>
      <div class="home-briefing-actions">
        <button type="button" class="btn-briefing-refresh ${isFetchingBriefing ? 'spinning' : ''}" title="Refresh Today's Focus">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
        </button>
        <button type="button" class="btn-home-briefing-hide" title="Turn off Today's Focus on dashboard" aria-label="Turn off Today's Focus on dashboard">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
    <div class="home-briefing-body">
      <div class="home-briefing-main-col">
        <p class="briefing-headline">${escapeHtml(getPersonalizedGreetingHeadline(data.headline))}</p>
        ${prioritiesHtml}
      </div>
      ${pillsHtml}
    </div>
  `;

  const titleWrap = el.querySelector('.home-briefing-title-wrap');
  if (titleWrap) {
    titleWrap.onclick = (e) => {
      e.stopPropagation();
      openAssistantPanel();
    };
  }

  const refreshBtn = el.querySelector('.btn-briefing-refresh');
  if (refreshBtn) {
    refreshBtn.onclick = (e) => {
      e.stopPropagation();
      fetchAndRenderDailyBriefing(true);
    };
  }

  const hideBtn = el.querySelector('.btn-home-briefing-hide');
  if (hideBtn) {
    hideBtn.onclick = (e) => {
      e.stopPropagation();
      setHomeBriefingHidden(true);
      showUndoToast({
        message: "Today's Focus turned off on dashboard. You can re-enable it in AI Settings.",
        onUndo: () => setHomeBriefingHidden(false),
        duration: 7000
      });
    };
  }

  el.querySelectorAll('.briefing-action-pill').forEach(pill => {
    pill.onclick = (e) => {
      e.stopPropagation();
      const actionText = pill.getAttribute('data-action') || pill.textContent.trim().replace(/^✦\s*/, '');
      openAssistantPanel();
      setTimeout(() => {
        executeBriefingPrompt(actionText);
      }, 150);
    };
  });

  return el;
}

/**
 * Updates the state of the chips, attach button, and send button
 * based on whether AI is connected, guest mode, and active input.
 */
function updateAssistantControlsState() {
  const isConnected = !!(currentAiStatus && currentAiStatus.connected && !isGuestMode());
  const chipPlan = document.getElementById('chip-plan-day');
  const chipClean = document.getElementById('chip-cleanup-overdue');
  const chipBreakdown = document.getElementById('chip-breakdown-goal');
  const chipMention = document.getElementById('chip-mention-card');
  const btnAttach = document.getElementById('btn-assistant-attach');
  const btnSend = document.getElementById('btn-assistant-send');
  const textarea = document.getElementById('assistant-input');

  const hasInput = textarea && textarea.value.trim().length > 0;
  const hasAttachment = attachedImage !== null;
  const hasCardContext = activeCardContext !== null;

  if (chipPlan) chipPlan.disabled = !isConnected || isGenerating;
  if (chipClean) chipClean.disabled = !isConnected || isGenerating;
  if (chipBreakdown) chipBreakdown.disabled = !isConnected || isGenerating;
  if (chipMention) chipMention.disabled = !isConnected || isGenerating;
  if (btnAttach) btnAttach.disabled = !isConnected || isGenerating;
  if (btnSend) {
    btnSend.disabled = !isConnected || isGenerating || (!hasInput && !hasAttachment && !hasCardContext);
  }
}

export async function renderAssistantState(status) {
  currentAiStatus = status;
  const container = document.getElementById('assistant-content');
  if (!container) return;

  // 1. Guest or Not Signed In
  if (isGuestMode()) {
    updateAssistantControlsState();
    container.innerHTML = `
      <div class="assistant-state-panel assistant-guest-state">
        <div class="assistant-state-icon-box">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        </div>
        <h3 class="assistant-state-title">Sign in to use AI</h3>
        <p class="assistant-state-desc">Connect your Google or email account to activate Gemini, chat about your goals, plan your day, and automate tracker updates.</p>
        <button id="btn-assistant-login-cta" class="btn btn-primary assistant-cta-btn" type="button">Sign in</button>
      </div>
    `;
    const loginBtn = document.getElementById('btn-assistant-login-cta');
    if (loginBtn) {
      loginBtn.addEventListener('click', async () => {
        try {
          loginBtn.style.pointerEvents = 'none';
          loginBtn.textContent = 'Signing in...';
          await loginWithGoogle();
        } catch (e) {
          console.error('Login from assistant CTA failed:', e);
          showToast('Authentication failed. Please try again.', 'error');
          loginBtn.style.pointerEvents = 'all';
          loginBtn.textContent = 'Sign in';
        }
      });
    }
    return;
  }

  // 2. Connected State
  if (status && status.connected) {
    updateAssistantControlsState();
    container.innerHTML = `
      <div class="assistant-state-panel assistant-connected-view">
        <div class="assistant-connected-header">
          <div class="assistant-connected-badge">
            <span class="assistant-connected-dot"></span>
            <span>Connected</span>
          </div>
          <button type="button" id="btn-assistant-open-settings" class="assistant-settings-link-btn" title="Open AI Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <span>Settings</span>
          </button>
        </div>

        <div id="assistant-daily-briefing-wrap" class="assistant-daily-briefing-wrap"></div>

        <div id="assistant-thread" class="assistant-thread">${threadHtml}</div>
      </div>
    `;

    const settingsBtn = document.getElementById('btn-assistant-open-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        openAiSettingsModal();
      });
    }

    fetchAndRenderDailyBriefing(false);
    attachThreadCardListeners();
    return;
  }

  // 3. Disconnected State - Connect Gemini Card
  updateAssistantControlsState();
  container.innerHTML = `
    <div class="assistant-state-panel assistant-connect-card">
      <div class="assistant-connect-header">
        <div class="assistant-connect-icon-box">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
          </svg>
        </div>
        <h3 class="assistant-connect-title">Connect Gemini</h3>
        <p class="assistant-connect-desc">Enter your Google Gemini API key to activate the assistant.</p>
      </div>

      <form id="assistant-connect-form" class="assistant-connect-form">
        <div class="assistant-key-field-wrap">
          <input type="password" id="assistant-key-input" class="assistant-key-input" placeholder="Enter Gemini API key" autocomplete="off" spellcheck="false" required>
          <button type="button" id="btn-assistant-toggle-key" class="assistant-key-eye-btn" title="Show or hide key" aria-label="Toggle key visibility">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
        </div>

        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" class="assistant-key-link">
          <span>Get an API key from Google AI Studio</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>

        <div id="assistant-connect-error" class="assistant-connect-error hidden" role="alert"></div>

        <button type="submit" id="btn-assistant-save-key" class="btn btn-primary assistant-save-btn">Save &amp; test</button>
      </form>

      <p class="assistant-notice">Your key is stored encrypted and used only to send your requests to Google. Card text and photos you send go to Google; avoid sensitive information. Remove your key anytime in AI settings.</p>
    </div>
  `;

  // Eye toggle for password visibility
  const keyInput = document.getElementById('assistant-key-input');
  const toggleEye = document.getElementById('btn-assistant-toggle-key');
  if (toggleEye && keyInput) {
    toggleEye.addEventListener('click', () => {
      const isPass = keyInput.type === 'password';
      keyInput.type = isPass ? 'text' : 'password';
      toggleEye.innerHTML = isPass
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="2" x2="23" y2="23"></line></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    });
  }

  // Connect form submission
  const form = document.getElementById('assistant-connect-form');
  const errorBox = document.getElementById('assistant-connect-error');
  const saveBtn = document.getElementById('btn-assistant-save-key');

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const keyVal = keyInput ? keyInput.value.trim() : '';
      if (!keyVal) {
        if (errorBox) {
          errorBox.textContent = 'A valid Gemini API key is required.';
          errorBox.classList.remove('hidden');
        }
        return;
      }

      if (errorBox) errorBox.classList.add('hidden');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Testing & saving...';
      }

      try {
        const saved = await aiSaveKey(keyVal);
        currentAiStatus = saved;
        await renderAssistantState(saved);
        showToast('Gemini API key connected successfully', 'success');
      } catch (err) {
        if (errorBox) {
          errorBox.textContent = formatAiErrorMessage(err);
          errorBox.classList.remove('hidden');
        }
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save & test';
        }
      }
    });
  }
}

export function renderAssistantErrorState(err) {
  const container = document.getElementById('assistant-content');
  if (!container) return;
  const isOffline = !navigator.onLine;
  const hint = isOffline ? 'You appear to be offline. Check your network connection.' : 'Please check your connection and try again.';
  container.innerHTML = `
    <div class="assistant-state-panel assistant-error-state">
      <div class="assistant-state-icon-box">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>
      <h3 class="assistant-state-title">Can't reach the AI service</h3>
      <p class="assistant-state-desc">${escapeHtml(hint)}</p>
      <button id="btn-assistant-retry" class="btn btn-primary assistant-cta-btn" type="button">Retry</button>
    </div>
  `;
  const retryBtn = document.getElementById('btn-assistant-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      fetchAndRenderAssistant(true);
    });
  }
}

export async function fetchAndRenderAssistant(showLoading = true) {
  if (isGuestMode()) {
    renderAssistantState({ connected: false, last4: null });
    return;
  }
  if (showLoading && !currentAiStatus) {
    renderSkeletonAssistant();
  }
  try {
    const status = await aiStatus();
    currentAiStatus = status;
    renderAssistantState(status);
  } catch (err) {
    console.warn('[Assistant] Status check error:', err);
    currentAiStatus = null;
    renderAssistantErrorState(err);
  }
}

let lastAssistantToggleTimestamp = 0;

export function openAssistantPanel() {
  const panel = document.getElementById('assistant-panel');
  if (isAssistantPanelOpen && panel && !panel.classList.contains('hidden')) return;
  isAssistantPanelOpen = true;
  closeAllMenus();

  const backdrop = document.getElementById('assistant-backdrop');
  const btn = document.getElementById('btn-assistant');
  const fabAi = document.getElementById('btn-fab-ai');

  if (backdrop) backdrop.classList.remove('hidden');
  if (panel) panel.classList.remove('hidden');
  if (btn) btn.classList.add('active');
  if (fabAi) fabAi.classList.add('active');

  fetchAndRenderAssistant();
}

export function closeAssistantPanel() {
  const panel = document.getElementById('assistant-panel');
  if (!isAssistantPanelOpen && panel && panel.classList.contains('hidden')) return;
  isAssistantPanelOpen = false;

  closeHistoryPane();

  const backdrop = document.getElementById('assistant-backdrop');
  const btn = document.getElementById('btn-assistant');
  const fabAi = document.getElementById('btn-fab-ai');

  if (backdrop) backdrop.classList.add('hidden');
  if (panel) panel.classList.add('hidden');
  if (btn) btn.classList.remove('active');
  if (fabAi) fabAi.classList.remove('active');
}

export function toggleAssistantPanel() {
  const now = Date.now();
  if (now - lastAssistantToggleTimestamp < 200) return;
  lastAssistantToggleTimestamp = now;

  const panel = document.getElementById('assistant-panel');
  const isCurrentlyHidden = panel ? panel.classList.contains('hidden') : !isAssistantPanelOpen;
  if (isCurrentlyHidden) {
    openAssistantPanel();
  } else {
    closeAssistantPanel();
  }
}

/* ==========================================================================
   CONVERSATION SESSIONS & HISTORY PANE
   ========================================================================== */

export function startNewConversation(options = { toast: true }) {
  activeSessionId = null;
  conversationHistory = [];
  threadHtml = '';

  const thread = document.getElementById('assistant-thread');
  if (thread) {
    thread.innerHTML = '';
  }

  isBriefingExpandedInChat = false;
  updateBriefingDisplayMode(false);

  const textarea = document.getElementById('assistant-input');
  if (textarea) {
    textarea.value = '';
    textarea.style.height = 'auto';
  }

  clearAttachment();
  hideCardSuggestions();
  closeHistoryPane();
  updateAssistantControlsState();

  if (options && options.toast) {
    showToast('Started new conversation', 'info');
  }
}

export function openHistoryPane() {
  const pane = document.getElementById('assistant-history-pane');
  const btn = document.getElementById('btn-assistant-history');
  if (!pane) return;
  pane.classList.remove('hidden');
  if (btn) btn.classList.add('active');
  renderHistoryPaneList();
}

export function closeHistoryPane() {
  const pane = document.getElementById('assistant-history-pane');
  const btn = document.getElementById('btn-assistant-history');
  if (pane) pane.classList.add('hidden');
  if (btn) btn.classList.remove('active');
}

export function toggleHistoryPane() {
  const pane = document.getElementById('assistant-history-pane');
  if (pane && !pane.classList.contains('hidden')) {
    closeHistoryPane();
  } else {
    openHistoryPane();
  }
}

export function renderHistoryPaneList() {
  const listContainer = document.getElementById('assistant-history-list');
  if (!listContainer) return;

  if (!isAiHistoryEnabled()) {
    listContainer.innerHTML = `
      <div class="assistant-history-notice-box">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted);">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 14 14"></polyline>
        </svg>
        <h4 class="assistant-history-notice-title">Chat history is turned off</h4>
        <p class="assistant-history-notice-desc">Enable chat history in AI Settings to keep a local record of your past conversations on this device.</p>
        <button type="button" id="btn-history-enable-settings" class="btn btn-primary btn-sm" style="margin-top: 6px;">Open AI Settings</button>
      </div>
    `;

    const openSettingsBtn = document.getElementById('btn-history-enable-settings');
    if (openSettingsBtn) {
      openSettingsBtn.addEventListener('click', () => {
        closeHistoryPane();
        openAiSettingsModal();
      });
    }
    return;
  }

  const sessions = getChatSessions();
  if (!sessions.length) {
    listContainer.innerHTML = `
      <div class="assistant-history-notice-box">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted);">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        <h4 class="assistant-history-notice-title">No past conversations</h4>
        <p class="assistant-history-notice-desc">Conversations you have with Assistant will appear here.</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = sessions.map(s => `
    <div class="assistant-history-item ${s.id === activeSessionId ? 'active' : ''}" data-session-id="${escapeHtml(s.id)}">
      <div class="assistant-history-item-body">
        <span class="assistant-history-item-title">${escapeHtml(s.title || 'Conversation')}</span>
        <span class="assistant-history-item-time">${formatRelativeTime(s.updatedAt || s.createdAt)}</span>
      </div>
      <button type="button" class="assistant-history-item-del" data-session-id="${escapeHtml(s.id)}" title="Delete chat" aria-label="Delete chat">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  `).join('');

  // Wire click to load session
  listContainer.querySelectorAll('.assistant-history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.assistant-history-item-del')) return;
      const sid = item.dataset.sessionId;
      const targetSession = sessions.find(s => s.id === sid);
      if (targetSession) {
        loadChatSession(targetSession);
      }
    });
  });

  // Wire click to delete session
  listContainer.querySelectorAll('.assistant-history-item-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sid = btn.dataset.sessionId;
      deleteChatSession(sid);
    });
  });
}

export function replaceExpiredProposals(html) {
  if (!html || typeof html !== 'string') return '';
  if (!html.includes('assistant-proposals-sheet') && !html.includes('assistant-confirm-card')) {
    return html;
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body><div id="__expired_wrap">${html}</div></body>`, 'text/html');
    const wrap = doc.getElementById('__expired_wrap');
    if (!wrap) return html;
    const sheets = wrap.querySelectorAll('.assistant-proposals-sheet, .assistant-confirm-card');
    sheets.forEach(sheet => {
      const note = doc.createElement('div');
      note.className = 'confirm-discarded-state assistant-proposal-expired';
      note.textContent = 'This proposal has expired. Ask again.';
      sheet.parentNode.replaceChild(note, sheet);
    });
    return wrap.innerHTML;
  } catch (_) {
    return html;
  }
}

export function loadChatSession(session) {
  if (!session) return;
  activeSessionId = session.id;
  conversationHistory = Array.isArray(session.history) ? [...session.history] : [];
  threadHtml = replaceExpiredProposals(stripImagesFromThreadHtml(session.threadHtml || ''));

  const thread = document.getElementById('assistant-thread');
  if (thread) {
    thread.innerHTML = threadHtml;
    attachThreadCardListeners();
  }

  isBriefingExpandedInChat = false;
  updateBriefingDisplayMode(Boolean(threadHtml && threadHtml.trim().length > 0));

  closeHistoryPane();
  scrollThreadToBottom();
  updateAssistantControlsState();
}

export function deleteChatSession(sessionId) {
  const sessions = getChatSessions().filter(s => s.id !== sessionId);
  saveChatSessions(sessions);
  if (activeSessionId === sessionId) {
    startNewConversation({ toast: false });
  }
  renderHistoryPaneList();
  showToast('Conversation removed from history', 'info');
}

/* ==========================================================================
   CONVERSATIONAL CHAT, CARD CONTEXT & SUGGESTIONS
   ========================================================================== */

function scrollThreadToBottom() {
  const content = document.getElementById('assistant-content');
  if (content) {
    content.scrollTop = content.scrollHeight;
    requestAnimationFrame(() => {
      content.scrollTop = content.scrollHeight;
    });
  }
}

// ---------------------------------------------------------------------------
// Card Context & @-Mention System
// ---------------------------------------------------------------------------
let activeCardContext = null;
let mentionPopoverSelectedIndex = 0;
let mentionFilteredCards = [];

function getCardIconSvg(type) {
  if (type === 'checklist') {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
  }
  if (type === 'note') {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
  }
  // goal / default
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`;
}

function getCardMetaText(card) {
  if (card.type === 'checklist') {
    const items = Array.isArray(card.items) ? card.items : [];
    const done = items.filter(i => i.done).length;
    return `Checklist • ${done}/${items.length} items`;
  }
  if (card.type === 'note') {
    return 'Note';
  }
  const curr = card.currentSmallest || card.current || 0;
  const target = card.targetSmallest || card.target || 100;
  const unit = card.levels?.[0]?.name || card.unit || '';
  return `Goal • ${curr}/${target}${unit ? ' ' + unit : ''}`;
}

function highlightMatchedText(text, query) {
  if (!query) return escapeHtml(text);
  const safeText = escapeHtml(text);
  const q = escapeHtml(query);
  const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return safeText.replace(regex, '<mark class="mention-highlight">$1</mark>');
}

export function setActiveCardContext(card) {
  activeCardContext = card;
  const wrap = document.getElementById('assistant-context-pill-wrap');
  const titleEl = document.getElementById('assistant-context-pill-title');
  const chips = document.getElementById('assistant-chips-scroll');
  const input = document.getElementById('assistant-input');

  if (wrap) wrap.classList.remove('hidden');
  if (titleEl) titleEl.textContent = card.title || 'Untitled';
  if (chips) chips.classList.add('hidden');
  if (input) {
    input.placeholder = 'Ask about this card (or press send to break down)...';
    input.focus();
  }
  hideCardSuggestions();
  closeMentionPopover();
  updateAssistantControlsState();
}

export function clearActiveCardContext() {
  activeCardContext = null;
  const wrap = document.getElementById('assistant-context-pill-wrap');
  const chips = document.getElementById('assistant-chips-scroll');
  const input = document.getElementById('assistant-input');

  if (wrap) wrap.classList.add('hidden');
  if (chips) chips.classList.remove('hidden');
  if (input) {
    input.placeholder = 'Ask Assistant...';
  }
  updateAssistantControlsState();
}

export function openMentionPopover(filterQuery = '') {
  const popover = document.getElementById('assistant-mention-popover');
  const listEl = document.getElementById('assistant-mention-list');
  const countEl = document.getElementById('assistant-mention-count');
  if (!popover || !listEl) return;

  const liveBars = typeof deps.getLiveBars === 'function' ? deps.getLiveBars() : [];
  const query = (filterQuery || '').toLowerCase().trim();

  mentionFilteredCards = liveBars.filter(b => {
    if (!query) return true;
    return (b.title || '').toLowerCase().includes(query);
  });

  if (countEl) {
    countEl.textContent = `${mentionFilteredCards.length} card${mentionFilteredCards.length === 1 ? '' : 's'}`;
  }

  if (!liveBars.length) {
    listEl.innerHTML = '<div class="assistant-mention-empty">No cards found. Create a tracker first.</div>';
  } else if (!mentionFilteredCards.length) {
    listEl.innerHTML = `<div class="assistant-mention-empty">No cards matching "@${escapeHtml(filterQuery)}"</div>`;
  } else {
    listEl.innerHTML = mentionFilteredCards.map((card, idx) => `
      <div class="assistant-mention-item ${idx === 0 ? 'selected' : ''}" data-idx="${idx}" data-card-id="${escapeHtml(card.id)}" data-card-title="${escapeHtml(card.title || 'Untitled')}">
        <div class="assistant-mention-item-icon ${escapeHtml(card.type || 'goal')}">
          ${getCardIconSvg(card.type)}
        </div>
        <div class="assistant-mention-item-info">
          <div class="assistant-mention-item-title">${highlightMatchedText(card.title || 'Untitled', filterQuery)}</div>
          <div class="assistant-mention-item-meta">${escapeHtml(getCardMetaText(card))}</div>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.assistant-mention-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.idx, 10);
        const card = mentionFilteredCards[idx];
        if (card) {
          selectMentionCard(card);
        }
      });
    });
  }

  mentionPopoverSelectedIndex = 0;
  popover.classList.remove('hidden');
}

export function closeMentionPopover() {
  const popover = document.getElementById('assistant-mention-popover');
  if (popover) popover.classList.add('hidden');
  mentionPopoverSelectedIndex = 0;
  mentionFilteredCards = [];
}

export function selectMentionCard(card) {
  const textarea = document.getElementById('assistant-input');
  if (textarea) {
    // Strip trailing @query that was being typed
    const val = textarea.value;
    const cursorPos = textarea.selectionStart;
    const before = val.slice(0, cursorPos);
    const after = val.slice(cursorPos);
    const atIndex = before.lastIndexOf('@');
    if (atIndex !== -1) {
      textarea.value = (before.slice(0, atIndex) + after).trim();
    }
  }
  setActiveCardContext(card);
}

function updateMentionSelection(newIdx) {
  const listEl = document.getElementById('assistant-mention-list');
  if (!listEl || !mentionFilteredCards.length) return;
  const items = listEl.querySelectorAll('.assistant-mention-item');
  if (!items.length) return;

  mentionPopoverSelectedIndex = (newIdx + items.length) % items.length;
  items.forEach((item, idx) => {
    if (idx === mentionPopoverSelectedIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}

/**
 * Renders card suggestion pills above the input box.
 */
function renderCardSuggestions(filterText = '') {
  const wrap = document.getElementById('assistant-card-suggestions');
  if (!wrap) return;

  const liveBars = typeof deps.getLiveBars === 'function' ? deps.getLiveBars() : [];
  if (!liveBars.length) {
    wrap.classList.add('hidden');
    return;
  }

  const query = (filterText || '').toLowerCase().trim();
  const matched = liveBars.filter(b => {
    if (!query) return true;
    return (b.title || '').toLowerCase().includes(query);
  });

  if (!matched.length) {
    wrap.classList.add('hidden');
    return;
  }

  wrap.innerHTML = `
    <span class="assistant-suggestion-label">Cards:</span>
    ${matched.map(b => `
      <button type="button" class="assistant-suggestion-pill" data-card-id="${escapeHtml(b.id)}" data-card-title="${escapeHtml(b.title || 'Untitled')}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
        <span>${escapeHtml(b.title || 'Untitled')}</span>
      </button>
    `).join('')}
  `;

  wrap.classList.remove('hidden');

  wrap.querySelectorAll('.assistant-suggestion-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const cardId = pill.dataset.cardId;
      const liveBars = typeof deps.getLiveBars === 'function' ? deps.getLiveBars() : [];
      const found = liveBars.find(b => b.id === cardId);
      if (found) {
        setActiveCardContext(found);
      } else {
        const title = pill.dataset.cardTitle;
        setActiveCardContext({ id: cardId, title, type: 'goal' });
      }
      wrap.classList.add('hidden');
    });
  });
}

function hideCardSuggestions() {
  const wrap = document.getElementById('assistant-card-suggestions');
  if (wrap) wrap.classList.add('hidden');
}

/**
 * Executes a conversational turn with Gemini with full cards context.
 */
async function handleAssistantPrompt(userText, options = {}) {
  if (!currentAiStatus || !currentAiStatus.connected) {
    showToast('Please connect your Gemini API key in AI settings first.', 'warning');
    return;
  }
  if (isGenerating) return;

  const targetCard = activeCardContext;
  const rawInput = (userText || '').trim();
  const img = options.image || attachedImage;

  if (!rawInput && !img && !targetCard) return;

  // Validation: If image is provided, verify size and format constraints
  if (img) {
    if (img.sizeBytes && img.sizeBytes > MAX_IMAGE_BYTES) {
      showAttachmentError('Image size exceeds 3 MB limit after compression.');
      clearAttachment();
      return;
    }
    const mime = (img.mimeType || '').toLowerCase();
    if (mime && !ACCEPTED_IMAGE_TYPES.includes(mime)) {
      showAttachmentError('Only PNG, JPEG, and WebP images are supported.');
      clearAttachment();
      return;
    }
  }

  isGenerating = true;
  hideCardSuggestions();
  closeMentionPopover();
  clearActiveCardContext();
  updateAssistantControlsState();
  updateBriefingDisplayMode(true);

  let thread = document.getElementById('assistant-thread');
  if (!thread) {
    await renderAssistantState(currentAiStatus);
    thread = document.getElementById('assistant-thread');
  }

  // 1. Append User Message Bubble
  const userMsgId = 'msg-' + Date.now();
  let userContentHtml = '';
  if (img && img.dataUrl) {
    userContentHtml += `<img src="${escapeHtml(img.dataUrl)}" class="assistant-msg-user-img" alt="Attached image">`;
  }
  if (targetCard) {
    userContentHtml += `
      <div class="assistant-msg-user-line">
        <span class="assistant-thread-mention">@${escapeHtml(targetCard.title || 'Card')}</span>
        <span>${escapeHtml(rawInput || 'Break down this card')}</span>
      </div>
    `;
  } else if (rawInput) {
    userContentHtml += `<div>${escapeHtml(rawInput)}</div>`;
  }

  const userMsgHtml = `
    <div id="${userMsgId}" class="assistant-msg assistant-msg-user">
      ${userContentHtml}
    </div>
  `;
  thread.insertAdjacentHTML('beforeend', userMsgHtml);

  // Initialize and persist session if history is enabled (never store image bytes in history)
  const userTurnText = targetCard
    ? `@${targetCard.title}: ${rawInput || 'Break down this card'}`
    : (rawInput || '[Attached image]');

  if (isAiHistoryEnabled() && !activeSessionId) {
    activeSessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const titleText = targetCard
      ? `@${targetCard.title}`
      : (rawInput ? (rawInput.length > 36 ? rawInput.slice(0, 33) + '...' : rawInput) : 'Image prompt');
    const sessions = getChatSessions();
    sessions.unshift({
      id: activeSessionId,
      title: titleText,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      history: [{ role: 'user', text: userTurnText }],
      threadHtml: stripImagesFromThreadHtml(thread.innerHTML)
    });
    saveChatSessions(sessions);
  }

  // 2. Append Thinking Indicator
  const thinkingId = 'thinking-' + Date.now();
  const timerSpanId = 'thinking-timer-' + Date.now();
  const thinkingHtml = `
    <div id="${thinkingId}" class="assistant-msg assistant-msg-bot">
      <div class="assistant-thinking-indicator">
        <span id="${timerSpanId}">Thinking with Gemini (0s)</span>
        <div class="assistant-thinking-dots">
          <span class="assistant-thinking-dot"></span>
          <span class="assistant-thinking-dot"></span>
          <span class="assistant-thinking-dot"></span>
        </div>
      </div>
    </div>
  `;
  thread.insertAdjacentHTML('beforeend', thinkingHtml);
  scrollThreadToBottom();

  const thinkingStartTime = Date.now();
  const thinkingInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - thinkingStartTime) / 1000);
    const span = document.getElementById(timerSpanId);
    if (span) {
      span.textContent = `Thinking with Gemini (${elapsed}s)`;
    }
  }, 1000);

  // 3. Prepare Cards Context for Gemini (Optimized: trimmed input & capped history)
  const liveBars = typeof deps.getLiveBars === 'function' ? deps.getLiveBars() : [];

  // Active (incomplete) cards capped at 40 with truncated notes and checklist items
  const activeBars = liveBars.filter(b => !b.completed).slice(0, 40);
  const activeCardsSummary = activeBars.map(b => ({
    id: b.id,
    title: b.title,
    type: b.type || 'goal',
    current: b.currentSmallest || 0,
    target: b.targetSmallest || 100,
    unit: b.levels?.[0]?.name || '%',
    completed: false,
    deadline: b.deadlineAt ? new Date(b.deadlineAt).toISOString() : null,
    isOverdue: Boolean(b.deadlineAt && b.deadlineAt < Date.now() && !b.completed),
    items: Array.isArray(b.items)
      ? b.items.slice(0, 25).map(it => ({
          id: it.id,
          text: (it.text || '').slice(0, 200),
          done: Boolean(it.done)
        }))
      : [],
    text: (b.text || '').slice(0, 200)
  }));

  // Recently completed cards: send only titles (up to 10) to minimize tokens
  const recentlyCompletedSummary = liveBars
    .filter(b => b.completed)
    .slice(-10)
    .map(b => ({
      id: b.id,
      title: b.title,
      completed: true
    }));

  const cardsSummary = [...activeCardsSummary, ...recentlyCompletedSummary];

  // Trim conversation history to the last 6 turns and ensure clean {role, text} format
  const sanitizedHistory = conversationHistory
    .slice(-6)
    .map(h => ({
      role: h.role === 'model' ? 'model' : 'user',
      text: typeof h.text === 'string' ? h.text : ''
    }));

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const localDateStr = `${yyyy}-${mm}-${dd}`;
  const localTimeStr = `${hh}:${min}:${ss}`;

  const tzOffsetMin = -now.getTimezoneOffset();
  const tzSign = tzOffsetMin >= 0 ? '+' : '-';
  const tzHours = String(Math.floor(Math.abs(tzOffsetMin) / 60)).padStart(2, '0');
  const tzMins = String(Math.abs(tzOffsetMin) % 60).padStart(2, '0');
  const tzOffsetStr = `${tzSign}${tzHours}:${tzMins}`;
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const weekdayName = now.toLocaleDateString('en-US', { weekday: 'long' });

  let promptToSend = rawInput;
  if (targetCard) {
    if (!rawInput) {
      promptToSend = `Break down: ${targetCard.title}`;
    } else {
      promptToSend = `Regarding card "${targetCard.title}" (ID: ${targetCard.id}): ${rawInput}`;
    }
  }

  const activeFirstName = getActiveUserFirstName();
  const payload = {
    message: promptToSend,
    history: sanitizedHistory,
    cards: cardsSummary,
    targetCardId: targetCard ? targetCard.id : null,
    currentDate: `${localDateStr}T${localTimeStr}${tzOffsetStr}`,
    localDate: localDateStr,
    localTime: localTimeStr,
    timezone: userTimezone,
    tzOffset: tzOffsetStr,
    weekday: weekdayName,
    firstName: activeFirstName || undefined,
    userFirstName: activeFirstName || undefined,
  };

  if (img && img.data && img.mimeType) {
    payload.image = {
      data: img.data,
      mimeType: img.mimeType,
    };
  }

  try {
    const result = await aiGenerate('chat', payload);

    // Remove thinking indicator
    const thinkingEl = document.getElementById(thinkingId);
    if (thinkingEl) thinkingEl.remove();

    // 4. Append Conversational Message from AI
    const replyMsg = result.message || 'I have analyzed your request.';
    conversationHistory.push({
      role: 'user',
      text: userTurnText
    });
    conversationHistory.push({ role: 'model', text: replyMsg });

    const replyId = 'reply-' + Date.now();
    const replyHtml = `
      <div id="${replyId}" class="assistant-msg assistant-msg-bot">
        <div class="assistant-msg-text">
          ${renderMarkdownText(replyMsg)}
        </div>
      </div>
    `;
    thread.insertAdjacentHTML('beforeend', replyHtml);

    // 5. If AI proposes actions (or legacy single action), render Confirmation Sheet!
    let proposedActions = [];
    if (Array.isArray(result.actions)) {
      proposedActions = result.actions;
    } else if (result.action && typeof result.action === 'object') {
      proposedActions = [result.action];
    }

    if (proposedActions.length > 0) {
      renderActionConfirmSheet(proposedActions, replyId);
    }

    threadHtml = thread.innerHTML;
    syncActiveSessionThread();
  } catch (err) {
    console.error('[Assistant] Prompt error:', err);
    const thinkingEl = document.getElementById(thinkingId);
    if (thinkingEl) thinkingEl.remove();

    const errMsg = formatAiErrorMessage(err);
    const errHtml = `
      <div class="assistant-msg assistant-msg-bot">
        <div class="assistant-connect-error" role="alert">${escapeHtml(errMsg)}</div>
      </div>
    `;
    thread.insertAdjacentHTML('beforeend', errHtml);
    threadHtml = thread.innerHTML;
    syncActiveSessionThread();
  } finally {
    clearInterval(thinkingInterval);
    isGenerating = false;
    clearAttachment();
    updateAssistantControlsState();
    scrollThreadToBottom();
  }
}

function syncActiveSessionThread() {
  if (isAiHistoryEnabled() && activeSessionId) {
    const sessions = getChatSessions();
    const idx = sessions.findIndex(s => s.id === activeSessionId);
    if (idx !== -1) {
      sessions[idx].updatedAt = Date.now();
      sessions[idx].history = [...conversationHistory];
      sessions[idx].threadHtml = stripImagesFromThreadHtml(threadHtml);
      saveChatSessions(sessions);
    }
  }
}

const CONFIRM_PRESETS = [
  'Time',
  'Pages',
  'Chapters',
  'Lectures',
  'Videos',
  'Problems',
  'Tasks',
  'Books',
  'Custom'
];

function sanitizeUnit(rawUnit) {
  if (!rawUnit || typeof rawUnit !== 'string') return '%';
  let clean = rawUnit.trim();
  // Strip any HTML or multiline text or long monologue
  if (clean.includes('<') || clean.includes('\n') || clean.length > 20) {
    const match = clean.match(/\b(mins?|minutes?|hours?|hrs?|pages?|chapters?|tasks?|problems?|books?|lectures?|videos?|%|km|miles?|steps?)\b/i);
    clean = match ? match[1].toLowerCase() : '%';
  }
  return clean || '%';
}

function detectPreset(suggestedPreset, unit) {
  if (suggestedPreset && CONFIRM_PRESETS.includes(suggestedPreset)) {
    return suggestedPreset;
  }
  const u = (unit || '').toLowerCase();
  if (u.includes('min') || u.includes('hour') || u.includes('hr') || u.includes('sec')) return 'Time';
  if (u.includes('page')) return 'Pages';
  if (u.includes('chapter')) return 'Chapters';
  if (u.includes('lecture')) return 'Lectures';
  if (u.includes('video')) return 'Videos';
  if (u.includes('prob') || u.includes('quest')) return 'Problems';
  if (u.includes('task')) return 'Tasks';
  if (u.includes('book')) return 'Books';
  return 'Custom';
}

function formatDatetimeLocal(val) {
  if (!val) return '';
  let ms = null;
  if (typeof val === 'number') {
    ms = val;
  } else if (typeof val === 'string') {
    ms = normalizeAiDeadline(val);
  }
  if (!ms || isNaN(ms)) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

/**
 * Shows an undo toast that remains visible for 10 seconds.
 * Allows the user to revert a create or update action.
 */
export function showUndoToast({ message, onUndo, duration = 10000, undoText = 'Undo' }) {
  let container = document.getElementById('toast-container') || document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast toast-info toast-with-undo';
  toast.innerHTML = `
    <span class="toast-message">${escapeHtml(message)}</span>
    <button type="button" class="btn-toast-undo">${escapeHtml(undoText)}</button>
    <button type="button" class="btn-close-toast" aria-label="Close">&times;</button>
  `;

  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    toast.classList.add('toast-out');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  };

  const undoBtn = toast.querySelector('.btn-toast-undo');
  if (undoBtn) {
    undoBtn.addEventListener('click', async () => {
      undoBtn.disabled = true;
      undoBtn.textContent = 'Undoing...';
      try {
        if (typeof onUndo === 'function') {
          await onUndo();
        }
      } catch (err) {
        console.error('[Assistant] Undo failed:', err);
        showToast(err.message || 'Failed to undo action', 'error');
      } finally {
        dismiss();
      }
    });
  }

  const closeBtn = toast.querySelector('.btn-close-toast');
  if (closeBtn) {
    closeBtn.addEventListener('click', dismiss);
  }

  container.appendChild(toast);

  if (duration > 0) {
    timer = setTimeout(dismiss, duration);
  }

  return toast;
}

/**
 * Renders the Confirmation Sheet containing one list of proposals with checkboxes
 * (delete unchecked by default), editable fields per item, real card titles looked up
 * locally by cardId, "Apply selected (n)" button, per-item result, clear partial failure
 * handling, and 10s undo toasts for create and update.
 */
export function renderActionConfirmSheet(actionsOrAction, parentMsgId) {
  const parentMsg = document.getElementById(parentMsgId);
  if (!parentMsg) return;

  const rawList = Array.isArray(actionsOrAction)
    ? actionsOrAction
    : (actionsOrAction && typeof actionsOrAction === 'object' ? [actionsOrAction] : []);

  if (!rawList.length) return;

  const sheetId = 'confirm-sheet-' + Date.now();
  const liveBars = typeof deps.getLiveBars === 'function' ? deps.getLiveBars() : [];

  let itemsHtml = '';
  let defaultCheckedCount = 0;

  rawList.forEach((act, idx) => {
    const actType = (act.type || 'create').toLowerCase();
    const isDelete = actType === 'delete';
    const isUpdate = actType === 'update';
    const isCreate = actType === 'create';

    // Delete is unchecked by default; create and update are checked by default
    const isChecked = !isDelete;
    if (isChecked) defaultCheckedCount++;

    // Safety lookup: look up target card locally by cardId
    let existingCard = null;
    if (act.cardId) {
      existingCard = liveBars.find(b => String(b.id) === String(act.cardId));
    }

    const realTitle = existingCard ? existingCard.title : '';
    let displayTitle = act.title || (isDelete ? 'Delete Tracker' : 'New Tracker');
    let notFoundWarning = '';

    if (isDelete || isUpdate) {
      if (existingCard) {
        displayTitle = realTitle;
      } else {
        notFoundWarning = 'Target tracker not found in your list.';
      }
    }

    const isReschedule = isUpdate && act.deadline && !act.items && !act.noteText && !act.target;
    const badgeText = isCreate ? 'Create' : (isDelete ? 'Delete' : (isReschedule ? 'Reschedule' : 'Update'));

    const rawCardType = (act.cardType || existingCard?.type || 'goal').toLowerCase();
    const cardType = rawCardType === 'checklist' ? 'checklist' : (rawCardType === 'note' ? 'note' : 'goal');

    // Fields markup
    let typeFieldsHtml = '';
    if (!isDelete) {
      // Editable Title
      typeFieldsHtml += `
        <div class="confirm-field-group">
          <label class="confirm-field-label">Title</label>
          <input type="text" class="confirm-input proposal-title-input" value="${escapeHtml(act.title || displayTitle)}">
        </div>
      `;

      if (cardType === 'goal') {
        const targetVal = typeof act.target === 'number' ? act.target : (existingCard?.targetSmallest || 100);
        const currentVal = typeof act.currentProgress === 'number' ? act.currentProgress : (existingCard?.currentSmallest || 0);
        const unitVal = sanitizeUnit(act.unit || existingCard?.levels?.[0]?.name);
        const detectedPreset = detectPreset(act.preset || existingCard?.preset, unitVal);

        typeFieldsHtml += `
          <div class="confirm-field-group">
            <label class="confirm-field-label">Preset Unit</label>
            <select class="confirm-input proposal-preset-select">
              <option value="Time" ${detectedPreset === 'Time' ? 'selected' : ''}>Time (hrs / min)</option>
              <option value="Pages" ${detectedPreset === 'Pages' ? 'selected' : ''}>Pages</option>
              <option value="Chapters" ${detectedPreset === 'Chapters' ? 'selected' : ''}>Chapters</option>
              <option value="Lectures" ${detectedPreset === 'Lectures' ? 'selected' : ''}>Lectures</option>
              <option value="Videos" ${detectedPreset === 'Videos' ? 'selected' : ''}>Videos</option>
              <option value="Problems" ${detectedPreset === 'Problems' ? 'selected' : ''}>Problems</option>
              <option value="Tasks" ${detectedPreset === 'Tasks' ? 'selected' : ''}>Tasks</option>
              <option value="Books" ${detectedPreset === 'Books' ? 'selected' : ''}>Books</option>
              <option value="Custom" ${detectedPreset === 'Custom' ? 'selected' : ''}>Custom</option>
            </select>
          </div>
          <div class="confirm-row-2col">
            <div class="confirm-field-group">
              <label class="confirm-field-label">Target</label>
              <input type="number" class="confirm-input proposal-target-input" value="${targetVal}" min="0" step="any">
            </div>
            <div class="confirm-field-group">
              <label class="confirm-field-label">Current</label>
              <input type="number" class="confirm-input proposal-current-input" value="${currentVal}" min="0" step="any">
            </div>
          </div>
          <div class="confirm-field-group">
            <label class="confirm-field-label">Unit</label>
            <input type="text" class="confirm-input proposal-unit-input" value="${escapeHtml(unitVal)}" placeholder="e.g. mins, pages, %">
          </div>
        `;
      } else if (cardType === 'checklist') {
        const items = Array.isArray(act.items) && act.items.length
          ? act.items
          : (existingCard?.items || [{ text: 'Step 1' }]);
        const itemsListHtml = items.map((it, iIdx) => `
          <div class="confirm-item-row" data-idx="${iIdx}">
            <input type="checkbox" class="confirm-item-checkbox" checked title="Include item">
            <input type="text" class="confirm-item-text" value="${escapeHtml(it.text || '')}">
          </div>
        `).join('');

        typeFieldsHtml += `
          <div class="confirm-field-group">
            <label class="confirm-field-label">Checklist Items (${items.length})</label>
            <div class="confirm-items-list proposal-items-list">
              ${itemsListHtml}
            </div>
          </div>
        `;
      } else if (cardType === 'note') {
        const noteText = act.noteText || existingCard?.text || '';
        typeFieldsHtml += `
          <div class="confirm-field-group">
            <label class="confirm-field-label">Note Content</label>
            <textarea class="confirm-input proposal-note-textarea" rows="3">${escapeHtml(noteText)}</textarea>
          </div>
        `;
      }

      // Editable Deadline with calendar picker & Clear button
      const rawDl = act.deadline || existingCard?.deadlineAt;
      const dlVal = formatDatetimeLocal(rawDl);
      typeFieldsHtml += `
        <div class="confirm-field-group">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px;">
            <label class="confirm-field-label">Deadline (optional)</label>
            <button type="button" class="btn-proposal-clear-deadline" style="background: none; border: none; font-size: 0.72rem; color: var(--text-muted); cursor: pointer; padding: 0;" title="Clear deadline">Clear</button>
          </div>
          <input type="datetime-local" class="confirm-input proposal-deadline-input" value="${dlVal}">
        </div>
      `;

      // Daily habit
      if (cardType === 'goal' || cardType === 'checklist') {
        const isRec = Boolean(act.isRecurring ?? existingCard?.repeat);
        const resetTimeVal = act.resetTime || existingCard?.repeat?.resetTime || '07:00';
        typeFieldsHtml += `
          <div class="confirm-field-group">
            <div class="confirm-row-2col" style="align-items: center;">
              <label class="confirm-field-label" style="display: flex; align-items: center; gap: 6px; cursor: pointer; margin: 0;">
                <input type="checkbox" class="proposal-recurring-checkbox" ${isRec ? 'checked' : ''} style="accent-color: var(--ui-accent); cursor: pointer;">
                <span>Daily Habit</span>
              </label>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 0.72rem; color: var(--text-muted); white-space: nowrap;">Reset:</span>
                <input type="time" class="confirm-input proposal-reset-time-input" value="${escapeHtml(resetTimeVal)}" style="padding: 4px 6px;">
              </div>
            </div>
          </div>
        `;
      }
    } else {
      typeFieldsHtml = `
        <div class="proposal-delete-warning">
          Will permanently delete: <strong>${escapeHtml(displayTitle)}</strong>
        </div>
      `;
    }

    const explanation = act.explanation || '';

    itemsHtml += `
      <div class="proposal-item" data-idx="${idx}" data-action-type="${actType}" data-card-id="${escapeHtml(act.cardId || '')}" data-card-type="${cardType}">
        <div class="proposal-item-header">
          <label class="proposal-item-check-label">
            <input type="checkbox" class="proposal-item-checkbox" ${isChecked ? 'checked' : ''} ${notFoundWarning ? 'disabled' : ''}>
            <span class="proposal-action-badge ${actType}">${badgeText}</span>
            <span class="proposal-item-main-title" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</span>
          </label>
          <div class="proposal-item-header-right">
            <span class="proposal-item-status-pill pending">Pending</span>
            <button type="button" class="proposal-item-discard-btn" title="Discard this item">&times;</button>
          </div>
        </div>

        <div class="proposal-item-body">
          ${isUpdate && existingCard ? `<div class="proposal-target-title">Target: <strong>${escapeHtml(realTitle)}</strong></div>` : ''}
          ${notFoundWarning ? `<div class="assistant-connect-error" role="alert">${escapeHtml(notFoundWarning)}</div>` : ''}
          ${typeFieldsHtml}
          ${explanation ? `<div class="confirm-explanation">${escapeHtml(explanation)}</div>` : ''}
          <div class="proposal-item-error hidden"></div>
        </div>
      </div>
    `;
  });

  const sheetHtml = `
    <div id="${sheetId}" class="assistant-proposals-sheet">
      <div class="proposal-sheet-header">
        <div class="proposal-sheet-title">
          <span>Proposed Changes</span>
          <span class="proposal-sheet-count-badge">${rawList.length}</span>
        </div>
        <span class="proposal-sheet-hint">Review, edit, and apply selected changes</span>
      </div>

      <div class="proposal-sheet-list">
        ${itemsHtml}
      </div>

      <div class="proposal-sheet-footer">
        <span class="proposal-selection-count">${defaultCheckedCount} of ${rawList.length} selected</span>
        <div class="proposal-sheet-actions">
          <button type="button" class="btn btn-secondary btn-proposal-discard-all">Discard all</button>
          <button type="button" class="btn btn-primary btn-proposal-apply-all" ${defaultCheckedCount === 0 ? 'disabled' : ''}>
            Apply selected (${defaultCheckedCount})
          </button>
        </div>
      </div>
    </div>
  `;

  parentMsg.insertAdjacentHTML('beforeend', sheetHtml);
  attachProposalsSheetListeners(document.getElementById(sheetId), rawList);
}

function attachThreadCardListeners() {
  const cards = document.querySelectorAll('.assistant-confirm-card');
  cards.forEach(card => {
    if (card.querySelector('.btn-confirm-primary')) {
      attachActionCardListeners(card, {});
    }
  });
  const sheets = document.querySelectorAll('.assistant-proposals-sheet');
  sheets.forEach(sheet => {
    if (sheet.querySelector('.btn-proposal-apply-all')) {
      attachProposalsSheetListeners(sheet, []);
    }
  });
}

function attachProposalsSheetListeners(sheet, rawList) {
  if (!sheet) return;

  const countLabel = sheet.querySelector('.proposal-selection-count');
  const btnApply = sheet.querySelector('.btn-proposal-apply-all');
  const btnDiscardAll = sheet.querySelector('.btn-proposal-discard-all');

  function updateCheckedCount() {
    const allItems = Array.from(sheet.querySelectorAll('.proposal-item:not(.proposal-item-discarded):not(.proposal-item-applied)'));
    const checkedItems = allItems.filter(item => {
      const cb = item.querySelector('.proposal-item-checkbox');
      return cb && cb.checked;
    });

    const totalActive = allItems.length;
    const n = checkedItems.length;

    if (countLabel) {
      countLabel.textContent = `${n} of ${totalActive} selected`;
    }

    if (btnApply) {
      btnApply.textContent = `Apply selected (${n})`;
      btnApply.disabled = n === 0;
    }
  }

  // Preset changes & Clear deadline buttons inside items
  sheet.querySelectorAll('.proposal-item').forEach(item => {
    const presetSelect = item.querySelector('.proposal-preset-select');
    const unitInput = item.querySelector('.proposal-unit-input');
    if (presetSelect && unitInput) {
      presetSelect.addEventListener('change', () => {
        const p = presetSelect.value;
        if (p === 'Time') unitInput.value = 'mins';
        else if (p === 'Pages') unitInput.value = 'pages';
        else if (p === 'Chapters') unitInput.value = 'chapters';
        else if (p === 'Lectures') unitInput.value = 'lectures';
        else if (p === 'Videos') unitInput.value = 'videos';
        else if (p === 'Problems') unitInput.value = 'problems';
        else if (p === 'Tasks') unitInput.value = 'tasks';
        else if (p === 'Books') unitInput.value = 'books';
      });
    }

    const clearDlBtn = item.querySelector('.btn-proposal-clear-deadline');
    const dlInput = item.querySelector('.proposal-deadline-input');
    if (clearDlBtn && dlInput) {
      clearDlBtn.addEventListener('click', () => {
        dlInput.value = '';
      });
    }

    // Individual item checkbox
    const cb = item.querySelector('.proposal-item-checkbox');
    if (cb) {
      cb.addEventListener('change', () => {
        updateCheckedCount();
      });
    }

    // Individual item discard button
    const discardBtn = item.querySelector('.proposal-item-discard-btn');
    if (discardBtn) {
      discardBtn.addEventListener('click', () => {
        item.classList.add('proposal-item-discarded');
        const pill = item.querySelector('.proposal-item-status-pill');
        if (pill) {
          pill.className = 'proposal-item-status-pill pending';
          pill.textContent = 'Discarded';
        }
        const itemCb = item.querySelector('.proposal-item-checkbox');
        if (itemCb) {
          itemCb.checked = false;
          itemCb.disabled = true;
        }
        item.style.opacity = '0.4';
        updateCheckedCount();
      });
    }
  });

  // Discard all button
  if (btnDiscardAll) {
    btnDiscardAll.addEventListener('click', () => {
      sheet.querySelectorAll('.proposal-item:not(.proposal-item-applied)').forEach(item => {
        item.classList.add('proposal-item-discarded');
        const pill = item.querySelector('.proposal-item-status-pill');
        if (pill) {
          pill.className = 'proposal-item-status-pill pending';
          pill.textContent = 'Discarded';
        }
        const itemCb = item.querySelector('.proposal-item-checkbox');
        if (itemCb) {
          itemCb.checked = false;
          itemCb.disabled = true;
        }
        item.style.opacity = '0.4';
      });
      const footer = sheet.querySelector('.proposal-sheet-footer');
      if (footer) {
        footer.innerHTML = `<div class="confirm-discarded-state" style="width: 100%;">Proposals discarded.</div>`;
      }
      const thread = document.getElementById('assistant-thread');
      if (thread) threadHtml = thread.innerHTML;
      syncActiveSessionThread();
    });
  }

  // Apply selected button
  if (btnApply) {
    btnApply.addEventListener('click', async () => {
      const itemsToApply = Array.from(sheet.querySelectorAll('.proposal-item:not(.proposal-item-discarded):not(.proposal-item-applied)'))
        .filter(item => {
          const cb = item.querySelector('.proposal-item-checkbox');
          return cb && cb.checked;
        });

      if (!itemsToApply.length) return;

      btnApply.disabled = true;
      btnApply.textContent = 'Applying...';

      let successCount = 0;
      let failCount = 0;
      const appliedActions = [];

      for (const item of itemsToApply) {
        const idx = parseInt(item.dataset.idx, 10);
        const rawAction = rawList[idx] || {};
        const actType = item.dataset.actionType || 'create';
        const cardId = item.dataset.cardId || rawAction.cardId;
        const cardType = item.dataset.cardType || 'goal';

        const statusPill = item.querySelector('.proposal-item-status-pill');
        const errorBox = item.querySelector('.proposal-item-error');

        if (statusPill) {
          statusPill.className = 'proposal-item-status-pill applying';
          statusPill.textContent = 'Applying...';
        }
        if (errorBox) {
          errorBox.classList.add('hidden');
          errorBox.textContent = '';
        }

        try {
          // Read user-edited values from DOM
          const titleInput = item.querySelector('.proposal-title-input');
          const finalTitle = titleInput ? titleInput.value.trim() : (rawAction.title || 'Untitled');

          let targetSmallest = 100;
          let currentSmallest = 0;
          let levels = [{ name: '%', multiplier: 1, target: 100 }];
          let items = null;
          let text = null;
          let finalPreset = 'Custom';

          if (cardType === 'goal') {
            const targetInput = item.querySelector('.proposal-target-input');
            const currentInput = item.querySelector('.proposal-current-input');
            const unitInput = item.querySelector('.proposal-unit-input');
            const presetSelect = item.querySelector('.proposal-preset-select');

            const tVal = targetInput ? parseFloat(targetInput.value) || 100 : 100;
            const cVal = currentInput ? parseFloat(currentInput.value) || 0 : 0;
            const uVal = unitInput ? sanitizeUnit(unitInput.value) : '%';
            const chosenPreset = presetSelect ? presetSelect.value : detectPreset(rawAction.preset, uVal);

            targetSmallest = tVal;
            currentSmallest = cVal;
            finalPreset = chosenPreset;

            if (chosenPreset === 'Time') {
              levels = [
                { name: 'Minutes', conversionToNext: 60 },
                { name: 'Hours', conversionToNext: null }
              ];
            } else if (chosenPreset !== 'Custom') {
              levels = [{ name: chosenPreset, conversionToNext: null }];
            } else {
              levels = [{ name: uVal, conversionToNext: null }];
            }
          } else if (cardType === 'checklist') {
            finalPreset = 'Custom';
            const itemRows = Array.from(item.querySelectorAll('.confirm-item-row'));
            const checkedItems = itemRows
              .filter(row => row.querySelector('.confirm-item-checkbox')?.checked)
              .map((row, iIdx) => ({
                id: String(iIdx + 1),
                text: row.querySelector('.confirm-item-text')?.value.trim() || `Item ${iIdx + 1}`,
                done: false
              }));

            items = checkedItems.length ? checkedItems : [{ id: '1', text: 'Step 1', done: false }];
            targetSmallest = items.length;
            currentSmallest = 0;
            levels = [{ name: 'items', multiplier: 1, target: items.length }];
          } else if (cardType === 'note') {
            finalPreset = 'Custom';
            const noteArea = item.querySelector('.proposal-note-textarea');
            text = noteArea ? noteArea.value : '';
            targetSmallest = 1;
            currentSmallest = 0;
            levels = [{ name: 'notes', multiplier: 1, target: 1 }];
          }

          // Deadline
          let deadlineAt = null;
          const dlInput = item.querySelector('.proposal-deadline-input');
          if (dlInput && dlInput.value) {
            const parsed = new Date(dlInput.value).getTime();
            if (!isNaN(parsed) && parsed > 0) deadlineAt = parsed;
          } else if (rawAction.deadline) {
            try {
              const parsed = normalizeAiDeadline(rawAction.deadline);
              if (parsed && !isNaN(parsed)) deadlineAt = parsed;
            } catch (_) {}
          }

          // Repeat / Daily habit
          const recurringCheckbox = item.querySelector('.proposal-recurring-checkbox');
          const resetTimeInput = item.querySelector('.proposal-reset-time-input');
          const isRecurring = recurringCheckbox ? recurringCheckbox.checked : Boolean(rawAction.isRecurring);

          let repeat = null;
          if (isRecurring) {
            repeat = {
              resetTime: (resetTimeInput && resetTimeInput.value) ? resetTimeInput.value : (rawAction.resetTime || '07:00'),
              resetCount: null,
              checklistResetEnabled: cardType === 'checklist',
              deadlineResetEnabled: false,
              lastResetAt: Date.now()
            };
          }

          if (actType === 'delete') {
            if (!cardId) throw new Error('No card ID specified for delete');
            const liveBars = typeof deps.getLiveBars === 'function' ? deps.getLiveBars() : [];
            const existingCard = liveBars.find(b => String(b.id) === String(cardId));
            const originalSnapshot = existingCard ? JSON.parse(JSON.stringify(existingCard)) : null;

            if (typeof deps.handleDeleteBarFromAi === 'function') {
              await deps.handleDeleteBarFromAi(cardId);
            }
            if (statusPill) {
              statusPill.className = 'proposal-item-status-pill applied';
              statusPill.textContent = '✓ Deleted';
            }
            if (originalSnapshot) {
              appliedActions.push({
                type: 'delete',
                cardId,
                title: originalSnapshot.title || 'tracker',
                undo: async () => {
                  if (typeof deps.handleCreateBarFromAi === 'function') {
                    await deps.handleCreateBarFromAi(originalSnapshot);
                  }
                }
              });
            }
          } else if (actType === 'update') {
            if (!cardId) throw new Error('No card ID specified for update');
            const liveBars = typeof deps.getLiveBars === 'function' ? deps.getLiveBars() : [];
            const existingCard = liveBars.find(b => String(b.id) === String(cardId));
            if (!existingCard) throw new Error('Target tracker not found locally');

            // Snapshot for undo
            const originalSnapshot = JSON.parse(JSON.stringify(existingCard));

            const updates = {};

            // 1. Title (only if changed)
            if (finalTitle && finalTitle !== existingCard.title) {
              updates.title = finalTitle;
            }

            // 2. Type-specific fields (Never send target, progress, items or type unchanged)
            if (cardType === 'goal') {
              const targetInput = item.querySelector('.proposal-target-input');
              const currentInput = item.querySelector('.proposal-current-input');
              const unitInput = item.querySelector('.proposal-unit-input');
              const presetSelect = item.querySelector('.proposal-preset-select');

              const existingTarget = existingCard.targetSmallest !== null && existingCard.targetSmallest !== undefined ? Number(existingCard.targetSmallest) : null;
              const existingCurrent = existingCard.currentSmallest !== null && existingCard.currentSmallest !== undefined ? Number(existingCard.currentSmallest) : null;
              const existingUnit = existingCard.levels?.[0]?.name || '%';
              const existingPreset = existingCard.preset || 'Custom';

              if (targetInput) {
                const tVal = parseFloat(targetInput.value);
                if (!isNaN(tVal) && tVal !== existingTarget) {
                  updates.targetSmallest = tVal;
                }
              }

              if (currentInput) {
                const cVal = parseFloat(currentInput.value);
                if (!isNaN(cVal) && cVal !== existingCurrent) {
                  updates.currentSmallest = cVal;
                }
              }

              const uVal = unitInput ? sanitizeUnit(unitInput.value) : existingUnit;
              const chosenPreset = presetSelect ? presetSelect.value : detectPreset(rawAction.preset, uVal);

              if (chosenPreset !== existingPreset || uVal !== existingUnit) {
                updates.preset = chosenPreset;
                if (chosenPreset === 'Time') {
                  updates.levels = [
                    { name: 'Minutes', conversionToNext: 60 },
                    { name: 'Hours', conversionToNext: null }
                  ];
                } else if (chosenPreset !== 'Custom') {
                  updates.levels = [{ name: chosenPreset, conversionToNext: null }];
                } else {
                  updates.levels = [{ name: uVal, conversionToNext: null }];
                }
              }
            } else if (cardType === 'checklist') {
              const itemRows = Array.from(item.querySelectorAll('.confirm-item-row'));
              const checkedItems = itemRows
                .filter(row => row.querySelector('.confirm-item-checkbox')?.checked)
                .map((row, iIdx) => ({
                  id: String(iIdx + 1),
                  text: row.querySelector('.confirm-item-text')?.value.trim() || `Item ${iIdx + 1}`,
                  done: false
                }));
              const finalItems = checkedItems.length ? checkedItems : [{ id: '1', text: 'Step 1', done: false }];
              const existingItems = Array.isArray(existingCard.items) ? existingCard.items : [];
              const itemsChanged = finalItems.length !== existingItems.length ||
                finalItems.some((it, i) => it.text !== existingItems[i]?.text);
              if (itemsChanged) {
                updates.items = finalItems;
                updates.targetSmallest = finalItems.length;
              }
            } else if (cardType === 'note') {
              const noteArea = item.querySelector('.proposal-note-textarea');
              const newText = noteArea ? noteArea.value : '';
              if (newText !== (existingCard.text || '')) {
                updates.text = newText;
              }
            }

            // 3. Deadline (Rescheduling must change only the deadline)
            let newDeadlineAt = null;
            let deadlineProvided = false;
            const dlInput = item.querySelector('.proposal-deadline-input');
            if (dlInput && dlInput.value) {
              const parsed = new Date(dlInput.value).getTime();
              if (!isNaN(parsed) && parsed > 0) {
                newDeadlineAt = parsed;
                deadlineProvided = true;
              }
            } else if (dlInput && !dlInput.value && existingCard.deadlineAt) {
              newDeadlineAt = null;
              deadlineProvided = true;
            } else if (rawAction.deadline) {
              try {
                const parsed = normalizeAiDeadline(rawAction.deadline);
                if (parsed && !isNaN(parsed)) {
                  newDeadlineAt = parsed;
                  deadlineProvided = true;
                }
              } catch (_) {}
            }

            const existingDeadline = existingCard.deadlineAt ? Number(existingCard.deadlineAt) : null;
            if (deadlineProvided && newDeadlineAt !== existingDeadline) {
              updates.deadlineAt = newDeadlineAt;
              updates.updateDeadline = true;
              updates.alertAtDeadline = !!newDeadlineAt;
            }

            // 4. Repeat / Recurring
            const recurringCheckbox = item.querySelector('.proposal-recurring-checkbox');
            const resetTimeInput = item.querySelector('.proposal-reset-time-input');
            if (recurringCheckbox) {
              const isRecurring = recurringCheckbox.checked;
              const newResetTime = (resetTimeInput && resetTimeInput.value) ? resetTimeInput.value : (rawAction.resetTime || '07:00');
              const existingIsRec = Boolean(existingCard.repeat);
              const existingResetTime = existingCard.repeat?.resetTime || '07:00';

              if (isRecurring !== existingIsRec || (isRecurring && newResetTime !== existingResetTime)) {
                if (isRecurring) {
                  updates.repeat = {
                    resetTime: newResetTime,
                    resetCount: null,
                    checklistResetEnabled: cardType === 'checklist',
                    deadlineResetEnabled: false,
                    lastResetAt: Date.now()
                  };
                } else {
                  updates.repeat = null;
                }
              }
            }

            if (typeof deps.handleEditBarFromAi === 'function') {
              await deps.handleEditBarFromAi(cardId, updates);
            }

            if (statusPill) {
              statusPill.className = 'proposal-item-status-pill applied';
              statusPill.textContent = '✓ Updated';
            }

            appliedActions.push({
              type: 'update',
              cardId: cardId,
              title: existingCard.title,
              undo: async () => {
                if (typeof deps.handleEditBarFromAi === 'function') {
                  await deps.handleEditBarFromAi(cardId, originalSnapshot);
                }
              }
            });
          } else {
            // Create
            const cardPayload = {
              title: finalTitle,
              type: cardType,
              preset: finalPreset,
              levels: levels,
              targetSmallest: targetSmallest,
              currentSmallest: currentSmallest,
              items: items,
              text: text,
              completed: false,
              createdAt: Date.now(),
              deadlineAt: deadlineAt,
              deadlineSetAt: deadlineAt ? Date.now() : null,
              notifyAt: null,
              notified: false,
              notifyPercent: null,
              alertAtDeadline: !!deadlineAt,
              deadlineNotified: false,
              repeat: repeat
            };

            let newBarId = null;
            if (typeof deps.handleCreateBarFromAi === 'function') {
              newBarId = await deps.handleCreateBarFromAi(cardPayload);
            }

            if (statusPill) {
              statusPill.className = 'proposal-item-status-pill applied';
              statusPill.textContent = '✓ Created';
            }

            appliedActions.push({
              type: 'create',
              newBarId: newBarId,
              title: finalTitle,
              undo: async () => {
                if (newBarId && typeof deps.handleDeleteBarFromAi === 'function') {
                  await deps.handleDeleteBarFromAi(newBarId);
                }
              }
            });
          }

          // Mark applied
          item.classList.add('proposal-item-applied');
          const cb = item.querySelector('.proposal-item-checkbox');
          if (cb) {
            cb.checked = false;
            cb.disabled = true;
          }
          item.querySelectorAll('input, select, textarea, button').forEach(el => {
            if (!el.classList.contains('proposal-item-discard-btn')) el.disabled = true;
          });
          successCount++;
        } catch (err) {
          console.error('[Assistant] Proposal apply failed:', err);
          failCount++;
          if (statusPill) {
            statusPill.className = 'proposal-item-status-pill failed';
            statusPill.textContent = '✕ Failed';
          }
          if (errorBox) {
            errorBox.classList.remove('hidden');
            errorBox.textContent = err.message || 'Operation failed';
          }
        }
      }

      // Batch / Single Undo Toast
      if (appliedActions.length > 1) {
        const creates = appliedActions.filter(a => a.type === 'create');
        const updates = appliedActions.filter(a => a.type === 'update');

        let batchMessage = '';
        if (creates.length === appliedActions.length) {
          batchMessage = `Created ${creates.length} cards`;
        } else if (updates.length === appliedActions.length) {
          batchMessage = `Updated ${updates.length} cards`;
        } else {
          batchMessage = `Applied ${appliedActions.length} cards`;
        }

        showUndoToast({
          message: batchMessage,
          undoText: 'Undo all',
          duration: 10000,
          onUndo: async () => {
            for (const action of [...appliedActions].reverse()) {
              try {
                await action.undo();
              } catch (e) {
                console.error('[Assistant] Batch undo step failed:', e);
              }
            }
            showToast('Undone: all changes reverted', 'info');
          }
        });
      } else if (appliedActions.length === 1) {
        const single = appliedActions[0];
        const actionWord = single.type === 'create' ? 'Created' : 'Updated';
        showUndoToast({
          message: `${actionWord} "${single.title}"`,
          undoText: 'Undo',
          duration: 10000,
          onUndo: async () => {
            await single.undo();
            showToast(`Undone: "${single.title}" ${single.type === 'create' ? 'removed' : 'restored'}`, 'info');
          }
        });
      }

      // Check remaining proposals
      const remainingUnapplied = sheet.querySelectorAll('.proposal-item:not(.proposal-item-discarded):not(.proposal-item-applied)');
      if (remainingUnapplied.length === 0) {
        const footer = sheet.querySelector('.proposal-sheet-footer');
        if (footer) {
          footer.innerHTML = `
            <div class="confirm-success-state" style="width: 100%;">
              <span>All proposals applied ✓</span>
              <button type="button" class="btn btn-secondary confirm-view-btn">View dashboard</button>
            </div>
          `;
          const viewBtn = footer.querySelector('.confirm-view-btn');
          if (viewBtn) {
            viewBtn.addEventListener('click', () => closeAssistantPanel());
          }
        }
      } else {
        updateCheckedCount();
        if (failCount > 0) {
          showToast(`${successCount} applied, ${failCount} failed. Check errors above.`, 'warning');
        }
      }

      const thread = document.getElementById('assistant-thread');
      if (thread) threadHtml = thread.innerHTML;
      syncActiveSessionThread();
    });
  }
}

// Retain legacy single-card listener for backwards compatibility
function attachActionCardListeners(card, rawAction) {
  if (!card) return;
  attachProposalsSheetListeners(card.closest('.assistant-proposals-sheet'), [rawAction]);
}

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
export const ACCEPTED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB
export const MAX_IMAGE_DIMENSION = 1600; // max 1600px on the longest side
export const JPEG_QUALITY = 0.8; // ~0.8

/**
 * Checks if a file is an accepted image format (PNG, JPEG, WebP).
 * @param {File|Blob} file
 * @returns {boolean}
 */
export function isAcceptedImageType(file) {
  if (!file) return false;
  const mime = (file.type || '').toLowerCase();
  if (mime && ACCEPTED_IMAGE_TYPES.includes(mime)) {
    return true;
  }
  const name = file.name || '';
  return ACCEPTED_IMAGE_EXTENSIONS.test(name);
}

/**
 * Downscales an image to max 1600px on the longest side and re-encodes as JPEG ~0.8.
 * @param {File|Blob} file
 * @returns {Promise<{ dataUrl: string, base64Data: string, sizeBytes: number, width: number, height: number, mimeType: string }>}
 */
export function processImageForAttachment(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      return reject(new Error('No file provided for processing.'));
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (!width || !height) {
          return reject(new Error('Could not determine image dimensions. File may be corrupt.'));
        }

        // Downscale to max 1600px on the longest side
        const longestSide = Math.max(width, height);
        if (longestSide > MAX_IMAGE_DIMENSION) {
          const ratio = MAX_IMAGE_DIMENSION / longestSide;
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Canvas 2D context is not supported in this environment.'));
        }

        // Fill background with white in case source has alpha transparency (PNG, WebP)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        if (typeof canvas.toBlob === 'function') {
          canvas.toBlob((blob) => {
            if (!blob) {
              return reject(new Error('Failed to encode image to JPEG.'));
            }

            const reader = new FileReader();
            reader.onloadend = () => {
              const dataUrl = reader.result;
              const base64Data = typeof dataUrl === 'string' ? dataUrl.split(',')[1] || '' : '';
              resolve({
                dataUrl,
                base64Data,
                sizeBytes: blob.size,
                width,
                height,
                mimeType: 'image/jpeg'
              });
            };
            reader.onerror = () => reject(new Error('Failed to read encoded image.'));
            reader.readAsDataURL(blob);
          }, 'image/jpeg', JPEG_QUALITY);
        } else {
          const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          const base64Data = dataUrl.split(',')[1] || '';
          const sizeBytes = Math.round((base64Data.length * 3) / 4);
          resolve({
            dataUrl,
            base64Data,
            sizeBytes,
            width,
            height,
            mimeType: 'image/jpeg'
          });
        }
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image. Please verify it is a valid image file.'));
    };

    img.src = objectUrl;
  });
}

export function showAttachmentError(msg) {
  const errEl = document.getElementById('assistant-attachment-error');
  if (errEl) {
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
  }
  showToast(msg, 'error');
}

export function clearAttachmentError() {
  const errEl = document.getElementById('assistant-attachment-error');
  if (errEl) {
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }
}

export function clearAttachment() {
  attachedImage = null;
  clearAttachmentError();
  const preview = document.getElementById('assistant-attachment-preview');
  const thumb = document.getElementById('assistant-attachment-thumb');
  const nameSpan = document.getElementById('assistant-attachment-name');
  const fileInput = document.getElementById('assistant-file-input');

  if (preview) preview.classList.add('hidden');
  if (thumb) thumb.src = '';
  if (nameSpan) {
    nameSpan.textContent = '';
    nameSpan.title = '';
  }
  if (fileInput) fileInput.value = '';

  updateAssistantControlsState();
}

export async function setAttachment(file) {
  if (!file) return;

  clearAttachmentError();

  if (!isAcceptedImageType(file)) {
    clearAttachment();
    showAttachmentError('Unsupported file type. Please attach a PNG, JPEG, or WebP image.');
    return;
  }

  // Provide immediate processing feedback
  const preview = document.getElementById('assistant-attachment-preview');
  const nameSpan = document.getElementById('assistant-attachment-name');
  if (nameSpan) {
    nameSpan.textContent = 'Processing image...';
  }
  if (preview) {
    preview.classList.remove('hidden');
  }

  try {
    const processed = await processImageForAttachment(file);

    // Verify compressed result does not exceed 3 MB
    if (processed.sizeBytes > MAX_IMAGE_BYTES) {
      clearAttachment();
      const mbSize = (processed.sizeBytes / (1024 * 1024)).toFixed(1);
      showAttachmentError(`Image size (${mbSize} MB after compression) exceeds the 3 MB limit. Please choose a smaller image.`);
      return;
    }

    attachedImage = {
      name: file.name,
      mimeType: processed.mimeType, // 'image/jpeg'
      data: processed.base64Data,
      dataUrl: processed.dataUrl,
      sizeBytes: processed.sizeBytes,
      width: processed.width,
      height: processed.height
    };

    const thumb = document.getElementById('assistant-attachment-thumb');
    if (thumb) {
      thumb.src = processed.dataUrl;
    }
    if (nameSpan) {
      const displaySize = processed.sizeBytes >= 1024 * 1024
        ? `${(processed.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.round(processed.sizeBytes / 1024)} KB`;
      nameSpan.textContent = `${file.name} (${displaySize})`;
      nameSpan.title = `${file.name} (${displaySize}, ${processed.width}×${processed.height}px)`;
    }
    if (preview) {
      preview.classList.remove('hidden');
    }

    updateAssistantControlsState();
  } catch (err) {
    console.error('[Assistant] Image attachment processing error:', err);
    clearAttachment();
    showAttachmentError(err.message || 'Failed to process image attachment.');
  }
}

/* ==========================================================================
   AI SETTINGS MODAL & INITIALIZATION
   ========================================================================== */

export function renderAiSettingsError(err) {
  const body = document.getElementById('ai-settings-modal-body');
  if (!body) return;
  const isOffline = !navigator.onLine;
  const hint = isOffline ? 'You appear to be offline. Check your network connection.' : 'Please check your connection and try again.';
  body.innerHTML = `
    <div class="ai-settings-item">
      <div class="ai-settings-status-row" style="margin-bottom: 8px;">
        <span class="ai-settings-status-text" style="color: var(--text-primary); font-weight: 600;">Can't reach the AI service</span>
      </div>
      <p class="assistant-state-desc" style="margin-bottom: 16px;">${escapeHtml(hint)}</p>
      <button type="button" id="btn-ai-settings-retry" class="btn btn-secondary">Retry</button>
    </div>
  `;
  const retryBtn = document.getElementById('btn-ai-settings-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      body.innerHTML = `
        <div class="assistant-loading-state" style="padding: 10px 0;">
          <div class="assistant-skeleton assistant-skeleton-header"></div>
          <div class="assistant-skeleton assistant-skeleton-line"></div>
        </div>
      `;
      try {
        currentAiStatus = await aiStatus();
        renderAiSettingsModalBody(currentAiStatus);
      } catch (e) {
        renderAiSettingsError(e);
      }
    });
  }
}

export async function openAiSettingsModal() {
  closeAllMenus();
  const modal = document.getElementById('modal-ai-settings');
  const body = document.getElementById('ai-settings-modal-body');
  if (!modal || !body) return;

  openModal(modal);

  if (isGuestMode()) {
    body.innerHTML = `
      <div class="ai-settings-item">
        <p class="assistant-state-desc">Please sign in to configure AI settings and connect your Gemini key.</p>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="assistant-loading-state" style="padding: 10px 0;">
      <div class="assistant-skeleton assistant-skeleton-header"></div>
      <div class="assistant-skeleton assistant-skeleton-line"></div>
    </div>
  `;

  try {
    if (!currentAiStatus) {
      currentAiStatus = await aiStatus();
    }
    renderAiSettingsModalBody(currentAiStatus);
  } catch (err) {
    renderAiSettingsError(err);
  }
}

function getAiHistorySectionHtml() {
  const sessions = getChatSessions();
  return `
    <div class="ai-settings-history-section">
      <div class="ai-settings-history-row">
        <div class="ai-settings-history-info">
          <span class="ai-settings-history-title">Save chat history</span>
          <span class="ai-settings-history-sub">Keep past conversations locally on this device. Off by default.</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="ai-toggle-history" ${isAiHistoryEnabled() ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div id="ai-settings-clear-wrap" class="ai-settings-clear-wrap ${sessions.length > 0 ? '' : 'hidden'}">
        <button type="button" id="btn-ai-clear-history" class="btn btn-secondary btn-sm" style="font-size: 0.8rem; padding: 6px 12px;">Clear chat history (${sessions.length})</button>
      </div>
      <div class="ai-settings-history-row" style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--card-border);">
        <div class="ai-settings-history-info">
          <span class="ai-settings-history-title">Show Today's Focus on dashboard</span>
          <span class="ai-settings-history-sub">Display your daily breakdown card next to Add New Tracker on home.</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="ai-toggle-home-briefing" ${isHomeBriefingHidden() ? '' : 'checked'}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
  `;
}

function attachHistorySettingsListeners() {
  const toggle = document.getElementById('ai-toggle-history');
  const toggleHome = document.getElementById('ai-toggle-home-briefing');
  const clearWrap = document.getElementById('ai-settings-clear-wrap');
  const clearBtn = document.getElementById('btn-ai-clear-history');

  if (toggle) {
    toggle.addEventListener('change', () => {
      setAiHistoryEnabled(toggle.checked);
      showToast(toggle.checked ? 'Chat history enabled' : 'Chat history disabled', 'info');
      renderHistoryPaneList();
    });
  }

  if (toggleHome) {
    toggleHome.addEventListener('change', () => {
      setHomeBriefingHidden(!toggleHome.checked);
      showToast(toggleHome.checked ? "Today's Focus enabled on dashboard" : "Today's Focus hidden from dashboard", 'info');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearAllChatSessions();
      startNewConversation({ toast: false });
      if (clearWrap) clearWrap.classList.add('hidden');
      renderHistoryPaneList();
      showToast('All past conversations cleared', 'info');
    });
  }
}

export function renderAiSettingsModalBody(status) {
  const body = document.getElementById('ai-settings-modal-body');
  if (!body) return;

  if (!status || !status.connected) {
    body.innerHTML = `
      <div class="ai-settings-item">
        <div class="ai-settings-status-row">
          <span class="ai-settings-status-text">No Gemini API key connected</span>
        </div>
        <form id="ai-settings-connect-form" class="assistant-connect-form">
          <div class="assistant-key-field-wrap">
            <input type="password" id="ai-settings-key-input" class="assistant-key-input" placeholder="Enter Gemini API key" autocomplete="off" spellcheck="false" required>
            <button type="button" id="btn-ai-settings-toggle-key" class="assistant-key-eye-btn" title="Show or hide key" aria-label="Toggle key visibility">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
          <div id="ai-settings-connect-error" class="assistant-connect-error hidden" role="alert"></div>
          <button type="submit" id="btn-ai-settings-save-key" class="btn btn-primary">Save &amp; test</button>
        </form>
        <p class="assistant-notice">Your key is stored encrypted and used only to send your requests to Google. Card text and photos you send go to Google; avoid sensitive information. Remove your key anytime in AI settings.</p>
        ${getAiHistorySectionHtml()}
      </div>
    `;

    attachHistorySettingsListeners();

    const keyInput = document.getElementById('ai-settings-key-input');
    const eyeBtn = document.getElementById('btn-ai-settings-toggle-key');
    if (eyeBtn && keyInput) {
      eyeBtn.addEventListener('click', () => {
        keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      });
    }

    const form = document.getElementById('ai-settings-connect-form');
    const errBox = document.getElementById('ai-settings-connect-error');
    const saveBtn = document.getElementById('btn-ai-settings-save-key');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const keyVal = keyInput ? keyInput.value.trim() : '';
        if (!keyVal) return;
        if (errBox) errBox.classList.add('hidden');
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Testing & saving...';
        }
        try {
          const res = await aiSaveKey(keyVal);
          currentAiStatus = res;
          renderAiSettingsModalBody(res);
          renderAssistantState(res);
          showToast('Gemini API key connected successfully', 'success');
        } catch (err) {
          if (errBox) {
            errBox.textContent = formatAiErrorMessage(err);
            errBox.classList.remove('hidden');
          }
        } finally {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save & test';
          }
        }
      });
    }
    return;
  }

  // Connected state in settings modal
  body.innerHTML = `
    <div class="ai-settings-item">
      <div class="ai-settings-status-row">
        <span class="assistant-connected-dot"></span>
        <span class="ai-settings-status-text">Connected ••••${escapeHtml(status.last4 || '••••')}</span>
      </div>
      <div class="ai-settings-actions">
        <button type="button" id="btn-ai-replace-key" class="btn btn-secondary">Replace key</button>
        <button type="button" id="btn-ai-remove-key" class="btn btn-danger">Remove key</button>
      </div>

      <div id="ai-replace-key-form-wrap" class="ai-replace-key-form-wrap hidden">
        <form id="ai-replace-form" class="assistant-connect-form">
          <div class="assistant-key-field-wrap">
            <input type="password" id="ai-replace-key-input" class="assistant-key-input" placeholder="Enter new Gemini API key" autocomplete="off" spellcheck="false" required>
            <button type="button" id="btn-ai-replace-toggle-key" class="assistant-key-eye-btn" title="Show or hide key" aria-label="Toggle key visibility">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
          <div id="ai-replace-error" class="assistant-connect-error hidden" role="alert"></div>
          <button type="submit" id="btn-ai-replace-save" class="btn btn-primary">Save &amp; test</button>
        </form>
      </div>

      <div id="ai-remove-confirm-wrap" class="ai-remove-confirm-wrap hidden">
        <p class="ai-remove-warning">Are you sure you want to remove your Gemini key? Assistant features will be disconnected.</p>
        <div class="ai-remove-confirm-actions">
          <button type="button" id="btn-ai-confirm-remove" class="btn btn-danger">Yes, remove</button>
          <button type="button" id="btn-ai-cancel-remove" class="btn btn-secondary">Cancel</button>
        </div>
      </div>

      <p class="assistant-notice">Card text and photos you send go to Google; avoid sensitive information.</p>

      ${getAiHistorySectionHtml()}
    </div>
  `;

  attachHistorySettingsListeners();

  const btnReplace = document.getElementById('btn-ai-replace-key');
  const replaceWrap = document.getElementById('ai-replace-key-form-wrap');
  const btnRemove = document.getElementById('btn-ai-remove-key');
  const removeWrap = document.getElementById('ai-remove-confirm-wrap');
  const btnCancelRemove = document.getElementById('btn-ai-cancel-remove');
  const btnConfirmRemove = document.getElementById('btn-ai-confirm-remove');

  if (btnReplace && replaceWrap) {
    btnReplace.addEventListener('click', () => {
      replaceWrap.classList.toggle('hidden');
      if (removeWrap) removeWrap.classList.add('hidden');
    });
  }

  const replaceInput = document.getElementById('ai-replace-key-input');
  const replaceEye = document.getElementById('btn-ai-replace-toggle-key');
  if (replaceEye && replaceInput) {
    replaceEye.addEventListener('click', () => {
      replaceInput.type = replaceInput.type === 'password' ? 'text' : 'password';
    });
  }

  const replaceForm = document.getElementById('ai-replace-form');
  const replaceErr = document.getElementById('ai-replace-error');
  const replaceSave = document.getElementById('btn-ai-replace-save');
  if (replaceForm) {
    replaceForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = replaceInput ? replaceInput.value.trim() : '';
      if (!val) return;
      if (replaceErr) replaceErr.classList.add('hidden');
      if (replaceSave) {
        replaceSave.disabled = true;
        replaceSave.textContent = 'Testing & saving...';
      }
      try {
        const res = await aiSaveKey(val);
        currentAiStatus = res;
        renderAiSettingsModalBody(res);
        renderAssistantState(res);
        showToast('Gemini API key updated', 'success');
      } catch (err) {
        if (replaceErr) {
          replaceErr.textContent = formatAiErrorMessage(err);
          replaceErr.classList.remove('hidden');
        }
      } finally {
        if (replaceSave) {
          replaceSave.disabled = false;
          replaceSave.textContent = 'Save & test';
        }
      }
    });
  }

  if (btnRemove && removeWrap) {
    btnRemove.addEventListener('click', () => {
      removeWrap.classList.toggle('hidden');
      if (replaceWrap) replaceWrap.classList.add('hidden');
    });
  }

  if (btnCancelRemove && removeWrap) {
    btnCancelRemove.addEventListener('click', () => {
      removeWrap.classList.add('hidden');
    });
  }

  if (btnConfirmRemove) {
    btnConfirmRemove.addEventListener('click', async () => {
      btnConfirmRemove.disabled = true;
      btnConfirmRemove.textContent = 'Removing...';
      try {
        await aiRemoveKey();
        currentAiStatus = { connected: false, last4: null };
        renderAiSettingsModalBody(currentAiStatus);
        renderAssistantState(currentAiStatus);
        showToast('Gemini API key removed', 'info');
      } catch (err) {
        showToast(err.message || 'Failed to remove key', 'error');
      }
    });
  }
}

export function setupAssistantModule(injectedDeps = {}) {
  deps = { ...deps, ...injectedDeps };

  // Background check for AI status to power the home dashboard briefing card immediately
  if (!isGuestMode() && !currentAiStatus) {
    aiStatus().then(status => {
      currentAiStatus = status;
      if (typeof deps.onHomeBriefingVisibilityChanged === 'function') {
        deps.onHomeBriefingVisibilityChanged();
      }
    }).catch(e => {
      console.warn('[Assistant] Initial AI status check notice:', e);
    });
  }

  const btnAssistant = document.getElementById('btn-assistant');
  const btnFabAi = document.getElementById('btn-fab-ai');
  const btnClose = document.getElementById('btn-assistant-close');
  const btnHistory = document.getElementById('btn-assistant-history');
  const btnNewChat = document.getElementById('btn-assistant-new-chat');
  const btnHistoryClose = document.getElementById('btn-history-close');
  const btnHistoryNewChat = document.getElementById('btn-history-new-chat');
  const backdrop = document.getElementById('assistant-backdrop');
  const btnProfileAi = document.getElementById('btn-profile-ai-settings');
  const textarea = document.getElementById('assistant-input');
  const btnSend = document.getElementById('btn-assistant-send');
  const btnAttach = document.getElementById('btn-assistant-attach');
  const fileInput = document.getElementById('assistant-file-input');
  const btnRemoveAttach = document.getElementById('btn-assistant-remove-attachment');

  const chipPlan = document.getElementById('chip-plan-day');
  const chipClean = document.getElementById('chip-cleanup-overdue');
  const chipBreakdown = document.getElementById('chip-breakdown-goal');
  const chipMention = document.getElementById('chip-mention-card');
  const btnRemoveContext = document.getElementById('btn-remove-context');
  const inputCard = document.querySelector('.assistant-input-card');

  if (btnAssistant) {
    btnAssistant.onclick = (e) => {
      e.stopPropagation();
      toggleAssistantPanel();
    };
  }
  if (btnFabAi) {
    btnFabAi.onclick = (e) => {
      e.stopPropagation();
      toggleAssistantPanel();
    };
  }
  if (btnClose) {
    btnClose.addEventListener('click', closeAssistantPanel);
  }
  if (btnHistory) {
    btnHistory.addEventListener('click', toggleHistoryPane);
  }
  if (btnNewChat) {
    btnNewChat.addEventListener('click', () => startNewConversation({ toast: true }));
  }
  if (btnHistoryClose) {
    btnHistoryClose.addEventListener('click', closeHistoryPane);
  }
  if (btnHistoryNewChat) {
    btnHistoryNewChat.addEventListener('click', () => startNewConversation({ toast: true }));
  }
  if (backdrop) {
    backdrop.addEventListener('click', closeAssistantPanel);
  }
  if (btnProfileAi) {
    btnProfileAi.addEventListener('click', openAiSettingsModal);
  }

  // Focus textarea when clicking in prompt card container (excluding action buttons and remove context button)
  if (inputCard && textarea) {
    inputCard.addEventListener('click', (e) => {
      if (
        e.target.closest('#btn-remove-context') ||
        e.target.closest('#btn-assistant-attach') ||
        e.target.closest('#btn-assistant-send') ||
        e.target.closest('.assistant-input-toolbar-left')
      ) {
        return;
      }
      textarea.focus();
    });
  }

  // Remove card context pill listener
  if (btnRemoveContext) {
    btnRemoveContext.addEventListener('click', (e) => {
      e.stopPropagation();
      clearActiveCardContext();
      if (textarea) textarea.focus();
    });
  }

  // Auto-growing textarea, @-mention detection & key navigation
  if (textarea) {
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
      updateAssistantControlsState();

      const val = textarea.value;
      const cursorPos = textarea.selectionStart;
      const before = val.slice(0, cursorPos);
      const atMatch = before.match(/@([^@\s]*)$/);

      if (atMatch) {
        openMentionPopover(atMatch[1]);
      } else {
        closeMentionPopover();
        renderCardSuggestions(val);
      }
    });

    textarea.addEventListener('keydown', (e) => {
      const popover = document.getElementById('assistant-mention-popover');
      const isPopoverOpen = popover && !popover.classList.contains('hidden');

      if (isPopoverOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          updateMentionSelection(mentionPopoverSelectedIndex + 1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          updateMentionSelection(mentionPopoverSelectedIndex - 1);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (mentionFilteredCards.length > 0 && mentionFilteredCards[mentionPopoverSelectedIndex]) {
            selectMentionCard(mentionFilteredCards[mentionPopoverSelectedIndex]);
          } else {
            closeMentionPopover();
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMentionPopover();
          return;
        }
      }

      // Backspace with empty text removes active card context
      if (e.key === 'Backspace' && textarea.value === '' && activeCardContext) {
        e.preventDefault();
        clearActiveCardContext();
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitCurrentPrompt();
      }
    });

    // Paste listener for images on textarea
    textarea.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            setAttachment(file);
            break;
          }
        }
      }
    });
  }

  // Drag & drop support on the prompt card
  if (inputCard) {
    inputCard.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    inputCard.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files?.[0]) {
        setAttachment(e.dataTransfer.files[0]);
      }
    });
  }

  // Global click outside to dismiss @-mention popover
  document.addEventListener('click', (e) => {
    const popover = document.getElementById('assistant-mention-popover');
    if (popover && !popover.classList.contains('hidden')) {
      if (
        !e.target.closest('#assistant-mention-popover') &&
        !e.target.closest('#chip-mention-card') &&
        e.target !== textarea
      ) {
        closeMentionPopover();
      }
    }
  });

  if (btnSend) {
    btnSend.addEventListener('click', submitCurrentPrompt);
  }

  triggerSubmitPrompt = submitCurrentPrompt;

  function submitCurrentPrompt() {
    if (!textarea) return;
    const val = textarea.value.trim();
    if (!val && !attachedImage && !activeCardContext) return;

    handleAssistantPrompt(val);
    textarea.value = '';
    textarea.style.height = 'auto';
    hideCardSuggestions();
    closeMentionPopover();
    updateAssistantControlsState();
  }

  // File attach listeners
  if (btnAttach && fileInput) {
    btnAttach.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) {
        setAttachment(fileInput.files[0]);
      }
    });
  }

  if (btnRemoveAttach) {
    btnRemoveAttach.addEventListener('click', clearAttachment);
  }

  // Chip 1: Plan my day
  if (chipPlan) {
    chipPlan.addEventListener('click', () => {
      handleAssistantPrompt('Plan my day based on my current cards and priorities.');
    });
  }

  // Chip 2: Clean up overdue
  if (chipClean) {
    chipClean.addEventListener('click', () => {
      handleAssistantPrompt('Review my overdue and lagging trackers and suggest how to clean them up or reschedule them.');
    });
  }

  // Chip 3: Break down a goal
  if (chipBreakdown) {
    chipBreakdown.addEventListener('click', () => {
      if (!textarea) return;
      const val = textarea.value.trim();
      if (val) {
        handleAssistantPrompt(`Break down: ${val}`);
        textarea.value = '';
        textarea.style.height = 'auto';
        hideCardSuggestions();
        closeMentionPopover();
        updateAssistantControlsState();
      } else {
        openMentionPopover('');
        textarea.placeholder = 'Select a card or type to filter...';
        textarea.focus();
      }
    });
  }

  // Chip 4: Mention a card (@ capsule)
  if (chipMention) {
    chipMention.addEventListener('click', () => {
      if (!textarea) return;
      textarea.focus();
      openMentionPopover('');
    });
  }

  // Expose assistant controls on window for global access/testing
  window.openAssistantPanel = openAssistantPanel;
  window.closeAssistantPanel = closeAssistantPanel;
  window.toggleAssistantPanel = toggleAssistantPanel;
  window.fetchAndRenderAssistant = fetchAndRenderAssistant;
  window.renderAssistantState = renderAssistantState;
  window.renderAssistantErrorState = renderAssistantErrorState;
  window.renderSkeletonAssistant = renderSkeletonAssistant;
  window.openAiSettingsModal = openAiSettingsModal;
  window.renderAiSettingsModalBody = renderAiSettingsModalBody;
  window.renderAiSettingsError = renderAiSettingsError;
  window.formatAiErrorMessage = formatAiErrorMessage;
  window.handleAssistantPrompt = handleAssistantPrompt;
  window.renderCardSuggestions = renderCardSuggestions;
  window.isAiHistoryEnabled = isAiHistoryEnabled;
  window.setAiHistoryEnabled = setAiHistoryEnabled;
  window.getChatSessions = getChatSessions;
  window.saveChatSessions = saveChatSessions;
  window.clearAllChatSessions = clearAllChatSessions;
  window.startNewConversation = startNewConversation;
  window.openHistoryPane = openHistoryPane;
  window.closeHistoryPane = closeHistoryPane;
  window.toggleHistoryPane = toggleHistoryPane;
  window.renderHistoryPaneList = renderHistoryPaneList;
  window.loadChatSession = loadChatSession;
  window.replaceExpiredProposals = replaceExpiredProposals;
  window.deleteChatSession = deleteChatSession;
  window.setActiveCardContext = setActiveCardContext;
  window.clearActiveCardContext = clearActiveCardContext;
  window.openMentionPopover = openMentionPopover;
  window.closeMentionPopover = closeMentionPopover;
  window.selectMentionCard = selectMentionCard;
  window.getActiveCardContext = () => activeCardContext;
  window.setAttachment = setAttachment;
  window.clearAttachment = clearAttachment;
  window.isAcceptedImageType = isAcceptedImageType;
  window.processImageForAttachment = processImageForAttachment;
  window.stripImagesFromThreadHtml = stripImagesFromThreadHtml;
  window.showUndoToast = showUndoToast;
  window.renderActionConfirmSheet = renderActionConfirmSheet;
  window.fetchAndRenderDailyBriefing = fetchAndRenderDailyBriefing;
  window.getCachedBriefing = getCachedBriefing;
  window.saveCachedBriefing = saveCachedBriefing;
  window.computeCardsHash = computeCardsHash;
  window.getTodayLocalDateStr = getTodayLocalDateStr;
  window.isBriefingValid = isBriefingValid;
  window.updateBriefingDisplayMode = updateBriefingDisplayMode;
  window.setCachedBriefingFromSupabase = setCachedBriefingFromSupabase;
  window.getHomeBriefingCardElement = getHomeBriefingCardElement;
  window.isHomeBriefingHidden = isHomeBriefingHidden;
  window.setHomeBriefingHidden = setHomeBriefingHidden;
  window.setHomeBriefingHiddenFromRemote = setHomeBriefingHiddenFromRemote;
  window.isGuestAiCardDismissed = isGuestAiCardDismissed;
  window.setGuestAiCardDismissed = setGuestAiCardDismissed;
  window.isUnconfiguredAiCardDismissed = isUnconfiguredAiCardDismissed;
  window.setUnconfiguredAiCardDismissed = setUnconfiguredAiCardDismissed;
}
