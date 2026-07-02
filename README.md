<p align="center">
  <img src="logo.svg" alt="ProgressShelf — Track everything. One bar at a time." width="520" />
</p>

<p align="center">
  <a href="https://anandavnish.github.io/ProgressShelf/">Live Demo</a>
  &nbsp;•&nbsp;
  <a href="https://github.com/Anandavnish/ProgressShelf">GitHub Repo</a>
  &nbsp;•&nbsp;
  <img src="https://img.shields.io/badge/version-v4.0-38BDF8?style=flat-square" alt="v4.0"/>
  &nbsp;•&nbsp;
  <img src="https://img.shields.io/badge/license-MIT-4ADE80?style=flat-square" alt="MIT"/>
</p>

---

**ProgressShelf** is a modern, responsive personal progress tracking dashboard that lets you track habits, courses, readings, custom goals, checklists, and quick notes — all in one place, one animated progress bar at a time.

Built with zero build tools. Runs instantly on any static host.

---

## 🌟 What's New in v4.0

- **Supabase Backend Migration** — Fully migrated authentication and database management from Firebase to **Supabase**. Secure data is fetched directly using Supabase client libraries under strict Row Level Security (RLS) policies.
- **Dynamic Controls Dashboard** — Added a layout controls bar right below the stats banner, offering quick access to version selection, GitHub repository links, manual Service Worker refresh, and bulk edit actions.
- **Bulk Deletion Manager** — Select multiple progress cards, checklists, or notes to delete them in one single batch. Repurposes the sort selection container dynamically to display the selected count and handle the bulk action.
- **Terrace Updates Overlay** — Built a beautiful, glassmorphic Updates overlay screen ("Terrace") displaying the detailed release changelog from v1.0 to v4.0. Supports native-like mobile back gesture navigation using the HTML5 History API.
- **Sequential Scrolling Headers** — Scrolling down auto-hides headers sequentially (Controls row ➔ Stats banner ➔ Mobile subbar) to maximize screen space on phones. Scrolling up reveals them in reverse order.
- **Resilient Config Extraction** — Extracted private keys and API credentials into gitignored files (`supabase-config.js` and `firebase-config.js`) to secure the project and completely resolve GitHub Secret Scanning Alerts.

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
- **Animated SVG Border**: Deadline border ring that drains clockwise and shifts color from green → red as time runs out.

### 4. Stats Banner & Filtering 📊
- Always-visible summary strip displaying counts for: All Trackers, Active Deadlines, Overdue, Completed, and Flexible Goals (no deadline).
- Click any stat button to instantly filter the dashboard to that category.

### 5. Global Search 🔍
- Live search bar in the navbar filters cards by title in real time.
- A helper notification appears when matches exist in other filter categories, with a one-click "Clear filters to view" shortcut.

### 6. Flexible Authentication Modes 🔐
- **Google Sign-In**: Cloud storage synced instantly across all devices via Supabase Auth.
- **Local Sandbox (Guest Mode)**: Full functionality without an account. Data is persisted securely in `localStorage` / `sessionStorage`.
- **Automatic Migration**: Starting as Guest and signing in later seamlessly migrates local trackers to the cloud database.

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML5, CSS3, ES6 Modules |
| Auth | Supabase Auth (Google Provider) |
| Database | Supabase PostgreSQL (real-time sync, Row Level Security) |
| Push Notifications | Firebase Cloud Messaging (FCM Client + Service Worker) |
| Offline | `localStorage` / `sessionStorage` (Guest Mode) |
| Hosting | GitHub Pages (zero-build static deploy with Actions) |
| Styling | HSL-based dark theme, glassmorphism (`blur(12px)`), CSS keyframes |

---

## 🚀 Getting Started

