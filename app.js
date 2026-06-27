// app.js
import { isConfigured } from "./firebase-config.js";
import { logout, initAuthProtection, isGuestMode, exitGuestMode, loginWithGoogle, deleteCurrentUserAccount } from "./auth.js";
import { subscribeToBars, createBar, updateBarProgress, deleteBar, getLocalBars, editBar, deleteUserData } from "./db.js";

// Page elements
const navLogoSvg = document.getElementById("nav-logo-svg");
const appContent = document.getElementById("app-content");
const cardsGrid = document.getElementById("cards-grid");
const btnLogout = document.getElementById("btn-logout");
const btnDeleteAccount = document.getElementById("btn-delete-account");
const userAvatar = document.getElementById("user-avatar");
const userName = document.getElementById("user-name");
const btnProfileBadge = document.getElementById("btn-profile-badge");
const profileDropdown = document.getElementById("profile-dropdown");
const userStatus = document.getElementById("user-status");
const statTotal = document.getElementById("stat-total");
const statDeadlines = document.getElementById("stat-deadlines");
const statOverdue = document.getElementById("stat-overdue");
const statCompleted = document.getElementById("stat-completed");
const statFlexible = document.getElementById("stat-flexible");
const statsBanner = document.getElementById("stats-banner");

// Modals
const modalCreate = document.getElementById("modal-create");
const modalEdit = document.getElementById("modal-edit");
const modalUpdate = document.getElementById("modal-update");
const formCreate = document.getElementById("form-create");
const formEdit = document.getElementById("form-edit");
const formUpdate = document.getElementById("form-update");

// Dynamic containers (Create Modal)
const barPresetSelect = document.getElementById("bar-preset");
const presetsDynamicContainer = document.getElementById("create-presets-dynamic");
const createTargetDynamic = document.getElementById("create-target-dynamic");
const createCurrentDynamic = document.getElementById("create-current-dynamic");

// Dynamic containers (Edit Modal)
const editBarPresetSelect = document.getElementById("edit-bar-preset");
const editTargetDynamic = document.getElementById("edit-target-dynamic");

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

const deadlineResizeObserver = new ResizeObserver(entries => {
  entries.forEach(entry => {
    const card = entry.target;
    const barEl = card.querySelector('.deadline-bar');
    const trackEl = card.querySelector('.deadline-track');
    if (!barEl || !trackEl) return;
    resizeDeadlineSVG(card, barEl, trackEl);
  });
});

function getDeadlineMs(bar) {
  if (!bar.deadlineAt) return null;
  return typeof bar.deadlineAt.toDate === 'function'
    ? bar.deadlineAt.toDate().getTime()
    : Number(bar.deadlineAt);
}

function applyDeadlineTick(barEl) {
  const deadlineMs = Number(barEl.dataset.deadlineMs);
  const deadlineSetMs = Number(barEl.dataset.deadlineSetMs);
  const perimeter = Number(barEl.dataset.perimeter);
  if (!perimeter) return;

  const total = deadlineMs - deadlineSetMs;
  const timeLeft = deadlineMs - Date.now();
  const percentLeft = total > 0
    ? Math.max(0, Math.min(100, (timeLeft / total) * 100))
    : 0;

  barEl.setAttribute('stroke-dasharray', perimeter);
  barEl.setAttribute('stroke-dashoffset', perimeter - (perimeter * percentLeft / 100));

  if (timeLeft <= 0) {
    barEl.setAttribute('stroke', '#E74C3C');
    barEl.classList.add('deadline-overdue');
  } else {
    barEl.setAttribute('stroke', `hsl(${percentLeft * 1.2}, 90%, 48%)`);
    barEl.classList.remove('deadline-overdue');
  }
}

function resizeDeadlineSVG(card, barEl, trackEl) {
  const w = card.clientWidth;
  const h = card.clientHeight;
  if (!w || !h) return;

  const strokeWidth = 5;
  const pad = strokeWidth / 2; // 2.5px padding so centered stroke is inward
  const rx = 12 - pad; // 9.5px rounded corners to match 12px card border radius
  const perimeter = 2 * ((w - pad * 2) + (h - pad * 2));

  const svg = card.querySelector('.deadline-svg');
  if (svg) {
    Object.assign(svg.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      overflow: 'hidden',
      zIndex: '0',
      transform: 'scaleX(-1)' // Clockwise drain
    });
  }

  [barEl, trackEl].forEach(el => {
    el.setAttribute('x', pad);
    el.setAttribute('y', pad);
    el.setAttribute('width', w - pad * 2);
    el.setAttribute('height', h - pad * 2);
    el.setAttribute('rx', rx);
    el.setAttribute('fill', 'none');
  });

  trackEl.setAttribute('stroke', 'rgba(255,255,255,0.07)');
  trackEl.setAttribute('stroke-width', strokeWidth);
  barEl.setAttribute('stroke-width', strokeWidth);
  barEl.setAttribute('stroke-linecap', 'round');
  barEl.dataset.perimeter = perimeter;
  applyDeadlineTick(barEl);
}

function attachDeadlineBorder(card, bar) {
  card.querySelector('.deadline-svg')?.remove();
  const deadlineMs = getDeadlineMs(bar);
  if (!deadlineMs) return;

  let deadlineSetMs = typeof bar.deadlineSetAt?.toDate === 'function'
    ? bar.deadlineSetAt.toDate().getTime()
    : (Number(bar.deadlineSetAt) || null);

  if (!deadlineSetMs) {
    deadlineSetMs = typeof bar.createdAt?.toDate === 'function'
      ? bar.createdAt.toDate().getTime()
      : (Number(bar.createdAt) || Date.now());
  }

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.classList.add('deadline-svg');

  const track = document.createElementNS(svgNS, 'rect');
  track.classList.add('deadline-track');

  const barEl = document.createElementNS(svgNS, 'rect');
  barEl.classList.add('deadline-bar');
  barEl.dataset.deadlineMs = deadlineMs;
  barEl.dataset.deadlineSetMs = deadlineSetMs;

  svg.appendChild(track);
  svg.appendChild(barEl);
  card.appendChild(svg);

  resizeDeadlineSVG(card, barEl, track);
  deadlineResizeObserver.observe(card);
}

// Application State
let currentUser = null;
let currentBars = [];
let selectedBar = null;
let activeUnsubscribe = null;
let authInitialized = false;
let currentFilter = "all";
const expandedCardIds = new Set();
let closedViaPopState = false;
let searchClosedViaPopState = false;

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
  Videos: { levels: [{ name: 'Videos', conversionToNext: null }] },
  Problems: { levels: [{ name: 'Problems', conversionToNext: null }] },
  Tasks: { levels: [{ name: 'Tasks', conversionToNext: null }] },
  Pages: { levels: [{ name: 'Pages', conversionToNext: null }] },
  Books: { levels: [{ name: 'Books', conversionToNext: null }] },
  Chapters: { levels: [{ name: 'Chapters', conversionToNext: null }] },
  Time: {
    levels: [
      { name: 'Minutes', conversionToNext: 60 },
      { name: 'Hours', conversionToNext: null }
    ]
  },
  Custom: null
};

// ==========================================
// Toast Notifications
// ==========================================
function showToast(message, type = "info", duration = 4000) {
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

  // Auto-dismiss if duration > 0
  if (duration > 0) {
    setTimeout(() => {
      dismissToast(toast);
    }, duration);
  }

  return toast;
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

function formatTimeLeft(deadlineMs) {
  const now = Date.now();
  const rawDiff = deadlineMs - now;
  const isOverdue = rawDiff < 0;
  const diff = Math.abs(rawDiff);

  if (diff === 0) {
    return { label: "Due now", isOverdue: false };
  }

  const totalSecs  = Math.floor(diff / 1000);
  const totalMins  = Math.floor(totalSecs / 60);
  const totalHours = Math.floor(totalMins / 60);
  const totalDays  = Math.floor(totalHours / 24);

  // Helper to format values with optional singular/plural formatting
  const fmt = (val, singular, plural) => {
    return val === 1 ? `1 ${singular}` : `${val} ${plural}`;
  };

  let tierOutput = "";

  if (totalSecs < 60) {
    // Tier 1: seconds only
    tierOutput = fmt(totalSecs, "sec", "secs");
  } else if (totalMins < 60) {
    // Tier 2: minutes + seconds
    const mins = totalMins;
    const secs = totalSecs % 60;
    if (secs === 0) {
      tierOutput = fmt(mins, "min", "mins");
    } else {
      tierOutput = `${fmt(mins, "min", "mins")} ${fmt(secs, "sec", "secs")}`;
    }
  } else if (totalHours < 48) {
    // Tier 3: hours + minutes
    const hrs = totalHours;
    const mins = totalMins % 60;
    if (mins === 0) {
      tierOutput = fmt(hrs, "hr", "hrs");
    } else {
      tierOutput = `${fmt(hrs, "hr", "hrs")} ${fmt(mins, "min", "mins")}`;
    }
  } else if (totalDays < 14) {
    // Tier 4: days + hours
    const days = totalDays;
    const hrs = totalHours % 24;
    if (hrs === 0) {
      tierOutput = fmt(days, "day", "days");
    } else {
      tierOutput = `${fmt(days, "day", "days")} ${fmt(hrs, "hr", "hrs")}`;
    }
  } else if (totalDays < 60) {
    // Tier 5: weeks + days
    const weeks = Math.floor(totalDays / 7);
    const days = totalDays % 7;
    if (days === 0) {
      tierOutput = fmt(weeks, "week", "weeks");
    } else {
      tierOutput = `${fmt(weeks, "week", "weeks")} ${fmt(days, "day", "days")}`;
    }
  } else {
    // Tier 6: months + days
    const months = Math.floor(totalDays / 30);
    const days = totalDays % 30;
    if (days === 0) {
      tierOutput = fmt(months, "month", "months");
    } else {
      tierOutput = `${fmt(months, "month", "months")} ${fmt(days, "day", "days")}`;
    }
  }

  const label = isOverdue ? `Overdue by ${tierOutput}` : `${tierOutput} left`;
  return { label, isOverdue };
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
  const safeLevels = (levels && levels.length) ? levels : [{ name: 'Units', conversionToNext: null }];
  // Returns array ordered largest→smallest (for display)
  let remaining = smallest;
  const vals = [];

  for (let i = 0; i < safeLevels.length; i++) {
    if (safeLevels[i].conversionToNext === null) {
      // Top level — remainder goes here
      vals.push(remaining);
    } else {
      vals.push(remaining % safeLevels[i].conversionToNext);
      remaining = Math.floor(remaining / safeLevels[i].conversionToNext);
    }
  }

  // vals is now smallest→largest, reverse for display (largest→smallest)
  return vals.reverse();
}

function getUnitName(name) {
  if (name === "Hours") return "hr";
  if (name === "Minutes") return "min";
  if (name === "Seconds") return "sec";
  return name;
}

function formatCurrentProgress(current, levels) {
  const safeLevels = (levels && levels.length) ? levels : [{ name: 'Units', conversionToNext: null }];
  const vals = decodeFromSmallest(current, safeLevels); // largest-to-smallest
  const reversedLevels = [...safeLevels].reverse(); // largest-to-smallest

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
    return `${formatNumber(0)} ${getUnitName(safeLevels[0].name)}`;
  }

  const parts = [];
  for (let i = firstIdx; i <= lastIdx; i++) {
    parts.push(`${formatNumber(vals[i])} ${getUnitName(reversedLevels[i].name)}`);
  }
  return parts.join(' ');
}

