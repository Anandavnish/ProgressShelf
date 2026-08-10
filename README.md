<p align="center">
  <img src="logo.svg" alt="ProgressShelf — Track everything. One bar at a time." width="520" />
</p>

<p align="center">
  <a href="https://anandavnish.github.io/ProgressShelf/">Live Demo</a>
  &nbsp;•&nbsp;
  <a href="https://github.com/Anandavnish/ProgressShelf">GitHub Repo</a>
  &nbsp;•&nbsp;
  <img src="https://img.shields.io/badge/version-v4.3-38BDF8?style=flat-square" alt="v4.3"/>
  &nbsp;•&nbsp;
  <img src="https://img.shields.io/badge/license-MIT-4ADE80?style=flat-square" alt="MIT"/>
</p>

---

**ProgressShelf** is a modern, responsive personal progress tracking dashboard that lets you track habits, courses, readings, custom goals, checklists, and quick notes — all in one place, one animated progress bar at a time.

Built with zero build tools. Runs instantly on any static host.

---

## 🌟 What's New in v4.3

- **Auto-Repeat & Habit Reset System** — Automated daily recurring routines for checklists and deadlines with configurable reset times (e.g. 06:00 AM) and optional total cycle counts.
- **Intelligent Visual Cycle States** — Dynamic visual feedback for recurring cards:
  - *Pending Renewal* (amber pulsing ring & status badge for overdue tasks awaiting the scheduled daily reset time).
  - *Soft Reset* (calm sky blue steady indicator for completed habits awaiting the next daily cycle).
- **App Font Customizer & Typography Engine** — Choose your preferred typeface directly in the profile menu: **Default (Outfit)**, **Space Mono** (the tech monospace inspired by Smash.am), or **JetBrains Mono**. Preferences persist across sessions and sync to Supabase with zero FOUT.
- **Glassmorphism 48px Blur & Theme Polish** — Enhanced dropdown menu backdrops to 48px blur with 70% opacity in light mode for crystal-clear readability, and decoupled theme accents to preserve text contrast.
- **Full-Width Sticky Header Backdrops** — Extended sticky dashboard controls to span the full viewport width smoothly on widescreen displays.
- **About Page Redesign & Markdown Renderer** — Sleek container-based About page powered by an inline Markdown parser rendering features, PWA triggers, and feedback links.

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

### 4. Auto-Repeat & Daily Habit Resets 🔁
- **Daily Checklist Reset**: Recurring checklists automatically uncheck all items at your chosen daily time for effortless daily routines and workouts.
- **Deadline Auto-Renewal**: Deadlines advance by 24-hour cycles upon reset while respecting optional repeat limits.
- **Smart Cycle Feedback**: Distinct visual cues for *Pending Renewal* (amber pulse) and *Soft Reset* (sky blue steady).

### 5. App Typography & Custom Font Setting 🔤
- Switch between **Default (Outfit)**, **Space Mono** (Smash.am goal style), and **JetBrains Mono** directly from the profile dropdown.
- Zero-FOUT early head execution ensures instant typography without visual jumps on page load.
- Preferences automatically sync to the cloud via Supabase `user_settings`.

### 6. Stats Banner & Filtering 📊
- Always-visible summary strip displaying counts for: All Trackers, Active Deadlines, Overdue, Completed, and Flexible Goals (no deadline).
- Click any stat button to instantly filter the dashboard to that category.

### 7. Global Search 🔍
- Live search bar in the navbar filters cards by title in real time.
- A helper notification appears when matches exist in other filter categories, with a one-click "Clear filters to view" shortcut.

