// auth.js
import { supabase, isConfigured } from "./supabase-config.js?v=3.0";
import { updateUserSettings } from "./db.js?v=3.1";

const isDashboard = window.location.pathname.includes("dashboard") || (typeof document !== 'undefined' && !!document.getElementById("cards-grid"));

const mockUser = {
  uid: "demo-user-123",
  displayName: "Demo Explorer",
  photoURL: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150"
};

/**
 * Maps Supabase User to Firebase User properties expected by app.js
 */
export function mapSupabaseUser(supabaseUser) {
  if (!supabaseUser) return null;
  return {
    uid: supabaseUser.id,
    email: supabaseUser.email,
    displayName: supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || supabaseUser.email || "Tracker User",
    photoURL: supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture || "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y",
    preferredSort: supabaseUser.user_metadata?.preferred_sort || null,
    accentColor: supabaseUser.user_metadata?.accent_color || null,
    customAccents: supabaseUser.user_metadata?.custom_accents || null,
    fontFamily: supabaseUser.user_metadata?.font_family || null
  };
}

/**
 * Initiates the Google Sign-In flow using OAuth redirect.
 */
export async function signInWithGoogle() {
  const isNative = typeof window !== 'undefined' && !!window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform();
  const pathPrefix = window.location.pathname.includes('/ProgressShelf/') ? '/ProgressShelf/' : '/';
  const redirectUrl = isNative
    ? 'com.progressshelf.app://auth'
    : (window.location.origin + pathPrefix + 'dashboard.html');

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
    localStorage.removeItem('ps_cached_user');
    localStorage.removeItem('ps_fcm_token');
    localStorage.removeItem('ps_guest_bars');
    localStorage.removeItem('ps_guest_mode');
    sessionStorage.removeItem('guest_mode');
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
    localStorage.removeItem("ps_cached_user");
    localStorage.removeItem("ps_guest_mode");
    sessionStorage.removeItem("guest_mode");
    window.location.href = "index.html";
    return;
  }
  await signOut();
}

// Guest mode: set when user clicks "Continue without login"
export function enterGuestMode() {
  try {
    localStorage.setItem('ps_guest_mode', 'true');
    sessionStorage.setItem('guest_mode', 'true');
  } catch (e) {}
  window.location.href = 'dashboard.html';
}

export function isGuestMode() {
  try {
    return localStorage.getItem('ps_guest_mode') === 'true' || sessionStorage.getItem('guest_mode') === 'true';
  } catch (e) {
    return false;
  }
}

export function exitGuestMode() {
  try {
    localStorage.removeItem('ps_guest_mode');
    sessionStorage.removeItem('guest_mode');
  } catch (e) {}
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
 * Sends a 6-digit OTP to an existing account for password reset.
 * Uses shouldCreateUser:false so it only succeeds for registered emails.
 */
export async function sendPasswordResetOtp(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false }
  });
  if (error) throw error;
}

/**
 * Verifies an OTP code for the password reset flow (type: 'email').
 * On success, Supabase creates an active session so updateUserPassword() can be called.
 */
export async function verifyPasswordResetOtp(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email'
  });
  if (error) throw error;
  return data;
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
    return Promise.resolve(null);
  }

  // Helper to read cached user profile from localStorage
  const getCachedUser = () => {
    try {
      const raw = localStorage.getItem("ps_cached_user");
      return raw ? JSON.parse(raw) : null;
    } catch(e) {
      return null;
    }
  };

  const isGuest = isGuestMode();
  const cachedUser = getCachedUser();
  const isPasswordSetupPending = sessionStorage.getItem('password_setup_pending') === 'true';

  let initialDispatched = false;

  // Cache-first fast startup: on dashboard, immediately dispatch cached user or guest
  // with zero network calls blocking first paint
  if (isDashboard && (cachedUser || isGuest) && !isPasswordSetupPending) {
    initialDispatched = true;
    if (onUserActive) {
      onUserActive(isGuest ? { uid: null, displayName: "Guest" } : cachedUser);
    }
  }

  // Validate session with Supabase in the background
  if (!supabase || !supabase.auth) {
    return Promise.resolve(null);
  }

  return supabase.auth.getSession()
    .catch((err) => {
      console.warn('[Auth] getSession failed or timed out:', err);
      return { data: { session: null } };
    })
    .then(({ data: { session } = {} }) => {
    let user = session ? mapSupabaseUser(session.user) : null;
    if (user) {
      localStorage.setItem("ps_cached_user", JSON.stringify(user));
    } else if (!isGuest) {
      localStorage.removeItem("ps_cached_user");
    }

    if (user) {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then((granted) => {
          console.log('[Auth] Persistent storage granted:', granted);
        }).catch(() => {});
      }
      if (!isDashboard && !isPasswordSetupPending) {
        window.location.href = "dashboard.html";
      } else if (onUserActive && (!initialDispatched || user.uid !== cachedUser?.uid)) {
        onUserActive(user);
      }
    } else if (isGuest) {
      if (!isDashboard) {
        window.location.href = "dashboard.html";
      } else if (onUserActive && !initialDispatched) {
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

      let user = session ? mapSupabaseUser(session.user) : null;
      if (user) {
        localStorage.setItem("ps_cached_user", JSON.stringify(user));
      }
      const isGuest = isGuestMode();
      const isPasswordSetupPending = sessionStorage.getItem('password_setup_pending') === 'true';

      if (event === 'SIGNED_OUT') {
        localStorage.removeItem("ps_cached_user");
        if (isDashboard && !isGuest) {
          window.location.href = "index.html";
        }
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persist().then((granted) => {
            console.log('[Auth] Persistent storage granted:', granted);
          });
        }
        if (!isDashboard && !isPasswordSetupPending) {
          window.location.href = "dashboard.html";
        } else if (onUserActive && user) {
          onUserActive(user);
        }
      }
    });

    return user;
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

