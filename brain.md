# ProgressShelf Architecture & Blueprint

ProgressShelf is a personal progress tracking PWA (Progressive Web App). It allows users to track custom habits, checklist trackers, reading goals, levels, and notes in real-time, visualized through animated progress bars. It features a fully offline-capable sandbox, dynamic responsive layout spacing, and live synchronization with Google Cloud Firestore.

---

## 1. Directory Structure

```text
ProgressShelf/
├── .github/
│   └── workflows/
│       ├── deploy.yml         # GitHub Pages automated deployment workflow
│       ├── notify.yml         # Scheduled background checker (runs notifier.js)
│       └── test-notify.yml    # Manual test diagnostic push notification trigger
├── functions/
│   ├── package.json          # Node dependencies for server-side runners
│   ├── notifier.js           # Production scheduled database checker & push dispatcher
│   └── test-notify.js        # Diagnostic runner to test client token delivery
├── index.html                # Landing / sign-in screen
├── dashboard.html            # Core application dashboard interface
├── index.css                 # Main styling system, responsive variables, animations
├── app.js                    # Core frontend client logic and DOM controller
├── auth.js                   # Firebase authentication & guest/sandbox router
├── db.js                     # Unified database layer (Firestore + LocalStorage mock)
├── login.js                  # Landing page auth logic & startup SW registration
├── sw.js                     # Unified service worker (offline cache + FCM messaging)
├── manifest.json             # PWA app manifest configuration
├── logo.svg                  # SVG vector logo asset (with text)
├── favicon.svg               # Website tab icon (graphic only, rectangular)
├── icon-192.png              # Square textless PWA launcher icon (192x192)
└── icon-512.png              # Square textless PWA launcher icon (512x512)
```

---

## 2. Core Technologies

1. **Frontend Structure & Layout:** Pure HTML5 structure, semantic markup, and native CSS custom properties.
2. **Styling & Aesthetics:** Dark theme matching GitHub’s color palette. Uses CSS variables for color palettes, Outfit typography, glassmorphism (`backdrop-filter`), smooth transitions, and glossy visual animations (e.g. `.pulse-glow` for recent changes).
3. **Database Layer:** Dual-mode persistence:
   - **Cloud Mode:** Firebase Firestore real-time collection updates.
   - **Sandbox Mode:** LocalStorage mock state database with custom array-observer registers.
4. **Authentication:** Firebase Client SDK for Google Auth Popup with automatic local Sandbox redirects if configuration credentials are empty.
5. **Mobile PWA:** PWA manifest registration, cache-first Service Worker cache invalidation (`v30`+), mobile install capability, and mobile back button (`popstate`) gesture interception.
6. **Strict Security Posture:** Content Security Policy (CSP) implementation via meta tags to mitigate XSS vectors. Direct elimination of all inline scripting (fully externalized code assets).
7. **Accessibility (a11y):** Screen-reader indicators (`aria-pressed`) mapped dynamically to layout actions and segmented statistics buttons.

---

## 3. Data Models

### A. Tracker / Bar Object Schema
```typescript
interface ProgressTracker {
  id: string;              // Auto-generated ID ('bar_timestamp_random')
  title: string;           // Title text of the tracker card
  type: 'goal' | 'checklist' | 'note'; // Tracker category type
  preset?: string | null;  // Type of metric preset (e.g. "books", "custom", "percent")
  levels?: string[] | null;// Optional names for levels (e.g., ['Level 1', 'Level 2'])
  targetSmallest: number;  // The maximum raw numeric goal value (levels count or range limit)
  currentSmallest: number; // The current raw progress value
  items?: ChecklistItem[]; // Checklist items list (only if type === 'checklist')
  text?: string;           // Large note field contents (only if type === 'note')
  completed: boolean;      // True if progress is 100% or checklist is fully checked
  deadlineAt?: Date | null;    // Firestore Timestamp (Cloud) or number (Sandbox) for deadlines
  deadlineSetAt?: Date | null; // Firestore Timestamp (Cloud) or number (Sandbox) when set
  notifyAt?: number | null;    // JS Number epoch ms representing calculated trigger time
  notified: boolean;           // True if push notification has already been triggered
  notifyPercent?: number | null; // Selected percentage remaining for Mode B alerts
  lastUpdated: Date | number;  // Firestore Timestamp or number epoch ms of last mutation
}

interface ChecklistItem {
  id: string;              // Unique item key ('item_timestamp_random')
  text: string;            // Text instruction for item
  done: boolean;           // True if completed
}
```