function formatCardLabel(current, target, levels) {
  const safeLevels = (levels && levels.length) ? levels : [{ name: 'Units', conversionToNext: null }];
  if (safeLevels.length === 1) {
    return `${formatNumber(current)} / ${formatNumber(target)} ${getUnitName(safeLevels[0].name)}`;
  } else {
    const reversedLevels = [...safeLevels].reverse();
    const targetVals = decodeFromSmallest(target, safeLevels);
    const targetStr = targetVals.map((val, idx) => `${formatNumber(val)} ${getUnitName(reversedLevels[idx].name)}`).join(' ');
    const currentStr = formatCurrentProgress(current, safeLevels);
    return `${currentStr} / ${targetStr}`;
  }
}

// ==========================================
// Dashboard Stats Bar Calculation
// ==========================================
function isTrackerCompleted(bar) {
  if (bar.completed !== undefined && bar.completed !== null) {
    return !!bar.completed;
  }
  const barType = bar.type || "goal";
  if (barType === "goal") {
    const percent = bar.targetSmallest > 0 ? (bar.currentSmallest / bar.targetSmallest) * 100 : 0;
    return percent >= 100;
  }
  if (barType === "checklist") {
    const items = bar.items || [];
    return items.length > 0 && items.every(item => item.done);
  }
  return false;
}

function updateOverallStats(bars) {
  if (!statTotal || !statDeadlines || !statOverdue || !statCompleted || !statFlexible || !statsBanner) return;

  const total = bars.length;
  let deadlinesCount = 0;
  let overdueCount = 0;
  let completedCount = 0;
  let flexibleCount = 0;
  const now = Date.now();

  bars.forEach(bar => {
    const completed = isTrackerCompleted(bar);

    if (completed) {
      completedCount++;
    } else {
      const deadlineMs = getDeadlineMs(bar);
      if (deadlineMs) {
        if (deadlineMs <= now) {
          overdueCount++;
        } else {
          deadlinesCount++;
        }
      } else {
        flexibleCount++;
      }
    }
  });

  // Update text contents
  statTotal.textContent = total;
  statDeadlines.textContent = deadlinesCount;
  statOverdue.textContent = overdueCount;
  statCompleted.textContent = completedCount;
  statFlexible.textContent = flexibleCount;

  // If no cards are available at all, hide the entire stats bar
  if (total === 0) {
    statsBanner.classList.add("hidden");
    return;
  } else {
    statsBanner.classList.remove("hidden");
  }

  // Get buttons and dividers
  const btnAll = document.getElementById("btn-stat-all");
  const btnDeadlines = document.getElementById("btn-stat-deadlines");
  const btnOverdue = document.getElementById("btn-stat-overdue");
  const btnCompleted = document.getElementById("btn-stat-completed");
  const btnFlexible = document.getElementById("btn-stat-flexible");

  const divDeadlines = document.getElementById("div-stat-deadlines");
  const divOverdue = document.getElementById("div-stat-overdue");
  const divCompleted = document.getElementById("div-stat-completed");
  const divFlexible = document.getElementById("div-stat-flexible");

  // Helper to toggle visibility of button and its preceding divider
  function toggleBtn(btn, div, count) {
    if (!btn) return;
    if (count > 0) {
      btn.classList.remove("hidden");
      if (div) div.classList.remove("hidden");
    } else {
      btn.classList.add("hidden");
      if (div) div.classList.add("hidden");
    }
  }

  // All Trackers is always visible if total > 0
  if (btnAll) btnAll.classList.remove("hidden");

  toggleBtn(btnDeadlines, divDeadlines, deadlinesCount);
  toggleBtn(btnOverdue, divOverdue, overdueCount);
  toggleBtn(btnCompleted, divCompleted, completedCount);
  toggleBtn(btnFlexible, divFlexible, flexibleCount);

  // If the active filter is now hidden, reset to 'all'
  if (currentFilter === "deadlines" && deadlinesCount === 0) currentFilter = "all";
  if (currentFilter === "overdue" && overdueCount === 0) currentFilter = "all";
  if (currentFilter === "completed" && completedCount === 0) currentFilter = "all";
  if (currentFilter === "flexible" && flexibleCount === 0) currentFilter = "all";

  // Update active class on buttons
  const buttons = [btnAll, btnDeadlines, btnOverdue, btnCompleted, btnFlexible];
  buttons.forEach(btn => {
    if (btn) {
      if (btn.getAttribute("data-filter") === currentFilter) {
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
      } else {
        btn.classList.remove("active");
        btn.setAttribute("aria-pressed", "false");
      }
    }
  });
}

function filterBars(bars) {
  const now = Date.now();
  const searchInput = document.getElementById("global-search");
  const query = searchInput ? searchInput.value.toLowerCase().trim() : "";

  return bars.filter(bar => {
    if (query && !bar.title.toLowerCase().includes(query)) {
      return false;
    }

    const completed = isTrackerCompleted(bar);

    if (currentFilter === "all") {
      return true;
    }

    if (currentFilter === "completed") {
      return completed;
    }

    // Incomplete filters
    if (completed) {
      return false;
    }

    const deadlineMs = getDeadlineMs(bar);

    if (currentFilter === "deadlines") {
      return deadlineMs && deadlineMs > now;
    }

    if (currentFilter === "overdue") {
      return deadlineMs && deadlineMs <= now;
    }

    if (currentFilter === "flexible") {
      return !deadlineMs;
    }

    return true;
  });
}

