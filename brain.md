# ProgressShelf Architecture & Blueprint

ProgressShelf is a personal progress tracking dashboard. It allows users to track custom habits, checklist trackers, reading goals, levels, and notes in real-time, visualized through animated progress bars. It features a fully offline-capable sandbox, dynamic responsive layout spacing, and live synchronization with Google Cloud Firestore.

---

## 1. Directory Structure

```text
ProgressShelf/
├── index.html            # Landing / sign-in screen
├── dashboard.html        # Core application dashboard interface
├── index.css             # Main styling system, themes, and layouts
├── app.js                # Core frontend client logic and DOM controller
├── auth.js               # Firebase authentication & guest/sandbox router
├── db.js                 # Unified database layer (Firestore + LocalStorage mock)
├── login.js              # Landing page auth logic & startup SW registration
├── sw.js                 # PWA service worker (offline shell caching)
├── manifest.json         # PWA app manifest configuration
├── logo.svg              # SVG vector logo asset
└── favicon.svg           # Website tab icon
```

---

## 2. Core Technologies

1. **Frontend Structure & Layout:** Pure HTML5 structure, semantic elements, and native CSS custom properties.
2. **Styling & Aesthetics:** Dark theme matching GitHub’s color palette. Uses CSS variables for color palettes, Outfit typography, glassmorphism (`backdrop-filter`), smooth transitions, and glossy visual animations (e.g. `.pulse-glow` for recent changes).
3. **Database Layer:** Dual-mode persistence:
   - **Cloud Mode:** Firebase Firestore real-time collection updates.
   - **Sandbox Mode:** LocalStorage mock state database with custom array-observer registers.
4. **Authentication:** Firebase Client SDK for Google Auth Popup with automatic local Sandbox redirects if configuration credentials are empty.
5. **Mobile PWA:** PWA manifest registration, cache-first Service Worker cache invalidation (`v10`+), mobile install capability, and mobile back button (`popstate`) gesture interception.
6. **Strict Security Posture:** Content Security Policy (CSP) implementation via meta tags to mitigate XSS vectors. Direct elimination of all inline scripting (fully externalized code assets).
7. **Accessibility (a11y):** Screen-reader indicators (`aria-pressed`) mapped dynamically to layout actions and segmented statistics buttons.

---

## 3. Data Models

### Tracker / Bar Object Schema
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
  deadlineAt?: number | null;    // Epoch timestamp in milliseconds for absolute deadlines
  deadlineSetAt?: number | null; // Epoch timestamp when the deadline was set
  lastUpdated: number;     // Epoch timestamp of last local/server mutation
}

