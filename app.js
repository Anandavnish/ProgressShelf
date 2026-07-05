import { isConfigured } from "./supabase-config.js";
import { logout, initAuthProtection, isGuestMode, exitGuestMode, loginWithGoogle, deleteCurrentUserAccount, updateUserPreferredSort } from "./auth.js";
import { subscribeToBars, createBar, updateBarProgress, deleteBar, getLocalBars, editBar, deleteUserData, saveFCMToken, deleteFCMToken, checkFCMTokenExists, deleteMultipleBars } from "./db.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";

// Initialize Firebase FCM if configured (keeps FCM token system intact)
const firebaseConfig = window.firebaseConfig || {};

let messaging = null;
if (isConfigured) {
  try {
    const firebaseApp = initializeApp(firebaseConfig);
    messaging = getMessaging(firebaseApp);
  } catch (error) {
    console.error("Firebase FCM initialization failed:", error);
  }
}

// Global Date/Time Input Value Setter Override to add .has-value class
const originalValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
Object.defineProperty(HTMLInputElement.prototype, 'value', {
  set: function(val) {
    originalValueSetter.call(this, val);
    if (this.type === 'date' || this.type === 'time') {
      if (val) {
        this.classList.add('has-value');
      } else {
        this.classList.remove('has-value');
      }
    }
  },
  configurable: true
});

function updateDateTimeHasValueClass(input) {
  if (input.value) {
    input.classList.add('has-value');
  } else {
    input.classList.remove('has-value');
  }
}

document.addEventListener('input', (e) => {
  if (e.target && (e.target.type === 'date' || e.target.type === 'time')) {
    updateDateTimeHasValueClass(e.target);
  }
});
document.addEventListener('change', (e) => {
  if (e.target && (e.target.type === 'date' || e.target.type === 'time')) {
    updateDateTimeHasValueClass(e.target);
  }
});

// Ensure single-line textareas behave exactly like text inputs (no linebreaks)
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.classList.contains('form-input-single-line')) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!e.target.classList.contains('add-item-input')) {
        e.target.blur();
      }
    }
  }
});

document.addEventListener('paste', (e) => {
  if (e.target && e.target.classList.contains('form-input-single-line')) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    const cleanText = text.replace(/[\r\n]+/g, ' ');
    const start = e.target.selectionStart;
    const end = e.target.selectionEnd;
    const val = e.target.value;
    e.target.value = val.substring(0, start) + cleanText + val.substring(end);
    e.target.selectionStart = e.target.selectionEnd = start + cleanText.length;
    e.target.dispatchEvent(new Event('input', { bubbles: true }));
  }
});

// Auto-scroll focused modal fields into view when keyboard opens
let activeFocusedModalInput = null;

function scrollFocusedInputIntoView() {
  if (activeFocusedModalInput) {
    activeFocusedModalInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

document.addEventListener('focusin', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
    if (e.target.closest('.modal-body')) {
      activeFocusedModalInput = e.target;
      setTimeout(scrollFocusedInputIntoView, 300);
    }
  }
});

document.addEventListener('focusout', (e) => {
  if (e.target === activeFocusedModalInput) {
    activeFocusedModalInput = null;
  }
});

if (window.visualViewport) {
  let prevViewportHeight = window.visualViewport.height;
  window.visualViewport.addEventListener('resize', () => {
    const currentHeight = window.visualViewport.height;
    // If viewport height decreased significantly, keyboard probably opened
    if (currentHeight < prevViewportHeight - 50) {
      setTimeout(scrollFocusedInputIntoView, 100);
    }
    prevViewportHeight = currentHeight;
  });
}

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
let currentSort = localStorage.getItem("ps_sort_order") || "created-desc";
const expandedCardIds = new Set();
let lastInteractionY = null;
let searchClosedViaPopState = false;
let closedViaPopState = false;
let isSearchActiveHistoryPushed = false;
let deferredPrompt = null;
let isPopStateExit = false;
let lastInteractionCardId = null;

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

// Lightweight Markdown-to-HTML parser
function parseMarkdown(text) {
  if (!text) return "";
  
  const lines = text.split("\n");
  let inList = null; // 'ul', 'ol', 'code', or null
  let htmlLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Code block check
    if (line.trim().startsWith("```")) {
      if (inList === 'code') {
        htmlLines.push("</code></pre>");
        inList = null;
      } else {
        // Close any active lists
        if (inList === 'ul') { htmlLines.push("</ul>"); inList = null; }
        if (inList === 'ol') { htmlLines.push("</ol>"); inList = null; }
        htmlLines.push("<pre class=\"note-code-block\"><code>");
        inList = 'code';
      }
      continue;
    }
    
    if (inList === 'code') {
      htmlLines.push(escapeHtml(line));
      continue;
    }
    
    // Escape standard line
    let parsedLine = escapeHtml(line);
    
    // Formatting: Bold, Italic, Inline Code
    parsedLine = parsedLine.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    parsedLine = parsedLine.replace(/__(.*?)__/g, '<strong>$1</strong>');
    parsedLine = parsedLine.replace(/\*(.*?)\*/g, '<em>$1</em>');
    parsedLine = parsedLine.replace(/_(.*?)_/g, '<em>$1</em>');
    parsedLine = parsedLine.replace(/`(.*?)`/g, '<code class="note-code">$1</code>');
    
    // Headers
    if (parsedLine.startsWith("### ")) {
      if (inList === 'ul') { htmlLines.push("</ul>"); inList = null; }
      if (inList === 'ol') { htmlLines.push("</ol>"); inList = null; }
      htmlLines.push(`<h5 class="note-h3">${parsedLine.substring(4)}</h5>`);
      continue;
    }
    if (parsedLine.startsWith("## ")) {
      if (inList === 'ul') { htmlLines.push("</ul>"); inList = null; }
      if (inList === 'ol') { htmlLines.push("</ol>"); inList = null; }
      htmlLines.push(`<h4 class="note-h2">${parsedLine.substring(3)}</h4>`);
      continue;
    }
    if (parsedLine.startsWith("# ")) {
      if (inList === 'ul') { htmlLines.push("</ul>"); inList = null; }
      if (inList === 'ol') { htmlLines.push("</ol>"); inList = null; }
      htmlLines.push(`<h3 class="note-h1">${parsedLine.substring(2)}</h3>`);
      continue;
    }
    
    // Bullet lists (- or * or +)
    const bulletMatch = line.match(/^(\s*)(?:-|\*|\+|•|●)\s+(.*)$/);
    if (bulletMatch) {
      if (inList === 'ol') { htmlLines.push("</ol>"); inList = null; }
      if (inList !== 'ul') {
        htmlLines.push("<ul class=\"note-ul\">");
        inList = 'ul';
      }
      let content = escapeHtml(bulletMatch[2]);
      content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      content = content.replace(/__(.*?)__/g, '<strong>$1</strong>');
      content = content.replace(/\*(.*?)\*/g, '<em>$1</em>');
      content = content.replace(/_(.*?)_/g, '<em>$1</em>');
      content = content.replace(/`(.*?)`/g, '<code class="note-code">$1</code>');
      htmlLines.push(`<li class="note-li">${content}</li>`);
      continue;
    }
    
    // Numbered lists (1. or 2. etc.)
    const numberMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numberMatch) {
      if (inList === 'ul') { htmlLines.push("</ul>"); inList = null; }
      if (inList !== 'ol') {
        const startVal = parseInt(numberMatch[2]);
        htmlLines.push(`<ol class="note-ol" start="${startVal}">`);
        inList = 'ol';
      }
      let content = escapeHtml(numberMatch[3]);
      content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      content = content.replace(/__(.*?)__/g, '<strong>$1</strong>');
      content = content.replace(/\*(.*?)\*/g, '<em>$1</em>');
      content = content.replace(/_(.*?)_/g, '<em>$1</em>');
      content = content.replace(/`(.*?)`/g, '<code class="note-code">$1</code>');
      htmlLines.push(`<li class="note-li">${content}</li>`);
      continue;
    }
    
    // Empty line check
    if (line.trim() === "") {
      if (inList === 'ul') { htmlLines.push("</ul>"); inList = null; }
      if (inList === 'ol') { htmlLines.push("</ol>"); inList = null; }
      htmlLines.push("<br>");
      continue;
    }
    
    // Normal line
    if ((inList === 'ul' || inList === 'ol') && /^\s+/.test(line)) {
      const lastItemIdx = htmlLines.length - 1;
      if (lastItemIdx >= 0 && htmlLines[lastItemIdx].endsWith("</li>")) {
        const popped = htmlLines[lastItemIdx];
        const stripped = popped.substring(0, popped.length - 5); // remove "</li>"
        const cleanLine = escapeHtml(line.trimStart());
        htmlLines[lastItemIdx] = stripped + "<br>" + cleanLine + "</li>";
      } else {
        htmlLines.push(`<div class="note-p">${parsedLine}</div>`);
      }
    } else {
      if (inList === 'ul') { htmlLines.push("</ul>"); inList = null; }
      if (inList === 'ol') { htmlLines.push("</ol>"); inList = null; }
      htmlLines.push(`<div class="note-p">${parsedLine}</div>`);
    }
  }
  
  // Clean up unclosed tags
  if (inList === 'ul') htmlLines.push("</ul>");
  if (inList === 'ol') htmlLines.push("</ol>");
  if (inList === 'code') htmlLines.push("</code></pre>");
  
  return htmlLines.join("");
}

