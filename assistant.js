/**
 * ProgressShelf AI Assistant UI Module
 * Handles the assistant drawer panel, Connect Gemini flow, AI Settings modal,
 * and Phase 3 features (Shared Confirmation Sheet, Create from text/paste/photo,
 * Break down a goal, and Extract tasks from notes).
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

let deps = {
  closeAllMenus: () => {},
  openModal: () => {},
  showToast: () => {},
  escapeHtml: (s) => safeEscapeHtml(s),
  handleCreateBarFromAi: async () => {},
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
  const chipBreakdown = document.getElementById('chip-breakdown-goal');
  const chipCreate = document.getElementById('chip-create-tracker');
  const btnAttach = document.getElementById('btn-assistant-attach');
  const btnSend = document.getElementById('btn-assistant-send');
  const textarea = document.getElementById('assistant-input');

  const hasInput = textarea && textarea.value.trim().length > 0;
  const hasAttachment = attachedImage !== null;

  if (chipBreakdown) chipBreakdown.disabled = !isConnected || isGenerating;
  if (chipCreate) chipCreate.disabled = !isConnected || isGenerating;
  if (btnAttach) btnAttach.disabled = !isConnected || isGenerating;
  if (btnSend) {
    btnSend.disabled = !isConnected || isGenerating || (!hasInput && !hasAttachment);
  }
}

export async function renderAssistantState(status) {
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
        <p class="assistant-state-desc">Connect your Google or email account to activate Gemini, get daily planning insights, and automate tracker updates.</p>
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
          <h4 class="assistant-today-title">Today's Briefing</h4>
          <p class="assistant-today-sub">Your morning overview, urgent items, and daily recommendations will appear here.</p>
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

    // Reattach listeners to any existing confirm cards in history
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
   PHASE 3: SHARED CONFIRM SHEET & ACTION HANDLERS
   ========================================================================== */

function scrollThreadToBottom() {
  const content = document.getElementById('assistant-content');
  if (content) {
    content.scrollTop = content.scrollHeight;
  }
}

/**
 * Handles user prompt execution via Gemini, showing thinking indicator,
 * and rendering the Shared Confirmation Sheet.
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
  updateAssistantControlsState();

  // Hide placeholder if visible
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

  // Determine Task & Payload
  let task = options.task || 'create_tracker';
  let payload = {};

  if (task === 'break_down_goal') {
    payload = {
      goal: text.replace(/^break\s*down[:\s]*/i, '').trim() || text,
      currentDate: new Date().toISOString(),
    };
  } else if (task === 'extract_notes') {
    payload = {
      noteText: text,
      currentDate: new Date().toISOString(),
    };
  } else {
    // Default: create_tracker
    payload = {
      input: text,
      currentDate: new Date().toISOString(),
    };
    if (img && img.data && img.mimeType) {
      payload.image = {
        data: img.data,
        mimeType: img.mimeType,
      };
    }
  }

  try {
    const result = await aiGenerate(task, payload);

    // Remove thinking indicator
    const thinkingEl = document.getElementById(thinkingId);
    if (thinkingEl) thinkingEl.remove();

    // Render Shared Confirmation Sheet
    renderConfirmSheet(result, task);
  } catch (err) {
    console.error('[Assistant] Prompt generation error:', err);
    const thinkingEl = document.getElementById(thinkingId);
    if (thinkingEl) thinkingEl.remove();

    const errMsg = formatAiErrorMessage(err);
    const errHtml = `
      <div class="assistant-msg assistant-msg-bot">
        <div class="assistant-connect-error" role="alert">${escapeHtml(errMsg)}</div>
      </div>
    `;
    thread.insertAdjacentHTML('beforeend', errHtml);
  } finally {
    isGenerating = false;
    // Clear attachment state
    clearAttachment();
    updateAssistantControlsState();
    scrollThreadToBottom();
  }
}

/**
 * Renders the Shared Confirmation Sheet card inside the assistant thread.
 */
