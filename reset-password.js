// reset-password.js
// Handles the Supabase PASSWORD_RECOVERY flow on the dedicated reset page.
import { supabase } from "./supabase-config.js";

const stateLoading = document.getElementById("state-loading");
const stateInvalid = document.getElementById("state-invalid");
const stateForm    = document.getElementById("state-form");
const stateSuccess = document.getElementById("state-success");

const formReset          = document.getElementById("form-reset-password");
const inputNewPassword   = document.getElementById("input-new-password");
const inputConfirmNew    = document.getElementById("input-confirm-new-password");
const resetError         = document.getElementById("reset-error");
const btnResetSubmit     = document.getElementById("btn-reset-submit");

function showState(id) {
  [stateLoading, stateInvalid, stateForm, stateSuccess].forEach(el => {
    if (el) el.classList.toggle("hidden", el.id !== id);
  });
}

// Supabase writes the recovery token into the URL hash as:
//   #access_token=...&type=recovery&...
// detectSessionInUrl:true in supabase-config.js causes Supabase to
// automatically exchange that hash for a valid session before firing
// the PASSWORD_RECOVERY event.

let recoveryHandled = false;

const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") {
    recoveryHandled = true;
    showState("state-form");
  } else if (event === "SIGNED_IN" && !recoveryHandled) {
    // A normal sign-in session landed here — redirect to dashboard
    window.location.href = "dashboard.html";
  }
});

// Fallback: if no recovery event fires within 4 seconds, show the invalid-link state
const fallbackTimer = setTimeout(() => {
  if (!recoveryHandled) {
    showState("state-invalid");
  }
}, 4000);

// Clear the timer if recovery was found quickly
supabase.auth.getSession().then(({ data: { session } }) => {
  // Nothing to do here — onAuthStateChange handles it.
  // If session is null and no event fires, the fallback timer will trigger.
});

// Form submission
if (formReset) {
  [inputNewPassword, inputConfirmNew].forEach(input => {
    if (input) {
      input.addEventListener("input", () => {
        if (resetError) { resetError.classList.add("hidden"); resetError.textContent = ""; }
      });
    }
  });

  formReset.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (resetError) { resetError.classList.add("hidden"); resetError.textContent = ""; }

    const password = inputNewPassword ? inputNewPassword.value : "";
    const confirm  = inputConfirmNew  ? inputConfirmNew.value  : "";

    if (!password || !confirm) {
      if (resetError) { resetError.textContent = "Please fill in both fields."; resetError.classList.remove("hidden"); }
      return;
    }
    if (password.length < 6) {
      if (resetError) { resetError.textContent = "Password must be at least 6 characters."; resetError.classList.remove("hidden"); }
      return;
    }
    if (password !== confirm) {
      if (resetError) { resetError.textContent = "Passwords do not match."; resetError.classList.remove("hidden"); }
      return;
    }

    if (btnResetSubmit) { btnResetSubmit.textContent = "Updating..."; btnResetSubmit.disabled = true; }

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      clearTimeout(fallbackTimer);
      subscription.unsubscribe();

      showState("state-success");

      // Auto-redirect after 3 seconds
      setTimeout(() => {
        window.location.href = "index.html";
      }, 3000);

    } catch (err) {
      console.error("Password update failed:", err);
      if (resetError) {
        resetError.textContent = err.message || "Failed to update password. Please try again.";
        resetError.classList.remove("hidden");
      }
      if (btnResetSubmit) { btnResetSubmit.textContent = "Update Password"; btnResetSubmit.disabled = false; }
    }
  });
}
