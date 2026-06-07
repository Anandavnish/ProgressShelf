// app.js
import { isConfigured } from "./firebase-config.js";
import { logout, initAuthProtection, isGuestMode, exitGuestMode, loginWithGoogle } from "./auth.js";
import { subscribeToBars, createBar, updateBarProgress, deleteBar, getLocalBars, editBar } from "./db.js";

// Page elements
const loadingScreen = document.getElementById("loading-screen");
const appContent = document.getElementById("app-content");
const cardsGrid = document.getElementById("cards-grid");
const btnLogout = document.getElementById("btn-logout");
const userAvatar = document.getElementById("user-avatar");
const userName = document.getElementById("user-name");

// Modals
const modalCreate = document.getElementById("modal-create");
const modalUpdate = document.getElementById("modal-update");
const formCreate = document.getElementById("form-create");
const formUpdate = document.getElementById("form-update");

// Dynamic containers (Create Modal)
const barPresetSelect = document.getElementById("bar-preset");
const presetsDynamicContainer = document.getElementById("create-presets-dynamic");
const createTargetDynamic = document.getElementById("create-target-dynamic");
const createCurrentDynamic = document.getElementById("create-current-dynamic");

// Dynamic containers (Update Modal)
const updateModalTitle = document.getElementById("update-modal-title");
const updateBarIdInput = document.getElementById("update-bar-id");
const updateCurrentDynamic = document.getElementById("update-current-dynamic");

// Delete safety panel
const btnDeleteTrigger = document.getElementById("btn-delete-trigger");
const deleteSafetyPane = document.getElementById("delete-safety-pane");
const btnDeleteConfirmYes = document.getElementById("btn-delete-confirm-yes");
const btnDeleteConfirmNo = document.getElementById("btn-delete-confirm-no");
const updateActionsStandard = document.getElementById("update-actions-standard");

// Toast Container
const toastContainer = document.getElementById("toast-container");

// Guest Mode elements
const guestBanner = document.getElementById("guest-banner");
const btnBannerLogin = document.getElementById("btn-banner-login");

// Application State
let currentUser = null;
let currentBars = [];
let selectedBar = null;
let activeUnsubscribe = null;
let authInitialized = false;

function startSubscription(uid, onUpdate, onError) {
  // Unsubscribe any existing listener before starting a new one
  if (activeUnsubscribe) {
    activeUnsubscribe();
    activeUnsubscribe = null;
  }
  activeUnsubscribe = subscribeToBars(uid, onUpdate, onError);
}

const PRESETS = {
  Lectures: { levels: [{ name: 'Lectures', conversionToNext: null }] },
  Videos:   { levels: [{ name: 'Videos',   conversionToNext: null }] },
  Problems: { levels: [{ name: 'Problems', conversionToNext: null }] },
  Tasks:    { levels: [{ name: 'Tasks',    conversionToNext: null }] },
  Pages:    { levels: [{ name: 'Pages',    conversionToNext: null }] },
  Books:    { levels: [{ name: 'Books',    conversionToNext: null }] },
  Chapters: { levels: [{ name: 'Chapters', conversionToNext: null }] },
  Time: {
    levels: [
      { name: 'Seconds', conversionToNext: 60 },
      { name: 'Minutes', conversionToNext: 60 },
      { name: 'Hours',   conversionToNext: null }
    ]
  },
  Custom: null
};

// ==========================================
// Toast Notifications
// ==========================================
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  toast.innerHTML = `
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="btn-close-toast">&times;</button>
  `;
  
  toastContainer.appendChild(toast);
  
  // Close button trigger
  toast.querySelector(".btn-close-toast").addEventListener("click", () => {
    dismissToast(toast);
  });
  
  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    dismissToast(toast);
  }, 4000);
}

function dismissToast(toast) {
  if (!toast.parentNode) return;
  toast.classList.add("toast-out");
  toast.addEventListener("animationend", () => {
    toast.remove();
  });
}

// Escape HTML helper
function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.innerText = str;
  return div.innerHTML;
}

function formatNumber(value) {
  // Returns integer string if whole number, else up to 2 decimal places
  if (Number.isInteger(value) || value % 1 === 0) {
    return Math.floor(value).toString();
  }
  // Strip trailing zeros after decimal
  return parseFloat(value.toFixed(2)).toString();
}



// ==========================================
// Unit Conversion & Formatting Mathematics
// ==========================================

/**
 * Interpolates from #4A90D9 (blue, 0%) to #27AE60 (green, 100%).
 * @param {number} percent Completion percentage (0 to 100).
 * @returns {string} RGB color string.
 */
function getProgressColor(percent) {
  const p = Math.max(0, Math.min(100, percent)) / 100;
  
  // Blue: rgb(74, 144, 217)
  const rStart = 74, gStart = 144, bStart = 217;
  // Green: rgb(39, 174, 96)
  const rEnd = 39, gEnd = 174, bEnd = 96;
  
  const r = Math.round(rStart + (rEnd - rStart) * p);
  const g = Math.round(gStart + (gEnd - gStart) * p);
  const b = Math.round(bStart + (bEnd - bStart) * p);
  
  return `rgb(${r}, ${g}, ${b})`;
}

function encodeToSmallest(levelValues, levels) {
  // levelValues: array ordered largest→smallest (matches form display order)
  // levels: array ordered smallest→largest (matches Firestore schema)
  // Reverse levelValues to align with levels array
  const vals = [...levelValues].reverse();
  
  let smallest = 0;
  let multiplier = 1;
  for (let i = 0; i < levels.length; i++) {
    smallest += vals[i] * multiplier;
    if (levels[i].conversionToNext !== null) {
      multiplier *= levels[i].conversionToNext;
    }
  }
  return smallest;
}