function updateCardElement(card, bar) {
  const barType = bar.type || "goal";
  
  // Check if card type changed
  if (barType === "checklist" && !card.querySelector(".card-checklist-container")) return false;
  if (barType === "note" && !card.querySelector(".card-note-text")) return false;
  if (barType === "goal" && !card.querySelector(".card-body")) return false;

  // Update attributes
  let lastUpdatedMs = Date.now();
  if (bar.lastUpdated) {
    lastUpdatedMs = typeof bar.lastUpdated.toDate === 'function'
      ? bar.lastUpdated.toDate().getTime()
      : bar.lastUpdated;
  }
  card.setAttribute("data-last-updated", lastUpdatedMs);

  const diffMinutes = (Date.now() - lastUpdatedMs) / (1000 * 60);
  if (diffMinutes < 5) {
    card.classList.add("pulse-glow");
  } else {
    card.classList.remove("pulse-glow");
  }

  // Calculate completion percentage
  const percent = bar.targetSmallest > 0
    ? Math.max(0, Math.min(100, (bar.currentSmallest / bar.targetSmallest) * 100))
    : 0;

  // Get interpolated color
  const barColor = getProgressColor(percent);
  card.style.setProperty("--bar-color", barColor);

  // Update title
  const titleEl = card.querySelector(".card-title");
  if (titleEl) {
    titleEl.textContent = bar.title;
    titleEl.setAttribute("title", bar.title);
  }

  // Re-bind action button click listeners with latest bar data
  // (Clone and replace the buttons to clear old listeners)
  const btnEdit = card.querySelector(".btn-card-edit");
  if (btnEdit) {
    const newBtnEdit = btnEdit.cloneNode(true);
    btnEdit.replaceWith(newBtnEdit);
    newBtnEdit.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditModal(bar);
    });
  }

  const btnDeleteConfirm = card.querySelector(".btn-delete-confirm-inline");
  if (btnDeleteConfirm) {
    const newBtnDeleteConfirm = btnDeleteConfirm.cloneNode(true);
    btnDeleteConfirm.replaceWith(newBtnDeleteConfirm);
    newBtnDeleteConfirm.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteBar(isGuestMode() ? null : currentUser.uid, bar.id)
        .then(() => showToast(`Deleted "${bar.title}".`, "success"))
        .catch(() => showToast("Failed to delete progress bar.", "error"));
    });
  }

  if (barType === "goal") {
    const percentEl = card.querySelector(".card-percent");
    if (percentEl) percentEl.textContent = `${formatNumber(percent)}%`;

    const fillEl = card.querySelector(".progressbar-fill");
    if (fillEl) fillEl.style.width = `${percent}%`;

    const labelEl = card.querySelector(".card-label");
    if (labelEl) {
      const labelText = formatCardLabel(bar.currentSmallest, bar.targetSmallest, bar.levels);
      labelEl.textContent = labelText;
      labelEl.setAttribute("title", labelText);
    }
  } else if (barType === "checklist") {
    const items = bar.items || [];
    const doneCount = items.filter(item => item.done).length;
    const totalCount = items.length;
    const percentage = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    const container = card.querySelector(".card-checklist-container");
    if (container) {
      const isExpanded = expandedCardIds.has(bar.id);
      const itemsHtml = items.map((item, index) => {
        const collapsibleClass = index >= 3 ? " collapsible-item" : "";
        const inlineStyle = index >= 3 ? (isExpanded ? ' style="display: flex;"' : ' style="display: none;"') : '';
        return `
          <label class="card-checklist-item${item.done ? " done" : ""}${collapsibleClass}"${inlineStyle}>
            <input type="checkbox" ${item.done ? "checked" : ""}>
            <span class="checklist-item-text">${escapeHtml(item.text)}</span>
          </label>
        `;
      }).join("");
      container.innerHTML = itemsHtml;

      // Re-register checkbox listeners
      card.querySelectorAll(".card-checklist-item input[type='checkbox']").forEach((checkbox, idx) => {
        checkbox.addEventListener("click", (e) => {
          e.stopPropagation();
        });
        checkbox.addEventListener("change", async (e) => {
          const isChecked = e.target.checked;
          const updatedItems = JSON.parse(JSON.stringify(bar.items || []));
          if (updatedItems[idx]) {
            updatedItems[idx].done = isChecked;
          }
          
          const targetSmallest = updatedItems.length;
          const currentSmallest = updatedItems.filter(item => item.done).length;
          const completed = updatedItems.length > 0 && updatedItems.every(item => item.done);
          
          const checklistItemEl = checkbox.closest(".card-checklist-item");
          if (checklistItemEl) {
            if (isChecked) {
              checklistItemEl.classList.add("done");
            } else {
              checklistItemEl.classList.remove("done");
            }
          }
          
          const progressWrapper = card.querySelector(".checklist-progress-wrapper");
          const progressPercent = targetSmallest > 0 ? Math.round((currentSmallest / targetSmallest) * 100) : 0;
          
          if (progressWrapper) {
            const percentEl = progressWrapper.querySelector(".checklist-percent");
            if (percentEl) percentEl.textContent = `${progressPercent}%`;
            
            const fillEl = progressWrapper.querySelector(".progressbar-fill");
            if (fillEl) fillEl.style.width = `${progressPercent}%`;
          }
          
          const summaryEl = card.querySelector(".checklist-summary-line");
          if (summaryEl) {
            summaryEl.innerHTML = `<span>✓</span> ${currentSmallest} / ${targetSmallest} done`;
          }
          
          try {
            await editBar(isGuestMode() ? null : currentUser.uid, bar.id, {
              title: bar.title,
              targetSmallest,
              currentSmallest,
              items: updatedItems,
              completed,
              updateDeadline: false
            });
          } catch (error) {
            showToast("Failed to update checklist progress.", "error");
            renderDashboard(currentBars);
          }
        });
      });
    }

    // Update show more / less indicators
    const showMoreBtn = card.querySelector(".show-more-indicator");
    if (showMoreBtn) {
      if (totalCount > 3) {
        showMoreBtn.textContent = `Show more (+${totalCount - 3})`;
        showMoreBtn.style.display = expandedCardIds.has(bar.id) ? "none" : "inline-block";
      } else {
        showMoreBtn.style.display = "none";
      }
    }

    const showLessBtn = card.querySelector(".show-less-indicator");
    if (showLessBtn) {
      const newShowLessBtn = showLessBtn.cloneNode(true);
      showLessBtn.replaceWith(newShowLessBtn);
      newShowLessBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        collapseCard(card);
      });
      newShowLessBtn.style.display = (totalCount > 3 && expandedCardIds.has(bar.id)) ? "inline-block" : "none";
    }

    const progressWrapper = card.querySelector(".checklist-progress-wrapper");
    if (progressWrapper) {
      const percentEl = progressWrapper.querySelector(".checklist-percent");
      if (percentEl) percentEl.textContent = `${percentage}%`;
      
      const fillEl = progressWrapper.querySelector(".progressbar-fill");
      if (fillEl) fillEl.style.width = `${percentage}%`;
    }

    const summaryEl = card.querySelector(".checklist-summary-line");
    if (summaryEl) {
      summaryEl.innerHTML = `<span>✓</span> ${doneCount} / ${totalCount} done`;
    }
  } else if (barType === "note") {
    const textEl = card.querySelector(".card-note-text");
    if (textEl) textEl.textContent = bar.text || "";
  }

  // Update deadlines and SVG in-place
  const isCompleted = isTrackerCompleted(bar);
  const dMs = getDeadlineMs(bar);

  let divider = card.querySelector(".card-divider");
  let labelEl = card.querySelector(".card-deadline-label");

  if (isCompleted || dMs) {
    if (!divider) {
      divider = document.createElement("hr");
      divider.className = "card-divider";
      card.appendChild(divider);
    }
    if (!labelEl) {
      labelEl = document.createElement("div");
      labelEl.className = "card-deadline-label";
      labelEl.style.marginTop = "10px";
      labelEl.style.fontSize = "0.8rem";
      labelEl.style.color = "var(--text-muted)";
      card.appendChild(labelEl);
    }

    if (isCompleted) {
      labelEl.setAttribute("data-completed", "true");
      labelEl.setAttribute("data-deadline-ms", dMs || "");
      labelEl.classList.remove("overdue");
      labelEl.innerHTML = `<span class="badge-completed">✓ Completed</span>`;
    } else {
      const { label, isOverdue } = formatTimeLeft(dMs);
      labelEl.setAttribute("data-completed", "false");
      labelEl.setAttribute("data-deadline-ms", dMs);
      labelEl.setAttribute("data-percent", percent);
      labelEl.innerHTML = `<span class="deadline-text-val">⏱ ${label}</span>`;
      if (isOverdue) {
        labelEl.classList.add("overdue");
      } else {
        labelEl.classList.remove("overdue");
      }
    }

    // Update/Attach SVG
    let svg = card.querySelector(".deadline-svg");
    if (dMs) {
      if (!svg) {
        attachDeadlineBorder(card, bar);
      } else {
        const barEl = svg.querySelector(".deadline-bar");
        if (barEl) {
          barEl.dataset.deadlineMs = dMs;
          let deadlineSetMs = typeof bar.deadlineSetAt?.toDate === 'function'
            ? bar.deadlineSetAt.toDate().getTime()
            : (Number(bar.deadlineSetAt) || null);
          if (!deadlineSetMs) {
            deadlineSetMs = typeof bar.createdAt?.toDate === 'function'
              ? bar.createdAt.toDate().getTime()
              : (Number(bar.createdAt) || Date.now());
          }
          barEl.dataset.deadlineSetMs = deadlineSetMs;
          applyDeadlineTick(barEl);
        }
      }
    } else {
      svg?.remove();
    }
  } else {
    divider?.remove();
    labelEl?.remove();
    card.querySelector(".deadline-svg")?.remove();
  }

  return true;
}

function createCardElement(bar) {
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

  const isExpanded = expandedCardIds.has(bar.id);
  if (isExpanded) {
    card.classList.add("expanded");
  }

  const barType = bar.type || "goal";
  let bodyHtml = "";

  if (barType === "goal") {
    bodyHtml = `
      <div class="card-body">
        <div class="card-percent">${formatNumber(percent)}%</div>
        <div class="progressbar-track">
          <div class="progressbar-fill" style="width: ${percent}%;"></div>
        </div>
      </div>
      <div class="card-label" title="${escapeHtml(formatCardLabel(bar.currentSmallest, bar.targetSmallest, bar.levels))}">${escapeHtml(formatCardLabel(bar.currentSmallest, bar.targetSmallest, bar.levels))}</div>
    `;
  } else if (barType === "checklist") {
    const items = bar.items || [];
    const doneCount = items.filter(item => item.done).length;
    const totalCount = items.length;
    
    const showMoreBtnHtml = totalCount > 3 ? `
      <div class="show-more-indicator">Show more (+${totalCount - 3})</div>
      <div class="show-less-indicator">Collapse</div>
    ` : "";
    
    const percentage = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    const itemsHtml = items.map((item, index) => {
      const collapsibleClass = index >= 3 ? " collapsible-item" : "";
      const inlineStyle = index >= 3 ? (isExpanded ? ' style="display: flex;"' : ' style="display: none;"') : '';
      return `
        <label class="card-checklist-item${item.done ? " done" : ""}${collapsibleClass}"${inlineStyle}>
          <input type="checkbox" ${item.done ? "checked" : ""}>
          <span class="checklist-item-text">${escapeHtml(item.text)}</span>
        </label>
      `;
    }).join("");

    let pbarHtml = "";
    if (totalCount > 0) {
      pbarHtml = `
        <div class="checklist-progress-wrapper" style="margin-top: 14px;">
          <div class="progressbar-track" style="margin-bottom: 8px;">
            <div class="progressbar-fill" style="width: ${percentage}%;"></div>
          </div>
          <div class="checklist-footer-row" style="display: flex; justify-content: space-between; align-items: center;">
            <span class="checklist-summary-line" style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; display: flex; align-items: center; gap: 6px;">
              <span>✓</span> ${doneCount} / ${totalCount} done
            </span>
            <span class="checklist-percent" style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary);">${percentage}%</span>
          </div>
        </div>
      `;
    }

    bodyHtml = `
      <div class="card-checklist-container">
        ${itemsHtml}
      </div>
      ${showMoreBtnHtml}
      ${pbarHtml}
    `;
  } else if (barType === "note") {
    const text = bar.text || "";
    const isLongNote = text.length > 150 || text.includes("\n");
    const showMoreBtnHtml = isLongNote ? `<div class="show-more-indicator">Show more</div>` : "";
    bodyHtml = `
      <div class="card-note-text">${escapeHtml(text)}</div>
      ${showMoreBtnHtml}
    `;
  }

  const isCompleted = isTrackerCompleted(bar);

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
    ${bodyHtml}
    ${(isCompleted || getDeadlineMs(bar)) ? (() => {
      const dMs = getDeadlineMs(bar);
      if (isCompleted) {
        return `
          <hr class="card-divider">
          <div class="card-deadline-label" data-completed="true" data-deadline-ms="${dMs || ''}" style="margin-top: 10px; font-size: 0.8rem; color: var(--text-muted);">
            <span class="badge-completed">✓ Completed</span>
          </div>
        `;
      } else {
        const { label, isOverdue } = formatTimeLeft(dMs);
        const overdueClass = isOverdue ? ' overdue' : '';
        return `
          <hr class="card-divider">
          <div class="card-deadline-label${overdueClass}" data-completed="false" data-deadline-ms="${dMs}" data-percent="${percent}" style="margin-top: 10px; font-size: 0.8rem; color: var(--text-muted);">
            <span class="deadline-text-val">⏱ ${label}</span>
          </div>
        `;
      }
    })() : ''}

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

  // Checkbox toggling on the dashboard card itself
  if (barType === "checklist") {
    card.querySelectorAll(".card-checklist-item input[type='checkbox']").forEach((checkbox, idx) => {
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation(); // Stop click from opening update modal / expanding card
      });
      
      checkbox.addEventListener("change", async (e) => {
        const isChecked = e.target.checked;
        const updatedItems = JSON.parse(JSON.stringify(bar.items || []));
        if (updatedItems[idx]) {
          updatedItems[idx].done = isChecked;
        }
        
        const targetSmallest = updatedItems.length;
        const currentSmallest = updatedItems.filter(item => item.done).length;
        const completed = updatedItems.length > 0 && updatedItems.every(item => item.done);
        
        // Optimistically update card item styling
        const checklistItemEl = checkbox.closest(".card-checklist-item");
        if (checklistItemEl) {
          if (isChecked) {
            checklistItemEl.classList.add("done");
          } else {
            checklistItemEl.classList.remove("done");
          }
        }
        
        // Optimistically update progress wrapper HTML (percentage and bar)
        const progressWrapper = card.querySelector(".checklist-progress-wrapper");
        const progressPercent = targetSmallest > 0 ? Math.round((currentSmallest / targetSmallest) * 100) : 0;
        
        if (progressWrapper) {
          const percentEl = progressWrapper.querySelector(".checklist-percent");
          if (percentEl) percentEl.textContent = `${progressPercent}%`;
          
          const fillEl = progressWrapper.querySelector(".progressbar-fill");
          if (fillEl) fillEl.style.width = `${progressPercent}%`;
        }
        
        const summaryEl = card.querySelector(".checklist-summary-line");
        if (summaryEl) {
          summaryEl.innerHTML = `<span>✓</span> ${currentSmallest} / ${targetSmallest} done`;
        }
        
        try {
          await editBar(isGuestMode() ? null : currentUser.uid, bar.id, {
            title: bar.title,
            targetSmallest,
            currentSmallest,
            items: updatedItems,
            completed,
            updateDeadline: false
          });
        } catch (error) {
          showToast("Failed to update checklist progress.", "error");
          renderDashboard(currentBars); // Revert to database state on error
        }
      });
    });
  }

  // Expansion & click interaction
  const isTruncatable = (barType === "checklist" && bar.items && bar.items.length > 3) ||
                        (barType === "note" && bar.text && (bar.text.length > 150 || bar.text.includes("\n")));

  card.addEventListener("click", () => {
    if (!deleteConfirmPanel.classList.contains('hidden')) return;

    if (barType === "checklist") {
      if (isTruncatable && !card.classList.contains("expanded")) {
        card.classList.add("expanded");
        expandedCardIds.add(bar.id);
        card.querySelectorAll(".collapsible-item").forEach(item => {
          item.style.display = "flex";
        });
      }
    } else {
      if (isTruncatable && !card.classList.contains("expanded")) {
        card.classList.add("expanded");
        expandedCardIds.add(bar.id);
        card.querySelectorAll(".collapsible-item").forEach(item => {
          item.style.display = "flex";
        });
      } else {
        openUpdateModal(bar);
      }
    }
  });

  // Wire up collapse button click listener
  const showLessBtn = card.querySelector(".show-less-indicator");
  if (showLessBtn) {
    showLessBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // Stop click from bubbling up to the card
      collapseCard(card);
    });
  }

  if (getDeadlineMs(bar)) {
    attachDeadlineBorder(card, bar);
  }

  return card;
}