// Lightweight Markdown-to-HTML parser for editor sync backdrop (retains exact character count and spacing)

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

  const totalSecs = Math.floor(diff / 1000);
  const totalMins = Math.floor(totalSecs / 60);
  const totalHours = Math.floor(totalMins / 60);
  const totalDays = Math.floor(totalHours / 24);

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
  // levels: array ordered smallest→largest (matches Supabase schema)
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

  // Remove skeleton loading states if active
  statTotal.classList.remove("stats-skeleton");
  statDeadlines.classList.remove("stats-skeleton");
  statOverdue.classList.remove("stats-skeleton");
  statCompleted.classList.remove("stats-skeleton");
  statFlexible.classList.remove("stats-skeleton");

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
  card._barData = bar;
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
  const titleTextEl = card.querySelector(".card-title-text");
  if (titleTextEl) {
    titleTextEl.textContent = bar.title;
  } else {
    const titleEl = card.querySelector(".card-title");
    if (titleEl) {
      titleEl.textContent = bar.title;
    }
  }
  const titleEl = card.querySelector(".card-title");
  if (titleEl) {
    titleEl.setAttribute("title", bar.title);
  }

  // Restore/re-sync selected state if present
  if (selectedBarIds.has(bar.id)) {
    card.classList.add("selected");
  } else {
    card.classList.remove("selected");
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
      card.querySelectorAll(".card-checklist-item").forEach((label, idx) => {
        const checkbox = label.querySelector("input[type='checkbox']");

        label.addEventListener("click", (e) => {
          const isExpanded = card.classList.contains("expanded");
          const hasHiddenItems = items.length > 3;
          if (hasHiddenItems && !isExpanded) {
            e.preventDefault();
            card.click();
          }
        });

        if (checkbox) {
          checkbox.addEventListener("click", (e) => {
            const isExpanded = card.classList.contains("expanded");
            const hasHiddenItems = items.length > 3;
            if (isExpanded || !hasHiddenItems) {
              e.stopPropagation();
            }
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
      }
    });
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
    if (textEl) textEl.innerHTML = parseMarkdown(bar.text || "");
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
  card._barData = bar;
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
    // Handle Supabase/JS Timestamp vs client side local date
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

    const showMoreBtnHtml = `
      <div class="show-more-indicator">Show more</div>
      <div class="show-less-indicator">Collapse</div>
    `;

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
    const showMoreBtnHtml = `
      <div class="show-more-indicator">Show more</div>
      <div class="show-less-indicator">Collapse</div>
    `;
    bodyHtml = `
      <div class="card-note-text">${parseMarkdown(text)}</div>
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
    <h3 class="card-title" title="${escapeHtml(bar.title)}">
      <!-- Select Control for Edit Mode -->
      <span class="card-select-control">
        <span class="card-select-circle">
          <svg class="check-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </span>
      </span>
      <span class="card-title-text">${escapeHtml(bar.title)}</span>
    </h3>
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
    const currentBar = card._barData;
    deleteBar(isGuestMode() ? null : currentUser.uid, currentBar.id)
      .then(() => showToast(`Deleted "${currentBar.title}".`, "success"))
      .catch(() => showToast("Failed to delete progress bar.", "error"));
  });

  const editBtn = card.querySelector('.btn-card-edit');
  if (editBtn) {
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(card._barData);
    });
  }

  // Checkbox toggling on the dashboard card itself
  if (barType === "checklist") {
    card.querySelectorAll(".card-checklist-item").forEach((label, idx) => {
      const checkbox = label.querySelector("input[type='checkbox']");

      label.addEventListener("click", (e) => {
        const isExpanded = card.classList.contains("expanded");
        const hasHiddenItems = (card._barData.items || []).length > 3;
        if (hasHiddenItems && !isExpanded) {
          e.preventDefault();
          card.click();
        }
      });

      if (checkbox) {
        checkbox.addEventListener("click", (e) => {
          const isExpanded = card.classList.contains("expanded");
          const hasHiddenItems = (card._barData.items || []).length > 3;
          if (isExpanded || !hasHiddenItems) {
            e.stopPropagation(); // Stop click from opening update modal / expanding card
          }
        });

      checkbox.addEventListener("change", async (e) => {
        const currentBar = card._barData;
        const isChecked = e.target.checked;
        const updatedItems = JSON.parse(JSON.stringify(currentBar.items || []));
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
          await editBar(isGuestMode() ? null : currentUser.uid, currentBar.id, {
            title: currentBar.title,
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
      }
    });
  }

  // Restore selected state if present
  if (selectedBarIds.has(bar.id)) {
    card.classList.add("selected");
  }

  card.addEventListener("click", (e) => {
    // In Edit Mode, clicking the card toggles selection
    const grid = document.getElementById("cards-grid");
    if (grid && grid.classList.contains("edit-mode")) {
      e.stopPropagation();
      e.preventDefault();
      toggleCardSelection(card);
      return;
    }

    if (!deleteConfirmPanel.classList.contains('hidden')) return;
    const currentBar = card._barData;
    const barType = currentBar.type || "goal";

    // Dynamic truncatable check based on latest data and UI visibility
    const showMoreBtn = card.querySelector(".show-more-indicator");
    let isTruncatable = showMoreBtn && showMoreBtn.style.display !== "none";
    if (!showMoreBtn) {
      if (barType === "checklist") {
        isTruncatable = currentBar.items && currentBar.items.length > 3;
      } else if (barType === "note") {
        isTruncatable = currentBar.text && (currentBar.text.length > 150 || currentBar.text.includes("\n"));
      }
    }

    if (barType === "checklist") {
      if (isTruncatable && !card.classList.contains("expanded")) {
        expandCard(card, currentBar);
      }
    } else if (barType === "note") {
      if (isTruncatable && !card.classList.contains("expanded")) {
        expandCard(card, currentBar);
      } else {
        openUpdateModal(currentBar);
      }
    } else if (barType === "goal") {
      openUpdateModal(currentBar);
    }
  });

  // Wire up specific click listener on show more button
  const showMoreBtn = card.querySelector(".show-more-indicator");
  if (showMoreBtn) {
    showMoreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const currentBar = card._barData;
      expandCard(card, currentBar);
    });
  }

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

function sortBars(bars) {
  return [...bars].sort((a, b) => {
    if (currentSort === "created-desc") {
      // Invert comparator order because of .reverse() in the reconciliation loop!
      return (a.createdAt || 0) - (b.createdAt || 0);
    }
    if (currentSort === "updated-desc") {
      // Invert comparator order because of .reverse() in the reconciliation loop!
      return (a.lastUpdated || 0) - (b.lastUpdated || 0);
    }
    if (currentSort === "manual") {
      // Invert comparator order because of .reverse() in the reconciliation loop!
      return (b.position ?? 0) - (a.position ?? 0);
    }
    return 0;
  });
}

function renderDashboard(bars) {
  currentBars = bars;

  // Hide Edit and Sort controls if 1 or fewer cards exist
  const rightGroup = document.querySelector(".controls-right-group");
  if (rightGroup) {
    if (bars && bars.length >= 2) {
      rightGroup.classList.remove("hidden");
    } else {
      rightGroup.classList.add("hidden");
      if (editModeActive) {
        exitEditMode();
      }
    }
  }

  const sortedBars = sortBars(bars);
  const filtered = filterBars([...sortedBars]);
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

  syncRowHeights();
  syncFabVisibility();
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

let modalScrollY = 0;

function openModal(modal) {
  modalScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${modalScrollY}px`;
  document.body.style.width = '100%';
  modal.classList.add("active");
  // Push a state to browser history stack to intercept back button
  history.pushState({ modalId: modal.id }, "");
}

function closeModal(modal, isPopState = false) {
  if (!modal.classList.contains("active")) return;
  modal.classList.remove("active");

  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, modalScrollY);

  if (!isPopState) {
    closedViaPopState = true;
    history.back();
  }
}

// Intercept system back button / gestures to close active modals, menus, or search overlays
window.addEventListener("popstate", (e) => {
  if (closedViaPopState) {
    closedViaPopState = false;
    return;
  }
  if (searchClosedViaPopState) {
    searchClosedViaPopState = false;
    return;
  }
  if (profileClosedViaPopState) {
    profileClosedViaPopState = false;
    return;
  }

  // 1. Close profile dropdown if active
  if (profileDropdown && profileDropdown.classList.contains("active")) {
    profileDropdown.classList.remove("active");
  }

  // 2. Close Terrace page if active
  if (typeof isTerraceOpen !== "undefined" && isTerraceOpen) {
    closeTerracePage(true);
    return;
  }

  // 3. Exit edit/delete mode if active
  if (typeof editModeActive !== "undefined" && editModeActive) {
    isPopStateExit = true;
    exitEditMode();
    isPopStateExit = false;
    return;
  }

  // 4. Close active search gesture if history was pushed
  if (isSearchActiveHistoryPushed) {
    deactivateSearch(true);
    return;
  }

  // 5. Close mobile search overlay if active (fallback)
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
    currentFilter = "all";
    renderDashboard(currentBars);
    isSearchActiveHistoryPushed = false;
    return;
  }

  // 6. Close any open modals
  const activeModal = document.querySelector(".modal-overlay.active");
  if (activeModal) {
    closeModal(activeModal, true);
    return;
  }

  // 7. Blocker: If they popped past the base state (meaning back was pressed on the home trackers screen),
  // block the navigation from going back to the external Google Auth redirect URLs by pushing the base state back.
  if (!e.state || !e.state.base) {
    window.history.pushState({ base: true }, "");
  }
});

// Global modal close triggers
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    closeModal(document.getElementById(e.target.dataset.close));
  });
});

window.addEventListener("click", (e) => {
  const clickedInsideModal = e.target.closest(".modal-overlay");

  if (e.target.classList.contains("modal-overlay")) {
    closeModal(e.target);
  }

  // Collapse checklist cards when clicking outside them
  const clickedCard = e.target.closest('.card-progress');
  const clickedBarId = clickedCard ? clickedCard.getAttribute('data-bar-id') : null;

  if (!clickedInsideModal) {
    document.querySelectorAll(".card-progress.expanded").forEach(card => {
      const cardBarId = card.getAttribute('data-bar-id');
      // If the click was inside this card (even if the card was replaced and is now detached),
      // we match by data-bar-id to avoid collapsing it.
      if (cardBarId !== clickedBarId && !card.contains(e.target)) {
        collapseCard(card);
      }
    });
  }
});

// Track card interaction origin and Y position for collapse/expand decisions
window.addEventListener("mousedown", (e) => {
  const card = e.target.closest('.card-progress');
  lastInteractionCardId = card ? card.getAttribute('data-bar-id') : null;
  lastInteractionY = e.clientY;
}, { passive: true });

window.addEventListener("touchstart", (e) => {
  const card = e.target.closest('.card-progress');
  lastInteractionCardId = card ? card.getAttribute('data-bar-id') : null;
  lastInteractionY = e.touches[0] ? e.touches[0].clientY : null;
}, { passive: true });

window.addEventListener("wheel", (e) => {
  const card = e.target.closest('.card-progress');
  lastInteractionCardId = card ? card.getAttribute('data-bar-id') : null;
}, { passive: true });

// Sync floating action button (FAB) visibility based on "Add New Tracker" card scrolling
function syncFabVisibility() {
  const addCard = document.getElementById("btn-add-card");
  const fab = document.getElementById("btn-fab");
  if (addCard && fab) {
    const rect = addCard.getBoundingClientRect();
    const navbarHeight = document.querySelector(".navbar")?.offsetHeight || 57;
    // Show FAB when the bottom of "Add New Tracker" has scrolled above the navbar
    if (rect.bottom < navbarHeight) {
      fab.classList.add("visible");
    } else {
      fab.classList.remove("visible");
    }
  }
}

// Bind FAB click event
document.getElementById("btn-fab")?.addEventListener("click", () => openCreateModal());

// Close expanded checklist cards on scroll only if scroll originated outside the card
let scrollEndCollapseTimeout = null;
window.addEventListener("scroll", () => {
  // Close profile dropdown on scroll if active
  const profileDropdown = document.getElementById("profile-dropdown");
  if (profileDropdown && profileDropdown.classList.contains("active")) {
    profileDropdown.classList.remove("active");
    if (history.state && history.state.profileDropdown) {
      profileClosedViaPopState = true;
      history.back();
    }
  }

  // Update FAB visibility
  syncFabVisibility();

  // Debounce the collapse-check: only collapse after scroll has settled for 150ms
  if (scrollEndCollapseTimeout) clearTimeout(scrollEndCollapseTimeout);
  scrollEndCollapseTimeout = setTimeout(() => {
    scrollEndCollapseTimeout = null;
    if (document.querySelector(".modal-overlay.active")) return;
    document.querySelectorAll(".card-progress.expanded").forEach(card => {
      const cardBarId = card.getAttribute('data-bar-id');
      if (cardBarId !== lastInteractionCardId) {
        collapseCard(card);
      }
    });
  }, 150);
}, { passive: true });

// Measure the actual bottom edge of the sticky nav bar stack.
// This varies dynamically as the nav bars translate off-screen on scroll.
function getStickyTopOffset() {
  const controls = document.querySelector(".dashboard-controls");
  if (controls) return controls.getBoundingClientRect().bottom;
  const stats = document.getElementById("stats-banner");
  if (stats && !stats.classList.contains("hidden")) return stats.getBoundingClientRect().bottom;
  const navbar = document.querySelector(".navbar");
  if (navbar) return navbar.getBoundingClientRect().bottom;
  return 0;
}

// Expand a card with scroll-into-view: ensures the card's top is always visible
// below the sticky nav bars, scrolling just enough to reveal the bottom without
// pushing the top above the nav bar edge.
function expandCard(card, barData) {
  card.classList.add("expanded");
  expandedCardIds.add(barData.id);
  syncRowHeights();

  // Force reflow so layout is fully settled before measuring
  document.body.offsetHeight;
  const rect = card.getBoundingClientRect();
  const topOffset = getStickyTopOffset();

  if (rect.top < topOffset) {
    // Card's top is behind or above the sticky nav bars — bring it just below them
    window.scrollBy(0, rect.top - topOffset);
  } else if (rect.bottom > window.innerHeight) {
    // Card's bottom extends past viewport — scroll down to reveal more,
    // but never scroll further than would push the top behind the nav bars.
    window.scrollBy(0, Math.min(rect.bottom - window.innerHeight, rect.top - topOffset));
  }
}

// Collapse a card with instant scroll compensation.
// Always disables transition for accurate measurement, compensates scroll position,
// then restores transition after the deferred syncRowHeights pass (360ms).
function collapseCard(card) {
  const barId = card.getAttribute("data-bar-id");
  if (barId) {
    expandedCardIds.delete(barId);
  }

  card.style.transition = 'none';
  const beforeTop = card.getBoundingClientRect().top;
  card.classList.remove("expanded");
  syncRowHeights();
  document.body.offsetHeight;
  const afterTop = card.getBoundingClientRect().top;
  const delta = afterTop - beforeTop;
  if (delta !== 0) {
    window.scrollBy(0, delta);
  }
  // Restore transition after deferred syncRowHeights pass (360ms)
  setTimeout(() => { card.style.transition = ''; }, 400);
}

let syncRowHeightsTimeout = null;

