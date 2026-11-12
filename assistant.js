/**
 * ProgressShelf AI Assistant UI Module
 * Handles the conversational assistant drawer panel, Connect Gemini flow, AI Settings modal,
 * full card awareness, and interactive Shared Confirmation Sheets for create, update, breakdown, and delete.
 */

import { isGuestMode, exitGuestMode } from "./auth.js?v=3.2";
import { aiStatus, aiSaveKey, aiRemoveKey, aiGenerate } from "./ai.js?v=3.2";

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

export function getChatSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHAT_SESSIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export function saveChatSessions(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY_CHAT_SESSIONS, JSON.stringify(sessions));
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

let deps = {
  closeAllMenus: () => {},
  openModal: () => {},
  showToast: () => {},
  escapeHtml: (s) => safeEscapeHtml(s),
  handleCreateBarFromAi: async () => {},
  handleEditBarFromAi: async () => {},
  handleDeleteBarFromAi: async () => {},
  getLiveBars: () => [],
};

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
  if (lower.includes('rate limit') || lower.includes('rate_limit') || lower.includes('too many requests') || lower.includes('429')) {
    return 'Rate limit exceeded. Please try again later.';
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
    <div class="assistant-state-panel assistant-loading-state">
      <div class="assistant-skeleton assistant-skeleton-header"></div>
      <div class="assistant-skeleton assistant-skeleton-card"></div>
      <div class="assistant-skeleton assistant-skeleton-line"></div>
      <div class="assistant-skeleton assistant-skeleton-line-sm"></div>
    </div>
  `;
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
  const btnAttach = document.getElementById('btn-assistant-attach');
  const btnSend = document.getElementById('btn-assistant-send');
  const textarea = document.getElementById('assistant-input');

  const hasInput = textarea && textarea.value.trim().length > 0;
  const hasAttachment = attachedImage !== null;

  if (chipPlan) chipPlan.disabled = !isConnected || isGenerating;
  if (chipClean) chipClean.disabled = !isConnected || isGenerating;
  if (chipBreakdown) chipBreakdown.disabled = !isConnected || isGenerating;
  if (btnAttach) btnAttach.disabled = !isConnected || isGenerating;
  if (btnSend) {
    btnSend.disabled = !isConnected || isGenerating || (!hasInput && !hasAttachment);
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
      loginBtn.addEventListener('click', () => {
        exitGuestMode();
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

        <div id="assistant-today-placeholder" class="assistant-today-placeholder ${threadHtml ? 'hidden' : ''}">
          <div class="assistant-today-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
          </div>
          <h4 class="assistant-today-title">Your Personal Progress Companion</h4>
          <p class="assistant-today-sub">I can see your cards, help you plan your day, break down complex goals, or chat about your habits.</p>
        </div>

        <div id="assistant-thread" class="assistant-thread">${threadHtml}</div>
      </div>
    `;

    const settingsBtn = document.getElementById('btn-assistant-open-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        openAiSettingsModal();
      });
    }

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

      <p class="assistant-notice">Your key is stored encrypted and used only to send your requests to Google. Card text you send goes to Google; avoid sensitive information. Remove your key anytime in AI settings.</p>
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

export function openAssistantPanel() {
  if (isAssistantPanelOpen) return;
  isAssistantPanelOpen = true;
  closeAllMenus();

  const backdrop = document.getElementById('assistant-backdrop');
  const panel = document.getElementById('assistant-panel');
  const btn = document.getElementById('btn-assistant');

  if (backdrop) backdrop.classList.remove('hidden');
  if (panel) panel.classList.remove('hidden');
  if (btn) btn.classList.add('active');

  fetchAndRenderAssistant();
}

export function closeAssistantPanel() {
  if (!isAssistantPanelOpen) return;
  isAssistantPanelOpen = false;

  closeHistoryPane();

  const backdrop = document.getElementById('assistant-backdrop');
  const panel = document.getElementById('assistant-panel');
  const btn = document.getElementById('btn-assistant');

  if (backdrop) backdrop.classList.add('hidden');
  if (panel) panel.classList.add('hidden');
  if (btn) btn.classList.remove('active');
}