### B. Device Registration Schema
FCM tokens are stored as separate documents inside a subcollection under each user to support multi-device delivery.
* **Path:** `/users/{userId}/fcmTokens/{token}`
```typescript
interface DeviceToken {
  token: string;           // Raw FCM registration token string
  updatedAt: Timestamp;    // Server-side timestamp indicating last registration
}
```

---

## 4. Key Architectural Workflows

### A. Unified Service Worker & Update Loop
To prevent scope conflicts, all caching and push notification functions are consolidated inside a single Service Worker file (`sw.js`).
1. **Consolidation:** `firebase-messaging-sw.js` was deleted to prevent scope wars. `sw.js` imports Firebase Compat SDKs via `importScripts()` and handles background notifications.
2. **Page Loading:** When the app initializes, it registers `sw.js`.
3. **FCM Capturing:** `app.js` contacts Firebase Messaging using the active registration from `navigator.serviceWorker.ready`. This ensures VAPID checks leverage the main running worker, eliminating 404 pathing problems in subdirectory hosting (like GitHub Pages `/ProgressShelf/`).
4. **Auto-reload loop prevention:** By running a single service worker, we avoid the infinite scope replacement loop that previously triggered constant `controllerchange` events.

### B. Multi-Device Push Notification Pipeline
1. **Registration:** Every device (phone, laptop, tablet) registers its unique token in the Firestore subcollection `/users/{userId}/fcmTokens/{token}`.
2. **Scheduler Execution:** The scheduled runner (`notifier.js`) queries `/users/{userId}/fcmTokens` to fetch all active devices.
3. **Simultaneous Delivery:** The push message is delivered to all device tokens. If a token returns a `messaging/invalid-registration-token` or `messaging/registration-token-not-registered` error, the runner automatically deletes that specific document from Firestore, keeping the database clean.
4. **Sign-out Cleanup:** When the user clicks **Sign Out**, the app retrieves `ps_fcm_token` from `localStorage`, deletes that specific device document from Firestore, clears local cache, and signs out. This prevents push alerts from delivering to logged-out browser sessions.

### C. Live Query & Diagnostics Architecture
The scheduled runner (`notifier.js`) is designed to query all trackers where `notifyAt <= now + 5 minutes` and `notified !== true`. This catches overdue alerts even if the GitHub Actions cron is delayed.
* **Self-Healing Diagnostics:** If the scheduler queries the database and finds zero due trackers, it immediately executes an unfiltered collection group query to print a list of all trackers in your database, along with their `notifyAt`, `notified`, and `completed` fields inside the GitHub actions console log. This allows you to check active tracker states without creating mock datasets.

### D. Triple-Sticky Staggered Scroll-to-Hide Layout & Pre-Load Skeletons
* **Triple-Sticky Staggered Layout:** The navigation bar is sticky at `top: 0` (desktop height: `56px`, mobile height: `52px`). The stats banner is sticky below it (`top: var(--navbar-height)`), and the dashboard controls are sticky below that (`top: calc(var(--navbar-height) + var(--stats-height) - 2px)`).
* **Scroll-to-Hide Controller:** On scroll, headers are dynamically translated to slide out of view. Scrolling down hides the Dashboard Controls first, then the Stats Banner. Scrolling up reveals the Stats Banner first, then the Dashboard Controls. This is throttled via `requestAnimationFrame` for performance.
* **Subpixel Gap Protection:** Height dimensions are measured dynamically using `getBoundingClientRect().height` for floating-point subpixel accuracy. Additionally, a `2px` negative top margin and matching sticky offset are applied to `.dashboard-controls` to overlap `.stats-banner`, preventing any scrolling cards from showing through subpixel gaps on high-DPI screens.
* **Edit Mode Stationary Hold:** The scroll-to-hide controller is completely disabled when `editModeActive` is true, forcing all controls to be fully revealed and stationary to ensure action buttons are always accessible.
* **Stat Skeletons:** The statistics numbers (`#stat-total`, `#stat-deadlines`, etc.) are rendered with a `.stats-skeleton` class on page load, displaying a pulsing animation. As soon as the Firestore subscription yields data, `app.js` strips the skeleton classes and populates the text. If the user has zero trackers, the stats banner fades out automatically.