/**
 * Persists the user's theme and accent color preferences to Supabase user_metadata and user_settings table.
 * @param {string} themeMode 'light' | 'dark' | 'system'
 * @param {string} accentColor Hex color string
 * @param {Array} customAccents Array of custom accent hex strings
 */
export async function updateUserThemePreference(themeMode, accentColor, customAccents) {
  if (!isConfigured || isGuestMode()) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const settings = { 
      accent_color: accentColor 
    };
    if (customAccents !== undefined) {
      settings.custom_accents = customAccents;
    }

    // 1. Persist directly to Supabase Auth user_metadata
    await supabase.auth.updateUser({
      data: settings
    }).catch(err => console.warn("Supabase auth metadata update notice:", err));

    // 2. Persist to user_settings table
    await updateUserSettings(user.id, settings);
  } catch (err) {
    console.error("Failed to update user theme preference:", err);
  }
}

/**
 * Persists the user's font family preference to Supabase user_metadata and user_settings table.
 * @param {string} fontFamily 'outfit' | 'space-mono' | 'jetbrains-mono'
 */
export async function updateUserFontPreference(fontFamily) {
  if (!isConfigured || isGuestMode()) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Persist directly to Supabase Auth user_metadata (bulletproof fallback)
    await supabase.auth.updateUser({
      data: { font_family: fontFamily }
    }).catch(err => console.warn("Supabase auth metadata update notice:", err));

    // 2. Persist to user_settings table for cross-device realtime synchronization
    await updateUserSettings(user.id, { font_family: fontFamily });
  } catch (err) {
    console.error("Failed to update user font preference:", err);
  }
}

/**
 * Handles incoming deep link URL (from appUrlOpen or getLaunchUrl)
 * Parses tokens or OAuth authorization code, establishes Supabase session,
 * caches user profile, and navigates to dashboard.
 */
export async function handleAppUrl(url) {
  if (!url || !isConfigured) return;
  console.log('[Auth] Handling deep link URL:', url);

  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');

  const params = new URLSearchParams();
  if (queryIndex !== -1) {
    const queryPart = (hashIndex !== -1 && hashIndex > queryIndex)
      ? url.substring(queryIndex + 1, hashIndex)
      : url.substring(queryIndex + 1);
    new URLSearchParams(queryPart).forEach((v, k) => params.set(k, v));
  }
  if (hashIndex !== -1) {
    new URLSearchParams(url.substring(hashIndex + 1)).forEach((v, k) => params.set(k, v));
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const code = params.get('code');
  const errorDescription = params.get('error_description') || params.get('error');

  if (errorDescription) {
    console.error('[Auth] OAuth error returned in URL:', errorDescription);
    throw new Error(errorDescription);
  }

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    if (error) throw error;
    if (data?.session?.user) {
      const user = mapSupabaseUser(data.session.user);
      localStorage.setItem('ps_cached_user', JSON.stringify(user));
      exitGuestMode();
      if (!isDashboard) {
        window.location.href = 'dashboard.html';
      } else {
        if (window.history && window.history.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
      return user;
    }
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    if (data?.session?.user) {
      const user = mapSupabaseUser(data.session.user);
      localStorage.setItem('ps_cached_user', JSON.stringify(user));
      exitGuestMode();
      if (!isDashboard) {
        window.location.href = 'dashboard.html';
      } else {
        if (window.history && window.history.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
      return user;
    }
  }
}

/**
 * Registers native Capacitor deep link listeners for custom scheme (com.progressshelf.app)
 * and universal links.
 */
export function setupDeepLinkListener() {
  const isNative = typeof window !== 'undefined' && !!window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform();
  if (!isNative) return;

  const appPlugin = window.Capacitor?.Plugins?.App;
  if (!appPlugin) return;

  try {
    appPlugin.addListener('appUrlOpen', async (data) => {
      try {
        if (data && data.url) {
          await handleAppUrl(data.url);
        }
      } catch (err) {
        console.error('[Auth] Deep link handle error:', err);
      }
    });
  } catch (e) {
    console.warn('[Auth] Failed to register appUrlOpen listener:', e);
  }

  if (typeof appPlugin.getLaunchUrl === 'function') {
    appPlugin.getLaunchUrl().then(async (launchData) => {
      if (launchData && launchData.url) {
        await handleAppUrl(launchData.url);
      }
    }).catch(err => console.warn('[Auth] getLaunchUrl notice:', err));
  }
}

