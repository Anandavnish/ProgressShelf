const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const wwwDir = path.join(rootDir, 'www');

// Files that the app strictly needs
const filesToCopy = [
  'index.html',
  'dashboard.html',
  'reset-password.html',
  'about.html',
  'index.css',
  'app.js',
  'auth.js',
  'ai.js',
  'assistant.js',
  'db.js',
  'login.js',
  'reset-password.js',
  'supabase.js',
  'supabase-config.js',
  'firebase-config.js',
  'firebase-config.example.js',
  'favicon.svg',
  'logo.svg',
  'badge.svg',
  'badge.png',
  'icon-192.png',
  'icon-512.png',
  'manifest.json'
];

console.log('[build-www] Cleaning www/ directory...');
if (fs.existsSync(wwwDir)) {
  fs.rmSync(wwwDir, { recursive: true, force: true });
}
fs.mkdirSync(wwwDir, { recursive: true });

console.log('[build-www] Copying required web assets to www/...');
let copiedCount = 0;

for (const file of filesToCopy) {
  const src = path.join(rootDir, file);
  const dest = path.join(wwwDir, file);

  if (fs.existsSync(src)) {
    if (file.endsWith('.html')) {
      let content = fs.readFileSync(src, 'utf8');
      // Inject supabase.js and capacitor.js into native build if not already present
      let injected = '';
      if (!content.includes('supabase.js')) {
        injected += '  <script src="supabase.js"></script>\n';
      }
      if (!content.includes('capacitor.js')) {
        injected += '  <script src="capacitor.js"></script>\n';
      }
      if (injected) {
        content = content.replace('</head>', injected + '</head>');
      }
      fs.writeFileSync(dest, content, 'utf8');
    } else {
      fs.copyFileSync(src, dest);
    }
    copiedCount++;
  } else {
    // Optional files like firebase-config.js might not exist in clean checkouts
    if (file !== 'firebase-config.js') {
      console.warn(`[build-www] Warning: ${file} not found at root.`);
    }
  }
}

// Copy capacitor.js runtime to www/ so it's readily available
const capRuntimeSrc = path.join(rootDir, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js');
if (fs.existsSync(capRuntimeSrc)) {
  fs.copyFileSync(capRuntimeSrc, path.join(wwwDir, 'capacitor.js'));
  console.log('[build-www] Copied capacitor.js runtime.');
}

console.log(`[build-www] Successfully prepared www/ (${copiedCount} app files copied).`);