### E. Card Selection Border Feedback
To maximize screen real estate and reduce layout shifting, standard checkbox selections have been removed. Instead, selected cards receive a `2px` inset/outset border ring (`box-shadow: 0 0 0 2px var(--accent)`) and a glowing background drop shadow. When one or more cards are selected, all non-selected cards are automatically dimmed to `0.45` opacity to create visual focus.

### E. PWA Launcher Icon Scaling & Centering
To meet PWA install guidelines and ensure mobile launcher compatibility:
1. **No Text:** The launcher icons (`icon-192.png` and `icon-512.png`) omit all "ProgressShelf" lettering, focusing exclusively on the vector bar shelf graphic to optimize clarity on mobile homescreens.
2. **Aspect Ratio Preservation:** PWA icons are strictly square (`1:1`). Since the raw shelf graphic features a wider aspect ratio, the icons are programmatically rendered onto a solid `#0D1117` background with built-in top/bottom padding to prevent any squeezing or stretching.

---

## 5. Main Script Function Blueprint (`app.js`)

### Function: `getPlaceholderWidth(input)`
Measures text dimensions dynamically using a virtual canvas context to determine when the search input needs to collapse into an icon-only mode.
- **Parameters:** `input: HTMLInputElement`
- **Returns:** `number` (width of placeholder text in pixels)

### Function: `adjustSearchLayout()`
Dynamically adjusts search bar width and styling depending on layout container width. If available container space drops below placeholder text requirements, it collapses to a circular button.

### Function: `createCardElement(bar)`
Builds a fresh card DOM element including custom attributes, progress fills, and checkbox list reordering listeners.
- **Parameters:** `bar: ProgressTracker`
- **Returns:** `HTMLElement` (representing a `.card-progress` card)

### Function: `updateCardElement(card, bar)`
Mutates an existing card element's properties without replacing the element, preventing DOM flickers and preserving active SVG progress transitions.

### Function: `setupStaggeredHeaderScroll()`
Orchestrates the scroll-to-hide staggered transition of the Stats Banner and Dashboard Controls. Listens to window scroll events using a requestAnimationFrame-throttled controller, applying calculated transforms to hide and show headers based on scroll direction. In Edit Mode, it forces headers to remain visible and stationary.

### Function: `setupChecklistReordering(listContainer, itemsArray, renderFn, setArrayCallback)`
Configures HTML5 drag-and-drop on desktops and touch event element reordering on mobile screens.

### Function: `calculateNotifyAt(prefix)`
Computes the notification epoch millisecond timestamp based on selected Mode A (Fixed time) or Mode B (Percentage of time left) inputs.
- **Parameters:** `prefix: string` ("" or "edit-")
- **Returns:** `{ notifyAt: number | null, isValid: boolean, errorMsg: string | null }`

### Function: `updateNotificationPreview(prefix)`
Toggles input locks and renders calculated date/time text or range validation error warnings below the inputs in real time.

### Function: `handleFCMSession(uid)`
Verifies browser notification permission. If granted, retrieves the registration token from `navigator.serviceWorker.ready` and saves it to Firestore.

---

## 6. Developer Upgrade Reference Checklist

When adding features or upgrading ProgressShelf, use this guide to locate target files:

### Changing Database Providers (e.g. migrating to Supabase)
1. **File:** `firebase-config.js` -> Replace with Supabase client initialization.
2. **File:** `auth.js` -> Replace Google Auth Popup and session protection listeners with Supabase GoTrue equivalents.
3. **File:** `db.js` -> Replace Firestore queries (`collection`, `addDoc`, `updateDoc`, `onSnapshot`) with Supabase client filters and subscriptions.
4. **File:** `functions/notifier.js` -> Change the background scheduler script to query the database using the Postgres client and push to FCM using firebase-admin.