function decodeFromSmallest(smallest, levels) {
  // Returns array ordered largest→smallest (for display)
  let remaining = smallest;
  const vals = [];

  for (let i = 0; i < levels.length; i++) {
    if (levels[i].conversionToNext === null) {
      // Top level — remainder goes here
      vals.push(remaining);
    } else {
      vals.push(remaining % levels[i].conversionToNext);
      remaining = Math.floor(remaining / levels[i].conversionToNext);
    }
  }

  // vals is now smallest→largest, reverse for display (largest→smallest)
  return vals.reverse();
}

function formatCurrentProgress(current, levels) {
  const vals = decodeFromSmallest(current, levels); // largest-to-smallest
  const reversedLevels = [...levels].reverse(); // largest-to-smallest
  
  // Find first and last non-zero index
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] > 0) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
    }
  }
  
  // If all values are 0
  if (firstIdx === -1) {
    return `${formatNumber(0)} ${levels[0].name}`;
  }
  
  const parts = [];
  for (let i = firstIdx; i <= lastIdx; i++) {
    parts.push(`${formatNumber(vals[i])} ${reversedLevels[i].name}`);
  }
  return parts.join(' ');
}

function formatCardLabel(current, target, levels) {
  if (levels.length === 1) {
    return `${formatNumber(current)} / ${formatNumber(target)} ${levels[0].name}`;
  } else {
    const reversedLevels = [...levels].reverse();
    const targetVals = decodeFromSmallest(target, levels);
    const targetStr = targetVals.map((val, idx) => `${formatNumber(val)} ${reversedLevels[idx].name}`).join(' ');
    const currentStr = formatCurrentProgress(current, levels);
    return `${currentStr} / ${targetStr}`;
  }
}

function getDeadlineMs(bar) {
  if (!bar.deadline) return null;
  return typeof bar.deadline.toDate === 'function'
    ? bar.deadline.toDate().getTime()
    : bar.deadline;
}

function getDeadlinePercent(bar) {
  const deadlineMs = getDeadlineMs(bar);
  if (!deadlineMs) return null;

  const createdMs = typeof bar.createdAt?.toDate === 'function'
    ? bar.createdAt.toDate().getTime()
    : (bar.createdAt || Date.now());

  const totalDuration = deadlineMs - createdMs;
  const timeLeft = deadlineMs - Date.now();

  if (totalDuration <= 0) return 0;
  return Math.max(0, Math.min(100, (timeLeft / totalDuration) * 100));
}

function formatTimeLeft(deadlineMs) {
  const msLeft = deadlineMs - Date.now();
  if (msLeft < 0) return "Overdue";
  if (msLeft < 3600000)
    return `${Math.floor(msLeft / 60000)} min left`;
  if (msLeft < 86400000)
    return `${Math.floor(msLeft / 3600000)} hrs left`;
  if (msLeft < 604800000)
    return `${Math.floor(msLeft / 86400000)} days left`;
  return `${Math.floor(msLeft / 604800000)} weeks left`;
}

// Single ResizeObserver instance for all deadline cards
const deadlineResizeObserver = new ResizeObserver((entries) => {
  entries.forEach(entry => {
    const card = entry.target;
    const barEl = card.querySelector('.deadline-bar');
    const trackEl = card.querySelector('.deadline-track');
    if (!barEl || !trackEl) return;
    const percentLeft = parseFloat(barEl.dataset.percentLeft || '0');
    const isOverdue = barEl.dataset.overdue === 'true';
    updateDeadlineSVG(card, barEl, trackEl, percentLeft, isOverdue);
  });
});

function attachDeadlineBorder(card, bar) {
  // Remove existing SVG if re-rendering
  card.querySelector('.deadline-svg')?.remove();

  const deadlineMs = getDeadlineMs(bar);
  if (!deadlineMs) return;

  const percentLeft = getDeadlinePercent(bar);
  const isOverdue = deadlineMs < Date.now();

  // Build SVG
  const svg = document.createElementNS(
    'http://www.w3.org/2000/svg', 'svg'
  );
  svg.classList.add('deadline-svg');

  const track = document.createElementNS(
    'http://www.w3.org/2000/svg', 'rect'
  );
  track.classList.add('deadline-track');

  const barEl = document.createElementNS(
    'http://www.w3.org/2000/svg', 'rect'
  );
  barEl.classList.add('deadline-bar');
  barEl.dataset.percentLeft = percentLeft;
  barEl.dataset.overdue = isOverdue ? 'true' : 'false';

  svg.appendChild(track);
  svg.appendChild(barEl);

  // Card must be position:relative for SVG overlay
  card.style.position = 'relative';
  card.style.overflow = 'visible';
  card.appendChild(svg);

  updateDeadlineSVG(card, barEl, track, percentLeft, isOverdue);
  deadlineResizeObserver.observe(card);

  if (isOverdue) {
    attachOverdueWarning(card);
  }
}

function updateDeadlineSVG(card, barEl, trackEl, percentLeft, isOverdue) {
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  if (!w || !h) return;

  const pad = 2;
  const rx = 10;
  // Perimeter calculated from actual card dimensions
  const perimeter = 2 * ((w - pad * 2) + (h - pad * 2));

  // Style the SVG element itself
  Object.assign(card.querySelector('.deadline-svg').style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    // Clockwise from top-left:
    // Default SVG draws top-right clockwise, scaleX(-1) mirrors
    // to start from top-left clockwise
    transform: 'scaleX(-1)',
    overflow: 'visible',
    zIndex: '0'
  });

  [barEl, trackEl].forEach(el => {
    el.setAttribute('x', pad);
    el.setAttribute('y', pad);
    el.setAttribute('width', w - pad * 2);
    el.setAttribute('height', h - pad * 2);
    el.setAttribute('rx', rx);
    el.setAttribute('fill', 'none');
  });

  trackEl.setAttribute('stroke', 'rgba(255,255,255,0.06)');
  trackEl.setAttribute('stroke-width', '3');

  barEl.setAttribute('stroke-width', '3');
  barEl.setAttribute('stroke-linecap', 'round');
  barEl.setAttribute('stroke-dasharray', perimeter);
  barEl.setAttribute(
    'stroke-dashoffset',
    perimeter - (perimeter * percentLeft / 100)
  );

  if (isOverdue) {
    barEl.setAttribute('stroke', '#E74C3C');
    barEl.classList.add('deadline-overdue');
  } else {
    // hsl: 120=green at 100%, 60=yellow at 50%, 0=red at 0%
    const hue = percentLeft * 1.2;
    barEl.setAttribute('stroke', `hsl(${hue}, 90%, 50%)`);
    barEl.classList.remove('deadline-overdue');
  }
}

