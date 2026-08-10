# ProgressShelf Architecture & Blueprint

ProgressShelf is a personal progress tracking PWA (Progressive Web App). It allows users to track custom habits, checklist trackers, reading goals, levels, and notes in real-time, visualized through animated progress bars. It features a fully offline-capable sandbox, dynamic responsive layout spacing, daily habit auto-repeats with intelligent cycle states, and live synchronization with Supabase PostgreSQL.

---

## 1. Directory Structure

```text
ProgressShelf/
├── .github/
│   └── workflows/
│       ├── deploy.yml            # GitHub Pages automated deployment workflow (with secrets)
│       └── test-notify.yml       # Manual test diagnostic push notification trigger
├── functions/
│   ├── package.json             # Node dependencies for server-side runners
│   ├── notifier.js              # Production scheduled database checker & push dispatcher
│   └── test-notify.js           # Diagnostic runner to test client token delivery
├── supabase/
│   ├── schema.sql               # Supabase PostgreSQL schema with RLS policies & repeat JSONB
│   └── functions/
│       └── notify/
│           └── index.ts         # Supabase Edge Function for automated FCM notifications
├── versions/
│   ├── v1.0/                    # v1.0 (Basic) — self-contained archive (Firebase)
│   ├── v2.0/                    # v2.0 (Stable) — deadlines & visual indicators (Firebase)
│   ├── v3.0/                    # v3.0 (Stats) — stats banner & multi-card formats (Firebase)
│   └── v4.0/                    # v4.0 (Supabase) — Supabase backend migration archive
├── index.html                   # Landing / sign-in screen (Supabase Google Auth & Sandbox)
├── dashboard.html               # Core application dashboard interface (v4.3 Latest)
├── about.html                   # About ProgressShelf & feature guide with Markdown renderer
├── reset-password.html          # Supabase password reset handler page
├── reset-password.js            # Password recovery client controller
├── index.css                    # Main design system, glassmorphism, responsive variables, animations
├── app.js                       # Core frontend client logic, DOM controller, auto-resets & drag-drop
├── auth.js                      # Supabase authentication & guest/sandbox router
├── db.js                        # Unified database layer (Supabase Client + LocalStorage mock)
├── login.js                     # Landing page auth logic & startup SW registration
├── sw.js                        # Unified service worker (offline cache v183+ & FCM messaging)
├── manifest.json                # PWA app manifest configuration
├── logo.svg                     # SVG vector logo asset (with text)
├── favicon.svg                  # Website tab icon (graphic only, rectangular)
├── badge.png                    # Android monochrome status bar notification badge (transparent PNG)
├── badge.svg                    # Vector source for status bar notification badge
├── icon-192.png                 # Square textless PWA launcher icon (192x192)
├── icon-512.png                 # Square textless PWA launcher icon (512x512)
├── firebase-config.example.js   # Template for Firebase FCM client configuration
├── firebase-config.js           # Local Firebase FCM config credentials (gitignored)
├── supabase-config.js           # Local Supabase DB client configuration (gitignored)
├── brain.md                     # Comprehensive project architecture, data models & blueprints
├── PROJECT_REPORT.md            # Architectural report and project history
├── fcm_notifications_report.md  # FCM push notification system report & debugging guide
└── README.md                    # Project documentation, setup guide & release changelog
```

---

## 2. Core Technologies

1. **Frontend Structure & Layout:** Pure HTML5 structure, semantic markup, and native CSS custom properties with zero build dependencies.
2. **Styling & Aesthetics:** Dark theme matching GitHub’s color palette with customizable dynamic accent palettes. Uses CSS variables, Outfit & Lora typography, deep glassmorphism (`backdrop-filter: blur(48px)` on dropdowns), smooth cubic-bezier transitions, and glowing visual animations.
3. **Database Layer:** Dual-mode persistence:
   - **Cloud Mode:** Supabase PostgreSQL real-time table subscriptions with Row Level Security (RLS).
   - **Sandbox Mode:** LocalStorage mock state database with custom array-observer registers.
4. **Authentication:** Supabase Auth Client for Google OAuth and email login with automatic local Sandbox redirects if configuration credentials are empty.
5. **Mobile PWA:** PWA manifest registration, cache-first Service Worker cache invalidation (`v183`+), mobile install capability, and mobile back button (`popstate`) gesture interception.
6. **Strict Security Posture:** Content Security Policy (CSP) implementation via meta tags to mitigate XSS vectors. Direct elimination of all inline scripting (fully externalized code assets). Private API keys isolated in gitignored configuration files.
7. **Accessibility (a11y):** Screen-reader indicators (`aria-pressed`, `aria-expanded`) mapped dynamically to layout actions, theme pickers, and segmented statistics buttons.

---

## 3. Data Models