function syncRowHeights() {
  if (syncRowHeightsTimeout) {
    clearTimeout(syncRowHeightsTimeout);
  }

  const runSync = () => {
    const cards = Array.from(document.querySelectorAll(".card-progress"));
    if (cards.length === 0) return;

    // Disable transitions temporarily to get instant layout measurements
    cards.forEach(card => {
      const textEl = card.querySelector(".card-note-text");
      if (textEl) textEl.style.transition = "none";
      const container = card.querySelector(".card-checklist-container");
      if (container) container.style.transition = "none";
    });

    // 1. Reset all card content styles so we can measure their natural layouts
    cards.forEach(card => {
      const bar = card._barData;
      if (!bar) return;
      const barType = bar.type || "goal";

      if (barType === "note") {
        const textEl = card.querySelector(".card-note-text");
        if (textEl) {
          textEl.style.maxHeight = "";
          textEl.style.webkitLineClamp = "";
          textEl.style.lineClamp = "";
          textEl.style.display = "";
        }
      } else if (barType === "checklist") {
        const container = card.querySelector(".card-checklist-container");
        if (container) {
          container.style.maxHeight = "";
        }
        const isExpanded = card.classList.contains("expanded");
        card.querySelectorAll(".card-checklist-item").forEach((item, index) => {
          if (index >= 3) {
            item.style.display = isExpanded ? "flex" : "none";
          } else {
            item.style.display = "flex";
          }
        });
      }

      const showMoreBtn = card.querySelector(".show-more-indicator");
      const showLessBtn = card.querySelector(".show-less-indicator");
      if (showMoreBtn) {
        showMoreBtn.style.display = "none";
        if (barType === "checklist") {
          const totalItems = bar.items ? bar.items.length : 0;
          showMoreBtn.textContent = `Show more (+${totalItems - 3})`;
        } else {
          showMoreBtn.textContent = "Show more";
        }
      }
      if (showLessBtn) {
        showLessBtn.style.display = "none";
      }
    });

    // Force layout reflow
    document.body.offsetHeight;

    // 2. Group cards by offsetTop to identify rows
    const rows = new Map();
    cards.forEach(card => {
      const top = card.offsetTop;
      if (!rows.has(top)) {
        rows.set(top, []);
      }
      rows.get(top).push(card);
    });

    // 3. Process each row to adapt heights and indicators
    rows.forEach((rowCards) => {
      rowCards.forEach(card => {
        const bar = card._barData;
        if (!bar) return;
        const barType = bar.type || "goal";
        const isExpanded = card.classList.contains("expanded");

        const showMoreBtn = card.querySelector(".show-more-indicator");
        const showLessBtn = card.querySelector(".show-less-indicator");

        if (barType === "note") {
          const textEl = card.querySelector(".card-note-text");
          if (!textEl) return;

          const cardHeight = card.offsetHeight;
          let usedHeight = 48; // padding

          const titleEl = card.querySelector(".card-title");
          if (titleEl) usedHeight += titleEl.offsetHeight + 8;

          const divider = card.querySelector(".card-divider");
          if (divider) usedHeight += divider.offsetHeight + 10;

          const labelEl = card.querySelector(".card-deadline-label");
          if (labelEl) usedHeight += labelEl.offsetHeight + 10;

          const maxAvailableHeight = cardHeight - usedHeight - 12;

          // Get actual computed line-height of the note text
          const style = window.getComputedStyle(textEl);
          const fontSize = parseFloat(style.fontSize) || 14.7;
          const lineHeightVal = style.lineHeight;
          let lineHeight = fontSize * 1.38; // default fallback
          if (lineHeightVal && lineHeightVal !== "normal") {
            const parsed = parseFloat(lineHeightVal);
            if (!isNaN(parsed) && parsed > 0) {
              lineHeight = parsed;
            }
          }

          if (textEl.scrollHeight <= 96 || (!isExpanded && textEl.scrollHeight <= maxAvailableHeight + 6)) {
            // Short note: force collapse and clean up state
            card.classList.remove("expanded");
            expandedCardIds.delete(bar.id);

            textEl.style.maxHeight = "none";
            textEl.style.webkitLineClamp = "unset";
            textEl.style.lineClamp = "unset";
            textEl.style.display = "block";
            if (showMoreBtn) showMoreBtn.style.display = "none";
            if (showLessBtn) showLessBtn.style.display = "none";
          } else {
            // Long note:
            if (isExpanded) {
              if (showLessBtn) showLessBtn.style.display = "inline-block";
              if (showMoreBtn) showMoreBtn.style.display = "none";
            } else {
              // Clamp to the exact number of lines that fit within maxAvailableHeight
              const linesCount = Math.max(4, Math.floor(maxAvailableHeight / lineHeight));
              const allowedHeight = linesCount * lineHeight;

              textEl.style.maxHeight = `${allowedHeight}px`;
              textEl.style.webkitLineClamp = linesCount;
              textEl.style.lineClamp = linesCount;
              textEl.style.display = "-webkit-box";

              if (showMoreBtn) showMoreBtn.style.display = "inline-block";
              if (showLessBtn) showLessBtn.style.display = "none";
            }
          }
        } else if (barType === "checklist") {
          const container = card.querySelector(".card-checklist-container");
          if (!container) return;
          const totalItems = bar.items ? bar.items.length : 0;

          if (totalItems <= 3) {
            // Force collapse and clean up state for short checklists
            card.classList.remove("expanded");
            expandedCardIds.delete(bar.id);

            const items = Array.from(card.querySelectorAll(".card-checklist-item"));
            items.forEach(item => {
              item.style.display = "flex";
            });
            container.style.maxHeight = "";
            if (showMoreBtn) showMoreBtn.style.display = "none";
            if (showLessBtn) showLessBtn.style.display = "none";
          } else {
            if (isExpanded) {
              if (showLessBtn) showLessBtn.style.display = "inline-block";
            } else {
              // First, make all items display: flex so we can measure their offsets and heights
              const items = Array.from(card.querySelectorAll(".card-checklist-item"));
              items.forEach(item => {
                item.style.display = "flex";
              });

              const cardHeight = card.offsetHeight;
              let usedHeight = 48; // padding

              const titleEl = card.querySelector(".card-title");
              if (titleEl) usedHeight += titleEl.offsetHeight + 8;

              const progressWrapper = card.querySelector(".checklist-progress-wrapper");
              if (progressWrapper) usedHeight += progressWrapper.offsetHeight + 14;

              const divider = card.querySelector(".card-divider");
              if (divider) usedHeight += divider.offsetHeight + 10;

              const labelEl = card.querySelector(".card-deadline-label");
              if (labelEl) usedHeight += labelEl.offsetHeight + 10;

              const maxAvailableHeight = cardHeight - usedHeight - 12;

              // Measure how many items fit in maxAvailableHeight
              let accumulatedHeight = 0;
              let visibleCount = 0;

              items.forEach((item, index) => {
                const itemHeight = item.offsetHeight;
                const itemSpacing = index === 0 ? itemHeight : itemHeight + 8;

                // We must always show at least 3 items, or as many as fit within maxAvailableHeight (with 6px tolerance)
                if (index < 3 || (accumulatedHeight + itemSpacing <= maxAvailableHeight + 6)) {
                  accumulatedHeight += itemSpacing;
                  visibleCount++;
                }
              });

              // Set final display state based on which items fit
              items.forEach((item, index) => {
                if (index < visibleCount) {
                  item.style.display = "flex";
                } else {
                  item.style.display = "none";
                }
              });

              // Set container height to perfectly match the accumulated height of visible items
              container.style.maxHeight = `${accumulatedHeight}px`;

              const hiddenCount = totalItems - visibleCount;
              if (hiddenCount > 0) {
                if (showMoreBtn) {
                  showMoreBtn.textContent = `Show more (+${hiddenCount})`;
                  showMoreBtn.style.display = "inline-block";
                }
              }
            }
          }
        }
      });
    });

    // Force layout reflow and restore transitions in the next animation frame
    document.body.offsetHeight;
    requestAnimationFrame(() => {
      cards.forEach(card => {
        const textEl = card.querySelector(".card-note-text");
        if (textEl) textEl.style.transition = "";
        const container = card.querySelector(".card-checklist-container");
        if (container) container.style.transition = "";
      });
    });
  };

  runSync();
  syncRowHeightsTimeout = setTimeout(runSync, 360);
}

window.addEventListener("resize", syncRowHeights);