### Local Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Anandavnish/ProgressShelf.git
   cd ProgressShelf
   ```

2. **Set up Supabase:**
   - Copy `supabase-config.example.js` (or create a new file named `supabase-config.js` in the root).
   - Fill in your Supabase Project URL and Publishable Key:
     ```javascript
     import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
     const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL'
     const SUPABASE_PUBLISHABLE_KEY = 'YOUR_SUPABASE_PUBLISHABLE_KEY'
     // ...
     ```
   - Execute the SQL statements inside [supabase/schema.sql](supabase/schema.sql) in your Supabase SQL Editor to set up the database tables (`progress_bars`, `fcm_tokens`) and configure the Row Level Security (RLS) policies.

3. **Set up Firebase (for Push Notifications):**
   - Copy `firebase-config.example.js` to `firebase-config.js` in the root.
   - Enter your Firebase messaging credentials:
     ```javascript
     self.firebaseConfig = {
       apiKey: "YOUR_FIREBASE_API_KEY",
       authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
       projectId: "YOUR_PROJECT_ID",
       // ...
     };
     ```

4. **Launch a local web server:**

   Using Python:
   ```bash
   python -m http.server 8000
   ```
   Using Node:
   ```bash
   npx http-server -p 8000
   ```

5. Open your browser at `http://localhost:8000`.

> **Note:** A local server is required because the app uses ES Modules (`type="module"`) which do not work from `file://` paths in most browsers.

---

## 📂 Directory Structure

```text
ProgressShelf/
├── .github/
│   └── workflows/
│       ├── deploy.yml            # Automated CI/CD deployment to GitHub Pages (uses secrets)
│       └── notify.yml            # Background FCM push notification triggers
├── supabase/
│   ├── schema.sql                # Supabase database schema (Row Level Security policies)
│   └── functions/                # Serverless Edge Functions (e.g. for notifications)
├── versions/
│   ├── v1.0/                     # v1.0 (Basic) — self-contained archive (Firebase)
│   ├── v2.0/                     # v2.0 (Stable) — deadlines & visual indicators (Firebase)
│   └── v3.0/                     # v3.0 (Stats) — stats banner & multi-card formats (Firebase)
├── index.html                    # Main landing page (Google OAuth & Guest option)
├── dashboard.html                # v4.0 Dashboard — controls dashboard, bulk deletion, updates modal
├── app.js                        # Main application logic — scrolling headers, rendering, resize handlers
├── auth.js                       # Auth client routing & session handlers (Supabase client)
├── db.js                         # Database CRUD abstraction layer (Supabase Client + localStorage)
├── firebase-config.js            # Local Firebase FCM config credentials (gitignored)
├── firebase-config.example.js    # Example Firebase FCM config template
├── supabase-config.js            # Local Supabase DB client configuration (gitignored)
├── index.css                     # Design system — styles, cascading filters, animations
├── sw.js                         # Service Worker — caching, background fetch & FCM listeners
├── manifest.json                 # PWA application manifest rules
├── logo.svg                      # Animated rising-bar chart logo
└── README.md                     # This file
```

---

## 🔒 Security Notes

- **Credentials Safety**: Both `supabase-config.js` and `firebase-config.js` are listed in `.gitignore` and never committed — keeping your API keys and project endpoints completely private.
- **GitHub Pages Builds**: The live website uses GitHub Repository Secrets in the CI/CD workflow to securely generate configurations on the hosting server dynamically during deploy, ensuring the site functions without code leaks.
- **Row Level Security (RLS)**: Database policies restrict Supabase read/write operations strictly to the authenticated document owner.
- **Privacy First**: Guest mode data is fully isolated in the browser's local sandbox (`localStorage`) and is never sent to any server.

---

## 🗺 Version History

| Version | Status | Highlights |
|---|---|---|
| **v4.0** | ✅ Latest (root) | Supabase migration, controls dashboard row, bulk deletion manager, What's New (Terrace) screen, sequential scroll headers, glassmorphism alignments |
| **v3.0** | 🗂 Archived | Checklist & Note tracker types, Stats banner, Global search, Inline delete, Animated deadline SVG border (Firebase) |
| **v2.0** | 🗂 Archived | Deadlines, live overdue counter, glassmorphic UI overhaul (Firebase) |
| **v1.0** | 🗂 Archived | Single-level progress bars, Guest mode, Firebase auth (Firebase) |

---

## 📄 License

This project is open-source and available under the **MIT License**.

---

*Built by [Anand Avnish](https://github.com/Anandavnish) with AI assistance (Antigravity, Claude & Gemini).*