function attachOverdueWarning(card) {
  // Don't add twice
  if (card.querySelector('.deadline-warning')) return;

  const warning = document.createElement('div');
  warning.className = 'deadline-warning';
  warning.innerHTML = '⚠️';
  // Must sit above SVG but below action buttons
  warning.style.zIndex = '1';
  card.appendChild(warning);
}

// ==========================================
// Dashboard Card Rendering
// ==========================================

function renderDashboard(bars) {
  currentBars = bars;
  cardsGrid.innerHTML = "";
  
  // ADD CARD ALWAYS FIRST
  const addCard = document.createElement("div");
  addCard.className = "card-add";
  addCard.id = "btn-add-card";
  addCard.innerHTML = `
    <div class="add-icon">+</div>
    <span class="add-text">Add New Tracker</span>
  `;
  addCard.addEventListener("click", () => openCreateModal());
  cardsGrid.appendChild(addCard);

  // THEN render bar cards — newest first (reverse createdAt asc order)
  [...bars].reverse().forEach((bar) => {
    const card = document.createElement("div");
    card.className = "card-progress";
    card.setAttribute("data-bar-id", bar.id);
    
    // Calculate completion percentage
    const percent = bar.targetSmallest > 0 
      ? Math.max(0, Math.min(100, (bar.currentSmallest / bar.targetSmallest) * 100))
      : 0;
    
    // Get interpolated color
    const barColor = getProgressColor(percent);
    card.style.setProperty("--bar-color", barColor);
    
    // Set timestamp reference for the 5-minute background check
    let lastUpdatedMs = Date.now();
    if (bar.lastUpdated) {
      // Handle firestore Timestamp vs client side local date
      lastUpdatedMs = typeof bar.lastUpdated.toDate === 'function' 
        ? bar.lastUpdated.toDate().getTime() 
        : bar.lastUpdated;
    }
    card.setAttribute("data-last-updated", lastUpdatedMs);
    
    // Add glowing pulse animation if updated in the last 5 minutes
    const diffMinutes = (Date.now() - lastUpdatedMs) / (1000 * 60);
    if (diffMinutes < 5) {
      card.classList.add("pulse-glow");
    }
    
    card.innerHTML = `
      <div class="card-actions">
        <button class="btn-card-delete" title="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2"
            style="pointer-events:none;">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>
          </svg>
        </button>
        <button class="btn-card-edit" title="Edit">
          <svg width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2"
            style="pointer-events:none;">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>
      <h3 class="card-title" title="${escapeHtml(bar.title)}">${escapeHtml(bar.title)}</h3>
      <div class="card-body">
        <div class="card-percent">${formatNumber(percent)}%</div>
        <div class="progressbar-track">
          <div class="progressbar-fill" style="width: ${percent}%;"></div>
        </div>
      </div>
      <div class="card-label" title="${escapeHtml(formatCardLabel(bar.currentSmallest, bar.targetSmallest, bar.levels))}">${escapeHtml(formatCardLabel(bar.currentSmallest, bar.targetSmallest, bar.levels))}</div>
      ${bar.deadline ? `
        <div class="card-deadline-label" data-deadline="${getDeadlineMs(bar)}">
          ${formatTimeLeft(getDeadlineMs(bar))}
        </div>
      ` : ''}

      <!-- Inline delete confirmation overlay -->
      <div class="card-delete-confirm hidden">
        <p class="card-delete-confirm-text">Delete <strong>${escapeHtml(bar.title)}</strong>?</p>
        <div class="card-delete-confirm-actions">
          <button class="btn btn-secondary btn-delete-cancel-inline">Cancel</button>
          <button class="btn btn-danger-confirm btn-delete-confirm-inline">Yes, Delete</button>
        </div>
      </div>
    `;

    // Wire up direct listeners on action buttons
    const deleteConfirmPanel = card.querySelector('.card-delete-confirm');

    card.querySelector('.btn-card-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConfirmPanel.classList.remove('hidden');
    });

    card.querySelector('.btn-delete-cancel-inline').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConfirmPanel.classList.add('hidden');
    });

    card.querySelector('.btn-delete-confirm-inline').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteBar(isGuestMode() ? null : currentUser.uid, bar.id)
        .then(() => showToast(`Deleted "${bar.title}".`, "success"))
        .catch(() => showToast("Failed to delete progress bar.", "error"));
    });

    card.querySelector('.btn-card-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(bar);
    });

    // Click on card body opens update modal (only if confirm panel not visible)
    card.addEventListener("click", () => {
      if (deleteConfirmPanel.classList.contains('hidden')) {
        openUpdateModal(bar);
      }
    });

    cardsGrid.appendChild(card);
    if (bar.deadline) {
      attachDeadlineBorder(card, bar);
    }
  });
}