function renderConfirmSheet(result, task) {
  const thread = document.getElementById('assistant-thread');
  if (!thread) return;

  const cardId = 'confirm-' + Date.now();
  const rawType = (result.type || 'goal').toLowerCase();
  const cardType = rawType === 'checklist' ? 'checklist' : (rawType === 'note' ? 'note' : 'goal');
  const typeLabel = cardType === 'checklist' ? 'Checklist' : (cardType === 'note' ? 'Markdown Note' : 'Goal Tracker');
  const title = result.title || 'New Tracker';
  const explanation = result.explanation || result.summary || '';

  // Type specific markup
  let typeFieldsHtml = '';
  if (cardType === 'goal') {
    const targetVal = typeof result.target === 'number' ? result.target : 100;
    const unitVal = result.unit || '%';
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
    const items = Array.isArray(result.items) && result.items.length ? result.items : [{ text: 'Step 1' }];
    const itemsHtml = items.map((it, idx) => `
      <div class="confirm-item-row" data-idx="${idx}">
        <input type="checkbox" class="confirm-item-checkbox" checked title="Include in tracker">
        <input type="text" class="confirm-item-text" value="${escapeHtml(it.text || '')}">
      </div>
    `).join('');

    typeFieldsHtml = `
      <div class="confirm-field-group">
        <label class="confirm-field-label">Action Items (${items.length})</label>
        <div class="confirm-items-list">
          ${itemsHtml}
        </div>
      </div>
    `;
  } else if (cardType === 'note') {
    const noteText = result.noteText || result.text || '';
    typeFieldsHtml = `
      <div class="confirm-field-group">
        <label class="confirm-field-label">Note Content</label>
        <textarea class="confirm-input confirm-note-textarea" rows="4">${escapeHtml(noteText)}</textarea>
      </div>
    `;
  }

  // Meta badges (Deadline & Recurring)
  let metaBadgesHtml = '';
  if (result.deadline) {
    let displayDeadline = result.deadline;
    try {
      displayDeadline = new Date(result.deadline).toLocaleDateString(undefined, {
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

  if (result.isRecurring) {
    metaBadgesHtml += `
      <div class="confirm-meta-chip">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        <span>Repeats daily at ${escapeHtml(result.resetTime || '08:00')}</span>
      </div>
    `;
  }

  const confirmHtml = `
    <div id="${cardId}" class="assistant-msg assistant-msg-bot">
      <div class="assistant-confirm-card" data-type="${cardType}">
        <div class="confirm-card-header">
          <div class="confirm-type-badge ${cardType}">
            <span>${typeLabel}</span>
          </div>
          <span class="confirm-status-text">Preview — Ready to create</span>
        </div>

        <div class="confirm-field-group">
          <label class="confirm-field-label">Tracker Title</label>
          <input type="text" class="confirm-input confirm-title-input" value="${escapeHtml(title)}">
        </div>

        ${typeFieldsHtml}

        ${metaBadgesHtml ? `<div class="confirm-meta-row">${metaBadgesHtml}</div>` : ''}

        ${explanation ? `<p class="confirm-explanation">${escapeHtml(explanation)}</p>` : ''}

        <div class="confirm-actions">
          <button type="button" class="btn btn-primary btn-confirm-create">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Create Tracker</span>
          </button>
          <button type="button" class="btn btn-secondary btn-confirm-cancel">Discard</button>
        </div>
      </div>
    </div>
  `;

  thread.insertAdjacentHTML('beforeend', confirmHtml);
  threadHtml = thread.innerHTML;
  attachSingleCardListeners(document.getElementById(cardId), result);
  scrollThreadToBottom();
}

function attachThreadCardListeners() {
  const cards = document.querySelectorAll('.assistant-confirm-card');
  cards.forEach(card => {
    // If not already resolved
    if (card.querySelector('.btn-confirm-create')) {
      attachSingleCardListeners(card.closest('.assistant-msg'), {});
    }
  });
}

function attachSingleCardListeners(msgEl, rawData) {
  if (!msgEl) return;
  const card = msgEl.querySelector('.assistant-confirm-card');
  if (!card) return;

  const btnCreate = card.querySelector('.btn-confirm-create');
  const btnCancel = card.querySelector('.btn-confirm-cancel');
  const actionsWrap = card.querySelector('.confirm-actions');

  if (btnCancel && actionsWrap) {
    btnCancel.addEventListener('click', () => {
      actionsWrap.innerHTML = `<div class="confirm-discarded-state">Tracker proposal discarded.</div>`;
      const thread = document.getElementById('assistant-thread');
      if (thread) threadHtml = thread.innerHTML;
    });
  }

  if (btnCreate && actionsWrap) {
    btnCreate.addEventListener('click', async () => {
      btnCreate.disabled = true;
      btnCreate.textContent = 'Creating...';

      const type = card.dataset.type || 'goal';
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

      // Deadline handling
      let deadlineAt = null;
      if (rawData.deadline) {
        try {
          const parsed = new Date(rawData.deadline).getTime();
          if (!isNaN(parsed) && parsed > Date.now()) {
            deadlineAt = parsed;
          }
        } catch (_) {}
      }

      // Repeat / Habit handling
      let repeat = null;
      if (rawData.isRecurring) {
        repeat = {
          resetTime: rawData.resetTime || '08:00',
          resetCount: null,
          checklistResetEnabled: type === 'checklist',
          deadlineResetEnabled: false,
          lastResetAt: Date.now()
        };
      }

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
        } else {
          throw new Error('createBar handler not available');
        }

        actionsWrap.innerHTML = `
          <div class="confirm-success-state">
            <span>Tracker created!</span>
            <button type="button" class="btn btn-secondary confirm-view-btn" data-bar-id="${escapeHtml(newBarId || '')}">View card</button>
          </div>
        `;

        const viewBtn = actionsWrap.querySelector('.confirm-view-btn');
        if (viewBtn) {
          viewBtn.addEventListener('click', () => {
            closeAssistantPanel();
          });
        }

        showToast(`Successfully created "${finalTitle}"!`, 'success');
        const thread = document.getElementById('assistant-thread');
        if (thread) threadHtml = thread.innerHTML;
      } catch (err) {
        console.error('[Assistant] Failed to create tracker:', err);
        showToast(err.message || 'Failed to create tracker', 'error');
        btnCreate.disabled = false;
        btnCreate.textContent = 'Create Tracker';
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
      </div>
    `;

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
    </div>
  `;

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
  const backdrop = document.getElementById('assistant-backdrop');
  const btnProfileAi = document.getElementById('btn-profile-ai-settings');
  const textarea = document.getElementById('assistant-input');
  const btnSend = document.getElementById('btn-assistant-send');
  const btnAttach = document.getElementById('btn-assistant-attach');
  const fileInput = document.getElementById('assistant-file-input');
  const btnRemoveAttach = document.getElementById('btn-assistant-remove-attachment');

  const chipBreakdown = document.getElementById('chip-breakdown-goal');
  const chipCreate = document.getElementById('chip-create-tracker');

  if (btnAssistant) {
    btnAssistant.addEventListener('click', toggleAssistantPanel);
  }
  if (btnClose) {
    btnClose.addEventListener('click', closeAssistantPanel);
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

  // Guided Chip: Break down a goal
  if (chipBreakdown) {
    chipBreakdown.addEventListener('click', () => {
      if (!textarea) return;
      const val = textarea.value.trim();
      if (val) {
        handleAssistantPrompt(val, { task: 'break_down_goal' });
        textarea.value = '';
        textarea.style.height = 'auto';
        updateAssistantControlsState();
      } else {
        textarea.value = 'Break down: ';
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        updateAssistantControlsState();
      }
    });
  }

  // Guided Chip: Add from photo or paste
  if (chipCreate) {
    chipCreate.addEventListener('click', () => {
      if (!textarea) return;
      const val = textarea.value.trim();
      if (val || attachedImage) {
        handleAssistantPrompt(val, { task: 'create_tracker' });
        textarea.value = '';
        textarea.style.height = 'auto';
        updateAssistantControlsState();
      } else {
        if (fileInput) fileInput.click();
      }
    });
  }

  // Expose assistant controls on window for testing
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
}
