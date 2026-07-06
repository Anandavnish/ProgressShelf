// db.js
import { supabase, isConfigured } from "./supabase-config.js";
import { isGuestMode } from "./auth.js";

const writeQueues = new Map(); // barId -> latest pending write promise

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

function mapDatabaseRow(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    preset: row.preset,
    levels: row.levels,
    targetSmallest: row.target_smallest !== null ? Number(row.target_smallest) : null,
    currentSmallest: row.current_smallest !== null ? Number(row.current_smallest) : null,
    items: row.items,
    text: row.text,
    completed: row.completed,
    deadlineAt: row.deadline_at ? new Date(row.deadline_at).getTime() : null,
    deadlineSetAt: row.deadline_set_at ? new Date(row.deadline_set_at).getTime() : null,
    notifyAt: row.notify_at ? new Date(row.notify_at).getTime() : null,
    notified: row.notified,
    notifyPercent: row.notify_percent !== null ? Number(row.notify_percent) : null,
    alertAtDeadline: row.alert_at_deadline || false,
    deadlineNotified: row.deadline_notified || false,
    position: row.position !== null && row.position !== undefined ? Number(row.position) : 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : (row.last_updated ? new Date(row.last_updated).getTime() : null),
    lastUpdated: row.last_updated ? new Date(row.last_updated).getTime() : null
  };
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

  let cachedBars = [];

  // Initial fetch and callback helper
  const fetchInitial = async () => {
    try {
      const { data, error } = await supabase
        .from('trackers')
        .select('*')
        .eq('user_id', uid);

      if (error) throw error;

      cachedBars = (data || []).map(mapDatabaseRow);
      onUpdate(cachedBars);
    } catch (err) {
      console.error("Error fetching trackers:", err);
      if (onError) onError(err);
    }
  };

  // Perform initial fetch
  fetchInitial();

  // Subscribe to real-time changes
  const channel = supabase
    .channel(`trackers-user-${uid}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'trackers' },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload;
        
        if (eventType === 'INSERT') {
          if (newRow.user_id === uid) {
            const mapped = mapDatabaseRow(newRow);
            if (!cachedBars.some(b => b.id === mapped.id)) {
              cachedBars.push(mapped);
            }
          }
        } else if (eventType === 'UPDATE') {
          if (newRow.user_id === uid) {
            const mapped = mapDatabaseRow(newRow);
            const idx = cachedBars.findIndex(b => b.id === mapped.id);
            if (idx !== -1) {
              cachedBars[idx] = mapped;
            } else {
              cachedBars.push(mapped);
            }
          }
        } else if (eventType === 'DELETE') {
          const deleteId = oldRow.id;
          cachedBars = cachedBars.filter(b => b.id !== deleteId);
        }
        
        onUpdate(cachedBars);
      }
    )
    .subscribe();

  // Return unsubscribe callback
  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Creates a new progress bar document.
 * @param {string} uid The user ID.
 * @param {Object} barData The progress bar data object.
 * @returns {Promise<string>} The auto-generated bar ID.
 */
export async function createBar(uid, {
  title, type, preset, levels, targetSmallest, currentSmallest, items, text, completed, deadlineAt, deadlineSetAt, notifyAt, notified, notifyPercent, alertAtDeadline, deadlineNotified
}) {
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
      deadlineSetAt: deadlineAt ? (deadlineSetAt || now) : null,
      notifyAt: notifyAt || null,
      notified: notified || false,
      notifyPercent: notifyPercent || null,
      alertAtDeadline: alertAtDeadline || false,
      deadlineNotified: deadlineNotified || false
    };
    bars.push(newBar);
    setLocalBars(bars);
    triggerMockUpdate();
    return newBar.id;
  }

  try {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      
    const now = new Date().toISOString();
    const { error } = await supabase.from('trackers').insert({
      id,
      user_id: uid,
      title,
      type: type || "goal",
      preset: preset || null,
      levels: levels || null,
      target_smallest: targetSmallest !== null && targetSmallest !== undefined ? Number(targetSmallest) : 1,
      current_smallest: currentSmallest !== null && currentSmallest !== undefined ? Number(currentSmallest) : 0,
      items: items || null,
      text: text || null,
      completed: completed || false,
      deadline_at: deadlineAt ? new Date(deadlineAt).toISOString() : null,
      deadline_set_at: deadlineAt ? (deadlineSetAt ? new Date(deadlineSetAt).toISOString() : now) : null,
      notify_at: notifyAt ? new Date(notifyAt).toISOString() : null,
      notified: notified || false,
      notify_percent: notifyPercent !== undefined && notifyPercent !== null ? Number(notifyPercent) : null,
      alert_at_deadline: alertAtDeadline || false,
      deadline_notified: deadlineNotified || false,
      last_updated: now
    });
    if (error) throw error;
    return id;
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
 * @param {boolean} completed Whether the tracker is marked complete.
 */
export async function updateBarProgress(uid, barId, currentSmallest, completed) {
  if (!isConfigured || isGuestMode()) {
    const bars = getLocalBars();
    const barIndex = bars.findIndex(b => b.id === barId);
    if (barIndex !== -1) {
      bars[barIndex].currentSmallest = Number(currentSmallest);
      bars[barIndex].completed = completed;
      bars[barIndex].lastUpdated = Date.now();
      if (completed) {
        bars[barIndex].notifyAt = null;
      }
      setLocalBars(bars);
      triggerMockUpdate();
    } else {
      throw new Error(`Bar not found: ${barId}`);
    }
    return;
  }

  try {
    const updates = {
      current_smallest: Number(currentSmallest),
      completed: completed,
      last_updated: new Date().toISOString()
    };
    if (completed) {
      updates.notify_at = null;
    }
    const { error } = await supabase
      .from('trackers')
      .update(updates)
      .eq('id', barId)
      .eq('user_id', uid);
    if (error) throw error;
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
    const { error } = await supabase
      .from('trackers')
      .delete()
      .eq('id', barId)
      .eq('user_id', uid);
    if (error) throw error;
  } catch (error) {
    console.error("Error deleting progress bar:", error);
    throw error;
  }
}

/**
 * Edits an existing progress bar document.
 */
export async function editBar(uid, barId, updates) {
  const previous = writeQueues.get(barId) || Promise.resolve();
  const current = previous
    .catch(() => {}) // don't let a prior failure block the next write
    .then(() => _editBarInternal(uid, barId, updates));
  writeQueues.set(barId, current);
  return current;
}

async function _editBarInternal(uid, barId, {
  title, levels, targetSmallest, currentSmallest, items, text, completed, deadlineAt, updateDeadline, notifyAt, notified, notifyPercent, alertAtDeadline, deadlineNotified, position
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
        deadlineSetAt: newDeadlineSetAt,
        notifyAt: notifyAt !== undefined ? notifyAt : original.notifyAt,
        notified: notified !== undefined ? notified : original.notified,
        notifyPercent: notifyPercent !== undefined ? notifyPercent : original.notifyPercent,
        alertAtDeadline: alertAtDeadline !== undefined ? alertAtDeadline : original.alertAtDeadline,
        deadlineNotified: deadlineNotified !== undefined ? deadlineNotified : original.deadlineNotified,
        position: position !== undefined ? position : original.position
      };
      setLocalBars(bars);
      triggerMockUpdate();
    }
    return;
  }

  try {
    const now = new Date().toISOString();
    const updates = {
      title,
      last_updated: now
    };

    if (levels !== undefined) updates.levels = levels;
    if (targetSmallest !== null && targetSmallest !== undefined) updates.target_smallest = Number(targetSmallest);
    if (currentSmallest !== null && currentSmallest !== undefined) updates.current_smallest = Number(currentSmallest);
    if (items !== undefined) updates.items = items;
    if (text !== undefined) updates.text = text;
    if (completed !== undefined) updates.completed = completed;
    if (notifyAt !== undefined) updates.notify_at = notifyAt ? new Date(notifyAt).toISOString() : null;
    if (notified !== undefined) updates.notified = notified;
    if (notifyPercent !== undefined) updates.notify_percent = notifyPercent !== null ? Number(notifyPercent) : null;
    if (alertAtDeadline !== undefined) updates.alert_at_deadline = alertAtDeadline;
    if (deadlineNotified !== undefined) updates.deadline_notified = deadlineNotified;
    if (position !== undefined) updates.position = position;

    if (updateDeadline) {
      if (deadlineAt) {
        updates.deadline_at = new Date(deadlineAt).toISOString();
        updates.deadline_set_at = now;
      } else {
        updates.deadline_at = null;
        updates.deadline_set_at = null;
      }
    }

    const { error } = await supabase
      .from('trackers')
      .update(updates)
      .eq('id', barId)
      .eq('user_id', uid);
    if (error) throw error;
  } catch (error) {
    console.error("Error editing bar:", error);
    throw error;
  }
}

/**
 * Deletes all database progress bars for a specific user ID.
 * @param {string} uid User ID to delete data for.
 */
export async function deleteUserData(uid) {
  if (!isConfigured || isGuestMode()) {
    localStorage.removeItem("progress_shelf_bars");
    return;
  }

  try {
    const { error } = await supabase
      .from('trackers')
      .delete()
      .eq('user_id', uid);
    if (error) throw error;
  } catch (error) {
    console.error("Error deleting user trackers:", error);
    throw error;
  }
}

export async function saveFCMToken(uid, token) {
  localStorage.setItem("ps_fcm_token", token);

  if (!isConfigured || isGuestMode()) {
    return;
  }

  try {
    const { error } = await supabase
      .from('fcm_tokens')
      .upsert(
        { 
          user_id: uid, 
          token, 
          browser_hint: typeof navigator !== 'undefined' ? navigator.userAgent.substring(0, 100) : null,
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString() 
        },
        { onConflict: 'token' }
      );
    if (error) throw error;
  } catch (error) {
    console.error("Error saving FCM token:", error);
    throw error;
  }
}

/**
 * Deletes a user's FCM token from fcm_tokens.
 * @param {string} uid User ID.
 * @param {string} token FCM token value.
 */
export async function deleteFCMToken(uid, token) {
  if (!isConfigured || isGuestMode() || !uid || !token) return;
  try {
    const { error } = await supabase
      .from('fcm_tokens')
      .delete()
      .eq('user_id', uid)
      .eq('token', token);
    if (error) throw error;
  } catch (error) {
    console.error("Error deleting FCM token:", error);
  }
}

/**
 * Verifies if a specific FCM token exists in the database.
 * @param {string} uid User ID.
 * @param {string} token FCM token value.
 * @returns {Promise<boolean>} True if the token exists.
 */
export async function checkFCMTokenExists(uid, token) {
  if (!isConfigured || isGuestMode() || !uid || !token) return false;
  try {
    const { data, error } = await supabase
      .from('fcm_tokens')
      .select('token')
      .eq('user_id', uid)
      .eq('token', token)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  } catch (err) {
    console.error("Error checking FCM token:", err);
    return false;
  }
}

/**
 * Deletes multiple progress bars in a batch operation.
 * @param {string} uid The user ID.
 * @param {Array<string>} barIds Array of progress bar IDs.
 */
export async function deleteMultipleBars(uid, barIds) {
  if (!isConfigured || isGuestMode()) {
    const bars = getLocalBars().filter(b => !barIds.includes(b.id));
    setLocalBars(bars);
    triggerMockUpdate();
    return;
  }

  try {
    const { error } = await supabase
      .from('trackers')
      .delete()
      .in('id', barIds)
      .eq('user_id', uid);
    if (error) throw error;
  } catch (error) {
    console.error("Error deleting multiple progress bars:", error);
    throw error;
  }
}