// Close active modals and dropdowns on Escape key press
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.active").forEach((modal) => {
      closeModal(modal);
    });

    const profileDropdown = document.getElementById("profile-dropdown");
    if (profileDropdown && profileDropdown.classList.contains("active")) {
      profileDropdown.classList.remove("active");
      if (history.state && history.state.profileDropdown) {
        profileClosedViaPopState = true;
        history.back();
      }
    }
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
      <textarea class="form-input form-input-single-line item-text-input" rows="1" data-index="${index}">${escapeHtml(item.text)}</textarea>
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
  const dateInput = document.getElementById('deadline-date');
  const timeInput = document.getElementById('deadline-time');
  if (dateInput) dateInput.value = "";
  if (timeInput) timeInput.value = "";
  document.getElementById("create-type-goal").checked = true;
  createChecklistItems = [];
  renderCreateChecklist();
  toggleCreateTypeFields("goal");
  barPresetSelect.value = "";
  barPresetSelect.disabled = false;
  rebuildCreateFormInputs();
  
  const notifyToggle = document.getElementById("notify-toggle");
  const settingsContent = document.getElementById("notify-settings-content");
  const endAlertToggle = document.getElementById("end-alert-toggle-create");

  if (notifyToggle) notifyToggle.checked = false;
  if (settingsContent) settingsContent.classList.add("collapsed");
  if (endAlertToggle) endAlertToggle.checked = false;

  updateNotificationPreview("");

  const createNoteText = document.getElementById("create-note-text");
  if (createNoteText) {
    initializeNoteEditor(createNoteText, "");
    const counter = document.getElementById("create-note-char-count");
    if (counter) counter.textContent = "0 / 1600";
  }

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
        <textarea class="form-input form-input-single-line custom-level-name-input" rows="1" id="custom-l1-name" placeholder="e.g. Books" required></textarea>
      </div>
    `;
  } else if (count === 2) {
    container.innerHTML = `
      <div class="custom-level-row">
        <label class="form-label">Level 1 Unit Name (Largest)</label>
        <textarea class="form-input form-input-single-line custom-level-name-input" rows="1" id="custom-l1-name" placeholder="e.g. Chapters" required></textarea>
      </div>
      <div class="custom-level-row">
        <label class="form-label">Level 2 Unit Name (Smallest)</label>
        <textarea class="form-input form-input-single-line custom-level-name-input" rows="1" id="custom-l2-name" placeholder="e.g. Sections" required></textarea>
      </div>
      <div class="form-group custom-ratio-group hidden" id="ratio-group-l2">
        <label class="form-label" id="label-ratio-l2">How many Sections per Chapter?</label>
        <textarea class="form-input form-input-single-line custom-level-ratio-input" rows="1" inputmode="numeric" id="custom-l2-ratio" required>10</textarea>
      </div>
    `;
  } else if (count === 3) {
    container.innerHTML = `
      <div class="custom-level-row">
        <label class="form-label">Level 1 Unit Name (Largest)</label>
        <textarea class="form-input form-input-single-line custom-level-name-input" rows="1" id="custom-l1-name" placeholder="e.g. Books" required></textarea>
      </div>
      <div class="custom-level-row">
        <label class="form-label">Level 2 Unit Name (Middle)</label>
        <textarea class="form-input form-input-single-line custom-level-name-input" rows="1" id="custom-l2-name" placeholder="e.g. Chapters" required></textarea>
      </div>
      <div class="form-group custom-ratio-group hidden" id="ratio-group-l2">
        <label class="form-label" id="label-ratio-l2">How many Chapters per Book?</label>
        <textarea class="form-input form-input-single-line custom-level-ratio-input" rows="1" inputmode="numeric" id="custom-l2-ratio" required>10</textarea>
      </div>
      <div class="custom-level-row">
        <label class="form-label">Level 3 Unit Name (Smallest)</label>
        <textarea class="form-input form-input-single-line custom-level-name-input" rows="1" id="custom-l3-name" placeholder="e.g. Pages" required></textarea>
      </div>
      <div class="form-group custom-ratio-group hidden" id="ratio-group-l3">
        <label class="form-label" id="label-ratio-l3">How many Pages per Chapter?</label>
        <textarea class="form-input form-input-single-line custom-level-ratio-input" rows="1" inputmode="numeric" id="custom-l3-ratio" required>10</textarea>
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
      <textarea class="form-input form-input-single-line target-val-input" rows="1" inputmode="decimal" data-level-name="${escapeHtml(level.name)}" placeholder="0"></textarea>
    `;
    createTargetDynamic.appendChild(targetCol);

    const currentCol = document.createElement("div");
    currentCol.innerHTML = `
      <label class="form-row-label">${escapeHtml(level.name)}</label>
      <textarea class="form-input form-input-single-line current-val-input" rows="1" inputmode="decimal" data-level-name="${escapeHtml(level.name)}" placeholder="0"></textarea>
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
    const textVal = bar.text || "";
    const updateTextEl = document.getElementById("update-note-text");
    if (updateTextEl) {
      initializeNoteEditor(updateTextEl, textVal);
      const counter = document.getElementById("update-note-char-count");
      if (counter) counter.textContent = `${textVal.length} / 1600`;
    }
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
      <textarea class="form-input form-input-single-line item-text-input" rows="1" data-index="${index}">${escapeHtml(item.text)}</textarea>
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
        <textarea class="form-input form-input-single-line target-val-input" rows="1" inputmode="decimal" data-level-name="${escapeHtml(level.name)}" placeholder="0"></textarea>
      `;
      editTargetDynamic.appendChild(targetCol);

      if (editCurrentDynamic) {
        const currentCol = document.createElement("div");
        currentCol.innerHTML = `
          <label class="form-row-label">${escapeHtml(level.name)}</label>
          <textarea class="form-input form-input-single-line current-val-input" rows="1" inputmode="decimal" data-level-name="${escapeHtml(level.name)}" placeholder="0"></textarea>
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
    const textVal = bar.text || "";
    const editTextEl = document.getElementById("edit-note-text");
    if (editTextEl) {
      initializeNoteEditor(editTextEl, textVal);
      const counter = document.getElementById("edit-note-char-count");
      if (counter) counter.textContent = `${textVal.length} / 1600`;
    }
  }

  // Clear relative inputs and checkbox first
  document.getElementById('edit-deadline-hrs').value = "";
  document.getElementById('edit-deadline-mins').value = "";
  const editDeadlineClear = document.getElementById('edit-deadline-clear');
  if (editDeadlineClear) editDeadlineClear.checked = false;
  const editDateInput = document.getElementById('edit-deadline-date');
  const editTimeInput = document.getElementById('edit-deadline-time');
  if (editDateInput) {
    editDateInput.value = "";
  }
  if (editTimeInput) {
    editTimeInput.value = "";
  }

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
      const timeInput = document.getElementById('edit-deadline-time');
      if (dateInput) {
        dateInput.value = dateStr;
      }
      if (timeInput) {
        timeInput.value = `${hrsStr}:${minsStr}`;
      }

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

  // Pre-fill notification settings if bar has one
  const editNotifyHrs = document.getElementById('edit-notify-hrs');
  const editNotifyMins = document.getElementById('edit-notify-mins');
  const editNotifyPercent = document.getElementById('edit-notify-percent');
  const editNotifyToggle = document.getElementById('edit-notify-toggle');
  const editSettingsContent = document.getElementById('edit-notify-settings-content');
  const editEndAlertToggle = document.getElementById('edit-notify-toggle-deadline');

  if (editNotifyHrs) editNotifyHrs.value = "";
  if (editNotifyMins) editNotifyMins.value = "";
  if (editNotifyPercent) editNotifyPercent.value = "";
  if (editEndAlertToggle) editEndAlertToggle.checked = bar.alertAtDeadline || false;

  if (bar.notifyAt && deadlineMs) {
    if (editNotifyToggle) editNotifyToggle.checked = true;
    if (editSettingsContent) editSettingsContent.classList.remove("collapsed");

    const notifyAt = Number(bar.notifyAt);
    if (bar.notifyPercent !== undefined && bar.notifyPercent !== null) {
      if (editNotifyPercent) editNotifyPercent.value = bar.notifyPercent;
    } else {
      const diffMs = deadlineMs - notifyAt;
      if (diffMs > 0) {
        const diffMins = Math.round(diffMs / 60000);
        const hrs = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        if (editNotifyHrs) editNotifyHrs.value = hrs;
        if (editNotifyMins) editNotifyMins.value = mins;
      }
    }
  } else {
    if (editNotifyToggle) editNotifyToggle.checked = false;
    if (editSettingsContent) editSettingsContent.classList.add("collapsed");
  }

  // Force layout update for Edit modal notifications
  updateNotificationPreview("edit-");

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
// Supabase Form Submissions (Write / Update / Delete)
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
    text = serializeNoteEditor("create-note-text");
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

  // Handle notification calculation
  let notifyAt = null;
  let notified = false;
  let notifyPercent = null;
  let alertAtDeadline = false;
  
  const notifyToggle = document.getElementById("notify-toggle");
  if (deadlineAt && !completed && notifyToggle && notifyToggle.checked) {
    const notifyRes = calculateNotifyAt("");
    if (notifyRes.isValid && notifyRes.notifyAt) {
      notifyAt = notifyRes.notifyAt;
      const percentInput = document.getElementById('notify-percent');
      const notifyMode = (percentInput && percentInput.value !== "") ? "percent" : "fixed";
      if (notifyMode === "percent") {
        notifyPercent = percentInput ? parseFloat(percentInput.value) : null;
      }
    }
    alertAtDeadline = document.getElementById("end-alert-toggle-create")?.checked || false;
  }

  try {
    closeModal(modalCreate);
    const targetUid = isGuestMode() ? null : (currentUser ? currentUser.uid : null);
    if ((notifyAt || alertAtDeadline) && targetUid) {
      if (Notification.permission === "denied") {
        showToast("Notifications blocked. Enable them in browser settings to receive alerts.", "warning");
      } else {
        handleFCMSession(targetUid);
      }
    }
    await createBar(targetUid, {
      title,
      type,
      preset,
      levels,
      targetSmallest,
      currentSmallest,
      items,
      text,
      completed,
      deadlineAt,
      notifyAt,
      notified,
      notifyPercent,
      alertAtDeadline,
      deadlineNotified: false
    });
    showToast(`Successfully created tracker "${title}"!`, "success");
  } catch (error) {
    console.error("Error creating progress bar:", error);
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
    text = serializeNoteEditor("edit-note-text");
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

  const completed = barType === "goal"
    ? (currentSmallest >= targetSmallest)
    : (barType === "checklist"
      ? (items && items.length > 0 && items.every(item => item.done))
      : (barType === "note" ? selectedBar.completed : false));

  let notifyAt = selectedBar.notifyAt || null;
  let notified = selectedBar.notified || false;
  let notifyPercent = selectedBar.notifyPercent || null;
  let alertAtDeadline = selectedBar.alertAtDeadline || false;
  let deadlineNotified = selectedBar.deadlineNotified || false;

  const editNotifyToggle = document.getElementById("edit-notify-toggle");
  if (completed) {
    notifyAt = null;
    notified = false;
    notifyPercent = null;
    alertAtDeadline = false;
    deadlineNotified = false;
  } else if (editNotifyToggle && editNotifyToggle.checked) {
    const notifyRes = calculateNotifyAt("edit-");
    if (notifyRes.isValid && notifyRes.notifyAt) {
      notifyAt = notifyRes.notifyAt;
      notified = false;
      const percentInput = document.getElementById('edit-notify-percent');
      const notifyMode = (percentInput && percentInput.value !== "") ? "percent" : "fixed";
      if (notifyMode === "percent") {
        notifyPercent = percentInput ? parseFloat(percentInput.value) : null;
      } else {
        notifyPercent = null;
      }
    } else {
      notifyAt = null;
      notified = false;
      notifyPercent = null;
    }
    
    alertAtDeadline = document.getElementById("edit-notify-toggle-deadline")?.checked || false;
    if (deadlineAt !== selectedBar.deadlineAt) {
      deadlineNotified = false; // Reset if deadline changed
    }
  } else {
    notifyAt = null;
    notified = false;
    notifyPercent = null;
    alertAtDeadline = false;
    deadlineNotified = false;
  }

  try {
    closeModal(modalEdit);
    const targetUid = isGuestMode() ? null : (currentUser ? currentUser.uid : null);
    const notifyChanged = notifyAt !== selectedBar.notifyAt || alertAtDeadline !== selectedBar.alertAtDeadline;
    const notifyEnabled = notifyAt || alertAtDeadline;
    if (notifyChanged && notifyEnabled && targetUid) {
      if (Notification.permission === "denied") {
        showToast("Notifications blocked. Enable them in browser settings to receive alerts.", "warning");
      } else {
        handleFCMSession(targetUid);
      }
    }
    await editBar(targetUid, selectedBar.id, {
      title,
      levels: barType === "goal" ? levels : null,
      targetSmallest,
      currentSmallest,
      items: barType === "checklist" ? items : null,
      text: barType === "note" ? text : null,
      completed,
      deadlineAt,
      updateDeadline,
      notifyAt,
      notified,
      notifyPercent,
      alertAtDeadline,
      deadlineNotified
    });
    showToast(`Successfully updated tracker "${title}"!`, "success");
  } catch (error) {
    console.error("Error editing progress bar:", error);
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
      console.error("Error updating progress:", error);
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
      console.error("Error updating checklist progress:", error);
      showToast("Failed to update checklist progress.", "error");
    }
  } else if (barType === "note") {
    const text = serializeNoteEditor("update-note-text");
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
      console.error("Error updating note content:", error);
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
let migrationInProgress = false;

async function migrateGuestBarsToSupabase(uid) {
  if (migrationInProgress) return;
  migrationInProgress = true;

  const localBars = getLocalBars();
  if (!localBars || localBars.length === 0) {
    exitGuestMode();
    migrationInProgress = false;
    return;
  }

  // Clear local bars immediately to prevent concurrent calls from re-triggering migration
  localStorage.removeItem('progress_shelf_bars');
  exitGuestMode();

  let failCount = 0;
  const failedBars = [];

  for (const bar of localBars) {
    try {
      const mapped = {
        title: bar.title,
        type: bar.type,
        preset: bar.preset,
        levels: bar.levels,
        targetSmallest: bar.targetSmallest,
        currentSmallest: bar.currentSmallest,
        items: bar.items,
        text: bar.text,
        completed: bar.completed,
        deadlineAt: bar.deadlineAt,
        deadlineSetAt: bar.deadlineSetAt,
        notifyAt: bar.notifyAt,
        notified: bar.notified ?? false,
        lastUpdated: bar.lastUpdated
      };
      await createBar(uid, mapped);
    } catch (e) {
      console.error('Migration failed for bar:', bar.title, e);
      failCount++;
      failedBars.push(bar);
    }
  }

  if (failCount > 0) {
    // Restore failed bars to localStorage
    localStorage.setItem('progress_shelf_bars', JSON.stringify(failedBars));
    sessionStorage.setItem('guest_mode', 'true');
    showToast(
      `${failCount} bar(s) failed to sync. Your local data is preserved. Try signing in again.`,
      "error"
    );
  }

  migrationInProgress = false;
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
          if (isSearchActiveHistoryPushed) {
            deactivateSearch(false);
          } else {
            const searchInput = document.getElementById("global-search");
            if (searchInput && searchInput.value) {
              searchInput.value = "";
              const clearBtn = document.getElementById("btn-clear-search");
              if (clearBtn) clearBtn.classList.add("hidden");
            }
            const searchContainer = document.querySelector(".nav-search-container");
            if (searchContainer) {
              searchContainer.classList.remove("expanded");
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

// Sort select event listener
const setupSortSelectListener = () => {
  const sortSelect = document.getElementById("sort-select");
  if (sortSelect) {
    sortSelect.value = currentSort;
    sortSelect.addEventListener("change", async (e) => {
      currentSort = e.target.value;
      localStorage.setItem("ps_sort_order", currentSort);

      renderDashboard(currentBars);

      if (!isGuestMode() && currentUser && currentUser.uid) {
        try {
          await updateUserPreferredSort(currentSort);
        } catch (err) {
          console.error("Error saving sort preference to Supabase:", err);
        }
      }
    });
  }
};
setupSortSelectListener();

// Helper to measure text width of placeholder dynamically
function getPlaceholderWidth(input) {
  const text = input.placeholder || "Search for title...";
  const canvas = getPlaceholderWidth.canvas || (getPlaceholderWidth.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  const style = window.getComputedStyle(input);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return context.measureText(text).width;
}

// Measure search container width representing 4 characters + "..."
function getThresholdSearchWidth(input) {
  const text = "Sear...";
  const canvas = getThresholdSearchWidth.canvas || (getThresholdSearchWidth.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  const style = window.getComputedStyle(input);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  // Add input paddings and search button width (left padding 16px, search button 32px, clear button gap, etc. = ~75px)
  return context.measureText(text).width + 75;
}

let cachedToolbarWidth = null;

// Adjusts the search layout dynamically based on available screen space and placeholder visibility
function adjustSearchLayout() {
  const searchInput = document.getElementById("global-search");
  const searchContainer = document.querySelector(".nav-search-container");
  const navContainer = document.querySelector(".nav-container");
  const logo = document.querySelector(".nav-logo");
  const toolbar = document.querySelector(".nav-toolbar");
  const profileBadge = document.querySelector(".profile-menu-container");
  const subbarEl = document.querySelector(".mobile-subbar");
  const subbarContainer = document.querySelector(".mobile-subbar-container");

  if (!searchInput || !searchContainer || !navContainer || !logo || !toolbar || !subbarEl || !subbarContainer) return;

  // Always keep search container in pill mode (always expanded)
  searchContainer.classList.add("search-pill-mode");
  searchContainer.classList.remove("expanded");

  // Dynamically gather all transferable elements from both potential containers
  const transferItems = [];
  // Gather from toolbar
  Array.from(toolbar.children).forEach(child => {
    if (!child.classList.contains("profile-menu-container") && !transferItems.includes(child)) {
      transferItems.push(child);
    }
  });
  // Gather from subbarContainer
  Array.from(subbarContainer.children).forEach(child => {
    if (!transferItems.includes(child)) {
      transferItems.push(child);
    }
  });

  const isCurrentlyInMobileDOM = transferItems.length > 0 && transferItems[0].parentElement === subbarContainer;

  // Cache toolbar width when in desktop mode so we don't do layout thrashing on resize
  if (!isCurrentlyInMobileDOM && toolbar.clientWidth > 0) {
    cachedToolbarWidth = toolbar.getBoundingClientRect().width;
  }

  // Fallback if not cached yet: calculate based on active transfer items (approx 40px per item)
  const toolbarWidth = cachedToolbarWidth || (transferItems.length * 40);

  // Calculate dynamic spacing
  const navWidth = navContainer.clientWidth;
  const logoWidth = logo.getBoundingClientRect().width || 170;
  const profileWidth = profileBadge ? profileBadge.getBoundingClientRect().width : 32;
  const searchMinWidth = 160;

  // Total required width: Logo + Min Search Pill Width + Profile Badge + Toolbar width + 50px buffer
  const totalRequiredWidth = logoWidth + searchMinWidth + profileWidth + toolbarWidth + 50;
  const shouldMoveToSubbar = navWidth < totalRequiredWidth;

  if (shouldMoveToSubbar) {
    if (!isCurrentlyInMobileDOM) {
      // Mobile layout: move elements to mobile subbar
      transferItems.forEach(item => {
        if (item.parentElement !== subbarContainer) {
          subbarContainer.appendChild(item);
        }
      });
      subbarEl.style.display = "flex"; // Show subbar
      window.updateStickyOffsets?.();
    }
  } else {
    if (isCurrentlyInMobileDOM) {
      // Desktop layout: move elements back to navbar (before profile badge)
      transferItems.forEach(item => {
        if (item.parentElement !== toolbar) {
          if (profileBadge) {
            toolbar.insertBefore(item, profileBadge);
          } else {
            toolbar.appendChild(item);
          }
        }
      });
      subbarEl.style.display = "none"; // Hide subbar
      window.updateStickyOffsets?.();
    }
  }
}

function activateSearch() {
  if (!isSearchActiveHistoryPushed) {
    isSearchActiveHistoryPushed = true;
    history.pushState({ searchActive: true }, "");
  }
}

function deactivateSearch(isPopState = false) {
  const searchInput = document.getElementById("global-search");
  const searchContainer = document.querySelector(".nav-search-container");
  const clearBtn = document.getElementById("btn-clear-search");

  if (searchInput) {
    searchInput.value = "";
    searchInput.blur();
  }
  if (clearBtn) {
    clearBtn.classList.add("hidden");
  }
  if (searchContainer) {
    searchContainer.classList.remove("expanded");
  }

  currentFilter = "all"; // Reset category to All to return to full trackers home dashboard

  if (typeof adjustSearchLayout === "function") {
    adjustSearchLayout();
  }
  renderDashboard(currentBars);

  if (isSearchActiveHistoryPushed) {
    isSearchActiveHistoryPushed = false;
    if (!isPopState) {
      searchClosedViaPopState = true;
      history.back();
    }
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
      activateSearch(); // Push history state when user starts typing
      toggleClearBtn();
      adjustSearchLayout();
      renderDashboard(currentBars);
    });
    searchInput.addEventListener("focus", () => {
      activateSearch();
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        searchInput.blur(); // Collapse virtual keyboard on mobile / enter on desktop
      }
    });
  }

  if (clearBtn && searchInput) {
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deactivateSearch(false);
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
          activateSearch(); // Push history state when overlay expands
        } else {
          searchInput.blur(); // Blur if already expanded to dismiss keyboard
        }
      } else {
        if (document.activeElement === searchInput) {
          searchInput.blur(); // Blur if already focused in desktop pill mode to dismiss focus
        } else {
          searchInput.focus();
          activateSearch(); // Push history state when pill mode is focused
        }
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
let profileClosedViaPopState = false;

btnProfileBadge?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (profileDropdown) {
    const wasActive = profileDropdown.classList.contains("active");
    if (!wasActive) {
      // Position dropdown dynamically relative to the badge to avoid nested backdrop-filter bug
      const rect = btnProfileBadge.getBoundingClientRect();
      profileDropdown.style.top = `${rect.bottom + window.scrollY + 12}px`;
      profileDropdown.style.left = `${rect.right + window.scrollX - 220}px`;

      profileDropdown.classList.add("active");
      history.pushState({ profileDropdown: true }, "");
    } else {
      profileDropdown.classList.remove("active");
      if (history.state && history.state.profileDropdown) {
        profileClosedViaPopState = true;
        history.back();
      }
    }
  }
});

// Close profile dropdown and collapse cards when clicking outside (using capture phase to block click side effects)
window.addEventListener("click", (e) => {
  const profileDropdown = document.getElementById("profile-dropdown");
  const isProfileActive = profileDropdown && profileDropdown.classList.contains("active");
  const hasExpandedCard = expandedCardIds.size > 0;

  if (isProfileActive || hasExpandedCard) {
    const btnProfileBadge = document.getElementById("btn-profile-badge");
    const clickedInsideProfile = (profileDropdown && profileDropdown.contains(e.target)) || 
                                 (btnProfileBadge && btnProfileBadge.contains(e.target));
                                 
    const clickedInsideExpandedCard = e.target.closest(".card-progress.expanded");

    if (isProfileActive && !clickedInsideProfile) {
      e.stopPropagation();
      e.preventDefault();
      profileDropdown.classList.remove("active");
      if (history.state && history.state.profileDropdown) {
        profileClosedViaPopState = true;
        history.back();
      }
    }

    if (hasExpandedCard && !clickedInsideExpandedCard) {
      // Do not collapse expanded cards if the click is on or inside an active modal overlay (e.g. update modal)
      if (e.target.closest(".modal-overlay")) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      document.querySelectorAll(".card-progress.expanded").forEach(collapseCard);
    }
  }
}, true); // useCapture = true is crucial!

btnLogout.addEventListener("click", async () => {
  try {
    if (isGuestMode()) {
      exitGuestMode();
      window.location.href = "index.html";
    } else {
      const token = localStorage.getItem("ps_fcm_token");
      if (token && currentUser) {
        await deleteFCMToken(currentUser.uid, token);
      }
      localStorage.removeItem("ps_fcm_token");
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

    // 1. Delete all user bars from database (Supabase or LocalStorage)
    await deleteUserData(uid);

    if (isGuest) {
      exitGuestMode();
      if (toast) dismissToast(toast);
      window.location.href = "index.html";
    } else {
      // 2. Delete user account from Supabase Auth
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

function showNotificationBanner(uid) {
  if (document.getElementById("notification-banner")) return;
  const banner = document.createElement("div");
  banner.id = "notification-banner";
  banner.className = "guest-banner notification-banner";
  banner.innerHTML = `
    <span>Enable notifications to get deadline alerts</span>
    <button id="btn-allow-notifications" class="btn-banner-login">Allow</button>
  `;
  
  const dashboardMain = document.querySelector(".dashboard-main");
  const cardsGrid = document.getElementById("cards-grid");
  if (dashboardMain && cardsGrid) {
    dashboardMain.insertBefore(banner, cardsGrid);
  }
  
  document.getElementById("btn-allow-notifications")?.addEventListener("click", async () => {
    banner.remove();
    await handleFCMSession(uid);
  });
}

// Initialize auth check
initAuthProtection(async (user) => {
  const localBars = getLocalBars();
  const hasLocalBars = localBars && localBars.length > 0;

  authInitialized = true;

  // Silent auto-migration if guest logs in or has local bars
  if ((isGuestMode() || hasLocalBars) && user && user.uid !== null) {
    // Show migration status
    showToast("Syncing your data to cloud account...", "info");

    await migrateGuestBarsToSupabase(user.uid);
    // exitGuestMode() already called inside migrateGuestBarsToSupabase

    // Instead of returning and getting stuck, let it fall through to 
    // the normal dashboard initialization below, which will setup UI
    // for the logged-in user and start the proper Supabase subscription.
  }

  currentUser = user;

  // Token Validity Check on App Load (Rule 7 & Rule 3)
  if (user && user.uid && !isGuestMode()) {
    const localToken = localStorage.getItem("ps_fcm_token");
    if (localToken) {
      checkFCMTokenExists(user.uid, localToken).then(async (exists) => {
        if (!exists) {
          console.log("Local FCM token is missing from the database. Re-registering...");
          if (Notification.permission === "granted") {
            await handleFCMSession(user.uid);
          }
        }
      }).catch(err => console.error("Error verifying FCM token on load:", err));
    } else {
      if (Notification.permission === "granted") {
        console.log("No FCM token found locally, but permission is granted. Registering fresh token...");
        handleFCMSession(user.uid);
      }
    }

    // Periodically re-sync FCM token every 3 minutes while app is active
    setInterval(async () => {
      if (currentUser && currentUser.uid && !isGuestMode() && Notification.permission === 'granted') {
        await handleFCMSession(currentUser.uid);
      }
    }, 3 * 60 * 1000);
  }

  // Token re-sync on app foreground
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && currentUser && currentUser.uid && !isGuestMode()) {
      if (Notification.permission === 'granted') {
        await handleFCMSession(currentUser.uid);
      }
    }
  });

  // Load preferred sort setting from user metadata or local storage
  if (user && user.preferredSort) {
    currentSort = user.preferredSort;
  } else {
    currentSort = localStorage.getItem("ps_sort_order") || "created-desc";
  }

  // Update sort dropdown value in UI to match currentSort
  const sortSelect = document.getElementById("sort-select");
  if (sortSelect) {
    sortSelect.value = currentSort;
  }

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
      banner.innerHTML = `<span>ℹ️ <strong>Sandbox Mode:</strong> Running locally. Update <code>supabase-config.js</code> with your project credentials to connect Supabase.</span>`;
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

  // Push base state on load to intercept back button from navigating back to external OAuth page
  if (window.history && window.history.pushState) {
    window.history.pushState({ base: true }, "");
  }

  setupDownloadApk();

  // Subscribe to progress bars collection
  let firstLoad = true;
  startSubscription(
    isGuestMode() ? null : user.uid,
    (bars) => {
      renderDashboard(bars);
      
      // Dynamic Notification Permission Banner check (Rule 3)
      if (user && user.uid && Notification.permission === "default") {
        const hasNotifyAt = (bars || []).some(bar => bar.notifyAt);
        if (hasNotifyAt) {
          showNotificationBanner(user.uid);
        } else {
          document.getElementById("notification-banner")?.remove();
        }
      } else {
        document.getElementById("notification-banner")?.remove();
      }

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
            <p class="empty-desc">Could not connect to Supabase database. Please check your internet connection.</p>
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
// FCM Push Notification Settings & Calculation
// ==========================================

const FCM_VAPID_KEY = "BBMQHPcnjNhugmwdap8XCS8fKkWcS6MhYFCDfEsibb_tLTWFhvRi_CukIA4l9xJDhrDMmlciipfbvs8iRRRglrk";

/**
 * Calculates notifyAt based on modal prefix and deadline.
 * @param {string} prefix "" or "edit-"
 * @returns {{ notifyAt: number | null, isValid: boolean, errorMsg: string | null }}
 */
function calculateNotifyAt(prefix) {
  const toggle = document.getElementById(prefix + 'notify-toggle');
  if (toggle && !toggle.checked) {
    return { notifyAt: null, isValid: true, errorMsg: null };
  }

  const dateInput = document.getElementById(prefix + 'deadline-date');
  const timeInput = document.getElementById(prefix + 'deadline-time');
  const hrsInput = document.getElementById(prefix + 'deadline-hrs');
  const minsInput = document.getElementById(prefix + 'deadline-mins');
  const clearCheckbox = document.getElementById(prefix + 'deadline-clear'); // only in edit- modal

  if (prefix === "edit-" && clearCheckbox && clearCheckbox.checked) {
    return { notifyAt: null, isValid: false, errorMsg: null };
  }

  let deadlineAt = null;
  let deadlineSetAt = null;

  if (dateInput?.value) {
    const timeVal = timeInput?.value || "23:59";
    const deadlineDate = new Date(`${dateInput.value}T${timeVal}:00`);
    deadlineAt = deadlineDate.getTime();

    if (prefix === "edit-" && selectedBar && selectedBar.deadlineSetAt) {
      deadlineSetAt = selectedBar.deadlineSetAt.toDate ? selectedBar.deadlineSetAt.toDate().getTime() : Number(selectedBar.deadlineSetAt);
    } else {
      deadlineSetAt = Date.now();
    }
  } else if (hrsInput?.value || minsInput?.value) {
    const hrs = parseFloat(hrsInput.value) || 0;
    const mins = parseFloat(minsInput.value) || 0;
    if (hrs > 0 || mins > 0) {
      const now = Date.now();
      deadlineAt = now + (hrs * 3600000) + (mins * 60000);

      if (prefix === "edit-" && selectedBar && selectedBar.deadlineSetAt) {
        deadlineSetAt = selectedBar.deadlineSetAt.toDate ? selectedBar.deadlineSetAt.toDate().getTime() : Number(selectedBar.deadlineSetAt);
      } else {
        deadlineSetAt = now;
      }
    }
  }

  if (!deadlineAt) {
    return { notifyAt: null, isValid: false, errorMsg: null };
  }

  const percentInput = document.getElementById(prefix + 'notify-percent');
  const mode = (percentInput && percentInput.value !== "") ? "percent" : "fixed";

  if (mode === "fixed") {
    const notifyHrsInput = document.getElementById(prefix + 'notify-hrs');
    const notifyMinsInput = document.getElementById(prefix + 'notify-mins');

    const hStr = notifyHrsInput ? notifyHrsInput.value : "";
    const mStr = notifyMinsInput ? notifyMinsInput.value : "";

    if (!hStr.trim() && !mStr.trim()) {
      return { notifyAt: null, isValid: false, errorMsg: null };
    }

    const hrs = parseFloat(hStr) || 0;
    const mins = parseFloat(mStr) || 0;

    if (hrs < 0 || mins < 0) {
      return { notifyAt: null, isValid: false, errorMsg: "⚠ Notification time is outside the valid range" };
    }

    if (hrs === 0 && mins === 0) {
      return { notifyAt: null, isValid: false, errorMsg: null };
    }

    const totalMs = (hrs * 3600000) + (mins * 60000);
    const notifyAt = deadlineAt - totalMs;

    const now = Date.now();
    if (notifyAt <= now || notifyAt >= deadlineAt) {
      return { notifyAt: notifyAt, isValid: false, errorMsg: "⚠ Notification time is outside the valid range" };
    }

    return { notifyAt: notifyAt, isValid: true, errorMsg: null };
  } else {
    const percentInput = document.getElementById(prefix + 'notify-percent');
    const pStr = percentInput ? percentInput.value : "";

    if (!pStr.trim()) {
      return { notifyAt: null, isValid: false, errorMsg: null };
    }

    const percent = parseFloat(pStr);

    if (isNaN(percent) || percent < 0 || percent > 100) {
      return { notifyAt: null, isValid: false, errorMsg: "⚠ Notification time is outside the valid range" };
    }

    if (percent === 0) {
      return { notifyAt: null, isValid: false, errorMsg: null };
    }

    const setAt = deadlineSetAt || Date.now();
    const totalDuration = deadlineAt - setAt;
    const notifyAt = deadlineAt - (totalDuration * (percent / 100));

    const now = Date.now();
    if (notifyAt <= now || notifyAt >= deadlineAt) {
      return { notifyAt: notifyAt, isValid: false, errorMsg: "⚠ Notification time is outside the valid range" };
    }

    return { notifyAt: notifyAt, isValid: true, errorMsg: null };
  }
}

/**
 * Updates the disabled state and calculated preview inside modals.
 * @param {string} prefix "" or "edit-"
 */
/**
 * Updates the disabled state and calculated preview inside modals.
 * @param {string} prefix "" or "edit-"
 */
function updateNotificationPreview(prefix) {
  const section = document.getElementById(prefix + 'notification-section');
  const previewEl = document.getElementById(prefix === "edit-" ? "notify-preview-edit" : "notify-preview-create");

  if (!section || !previewEl) return;

  const toggle = document.getElementById(prefix + 'notify-toggle');
  const settingsContent = document.getElementById(prefix === "edit-" ? "edit-notify-settings-content" : "notify-settings-content");

  if (toggle && settingsContent) {
    if (!toggle.checked) {
      settingsContent.classList.add("collapsed");
      previewEl.classList.remove("visible", "valid", "invalid");
      previewEl.textContent = "";
      return;
    } else {
      settingsContent.classList.remove("collapsed");
    }
  }

  const dateInput = document.getElementById(prefix + 'deadline-date');
  const hrsInput = document.getElementById(prefix + 'deadline-hrs');
  const minsInput = document.getElementById(prefix + 'deadline-mins');
  const clearCheckbox = document.getElementById(prefix + 'deadline-clear');

  const notifyHrsInput = document.getElementById(prefix + 'notify-hrs');
  const notifyMinsInput = document.getElementById(prefix + 'notify-mins');
  const notifyPercentInput = document.getElementById(prefix + 'notify-percent');

  const hasDeadline = (dateInput?.value) ||
    (parseFloat(hrsInput?.value) > 0 || parseFloat(minsInput?.value) > 0);
  const isCleared = prefix === "edit-" && clearCheckbox?.checked;

  if (!hasDeadline || isCleared) {
    previewEl.classList.add("visible", "invalid");
    previewEl.classList.remove("valid");
    previewEl.textContent = "⚠ Please set a deadline first";
    
    // Disable inputs
    if (notifyHrsInput) notifyHrsInput.setAttribute("disabled", "true");
    if (notifyMinsInput) notifyMinsInput.setAttribute("disabled", "true");
    if (notifyPercentInput) notifyPercentInput.setAttribute("disabled", "true");
    return;
  }

  // Ensure all inputs are enabled
  if (notifyHrsInput) notifyHrsInput.removeAttribute("disabled");
  if (notifyMinsInput) notifyMinsInput.removeAttribute("disabled");
  if (notifyPercentInput) notifyPercentInput.removeAttribute("disabled");

  const modeAHasValue = (notifyHrsInput?.value !== "") || (notifyMinsInput?.value !== "");
  const modeBHasValue = (notifyPercentInput?.value !== "");

  // Auto-detect mode dynamically based on inputs
  const mode = modeBHasValue ? "percent" : "fixed";

  // Calculate and update preview
  const hasInputs = mode === "fixed" ? modeAHasValue : (mode === "percent" ? modeBHasValue : false);
  if (!hasInputs) {
    previewEl.classList.remove("visible", "valid", "invalid");
    previewEl.textContent = "";
  } else {
    const { notifyAt, isValid, errorMsg } = calculateNotifyAt(prefix);
    if (errorMsg) {
      previewEl.classList.add("visible", "invalid");
      previewEl.classList.remove("valid");
      let displayMsg = errorMsg;
      if (displayMsg && displayMsg.includes("outside the valid range")) {
        displayMsg = "⚠ Outside valid range";
      }
      previewEl.textContent = displayMsg;
    } else if (isValid && notifyAt) {
      previewEl.classList.add("visible", "valid");
      previewEl.classList.remove("invalid");

      const dt = new Date(notifyAt);
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dayName = days[dt.getDay()];
      const monthName = months[dt.getMonth()];
      const dateNum = dt.getDate();
      let hours = dt.getHours();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const minutesStr = String(dt.getMinutes()).padStart(2, '0');
      const customFormatted = `${dayName}, ${monthName} ${dateNum} at ${hours}:${minutesStr} ${ampm}`;

      previewEl.textContent = `📅 ${customFormatted}`;
    } else {
      previewEl.classList.remove("visible", "valid", "invalid");
      previewEl.textContent = "";
    }
  }
}

/**
 * Requests FCM notification permissions, generates client token, and stores it.
 * @param {string} uid User ID.
 */
async function handleFCMSession(uid) {
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      const isGuest = isGuestMode();
      if (isGuest) {
        localStorage.setItem("ps_fcm_token", "sandbox-mock-token");
        return;
      }

      if (typeof messaging !== "undefined" && messaging) {
        const registration = await navigator.serviceWorker.ready;
        const token = await getToken(messaging, { 
          vapidKey: FCM_VAPID_KEY,
          serviceWorkerRegistration: registration
        });
        if (token) {
          await saveFCMToken(uid, token);
        } else {
          console.warn("No FCM registration token available.");
        }
      }
    }
  } catch (error) {
    console.error("FCM Token capture failed:", error);
  }
}

/**
 * Sets up dynamic validation listeners on notification fields.
 * @param {string} prefix "" or "edit-"
 */
function setupNotificationListeners(prefix = "") {
  const dateInput = document.getElementById(prefix + 'deadline-date');
  const timeInput = document.getElementById(prefix + 'deadline-time');
  const hrsInput = document.getElementById(prefix + 'deadline-hrs');
  const minsInput = document.getElementById(prefix + 'deadline-mins');
  const clearCheckbox = document.getElementById(prefix + 'deadline-clear');

  const notifyHrs = document.getElementById(prefix + 'notify-hrs');
  const notifyMins = document.getElementById(prefix + 'notify-mins');
  const notifyPercent = document.getElementById(prefix + 'notify-percent');
  const toggle = document.getElementById(prefix + 'notify-toggle');
  const endAlertToggle = document.getElementById(prefix === "edit-" ? "edit-notify-toggle-deadline" : "end-alert-toggle-create");

  const runUpdate = () => updateNotificationPreview(prefix);

  const clearNotificationInputs = () => {
    if (notifyHrs) notifyHrs.value = "";
    if (notifyMins) notifyMins.value = "";
    if (notifyPercent) notifyPercent.value = "";
  };

  // Bind change/input listeners for deadline changes
  dateInput?.addEventListener('input', () => {
    if (prefix === "edit-") clearNotificationInputs();
    runUpdate();
  });
  dateInput?.addEventListener('change', () => {
    if (prefix === "edit-") clearNotificationInputs();
    runUpdate();
  });
  timeInput?.addEventListener('input', () => {
    if (prefix === "edit-") clearNotificationInputs();
    runUpdate();
  });
  timeInput?.addEventListener('change', () => {
    if (prefix === "edit-") clearNotificationInputs();
    runUpdate();
  });
  hrsInput?.addEventListener('input', () => {
    if (prefix === "edit-") clearNotificationInputs();
    runUpdate();
  });
  minsInput?.addEventListener('input', () => {
    if (prefix === "edit-") clearNotificationInputs();
    runUpdate();
  });
  if (clearCheckbox) {
    clearCheckbox.addEventListener('change', () => {
      if (prefix === "edit-") clearNotificationInputs();
      runUpdate();
    });
  }

  // Toggle switch listeners
  toggle?.addEventListener('change', runUpdate);
  endAlertToggle?.addEventListener('change', runUpdate);

  // Auto-clearing input triggers
  const onFixedType = () => {
    if (notifyPercent) notifyPercent.value = "";
    runUpdate();
  };

  const onPercentType = () => {
    if (notifyHrs) notifyHrs.value = "";
    if (notifyMins) notifyMins.value = "";
    runUpdate();
  };

  notifyHrs?.addEventListener('input', onFixedType);
  notifyMins?.addEventListener('input', onFixedType);
  notifyPercent?.addEventListener('input', onPercentType);

  notifyHrs?.addEventListener('change', onFixedType);
  notifyMins?.addEventListener('change', onFixedType);
  notifyPercent?.addEventListener('change', onPercentType);

  const requestPermissionOnInteraction = () => {
    if (Notification.permission === "denied") return;
    if (typeof currentUser !== 'undefined') {
      const uid = isGuestMode() ? null : (currentUser ? currentUser.uid : null);
      handleFCMSession(uid);
    }
  };

  notifyHrs?.addEventListener('focus', requestPermissionOnInteraction);
  notifyMins?.addEventListener('focus', requestPermissionOnInteraction);
  notifyPercent?.addEventListener('focus', requestPermissionOnInteraction);
  notifyHrs?.addEventListener('click', requestPermissionOnInteraction);
  notifyMins?.addEventListener('click', requestPermissionOnInteraction);
  notifyPercent?.addEventListener('click', requestPermissionOnInteraction);
  endAlertToggle?.addEventListener('click', requestPermissionOnInteraction);

  runUpdate();
}

setupNotificationListeners("");
setupNotificationListeners("edit-");

function getListContinuationIndent(line) {
  const bulletMatch = line.match(/^(\s*)([-*•●])(\s+)/);
  if (bulletMatch) {
    return bulletMatch[1] + ' '.repeat(bulletMatch[2].length + bulletMatch[3].length);
  }
  const numMatch = line.match(/^(\s*)(\d+)([.)])(\s+)/);
  if (numMatch) {
    return numMatch[1] + ' '.repeat(numMatch[2].length + numMatch[3].length + numMatch[4].length);
  }
  const alphaMatch = line.match(/^(\s*)([a-zA-Z])([.)])(\s+)/);
  if (alphaMatch) {
    return alphaMatch[1] + ' '.repeat(alphaMatch[2].length + alphaMatch[3].length + alphaMatch[4].length);
  }
  const romanMatch = line.match(/^(\s*)(i{1,3}|iv|vi{0,3}|ix|x)([.)])(\s+)/i);
  if (romanMatch) {
    return romanMatch[1] + ' '.repeat(romanMatch[2].length + romanMatch[3].length + romanMatch[4].length);
  }
  return null;
}

function updateListNumbers(editor) {
  let currentNumber = 1;
  let inNumberSequence = false;
  const children = editor.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.getAttribute('data-type') === 'number') {
      if (!inNumberSequence) {
        inNumberSequence = true;
        currentNumber = 1;
      }
      child.setAttribute('data-number', currentNumber);
      currentNumber++;
    } else {
      inNumberSequence = false;
    }
  }
}

function formatLineNode(node, editor) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const text = node.textContent;

  // 1. Bullet formatting: ^([-*])\s
  const bulletMatch = text.match(/^([-*])\s(.*)$/);
  if (bulletMatch) {
    const marker = bulletMatch[1];
    const rest = bulletMatch[2];

    const selection = window.getSelection();
    let offset = 0;
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      offset = range.startOffset;
    }

    node.className = "note-line-bullet";
    node.setAttribute("data-type", "bullet");
    node.setAttribute("data-marker", marker);

    if (rest === "") {
      node.innerHTML = "<br>";
    } else {
      node.textContent = rest;
    }

    // Restore caret position
    const newRange = document.createRange();
    const textNode = node.firstChild || node;
    const newOffset = Math.max(0, offset - 2);
    try {
      newRange.setStart(textNode, Math.min(newOffset, textNode.length || 0));
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } catch (e) {
      console.warn("Caret restore error:", e);
    }
    return true;
  }

  // 2. Numbered formatting: ^(\d+)\.\s
  const numMatch = text.match(/^(\d+)\.\s(.*)$/);
  if (numMatch) {
    const num = numMatch[1];
    const rest = numMatch[2];
    const prefixLen = num.length + 2;

    const selection = window.getSelection();
    let offset = 0;
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      offset = range.startOffset;
    }

    node.className = "note-line-number";
    node.setAttribute("data-type", "number");
    node.setAttribute("data-number", num);

    if (rest === "") {
      node.innerHTML = "<br>";
    } else {
      node.textContent = rest;
    }

    // Restore caret position
    const newRange = document.createRange();
    const textNode = node.firstChild || node;
    const newOffset = Math.max(0, offset - prefixLen);
    try {
      newRange.setStart(textNode, Math.min(newOffset, textNode.length || 0));
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } catch (e) {
      console.warn("Caret restore error:", e);
    }

    updateListNumbers(editor);
    return true;
  }

  return false;
}