### Adding a New Tracker Type (e.g. Time Tracking)
1. **File:** `brain.md` -> Update the data model schema options for the `type` field.
2. **File:** `app.js` -> Update `createCardElement` to add formatting layout templates for the new type.
3. **File:** `app.js` -> Update `updateCardElement` to handle updating the values for the new layout.
4. **File:** `dashboard.html` -> Add the option elements to the creation and editing modals.

### Moving off GitHub Actions Scheduler to Real-Time Cron
1. **File:** `.github/workflows/notify.yml` -> Delete this file.
2. **Server:** Host `functions/notifier.js` as an endpoint (e.g., Vercel Serverless Function, Google Cloud Function, or Node.js server route) protected by an Authorization header token.
3. **Cron Hook:** Register the endpoint at [cron-job.org](https://cron-job.org) or set up a Google Cloud Scheduler trigger to call your API endpoint exactly every 5 minutes.

---

## 7. Card Layout, Dimensions, and Click Architectures

### A. Core Card Geometry & Stretch Logic
1. **Dimensions**: Standard cards (`.card-progress`) are styled with `min-height: 180px` and `height: auto`.
2. **CSS Grid Alignment**: Cards are laid out inside a grid wrapper (`.cards-grid`) with `display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));`. By nature of CSS Grid, all cards residing in the same row auto-stretch to perfectly match the height of the tallest card in that row.
3. **Internal Spacing**: Height allocation inside the card is calculated dynamically as:
   $$\text{maxAvailableHeight} = \text{cardHeight} - \text{usedHeight} - 12\text{px}$$
   Where $\text{usedHeight}$ is the sum of vertical paddings ($48\text{px}$), the card title container height ($38\text{px}\text{ to }58\text{px}$), margins, progress wraps, divider rules, and deadline warning badges.

### B. note Card - Show More & Click Rules
1. **Truncation Calculation**: A note card is considered "short" (does not require a Show More button) if its natural content size `textEl.scrollHeight` fits within either:
   - The absolute standard limit ($96\text{px}$, or about 4 lines of text).
   - The row's current stretched space (`maxAvailableHeight + 6px` tolerance).
2. **Dynamic UI Rendering**:
   - **Short notes:** Forced to collapse automatically (removes `.expanded` classes and deletes the entry from `expandedCardIds`), displaying fully (`max-height: none`) and hiding both Show More/Less buttons.
   - **Genuinely truncated notes:** Clamped using CSS line-clamps. If collapsed, shows "Show more". If expanded, shows "Collapse".
3. **Card Click Handling**:
   - **1st Click on Short Note:** Instantly opens the **Update Progress Modal**.
   - **1st Click on Long Note:** Triggers expand/collapse mechanism to fully reveal text.
   - **2nd Click on Long Note:** Since the card is already expanded, clicking it opens the **Update Progress Modal**.

### C. checklist Card - Show More & Click Rules
1. **Truncation Calculation**: A checklist is short if the total list item count is $\le 3$.
2. **Dynamic UI Rendering**:
   - **Short checklists:** Forced to collapse automatically, rendering all items fully without any Show More/Less button display.
   - **Long checklists:** Displays at least 3 items, showing a "Show more (+count)" button indicating hidden checklist elements.
3. **Card Click & Checkbox Interactions**:
   - **Edit Modal Disabled:** The edit button is hidden (`display: none`) and click events are completely blocked for checklist cards. Users update checklist items directly on the dashboard card.
   - **Short Checklists:** Checkboxes are instantly responsive; clicking a checkbox toggles its state and writes directly to the database.
   - **Long Checklists:**
     - **1st Click:** Expands the card to reveal the hidden items.
     - **Subsequent Clicks:** Direct interaction with checkboxes updates checked/unchecked states and saves database changes immediately.

### D. goal Card (Deadline Tracker) - Click Rules
1. **Geometry**: Deadline tracker cards have a simple visual composition (title, percentage circle/bar, deadline countdown timer) with no content to truncate, expand, or collapse.
2. **Click Handling**: The very first click on the card instantly triggers the **Update Progress Modal** to modify raw numeric goals, levels, or conversion values.
