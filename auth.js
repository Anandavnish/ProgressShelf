// auth.js
import { auth, isConfigured } from "./firebase-config.js";
import { 
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const isDashboard = window.location.pathname.endsWith("dashboard.html");

const mockUser = {
  uid: "demo-user-123",
  displayName: "Demo Explorer",
  photoURL: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150"
};

/**
 * Initiates the Google Sign-In flow using a popup.
 * If Firebase is unconfigured, enters Sandbox Mode.
 * @returns {Promise<User>} The authenticated Firebase User.
 */
export async function loginWithGoogle() {
  if (!isConfigured) {
    localStorage.setItem("progress_shelf_demo", "true");
    setTimeout(() => {
      window.location.href = "dashboard.html";
    }, 100);
    return mockUser;
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    await signInWithRedirect(auth, provider);
    // Page will redirect away — no return value needed
  } catch (error) {
    console.error("Google Sign-In Error:", error);
    throw error;
  }
}

/**
 * Signs out the current user.
 */
export async function logout() {
  if (!isConfigured) {
    localStorage.removeItem("progress_shelf_demo");
    window.location.href = "index.html";
    return;
  }
  
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Sign-Out Error:", error);
    throw error;
  }
}

// Guest mode: set when user clicks "Continue without login"
export function enterGuestMode() {
  sessionStorage.setItem('guest_mode', 'true');
  window.location.href = 'dashboard.html';
}

export function isGuestMode() {
  return sessionStorage.getItem('guest_mode') === 'true';
}

export function exitGuestMode() {
  sessionStorage.removeItem('guest_mode');
}

/**
 * Initializes authentication listener and handles automatic routing redirects.
 * @param {Function} onUserActive Callback invoked on the dashboard if user is authenticated or in guest mode.
 */
export function initAuthProtection(onUserActive) {
  if (!isConfigured) {
    const isGuest = isGuestMode();
    const isDemo = localStorage.getItem("progress_shelf_demo") === "true";

    if (isGuest) {
      // Guest takes priority over demo flag
      if (!isDashboard) {
        window.location.href = "dashboard.html";
      } else if (onUserActive) {
        setTimeout(() => onUserActive({ uid: null, displayName: "Guest" }), 100);
      }
    } else if (isDemo) {
      if (!isDashboard) {
        window.location.href = "dashboard.html";
      } else if (onUserActive) {
        setTimeout(() => onUserActive(mockUser), 100);
      }
    } else {
      if (isDashboard) {
        window.location.href = "index.html";
      }
    }
    return;
  }

  // Handle redirect result first (fires after returning from Google)
  getRedirectResult(auth).then((result) => {
    if (result?.user) {
      // Redirect sign-in completed — onAuthStateChanged will
      // also fire and handle the rest. Nothing extra needed here.
      console.log("Redirect sign-in completed:", result.user.displayName);
    }
  }).catch((error) => {
    console.error("Redirect result error:", error);
    sessionStorage.setItem("auth_error", error.message || "Failed to sign in via redirect.");
  });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      if (!isDashboard) {
        // Logged in user on landing page -> redirect to dashboard
        window.location.href = "dashboard.html";
      } else {
        // Logged in user on dashboard -> execute callback
        if (onUserActive) {
          onUserActive(user);
        }
      }
    } else {
      if (isGuestMode()) {
        if (!isDashboard) {
          window.location.href = "dashboard.html";
        } else if (onUserActive) {
          onUserActive({ uid: null, displayName: "Guest" });
        }
      } else {
        if (isDashboard) {
          // Logged out user on dashboard -> redirect to landing
          window.location.href = "index.html";
        }
      }
    }
  });
}