function initializeNoteEditor(editor, rawText) {
  if (typeof editor === 'string') {
    editor = document.getElementById(editor);
  }
  if (!editor) return;

  editor.innerHTML = "";
  if (!rawText) {
    const div = document.createElement("div");
    div.className = "note-p";
    div.innerHTML = "<br>";
    editor.appendChild(div);
    return;
  }

  const lines = rawText.split("\n");
  lines.forEach(line => {
    const div = document.createElement("div");
    const bulletMatch = line.match(/^(\s*)([-*•●])\s+(.*)$/);
    const numMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    
    if (bulletMatch) {
      div.className = "note-line-bullet";
      div.setAttribute("data-type", "bullet");
      div.setAttribute("data-marker", bulletMatch[2]);
      div.textContent = bulletMatch[3];
    } else if (numMatch) {
      div.className = "note-line-number";
      div.setAttribute("data-type", "number");
      div.setAttribute("data-number", numMatch[2]);
      div.textContent = numMatch[3];
    } else {
      div.className = "note-p";
      if (line === "") {
        div.innerHTML = "<br>";
      } else {
        div.textContent = line;
      }
    }
    editor.appendChild(div);
  });
  updateListNumbers(editor);
}

function serializeNoteEditor(editor) {
  if (typeof editor === 'string') {
    editor = document.getElementById(editor);
  }
  if (!editor) return "";

  const lines = [];
  const children = editor.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const type = child.getAttribute("data-type");
    const text = child.textContent;
    if (type === "bullet") {
      lines.push("- " + text);
    } else if (type === "number") {
      const num = child.getAttribute("data-number") || "1";
      lines.push(num + ". " + text);
    } else {
      lines.push(text);
    }
  }
  return lines.join("\n");
}