function renderDashboard(bars) {
  currentBars = bars;
  const filtered = filterBars([...bars]);
  updateOverallStats(bars);

  // Update search helper text for matches in other categories
  const searchInput = document.getElementById("global-search");
  const query = searchInput ? searchInput.value.toLowerCase().trim() : "";
  const searchHelper = document.getElementById("search-helper");
  if (searchHelper) {
    if (query && currentFilter !== "all") {
      const totalQueryMatches = bars.filter(bar => bar.title.toLowerCase().includes(query)).length;
      const currentCategoryMatches = filtered.length;
      const diff = totalQueryMatches - currentCategoryMatches;
      if (diff > 0) {
        searchHelper.innerHTML = `
          <span>🔍 Found <strong>${diff}</strong> more match${diff === 1 ? '' : 'es'} in other categories.</span>
          <button id="btn-clear-search-filters" class="search-helper-link">Clear filters to view</button>
        `;
        searchHelper.classList.remove("hidden");
        document.getElementById("btn-clear-search-filters")?.addEventListener("click", () => {
          currentFilter = "all";
          renderDashboard(bars);
        });
      } else {
        searchHelper.classList.add("hidden");
        searchHelper.innerHTML = "";
      }
    } else {
      searchHelper.classList.add("hidden");
      searchHelper.innerHTML = "";
    }
  }

  // Ensure Add Card is always present
  let addCard = document.getElementById("btn-add-card");
  if (!addCard) {
    addCard = document.createElement("div");
    addCard.className = "card-add";
    addCard.id = "btn-add-card";
    addCard.innerHTML = `
      <div class="add-icon">+</div>
      <span class="add-text">Add New Tracker</span>
    `;
    addCard.addEventListener("click", () => openCreateModal());
    cardsGrid.insertBefore(addCard, cardsGrid.firstChild);
  }

  // Compile list of expected elements in order
  const expectedElements = [addCard];
  
  // Render / reconcile card elements
  filtered.reverse().forEach((bar) => {
    const oldCard = cardsGrid.querySelector(`[data-bar-id="${bar.id}"]`);
    if (oldCard) {
      const updated = updateCardElement(oldCard, bar);
      if (updated) {
        expectedElements.push(oldCard);
      } else {
        const newCard = createCardElement(bar);
        oldCard.replaceWith(newCard);
        expectedElements.push(newCard);
      }
    } else {
      const newCard = createCardElement(bar);
      expectedElements.push(newCard);
    }
  });

  // Remove any obsolete card DOM elements
  const childrenArray = Array.from(cardsGrid.children);
  childrenArray.forEach((child) => {
    if (!expectedElements.includes(child)) {
      child.remove();
    }
  });

  // Reorder children to match expectedElements list
  expectedElements.forEach((el, index) => {
    if (cardsGrid.children[index] !== el) {
      cardsGrid.insertBefore(el, cardsGrid.children[index] || null);
    }
  });
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

// Background timer to tick deadline SVG paths and labels every second
setInterval(() => {
  document.querySelectorAll('.deadline-bar').forEach(barEl => {
    applyDeadlineTick(barEl);
  });
  document.querySelectorAll('.card-deadline-label').forEach(labelEl => {
    if (labelEl.dataset.completed === "true") {
      labelEl.classList.remove("overdue");
      if (!labelEl.querySelector('.badge-completed')) {
        labelEl.innerHTML = `<span class="badge-completed">✓ Completed</span>`;
      }
      return;
    }
    const deadlineMs = Number(labelEl.dataset.deadlineMs);
    const percent = Number(labelEl.dataset.percent || 0);
    if (deadlineMs) {
      if (percent >= 100) {
        labelEl.classList.remove("overdue");
        if (!labelEl.querySelector('.badge-completed')) {
          labelEl.innerHTML = `<span class="badge-completed">✓ Completed</span>`;
        }
      } else {
        // Remove completed badge if present (e.g. if user edited progress back below 100%)
        const completedBadge = labelEl.querySelector('.badge-completed');
        if (completedBadge) {
          completedBadge.remove();
        }

        let valSpan = labelEl.querySelector('.deadline-text-val');
        if (!valSpan) {
          labelEl.innerHTML = `<span class="deadline-text-val"></span>`;
          valSpan = labelEl.querySelector('.deadline-text-val');
        }

        const result = formatTimeLeft(deadlineMs);
        valSpan.innerHTML = `⏱ ${result.label}`;
        if (result.isOverdue) {
          labelEl.classList.add("overdue");
        } else {
          labelEl.classList.remove("overdue");
        }
      }
    }
  });
  updateOverallStats(currentBars);
}, 1000);

// ==========================================
// Modal Controllers & Form Interactions
// ==========================================

function openModal(modal) {
  modal.classList.add("active");
  // Push a state to browser history stack to intercept back button
  history.pushState({ modalId: modal.id }, "");
}

function closeModal(modal, isPopState = false) {
  if (!modal.classList.contains("active")) return;
  modal.classList.remove("active");
  
  if (!isPopState) {
    closedViaPopState = true;
    history.back();
  }
}

// Intercept system back button / gestures to close active modals or search overlays
window.addEventListener("popstate", (e) => {
  if (closedViaPopState) {
    closedViaPopState = false;
    return;
  }
  if (searchClosedViaPopState) {
    searchClosedViaPopState = false;
    return;
  }

  // Close mobile search overlay if active
  const searchContainer = document.querySelector(".nav-search-container");
  if (searchContainer && searchContainer.classList.contains("expanded")) {
    searchContainer.classList.remove("expanded");
    const searchInput = document.getElementById("global-search");
    const clearBtn = document.getElementById("btn-clear-search");
    if (searchInput) {
      searchInput.value = "";
      if (clearBtn) clearBtn.classList.add("hidden");
    }
    if (typeof adjustSearchLayout === "function") {
      adjustSearchLayout();
    }
    renderDashboard(currentBars);
    return;
  }

  // Close any open modals
  const activeModal = document.querySelector(".modal-overlay.active");
  if (activeModal) {
    closeModal(activeModal, true);
  }
});

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

  // Collapse checklist cards when clicking outside them
  const clickedCard = e.target.closest('.card-progress');
  const clickedBarId = clickedCard ? clickedCard.getAttribute('data-bar-id') : null;

  document.querySelectorAll(".card-progress.expanded").forEach(card => {
    const cardBarId = card.getAttribute('data-bar-id');
    // If the click was inside this card (even if the card was replaced and is now detached),
    // we match by data-bar-id to avoid collapsing it.
    if (cardBarId !== clickedBarId && !card.contains(e.target)) {
      collapseCard(card);
    }
  });
});

