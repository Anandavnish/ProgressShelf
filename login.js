// login.js
import { isConfigured } from "./supabase-config.js";
import { loginWithGoogle, initAuthProtection, enterGuestMode, signUpWithOtp, verifyOtpCode, updateUserPassword, hasActiveSession, signInWithEmail, checkEmailExists, sendPasswordResetOtp, verifyPasswordResetOtp, isGuestMode } from "./auth.js";

const configBanner = document.getElementById("config-banner");
const googleLoginBtn = document.getElementById("btn-google-login");
const guestBtn = document.getElementById("btn-guest");
const errorMsg = document.getElementById("error-message");

// Initialize Auth listener to redirect if user is already logged in
if (isConfigured) {
  initAuthProtection().then((user) => {
    const isPasswordSetupPending = sessionStorage.getItem('password_setup_pending') === 'true';
    if (!user && !isGuestMode()) {
      document.body.classList.remove("auth-checking");
      const logo = document.querySelector(".logo-svg-large");
      if (logo) logo.classList.remove("logo-loading");
    } else if (user && isPasswordSetupPending) {
      document.body.classList.remove("auth-checking");
      const logo = document.querySelector(".logo-svg-large");
      if (logo) logo.classList.remove("logo-loading");
    }
  });
} else {
  // Show setup warning if configuration file is missing/dummy
  configBanner.classList.remove("hidden");
  document.body.classList.remove("auth-checking");
  const logo = document.querySelector(".logo-svg-large");
  if (logo) logo.classList.remove("logo-loading");
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

// ==========================================
// Email Auth Flow DOM Elements
// ==========================================
const emailLoginTrigger = document.getElementById("btn-email-login-trigger");
const signinModal = document.getElementById("signin-modal");
const closeSigninModalBtn = document.getElementById("btn-close-signin-modal");
const formSignin = document.getElementById("form-signin");
const inputSigninEmail = document.getElementById("input-signin-email");
const inputSigninPassword = document.getElementById("input-signin-password");
const signinError = document.getElementById("signin-error");
const linkGotoSignup = document.getElementById("link-goto-signup");
const linkGotoSignin = document.getElementById("link-goto-signin");
const linkForgotPassword = document.getElementById("link-forgot-password");

const forgotModal = document.getElementById("forgot-modal");
const closeForgotModalBtn = document.getElementById("btn-close-forgot-modal");
const inputForgotEmail = document.getElementById("input-forgot-email");
const forgotEmailError = document.getElementById("forgot-email-error");
const forgotOtpError = document.getElementById("forgot-otp-error");
const forgotPasswordError = document.getElementById("forgot-password-error");
const forgotSentEmailLabel = document.getElementById("forgot-sent-email-label");
const linkBackToSignin = document.getElementById("link-back-to-signin");
const linkSigninFromExists = document.getElementById("link-signin-from-exists");
const linkForgotFromExists = document.getElementById("link-forgot-from-exists");
const signupEmailExistsNotice = document.getElementById("signup-email-exists-notice");

const forgotStepEmail    = document.getElementById("forgot-step-email");
const forgotStepOtp      = document.getElementById("forgot-step-otp");
const forgotStepPassword = document.getElementById("forgot-step-password");
const formForgotEmail       = document.getElementById("form-forgot-email");
const formForgotOtp         = document.getElementById("form-forgot-otp");
const formForgotNewPassword = document.getElementById("form-forgot-new-password");
const inputForgotOtp         = document.getElementById("input-forgot-otp");
const inputResetNewPassword  = document.getElementById("input-reset-new-password");
const inputResetConfirmPassword = document.getElementById("input-reset-confirm-password");

const signupModal = document.getElementById("signup-modal");
const closeSignupModalBtn = document.getElementById("btn-close-signup-modal");
const backToDetailsBtn = document.getElementById("btn-back-to-details");

const signupStepDetails = document.getElementById("signup-step-details");
const signupStepOtp = document.getElementById("signup-step-otp");
const signupStepPassword = document.getElementById("signup-step-password");

const formSignupDetails = document.getElementById("form-signup-details");
const formSignupOtp = document.getElementById("form-signup-otp");
const formSignupPassword = document.getElementById("form-signup-password");

const inputSignupName = document.getElementById("input-signup-name");
const inputSignupEmail = document.getElementById("input-signup-email");
const inputSignupOtp = document.getElementById("input-signup-otp");
// inputSignupPassword and inputSignupConfirmPassword removed — passwords are now only collected in Step 3
const inputSetupPassword = document.getElementById("input-setup-password");
const inputSetupConfirmPassword = document.getElementById("input-setup-confirm-password");

const detailsError = document.getElementById("signup-details-error");
const otpError = document.getElementById("signup-otp-error");
const passwordError = document.getElementById("signup-password-error");
const sentEmailLabel = document.getElementById("signup-sent-email-label");

function showSignupStep(stepId) {
  const steps = [signupStepDetails, signupStepOtp, signupStepPassword];
  steps.forEach(step => {
    if (step) {
      if (step.id === stepId) {
        step.classList.remove("hidden");
      } else {
        step.classList.add("hidden");
      }
    }
  });
}

let pendingPassword = "";

// If password setup is pending on load, open the modal to Step 3 only if session exists
if (isConfigured && sessionStorage.getItem('password_setup_pending') === 'true') {
  hasActiveSession().then((active) => {
    if (active && signupModal) {
      signupModal.classList.add("active");
      showSignupStep("signup-step-password");
      if (inputSetupPassword) inputSetupPassword.value = "";
      if (inputSetupConfirmPassword) inputSetupConfirmPassword.value = "";
    } else {
      sessionStorage.removeItem('password_setup_pending');
    }
  });
}

// ------------------------------------------
// Sign In Modal Event Listeners
// ------------------------------------------
// Toast notifications on landing page (standalone helper)
function showLandingToast(message, type = "info", duration = 4000) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="btn-close-toast">&times;</button>
  `;
  container.appendChild(toast);
  toast.querySelector(".btn-close-toast").addEventListener("click", () => {
    toast.classList.add("toast-out");
    toast.addEventListener("animationend", () => toast.remove());
  });
  if (duration > 0) {
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add("toast-out");
        toast.addEventListener("animationend", () => toast.remove());
      }
    }, duration);
  }
  return toast;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.innerText = str;
  return div.innerHTML;
}

if (emailLoginTrigger) {
  emailLoginTrigger.addEventListener("click", (e) => {
    e.preventDefault();
    
    // Shake animation logic
    emailLoginTrigger.classList.remove("shake-anim");
    void emailLoginTrigger.offsetWidth; // Trigger reflow to restart animation
    emailLoginTrigger.classList.add("shake-anim");
    
    showLandingToast("Help Creator to buy domain to make this option live", "warning");
  });
}

if (closeSigninModalBtn) {
  closeSigninModalBtn.addEventListener("click", () => {
    signinModal.classList.remove("active");
  });
}

function openSignupModal(prefillEmail) {
  if (signinModal) signinModal.classList.remove("active");
  if (forgotModal) forgotModal.classList.remove("active");
  if (signupModal) {
    signupModal.classList.add("active");
    showSignupStep("signup-step-details");
    if (detailsError) detailsError.classList.add("hidden");
    if (signupEmailExistsNotice) signupEmailExistsNotice.classList.add("hidden");
    if (inputSignupName) inputSignupName.value = "";
    if (inputSignupEmail) inputSignupEmail.value = prefillEmail || "";
  }
}

function openSigninModal(prefillEmail) {
  if (signupModal) signupModal.classList.remove("active");
  if (forgotModal) forgotModal.classList.remove("active");
  if (signinModal) {
    signinModal.classList.add("active");
    if (signinError) signinError.classList.add("hidden");
    if (inputSigninEmail) inputSigninEmail.value = prefillEmail || "";
    if (inputSigninPassword) inputSigninPassword.value = "";
  }
}

function showForgotStep(stepId) {
  [forgotStepEmail, forgotStepOtp, forgotStepPassword].forEach(el => {
    if (el) el.classList.toggle("hidden", el.id !== stepId);
  });
}

function openForgotModal(prefillEmail) {
  if (signupModal) signupModal.classList.remove("active");
  if (signinModal) signinModal.classList.remove("active");
  if (forgotModal) {
    forgotModal.classList.add("active");
    showForgotStep("forgot-step-email");
    const notFoundNotice = document.getElementById("forgot-email-not-found-notice");
    if (notFoundNotice) notFoundNotice.classList.add("hidden");
    if (forgotEmailError) { forgotEmailError.classList.add("hidden"); forgotEmailError.textContent = ""; }
    if (forgotOtpError) { forgotOtpError.classList.add("hidden"); forgotOtpError.textContent = ""; }
    if (forgotPasswordError) { forgotPasswordError.classList.add("hidden"); forgotPasswordError.textContent = ""; }
    if (inputForgotEmail) inputForgotEmail.value = prefillEmail || "";
    if (inputForgotOtp) inputForgotOtp.value = "";
    if (inputResetNewPassword) inputResetNewPassword.value = "";
    if (inputResetConfirmPassword) inputResetConfirmPassword.value = "";
  }
}

if (linkGotoSignup) {
  linkGotoSignup.addEventListener("click", (e) => {
    e.preventDefault();
    openSignupModal();
  });
}

if (linkGotoSignin) {
  linkGotoSignin.addEventListener("click", (e) => {
    e.preventDefault();
    openSigninModal();
  });
}

if (linkForgotPassword) {
  linkForgotPassword.addEventListener("click", (e) => {
    e.preventDefault();
    const email = inputSigninEmail ? inputSigninEmail.value.trim() : "";
    openForgotModal(email);
  });
}

if (linkSigninFromExists) {
  linkSigninFromExists.addEventListener("click", (e) => {
    e.preventDefault();
    const email = inputSignupEmail ? inputSignupEmail.value.trim() : "";
    openSigninModal(email);
  });
}

if (linkForgotFromExists) {
  linkForgotFromExists.addEventListener("click", (e) => {
    e.preventDefault();
    const email = inputSignupEmail ? inputSignupEmail.value.trim() : "";
    openForgotModal(email);
  });
}

const linkCreateFromForgot = document.getElementById("link-create-from-forgot");
if (linkCreateFromForgot) {
  linkCreateFromForgot.addEventListener("click", (e) => {
    e.preventDefault();
    const email = inputForgotEmail ? inputForgotEmail.value.trim() : "";
    openSignupModal(email);
  });
}

// Forgot modal — close button
if (closeForgotModalBtn) {
  closeForgotModalBtn.addEventListener("click", () => {
    if (forgotModal) forgotModal.classList.remove("active");
  });
}

// Forgot modal — "Back to Sign In" from Step 1
if (linkBackToSignin) {
  linkBackToSignin.addEventListener("click", (e) => {
    e.preventDefault();
    openSigninModal(inputForgotEmail ? inputForgotEmail.value.trim() : "");
  });
}

// Forgot modal — "Back" button from Step 2
const btnForgotBackToEmail = document.getElementById("btn-forgot-back-to-email");
if (btnForgotBackToEmail) {
  btnForgotBackToEmail.addEventListener("click", () => {
    showForgotStep("forgot-step-email");
  });
}

// ---- Forgot Step 1: Send OTP ----
let forgotPendingEmail = "";

if (formForgotEmail) {
  if (inputForgotEmail) {
    inputForgotEmail.addEventListener("input", () => {
      if (forgotEmailError) { forgotEmailError.classList.add("hidden"); forgotEmailError.textContent = ""; }
      const notFoundNotice = document.getElementById("forgot-email-not-found-notice");
      if (notFoundNotice) notFoundNotice.classList.add("hidden");
    });
  }

  formForgotEmail.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (forgotEmailError) { forgotEmailError.classList.add("hidden"); forgotEmailError.textContent = ""; }
    const notFoundNotice = document.getElementById("forgot-email-not-found-notice");
    if (notFoundNotice) notFoundNotice.classList.add("hidden");

    const email = inputForgotEmail ? inputForgotEmail.value.trim() : "";
    if (!email) return;

    const btn = document.getElementById("btn-send-reset-otp");
    const orig = btn ? btn.textContent : "Send Verification Code";
    if (btn) { btn.textContent = "Checking..."; btn.style.pointerEvents = "none"; }

    try {
      // Perform explicit check first
      const exists = await checkEmailExists(email);
      if (!exists) {
        if (notFoundNotice) notFoundNotice.classList.remove("hidden");
        return;
      }

      if (btn) btn.textContent = "Sending...";
      await sendPasswordResetOtp(email);
      forgotPendingEmail = email;
      if (forgotSentEmailLabel) forgotSentEmailLabel.textContent = email;
      if (inputForgotOtp) inputForgotOtp.value = "";
      showForgotStep("forgot-step-otp");
    } catch (err) {
      console.error(err);
      if (forgotEmailError) {
        forgotEmailError.textContent = err.message || "Failed to send code. Please try again.";
        forgotEmailError.classList.remove("hidden");
      }
    } finally {
      if (btn) { btn.textContent = orig; btn.style.pointerEvents = "all"; }
    }
  });
}

// ---- Forgot Step 2: Verify OTP ----
if (formForgotOtp) {
  if (inputForgotOtp) {
    inputForgotOtp.addEventListener("input", () => {
      if (forgotOtpError) { forgotOtpError.classList.add("hidden"); forgotOtpError.textContent = ""; }
    });
  }

  formForgotOtp.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (forgotOtpError) { forgotOtpError.classList.add("hidden"); forgotOtpError.textContent = ""; }

    const code = inputForgotOtp ? inputForgotOtp.value.trim() : "";
    if (!code) return;

    const btn = document.getElementById("btn-verify-reset-otp");
    const orig = btn ? btn.textContent : "Verify Code";
    if (btn) { btn.textContent = "Verifying..."; btn.style.pointerEvents = "none"; }

    // Intercept redirect race condition
    sessionStorage.setItem('password_setup_pending', 'true');

    try {
      await verifyPasswordResetOtp(forgotPendingEmail, code);
      // OTP verified — session is now active, move to set-password step
      if (inputResetNewPassword) inputResetNewPassword.value = "";
      if (inputResetConfirmPassword) inputResetConfirmPassword.value = "";
      if (forgotPasswordError) { forgotPasswordError.classList.add("hidden"); forgotPasswordError.textContent = ""; }
      showForgotStep("forgot-step-password");
    } catch (err) {
      console.error(err);
      sessionStorage.removeItem('password_setup_pending');
      if (forgotOtpError) {
        forgotOtpError.textContent = "Invalid or expired code. Please try again.";
        forgotOtpError.classList.remove("hidden");
      }
    } finally {
      if (btn) { btn.textContent = orig; btn.style.pointerEvents = "all"; }
    }
  });
}

// ---- Forgot Step 3: Set New Password ----
if (formForgotNewPassword) {
  [inputResetNewPassword, inputResetConfirmPassword].forEach(input => {
    if (input) {
      input.addEventListener("input", () => {
        if (forgotPasswordError) { forgotPasswordError.classList.add("hidden"); forgotPasswordError.textContent = ""; }
      });
    }
  });

  formForgotNewPassword.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (forgotPasswordError) { forgotPasswordError.classList.add("hidden"); forgotPasswordError.textContent = ""; }

    const password = inputResetNewPassword ? inputResetNewPassword.value : "";
    const confirm  = inputResetConfirmPassword ? inputResetConfirmPassword.value : "";

    if (!password || !confirm) {
      if (forgotPasswordError) { forgotPasswordError.textContent = "Please fill in both fields."; forgotPasswordError.classList.remove("hidden"); }
      return;
    }
    if (password.length < 6) {
      if (forgotPasswordError) { forgotPasswordError.textContent = "Password must be at least 6 characters."; forgotPasswordError.classList.remove("hidden"); }
      return;
    }
    if (password !== confirm) {
      if (forgotPasswordError) { forgotPasswordError.textContent = "Passwords don't match."; forgotPasswordError.classList.remove("hidden"); }
      return;
    }

    const btn = document.getElementById("btn-set-new-password");
    const orig = btn ? btn.textContent : "Save Password & Access Dashboard";
    if (btn) { btn.textContent = "Saving..."; btn.style.pointerEvents = "none"; }

    try {
      await updateUserPassword(password);
      sessionStorage.removeItem('password_setup_pending');
      window.location.href = "dashboard.html";
    } catch (err) {
      console.error(err);
      if (forgotPasswordError) {
        forgotPasswordError.textContent = err.message || "Failed to update password. Please try again.";
        forgotPasswordError.classList.remove("hidden");
      }
      if (btn) { btn.textContent = orig; btn.style.pointerEvents = "all"; }
    }
  });
}

const linkForgotSkipPassword = document.getElementById("link-forgot-skip-password");
if (linkForgotSkipPassword) {
  linkForgotSkipPassword.addEventListener("click", (e) => {
    e.preventDefault();
    sessionStorage.removeItem('password_setup_pending');
    window.location.href = "dashboard.html";
  });
}


if (formSignin) {
  formSignin.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!signinError) return;
    signinError.classList.add("hidden");

    const email = inputSigninEmail.value.trim();
    const password = inputSigninPassword.value;

    const btnSigninSubmit = document.getElementById("btn-signin-submit");
    const originalText = btnSigninSubmit.textContent;
    btnSigninSubmit.textContent = "Logging in...";
    btnSigninSubmit.style.pointerEvents = "none";

    try {
      await signInWithEmail(email, password);
      signinModal.classList.remove("active");
      window.location.href = "dashboard.html";
    } catch (err) {
      console.error(err);
      signinError.textContent = "Invalid email or password.";
      signinError.classList.remove("hidden");
    } finally {
      btnSigninSubmit.textContent = originalText;
      btnSigninSubmit.style.pointerEvents = "all";
    }
  });
}

// ------------------------------------------
// Sign Up Modal Event Listeners
// ------------------------------------------
if (closeSignupModalBtn) {
  closeSignupModalBtn.addEventListener("click", () => {
    signupModal.classList.remove("active");
    sessionStorage.removeItem('password_setup_pending');
  });
}

if (backToDetailsBtn) {
  backToDetailsBtn.addEventListener("click", () => {
    showSignupStep("signup-step-details");
  });
}

// Step 1: Details Submission (Name + Email only — passwords moved to Step 3)
if (formSignupDetails) {
  // Hide exists notice whenever user edits the email field
  if (inputSignupEmail) {
    inputSignupEmail.addEventListener("input", () => {
      if (signupEmailExistsNotice) signupEmailExistsNotice.classList.add("hidden");
      if (detailsError) detailsError.classList.add("hidden");
    });
  }

  formSignupDetails.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (detailsError) detailsError.classList.add("hidden");
    if (signupEmailExistsNotice) signupEmailExistsNotice.classList.add("hidden");

    const name = inputSignupName ? inputSignupName.value.trim() : "";
    const email = inputSignupEmail ? inputSignupEmail.value.trim() : "";

    if (!name) {
      if (detailsError) { detailsError.textContent = "Please enter your name."; detailsError.classList.remove("hidden"); }
      return;
    }
    if (!email) {
      if (detailsError) { detailsError.textContent = "Please enter your email."; detailsError.classList.remove("hidden"); }
      return;
    }

    const btnSendOtp = document.getElementById("btn-send-otp");
    const originalText = btnSendOtp ? btnSendOtp.textContent : "Send Verification Code";
    if (btnSendOtp) { btnSendOtp.textContent = "Checking..."; btnSendOtp.style.pointerEvents = "none"; }

    try {
      // Check if email is already registered before sending OTP
      const exists = await checkEmailExists(email);
      if (exists) {
        if (signupEmailExistsNotice) signupEmailExistsNotice.classList.remove("hidden");
        return;
      }

      if (btnSendOtp) btnSendOtp.textContent = "Sending Code...";
      await signUpWithOtp(name, email);
      if (sentEmailLabel) sentEmailLabel.textContent = email;
      showSignupStep("signup-step-otp");
    } catch (err) {
      console.error(err);
      if (detailsError) {
        detailsError.textContent = err.message || "Failed to send code. Please try again.";
        detailsError.classList.remove("hidden");
      }
    } finally {
      if (btnSendOtp) { btnSendOtp.textContent = originalText; btnSendOtp.style.pointerEvents = "all"; }
    }
  });
}

// Step 2: OTP Verification
if (formSignupOtp) {
  formSignupOtp.addEventListener("submit", async (e) => {
    e.preventDefault();
    otpError.classList.add("hidden");
    passwordError.classList.add("hidden");
    
    const email = inputSignupEmail.value.trim();
    const code = inputSignupOtp.value.trim();
    
    const btnVerifyOtp = document.getElementById("btn-verify-otp");
    const originalText = btnVerifyOtp.textContent;
    btnVerifyOtp.textContent = "Verifying...";
    btnVerifyOtp.style.pointerEvents = "none";
    
    // Set the flag BEFORE verifyOtpCode triggers, to intercept the redirect race condition
    sessionStorage.setItem('password_setup_pending', 'true');
    
    let verified = false;
    try {
      await verifyOtpCode(email, code);
      verified = true;
    } catch (err) {
      console.error(err);
      sessionStorage.removeItem('password_setup_pending');
      otpError.textContent = err.message || "Invalid or expired verification code.";
      otpError.classList.remove("hidden");
      btnVerifyOtp.textContent = originalText;
      btnVerifyOtp.style.pointerEvents = "all";
      return;
    }

    if (verified) {
      showSignupStep("signup-step-password");
      btnVerifyOtp.textContent = originalText;
      btnVerifyOtp.style.pointerEvents = "all";
    }
  });
}

// Step 3: Password Completion
if (formSignupPassword) {
  // Clear error when user edits fields
  if (inputSetupPassword) {
    inputSetupPassword.addEventListener("input", () => {
      passwordError.classList.add("hidden");
      passwordError.textContent = "";
    });
  }
  if (inputSetupConfirmPassword) {
    inputSetupConfirmPassword.addEventListener("input", () => {
      passwordError.classList.add("hidden");
      passwordError.textContent = "";
    });
  }

  formSignupPassword.addEventListener("submit", async (e) => {
    e.preventDefault();
    passwordError.classList.add("hidden");
    passwordError.textContent = "";
    
    const password = inputSetupPassword.value;
    const confirmPassword = inputSetupConfirmPassword.value;
    
    if (!password || !confirmPassword) {
      passwordError.textContent = "Please enter a password.";
      passwordError.classList.remove("hidden");
      return;
    }
    
    if (password.length < 6) {
      passwordError.textContent = "Password must be at least 6 characters.";
      passwordError.classList.remove("hidden");
      return;
    }
    
    if (password !== confirmPassword) {
      passwordError.textContent = "Passwords don't match.";
      passwordError.classList.remove("hidden");
      return;
    }
    
    const btnCompleteSetup = document.getElementById("btn-complete-setup");
    const originalText = btnCompleteSetup.textContent;
    btnCompleteSetup.textContent = "Setting Password...";
    btnCompleteSetup.style.pointerEvents = "none";
    
    try {
      await updateUserPassword(password);
      sessionStorage.removeItem('password_setup_pending');
      window.location.href = "dashboard.html";
    } catch (err) {
      console.error(err);
      passwordError.textContent = err.message || "Failed to set password. Please try again.";
      passwordError.classList.remove("hidden");
    } finally {
      btnCompleteSetup.textContent = originalText;
      btnCompleteSetup.style.pointerEvents = "all";
    }
  });
}

const linkSignupSkipPassword = document.getElementById("link-signup-skip-password");
if (linkSignupSkipPassword) {
  linkSignupSkipPassword.addEventListener("click", (e) => {
    e.preventDefault();
    sessionStorage.removeItem('password_setup_pending');
    window.location.href = "dashboard.html";
  });
}

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