function setupContenteditableEditor(editor, counterId) {
  const counter = document.getElementById(counterId);

  function updateCounter() {
    const text = serializeNoteEditor(editor);
    if (counter) counter.textContent = `${text.length} / 1600`;
  }

  editor.addEventListener('input', (e) => {
    // Character limit enforcement
    const serialized = serializeNoteEditor(editor);
    if (serialized.length > 1600) {
      const selection = window.getSelection();
      let offset = 0;
      let textNode = null;
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        textNode = range.startContainer;
        offset = range.startOffset;
      }
      const overAmount = serialized.length - 1600;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const val = textNode.nodeValue;
        textNode.nodeValue = val.substring(0, Math.max(0, val.length - overAmount));
        // Restore caret
        const newRange = document.createRange();
        newRange.setStart(textNode, Math.min(offset, textNode.length));
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
      showToast("Character limit of 1600 reached.", "warning");
      updateCounter();
      return;
    }

    // Ensure editor always contains at least one line element
    if (editor.children.length === 0) {
      const div = document.createElement("div");
      div.className = "note-p";
      div.innerHTML = "<br>";
      editor.appendChild(div);
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(div, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    // Check formatting on active line
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      let node = range.startContainer;
      while (node && node.parentElement !== editor) {
        node = node.parentElement;
      }
      if (node && node.nodeType === Node.ELEMENT_NODE) {
        formatLineNode(node, editor);
      }
    }
    updateCounter();
  });

  editor.addEventListener('keydown', (e) => {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    let node = range.startContainer;
    while (node && node.parentElement !== editor) {
      node = node.parentElement;
    }
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

    if (e.key === 'Enter') {
      const type = node.getAttribute("data-type");
      const contentText = node.textContent.trim();

      if ((type === 'bullet' || type === 'number') && contentText === '') {
        // Hitting Enter on empty list item -> breakout to plain paragraph
        e.preventDefault();
        node.className = "note-p";
        node.removeAttribute("data-type");
        node.removeAttribute("data-number");
        node.innerHTML = "<br>";
        
        const newRange = document.createRange();
        newRange.setStart(node, 0);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
        
        updateListNumbers(editor);
        updateCounter();
        return;
      }

      if (type === 'number') {
        setTimeout(() => {
          updateListNumbers(editor);
          updateCounter();
        }, 10);
      }
    }

    if (e.key === 'Backspace') {
      const type = node.getAttribute("data-type");
      const offset = range.startOffset;
      if ((type === 'bullet' || type === 'number') && offset === 0) {
        // Caret is at the start of list item node -> convert back to plain paragraph
        e.preventDefault();
        node.className = "note-p";
        node.removeAttribute("data-type");
        node.removeAttribute("data-number");
        
        const textNode = node.firstChild || node;
        const newRange = document.createRange();
        newRange.setStart(textNode, 0);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
        
        updateListNumbers(editor);
        updateCounter();
        return;
      }
    }
  });

  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text) return;

    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);

    const lines = text.split('\n');
    const fragment = document.createDocumentFragment();
    lines.forEach(line => {
      const div = document.createElement('div');
      const bulletMatch = line.match(/^(\s*)([-*•●])\s+(.*)$/);
      const numMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
      if (bulletMatch) {
        div.className = "note-line-bullet";
        div.setAttribute("data-type", "bullet");
        div.setAttribute("data-marker", bulletMatch[2]);
        div.textContent = bulletMatch[3];
      } else if (numMatch) {
        div.className = "note-line-number";
        div.setAttribute("data-type", "number");
        div.setAttribute("data-number", numMatch[2]);
        div.textContent = numMatch[3];
      } else {
        div.className = "note-p";
        if (line === "") {
          div.innerHTML = "<br>";
        } else {
          div.textContent = line;
        }
      }
      fragment.appendChild(div);
    });

    range.deleteContents();
    
    let node = range.startContainer;
    while (node && node.parentElement !== editor) {
      node = node.parentElement;
    }
    
    if (node) {
      const parent = node.parentElement;
      const lastInserted = fragment.lastChild;
      const isEmptyNode = node.textContent === "" && node.innerHTML === "<br>";
      if (isEmptyNode) {
        parent.replaceChild(fragment, node);
      } else {
        parent.insertBefore(fragment, node.nextSibling);
      }

      if (lastInserted) {
        const newRange = document.createRange();
        const textNode = lastInserted.lastChild || lastInserted;
        newRange.setStart(textNode, textNode.nodeType === Node.TEXT_NODE ? textNode.length : 0);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
    } else {
      editor.appendChild(fragment);
    }

    updateListNumbers(editor);
    updateCounter();
  });
}

