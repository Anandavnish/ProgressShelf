<p align="center">
  <img src="logo.svg" alt="ProgressShelf — Track everything. One bar at a time." width="520" />
</p>

<p align="center">
  <a href="https://anandavnish.github.io/ProgressShelf/">Live Demo</a>
  &nbsp;•&nbsp;
  <a href="https://github.com/Anandavnish/ProgressShelf">GitHub Repo</a>
  &nbsp;•&nbsp;
  <img src="https://img.shields.io/badge/version-v3.0-38BDF8?style=flat-square" alt="v3.0"/>
  &nbsp;•&nbsp;
  <img src="https://img.shields.io/badge/license-MIT-4ADE80?style=flat-square" alt="MIT"/>
</p>

---

**ProgressShelf** is a modern, responsive personal progress tracking dashboard that lets you track habits, courses, readings, custom goals, checklists, and quick notes — all in one place, one animated progress bar at a time.

Built with zero build tools. Runs instantly on any static host.



---

## 🌟 What's New in v3.0

- **Three Tracker Types** — Progress Goal, Task Checklist, and Quick Note cards on one dashboard.
- **Global Search** — Instant live search across all tracker titles from the navbar.
- **Smart Stats Banner** — Filterable summary bar: All, Active Deadlines, Overdue, Completed, and Flexible Goals.
- **Inline Delete Confirmation** — Danger confirmation overlay rendered directly on the card (no modal required).
- **Animated Deadline Border** — A draining SVG border ring around cards with active deadlines, colour-shifting from green to red as time runs out.
- **Show More / Collapse** — Long checklists and notes collapse to a preview with an expandable "Show more" toggle.
- **v2.0 Archived** — The previous stable release is preserved at `versions/v2.0/` and selectable from the version dropdown.

---

## 🌟 Key Features

### 1. Multi-Type Trackers
- **Progress Goal** — Animated progress bar with percentage, target & current values.
- **Task Checklist** — Interactive checkbox list with a completion summary line and inline toggle.
- **Quick Note** — Free-form text note card, collapsible for long content.

### 2. Multi-Level Progress Tracking (Presets & Custom)
- **Built-in Presets**: Lectures, Videos, Problems, Tasks, Pages, Books, Chapters, and Custom.
- **Time Preset**: Multi-level conversion (`Seconds` ➔ `Minutes` ➔ `Hours`).
- **Dynamic Calculation**: Sub-unit conversions are handled automatically (e.g., 90 minutes → 1 hr 30 min).

### 3. Smart Deadlines & Overdue Live Counter ⏱
- **Visual Deadlines**: Set a target date/time or a relative duration ("From now — HH hrs MM min").
- **Dynamic Status Badges**: Live-updating countdown labels (`2 days 3 hrs left` or `Overdue by 45 mins`).
- **Animated SVG Border**: Deadline border ring that drains clockwise and shifts colour from green → red as time runs out.

### 4. Stats Banner & Filtering 📊
- Always-visible summary strip displaying counts for: All Trackers, Active Deadlines, Overdue, Completed, and Flexible Goals (no deadline).
- Click any stat button to instantly filter the dashboard to that category.
- Active filter resets automatically if its count drops to zero.

### 5. Global Search 🔍
- Live search bar in the navbar filters cards by title in real time.
- A helper notification appears when matches exist in other filter categories, with a one-click "Clear filters to view" shortcut.

### 6. Flexible Authentication Modes 🔐
- **Google Sign-In**: Cloud storage synced instantly across all devices via Firebase Auth and Firestore.
- **Local Sandbox (Guest Mode)**: Full functionality without an account. Data persisted in `localStorage` / `sessionStorage`.
- **Automatic Migration**: Starting as Guest and signing in later seamlessly migrates local trackers to the cloud.

### 7. Version Archive Navigation
- Version selector dropdown in the navbar gives instant access to:
  - **v3.0 (Latest)** — Current root-level app.
  - **v2.0 (Stable)** — Deadline & premium UI upgrade; archived at `versions/v2.0/`.
  - **v1.0 (Basic)** — Original minimalist interface; archived at `versions/v1.0/`.

---

## 🎨 Logo