### A. Tracker / Bar Object Schema
```typescript
interface ProgressTracker {
  id: string;                    // Auto-generated ID ('bar_timestamp_random')
  title: string;                 // Title text of the tracker card
  type: 'goal' | 'checklist' | 'note'; // Tracker category type
  preset?: string | null;        // Type of metric preset (e.g. "books", "custom", "time", "percent")
  levels?: string[] | null;      // Optional names for levels (e.g., ['Level 1', 'Level 2'])
  targetSmallest: number;        // The maximum raw numeric goal value (levels count or range limit)
  currentSmallest: number;       // The current raw progress value
  items?: ChecklistItem[];       // Checklist items list (only if type === 'checklist')
  text?: string;                 // Large note field contents (only if type === 'note')
  completed: boolean;            // True if progress is 100% or checklist is fully checked
  deadlineAt?: Date | string | null;    // ISO string (Cloud) or epoch ms (Sandbox) for deadlines
  deadlineSetAt?: Date | string | null; // ISO string (Cloud) or epoch ms (Sandbox) when set
  notifyAt?: number | null;      // JS Number epoch ms representing calculated trigger time
  notified: boolean;             // True if push notification has already been triggered
  notifyPercent?: number | null; // Selected percentage remaining for Mode B alerts
  alertAtDeadline?: boolean;     // True if alert should trigger at exact deadline
  deadlineNotified?: boolean;    // True if deadline push notification has triggered
  position?: number;             // Reordering index for drag & drop card arrangement
  repeat?: RepeatConfig | null;  // Auto-repeat / auto-renew configuration
  lastUpdated: Date | string | number; // ISO string or number epoch ms of last mutation
}

interface ChecklistItem {
  id: string;                    // Unique item key ('item_timestamp_random')
  text: string;                  // Text instruction for item
  done: boolean;                 // True if completed
}

interface RepeatConfig {
  resetTime?: string | null;          // HH:MM 24-hr format (e.g. "06:00")
  resetCount?: number | null;         // Number of repeat cycles remaining, or null for indefinite
  checklistResetEnabled?: boolean;   // Whether checklist items should uncheck automatically on cycle
  deadlineResetEnabled?: boolean;    // Whether deadline should advance automatically on cycle
  lastResetAt?: Date | string | number | null; // Timestamp of the most recent reset execution
}
```

### B. User Settings & Device Registration Schema
User settings and preferences (accent color, custom palette, font family) and FCM tokens are persisted in Supabase:
```typescript
interface UserSettings {
  user_id: string;               // Auth user UUID
  accent_color?: string;         // Active hex accent color
  custom_accents?: string[];     // User-saved custom hex swatches (up to 4)
  font_family?: 'outfit' | 'space-mono' | 'jetbrains-mono'; // Chosen global typography
  preferred_sort?: string;       // Saved sort filter
  updated_at: string;
}

interface DeviceToken {
  id: string;                    // Supabase row UUID
  user_id: string;               // Auth user UUID
  token: string;                 // Raw FCM registration token string
  updated_at: string;            // Server-side timestamp indicating last registration
}
```

---

## 4. Key Architectural Workflows

### A. Typography & Font Customization Engine
ProgressShelf allows users to switch the app's entire typeface dynamically:
1. **Font Options**:
   - **Default (Outfit)**: Clean, modern geometric sans-serif (`'Outfit', sans-serif`).
   - **Space Mono**: Bold, stylized neo-brutalist monospace typeface (`'Space Mono', monospace` — inspired by Smash.am).
   - **JetBrains Mono**: Sleek developer monospace typeface (`'JetBrains Mono', monospace`).
2. **Zero-FOUT (Flash of Unstyled Text) Execution**:
   - An inline script in `<head>` runs synchronously before DOM paint, reading `localStorage['app-font-family']` and immediately binding `--font-family` and matching class (`font-outfit`, `font-space-mono`, `font-jetbrains-mono`).
3. **Cross-Device Real-Time Sync**:
   - Choosing a font updates `localStorage` and triggers `updateUserFontPreference(fontId)`, writing to Supabase `user_settings`. All other open sessions receive real-time postgres updates via `subscribeToUserSettings()` and update instantly.

### B. Auto-Repeat & Reset System (Pending Renewal vs Soft Reset)
ProgressShelf supports automated daily recurring routines for both checklists and deadlines:
1. **Reset Trigger & Evaluation Loop:** The client evaluates active trackers periodically (on page load, ticking intervals, visibility change, and real-time subscription events) via `evaluateAutoResets()`.
2. **Case 1: Pending Renewal State (`.pending-renewal`)**:
   - When a tracker has a deadline that has expired (`now > deadlineAt`) with auto-renew enabled, the deadline does not arbitrarily jump forward instantly.
   - Instead, the card enters the **Pending Renewal** state: it displays a glowing amber border (`--color-pending-renew: #F59E0B`), an amber pulsing status badge (`Pending reset at HH:MM`), and holds state until the configured `resetTime` is reached.
   - Once `resetTime` arrives, the deadline shifts forward by 24 hours (or matching daily interval), checklist items uncheck, and `resetCount` decrements.