function setupNoteCharCounters() {
  const editors = [
    { id: 'create-note-text', counterId: 'create-note-char-count' },
    { id: 'edit-note-text',   counterId: 'edit-note-char-count'   },
    { id: 'update-note-text', counterId: 'update-note-char-count' }
  ];

  editors.forEach(({ id, counterId }) => {
    const el = document.getElementById(id);
    if (!el) return;
    setupContenteditableEditor(el, counterId);
  });
}

setupNoteCharCounters();

// ==========================================
// APK & Edit Mode & Manual Ordering Controls
// ==========================================
const selectedBarIds = new Set();
let editModeActive = false;



// Toggles selection state of a card in Edit Mode
function toggleCardSelection(card) {
  const barId = card.getAttribute("data-bar-id");
  if (!barId) return;

  if (selectedBarIds.has(barId)) {
    selectedBarIds.delete(barId);
    card.classList.remove("selected");
  } else {
    selectedBarIds.add(barId);
    card.classList.add("selected");
  }

  const grid = document.getElementById("cards-grid");
  if (grid) {
    if (selectedBarIds.size > 0) {
      grid.classList.add("has-selections");
    } else {
      grid.classList.remove("has-selections");
    }
  }

  updateDeleteSelectedButton();
}

// Update state/label of the delete selected button and sort select replacement
function updateDeleteSelectedButton() {
  const btn = document.getElementById("btn-delete-selected");
  if (btn) {
    btn.textContent = `Delete Selected (${selectedBarIds.size})`;
    btn.classList.add("hidden");
  }

  const sortContainer = document.querySelector(".sort-container");
  if (!sortContainer) return;

  if (editModeActive) {
    // Hide original sort select elements
    const label = sortContainer.querySelector(".sort-label");
    const select = sortContainer.querySelector("#sort-select");
    if (label) label.style.display = "none";
    if (select) select.style.display = "none";

    // Check if our custom edit container exists
    let editContainer = sortContainer.querySelector(".edit-selection-status");
    if (!editContainer) {
      editContainer = document.createElement("div");
      editContainer.className = "edit-selection-status";
      sortContainer.appendChild(editContainer);
    }

    if (selectedBarIds.size === 0) {
      editContainer.innerHTML = `<span class="select-del-title">Select the card to del</span>`;
      sortContainer.style.cursor = "default";
      sortContainer.onclick = null;
      sortContainer.classList.remove("danger-active");
    } else {
      editContainer.innerHTML = `<span class="delete-del-btn">Delete Selected (${selectedBarIds.size})</span>`;
      sortContainer.style.cursor = "pointer";
      sortContainer.classList.add("danger-active");
      
      // Bind click handler to sort container to execute delete
      sortContainer.onclick = (e) => {
        e.stopPropagation();
        const btnDeleteReal = document.getElementById("btn-delete-selected");
        if (btnDeleteReal) {
          btnDeleteReal.click();
        }
      };
    }
  } else {
    // Restore original sort select elements
    const label = sortContainer.querySelector(".sort-label");
    const select = sortContainer.querySelector("#sort-select");
    if (label) label.style.display = "";
    if (select) select.style.display = "";

    const editContainer = sortContainer.querySelector(".edit-selection-status");
    if (editContainer) {
      editContainer.remove();
    }
    sortContainer.style.cursor = "";
    sortContainer.onclick = null;
    sortContainer.classList.remove("danger-active");
  }
}

// Setup APK button toast triggers with shake animation
function setupAPKButton() {
  const btn = document.getElementById("btn-apk-download");
  if (btn) {
    btn.addEventListener("click", () => {
      btn.classList.add("shake-anim");
      btn.addEventListener("animationend", () => {
        btn.classList.remove("shake-anim");
      }, { once: true });
      showToast("Thanks for showing interest. APK is under development.", "info");
    });
  }
}

// Setup Edit Mode and Batch Delete interactions
function setupEditModeControls() {
  const btnToggle = document.getElementById("btn-toggle-edit");
  const btnDelete = document.getElementById("btn-delete-selected");
  const grid = document.getElementById("cards-grid");

  if (!btnToggle || !grid) return;

  btnToggle.addEventListener("click", () => {
    editModeActive = !editModeActive;
    const controls = document.querySelector(".dashboard-controls");
    if (editModeActive) {
      btnToggle.classList.add("active");
      grid.classList.add("edit-mode");
      if (controls) controls.classList.add("edit-active");
      window.history.pushState({ editMode: true }, "");
      resetHeaderScroll();
      updateDeleteSelectedButton();
    } else {
      exitEditMode();
    }
  });

  if (btnDelete) {
    btnDelete.addEventListener("click", async () => {
      if (selectedBarIds.size === 0) return;
      const count = selectedBarIds.size;
      const confirmMessage = `Are you sure you want to permanently delete the ${count} selected progress bar${count === 1 ? '' : 's'}?`;
      if (!window.confirm(confirmMessage)) return;

      const idsToDelete = [...selectedBarIds];
      const toast = showToast(`Deleting ${count} card${count === 1 ? '' : 's'}...`, "info", 0);

      try {
        await deleteMultipleBars(isGuestMode() ? null : (currentUser ? currentUser.uid : null), idsToDelete);
        if (toast) dismissToast(toast);
        showToast(`Deleted ${count} card${count === 1 ? '' : 's'} successfully.`, "success");
        
        // Remove deleted items locally if in guest mode
        if (isGuestMode()) {
          const bars = getLocalBars().filter(b => !idsToDelete.includes(b.id));
          renderDashboard(bars);
        }
        
        selectedBarIds.clear();
        exitEditMode();
      } catch (err) {
        if (toast) dismissToast(toast);
        showToast("Failed to delete selected cards.", "error");
        console.error("Error performing batch deletion:", err);
      }
    });
  }

  // Auto-exit Edit Mode when clicking elements outside the grid and control buttons
  document.addEventListener("click", (event) => {
    if (!editModeActive) return;

    const toggleEditBtn = document.getElementById("btn-toggle-edit");
    const deleteSelectedBtn = document.getElementById("btn-delete-selected");

    const clickedInsideGrid = grid && grid.contains(event.target);
    const clickedToggleEdit = toggleEditBtn && toggleEditBtn.contains(event.target);
    const clickedDeleteSelected = deleteSelectedBtn && deleteSelectedBtn.contains(event.target);

    if (!clickedInsideGrid && !clickedToggleEdit && !clickedDeleteSelected) {
      exitEditMode();
    }
  }, true);
}

function exitEditMode() {
  const btnToggle = document.getElementById("btn-toggle-edit");
  const grid = document.getElementById("cards-grid");
  const controls = document.querySelector(".dashboard-controls");

  editModeActive = false;
  selectedBarIds.clear();
  updateDeleteSelectedButton();

  if (btnToggle) {
    btnToggle.classList.remove("active");
  }
  if (grid) {
    grid.classList.remove("edit-mode");
    grid.classList.remove("has-selections");
    // Remove selected highlights
    grid.querySelectorAll(".card-progress.selected").forEach(card => {
      card.classList.remove("selected");
    });
  }
  if (controls) {
    controls.classList.remove("edit-active");
  }

  // Clean history state if manual close
  if (!isPopStateExit) {
    if (window.history.state && window.history.state.editMode) {
      window.history.back();
    }
  }
  resetHeaderScroll();
}

// Run initializers
setupAPKButton();
setupEditModeControls();

// Scroll state variables at module scope so edit mode controls can reset them
// Scroll state variables at module scope so edit mode controls can reset them
let y_nav = 0;
let y_subbar = 0;
let y_stats = 0;
let y_controls = 0;

function resetHeaderScroll() {
  y_nav = 0;
  y_subbar = 0;
  y_stats = 0;
  y_controls = 0;
  const navbarEl = document.querySelector(".navbar");
  const subbarEl = document.querySelector(".mobile-subbar");
  const statsEl = document.getElementById("stats-banner");
  const controlsEl = document.querySelector(".dashboard-controls");
  if (navbarEl) navbarEl.style.transform = "translateY(0px)";
  if (subbarEl) subbarEl.style.transform = "translateY(0px)";
  if (statsEl) statsEl.style.transform = "translateY(0px)";
  if (controlsEl) controlsEl.style.transform = "translateY(0px)";
}