The ProgressShelf logo is a self-contained animated SVG (`logo.svg`) that is also embedded inline in `index.html` and `dashboard.html`. It features:
- **Four colour-coded bar charts** (blue, orange, red, green) rising from a gradient shelf base.
- **A blue `+` icon** — representing the "Add New Tracker" action.
- **A red ⚠ badge** on the red bar — indicating overdue or warning state.
- **A green ✓ badge** on the green bar — indicating completed state.
- **CSS keyframe animations** (identical to the live site):
  - `logoBarPulse` — bars scale vertically 1 → 0.4 → 1, staggered at 0 / 0.15 / 0.30 / 0.45 s delays.
  - `logoPulseGlow` — the `+` icon fades and glows a cyan halo.
  - `logoBadgePulse` — the badges scale 1 → 0.85 → 1 in sync with bar-3 and bar-4.

The `logo.svg` file is fully self-contained (no external CSS or JS dependency) so it animates correctly when rendered by GitHub in the README.

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML5, CSS3, ES6 Modules |
| Auth | Firebase Auth (Google Provider) |
| Database | Cloud Firestore (real-time sync) |
| Offline | `localStorage` / `sessionStorage` (Guest Mode) |
| Hosting | GitHub Pages (zero-build static deploy) |
| Styling | HSL-based dark theme, glassmorphism, CSS animations, flexbox/grid |

---

## 🚀 Getting Started

### Local Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Anandavnish/ProgressShelf.git
   cd ProgressShelf
   ```

2. **Set up Firebase:**
   - Copy `firebase-config.template.js` to `firebase-config.js`.
   - Fill in your Firebase project credentials inside `firebase-config.js`.
   - *(Optional)* Repeat for `versions/v2.0/firebase-config.template.js` and `versions/v1.0/firebase-config.template.js` to enable cloud sync in the archived versions too.

3. **Launch a local web server:**

   Using Python:
   ```bash
   python -m http.server 8000
   ```
   Using Node:
   ```bash
   npx http-server -p 8000
   ```

4. Open your browser at `http://localhost:8000`.

> **Note:** A local server is required because the app uses ES Modules (`type="module"`) which do not work from `file://` paths in most browsers.

---

## 📂 Directory Structure

```text
ProgressShelf/
├── index.html                    # Main landing page (Google sign-in & Guest option)
├── dashboard.html                # v3.0 Dashboard — all tracker types, stats bar, search
├── app.js                        # Dashboard rendering, event logic, deadline animations
├── auth.js                       # Auth routing, guard, guest session management
├── db.js                         # Firestore / localStorage CRUD abstraction layer
├── firebase-config.js            # Firebase app init & isConfigured flag (gitignored)
├── firebase-config.template.js   # Public template for cloners
├── index.css                     # Global design system — tokens, components, animations
├── logo.svg                      # Animated standalone SVG logo (used in README)
├── .nojekyll                     # Tells GitHub Pages to serve files as-is (no Jekyll)
├── .gitignore                    # Excludes firebase-config.js from source control
├── PROJECT_REPORT.md             # Architecture & development history deep-dive
├── README.md                     # This file
└── versions/
    ├── v1.0/                     # v1.0 (Basic) — self-contained archive
    │   ├── index.html
    │   ├── dashboard.html
    │   ├── app.js
    │   ├── auth.js
    │   ├── db.js
    │   ├── firebase-config.js
    │   ├── firebase-config.template.js
    │   └── index.css
    └── v2.0/                     # v2.0 (Stable) — deadlines & premium UI archive
        ├── index.html
        ├── dashboard.html
        ├── app.js
        ├── auth.js
        ├── db.js
        ├── firebase-config.js
        ├── firebase-config.template.js
        └── index.css
```

---

## 🔒 Security Notes

- `firebase-config.js` is listed in `.gitignore` and never committed — keeping your Firebase API keys private.
- Firebase Security Rules restrict Firestore read/write access strictly to the authenticated document owner.
- Guest mode data is fully isolated in the browser's `localStorage` — never sent to any server.
- No ads, no analytics, no third-party tracking of any kind.

---

## 🗺 Version History

| Version | Status | Highlights |
|---|---|---|
| **v3.0** | ✅ Latest (root) | Checklist & Note tracker types, Stats banner, Global search, Inline delete, Animated deadline SVG border |
| **v2.0** | 🗂 Stable (archived) | Deadlines, live overdue counter, glassmorphic UI overhaul |
| **v1.0** | 🗂 Basic (archived) | Single-level progress bars, Guest mode, Firebase auth |

---

## 📄 License

This project is open-source and available under the **MIT License**.

---

*Built by [Anand Avnish](https://github.com/Anandavnish) with AI assistance (Antigravity, Claude & Gemini).*
