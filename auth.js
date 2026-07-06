// auth.js
import { supabase, isConfigured } from "./supabase-config.js";

const isDashboard = window.location.pathname.endsWith("dashboard.html");

const mockUser = {
  uid: "demo-user-123",
  displayName: "Demo Explorer",
  photoURL: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150"
};

/**
 * Maps Supabase User to Firebase User properties expected by app.js
 */
function mapSupabaseUser(supabaseUser) {
  if (!supabaseUser) return null;
  return {
    uid: supabaseUser.id,
    email: supabaseUser.email,
    displayName: supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || supabaseUser.email || "Tracker User",
    photoURL: supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture || "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y",
    preferredSort: supabaseUser.user_metadata?.preferred_sort || null
  };
}

/**
 * Initiates the Google Sign-In flow using OAuth redirect.
 */
export async function signInWithGoogle() {
  const pathPrefix = window.location.pathname.includes('/ProgressShelf/') ? '/ProgressShelf/' : '/';
  const redirectUrl = window.location.origin + pathPrefix + 'dashboard.html';

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl
    }
  });
  if (error) throw error;
  return data;
}

/**
 * Backwards compatible name for app.js login trigger.
 */
export async function loginWithGoogle() {
  if (!isConfigured) {
    localStorage.setItem("progress_shelf_demo", "true");
    setTimeout(() => {
      window.location.href = "dashboard.html";
    }, 100);
    return mockUser;
  }
  return signInWithGoogle();
}

/**
 * Signs out the current user and cleans up FCM token.
 */
export async function signOut() {
  try {
    // Step 1: Delete FCM token for this device
    const token = localStorage.getItem('ps_fcm_token');
    if (token) {
      const session = await supabase.auth.getSession();
      const uid = session?.data?.session?.user?.id;
      if (uid) {
        await supabase.from('fcm_tokens')
          .delete()
          .eq('user_id', uid)
          .eq('token', token);
      }
    }
  } catch (e) {
    console.warn('FCM token cleanup failed:', e);
  } finally {
    // Step 2: Always clear local state regardless of FCM cleanup result
    localStorage.removeItem('ps_fcm_token');
    localStorage.removeItem('ps_guest_bars');
    sessionStorage.removeItem('password_setup_pending');
    // Step 3: Sign out from Supabase
    if (isConfigured) {
      await supabase.auth.signOut();
    }
    // Step 4: Redirect to login
    window.location.href = 'index.html';
  }
}

/**
 * Backwards compatible name for app.js logout trigger.
 */
export async function logout() {
  if (!isConfigured) {
    localStorage.removeItem("progress_shelf_demo");
    window.location.href = "index.html";
    return;
  }
  await signOut();
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
 * Initiates email sign-up using passwordless OTP.
 */
export async function signUpWithOtp(name, email) {
  const pathPrefix = window.location.pathname.includes('/ProgressShelf/') ? '/ProgressShelf/' : '/';
  const redirectUrl = window.location.origin + pathPrefix + 'dashboard.html';

  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      data: { full_name: name },
      emailRedirectTo: redirectUrl
    }
  });
  if (error) throw error;
  return data;
}

/**
 * Verifies the OTP token for email sign-up/sign-in.
 */
export async function verifyOtpCode(email, code) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: 'email'
  });
  if (error) throw error;
  return data;
}

/**
 * Updates the current authenticated user's password.
 */
export async function updateUserPassword(password) {
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

/**
 * Signs in user using email and password.
 */
export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
}

/**
 * Checks if an email address is already registered by probing the sign-in endpoint.
 * Returns true if the account exists (even if password is wrong), false if no account found.
 */
export async function checkEmailExists(email) {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: "__probe_existence__"
  });
  if (!error) return true; // signed in (extremely unlikely with dummy password)
  // "Invalid login credentials" means user exists but password was wrong
  if (error.message.toLowerCase().includes("invalid login credentials")) return true;
  // "Email not confirmed" means account exists but OTP not yet confirmed
  if (error.message.toLowerCase().includes("email not confirmed")) return true;
  return false;
}

/**
 * Sends a password reset email to the specified address.
 */
export async function sendPasswordResetEmail(email) {
  const pathPrefix = window.location.pathname.includes('/ProgressShelf/') ? '/ProgressShelf/' : '/';
  const redirectUrl = window.location.origin + pathPrefix + 'reset-password.html';
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectUrl
  });
  if (error) throw error;
}

/**
 * Registers a callback for Supabase auth state changes.
 */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    const user = session ? mapSupabaseUser(session.user) : null;
    callback(user);
  });
}

/**
 * Initializes authentication listener and handles automatic routing redirects.
 */
export function initAuthProtection(onUserActive) {
  if (!isConfigured) {
    const isGuest = isGuestMode();
    const isDemo = localStorage.getItem("progress_shelf_demo") === "true";

    if (isGuest) {
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

  // Check initial session state
  supabase.auth.getSession().then(({ data: { session } }) => {
    const user = session ? mapSupabaseUser(session.user) : null;
    const isGuest = isGuestMode();
    const isPasswordSetupPending = sessionStorage.getItem('password_setup_pending') === 'true';

    if (user) {
      if (!isDashboard && !isPasswordSetupPending) {
        window.location.href = "dashboard.html";
      } else if (onUserActive) {
        onUserActive(user);
      }
    } else if (isGuest) {
      if (!isDashboard) {
        window.location.href = "dashboard.html";
      } else if (onUserActive) {
        onUserActive({ uid: null, displayName: "Guest" });
      }
    } else {
      if (isDashboard) {
        window.location.href = "index.html";
      }
    }

    // Track auth changes only after initial session checks complete
    supabase.auth.onAuthStateChange((event, session) => {
      // Ignore INITIAL_SESSION to prevent duplicate startup checks or race conditions
      if (event === 'INITIAL_SESSION') return;

      const user = session ? mapSupabaseUser(session.user) : null;
      const isGuest = isGuestMode();
      const isPasswordSetupPending = sessionStorage.getItem('password_setup_pending') === 'true';

      if (event === 'SIGNED_OUT') {
        if (isDashboard && !isGuest) {
          window.location.href = "index.html";
        }
      } else if (event === 'SIGNED_IN') {
        if (!isDashboard && !isPasswordSetupPending) {
          window.location.href = "dashboard.html";
        } else if (onUserActive && user) {
          onUserActive(user);
        }
      }
    });
  });
}

/**
 * Handles account deletion logic on the client side.
 */
export async function deleteCurrentUserAccount() {
  if (!isConfigured) {
    localStorage.removeItem("progress_shelf_demo");
    return;
  }
  console.log("Supabase account deletion requested. Data was removed via deleteUserData.");
}

/**
 * Checks if there is an active authenticated session.
 */
export async function hasActiveSession() {
  if (!isConfigured) return false;
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

/**
 * Persists the user's dashboard sort preference to Supabase user_metadata.
 * @param {string} sortValue Sort preference value.
 */
export async function updateUserPreferredSort(sortValue) {
  if (!isConfigured || isGuestMode()) return;
  try {
    const { error } = await supabase.auth.updateUser({
      data: { preferred_sort: sortValue }
    });
    if (error) throw error;
  } catch (err) {
    console.error("Failed to update user preferred sort:", err);
  }
}
