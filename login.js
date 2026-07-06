// login.js
import { isConfigured } from "./supabase-config.js";
import { loginWithGoogle, initAuthProtection, enterGuestMode, signUpWithOtp, verifyOtpCode, updateUserPassword, hasActiveSession, signInWithEmail } from "./auth.js";

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
const inputSignupPassword = document.getElementById("input-signup-password");
const inputSignupConfirmPassword = document.getElementById("input-signup-confirm-password");
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
if (emailLoginTrigger) {
  emailLoginTrigger.addEventListener("click", () => {
    if (signinModal) {
      signinModal.classList.add("active");
      signinError.classList.add("hidden");
      inputSigninEmail.value = "";
      inputSigninPassword.value = "";
    }
  });
}

if (closeSigninModalBtn) {
  closeSigninModalBtn.addEventListener("click", () => {
    signinModal.classList.remove("active");
  });
}

if (linkGotoSignup) {
  linkGotoSignup.addEventListener("click", (e) => {
    e.preventDefault();
    if (signinModal) signinModal.classList.remove("active");
    if (signupModal) {
      signupModal.classList.add("active");
      showSignupStep("signup-step-details");
      detailsError.classList.add("hidden");
      inputSignupName.value = "";
      inputSignupEmail.value = "";
      inputSignupPassword.value = "";
      inputSignupConfirmPassword.value = "";
    }
  });
}

if (linkGotoSignin) {
  linkGotoSignin.addEventListener("click", (e) => {
    e.preventDefault();
    if (signupModal) signupModal.classList.remove("active");
    if (signinModal) {
      signinModal.classList.add("active");
      signinError.classList.add("hidden");
      inputSigninEmail.value = "";
      inputSigninPassword.value = "";
    }
  });
}

if (linkForgotPassword) {
  linkForgotPassword.addEventListener("click", (e) => {
    e.preventDefault();
    alert("Password recovery is not implemented yet.");
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

// Step 1: Details Submission
if (formSignupDetails) {
  formSignupDetails.addEventListener("submit", async (e) => {
    e.preventDefault();
    detailsError.classList.add("hidden");
    
    const name = inputSignupName.value.trim();
    const email = inputSignupEmail.value.trim();
    const password = inputSignupPassword.value;
    const confirmPassword = inputSignupConfirmPassword.value;

    if (password !== confirmPassword) {
      detailsError.textContent = "Passwords do not match.";
      detailsError.classList.remove("hidden");
      return;
    }
    
    if (password.length < 6) {
      detailsError.textContent = "Password must be at least 6 characters.";
      detailsError.classList.remove("hidden");
      return;
    }

    const btnSendOtp = document.getElementById("btn-send-otp");
    const originalText = btnSendOtp.textContent;
    btnSendOtp.textContent = "Sending Code...";
    btnSendOtp.style.pointerEvents = "none";
    
    try {
      await signUpWithOtp(name, email);
      pendingPassword = password; // Hold password in memory
      sentEmailLabel.textContent = email;
      showSignupStep("signup-step-otp");
    } catch (err) {
      console.error(err);
      detailsError.textContent = err.message || "Failed to send code. Please try again.";
      detailsError.classList.remove("hidden");
    } finally {
      btnSendOtp.textContent = originalText;
      btnSendOtp.style.pointerEvents = "all";
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
      try {
        // Automatically finalize password setup using the memory variable
        if (pendingPassword) {
          btnVerifyOtp.textContent = "Completing Setup...";
          await updateUserPassword(pendingPassword);
          
          sessionStorage.removeItem('password_setup_pending');
          window.location.href = "dashboard.html";
        } else {
          // If no pending password in memory, transition to Step 3
          showSignupStep("signup-step-password");
          btnVerifyOtp.textContent = originalText;
          btnVerifyOtp.style.pointerEvents = "all";
        }
      } catch (err) {
        console.error("Failed to set password auto-flow:", err);
        // Show error on the password screen, and transition to Step 3 so they can set a different password
        passwordError.textContent = "That password wasn't accepted, please choose a different one.";
        passwordError.classList.remove("hidden");
        // Leave fields empty as per requirements
        inputSetupPassword.value = "";
        inputSetupConfirmPassword.value = "";
        showSignupStep("signup-step-password");
        
        btnVerifyOtp.textContent = originalText;
        btnVerifyOtp.style.pointerEvents = "all";
      }
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