// Replace or extend the existing setInterval block
setInterval(() => {
  // Existing pulse-glow cleanup
  document.querySelectorAll('.card-progress.pulse-glow')
    .forEach((card) => {
      const lastUpdatedMs = Number(
        card.getAttribute('data-last-updated')
      );
      if (lastUpdatedMs) {
        const diffMinutes = (Date.now() - lastUpdatedMs) / 60000;
        if (diffMinutes >= 5) card.classList.remove('pulse-glow');
      }
    });

  // Deadline label + border live update
  document.querySelectorAll('.card-progress').forEach(card => {
    const barId = card.getAttribute('data-bar-id');
    const barData = currentBars.find(b => b.id === barId);
    if (!barData?.deadline) return;

    const deadlineMs = getDeadlineMs(barData);
    const isOverdue = deadlineMs < Date.now();

    // Update label text
    const label = card.querySelector('.card-deadline-label');
    if (label) label.textContent = formatTimeLeft(deadlineMs);

    // Update SVG border
    const barEl = card.querySelector('.deadline-bar');
    const trackEl = card.querySelector('.deadline-track');
    if (barEl && trackEl) {
      const percentLeft = getDeadlinePercent(barData);
      barEl.dataset.percentLeft = percentLeft;
      barEl.dataset.overdue = isOverdue ? 'true' : 'false';
      updateDeadlineSVG(
        card, barEl, trackEl, percentLeft, isOverdue
      );
    }

    // Attach overdue warning if just became overdue
    if (isOverdue) attachOverdueWarning(card);
  });
}, 60000);

// ==========================================
// Modal Controllers & Form Interactions
// ==========================================

function openModal(modal) {
  modal.classList.add("active");
}

function closeModal(modal) {
  modal.classList.remove("active");
}

// Global modal close triggers
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    closeModal(document.getElementById(e.target.dataset.close));
  });
});

window.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) {
    closeModal(e.target);
  }
});

function initDeadlineInputs() {
  const dateInput = document.getElementById('bar-deadline-date');
  const timeInput = document.getElementById('bar-deadline-time');
  if (!dateInput || !timeInput) return;

  // Block past dates
  const today = new Date().toISOString().split('T')[0];
  dateInput.setAttribute('min', today);

  function validateFutureTime() {
    const selectedDate = dateInput.value;
    const selectedTime = timeInput.value;
    if (!selectedDate || !selectedTime) return;

    const today = new Date().toISOString().split('T')[0];
    if (selectedDate === today) {
      const now = new Date();
      const hh = now.getHours().toString().padStart(2, '0');
      const mm = now.getMinutes().toString().padStart(2, '0');
      const currentTimeStr = `${hh}:${mm}`;
      if (selectedTime <= currentTimeStr) {
        showToast("Deadline time cannot be in the past.", "error");
        timeInput.value = '';
      }
    }
  }

  dateInput.addEventListener('change', validateFutureTime);
  timeInput.addEventListener('change', validateFutureTime);
}

function getDeadlineTimestamp() {
  const dateInput = document.getElementById('bar-deadline-date');
  const timeInput = document.getElementById('bar-deadline-time');
  const dateVal = dateInput?.value;
  const timeVal = timeInput?.value || '23:59';

  if (!dateVal) return null;

  const dt = new Date(`${dateVal}T${timeVal}:00`);
  return isNaN(dt.getTime()) ? null : dt.getTime();
}

// CREATE MODAL LOGIC:
function openCreateModal() {
  formCreate.reset();
  formCreate.dataset.mode = '';
  formCreate.dataset.editId = '';
  document.getElementById('modal-create-title').textContent = 'Create Progress Bar';
  barPresetSelect.value = "";
  barPresetSelect.disabled = false;
  rebuildCreateFormInputs();
  openModal(modalCreate);
  initDeadlineInputs();
}

barPresetSelect.addEventListener("change", rebuildCreateFormInputs);

function rebuildCreateFormInputs() {
  const preset = barPresetSelect.value;
  presetsDynamicContainer.innerHTML = "";
  
  if (preset === "Custom") {
    presetsDynamicContainer.innerHTML = `
      <div class="custom-levels-config">
        <div class="form-group">
          <label class="form-label" for="custom-level-count">Number of Levels</label>
          <select class="form-input" id="custom-level-count">
            <option value="1">1 Level</option>
            <option value="2">2 Levels</option>
            <option value="3">3 Levels</option>
          </select>
        </div>
        <div id="custom-level-fields">
          <!-- Dynamic text and conversion input boxes -->
        </div>
      </div>
    `;
    const levelCountSelect = document.getElementById("custom-level-count");
    levelCountSelect.addEventListener("change", rebuildCustomConfigFields);
    rebuildCustomConfigFields();
  } else {
    renderTargetAndCurrentInputs();
  }
}

function rebuildCustomConfigFields() {
  const count = parseInt(document.getElementById("custom-level-count").value) || 1;
  const container = document.getElementById("custom-level-fields");
  container.innerHTML = "";
  
  if (count === 1) {
    container.innerHTML = `
      <div class="custom-level-row">
        <label class="form-label">Level 1 Unit Name (Largest)</label>
        <input class="form-input custom-level-name-input" type="text" id="custom-l1-name" placeholder="e.g. Books" required>
      </div>
    `;
  } else if (count === 2) {
    container.innerHTML = `
      <div class="custom-level-row">
        <label class="form-label">Level 1 Unit Name (Largest)</label>
        <input class="form-input custom-level-name-input" type="text" id="custom-l1-name" placeholder="e.g. Chapters" required>
      </div>
      <div class="custom-level-row">
        <label class="form-label">Level 2 Unit Name (Smallest)</label>
        <input class="form-input custom-level-name-input" type="text" id="custom-l2-name" placeholder="e.g. Sections" required>
      </div>
      <div class="form-group custom-ratio-group hidden" id="ratio-group-l2">
        <label class="form-label" id="label-ratio-l2">How many Sections per Chapter?</label>
        <input class="form-input custom-level-ratio-input" type="number" id="custom-l2-ratio" value="10" min="2" required>
      </div>
    `;
  } else if (count === 3) {
    container.innerHTML = `
      <div class="custom-level-row">
        <label class="form-label">Level 1 Unit Name (Largest)</label>
        <input class="form-input custom-level-name-input" type="text" id="custom-l1-name" placeholder="e.g. Books" required>
      </div>
      <div class="custom-level-row">
        <label class="form-label">Level 2 Unit Name (Middle)</label>
        <input class="form-input custom-level-name-input" type="text" id="custom-l2-name" placeholder="e.g. Chapters" required>
      </div>
      <div class="form-group custom-ratio-group hidden" id="ratio-group-l2">
        <label class="form-label" id="label-ratio-l2">How many Chapters per Book?</label>
        <input class="form-input custom-level-ratio-input" type="number" id="custom-l2-ratio" value="10" min="2" required>
      </div>
      <div class="custom-level-row">
        <label class="form-label">Level 3 Unit Name (Smallest)</label>
        <input class="form-input custom-level-name-input" type="text" id="custom-l3-name" placeholder="e.g. Pages" required>
      </div>
      <div class="form-group custom-ratio-group hidden" id="ratio-group-l3">
        <label class="form-label" id="label-ratio-l3">How many Pages per Chapter?</label>
        <input class="form-input custom-level-ratio-input" type="number" id="custom-l3-ratio" value="10" min="2" required>
      </div>
    `;
  }
  
  // Bind listeners to custom input changes
  container.querySelectorAll(".custom-level-name-input").forEach(input => {
    input.addEventListener("input", () => {
      updateCustomFormState();
      updateLabelsInRealtime();
    });
  });
  container.querySelectorAll(".custom-level-ratio-input").forEach(input => {
    input.addEventListener("change", renderTargetAndCurrentInputs);
  });
  
  updateCustomFormState();
  renderTargetAndCurrentInputs();
}

