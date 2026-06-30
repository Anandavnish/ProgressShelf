// login.js
import { isConfigured } from "./supabase-config.js";
import { loginWithGoogle, initAuthProtection, enterGuestMode } from "./auth.js";

const configBanner = document.getElementById("config-banner");
const googleLoginBtn = document.getElementById("btn-google-login");
const guestBtn = document.getElementById("btn-guest");
const errorMsg = document.getElementById("error-message");

// Initialize Auth listener to redirect if user is already logged in
if (isConfigured) {
  initAuthProtection();
} else {
  // Show setup warning if configuration file is missing/dummy
  configBanner.classList.remove("hidden");
}

// Display any redirect errors
const savedError = sessionStorage.getItem("auth_error");
if (savedError) {
  errorMsg.textContent = savedError;
  errorMsg.classList.remove("hidden");
  sessionStorage.removeItem("auth_error");
}

// Handle Google Login Button Trigger
googleLoginBtn.addEventListener("click", async () => {
  errorMsg.classList.add("hidden");
  googleLoginBtn.style.pointerEvents = "none";
  const originalHtml = googleLoginBtn.innerHTML;
  googleLoginBtn.innerHTML = "Signing in...";
  
  try {
    await loginWithGoogle();
    // Redirect is handled by onAuthStateChanged / initAuthProtection in auth.js
  } catch (error) {
    console.error(error);
    errorMsg.textContent = error.message || "Failed to authenticate. Please try again.";
    errorMsg.classList.remove("hidden");
    googleLoginBtn.style.pointerEvents = "all";
    googleLoginBtn.innerHTML = originalHtml;
  }
});

// Handle Guest Button Trigger
guestBtn.addEventListener("click", () => {
  enterGuestMode();
});

// Service Worker Registration with Update Reload logic
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('Service Worker registered:', reg.scope);
        
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('New version installed, reloading landing page...');
              }
            });
          }
        });
      })
      .catch((err) => console.error('Service Worker registration failed:', err));
  });

  // Automatically refresh the page when the service worker updates and takes control
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}
