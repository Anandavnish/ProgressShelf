# ProgressShelf 📊

**ProgressShelf** is a modern, responsive personal progress tracking dashboard designed to help you track habits, courses, readings, or custom goals—one animated progress bar at a time. It features multi-level sub-unit tracking (e.g., converting seconds to minutes, and minutes to hours), real-time database synchronization via Firebase, guest/sandbox mode, and a deadline countdown tracker.

Live Demo: [https://anandavnish.github.io/ProgressShelf/](https://anandavnish.github.io/ProgressShelf/)

---

## 🌟 Key Features

### 1. Multi-Level Progress Tracking (Presets & Custom)
- **Built-in Presets**: Quick creation for common progress units:
  - *Lectures, Videos, Problems, Tasks, Pages, Books, Chapters, and Custom*.
- **Time Preset**: Support for ticking elapsed/remaining time with multi-level conversion rates (`Seconds` ➔ `Minutes` ➔ `Hours`).
- **Dynamic Calculation**: Sub-unit conversion calculations are handled automatically (e.g. updating 90 minutes automatically shows as 1 hour and 30 minutes).

### 2. Smart Deadlines & Overdue Live Counter ⏱
- **Visual Deadlines**: Set target dates and times for each tracker.
- **Dynamic Status**: Beautiful badges showing time remaining or elapsed status.
- **Live Overdue Counter**: Active ticking displays for overdue targets (e.g., `⏱ Overdue by 2d 3hr` or `⏱ Overdue by 45min`) automatically updating in real-time.

### 3. Flexible Authentication Modes 🔐
- **Google Sign-In**: Safe cloud storage synced instantly across all your devices using Firebase Auth and Firestore.
- **Local Sandbox (Guest Mode)**: Full functionality without creating an account. All data is securely persisted in the browser's `localStorage` and `sessionStorage`.
- **Automatic Sync/Migration**: If you start as a Guest and later decide to sign in with Google, your local trackers are seamlessly migrated to your cloud database automatically.

### 4. Archive Navigation (v1.0 Basic Version)
- Easy access to the older, minimalist v1.0 interface via a version selector dropdown on the dashboard.

---

## 🛠 Tech Stack

- **Frontend Core**: Vanilla HTML5, CSS3, ES6 JavaScript Modules.
- **Database & Auth**: Firebase Auth (Google Provider) & Cloud Firestore (Real-time sync).
- **Hosting**: GitHub Pages.
- **Styling**: Harmonious HSL colors, dark-themed glassmorphic design, smooth animations, and a responsive flexbox/grid layout tailored for both mobile and desktop viewports.

---

## 🚀 Getting Started

### Local Setup
1. Clone the repository to your machine:
   ```bash
   git clone https://github.com/Anandavnish/ProgressShelf.git
   ```
2. Navigate to the project directory:
   ```bash
   cd "Simple status bar"
   ```
3. Set up Firebase:
   - Copy `firebase-config.template.js` to `firebase-config.js`.
   - Add your own Firebase Project Configuration credentials in `firebase-config.js`.
   - *(Optional)* Do the same under `versions/v1.0/firebase-config.template.js` if you wish to run the archive version with database features.
4. Launch a local web server:
   - For example, using Python:
     ```bash
     python -m http.server 8080
     ```
   - Or using Node:
     ```bash
     npx http-server -p 8080
     ```
5. Open your browser and navigate to `http://localhost:8080`.

---

## 📂 Directory Structure

```text
├── index.html                   # Main landing page (Google sign-in & Guest option)
├── dashboard.html               # Main v2 Dashboard layout
├── app.js                       # Dashboard rendering and interaction logic
├── auth.js                      # Authentication, routes protection, and guest sessions
├── db.js                        # Cloud Firestore / Local Storage data operations
├── firebase-config.js           # Firebase app initialization (gitignore-ignored)
├── firebase-config.template.js  # Template configuration for public clones
├── index.css                    # Modern global styling system
├── versions/
│   └── v1.0/                    # Version 1.0 (Basic) self-contained archive
│       ├── index.html
│       ├── dashboard.html
│       ├── app.js
│       ├── auth.js
│       ├── db.js
│       ├── firebase-config.js
│       ├── firebase-config.template.js
│       └── index.css
└── README.md                    # This file
```

---

## 📄 License
This project is open-source and available under the MIT License.