function updateCustomFormState() {
  const countSelect = document.getElementById("custom-level-count");
  if (!countSelect) return;
  const count = parseInt(countSelect.value) || 1;
  
  const l1Name = document.getElementById("custom-l1-name")?.value.trim() || "";
  
  if (count === 2) {
    const l2Name = document.getElementById("custom-l2-name")?.value.trim() || "";
    const ratioGroupL2 = document.getElementById("ratio-group-l2");
    const labelRatioL2 = document.getElementById("label-ratio-l2");
    
    if (l1Name && l2Name) {
      labelRatioL2.textContent = `How many ${l2Name} per ${l1Name}?`;
      ratioGroupL2.classList.remove("hidden");
    } else {
      ratioGroupL2.classList.add("hidden");
    }
  } else if (count === 3) {
    const l2Name = document.getElementById("custom-l2-name")?.value.trim() || "";
    const l3Name = document.getElementById("custom-l3-name")?.value.trim() || "";
    const ratioGroupL2 = document.getElementById("ratio-group-l2");
    const labelRatioL2 = document.getElementById("label-ratio-l2");
    const ratioGroupL3 = document.getElementById("ratio-group-l3");
    const labelRatioL3 = document.getElementById("label-ratio-l3");
    
    if (l1Name && l2Name) {
      labelRatioL2.textContent = `How many ${l2Name} per ${l1Name}?`;
      ratioGroupL2.classList.remove("hidden");
    } else {
      ratioGroupL2.classList.add("hidden");
    }
    
    if (l2Name && l3Name) {
      labelRatioL3.textContent = `How many ${l3Name} per ${l2Name}?`;
      ratioGroupL3.classList.remove("hidden");
    } else {
      ratioGroupL3.classList.add("hidden");
    }
  }
}

// Reactively updates input row labels as custom unit names are written
function updateLabelsInRealtime() {
  const levels = getLevelsFromForm();
  const reversedLevels = [...levels].reverse();
  
  const targetLabelSpans = createTargetDynamic.querySelectorAll(".form-row-label");
  const currentLabelSpans = createCurrentDynamic.querySelectorAll(".form-row-label");
  
  reversedLevels.forEach((level, index) => {
    if (targetLabelSpans[index]) targetLabelSpans[index].textContent = level.name || `Level ${index + 1}`;
    if (currentLabelSpans[index]) currentLabelSpans[index].textContent = level.name || `Level ${index + 1}`;
  });
}

function getLevelsFromForm() {
  const preset = barPresetSelect.value;
  if (!preset) return [];
  
  if (preset !== "Custom") {
    return PRESETS[preset].levels;
  }
  
  const countSelect = document.getElementById("custom-level-count");
  if (!countSelect) return [{ name: "Level 1", conversionToNext: null }];
  
  const count = parseInt(countSelect.value) || 1;
  const l1Name = document.getElementById("custom-l1-name")?.value.trim() || "Level 1";
  
  if (count === 1) {
    return [{ name: l1Name, conversionToNext: null }];
  } else if (count === 2) {
    const l2Name = document.getElementById("custom-l2-name")?.value.trim() || "Level 2";
    const l2Ratio = parseInt(document.getElementById("custom-l2-ratio")?.value) || 10;
    return [
      { name: l2Name, conversionToNext: l2Ratio },
      { name: l1Name, conversionToNext: null }
    ];
  } else if (count === 3) {
    const l2Name = document.getElementById("custom-l2-name")?.value.trim() || "Level 2";
    const l2Ratio = parseInt(document.getElementById("custom-l2-ratio")?.value) || 10;
    const l3Name = document.getElementById("custom-l3-name")?.value.trim() || "Level 3";
    const l3Ratio = parseInt(document.getElementById("custom-l3-ratio")?.value) || 10;
    return [
      { name: l3Name, conversionToNext: l3Ratio },
      { name: l2Name, conversionToNext: l2Ratio },
      { name: l1Name, conversionToNext: null }
    ];
  }
  return [];
}