// Close expanded checklist cards on scroll
window.addEventListener("scroll", () => {
  document.querySelectorAll(".card-progress.expanded").forEach(card => {
    collapseCard(card);
  });
}, { passive: true });

function collapseCard(card) {
  const barId = card.getAttribute("data-bar-id");
  if (barId) {
    expandedCardIds.delete(barId);
  }
  card.classList.remove("expanded");
  card.querySelectorAll(".collapsible-item").forEach(item => {
    item.style.display = "none";
  });
}

// Close active modals on Escape key press
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.active").forEach((modal) => {
      closeModal(modal);
    });
  }
});

// CREATE MODAL LOGIC:
// CREATE MODAL LOGIC:
let createChecklistItems = [];

function toggleCreateTypeFields(type) {
  const goalFields = document.getElementById("create-goal-fields");
  const checklistFields = document.getElementById("create-checklist-fields");
  const noteFields = document.getElementById("create-note-fields");

  goalFields.classList.add("hidden");
  checklistFields.classList.add("hidden");
  noteFields.classList.add("hidden");

  barPresetSelect.required = false;

  if (type === "goal") {
    goalFields.classList.remove("hidden");
    barPresetSelect.required = true;
  } else if (type === "checklist") {
    checklistFields.classList.remove("hidden");
  } else if (type === "note") {
    noteFields.classList.remove("hidden");
  }
}

// Reusable helper to set up drag-and-drop and touch reordering for checklist items in modals
function setupChecklistReordering(listContainer, itemsArray, renderFn, setArrayCallback) {
  let touchDraggingLi = null;

  listContainer.querySelectorAll(".checklist-builder-item").forEach((li, index) => {
    const dragHandle = li.querySelector(".btn-reorder-item");
    if (!dragHandle) return;

    // --- Desktop HTML5 Drag & Drop ---
    // Enable dragging only when clicking/dragging the drag handle
    dragHandle.addEventListener("mousedown", () => {
      li.setAttribute("draggable", "true");
    });
    dragHandle.addEventListener("mouseup", () => {
      li.removeAttribute("draggable");
    });

    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", index);
      li.classList.add("dragging");
    });

    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      li.removeAttribute("draggable");
    });

    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      const draggingLi = listContainer.querySelector(".dragging");
      if (!draggingLi || draggingLi === li) return;

      const rect = li.getBoundingClientRect();
      const next = (e.clientY - rect.top) / rect.height > 0.5;
      listContainer.insertBefore(draggingLi, next ? li.nextSibling : li);
    });

    li.addEventListener("drop", (e) => {
      e.preventDefault();
      const inputs = Array.from(listContainer.querySelectorAll(".item-text-input"));
      const newItems = inputs.map(input => {
        const origIndex = parseInt(input.getAttribute("data-index"), 10);
        return itemsArray[origIndex];
      });
      setArrayCallback(newItems);
      renderFn();
    });

    // --- Mobile Touch Reordering ---
    dragHandle.addEventListener("touchstart", (e) => {
      touchDraggingLi = li;
      li.classList.add("dragging");
    }, { passive: false });

    dragHandle.addEventListener("touchmove", (e) => {
      if (!touchDraggingLi) return;
      e.preventDefault(); // Stop screen scrolling while dragging

      const touch = e.touches[0];
      const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!targetEl) return;

      const targetLi = targetEl.closest(".checklist-builder-item");
      if (!targetLi || targetLi === touchDraggingLi || targetLi.parentNode !== listContainer) return;

      const rect = targetLi.getBoundingClientRect();
      const next = (touch.clientY - rect.top) / rect.height > 0.5;
      listContainer.insertBefore(touchDraggingLi, next ? targetLi.nextSibling : targetLi);
    }, { passive: false });

    dragHandle.addEventListener("touchend", () => {
      if (!touchDraggingLi) return;
      touchDraggingLi.classList.remove("dragging");
      touchDraggingLi = null;

      const inputs = Array.from(listContainer.querySelectorAll(".item-text-input"));
      const newItems = inputs.map(input => {
        const origIndex = parseInt(input.getAttribute("data-index"), 10);
        return itemsArray[origIndex];
      });
      setArrayCallback(newItems);
      renderFn();
    });
  });
}

function renderCreateChecklist() {
  const listContainer = document.getElementById("create-checklist-items-list");
  listContainer.innerHTML = "";
  createChecklistItems.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "checklist-builder-item";
    li.innerHTML = `
      <input type="text" class="item-text-input" value="${escapeHtml(item.text)}" data-index="${index}">
      <button type="button" class="btn-reorder-item" data-index="${index}" title="Drag to rearrange">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
          <circle cx="9" cy="5" r="1.5" fill="currentColor"></circle>
          <circle cx="9" cy="12" r="1.5" fill="currentColor"></circle>
          <circle cx="9" cy="19" r="1.5" fill="currentColor"></circle>
          <circle cx="15" cy="5" r="1.5" fill="currentColor"></circle>
          <circle cx="15" cy="12" r="1.5" fill="currentColor"></circle>
          <circle cx="15" cy="19" r="1.5" fill="currentColor"></circle>
        </svg>
      </button>
      <button type="button" class="btn-remove-item" data-index="${index}">&times;</button>
    `;
    listContainer.appendChild(li);

    li.querySelector(".item-text-input").addEventListener("input", (e) => {
      createChecklistItems[index].text = e.target.value;
    });

    li.querySelector(".btn-remove-item").addEventListener("click", () => {
      createChecklistItems.splice(index, 1);
      renderCreateChecklist();
    });
  });

  // Attach reordering controls
  setupChecklistReordering(listContainer, createChecklistItems, renderCreateChecklist, (newItems) => {
    createChecklistItems = newItems;
  });
}

// Bind radio button triggers
document.querySelectorAll('input[name="create-tracker-type"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    toggleCreateTypeFields(e.target.value);
  });
});

// Bind Add Checklist Item button triggers
const createChecklistItemInput = document.getElementById("create-checklist-item-input");
const btnCreateAddItem = document.getElementById("btn-create-add-item");

if (btnCreateAddItem && createChecklistItemInput) {
  btnCreateAddItem.addEventListener("click", () => {
    const val = createChecklistItemInput.value.trim();
    if (!val) return;
    createChecklistItems.push({
      id: "item_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
      text: val,
      done: false
    });
    createChecklistItemInput.value = "";
    renderCreateChecklist();
  });

  createChecklistItemInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnCreateAddItem.click();
    }
  });
}

function openCreateModal() {
  formCreate.reset();
  document.getElementById("create-type-goal").checked = true;
  createChecklistItems = [];
  renderCreateChecklist();
  toggleCreateTypeFields("goal");
  barPresetSelect.value = "";
  barPresetSelect.disabled = false;
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

  const wrapper = document.getElementById("create-values-wrapper");
  if (wrapper) {
    if (levels.length === 1) {
      wrapper.classList.add("side-by-side");
    } else {
      wrapper.classList.remove("side-by-side");
    }
  }

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
let updateChecklistItems = [];

function toggleUpdateTypeFields(type) {
  const goalFields = document.getElementById("update-goal-fields");
  const checklistFields = document.getElementById("update-checklist-fields");
  const noteFields = document.getElementById("update-note-fields");

  goalFields.classList.add("hidden");
  checklistFields.classList.add("hidden");
  noteFields.classList.add("hidden");

  if (type === "goal") {
    goalFields.classList.remove("hidden");
  } else if (type === "checklist") {
    checklistFields.classList.remove("hidden");
  } else if (type === "note") {
    noteFields.classList.remove("hidden");
  }
}

function openUpdateModal(bar) {
  selectedBar = bar;

  updateModalTitle.textContent = `Update Progress: ${bar.title}`;
  updateBarIdInput.value = bar.id;
  updateCurrentDynamic.innerHTML = "";

  // Reset delete confirmation safety pane
  deleteSafetyPane.classList.add("hidden");
  updateActionsStandard.classList.remove("hidden");

  const barType = bar.type || "goal";
  toggleUpdateTypeFields(barType);

  if (barType === "goal") {
    const safeLevels = (bar.levels && bar.levels.length) ? bar.levels : [{ name: bar.preset || 'Units', conversionToNext: null }];

    // Decode current value into levels
    const currentLevelVals = decodeFromSmallest(bar.currentSmallest, safeLevels);

    // UI inputs are displayed largest-to-smallest (reversed levels array)
    const reversedLevels = [...safeLevels].reverse();

    const isTimePres = bar.preset === 'Time';
    const stepVal = isTimePres ? '1' : 'any';

    if (safeLevels.length === 1) {
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

  } else if (barType === "checklist") {
    updateChecklistItems = JSON.parse(JSON.stringify(bar.items || []));
    const container = document.getElementById("update-checklist-items-container");
    container.innerHTML = "";
    updateChecklistItems.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = `update-checklist-row${item.done ? " done" : ""}`;
      row.innerHTML = `
        <input type="checkbox" id="up-item-${index}" ${item.done ? "checked" : ""}>
        <label for="up-item-${index}" class="update-checklist-text">${escapeHtml(item.text)}</label>
      `;
      container.appendChild(row);

      row.querySelector("input").addEventListener("change", (e) => {
        updateChecklistItems[index].done = e.target.checked;
        if (e.target.checked) {
          row.classList.add("done");
        } else {
          row.classList.remove("done");
        }
        const checkbox = document.getElementById("update-mark-complete");
        if (checkbox) {
          checkbox.checked = updateChecklistItems.every(item => item.done);
        }
      });
    });
  } else if (barType === "note") {
    document.getElementById("update-note-text").value = bar.text || "";
  }

  // Handle Mark as Completed checkbox
  const checkbox = document.getElementById("update-mark-complete");
  const checkboxLabel = document.getElementById("update-mark-complete-label");
  if (checkbox && checkboxLabel) {
    checkbox.checked = false;
    const newCheckbox = checkbox.cloneNode(true);
    checkbox.parentNode.replaceChild(newCheckbox, checkbox);

    if (barType === "goal") {
      checkboxLabel.textContent = "Mark Goal as Complete";
      const safeLevels = (bar.levels && bar.levels.length) ? bar.levels : [{ name: bar.preset || 'Units', conversionToNext: null }];
      const currentLevelVals = decodeFromSmallest(bar.currentSmallest, safeLevels);

      newCheckbox.addEventListener("change", (e) => {
        const inputs = Array.from(updateCurrentDynamic.querySelectorAll(".update-val-input"));
        if (e.target.checked) {
          const targetVals = decodeFromSmallest(bar.targetSmallest, safeLevels);
          inputs.forEach((input, idx) => {
            input.value = targetVals[idx] ?? 0;
          });
        } else {
          inputs.forEach((input, idx) => {
            input.value = currentLevelVals[idx] ?? 0;
          });
        }
      });

      // Uncheck when manually typing or clicking step buttons
      updateCurrentDynamic.addEventListener("input", () => {
        newCheckbox.checked = false;
      });
      updateCurrentDynamic.addEventListener("click", (e) => {
        if (e.target.classList.contains("stepper-btn")) {
          newCheckbox.checked = false;
        }
      });
    } else if (barType === "checklist") {
      checkboxLabel.textContent = "Mark Checklist as Complete";
      if (updateChecklistItems.length > 0 && updateChecklistItems.every(item => item.done)) {
        newCheckbox.checked = true;
      }

      newCheckbox.addEventListener("change", (e) => {
        const isChecked = e.target.checked;
        const container = document.getElementById("update-checklist-items-container");
        container.querySelectorAll("input[type='checkbox']").forEach((cb, idx) => {
          cb.checked = isChecked;
          updateChecklistItems[idx].done = isChecked;
          const row = cb.closest(".update-checklist-row");
          if (isChecked) {
            row.classList.add("done");
          } else {
            row.classList.remove("done");
          }
        });
      });
    } else if (barType === "note") {
      checkboxLabel.textContent = "Mark Note as Complete";
      if (bar.completed) {
        newCheckbox.checked = true;
      }
    }
  }

  openModal(modalUpdate);
}

