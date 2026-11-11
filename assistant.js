/**
 * ProgressShelf AI Assistant UI Module
 * Handles the assistant drawer panel, Connect Gemini flow, and AI Settings modal.
 */

import { isGuestMode, exitGuestMode } from "./auth.js?v=3.2";
import { aiStatus, aiSaveKey, aiRemoveKey } from "./ai.js?v=3.2";

export let isAssistantPanelOpen = false;
export function isAssistantOpen() {
  return isAssistantPanelOpen;
}

let currentAiStatus = null;
let deps = {
  closeAllMenus: () => {},
  openModal: () => {},
  showToast: () => {},
  escapeHtml: (s) => safeEscapeHtml(s),
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

export async function renderAssistantState(status) {
  const container = document.getElementById('assistant-content');
  if (!container) return;

  // 1. Guest or Not Signed In
  if (isGuestMode()) {
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

        <div class="assistant-today-placeholder">
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
      </div>
    `;

    const settingsBtn = document.getElementById('btn-assistant-open-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        openAiSettingsModal();
      });
    }
    return;
  }

  // 3. Disconnected State - Connect Gemini Card
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
  if (textarea) {
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
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
}
