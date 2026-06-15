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
    return () => { };
  }
}

/**
 * Creates a new progress bar document.
 * @param {string} uid The user ID.
 * @param {Object} barData The progress bar data object.
 * @returns {Promise<string>} The auto-generated bar ID.
 */
export async function createBar(uid, { title, type, preset, levels, targetSmallest, currentSmallest, items, text, completed, deadlineAt, deadlineSetAt }) {
  if (!isConfigured || isGuestMode()) {
    const bars = getLocalBars();
    const now = Date.now();
    const newBar = {
      id: "bar_" + now + "_" + Math.random().toString(36).substr(2, 9),
      title,
      type: type || "goal",
      preset: preset || null,
      levels: levels || null,
      targetSmallest: targetSmallest !== null && targetSmallest !== undefined ? Number(targetSmallest) : null,
      currentSmallest: currentSmallest !== null && currentSmallest !== undefined ? Number(currentSmallest) : null,
      items: items || null,
      text: text || null,
      completed: completed || false,
      createdAt: now,
      lastUpdated: now,
      deadlineAt: deadlineAt || null,
      deadlineSetAt: deadlineAt ? (deadlineSetAt || now) : null
    };
    bars.push(newBar);
    setLocalBars(bars);
    triggerMockUpdate();
    return newBar.id;
  }

  try {
    const barsRef = collection(db, "users", uid, "bars");
    const now = new Date();
    const docRef = await addDoc(barsRef, {
      title,
      type: type || "goal",
      preset: preset || null,
      levels: levels || null,
      targetSmallest: targetSmallest !== null && targetSmallest !== undefined ? Number(targetSmallest) : null,
      currentSmallest: currentSmallest !== null && currentSmallest !== undefined ? Number(currentSmallest) : null,
      items: items || null,
      text: text || null,
      completed: completed || false,
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp(),
      deadlineAt: deadlineAt ? new Date(deadlineAt) : null,
      deadlineSetAt: deadlineAt ? (deadlineSetAt ? new Date(deadlineSetAt) : now) : null
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
export async function updateBarProgress(uid, barId, currentSmallest, completed) {
  if (!isConfigured || isGuestMode()) {
    const bars = getLocalBars();
    const barIndex = bars.findIndex(b => b.id === barId);
    if (barIndex !== -1) {
      bars[barIndex].currentSmallest = Number(currentSmallest);
      bars[barIndex].completed = completed;
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
      completed: completed,
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
  title, levels, targetSmallest, currentSmallest, items, text, completed, deadlineAt, updateDeadline
}) {
  if (!isConfigured || isGuestMode()) {
    const bars = getLocalBars();
    const idx = bars.findIndex(b => b.id === barId);
    if (idx !== -1) {
      const original = bars[idx];
      let newDeadlineAt = original.deadlineAt;
      let newDeadlineSetAt = original.deadlineSetAt;

      if (updateDeadline) {
        if (deadlineAt) {
          newDeadlineAt = deadlineAt;
          newDeadlineSetAt = Date.now();
        } else {
          newDeadlineAt = null;
          newDeadlineSetAt = null;
        }
      }

      bars[idx] = {
        ...original,
        title,
        levels: levels !== undefined ? levels : original.levels,
        targetSmallest: targetSmallest !== null && targetSmallest !== undefined ? Number(targetSmallest) : null,
        currentSmallest: currentSmallest !== null && currentSmallest !== undefined ? Number(currentSmallest) : null,
        items: items !== undefined ? items : original.items,
        text: text !== undefined ? text : original.text,
        completed: completed !== undefined ? completed : original.completed,
        lastUpdated: Date.now(),
        deadlineAt: newDeadlineAt,
        deadlineSetAt: newDeadlineSetAt
      };
      setLocalBars(bars);
      triggerMockUpdate();
    }
    return;
  }

  try {
    const barDocRef = doc(db, "users", uid, "bars", barId);
    const now = new Date();
    
    const updates = {
      title,
      lastUpdated: serverTimestamp()
    };

    if (levels !== undefined) updates.levels = levels;
    if (targetSmallest !== null && targetSmallest !== undefined) updates.targetSmallest = Number(targetSmallest);
    if (currentSmallest !== null && currentSmallest !== undefined) updates.currentSmallest = Number(currentSmallest);
    if (items !== undefined) updates.items = items;
    if (text !== undefined) updates.text = text;
    if (completed !== undefined) updates.completed = completed;

    if (updateDeadline) {
      if (deadlineAt) {
        updates.deadlineAt = new Date(deadlineAt);
        updates.deadlineSetAt = now;
      } else {
        updates.deadlineAt = null;
        updates.deadlineSetAt = null;
      }
    }

    await updateDoc(barDocRef, updates);
  } catch (error) {
    console.error("Error editing bar:", error);
    throw error;
  }
}


