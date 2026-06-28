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

### D. Sticky Navigation & Stats Pre-Load Skeletons
* **Double-sticky Layout:** The navigation bar is sticky at `top: 0` (desktop height: `56px`, mobile height: `52px`). The stats banner is sticky below it (`top: 57px` on desktop, `top: 51px` on mobile media queries) to prevent any gaps.
* **Stat Skeletons:** The statistics numbers (`#stat-total`, `#stat-deadlines`, etc.) are rendered with a `.stats-skeleton` class on page load, displaying a pulsing animation. As soon as the Firestore subscription yields data, `app.js` strips the skeleton classes and populates the text. If the user has zero trackers, the stats banner fades out automatically.

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

### Function: `updateCardInPlace(card, bar)`
Mutates an existing card element's properties without replacing the element, preventing DOM flickers and preserving active SVG progress transitions.

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
3. **File:** `app.js` -> Update `updateCardInPlace` to handle updating the values for the new layout.
4. **File:** `dashboard.html` -> Add the option elements to the creation and editing modals.

### Moving off GitHub Actions Scheduler to Real-Time Cron
1. **File:** `.github/workflows/notify.yml` -> Delete this file.
2. **Server:** Host `functions/notifier.js` as an endpoint (e.g., Vercel Serverless Function, Google Cloud Function, or Node.js server route) protected by an Authorization header token.
3. **Cron Hook:** Register the endpoint at [cron-job.org](https://cron-job.org) or set up a Google Cloud Scheduler trigger to call your API endpoint exactly every 5 minutes.
