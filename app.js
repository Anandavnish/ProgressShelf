// app.js
import { isConfigured } from "./firebase-config.js";
import { logout, initAuthProtection, isGuestMode, exitGuestMode, loginWithGoogle } from "./auth.js";
import { subscribeToBars, createBar, updateBarProgress, deleteBar, getLocalBars } from "./db.js";

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

const PRESETS = {
  Lectures: { levels: [{ name: 'Lectures', conversionToNext: null }] },
  Videos:   { levels: [{ name: 'Videos',   conversionToNext: null }] },
  Chapters: { levels: [{ name: 'Chapters', conversionToNext: null }] },
  Problems: { levels: [{ name: 'Problems', conversionToNext: null }] },
  Tasks:    { levels: [{ name: 'Tasks',    conversionToNext: null }] },
  Pages:    { levels: [{ name: 'Pages',    conversionToNext: null }] },
  Books:    { levels: [{ name: 'Books',    conversionToNext: null }] },
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
    return `0 ${levels[0].name}`;
  }
  
  const parts = [];
  for (let i = firstIdx; i <= lastIdx; i++) {
    parts.push(`${vals[i]} ${reversedLevels[i].name}`);
  }
  return parts.join(' ');
}

function formatCardLabel(current, target, levels) {
  if (levels.length === 1) {
    return `${current} / ${target} ${levels[0].name}`;
  } else {
    const reversedLevels = [...levels].reverse();
    const targetVals = decodeFromSmallest(target, levels);
    const targetStr = targetVals.map((val, idx) => `${val} ${reversedLevels[idx].name}`).join(' ');
    const currentStr = formatCurrentProgress(current, levels);
    return `${currentStr} / ${targetStr}`;
  }
}

// ==========================================
// Dashboard Card Rendering
// ==========================================

function renderDashboard(bars) {
  currentBars = bars;
  cardsGrid.innerHTML = "";
  
  if (bars.length === 0) {
    // Just render the Add Card, empty state removed as requested
  } else {
    // Render cards
    bars.forEach((bar) => {
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
        <button class="btn-card-delete" title="Delete">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>
        </button>
        <h3 class="card-title" title="${escapeHtml(bar.title)}">${escapeHtml(bar.title)}</h3>
        <div class="card-body">
          <div class="card-percent">${percent.toFixed(1)}%</div>
          <div class="progressbar-track">
            <div class="progressbar-fill" style="width: ${percent}%;"></div>
          </div>
        </div>
        <div class="card-label" title="${escapeHtml(formatCardLabel(bar.currentSmallest, bar.targetSmallest, bar.levels))}">${escapeHtml(formatCardLabel(bar.currentSmallest, bar.targetSmallest, bar.levels))}</div>
      `;
      
      // Add click handler to edit progress or delete
      card.addEventListener("click", (e) => {
        if (e.target.closest('.btn-card-delete')) {
          e.stopPropagation();
          if (confirm(`Are you sure you want to delete "${bar.title}"?`)) {
            deleteBar(currentUser.uid, bar.id).then(() => {
              showToast(`Deleted progress bar "${bar.title}".`, "success");
            }).catch(() => {
              showToast("Failed to delete progress bar.", "error");
            });
          }
        } else {
          openUpdateModal(bar);
        }
      });
      
      cardsGrid.appendChild(card);
    });
  }
  
  // Always append the "+" Add card at the end
  const addCard = document.createElement("div");
  addCard.className = "card-add";
  addCard.id = "btn-add-card";
  addCard.innerHTML = `
    <div class="add-icon">+</div>
    <span class="add-text">Add New Tracker</span>
  `;
  addCard.addEventListener("click", () => openCreateModal());
  cardsGrid.appendChild(addCard);
}

// Background timer to remove .pulse-glow class after 5 minutes
setInterval(() => {
  document.querySelectorAll(".card-progress.pulse-glow").forEach((card) => {
    const lastUpdatedMs = Number(card.getAttribute("data-last-updated"));
    if (lastUpdatedMs) {
      const diffMinutes = (Date.now() - lastUpdatedMs) / (1000 * 60);
      if (diffMinutes >= 5) {
        card.classList.remove("pulse-glow");
      }
    }
  });
}, 60000); // Check every minute

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

// CREATE MODAL LOGIC:
function openCreateModal() {
  formCreate.reset();
  barPresetSelect.value = "";
  rebuildCreateFormInputs();
  openModal(modalCreate);
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
  
  reversedLevels.forEach((level) => {
    const targetCol = document.createElement("div");
    targetCol.innerHTML = `
      <label class="form-row-label">${escapeHtml(level.name)}</label>
      <input class="form-input target-val-input" type="number" step="any" data-level-name="${escapeHtml(level.name)}" min="0" placeholder="0">
    `;
    createTargetDynamic.appendChild(targetCol);
    
    const currentCol = document.createElement("div");
    currentCol.innerHTML = `
      <label class="form-row-label">${escapeHtml(level.name)}</label>
      <input class="form-input current-val-input" type="number" step="any" data-level-name="${escapeHtml(level.name)}" min="0" placeholder="0">
    `;
    createCurrentDynamic.appendChild(currentCol);
  });
}

function attachStepperListeners(inputEl, minusBtn, plusBtn) {
  plusBtn.addEventListener('click', () => {
    inputEl.value = (parseFloat(inputEl.value) || 0) + 1;
  });

  minusBtn.addEventListener('click', () => {
    const current = parseFloat(inputEl.value) || 0;
    inputEl.value = Math.max(0, current - 1);
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
  
  if (bar.levels.length === 1) {
    const val = currentLevelVals[0] || 0;
    
    const container = document.createElement("div");
    container.className = "stepper-horizontal";
    container.innerHTML = `
      <button type="button" class="stepper-btn" data-action="minus">−</button>
      <input type="number" step="any" class="stepper-input update-val-input" min="0" value="${val}">
      <button type="button" class="stepper-btn" data-action="plus">+</button>
    `;
    updateCurrentDynamic.appendChild(container);
    
    const inputEl = container.querySelector(".stepper-input");
    const minusBtn = container.querySelector('[data-action="minus"]');
    const plusBtn = container.querySelector('[data-action="plus"]');
    
    attachStepperListeners(inputEl, minusBtn, plusBtn);
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
          <input type="number" step="any" class="stepper-input update-val-input" min="0" value="${val}">
          <button type="button" class="stepper-btn" data-action="plus">+</button>
        </div>
      `;
      container.appendChild(card);
      
      const inputEl = card.querySelector(".stepper-input");
      const minusBtn = card.querySelector('[data-action="minus"]');
      const plusBtn = card.querySelector('[data-action="plus"]');
      
      attachStepperListeners(inputEl, minusBtn, plusBtn);
    });
    updateCurrentDynamic.appendChild(container);
  }
  
  openModal(modalUpdate);
}