let editChecklistItems = [];

function toggleEditTypeFields(type) {
  const goalFields = document.getElementById("edit-goal-fields");
  const checklistFields = document.getElementById("edit-checklist-fields");
  const noteFields = document.getElementById("edit-note-fields");

  goalFields.classList.add("hidden");
  checklistFields.classList.add("hidden");
  noteFields.classList.add("hidden");

  editBarPresetSelect.required = false;

  if (type === "goal") {
    goalFields.classList.remove("hidden");
    editBarPresetSelect.required = true;
  } else if (type === "checklist") {
    checklistFields.classList.remove("hidden");
  } else if (type === "note") {
    noteFields.classList.remove("hidden");
  }
}

function renderEditChecklist() {
  const listContainer = document.getElementById("edit-checklist-items-list");
  listContainer.innerHTML = "";
  editChecklistItems.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "checklist-builder-item";
    li.innerHTML = `
      <input type="text" class="item-text-input" value="${escapeHtml(item.text)}" data-index="${index}">
      <button type="button" class="btn-reorder-item" data-index="${index}" title="Drag to rearrange">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
          <circle cx="9" cy="5" r="1.5" fill="currentColor"></circle>
          <circle cx="9" cy="12" r="1.5" fill="currentColor"></circle>
          <circle cx="9" cy="19" r="1.5" fill="currentColor"></circle>
          <circle cx="15" cy="5" r="1.5" fill="currentColor"></circle>
          <circle cx="15" cy="12" r="1.5" fill="currentColor"></circle>
          <circle cx="15" cy="19" r="1.5" fill="currentColor"></circle>
        </svg>
      </button>
      <button type="button" class="btn-remove-item" data-index="${index}">&times;</button>
    `;
    listContainer.appendChild(li);

    li.querySelector(".item-text-input").addEventListener("input", (e) => {
      editChecklistItems[index].text = e.target.value;
    });

    li.querySelector(".btn-remove-item").addEventListener("click", () => {
      editChecklistItems.splice(index, 1);
      renderEditChecklist();
    });
  });

  // Attach reordering controls
  setupChecklistReordering(listContainer, editChecklistItems, renderEditChecklist, (newItems) => {
    editChecklistItems = newItems;
  });
}

// Bind Add Checklist Item button triggers for Edit modal
const editChecklistItemInput = document.getElementById("edit-checklist-item-input");
const btnEditAddItem = document.getElementById("btn-edit-add-item");

if (btnEditAddItem && editChecklistItemInput) {
  btnEditAddItem.addEventListener("click", () => {
    const val = editChecklistItemInput.value.trim();
    if (!val) return;
    editChecklistItems.push({
      id: "item_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
      text: val,
      done: false
    });
    editChecklistItemInput.value = "";
    renderEditChecklist();
  });

  editChecklistItemInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnEditAddItem.click();
    }
  });
}

function openEditModal(bar) {
  selectedBar = bar;
  formEdit.reset();

  document.getElementById('edit-bar-title').value = bar.title;
  editBarPresetSelect.value = bar.preset || "";

  const barType = bar.type || "goal";
  toggleEditTypeFields(barType);

  if (barType === "goal") {
    // Render the target inputs for the edit modal dynamically
    editTargetDynamic.innerHTML = "";
    const editCurrentDynamic = document.getElementById("edit-current-dynamic");
    if (editCurrentDynamic) editCurrentDynamic.innerHTML = "";

    const safeLevels = (bar.levels && bar.levels.length) ? bar.levels : [{ name: bar.preset || 'Units', conversionToNext: null }];

    const wrapper = document.getElementById("edit-values-wrapper");
    if (wrapper) {
      if (safeLevels.length === 1) {
        wrapper.classList.add("side-by-side");
      } else {
        wrapper.classList.remove("side-by-side");
      }
    }

    const reversedLevels = [...safeLevels].reverse();
    const isTimePres = bar.preset === 'Time';
    const stepVal = isTimePres ? '1' : 'any';

    reversedLevels.forEach((level) => {
      const targetCol = document.createElement("div");
      targetCol.innerHTML = `
        <label class="form-row-label">${escapeHtml(level.name)}</label>
        <input class="form-input target-val-input" type="number" step="${stepVal}" data-level-name="${escapeHtml(level.name)}" min="0" placeholder="0">
      `;
      editTargetDynamic.appendChild(targetCol);

      if (editCurrentDynamic) {
        const currentCol = document.createElement("div");
        currentCol.innerHTML = `
          <label class="form-row-label">${escapeHtml(level.name)}</label>
          <input class="form-input current-val-input" type="number" step="${stepVal}" data-level-name="${escapeHtml(level.name)}" min="0" placeholder="0">
        `;
        editCurrentDynamic.appendChild(currentCol);
      }
    });

    // Pre-fill target values
    const targetVals = decodeFromSmallest(bar.targetSmallest, safeLevels);
    const targetInputs = Array.from(editTargetDynamic.querySelectorAll('.target-val-input'));
    targetInputs.forEach((input, i) => {
      input.value = targetVals[i] ?? 0;
    });

    // Pre-fill current progress values
    if (editCurrentDynamic) {
      const currentVals = decodeFromSmallest(bar.currentSmallest, safeLevels);
      const currentInputs = Array.from(editCurrentDynamic.querySelectorAll('.current-val-input'));
      currentInputs.forEach((input, i) => {
        input.value = currentVals[i] ?? 0;
      });
    }
  } else if (barType === "checklist") {
    editChecklistItems = JSON.parse(JSON.stringify(bar.items || []));
    renderEditChecklist();
  } else if (barType === "note") {
    document.getElementById("edit-note-text").value = bar.text || "";
  }

  // Clear relative inputs and checkbox first
  document.getElementById('edit-deadline-hrs').value = "";
  document.getElementById('edit-deadline-mins').value = "";
  const editDeadlineClear = document.getElementById('edit-deadline-clear');
  if (editDeadlineClear) editDeadlineClear.checked = false;
  document.getElementById('edit-deadline-date').value = "";
  document.getElementById('edit-deadline-time').value = "";

  // Pre-fill deadline if bar has one
  const deadlineMs = getDeadlineMs(bar);
  if (deadlineMs && !isNaN(deadlineMs)) {
    const d = new Date(deadlineMs);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hrsStr = String(d.getHours()).padStart(2, '0');
      const minsStr = String(d.getMinutes()).padStart(2, '0');

      const dateStr = `${yyyy}-${mm}-${dd}`;
      const dateInput = document.getElementById('edit-deadline-date');
      dateInput.value = dateStr;
      document.getElementById('edit-deadline-time').value = `${hrsStr}:${minsStr}`;

      // Set min date to the pre-filled past date to avoid browser validation blocking
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (dateStr < todayStr) {
        dateInput.min = dateStr;
      } else {
        dateInput.min = todayStr;
      }
    }
  }

  // Store initial state to detect user touches later
  window.editModalInitialDeadline = {
    date: document.getElementById('edit-deadline-date').value || "",
    time: document.getElementById('edit-deadline-time').value || "",
    hrs: "",
    mins: "",
    clearChecked: false
  };

  openModal(modalEdit);
}


// ==========================================
// Firestore Form Submissions (Write / Update / Delete)
// ==========================================

