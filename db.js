// db.js
import { db, isConfigured } from "./firebase-config.js";
import { isGuestMode } from "./auth.js";
import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Helper to get/set local storage bars for Sandbox mode
export function getLocalBars() {
  const data = localStorage.getItem("progress_shelf_bars");
  return data ? JSON.parse(data) : [];
}

function setLocalBars(bars) {
  localStorage.setItem("progress_shelf_bars", JSON.stringify(bars));
}

// Listeners collection for Sandbox updates
let mockListeners = [];

function triggerMockUpdate() {
  const bars = getLocalBars();
  mockListeners.forEach(listener => {
    try {
      listener(bars);
    } catch (e) {
      console.error("Mock listener update failed", e);
    }
  });
}

/**
 * Subscribes to real-time updates for a user's progress bars.
 * @param {string} uid The user ID.
 * @param {Function} onUpdate Callback invoked with updated array of bars.
 * @param {Function} onError Callback invoked on error.
 * @returns {Function} Unsubscribe function to stop listening.
 */
export function subscribeToBars(uid, onUpdate, onError) {
  if (!isConfigured || isGuestMode()) {
    mockListeners.push(onUpdate);
    // Trigger initial load callback asynchronously
    setTimeout(() => {
      onUpdate(getLocalBars());
    }, 100);
    
    // Return unsubscribe callback
    return () => {
      mockListeners = mockListeners.filter(l => l !== onUpdate);
    };
  }
  
  try {
    const barsRef = collection(db, "users", uid, "bars");
    const q = query(barsRef, orderBy("createdAt", "asc"));
    
    return onSnapshot(q, (snapshot) => {
      const bars = [];
      snapshot.forEach((doc) => {
        bars.push({
          id: doc.id,
          ...doc.data()
        });
      });
      onUpdate(bars);
    }, (error) => {
      console.error("Firestore subscription error:", error);
      if (onError) onError(error);
    });
  } catch (error) {
    console.error("Failed to setup Firestore subscription:", error);
    if (onError) onError(error);
    return () => {};
  }
}

/**
 * Creates a new progress bar document.
 * @param {string} uid The user ID.
 * @param {Object} barData The progress bar data object.
 * @returns {Promise<string>} The auto-generated bar ID.
 */
export async function createBar(uid, {
  title, preset, levels,
  targetSmallest, currentSmallest,
  deadlineTimestamp
}) {
  if (!isConfigured || isGuestMode()) {
    const bars = getLocalBars();
    const newBar = {
      id: "bar_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9),
      title,
      preset,
      levels,
      targetSmallest: Number(targetSmallest),
      currentSmallest: Number(currentSmallest),
      deadline: deadlineTimestamp || null,
      createdAt: Date.now(),
      lastUpdated: Date.now()
    };
    bars.push(newBar);
    setLocalBars(bars);
    triggerMockUpdate();
    return newBar.id;
  }
  
  try {
    const barsRef = collection(db, "users", uid, "bars");
    const docRef = await addDoc(barsRef, {
      title,
      preset,
      levels,
      targetSmallest: Number(targetSmallest),
      currentSmallest: Number(currentSmallest),
      deadline: deadlineTimestamp
        ? new Date(deadlineTimestamp)
        : null,
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    console.error("Error creating progress bar:", error);
    throw error;
  }
}

/**
 * Updates the current progress level and timestamp of a bar.
 * @param {string} uid The user ID.
 * @param {string} barId The ID of the progress bar document.
 * @param {number} currentSmallest The new current progress in the smallest unit.
 */
export async function updateBarProgress(uid, barId, currentSmallest) {
  if (!isConfigured || isGuestMode()) {
    const bars = getLocalBars();
    const barIndex = bars.findIndex(b => b.id === barId);
    if (barIndex !== -1) {
      bars[barIndex].currentSmallest = Number(currentSmallest);
      bars[barIndex].lastUpdated = Date.now();
      setLocalBars(bars);
      triggerMockUpdate();
    } else {
      throw new Error(`Bar not found: ${barId}`);
    }
    return;
  }
  
  try {
    const barDocRef = doc(db, "users", uid, "bars", barId);
    await updateDoc(barDocRef, {
      currentSmallest: Number(currentSmallest),
      lastUpdated: serverTimestamp()
    });
  } catch (error) {
    console.error("Error updating progress bar:", error);
    throw error;
  }
}

/**
 * Deletes a progress bar document.
 * @param {string} uid The user ID.
 * @param {string} barId The ID of the progress bar document.
 */
export async function deleteBar(uid, barId) {
  if (!isConfigured || isGuestMode()) {
    const bars = getLocalBars().filter(b => b.id !== barId);
    setLocalBars(bars);
    triggerMockUpdate();
    return;
  }
  
  try {
    const barDocRef = doc(db, "users", uid, "bars", barId);
    await deleteDoc(barDocRef);
  } catch (error) {
    console.error("Error deleting progress bar:", error);
    throw error;
  }
}

export async function editBar(uid, barId, {
  title, levels, targetSmallest, deadlineTimestamp
}) {
  if (!isConfigured || isGuestMode()) {
    const bars = getLocalBars();
    const idx = bars.findIndex(b => b.id === barId);
    if (idx !== -1) {
      bars[idx] = {
        ...bars[idx],
        title,
        levels,
        targetSmallest: Number(targetSmallest),
        deadline: deadlineTimestamp || null,
        lastUpdated: Date.now()
      };
      setLocalBars(bars);
      triggerMockUpdate();
    }
    return;
  }

  try {
    const barDocRef = doc(db, "users", uid, "bars", barId);
    await updateDoc(barDocRef, {
      title,
      levels,
      targetSmallest: Number(targetSmallest),
      deadline: deadlineTimestamp
        ? new Date(deadlineTimestamp)
        : null,
      lastUpdated: serverTimestamp()
    });
  } catch (error) {
    console.error("Error editing bar:", error);
    throw error;
  }
}