export function toggleAssistantPanel() {
  if (isAssistantPanelOpen) {
    closeAssistantPanel();
  } else {
    openAssistantPanel();
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

  const placeholder = document.getElementById('assistant-today-placeholder');
  if (placeholder) {
    placeholder.classList.remove('hidden');
  }

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

export function loadChatSession(session) {
  if (!session) return;
  activeSessionId = session.id;
  conversationHistory = Array.isArray(session.history) ? [...session.history] : [];
  threadHtml = session.threadHtml || '';

  const thread = document.getElementById('assistant-thread');
  if (thread) {
    thread.innerHTML = threadHtml;
    attachThreadCardListeners();
  }

  const placeholder = document.getElementById('assistant-today-placeholder');
  if (placeholder) {
    if (threadHtml) {
      placeholder.classList.add('hidden');
    } else {
      placeholder.classList.remove('hidden');
    }
  }

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
  }
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
      const title = pill.dataset.cardTitle;
      const textarea = document.getElementById('assistant-input');
      if (textarea) {
        textarea.value = `Break down: ${title}`;
        textarea.focus();
        updateAssistantControlsState();
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

  const text = (userText || '').trim();
  const img = options.image || attachedImage;

  if (!text && !img) return;

  isGenerating = true;
  hideCardSuggestions();
  updateAssistantControlsState();

  // Hide today placeholder if visible
  const placeholder = document.getElementById('assistant-today-placeholder');
  if (placeholder) placeholder.classList.add('hidden');

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
  if (text) {
    userContentHtml += `<div>${escapeHtml(text)}</div>`;
  }

  const userMsgHtml = `
    <div id="${userMsgId}" class="assistant-msg assistant-msg-user">
      ${userContentHtml}
    </div>
  `;
  thread.insertAdjacentHTML('beforeend', userMsgHtml);

  // Initialize and persist session if history is enabled
  if (isAiHistoryEnabled() && !activeSessionId) {
    activeSessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const titleText = text ? (text.length > 36 ? text.slice(0, 33) + '...' : text) : 'Image prompt';
    const sessions = getChatSessions();
    sessions.unshift({
      id: activeSessionId,
      title: titleText,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      history: [{ role: 'user', text }],
      threadHtml: thread.innerHTML
    });
    saveChatSessions(sessions);
  }

  // 2. Append Thinking Indicator
  const thinkingId = 'thinking-' + Date.now();
  const thinkingHtml = `
    <div id="${thinkingId}" class="assistant-msg assistant-msg-bot">
      <div class="assistant-thinking-indicator">
        <span>Thinking with Gemini</span>
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

  const payload = {
    message: text,
    history: sanitizedHistory,
    cards: cardsSummary,
    currentDate: new Date().toISOString(),
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
    conversationHistory.push({ role: 'user', text });
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

    // 5. If AI proposes an action (create, update, delete, breakdown), render Confirmation Sheet!
    if (result.hasAction && result.action) {
      renderActionConfirmSheet(result.action, replyId);
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
      sessions[idx].threadHtml = threadHtml;
      saveChatSessions(sessions);
    }
  }
}

/**
 * Renders the Confirmation Sheet card directly below an assistant reply.
 */
function renderActionConfirmSheet(action, parentMsgId) {
  const parentMsg = document.getElementById(parentMsgId);
  if (!parentMsg) return;

  const cardId = 'confirm-' + Date.now();
  const actType = (action.type || 'create').toLowerCase();
  const isDelete = actType === 'delete';
  const isUpdate = actType === 'update';

  const rawCardType = (action.cardType || 'goal').toLowerCase();
  const cardType = rawCardType === 'checklist' ? 'checklist' : (rawCardType === 'note' ? 'note' : 'goal');
  const typeLabel = cardType === 'checklist' ? 'Checklist' : (cardType === 'note' ? 'Markdown Note' : 'Goal Tracker');

  // Safety check: For update & delete, look up the target card locally by cardId to use the real title and verify existence
  const liveBars = typeof deps.getLiveBars === 'function' ? deps.getLiveBars() : [];
  let existingCard = null;
  if (action.cardId && (isDelete || isUpdate)) {
    existingCard = liveBars.find(b => String(b.id) === String(action.cardId));
  }

  let title = action.title || (isDelete ? 'Delete Tracker' : 'New Tracker');
  let notFoundWarning = '';
  if (isDelete || isUpdate) {
    if (existingCard) {
      title = existingCard.title; // Always display verified title from local state
    } else {
      notFoundWarning = 'Target tracker not found in your list. It may have been deleted or moved.';
    }
  }

  const explanation = action.explanation || '';

  let statusBadgeText = 'Ready to create';
  if (isDelete) statusBadgeText = 'Confirm deletion';
  if (isUpdate) statusBadgeText = 'Ready to update';

  // Fields markup
  let typeFieldsHtml = '';
  if (!isDelete) {
    if (cardType === 'goal') {
      const targetVal = typeof action.target === 'number' ? action.target : 100;
      const unitVal = action.unit || '%';
      typeFieldsHtml = `
        <div class="confirm-row-2col">
          <div class="confirm-field-group">
            <label class="confirm-field-label">Target</label>
            <input type="number" class="confirm-input confirm-target-input" value="${targetVal}" min="1" step="any">
          </div>
          <div class="confirm-field-group">
            <label class="confirm-field-label">Unit</label>
            <input type="text" class="confirm-input confirm-unit-input" value="${escapeHtml(unitVal)}">
          </div>
        </div>
      `;
    } else if (cardType === 'checklist') {
      const items = Array.isArray(action.items) && action.items.length ? action.items : [{ text: 'Step 1' }];
      const itemsHtml = items.map((it, idx) => `
        <div class="confirm-item-row" data-idx="${idx}">
          <input type="checkbox" class="confirm-item-checkbox" checked title="Include in tracker">
          <input type="text" class="confirm-item-text" value="${escapeHtml(it.text || '')}">
        </div>
      `).join('');

      typeFieldsHtml = `
        <div class="confirm-field-group">
          <label class="confirm-field-label">Checklist Items (${items.length})</label>
          <div class="confirm-items-list">
            ${itemsHtml}
          </div>
        </div>
      `;
    } else if (cardType === 'note') {
      const noteText = action.noteText || '';
      typeFieldsHtml = `
        <div class="confirm-field-group">
          <label class="confirm-field-label">Note Content</label>
          <textarea class="confirm-input confirm-note-textarea" rows="4">${escapeHtml(noteText)}</textarea>
        </div>
      `;
    }
  }

  // Meta Badges
  let metaBadgesHtml = '';
  if (action.deadline) {
    let displayDeadline = action.deadline;
    try {
      displayDeadline = new Date(action.deadline).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {}
    metaBadgesHtml += `
      <div class="confirm-meta-chip">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Deadline: ${escapeHtml(displayDeadline)}</span>
      </div>
    `;
  }

  if (action.isRecurring) {
    metaBadgesHtml += `
      <div class="confirm-meta-chip">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        <span>Repeats daily at ${escapeHtml(action.resetTime || '08:00')}</span>
      </div>
    `;
  }

  const primaryBtnClass = isDelete ? 'btn-danger' : 'btn-primary';
  const primaryBtnText = isDelete ? 'Delete Tracker' : (isUpdate ? 'Apply Update' : 'Create Tracker');

  const confirmCardHtml = `
    <div id="${cardId}" class="assistant-confirm-card" data-action-type="${actType}" data-card-id="${escapeHtml(action.cardId || '')}" data-card-type="${cardType}">
      <div class="confirm-card-header">
        <div class="confirm-type-badge ${cardType}">
          <span>${typeLabel}</span>
        </div>
        <span class="confirm-status-text">${statusBadgeText}</span>
      </div>

      <div class="confirm-field-group">
        <label class="confirm-field-label">Title</label>
        <input type="text" class="confirm-input confirm-title-input" value="${escapeHtml(title)}" ${isDelete ? 'readonly' : ''}>
      </div>

      ${typeFieldsHtml}

      ${metaBadgesHtml ? `<div class="confirm-meta-row">${metaBadgesHtml}</div>` : ''}

      ${explanation ? `<p class="confirm-explanation">${escapeHtml(explanation)}</p>` : ''}

      ${notFoundWarning ? `<div class="assistant-connect-error" role="alert" style="margin-bottom: 0.75rem;">${escapeHtml(notFoundWarning)}</div>` : ''}

      <div class="confirm-actions">
        <button type="button" class="btn ${primaryBtnClass} btn-confirm-primary" ${notFoundWarning ? 'disabled title="Tracker not found in local list"' : ''}>
          <span>${primaryBtnText}</span>
        </button>
        <button type="button" class="btn btn-secondary btn-confirm-cancel">Discard</button>
      </div>
    </div>
  `;

  parentMsg.insertAdjacentHTML('beforeend', confirmCardHtml);
  attachActionCardListeners(document.getElementById(cardId), action);
}

function attachThreadCardListeners() {
  const cards = document.querySelectorAll('.assistant-confirm-card');
  cards.forEach(card => {
    if (card.querySelector('.btn-confirm-primary')) {
      attachActionCardListeners(card, {});
    }
  });
}

function attachActionCardListeners(card, rawAction) {
  if (!card) return;

  const btnPrimary = card.querySelector('.btn-confirm-primary');
  const btnCancel = card.querySelector('.btn-confirm-cancel');
  const actionsWrap = card.querySelector('.confirm-actions');
  const actType = card.dataset.actionType || 'create';
  const cardId = card.dataset.cardId || rawAction.cardId;

  if (btnCancel && actionsWrap) {
    btnCancel.addEventListener('click', () => {
      actionsWrap.innerHTML = `<div class="confirm-discarded-state">Action proposal discarded.</div>`;
      const thread = document.getElementById('assistant-thread');
      if (thread) threadHtml = thread.innerHTML;
      syncActiveSessionThread();
    });
  }

  if (btnPrimary && actionsWrap) {
    btnPrimary.addEventListener('click', async () => {
      btnPrimary.disabled = true;
      btnPrimary.textContent = 'Processing...';

      // 1. DELETE ACTION
      if (actType === 'delete') {
        if (!cardId) {
          showToast('No card ID specified to delete', 'error');
          btnPrimary.disabled = false;
          return;
        }
        try {
          if (typeof deps.handleDeleteBarFromAi === 'function') {
            await deps.handleDeleteBarFromAi(cardId);
          }
          actionsWrap.innerHTML = `<div class="confirm-success-state"><span>Tracker deleted ✓</span></div>`;
          const thread = document.getElementById('assistant-thread');
          if (thread) threadHtml = thread.innerHTML;
          syncActiveSessionThread();
        } catch (err) {
          showToast(err.message || 'Failed to delete tracker', 'error');
          btnPrimary.disabled = false;
          btnPrimary.textContent = 'Delete Tracker';
        }
        return;
      }

      // 2. CREATE or UPDATE ACTION
      const type = card.dataset.cardType || 'goal';
      const titleInput = card.querySelector('.confirm-title-input');
      const finalTitle = titleInput ? titleInput.value.trim() : 'New Tracker';

      let targetSmallest = 100;
      let levels = [{ name: '%', multiplier: 1, target: 100 }];
      let items = null;
      let text = null;

      if (type === 'goal') {
        const targetInput = card.querySelector('.confirm-target-input');
        const unitInput = card.querySelector('.confirm-unit-input');
        const tVal = targetInput ? parseFloat(targetInput.value) || 100 : 100;
        const uVal = unitInput ? unitInput.value.trim() || '%' : '%';
        targetSmallest = tVal;
        levels = [{ name: uVal, multiplier: 1, target: tVal }];
      } else if (type === 'checklist') {
        const itemRows = Array.from(card.querySelectorAll('.confirm-item-row'));
        const checkedItems = itemRows
          .filter(row => row.querySelector('.confirm-item-checkbox')?.checked)
          .map((row, idx) => ({
            id: String(idx + 1),
            text: row.querySelector('.confirm-item-text')?.value.trim() || `Item ${idx + 1}`,
            done: false
          }));

        items = checkedItems.length ? checkedItems : [{ id: '1', text: 'Step 1', done: false }];
        targetSmallest = items.length;
        levels = [{ name: 'items', multiplier: 1, target: items.length }];
      } else if (type === 'note') {
        const noteArea = card.querySelector('.confirm-note-textarea');
        text = noteArea ? noteArea.value : '';
        targetSmallest = 1;
        levels = [{ name: 'notes', multiplier: 1, target: 1 }];
      }

      // Deadline
      let deadlineAt = null;
      if (rawAction.deadline) {
        try {
          const parsed = new Date(rawAction.deadline).getTime();
          if (!isNaN(parsed) && parsed > Date.now()) {
            deadlineAt = parsed;
          }
        } catch (_) {}
      }

      // Repeat
      let repeat = null;
      if (rawAction.isRecurring) {
        repeat = {
          resetTime: rawAction.resetTime || '08:00',
          resetCount: null,
          checklistResetEnabled: type === 'checklist',
          deadlineResetEnabled: false,
          lastResetAt: Date.now()
        };
      }

      if (actType === 'update' && cardId) {
        // UPDATE EXISTING CARD
        try {
          const updates = {
            title: finalTitle,
            ...(items ? { items, targetSmallest } : {}),
            ...(text !== null ? { text } : {}),
            ...(type === 'goal' ? { targetSmallest, levels } : {}),
            ...(deadlineAt ? { deadlineAt, alertAtDeadline: true } : {}),
            ...(repeat ? { repeat } : {})
          };
          if (typeof deps.handleEditBarFromAi === 'function') {
            await deps.handleEditBarFromAi(cardId, updates);
          }
          actionsWrap.innerHTML = `
            <div class="confirm-success-state">
              <span>Tracker updated ✓</span>
              <button type="button" class="btn btn-secondary confirm-view-btn">View card</button>
            </div>
          `;
          const viewBtn = actionsWrap.querySelector('.confirm-view-btn');
          if (viewBtn) {
            viewBtn.addEventListener('click', () => closeAssistantPanel());
          }
          const thread = document.getElementById('assistant-thread');
          if (thread) threadHtml = thread.innerHTML;
          syncActiveSessionThread();
        } catch (err) {
          showToast(err.message || 'Failed to update tracker', 'error');
          btnPrimary.disabled = false;
          btnPrimary.textContent = 'Apply Update';
        }
        return;
      }

      // CREATE NEW CARD
      const cardPayload = {
        title: finalTitle,
        type: type,
        preset: 'custom',
        levels: levels,
        targetSmallest: targetSmallest,
        currentSmallest: 0,
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

      try {
        let newBarId = null;
        if (typeof deps.handleCreateBarFromAi === 'function') {
          newBarId = await deps.handleCreateBarFromAi(cardPayload);
        }

        actionsWrap.innerHTML = `
          <div class="confirm-success-state">
            <span>Tracker created ✓</span>
            <button type="button" class="btn btn-secondary confirm-view-btn">View card</button>
          </div>
        `;

        const viewBtn = actionsWrap.querySelector('.confirm-view-btn');
        if (viewBtn) {
          viewBtn.addEventListener('click', () => closeAssistantPanel());
        }

        showToast(`Successfully created "${finalTitle}"!`, 'success');
        const thread = document.getElementById('assistant-thread');
        if (thread) threadHtml = thread.innerHTML;
        syncActiveSessionThread();
      } catch (err) {
        showToast(err.message || 'Failed to create tracker', 'error');
        btnPrimary.disabled = false;
        btnPrimary.textContent = 'Create Tracker';
      }
    });
  }
}

function clearAttachment() {
  attachedImage = null;
  const preview = document.getElementById('assistant-attachment-preview');
  const fileInput = document.getElementById('assistant-file-input');
  if (preview) preview.classList.add('hidden');
  if (fileInput) fileInput.value = '';
}

function setAttachment(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file (PNG, JPG, WebP).', 'warning');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image size exceeds 5MB limit.', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const base64Data = dataUrl.split(',')[1];
    attachedImage = {
      name: file.name,
      mimeType: file.type,
      data: base64Data,
      dataUrl: dataUrl
    };

    const preview = document.getElementById('assistant-attachment-preview');
    const thumb = document.getElementById('assistant-attachment-thumb');
    const nameSpan = document.getElementById('assistant-attachment-name');

    if (thumb) thumb.src = dataUrl;
    if (nameSpan) nameSpan.textContent = file.name;
    if (preview) preview.classList.remove('hidden');

    updateAssistantControlsState();
  };
  reader.readAsDataURL(file);
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
    </div>
  `;
}

function attachHistorySettingsListeners() {
  const toggle = document.getElementById('ai-toggle-history');
  const clearWrap = document.getElementById('ai-settings-clear-wrap');
  const clearBtn = document.getElementById('btn-ai-clear-history');

  if (toggle) {
    toggle.addEventListener('change', () => {
      setAiHistoryEnabled(toggle.checked);
      showToast(toggle.checked ? 'Chat history enabled' : 'Chat history disabled', 'info');
      renderHistoryPaneList();
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
        <p class="assistant-notice">Your key is stored encrypted and used only to send your requests to Google. Card text you send goes to Google; avoid sensitive information. Remove your key anytime in AI settings.</p>
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

  const btnAssistant = document.getElementById('btn-assistant');
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

  if (btnAssistant) {
    btnAssistant.addEventListener('click', toggleAssistantPanel);
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

  // Auto-growing textarea & send button state
  if (textarea) {
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
      updateAssistantControlsState();
      renderCardSuggestions(textarea.value);
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitCurrentPrompt();
      }
    });
  }

  if (btnSend) {
    btnSend.addEventListener('click', submitCurrentPrompt);
  }

  function submitCurrentPrompt() {
    if (!textarea) return;
    const val = textarea.value.trim();
    if (!val && !attachedImage) return;

    handleAssistantPrompt(val);
    textarea.value = '';
    textarea.style.height = 'auto';
    hideCardSuggestions();
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
        updateAssistantControlsState();
      } else {
        renderCardSuggestions('');
        textarea.placeholder = 'Type a goal or pick a card from above...';
        textarea.focus();
      }
    });
  }

  // Expose assistant controls on window for global access/testing
  window.openAssistantPanel = openAssistantPanel;
  window.closeAssistantPanel = closeAssistantPanel;
  window.toggleAssistantPanel = toggleAssistantPanel;
  window.fetchAndRenderAssistant = fetchAndRenderAssistant;
  window.renderAssistantState = renderAssistantState;
  window.renderAssistantErrorState = renderAssistantErrorState;
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
  window.deleteChatSession = deleteChatSession;
}