function renderTargetAndCurrentInputs() {
  const levels = getLevelsFromForm();
  
  createTargetDynamic.innerHTML = "";
  createCurrentDynamic.innerHTML = "";
  
  const reversedLevels = [...levels].reverse();
  
  const isTimePres = (barPresetSelect.value === 'Time');
  const stepVal = isTimePres ? '1' : 'any';
  
  reversedLevels.forEach((level) => {
    const targetCol = document.createElement("div");
    targetCol.innerHTML = `
      <label class="form-row-label">${escapeHtml(level.name)}</label>
      <input class="form-input target-val-input" type="number" step="${stepVal}" data-level-name="${escapeHtml(level.name)}" min="0" placeholder="0">
    `;
    createTargetDynamic.appendChild(targetCol);
    
    const currentCol = document.createElement("div");
    currentCol.innerHTML = `
      <label class="form-row-label">${escapeHtml(level.name)}</label>
      <input class="form-input current-val-input" type="number" step="${stepVal}" data-level-name="${escapeHtml(level.name)}" min="0" placeholder="0">
    `;
    createCurrentDynamic.appendChild(currentCol);
  });
}

function attachStepperListeners(inputEl, minusBtn, plusBtn, isTimePres) {
  plusBtn.addEventListener('click', () => {
    if (isTimePres) {
      inputEl.value = (parseInt(inputEl.value) || 0) + 1;
    } else {
      inputEl.value = (parseFloat(inputEl.value) || 0) + 1;
    }
  });

  minusBtn.addEventListener('click', () => {
    if (isTimePres) {
      const current = parseInt(inputEl.value) || 0;
      inputEl.value = Math.max(0, current - 1);
    } else {
      const current = parseFloat(inputEl.value) || 0;
      inputEl.value = Math.max(0, current - 1);
    }
  });
}

// UPDATE MODAL LOGIC:
function openUpdateModal(bar) {
  selectedBar = bar;
  
  updateModalTitle.textContent = `Update Progress: ${bar.title}`;
  updateBarIdInput.value = bar.id;
  updateCurrentDynamic.innerHTML = "";
  
  // Reset delete confirmation safety pane
  deleteSafetyPane.classList.add("hidden");
  updateActionsStandard.classList.remove("hidden");
  
  // Decode current value into levels
  const currentLevelVals = decodeFromSmallest(bar.currentSmallest, bar.levels);
  
  // UI inputs are displayed largest-to-smallest (reversed levels array)
  const reversedLevels = [...bar.levels].reverse();
  
  const isTimePres = bar.preset === 'Time';
  const stepVal = isTimePres ? '1' : 'any';
  
  if (bar.levels.length === 1) {
    const val = currentLevelVals[0] || 0;
    
    const container = document.createElement("div");
    container.className = "stepper-horizontal";
    container.innerHTML = `
      <button type="button" class="stepper-btn" data-action="minus">−</button>
      <input type="number" step="${stepVal}" class="stepper-input update-val-input" min="0" value="${formatNumber(val)}">
      <button type="button" class="stepper-btn" data-action="plus">+</button>
    `;
    updateCurrentDynamic.appendChild(container);
    
    const inputEl = container.querySelector(".stepper-input");
    const minusBtn = container.querySelector('[data-action="minus"]');
    const plusBtn = container.querySelector('[data-action="plus"]');
    
    attachStepperListeners(inputEl, minusBtn, plusBtn, isTimePres);
  } else {
    const container = document.createElement("div");
    container.className = "stepper-multi-row";
    
    reversedLevels.forEach((level, index) => {
      const val = currentLevelVals[index] || 0;
      
      const card = document.createElement("div");
      card.className = "stepper-card";
      card.innerHTML = `
        <div class="stepper-card-label">${escapeHtml(level.name)}</div>
        <div class="stepper-card-controls">
          <button type="button" class="stepper-btn" data-action="minus">−</button>
          <input type="number" step="${stepVal}" class="stepper-input update-val-input" min="0" value="${formatNumber(val)}">
          <button type="button" class="stepper-btn" data-action="plus">+</button>
        </div>
      `;
      container.appendChild(card);
      
      const inputEl = card.querySelector(".stepper-input");
      const minusBtn = card.querySelector('[data-action="minus"]');
      const plusBtn = card.querySelector('[data-action="plus"]');
      
      attachStepperListeners(inputEl, minusBtn, plusBtn, isTimePres);
    });
    updateCurrentDynamic.appendChild(container);
  }
  
  openModal(modalUpdate);
}

function openEditModal(bar) {
  selectedBar = bar;

  // Reuse the Create modal but in edit mode
  document.getElementById('modal-create-title').textContent = 'Edit Tracker';
  document.getElementById('bar-title').value = bar.title;

  // Lock preset — cannot change preset after creation
  barPresetSelect.value = bar.preset;
  barPresetSelect.disabled = true;

  // Rebuild the dynamic inputs for target and current
  rebuildCreateFormInputs();

  // Pre-fill target (decode from smallest)
  const targetVals = decodeFromSmallest(bar.targetSmallest, bar.levels);
  const targetInputs = Array.from(createTargetDynamic.querySelectorAll('.target-val-input'));
  targetInputs.forEach((input, i) => {
    input.value = targetVals[i] ?? 0;
  });

  // Pre-fill current (decode from smallest)
  const currentVals = decodeFromSmallest(bar.currentSmallest, bar.levels);
  const currentInputs = Array.from(createCurrentDynamic.querySelectorAll('.current-val-input'));
  currentInputs.forEach((input, i) => {
    input.value = currentVals[i] ?? 0;
  });

  // Pre-fill deadline
  const dateInput = document.getElementById('bar-deadline-date');
  const timeInput = document.getElementById('bar-deadline-time');

  if (bar.deadline) {
    const deadlineMs = typeof bar.deadline.toDate === 'function'
      ? bar.deadline.toDate().getTime()
      : bar.deadline;
    const d = new Date(deadlineMs);
    const pad = n => String(n).padStart(2, '0');
    dateInput.value =
      `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    timeInput.value =
      `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    dateInput.value = '';
    timeInput.value = '';
  }

  // Switch form submit to edit mode
  formCreate.dataset.mode = 'edit';
  formCreate.dataset.editId = bar.id;

  openModal(modalCreate);
  initDeadlineInputs();
}