3. **Case 2: Soft Reset State (`.pending-reset-soft`)**:
   - When a user checks off all items in a checklist or completes a goal *before* the deadline arrives (`completed === true`), the card enters the **Soft Reset** state.
   - It is styled with a calm sky blue border (`--color-pending-reset-soft: #0EA5E9`) and steady status badge (`Reset at HH:MM`), signaling that today's routine is accomplished and waiting for the next daily cycle.
4. **Cycle Limit & Indefinite Repeats**:
   - If `resetCount` is specified (e.g. 7), each reset cycle decrements the count by 1. When `resetCount === 0`, `repeat` is cleared.
   - If `resetCount` is `null` or omitted, the card repeats indefinitely every day.

### B. Unified Service Worker & Offline Caching
To eliminate scope conflicts and cache mismatch bugs:
1. **Consolidation:** All static asset caching and FCM background push handling are consolidated in `sw.js`.
2. **Cache Invalidation:** The cache version (`CACHE_NAME = 'progressshelf-cache-v183'`) updates with each release, automatically purging outdated network assets.
3. **PWA Integration:** Listens to `beforeinstallprompt` to present native-like installation options on mobile and desktop devices.

### C. Triple-Sticky Staggered Scroll-to-Hide Layout & Glassmorphism
* **Staggered Layout:** The navigation bar is sticky at `top: 0`, stats banner below it (`top: var(--navbar-height)`), and dashboard controls row below that (`top: calc(var(--navbar-height) + var(--stats-height) - 2px)`).
* **Scroll-to-Hide Controller:** On scroll down, controls hide first, followed by stats. On scroll up, stats appear first, followed by controls. Throttled via `requestAnimationFrame`.
* **Deep Glassmorphism:** Dropdowns and overlays use `backdrop-filter: blur(48px)` with 70% opacity in light mode for crystal-clear readability and contrast.
* **Full-Width Stretch:** Dashboard controls stretch smoothly to full viewport width on widescreen displays.

### D. Card Selection Border Feedback
* Selected cards receive a `2px` border ring (`box-shadow: 0 0 0 2px var(--accent)`) and glowing drop shadow.
* When one or more cards are selected, all non-selected cards are dimmed to `0.45` opacity to maintain focus.

---

## 5. Main Script Function Blueprint (`app.js`)

### Function: `evaluateAutoResets(bars, uid)`
Scans all trackers for active repeat configurations (`bar.repeat`). Calculates whether the current time has passed the scheduled `resetTime` relative to `lastResetAt`. Applies resets to checklists and deadlines, updates `resetCount`, and commits updates to Supabase / LocalStorage.

### Function: `getCardResetStatus(bar)`
Determines the current visual cycle state for a card:
- Returns `'pending-renewal'` (amber) if deadline has elapsed and card is waiting for daily reset time.
- Returns `'pending-reset-soft'` (sky blue) if checklist/goal is complete before deadline.
- Returns `null` if standard deadline countdown or no repeat active.

### Function: `createCardElement(bar)`
Builds a fresh card DOM element including custom attributes, drain-border SVG geometry, reset badges, and drag-and-drop handles.

### Function: `updateCardElement(card, bar)`
Mutates an existing card element's properties in place without replacing the DOM node, preserving active animations and SVG transitions.

### Function: `setupStaggeredHeaderScroll()`
Orchestrates the scroll-to-hide staggered transition of the Stats Banner and Dashboard Controls. In Edit Mode, headers remain visible and stationary.

---

## 6. Developer Upgrade Reference Checklist

### Adding New Reset Schedule Options (e.g. Weekly / Monthly Resets)
1. **File:** `brain.md` -> Update `RepeatConfig` schema with `frequency: 'daily' | 'weekly' | 'monthly'`.
2. **File:** `dashboard.html` -> Add frequency selector radios to modal `#create-reset-settings-content` and `#edit-reset-settings-content`.
3. **File:** `app.js` -> Update `evaluateAutoResets()` to compute weekly/monthly interval deltas.
4. **File:** `db.js` -> Ensure serialization handles the new repeat frequency properties.

---

## 7. Card Layout, Dimensions, and Click Architectures

### A. note Card - Show More & Click Rules
1. **Truncation Calculation**: Notes exceeding available vertical space or 4 lines of text show a "Show more" button.
2. **Card Click Handling**: First click on short note opens modal; first click on long note expands text; second click on expanded note opens edit modal.

### B. checklist Card - Show More & Checkbox Rules
1. **Truncation Calculation**: Checklists with $\le 3$ items are short and display fully. Checklists with $> 3$ items show "Show more (+count)".
2. **Direct Interactions**: Checkbox clicks toggle state immediately and sync to Supabase/LocalStorage without opening a modal.

### C. goal Card (Deadline Tracker) - Click Rules
1. **Click Handling**: Clicking the card opens the Update Progress Modal to modify numeric goals or levels.