// ==========================================
// Firestore Form Submissions (Write / Update / Delete)
// ==========================================

// Create Form Submit
formCreate.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  if (!currentUser) return;
  
  const title = document.getElementById("bar-title").value.trim();
  const preset = barPresetSelect.value;
  const levels = getLevelsFromForm();
  
  // Custom Validation
  if (preset === "Custom") {
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
  const currentInputs = Array.from(createCurrentDynamic.querySelectorAll(".current-val-input"));
  
  // Extract number values
  const targetValsReversed = targetInputs.map(input => parseFloat(input.value) || 0);
  const currentValsReversed = currentInputs.map(input => parseFloat(input.value) || 0);
  
  // Compute smallest unit totals
  const targetSmallest = encodeToSmallest(targetValsReversed, levels);
  const currentSmallest = encodeToSmallest(currentValsReversed, levels);
  
  // Simple validation
  if (targetSmallest <= 0) {
    showToast("Target goal must be greater than 0.", "error");
    return;
  }
  
  if (currentSmallest < 0) {
    showToast("Current progress must be at least 0.", "error");
    return;
  }
  
  if (currentSmallest > targetSmallest) {
    showToast("Current progress cannot exceed target goal.", "error");
    return;
  }
  
  try {
    closeModal(modalCreate);
    await createBar(currentUser.uid, {
      title,
      preset,
      levels,
      targetSmallest,
      currentSmallest
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
  const currentValsReversed = updateInputs.map(input => parseFloat(input.value) || 0);
  
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
    await updateBarProgress(currentUser.uid, barId, currentSmallest);
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
    await deleteBar(currentUser.uid, barId);
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

  for (const bar of localBars) {
    try {
      await createBar(uid, {
        title: bar.title,
        preset: bar.preset,
        levels: bar.levels,
        targetSmallest: bar.targetSmallest,
        currentSmallest: bar.currentSmallest
      });
    } catch (e) {
      console.error('Migration failed for bar:', bar.title, e);
    }
  }

  localStorage.removeItem('progress_shelf_bars');
  exitGuestMode();
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
  // Silent auto-migration if guest logs in
  if (isGuestMode() && user && user.uid !== "guest") {
    await migrateGuestBarsToFirestore(user.uid);
    window.location.reload();
    return;
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
  subscribeToBars(
    user.uid,
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