// ==========================================
// Firestore Form Submissions (Write / Update / Delete)
// ==========================================

// Create Form Submit
formCreate.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  if (!currentUser) return;
  
  const isEditMode = formCreate.dataset.mode === 'edit';
  const editBarId = formCreate.dataset.editId;
  
  const title = document.getElementById("bar-title").value.trim();
  const preset = isEditMode ? selectedBar.preset : barPresetSelect.value;
  const levels = isEditMode ? selectedBar.levels : getLevelsFromForm();
  
  // Custom Validation
  if (!isEditMode && preset === "Custom") {
    const countSelect = document.getElementById("custom-level-count");
    const count = parseInt(countSelect.value) || 1;
    const l1Name = document.getElementById("custom-l1-name")?.value.trim();
    if (!l1Name) {
      showToast("Level 1 Name is required.", "error");
      return;
    }
    if (count >= 2) {
      const l2Name = document.getElementById("custom-l2-name")?.value.trim();
      const l2Ratio = parseInt(document.getElementById("custom-l2-ratio")?.value);
      if (!l2Name) {
        showToast("Level 2 Name is required.", "error");
        return;
      }
      if (isNaN(l2Ratio) || l2Ratio < 2) {
        showToast("Level 2 conversion ratio must be an integer greater than or equal to 2.", "error");
        return;
      }
    }
    if (count === 3) {
      const l3Name = document.getElementById("custom-l3-name")?.value.trim();
      const l3Ratio = parseInt(document.getElementById("custom-l3-ratio")?.value);
      if (!l3Name) {
        showToast("Level 3 Name is required.", "error");
        return;
      }
      if (isNaN(l3Ratio) || l3Ratio < 2) {
        showToast("Level 3 conversion ratio must be an integer greater than or equal to 2.", "error");
        return;
      }
    }
  }
  
  // Fetch form values in largest-to-smallest order
  const targetInputs = Array.from(createTargetDynamic.querySelectorAll(".target-val-input"));
  const isTimePres = (preset === 'Time');
  const targetValsReversed = targetInputs.map(input => isTimePres ? (parseInt(input.value) || 0) : (parseFloat(input.value) || 0));
  
  // Compute smallest unit totals
  const targetSmallest = encodeToSmallest(targetValsReversed, levels);
  
  // Simple validation
  if (targetSmallest <= 0) {
    showToast("Target goal must be greater than 0.", "error");
    return;
  }
  
  const deadlineTimestamp = getDeadlineTimestamp();

  if (isEditMode) {
    if (selectedBar.currentSmallest > targetSmallest) {
      showToast("Target goal cannot be less than current progress.", "error");
      return;
    }
    try {
      closeModal(modalCreate);
      await editBar(isGuestMode() ? null : currentUser.uid, editBarId, {
        title,
        levels: selectedBar.levels,
        targetSmallest,
        deadlineTimestamp
      });
      // Reset form mode
      formCreate.dataset.mode = '';
      formCreate.dataset.editId = '';
      barPresetSelect.disabled = false;
      document.getElementById('modal-create-title').textContent = 'Create Progress Bar';
      showToast(`Successfully updated tracker "${title}"!`, "success");
    } catch (error) {
      showToast("Failed to edit progress bar.", "error");
    }
    return;
  }
  
  // NOT isEditMode (existing createBar flow)
  const currentInputs = Array.from(createCurrentDynamic.querySelectorAll(".current-val-input"));
  const currentValsReversed = currentInputs.map(input => isTimePres ? (parseInt(input.value) || 0) : (parseFloat(input.value) || 0));
  const currentSmallest = encodeToSmallest(currentValsReversed, levels);
  
  if (currentSmallest < 0) {
    showToast("Current progress must be at least 0.", "error");
    return;
  }
  
  if (currentSmallest > targetSmallest) {
    showToast("Current progress cannot exceed target goal.", "error");
    return;
  }

  if (currentBars.length >= 50) {
    showToast(
      "You've reached the maximum of 50 progress bars. Delete one to create a new one.",
      "error"
    );
    return;
  }
  
  try {
    closeModal(modalCreate);
    await createBar(isGuestMode() ? null : currentUser.uid, {
      title,
      preset,
      levels,
      targetSmallest,
      currentSmallest,
      deadlineTimestamp
    });
    showToast(`Successfully created progress bar "${title}"!`, "success");
  } catch (error) {
    showToast("Failed to create progress bar. Try again later.", "error");
  }
});

// Update Form Submit
formUpdate.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  if (!currentUser || !selectedBar) return;
  
  const barId = updateBarIdInput.value;
  
  // Fetch input fields
  const updateInputs = Array.from(updateCurrentDynamic.querySelectorAll(".update-val-input"));
  const isTimePres = (selectedBar.preset === 'Time');
  const currentValsReversed = updateInputs.map(input => isTimePres ? (parseInt(input.value) || 0) : (parseFloat(input.value) || 0));
  
  const currentSmallest = encodeToSmallest(currentValsReversed, selectedBar.levels);
  
  if (currentSmallest < 0) {
    showToast("Current progress must be at least 0.", "error");
    return;
  }
  
  if (currentSmallest > selectedBar.targetSmallest) {
    showToast("Current progress cannot exceed target goal.", "error");
    return;
  }
  
  try {
    closeModal(modalUpdate);
    await updateBarProgress(isGuestMode() ? null : currentUser.uid, barId, currentSmallest);
    showToast(`Progress for "${selectedBar.title}" updated.`, "success");
  } catch (error) {
    showToast("Failed to update progress.", "error");
  }
});

// Delete Safety Confirmation Pane toggles
btnDeleteTrigger.addEventListener("click", () => {
  updateActionsStandard.classList.add("hidden");
  deleteSafetyPane.classList.remove("hidden");
});