function setupStaggeredHeaderScroll() {
  let lastScrollY = window.scrollY;
  let H_nav = 57;
  let H_subbar = 0;
  let H_stats = 0;
  let H_controls = 45;
  let scrollTicking = false;

  function updateHeaderScroll() {
    const currentScrollY = window.scrollY;
    const deltaY = currentScrollY - lastScrollY;
    lastScrollY = currentScrollY;

    const subbarEl = document.querySelector(".mobile-subbar");
    const statsEl = document.getElementById("stats-banner");
    const controlsEl = document.querySelector(".dashboard-controls");

    // Measure dynamic heights with subpixel precision
    const navbarEl = document.querySelector(".navbar");
    H_nav = navbarEl ? navbarEl.getBoundingClientRect().height : 57;
    H_subbar = (subbarEl && window.getComputedStyle(subbarEl).display !== "none") ? subbarEl.getBoundingClientRect().height : 0;
    H_stats = (statsEl && !statsEl.classList.contains("hidden")) ? statsEl.getBoundingClientRect().height : 0;
    H_controls = controlsEl ? controlsEl.getBoundingClientRect().height : 45;

    // Push offsets to document so sticky tops align dynamically
    document.documentElement.style.setProperty("--navbar-height", `${H_nav}px`);
    document.documentElement.style.setProperty("--subbar-height", `${H_subbar}px`);
    document.documentElement.style.setProperty("--stats-height", `${H_stats}px`);

    // Clear translations at the top of the page and bring back mobile subbar
    if (currentScrollY <= 5) {
      resetHeaderScroll();
      scrollTicking = false;
      return;
    }

    if (editModeActive) {
      y_nav = 0;
      y_subbar = 0;
      y_stats = 0;
      y_controls = 0;
    } else if (deltaY > 0) {
      // Scrolling down (hide elements): Controls -> Stats banner -> Mobile subbar -> Main Nav
      let toDistribute = deltaY;
      
      if (y_controls < H_controls) {
        const space = H_controls - y_controls;
        const take = Math.min(space, toDistribute);
        y_controls += take;
        toDistribute -= take;
      }
      
      if (toDistribute > 0 && y_stats < H_stats) {
        const space = H_stats - y_stats;
        const take = Math.min(space, toDistribute);
        y_stats += take;
        toDistribute -= take;
      }
      
      if (toDistribute > 0 && H_subbar > 0 && y_subbar < H_subbar) {
        const space = H_subbar - y_subbar;
        const take = Math.min(space, toDistribute);
        y_subbar += take;
        toDistribute -= take;
      }

      if (toDistribute > 0 && y_nav < H_nav) {
        const space = H_nav - y_nav;
        const take = Math.min(space, toDistribute);
        y_nav += take;
        toDistribute -= take;
      }
    } else if (deltaY < 0) {
      // Scrolling up (reveal elements): Main Nav -> Stats banner -> Dashboard Controls
      // (Mobile subbar remains hidden at H_subbar until we reach the top/bottom boundary)
      let toDistribute = -deltaY;
      
      if (y_nav > 0) {
        const take = Math.min(y_nav, toDistribute);
        y_nav -= take;
        toDistribute -= take;
      }
      
      if (toDistribute > 0 && y_stats > 0) {
        const take = Math.min(y_stats, toDistribute);
        y_stats -= take;
        toDistribute -= take;
      }
      
      if (toDistribute > 0 && y_controls > 0) {
        const take = Math.min(y_controls, toDistribute);
        y_controls -= take;
        toDistribute -= take;
      }
    }

    if (navbarEl) {
      navbarEl.style.transform = `translateY(-${y_nav}px)`;
    }
    if (subbarEl) {
      subbarEl.style.transform = `translateY(-${y_nav + y_subbar}px)`;
    }
    if (statsEl) {
      statsEl.style.transform = `translateY(-${y_nav + y_subbar + y_stats}px)`;
    }
    if (controlsEl) {
      controlsEl.style.transform = `translateY(-${y_nav + y_subbar + y_stats + y_controls}px)`;
    }

    scrollTicking = false;
  }

  // Handle window resizing and height re-evaluation
  function handleResize() {
    const subbarEl = document.querySelector(".mobile-subbar");
    const statsEl = document.getElementById("stats-banner");
    const controlsEl = document.querySelector(".dashboard-controls");
    const navbarEl = document.querySelector(".navbar");
    
    H_nav = navbarEl ? navbarEl.getBoundingClientRect().height : 57;
    H_subbar = (subbarEl && window.getComputedStyle(subbarEl).display !== "none") ? subbarEl.getBoundingClientRect().height : 0;
    H_stats = (statsEl && !statsEl.classList.contains("hidden")) ? statsEl.getBoundingClientRect().height : 0;
    H_controls = controlsEl ? controlsEl.getBoundingClientRect().height : 45;

    document.documentElement.style.setProperty("--navbar-height", `${H_nav}px`);
    document.documentElement.style.setProperty("--subbar-height", `${H_subbar}px`);
    document.documentElement.style.setProperty("--stats-height", `${H_stats}px`);

    if (editModeActive) {
      resetHeaderScroll();
    } else {
      y_nav = Math.min(y_nav, H_nav);
      y_subbar = Math.min(y_subbar, H_subbar);
      y_stats = Math.min(y_stats, H_stats);
      y_controls = Math.min(y_controls, H_controls);
      if (navbarEl) navbarEl.style.transform = `translateY(-${y_nav}px)`;
      if (subbarEl) subbarEl.style.transform = `translateY(-${y_nav + y_subbar}px)`;
      if (statsEl) statsEl.style.transform = `translateY(-${y_nav + y_subbar + y_stats}px)`;
      if (controlsEl) controlsEl.style.transform = `translateY(-${y_nav + y_subbar + y_stats + y_controls}px)`;
    }
  }

  // Expose handleResize globally so other layout updates can sync scroll offsets
  window.updateStickyOffsets = handleResize;

  window.addEventListener("scroll", () => {
    if (!scrollTicking) {
      window.requestAnimationFrame(updateHeaderScroll);
      scrollTicking = true;
    }
  }, { passive: true });

  window.addEventListener("resize", handleResize, { passive: true });

  // Initial trigger to register initial heights
  handleResize();
}
setupStaggeredHeaderScroll();

// ==========================================
// Manual Refresh Actions (Credentials & Service Worker Cache)
// ==========================================
const setupRefreshListeners = () => {
  const btnRefresh = document.getElementById("btn-refresh");

  const onRefresh = async () => {
    if (btnRefresh) {
      btnRefresh.style.pointerEvents = "none";
      btnRefresh.classList.add("spinning");
    }

    const toast = showToast("Refreshing App data & register credentials...", "info", 0);
    try {
      // 1. Refresh FCM Token in Supabase
      if (!isGuestMode() && currentUser && currentUser.uid) {
        const oldToken = localStorage.getItem("ps_fcm_token");
        if (oldToken) {
          try {
            await deleteFCMToken(currentUser.uid, oldToken);
          } catch (e) {
            console.warn("Error deleting old token:", e);
          }
          localStorage.removeItem("ps_fcm_token");
        }
        // Re-register FCM session
        await handleFCMSession(currentUser.uid);
      }

      // 2. Clear browser cache for this site
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }

      // 3. Unregister Service Workers to guarantee clean update on next load
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(async (reg) => {
          try {
            await reg.unregister();
          } catch (e) {
            console.warn("Service worker unregistration ignored:", e);
          }
        }));
      }

      dismissToast(toast);
      showToast("App refreshed successfully! Reloading...", "success");
      setTimeout(() => {
        window.location.href = window.location.pathname + '?t=' + Date.now();
      }, 1000);
    } catch (error) {
      console.error("Manual refresh failed:", error);
      dismissToast(toast);
      showToast("Refresh failed. Reloading anyway...", "error");
      setTimeout(() => {
        window.location.href = window.location.pathname + '?t=' + Date.now();
      }, 1500);
    }
  };

  btnRefresh?.addEventListener("click", onRefresh);
};
setupRefreshListeners();

// ==========================================
// Service Worker Registration & Updates
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('Service Worker registered:', reg.scope);

        // Force SW update check when page visibility changes (switching tabs, unlocking phone)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            reg.update().catch(err => console.log('SW update check failed:', err));
          }
        });

        // Also check for updates periodically every 60 seconds
        setInterval(() => {
          reg.update().catch(err => console.log('SW update check failed:', err));
        }, 60000);

        // If there's already a waiting worker, skip waiting immediately
        if (reg.waiting) {
          reg.waiting.postMessage({ action: 'skipWaiting' });
        }

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('New service worker version detected. Skipping waiting...');
                newWorker.postMessage({ action: 'skipWaiting' });
              }
            });
          }
        });
      })
      .catch((err) => console.error('Service Worker registration failed:', err));
  });

  // Automatically refresh the page when the service worker updates and takes control
  const hadControllerOnLoad = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerOnLoad) return; // Skip reload if this is the initial service worker activation after unregistering
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

// ==========================================
// Terrace Updates Overlay Page Logic
// ==========================================
let isTerraceOpen = false;

const terraceUpdates = [
  {
    version: "v4.0 (Latest)",
    date: "July 2, 2026",
    isLatest: true,
    title: "Supabase Integration, FMC Sync & Controls Dashboard",
    content: `
### Backend Migration
* Migrated database and user authentication framework from Firebase to **Supabase** to secure direct DB queries and custom user sessions.

### Dynamic Controls Dashboard
* Introduced the **Controls Dashboard** container underneath the stats banner, carrying version select and GitHub shortcuts.
* Added the manual **App Refresh** button, featuring a smooth rhythmic rotation animation, ensuring Sw cache clearance and FMC token updates.
* Supported **Bulk Card Deletion**: Users can toggle Edit Mode, check multiple items, and trigger batch deletion directly from the sort dropdown.

### Scrolling Sequential Animations
* Implemented an overlay-hiding cascading scroll logic: scrolling down hides controls -> then stats -> then mobile subbar. Scrolling up brings them back sequentially.

### Layout Optimization
* Capped search container to max-width **341px** and height **32px**.
* Enabled DOM width caching to remove resizing event loop lags.
    `
  },
  {
    version: "v3.0",
    date: "July 1, 2026",
    isLatest: false,
    title: "Checking Stats, Multi-Card Types & Refined Alerts",
    content: `
### Dynamic Stats Banner
* Introduced the **Stats Banner** dashboard summary buttons displaying active count, checklist progress, due dates, and quick notes.

### Multi-Card Type Support
* Expanded card formats from basic progress trackers to support **Checklist** lists and **Quick Notes**.

### Instant Search Bar
* Added a header search bar allowing live filtering of dashboard progress cards.

### Enhanced Alerts & Back gestures
* Refined in-app deadlines alerts and system back-gesture interceptions for mobile viewports.
    `
  },
  {
    version: "v2.0",
    date: "June 25, 2026",
    isLatest: false,
    title: "Deadline Border Highlights & Custom Due Dates",
    content: `
### Card Deadlines
* Integrated date-picker properties for individual trackers.
* Added progress card border color variations depending on proximity to the due date.
    `
  },
  {
    version: "v1.0",
    date: "June 23, 2026",
    isLatest: false,
    title: "Initial Launch of ProgressShelf",
    content: `
### Main Features
* Simple dashboard page for tracking custom progress percentages.
* Goal parameters, manual completion metrics, and browser local storage options.
    `
  }
];

function parseTerraceMarkdown(text) {
  return text
    .trim()
    .split('\n')
    .map(line => {
      line = line.trim();
      if (line.startsWith("### ")) {
        return `<h3>${line.substring(4)}</h3>`;
      }
      if (line.startsWith("* ")) {
        let content = line.substring(2);
        content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        return `<li>${content}</li>`;
      }
      return line;
    })
    .join('\n')
    .replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>')
    .replace(/<\/ul>\s*<ul>/g, '');
}

function renderTerraceUpdates() {
  const container = document.getElementById("terrace-content");
  if (!container) return;

  container.innerHTML = terraceUpdates.map(up => `
    <div class="terrace-card ${up.isLatest ? 'latest' : ''}">
      <div class="terrace-card-header">
        <span class="terrace-version-badge">${up.version}</span>
        <span class="terrace-date">${up.date}</span>
        <h2 class="terrace-version-title">${up.title}</h2>
      </div>
      <div class="terrace-body">
        ${parseTerraceMarkdown(up.content)}
      </div>
    </div>
  `).join('');
}

function openTerracePage() {
  isTerraceOpen = true;
  const overlay = document.getElementById("terrace-overlay");
  if (overlay) {
    overlay.classList.add("visible");
  }
  renderTerraceUpdates();
  window.history.pushState({ terraceOpen: true }, "");
}

function closeTerracePage(isPopState = false) {
  isTerraceOpen = false;
  const overlay = document.getElementById("terrace-overlay");
  if (overlay) {
    overlay.classList.remove("visible");
  }
  if (!isPopState) {
    window.history.back();
  }
}

// Bind Terrace event triggers
const setupTerracePage = () => {
  const btnTerrace = document.getElementById("btn-terrace");
  const btnCloseTerrace = document.getElementById("btn-close-terrace");

  if (btnTerrace) {
    btnTerrace.addEventListener("click", (e) => {
      e.stopPropagation();
      if (profileDropdown) profileDropdown.classList.remove("active");
      openTerracePage();
    });
  }

  if (btnCloseTerrace) {
    btnCloseTerrace.addEventListener("click", () => {
      closeTerracePage(false);
    });
  }
};
setupTerracePage();

// Setup PWA WebAPK download logic
const checkIsPWA = () => {
  return window.matchMedia('(display-mode: standalone)').matches || 
         window.matchMedia('(display-mode: minimal-ui)').matches || 
         window.matchMedia('(display-mode: fullscreen)').matches || 
         window.navigator.standalone === true;
};

function setupDownloadApk() {
  const btnDownload = document.getElementById("btn-download-apk");
  if (!btnDownload) return;

  const isPWA = checkIsPWA();
  if (isPWA) {
    btnDownload.style.display = "none";
  } else {
    btnDownload.style.display = "inline-flex";
  }

  btnDownload.addEventListener("click", async (e) => {
    e.stopPropagation();

    // Check device types
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isMobile = isIOS || isAndroid || /webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // 1. Attempt standard PWA WebAPK installation prompt if available
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          deferredPrompt = null;
          btnDownload.style.display = "none";
          showToast("Starting Web APK installation...", "success");
          return;
        }
      } catch (err) {
        console.error("PWA prompt error:", err);
      }
    }

    // 2. If mobile device, show instructions instead of downloading mock .apk
    if (isMobile) {
      if (isIOS) {
        showToast("To install ProgressShelf on iOS, tap the Share button and select 'Add to Home Screen'.", "info");
      } else if (isAndroid) {
        showToast("To install, tap Chrome's three dots menu (top right) and select 'Install app' or 'Add to Home Screen'.", "info");
      } else {
        showToast("To install, open browser settings menu and select 'Add to Home Screen'.", "info");
      }
      return;
    }

    // 3. Fallback for Desktop: Trigger mock ProgressShelf.apk download
    try {
      const blob = new Blob(["ProgressShelf Web PWA Package"], { type: "application/vnd.android.package-archive" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "ProgressShelf.apk";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      
      showToast("Downloading ProgressShelf.apk...", "success");
    } catch (err) {
      showToast("Failed to start download.", "error");
    }
  });
};

// Global PWA install listener
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const isPWA = checkIsPWA();
  if (!isPWA) {
    const btnDownload = document.getElementById("btn-download-apk");
    if (btnDownload) btnDownload.style.display = "inline-flex";
  }
});

// Hide download button when app is installed successfully
window.addEventListener('appinstalled', () => {
  const btnDownload = document.getElementById("btn-download-apk");
  if (btnDownload) btnDownload.style.display = "none";
  showToast("ProgressShelf installed successfully!", "success");
});