// Create Form Submit
formCreate.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser) return;

  const title = document.getElementById("bar-title").value.trim();
  const type = document.querySelector('input[name="create-tracker-type"]:checked').value;

  let preset = null;
  let levels = null;
  let targetSmallest = null;
  let currentSmallest = null;
  let items = null;
  let text = null;

  if (type === "goal") {
    preset = barPresetSelect.value;
    levels = getLevelsFromForm();

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
    const isTimePres = (preset === 'Time');
    const targetValsReversed = targetInputs.map(input => isTimePres ? (parseInt(input.value) || 0) : (parseFloat(input.value) || 0));

    // Compute smallest unit totals
    targetSmallest = encodeToSmallest(targetValsReversed, levels);

    // Simple validation
    if (targetSmallest <= 0) {
      showToast("Target goal must be greater than 0.", "error");
      return;
    }

    const currentInputs = Array.from(createCurrentDynamic.querySelectorAll(".current-val-input"));
    const currentValsReversed = currentInputs.map(input => isTimePres ? (parseInt(input.value) || 0) : (parseFloat(input.value) || 0));
    currentSmallest = encodeToSmallest(currentValsReversed, levels);

    if (currentSmallest < 0) {
      showToast("Current progress must be at least 0.", "error");
      return;
    }

    if (currentSmallest > targetSmallest) {
      showToast("Current progress cannot exceed target goal.", "error");
      return;
    }
  } else if (type === "checklist") {
    if (createChecklistItems.length === 0) {
      showToast("Please add at least one item to the checklist.", "error");
      return;
    }
    const emptyItem = createChecklistItems.find(item => !item.text.trim());
    if (emptyItem) {
      showToast("Checklist item text cannot be empty.", "error");
      return;
    }
    items = createChecklistItems;
    targetSmallest = items.length;
    currentSmallest = items.filter(item => item.done).length;
  } else if (type === "note") {
    text = document.getElementById("create-note-text").value;
    if (!text.trim()) {
      showToast("Note content cannot be empty.", "error");
      return;
    }
  }

  // Handle Deadline calculation in Create mode
  const dateInput = document.getElementById('deadline-date');
  const timeInput = document.getElementById('deadline-time');
  const hrsInput = document.getElementById('deadline-hrs');
  const minsInput = document.getElementById('deadline-mins');

  let deadlineAt = null;

  if (dateInput?.value) {
    const timeVal = timeInput?.value || "23:59";
    const deadlineDate = new Date(`${dateInput.value}T${timeVal}:00`);
    deadlineAt = deadlineDate.getTime();
    if (deadlineAt <= Date.now()) {
      showToast("Deadline must be in the future.", "error");
      return;
    }
  } else if (hrsInput?.value || minsInput?.value) {
    const hrs = parseFloat(hrsInput.value) || 0;
    const mins = parseFloat(minsInput.value) || 0;
    if (hrs > 0 || mins > 0) {
      deadlineAt = Date.now() + (hrs * 3600000) + (mins * 60000);
    } else {
      showToast("Deadline duration must be greater than 0.", "error");
      return;
    }
  }

  if (currentBars.length >= 50) {
    showToast(
      "You've reached the maximum of 50 progress bars. Delete one to create a new one.",
      "error"
    );
    return;
  }

  const completed = type === "goal"
    ? (currentSmallest >= targetSmallest)
    : (type === "checklist"
        ? (items && items.length > 0 && items.every(item => item.done))
        : false);

  try {
    closeModal(modalCreate);
    await createBar(isGuestMode() ? null : currentUser.uid, {
      title,
      type,
      preset,
      levels,
      targetSmallest,
      currentSmallest,
      items,
      text,
      completed,
      deadlineAt
    });
    showToast(`Successfully created tracker "${title}"!`, "success");
  } catch (error) {
    showToast("Failed to create progress bar. Try again later.", "error");
  }
});

// Edit Form Submit
formEdit.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser || !selectedBar) return;

  const title = document.getElementById("edit-bar-title").value.trim();
  const barType = selectedBar.type || "goal";

  let preset = selectedBar.preset;
  let levels = null;
  let targetSmallest = null;
  let currentSmallest = null;
  let items = null;
  let text = null;

  if (barType === "goal") {
    levels = (selectedBar.levels && selectedBar.levels.length) ? selectedBar.levels : [{ name: selectedBar.preset || 'Units', conversionToNext: null }];
    // Fetch form values in largest-to-smallest order
    const targetInputs = Array.from(editTargetDynamic.querySelectorAll(".target-val-input"));
    const isTimePres = (preset === 'Time');
    const targetValsReversed = targetInputs.map(input => isTimePres ? (parseInt(input.value) || 0) : (parseFloat(input.value) || 0));

    // Compute smallest unit totals
    targetSmallest = encodeToSmallest(targetValsReversed, levels);

    // Simple validation
    if (targetSmallest <= 0) {
      showToast("Target goal must be greater than 0.", "error");
      return;
    }

    const editCurrentDynamic = document.getElementById("edit-current-dynamic");
    const currentInputs = editCurrentDynamic ? Array.from(editCurrentDynamic.querySelectorAll(".current-val-input")) : [];
    const currentValsReversed = currentInputs.map(input => isTimePres ? (parseInt(input.value) || 0) : (parseFloat(input.value) || 0));
    currentSmallest = encodeToSmallest(currentValsReversed, levels);

    if (currentSmallest < 0) {
      showToast("Current progress must be at least 0.", "error");
      return;
    }

    if (currentSmallest > targetSmallest) {
      showToast("Current progress cannot exceed target goal.", "error");
      return;
    }
  } else if (barType === "checklist") {
    if (editChecklistItems.length === 0) {
      showToast("Please add at least one item to the checklist.", "error");
      return;
    }
    const emptyItem = editChecklistItems.find(item => !item.text.trim());
    if (emptyItem) {
      showToast("Checklist item text cannot be empty.", "error");
      return;
    }
    items = editChecklistItems;
    targetSmallest = items.length;
    currentSmallest = items.filter(item => item.done).length;
  } else if (barType === "note") {
    text = document.getElementById("edit-note-text").value;
    if (!text.trim()) {
      showToast("Note content cannot be empty.", "error");
      return;
    }
  }

  // Handle Deadline calculation in Edit mode
  const dateInput = document.getElementById('edit-deadline-date');
  const timeInput = document.getElementById('edit-deadline-time');
  const hrsInput = document.getElementById('edit-deadline-hrs');
  const minsInput = document.getElementById('edit-deadline-mins');
  const clearCheckbox = document.getElementById('edit-deadline-clear');

  const initial = window.editModalInitialDeadline || {};
  const isDateChanged = (dateInput?.value || "") !== (initial.date || "");
  const isTimeChanged = (timeInput?.value || "") !== (initial.time || "");
  const isHrsChanged = (hrsInput?.value || "") !== (initial.hrs || "");
  const isMinsChanged = (minsInput?.value || "") !== (initial.mins || "");
  const isClearChanged = (clearCheckbox?.checked || false) !== (initial.clearChecked || false);

  const isDeadlineTouched = isDateChanged || isTimeChanged || isHrsChanged || isMinsChanged || isClearChanged;

  let deadlineAt = selectedBar.deadlineAt ? (typeof selectedBar.deadlineAt.toDate === 'function' ? selectedBar.deadlineAt.toDate().getTime() : Number(selectedBar.deadlineAt)) : null;
  let updateDeadline = false;

  if (isDeadlineTouched) {
    updateDeadline = true;
    if (clearCheckbox?.checked) {
      deadlineAt = null;
    } else if (dateInput?.value) {
      const timeVal = timeInput?.value || "23:59";
      const deadlineDate = new Date(`${dateInput.value}T${timeVal}:00`);
      deadlineAt = deadlineDate.getTime();
      if (deadlineAt <= Date.now()) {
        showToast("Deadline must be in the future.", "error");
        return;
      }
    } else if (hrsInput?.value || minsInput?.value) {
      const hrs = parseFloat(hrsInput.value) || 0;
      const mins = parseFloat(minsInput.value) || 0;
      if (hrs > 0 || mins > 0) {
        deadlineAt = Date.now() + (hrs * 3600000) + (mins * 60000);
      } else {
        showToast("Deadline duration must be greater than 0.", "error");
        return;
      }
    } else {
      // Inputs cleared but clear checkbox not ticked: remove the deadline
      deadlineAt = null;
    }
  }

  try {
    closeModal(modalEdit);
    await editBar(isGuestMode() ? null : currentUser.uid, selectedBar.id, {
      title,
      levels: barType === "goal" ? levels : null,
      targetSmallest,
      currentSmallest,
      items: barType === "checklist" ? items : null,
      text: barType === "note" ? text : null,
      completed: barType === "goal" ? (currentSmallest >= targetSmallest) : (barType === "checklist" ? (items.length > 0 && items.every(i => i.done)) : (barType === "note" ? selectedBar.completed : undefined)),
      deadlineAt,
      updateDeadline
    });
    showToast(`Successfully updated tracker "${title}"!`, "success");
  } catch (error) {
    showToast("Failed to edit progress bar.", "error");
  }
});

// Update Form Submit
formUpdate.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser || !selectedBar) return;

  const barId = updateBarIdInput.value;
  const barType = selectedBar.type || "goal";

  if (barType === "goal") {
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
      const completed = currentSmallest >= selectedBar.targetSmallest;
      await updateBarProgress(isGuestMode() ? null : currentUser.uid, barId, currentSmallest, completed);
      showToast(`Progress for "${selectedBar.title}" updated.`, "success");
    } catch (error) {
      showToast("Failed to update progress.", "error");
    }
  } else if (barType === "checklist") {
    const items = updateChecklistItems;
    const targetSmallest = items.length;
    const currentSmallest = items.filter(item => item.done).length;
    const completed = items.length > 0 && items.every(item => item.done);

    try {
      closeModal(modalUpdate);
      await editBar(isGuestMode() ? null : currentUser.uid, barId, {
        title: selectedBar.title,
        targetSmallest,
        currentSmallest,
        items,
        completed,
        updateDeadline: false
      });
      showToast(`Checklist progress for "${selectedBar.title}" updated.`, "success");
    } catch (error) {
      showToast("Failed to update checklist progress.", "error");
    }
  } else if (barType === "note") {
    const text = document.getElementById("update-note-text").value;
    if (!text.trim()) {
      showToast("Note content cannot be empty.", "error");
      return;
    }
    const completed = document.getElementById("update-mark-complete").checked;

    try {
      closeModal(modalUpdate);
      await editBar(isGuestMode() ? null : currentUser.uid, barId, {
        title: selectedBar.title,
        text,
        completed,
        updateDeadline: false
      });
      showToast(`Note "${selectedBar.title}" updated.`, "success");
    } catch (error) {
      showToast("Failed to update note content.", "error");
    }
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
        type: bar.type || "goal",
        preset: bar.preset,
        levels: bar.levels || (bar.type === "goal" || !bar.type ? [{ name: bar.preset || 'Units', conversionToNext: null }] : null),
        targetSmallest: bar.targetSmallest,
        currentSmallest: bar.currentSmallest,
        items: bar.items || null,
        text: bar.text || null,
        completed: bar.completed || false,
        deadlineAt: bar.deadlineAt,
        deadlineSetAt: bar.deadlineSetAt
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
// Authentication Redirection & Profile Dropdown
// ==========================================

// Stats filter button event listeners
const setupStatsFilterListeners = () => {
  const filterButtons = document.querySelectorAll(".stats-btn");
  filterButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const filter = btn.getAttribute("data-filter");
      if (filter) {
        if (currentFilter === filter) {
          // Double-clicking active filter clears and closes search
          const searchInput = document.getElementById("global-search");
          if (searchInput && searchInput.value) {
            searchInput.value = "";
            const clearBtn = document.getElementById("btn-clear-search");
            if (clearBtn) clearBtn.classList.add("hidden");

            // Collapse search overlay if expanded
            const searchContainer = document.querySelector(".nav-search-container");
            if (searchContainer) {
              if (searchContainer.classList.contains("expanded")) {
                searchContainer.classList.remove("expanded");
                searchClosedViaPopState = true;
                history.back();
              }
              adjustSearchLayout();
            }
          }
        }
        currentFilter = filter;
        renderDashboard(currentBars);
      }
    });
  });
};
setupStatsFilterListeners();