### 8. Flexible Authentication Modes 🔐
- **Google Sign-In & Email Auth**: Cloud storage synced instantly across all devices via Supabase Auth.
- **Local Sandbox (Guest Mode)**: Full functionality without an account. Data is persisted securely in `localStorage` / `sessionStorage`.
- **Automatic Migration**: Starting as Guest and signing in later seamlessly migrates local trackers to the cloud database.

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML5, CSS3, ES6 Modules |
| Auth | Supabase Auth (Google & Email Providers) |
| Database | Supabase PostgreSQL (real-time sync, Row Level Security) |
| Push Notifications | Firebase Cloud Messaging (FCM Client + Service Worker) |
| Offline | `localStorage` / `sessionStorage` (Guest Mode) |
| Hosting | GitHub Pages (zero-build static deploy with Actions) |
| Styling | HSL-based dark theme, glassmorphism (`blur(48px)`), CSS keyframes |

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
│       └── test-notify.yml       # Manual test diagnostic push notification trigger
├── supabase/
│   ├── schema.sql                # Supabase database schema (RLS policies & repeat JSONB)
│   └── functions/                # Serverless Edge Functions (e.g. for notifications)
├── versions/
│   ├── v1.0/                     # v1.0 (Basic) — self-contained archive (Firebase)
│   ├── v2.0/                     # v2.0 (Stable) — deadlines & visual indicators (Firebase)
│   ├── v3.0/                     # v3.0 (Stats) — stats banner & multi-card formats (Firebase)
│   └── v4.0/                     # v4.0 (Supabase) — Supabase backend migration archive
├── index.html                    # Main landing page (Google OAuth, Email & Guest option)
├── dashboard.html                # v4.3 Dashboard — controls dashboard, bulk deletion, auto-resets
├── about.html                    # About ProgressShelf & feature guide with Markdown renderer
├── reset-password.html           # Password recovery page
├── reset-password.js             # Password recovery client controller
├── app.js                        # Main application logic — scrolling headers, rendering, auto-resets
├── auth.js                       # Auth client routing & session handlers (Supabase client)
├── db.js                         # Database CRUD abstraction layer (Supabase Client + localStorage)
├── firebase-config.js            # Local Firebase FCM config credentials (gitignored)
├── firebase-config.example.js    # Example Firebase FCM config template
├── supabase-config.js            # Local Supabase DB client configuration (gitignored)
├── index.css                     # Design system — styles, cascading filters, animations
├── sw.js                         # Service Worker — caching (v183+), background fetch & FCM listeners
├── manifest.json                 # PWA application manifest rules
├── logo.svg                      # Animated rising-bar chart logo
├── favicon.svg                   # Website tab icon
├── badge.png                     # Monochrome status bar notification badge
├── badge.svg                     # Status bar badge vector
├── brain.md                      # Comprehensive project blueprint & data models
├── PROJECT_REPORT.md             # Developer & project report
├── fcm_notifications_report.md   # FCM notifications report
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
| **v4.3** | ✅ Latest (root) | Checklist & Deadline Auto-Repeat, Pending Renewal (amber pulse) & Soft Reset (sky blue) states, 48px glassmorphism blur, header backdrops |
| **v4.2** | 🗂 Previous | Dynamic theming & custom accent palettes, notification direct view action, About page box redesign, status bar stencil badge |
| **v4.1** | 🗂 Previous | Demo card backdated rendering fixes, font metrics sync, drain-border fallback refinement |
| **v4.0** | 🗂 Archived | Supabase migration, controls dashboard row, bulk deletion manager, What's New (Terrace) screen, sequential scroll headers |
| **v3.0** | 🗂 Archived | Checklist & Note tracker types, Stats banner, Global search, Inline delete, Animated deadline SVG border (Firebase) |
| **v2.0** | 🗂 Archived | Deadlines, live overdue counter, glassmorphic UI overhaul (Firebase) |
| **v1.0** | 🗂 Archived | Single-level progress bars, Guest mode, Firebase auth (Firebase) |

---

## 📄 License

This project is open-source and available under the **MIT License**.

---

*Built by [Anand Avnish](https://github.com/Anandavnish) with AI assistance (Antigravity, Claude & Gemini).*