interface ChecklistItem {
  id: string;              // Unique item key ('item_timestamp_random')
  text: string;            // Text instruction for item
  done: boolean;           // True if completed
}
```

---

## 4. Key Architectural Workflows

### A. Auth Routing Protocol (`auth.js` -> `initAuthProtection`)
1. On page load, `initAuthProtection` checks configuration credentials:
   - If Firebase config is **missing**: Enter Sandbox Mode. 
     - Guest Mode users or Sandbox Demo users are redirected to `dashboard.html`.
     - Unauthenticated users are redirected to `index.html`.
   - If Firebase config is **active**: Let Firebase SDK query the authentication state.
     - Authenticated users go to `dashboard.html`.
     - Non-authenticated users go to `index.html`.

### B. Sandbox Fallback Database (`db.js`)
If Firebase config is inactive, all database methods (`createBar`, `editBar`, `deleteBar`) call LocalStorage read/write routines. Changes trigger `triggerMockUpdate()`, which dispatches the updated trackers array to registered subscription observer listeners (`subscribeToBars`).

### C. Live Guest Data Migration (`app.js` -> `migrateGuestBarsToFirestore`)
When a guest logs in to a Firebase Cloud account:
1. `app.js` queries Guest LocalStorage bars via `getLocalBars()`.
2. Iterates and calls Firestore `addDoc` to import local items to user’s database collection.
3. Clears local data once migration completes successfully.

### D. Smart DOM Reconciliation (Flicker-Free Live Sync)
To prevent progress tracker cards from resetting SVG animations or flickering when database updates occur (whether locally or synced from other active devices):
- **DOM Diffing Algorithm:** Instead of resetting `cardsGrid.innerHTML = ""`, the controller compares the incoming array with the current DOM state:
  - If a tracker element with `data-bar-id` is missing in the DOM, it is instantiated via `createCardElement(bar)` and inserted at the correct index.
  - If a DOM element has a `data-bar-id` not present in the new array, it is animated out and deleted.
  - If a tracker's data changes, `updateCardInPlace(card, bar)` is called to mutate only modified text nodes, update checkboxes, and transition progress bar widths in-place without redraws.
  - Compares the index order of children in the DOM against the sorted database array, applying `insertBefore` to reorder elements with minimal layout shift.

### E. Dynamic Adaptive Search Layout
- Spacing constraint: Maintains a specific `22.65px` gap from the logo on the left and the Git toolbar link on the right in wide screens.
- **Dynamic Collapse:** Instead of checking fixed layout width media queries, JavaScript measures the width of the `"Search for title..."` placeholder:
  1. Computes the raw font styling of the input and draws the text string on an offscreen HTML5 Canvas context to determine its exact render width (`placeholderWidth`).
  2. Measures available space: `availableWidth = navContainer.clientWidth - logoWidth - toolbarWidth - 45.3px`.
  3. If `availableWidth` falls below `placeholderWidth + 64px` (safety padding and button width), the class `.search-pill-mode` is removed, collapsing it to a 32x32px circular icon-only button.
  4. Keeps the search bar open if the search input has an active query.

### F. Interactive Checklist Builder with Drag Reordering
To reorder items when editing/creating a checklist card:
- Render list items containing text inputs, drag handle buttons, and delete buttons.
- Drag handle elements prevent default scrolling and utilize two reordering engines:
  - **Desktop:** HTML5 Drag & Drop event mapping. The list item `li` has its `draggable` attribute set to `true` on handle `mousedown` and removed on `mouseup`, keeping text inputs interactively selectable.
  - **Mobile:** Touch event listeners (`touchstart`, `touchmove`, `touchend`). On move, it detects hover coordinates using `document.elementFromPoint()`, searches for the closest `.checklist-builder-item` in the list, and shifts the dragged element visually using `insertBefore`.
- On drop or touch release, the array of items is reconstructed by traversing the child nodes in the DOM to preserve the new visual order.

### G. Strict Content Security Policy (CSP) & XSS Mitigation
- Active meta tags declare restrictions on asset sources.
- Script execution requires whitelisted sources (`'self'` and official Google/Firebase domains). Inline scripting is strictly forbidden. 
- Style rendering whitelists local files, dynamic stylesheet hashes, and Google Fonts. Avatars are restricted to Google and Gravatar servers.

### H. Service Worker Lifecycle & Automatic Controller Activation
- Script files (`app.js` and `login.js`) register `sw.js` and subscribe to `updatefound` change states.
- If a new Service Worker compiles, it alerts the user on the dashboard. Once installation finishes, `self.skipWaiting()` is executed.
- The `controllerchange` event triggers an automatic, instant reload (`window.location.reload()`) to force clients onto the latest PWA asset shell caching (`progressshelf-cache-v10`+).

### I. Stats Filter Button Accessibility (a11y)
- Segmented stats tracker buttons toggle custom `aria-pressed="true" | "false"` state tags in-place when user selection changes, allowing screen readers to accurately broadcast active statistics views.

---

## 5. Main Script Function Blueprint (`app.js`)

### Function: `getPlaceholderWidth(input)`
Measures text dimensions dynamically using canvas utility.
- **Parameters:** `input: HTMLInputElement`
- **Returns:** `number` (width of placeholder text in pixels)

### Function: `adjustSearchLayout()`
Dynamically adapts search bar state to screen space.
- **Behavior:**
  - Exits if the mobile overlay class `.expanded` is active.
  - Checks if input has a text value. If true, adds class `.search-pill-mode` and exits.
  - Calculates available container space and compares it against minimum placeholder width + padding.
  - Toggles `.search-pill-mode` class on the container element.

### Function: `createCardElement(bar)`
Builds a fresh card DOM element including custom attributes and action triggers.
- **Parameters:** `bar: ProgressTracker`
- **Returns:** `HTMLElement` (representing a `.card-progress` card)
- **Sub-layouts:**
  - **Goal:** Progress bar + level ratio text (e.g. `Level 1 / 3` or `20%`).
  - **Checklist:** Flex list items + progress bar above inline summary details row (`✓ 2 / 5 done` on left, `40%` on right).
  - **Note:** Large text area. Note text expands/collapses when user clicks "Show more" button.

### Function: `updateCardInPlace(card, bar)`
Mutates an existing card element's properties without replacing the element.
- **Parameters:** `card: HTMLElement`, `bar: ProgressTracker`
- **Behavior:** Updates internal text values, updates progress fill width, edits checkbox elements, and modifies deadline indicators.

### Function: `setupChecklistReordering(listContainer, itemsArray, renderFn, setArrayCallback)`
Wires up desktop and touch-friendly reordering on checklist modal lists.
- **Parameters:**
  - `listContainer: HTMLElement` (the container `<ul>`/`<ol>`)
  - `itemsArray: ChecklistItem[]` (local items array)
  - `renderFn: Function` (rendering list refresh routine)
  - `setArrayCallback: Function` (mutator callback to update state array)