// Helper to measure text width of placeholder dynamically
function getPlaceholderWidth(input) {
  const text = input.placeholder || "Search for title...";
  const canvas = getPlaceholderWidth.canvas || (getPlaceholderWidth.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  const style = window.getComputedStyle(input);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return context.measureText(text).width;
}

// Adjusts the search layout dynamically based on available screen space
function adjustSearchLayout() {
  const searchInput = document.getElementById("global-search");
  const searchContainer = document.querySelector(".nav-search-container");
  const navContainer = document.querySelector(".nav-container");
  const logo = document.querySelector(".nav-logo");
  const toolbar = document.querySelector(".nav-toolbar");

  if (!searchInput || !searchContainer || !navContainer || !logo || !toolbar) return;

  // If mobile overlay is currently expanded, don't collapse it
  if (searchContainer.classList.contains("expanded")) {
    return;
  }

  // If there's an active query, keep pill mode so user can see it
  if (searchInput.value.trim() !== "") {
    searchContainer.classList.add("search-pill-mode");
    return;
  }

  // Calculate available space in nav bar for search pill (excluding search bar itself)
  const navWidth = navContainer.clientWidth;
  const logoWidth = logo.getBoundingClientRect().width;
  const toolbarWidth = toolbar.getBoundingClientRect().width;
  
  // Space available = total navbar width - logo - toolbar - two gaps of 22.65px (45.3px)
  const availableWidth = navWidth - logoWidth - toolbarWidth - 45.3;

  // Minimum required width for pill-mode (placeholder text + paddings/buttons gap)
  // Left padding 16px, search button 32px, gap 8px, right padding 3px = 59px. Let's add 5px safety buffer.
  const placeholderWidth = getPlaceholderWidth(searchInput);
  const minRequiredWidth = placeholderWidth + 64; 

  if (availableWidth >= minRequiredWidth) {
    searchContainer.classList.add("search-pill-mode");
  } else {
    searchContainer.classList.remove("search-pill-mode");
  }
}

// Setup global search input listener
const setupGlobalSearchListener = () => {
  const searchInput = document.getElementById("global-search");
  const searchBtn = document.getElementById("btn-search");
  const searchContainer = document.querySelector(".nav-search-container");
  const clearBtn = document.getElementById("btn-clear-search");

  const toggleClearBtn = () => {
    if (searchInput && searchInput.value) {
      clearBtn?.classList.remove("hidden");
    } else {
      clearBtn?.classList.add("hidden");
    }
  };

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      toggleClearBtn();
      adjustSearchLayout();
      renderDashboard(currentBars);
    });
  }

  if (clearBtn && searchInput) {
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      searchInput.value = "";
      toggleClearBtn();
      adjustSearchLayout();
      renderDashboard(currentBars);

      // If expanded on mobile, collapse search and pop history state
      if (searchContainer && searchContainer.classList.contains("expanded")) {
        searchContainer.classList.remove("expanded");
        searchClosedViaPopState = true;
        history.back();
      }
    });
  }

  if (searchContainer && searchBtn && searchInput) {
    searchBtn.addEventListener("click", (e) => {
      if (!searchContainer.classList.contains("search-pill-mode")) {
        if (!searchContainer.classList.contains("expanded")) {
          e.preventDefault();
          e.stopPropagation();
          searchContainer.classList.add("expanded");
          searchInput.focus();
          // Push state to browser history stack to intercept back button
          history.pushState({ searchExpanded: true }, "");
        }
      } else {
        searchInput.focus();
      }
    });
  }

  window.addEventListener("resize", adjustSearchLayout);

  if (document.fonts) {
    document.fonts.ready.then(adjustSearchLayout);
  }

  // Run initial layout check
  adjustSearchLayout();
};
setupGlobalSearchListener();

// Toggle profile dropdown menu
btnProfileBadge?.addEventListener("click", (e) => {
  e.stopPropagation();
  profileDropdown?.classList.toggle("active");
});

// Close profile dropdown when clicking outside
window.addEventListener("click", (e) => {
  if (profileDropdown && !profileDropdown.contains(e.target) && e.target !== btnProfileBadge) {
    profileDropdown.classList.remove("active");
  }
});

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

btnDeleteAccount.addEventListener("click", async () => {
  const message = "WARNING: Are you absolutely sure you want to permanently delete your account?\n\nThis will destroy all of your progress bars and data from the database forever. This action cannot be undone.";
  if (!window.confirm(message)) {
    return;
  }

  try {
    const isGuest = isGuestMode();
    const uid = isGuest ? null : (currentUser ? currentUser.uid : null);

    // Show loading toast (persist it)
    const toast = showToast("Deleting account data...", "info", 0);

    // 1. Delete all user bars from database (Firestore or LocalStorage)
    await deleteUserData(uid);

    if (isGuest) {
      exitGuestMode();
      if (toast) dismissToast(toast);
      window.location.href = "index.html";
    } else {
      // 2. Delete user account from Firebase Auth
      await deleteCurrentUserAccount();
      
      // 3. Clear session states and logout
      await logout();
      if (toast) dismissToast(toast);
      window.location.href = "index.html";
    }
  } catch (error) {
    console.error("Account deletion failed:", error);
    showToast("Failed to delete account. You may need to sign out and log back in again to perform this sensitive action.", "error");
  }
});

// Initialize auth check
initAuthProtection(async (user) => {
  const localBars = getLocalBars();
  const hasLocalBars = localBars && localBars.length > 0;

  authInitialized = true;

  // Silent auto-migration if guest logs in or has local bars
  if ((isGuestMode() || hasLocalBars) && user && user.uid !== null) {
    // Show migration status
    showToast("Syncing your data to cloud account...", "info");

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
    if (userStatus) userStatus.textContent = "Guest Sandbox Mode";
  } else {
    userAvatar.src = user.photoURL || "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y";
    userName.textContent = user.displayName || "Tracker User";
    if (userStatus) userStatus.textContent = "Signed In (Cloud)";
  }

  // Show application content, hide splash screen
  appContent.classList.remove("hidden");

  // Subscribe to progress bars collection
  let firstLoad = true;
  startSubscription(
    isGuestMode() ? null : user.uid,
    (bars) => {
      renderDashboard(bars);
      if (firstLoad) {
        firstLoad = false;
        if (navLogoSvg) {
          navLogoSvg.classList.remove("logo-loading");
        }
      }
    },
    (error) => {
      if (firstLoad) {
        firstLoad = false;
        if (navLogoSvg) {
          navLogoSvg.classList.remove("logo-loading");
        }
      }
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

// Setup mutual exclusion for deadline inputs (Create and Edit modals)
function setupDeadlineMutualExclusion(prefix = "") {
  const dateInput = document.getElementById(prefix + 'deadline-date');
  const timeInput = document.getElementById(prefix + 'deadline-time');
  const hrsInput = document.getElementById(prefix + 'deadline-hrs');
  const minsInput = document.getElementById(prefix + 'deadline-mins');

  if (!dateInput || !hrsInput) return;

  // Dynamic min date to block past dates
  const updateMinDate = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    if (dateInput.value && dateInput.value < todayStr) {
      dateInput.min = dateInput.value;
    } else {
      dateInput.min = todayStr;
    }
  };
  updateMinDate();

  // Validation for today's date vs time
  const validateTime = () => {
    if (!dateInput.value) return;
    const todayStr = dateInput.min;
    if (dateInput.value === todayStr && timeInput?.value) {
      const now = new Date();
      const currentHrs = now.getHours();
      const currentMins = now.getMinutes();
      const [inputHrs, inputMins] = timeInput.value.split(':').map(Number);
      if (inputHrs < currentHrs || (inputHrs === currentHrs && inputMins <= currentMins)) {
        showToast("Time must be in the future.", "error");
        timeInput.value = '';
      }
    }
  };

  dateInput.addEventListener('change', () => {
    updateMinDate();
    if (dateInput.value) {
      hrsInput.value = '';
      minsInput.value = '';
    }
    validateTime();
  });

  timeInput?.addEventListener('change', validateTime);

  const clearAbsoluteInputs = () => {
    if (hrsInput.value || minsInput.value) {
      dateInput.value = '';
      if (timeInput) timeInput.value = '';
    }
  };

  hrsInput.addEventListener('input', clearAbsoluteInputs);
  minsInput.addEventListener('input', clearAbsoluteInputs);
}

setupDeadlineMutualExclusion(""); // For Create modal
setupDeadlineMutualExclusion("edit-"); // For Edit modal

// ==========================================
// Service Worker Registration & Updates
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('Service Worker registered:', reg.scope);
        
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('New service worker version detected.');
              }
            });
          }
        });
      })
      .catch((err) => console.error('Service Worker registration failed:', err));
  });

  // Automatically refresh the page when the service worker updates and takes control
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      
      let countdown = 8;
      const toast = showToast(`A new version is available! Auto-refreshing in ${countdown}s...`, "info", 0);
      const messageEl = toast.querySelector(".toast-message");
      
      const interval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
          if (messageEl) {
            messageEl.textContent = `A new version is available! Auto-refreshing in ${countdown}s...`;
          }
        } else {
          clearInterval(interval);
          window.location.reload();
        }
      }, 1000);
    }
  });
}