btnDeleteConfirmNo.addEventListener("click", () => {
  deleteSafetyPane.classList.add("hidden");
  updateActionsStandard.classList.remove("hidden");
});

btnDeleteConfirmYes.addEventListener("click", async () => {
  if (!currentUser || !selectedBar) return;
  const barId = selectedBar.id;
  const title = selectedBar.title;
  
  try {
    closeModal(modalUpdate);
    await deleteBar(isGuestMode() ? null : currentUser.uid, barId);
    showToast(`Deleted progress bar "${title}".`, "success");
  } catch (error) {
    showToast("Failed to delete progress bar.", "error");
  }
});

// ==========================================
// Guest Mode Migration
// ==========================================
async function migrateGuestBarsToFirestore(uid) {
  const localBars = getLocalBars();
  if (!localBars || localBars.length === 0) {
    exitGuestMode();
    return;
  }

  // Temporarily clear guest mode so that createBar calls during the migration loop
  // write to Firestore instead of writing back to localStorage
  exitGuestMode();

  let failCount = 0;

  for (const bar of localBars) {
    try {
      await createBar(uid, {
        title: bar.title,
        preset: bar.preset,
        levels: bar.levels,
        targetSmallest: bar.targetSmallest,
        currentSmallest: bar.currentSmallest,
        deadlineTimestamp: bar.deadline
      });
    } catch (e) {
      console.error('Migration failed for bar:', bar.title, e);
      failCount++;
    }
  }

  if (failCount === 0) {
    // All bars migrated successfully — safe to clear local data
    localStorage.removeItem('progress_shelf_bars');
  } else {
    // Partial failure — restore guest mode so local data is not lost and user can retry
    sessionStorage.setItem('guest_mode', 'true');
    showToast(
      `${failCount} bar(s) failed to sync. Your local data is preserved. Try signing in again.`,
      "error"
    );
  }
}

if (btnBannerLogin) {
  btnBannerLogin.addEventListener("click", async () => {
    try {
      btnBannerLogin.style.pointerEvents = "none";
      btnBannerLogin.textContent = "Signing in...";
      await loginWithGoogle();
    } catch (e) {
      console.error("Login from banner failed:", e);
      showToast("Authentication failed. Please try again.", "error");
      btnBannerLogin.style.pointerEvents = "all";
      btnBannerLogin.textContent = "Sign in to sync";
    }
  });
}

// ==========================================
// Authentication Redirection
// ==========================================
btnLogout.addEventListener("click", async () => {
  try {
    if (isGuestMode()) {
      exitGuestMode();
      window.location.href = "index.html";
    } else {
      await logout();
    }
  } catch (error) {
    showToast("Sign out failed. Please try again.", "error");
  }
});

// Initialize auth check
initAuthProtection(async (user) => {
  const localBars = getLocalBars();
  const hasLocalBars = localBars && localBars.length > 0;

  if (authInitialized && !isGuestMode() && !hasLocalBars) return;
  authInitialized = true;

  // Silent auto-migration if guest logs in or has local bars
  if ((isGuestMode() || hasLocalBars) && user && user.uid !== null) {
    // Show migration status
    if (loadingScreen) {
      const loadingText = loadingScreen.querySelector('.loading-text');
      if (loadingText) loadingText.textContent = 'Syncing your data...';
    }

    await migrateGuestBarsToFirestore(user.uid);
    // exitGuestMode() already called inside migrateGuestBarsToFirestore
    
    // Instead of returning and getting stuck, let it fall through to 
    // the normal dashboard initialization below, which will setup UI
    // for the logged-in user and start the proper Firestore subscription.
  }

  currentUser = user;
  
  // Render guest banner on dashboard if in guest mode
  if (guestBanner) {
    if (isGuestMode()) {
      guestBanner.style.display = "flex";
    } else {
      guestBanner.style.display = "none";
    }
  }
  
  // Render sandbox warning banner on dashboard if unconfigured and not in guest mode
  if (!isConfigured && !isGuestMode()) {
    if (!document.getElementById("sandbox-banner")) {
      const banner = document.createElement("div");
      banner.id = "sandbox-banner";
      banner.className = "config-warning-banner";
      banner.style.backgroundColor = "rgba(74, 144, 217, 0.1)";
      banner.style.color = "var(--accent)";
      banner.style.borderBottom = "1px solid var(--card-border)";
      banner.innerHTML = `<span>ℹ️ <strong>Sandbox Mode:</strong> Running locally. Copy <code>firebase-config.template.js</code> to <code>firebase-config.js</code> and fill in credentials to connect Firebase.</span>`;
      appContent.insertBefore(banner, appContent.firstChild);
    }
  }
  
  // Render profile info
  if (isGuestMode()) {
    userAvatar.src = "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y";
    userName.textContent = "Guest User";
  } else {
    userAvatar.src = user.photoURL || "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y";
    userName.textContent = user.displayName || "Tracker User";
  }
  
  // Show application content, hide splash screen
  loadingScreen.style.opacity = "0";
  loadingScreen.addEventListener("transitionend", () => {
    loadingScreen.remove();
  });
  appContent.classList.remove("hidden");
  
  // Subscribe to progress bars collection
  startSubscription(
    isGuestMode() ? null : user.uid,
    (bars) => {
      renderDashboard(bars);
    },
    (error) => {
      showToast("Error loading progress bars. You may be offline.", "error");
      if (cardsGrid.querySelectorAll(".card-skeleton").length > 0) {
        cardsGrid.innerHTML = `
          <div class="empty-state" style="border-color: var(--error);">
            <div class="empty-icon" style="color: var(--error)">⚠️</div>
            <h3 class="empty-title">Offline or Load Failed</h3>
            <p class="empty-desc">Could not connect to Firestore database. Please check your internet connection.</p>
            <button class="btn btn-secondary" onclick="window.location.reload()" style="margin-top: 16px;">Retry Connection</button>
          </div>
        `;
      }
    }
  );
});

