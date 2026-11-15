// db.js
import { supabase, isConfigured } from "./supabase-config.js?v=3.3";
import { isGuestMode } from "./auth.js?v=3.3";

const writeQueues = new Map(); // barId -> latest pending write promise

const DEMO_CARD_TITLES = ['Romio Update 03/08', 'Daily Standup Checklist', 'IITB Classes'];

function isLegacyDemoCard(bar) {
  if (!bar) return false;
  const id = String(bar.id || '');
  const title = String(bar.title || '').trim();
  return id.startsWith('demo_') || DEMO_CARD_TITLES.includes(title);
}

// Helper to get/set local storage bars for Sandbox mode
export function getLocalBars() {
  const data = localStorage.getItem("progress_shelf_bars");
  if (!data) return [];
  try {
    const raw = JSON.parse(data);
    let changed = false;

    // Filter out any stale demo cards that may have been previously auto-seeded into localStorage
    const filtered = (Array.isArray(raw) ? raw : []).filter(bar => {
      if (isLegacyDemoCard(bar)) {
        changed = true;
        return false;
      }
      return true;
    });

    const normalized = filtered.map(bar => {
      const origRepeat = JSON.stringify(bar.repeat);
      const norm = normalizeBar(bar);
      if (JSON.stringify(norm.repeat) !== origRepeat) {
        changed = true;
      }
      return norm;
    });

    if (changed || filtered.length !== raw.length) {
      if (normalized.length === 0) {
        localStorage.removeItem("progress_shelf_bars");
      } else {
        localStorage.setItem("progress_shelf_bars", JSON.stringify(normalized));
      }
    }
    return normalized;
  } catch (e) {
    localStorage.removeItem("progress_shelf_bars");
    return [];
  }
}

function normalizeBar(bar) {
  if (!bar) return bar;
  return mapDatabaseRow(bar);
}

function setLocalBars(bars) {
  localStorage.setItem("progress_shelf_bars", JSON.stringify(bars));
}

// Helper to get/set locally cached bars for authenticated users (cache-first startup)
export function getCachedUserBars(uid) {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(`ps_cached_bars_${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Failed to read cached user bars:", e);
    return [];
  }
}

export function setCachedUserBars(uid, bars) {
  if (!uid || !bars) return;
  try {
    localStorage.setItem(`ps_cached_bars_${uid}`, JSON.stringify(bars));
  } catch (e) {
    console.warn("Failed to write cached user bars:", e);
  }
}

// Active in-memory state and listeners collection for instant optimistic updates
let activeUid = null;
let activeBarsState = [];
let activeBarsListeners = new Set();

// ==========================================
// Offline Mutation Outbox & Sync Queue
// ==========================================
export function getSyncQueue(uid) {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(`ps_sync_queue_${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Failed to read sync queue:", e);
    return [];
  }
}

export function setSyncQueue(uid, queue) {
  if (!uid) return;
  try {
    if (!queue || queue.length === 0) {
      localStorage.removeItem(`ps_sync_queue_${uid}`);
    } else {
      localStorage.setItem(`ps_sync_queue_${uid}`, JSON.stringify(queue));
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ps-sync-queue-changed', {
        detail: { uid, count: (queue && queue.length) || 0 }
      }));
    }
  } catch (e) {
    console.warn("Failed to write sync queue:", e);
  }
}

export function isBarPendingSync(barId) {
  if (!barId) return false;
  const uid = activeUid;
  if (!uid) return false;
  const queue = getSyncQueue(uid);
  return queue.some(m => m.barId === barId);
}

export function enqueueMutation(uid, mutation) {
  if (!uid) return;
  const queue = getSyncQueue(uid);

  // Coalesce: If mutation is DELETE on a bar that was created locally and not yet synced
  if (mutation.type === 'DELETE') {
    const insertIdx = queue.findIndex(m => m.barId === mutation.barId && m.type === 'INSERT');
    if (insertIdx !== -1) {
      // Never existed on server! Erase all queued ops for this bar
      const filtered = queue.filter(m => m.barId !== mutation.barId);
      setSyncQueue(uid, filtered);
      return;
    }
  }

  // Coalesce: If mutation is UPDATE on a bar that has a pending INSERT
  if (mutation.type === 'UPDATE' || mutation.type === 'UPDATE_PROGRESS') {
    const insertOp = queue.find(m => m.barId === mutation.barId && m.type === 'INSERT');
    if (insertOp) {
      insertOp.payload = {
        ...insertOp.payload,
        ...mutation.payload,
        lastUpdated: Date.now()
      };
      setSyncQueue(uid, queue);
      return;
    }

    // Coalesce: Consecutive updates on the same bar
    const existingUpdate = queue.find(m => m.barId === mutation.barId && (m.type === 'UPDATE' || m.type === 'UPDATE_PROGRESS'));
    if (existingUpdate) {
      existingUpdate.payload = {
        ...existingUpdate.payload,
        ...mutation.payload,
        lastUpdated: Date.now()
      };
      existingUpdate.timestamp = Date.now();
      setSyncQueue(uid, queue);
      return;
    }
  }

  queue.push(mutation);
  setSyncQueue(uid, queue);
}

let isSyncInProgress = false;

export async function processSyncQueue(uid) {
  if (!uid || isSyncInProgress) return;
  if (!isConfigured || isGuestMode()) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const queue = getSyncQueue(uid);
  if (queue.length === 0) return;

  isSyncInProgress = true;
  console.log(`[Sync Engine] Starting processing of ${queue.length} offline mutations for: ${uid}`);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ps-sync-started', { detail: { count: queue.length } }));
  }

  const remaining = [];
  let syncedCount = 0;

  for (const mutation of queue) {
    try {
      if (mutation.type === 'INSERT') {
        const bar = mutation.payload;
        const effectiveCreatedAt = bar.createdAt || Date.now();
        const effectiveDeadlineSetAt = bar.deadlineAt ? (bar.deadlineSetAt || effectiveCreatedAt) : null;
        const { error } = await supabase.from('trackers').upsert({
          id: mutation.barId,
          user_id: uid,
          title: bar.title,
          type: bar.type || "goal",
          preset: bar.preset || null,
          levels: bar.levels || null,
          target_smallest: bar.targetSmallest !== undefined && bar.targetSmallest !== null ? Number(bar.targetSmallest) : 1,
          current_smallest: bar.currentSmallest !== undefined && bar.currentSmallest !== null ? Number(bar.currentSmallest) : 0,
          items: bar.items || null,
          text: bar.text || null,
          completed: bar.completed || false,
          created_at: new Date(effectiveCreatedAt).toISOString(),
          deadline_at: bar.deadlineAt ? new Date(bar.deadlineAt).toISOString() : null,
          deadline_set_at: effectiveDeadlineSetAt ? new Date(effectiveDeadlineSetAt).toISOString() : null,
          notify_at: bar.notifyAt ? new Date(bar.notifyAt).toISOString() : null,
          notified: bar.notified || false,
          notify_percent: bar.notifyPercent !== undefined && bar.notifyPercent !== null ? Number(bar.notifyPercent) : null,
          alert_at_deadline: bar.alertAtDeadline || false,
          deadline_notified: bar.deadlineNotified || false,
          repeat: bar.repeat || null,
          last_updated: new Date(bar.lastUpdated || Date.now()).toISOString()
        });
        if (error) throw error;
      } else if (mutation.type === 'UPDATE_PROGRESS') {
        const p = mutation.payload;
        const updates = {
          current_smallest: Number(p.currentSmallest),
          completed: p.completed,
          last_updated: new Date(p.lastUpdated || Date.now()).toISOString()
        };
        if (p.completed) {
          updates.notify_at = null;
        }
        const { error } = await supabase
          .from('trackers')
          .update(updates)
          .eq('id', mutation.barId)
          .eq('user_id', uid);
        if (error) throw error;
      } else if (mutation.type === 'UPDATE') {
        const p = mutation.payload;
        const updates = {
          last_updated: new Date(p.lastUpdated || Date.now()).toISOString()
        };
        if (p.title !== undefined) updates.title = p.title;
        if (p.levels !== undefined) updates.levels = p.levels;
        if (p.targetSmallest !== undefined && p.targetSmallest !== null) updates.target_smallest = Number(p.targetSmallest);
        if (p.currentSmallest !== undefined && p.currentSmallest !== null) updates.current_smallest = Number(p.currentSmallest);
        if (p.items !== undefined) updates.items = p.items;
        if (p.text !== undefined) updates.text = p.text;
        if (p.completed !== undefined) updates.completed = p.completed;
        if (p.deadlineAt !== undefined) updates.deadline_at = p.deadlineAt ? new Date(p.deadlineAt).toISOString() : null;
        if (p.deadlineSetAt !== undefined) updates.deadline_set_at = p.deadlineSetAt ? new Date(p.deadlineSetAt).toISOString() : null;
        if (p.notifyAt !== undefined) updates.notify_at = p.notifyAt ? new Date(p.notifyAt).toISOString() : null;
        if (p.notified !== undefined) updates.notified = p.notified;
        if (p.notifyPercent !== undefined) updates.notify_percent = p.notifyPercent !== null ? Number(p.notifyPercent) : null;
        if (p.alertAtDeadline !== undefined) updates.alert_at_deadline = p.alertAtDeadline;
        if (p.deadlineNotified !== undefined) updates.deadline_notified = p.deadlineNotified;
        if (p.position !== undefined) updates.position = p.position;
        if (p.repeat !== undefined) updates.repeat = p.repeat;

        const { error } = await supabase
          .from('trackers')
          .update(updates)
          .eq('id', mutation.barId)
          .eq('user_id', uid);
        if (error) throw error;
      } else if (mutation.type === 'DELETE') {
        const { error } = await supabase
          .from('trackers')
          .delete()
          .eq('id', mutation.barId)
          .eq('user_id', uid);
        if (error) throw error;
      }

      syncedCount++;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ps-bar-synced', { detail: { barId: mutation.barId } }));
      }
    } catch (err) {
      console.warn(`[Sync Engine] Error syncing mutation ${mutation.barId}:`, err);
      mutation.retries = (mutation.retries || 0) + 1;
      remaining.push(mutation);
    }
  }

  setSyncQueue(uid, remaining);
  isSyncInProgress = false;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ps-sync-finished', {
      detail: { syncedCount, remainingCount: remaining.length }
    }));
  }

  notifyActiveListeners();
}

function notifyActiveListeners() {
  const snapshot = [...activeBarsState];
  activeBarsListeners.forEach(listener => {
    try {
      listener(snapshot);
    } catch (e) {
      console.error("Bars listener update failed", e);
    }
  });
}

function persistActiveBars() {
  if (activeUid) {
    setCachedUserBars(activeUid, activeBarsState);
  } else {
    setLocalBars(activeBarsState);
  }
}

function triggerMockUpdate() {
  notifyActiveListeners();
}

function mapDatabaseRow(row) {
  const bar = {
    id: row.id,
    title: row.title,
    type: row.type,
    preset: row.preset,
    levels: row.levels,
    targetSmallest: row.target_smallest !== undefined && row.target_smallest !== null
      ? Number(row.target_smallest)
      : (row.targetSmallest !== undefined && row.targetSmallest !== null ? Number(row.targetSmallest) : null),
    currentSmallest: row.current_smallest !== undefined && row.current_smallest !== null
      ? Number(row.current_smallest)
      : (row.currentSmallest !== undefined && row.currentSmallest !== null ? Number(row.currentSmallest) : null),
    items: row.items,
    text: row.text,
    completed: row.completed,
    deadlineAt: row.deadline_at ? new Date(row.deadline_at).getTime() : (row.deadlineAt ? (typeof row.deadlineAt === 'number' ? row.deadlineAt : new Date(row.deadlineAt).getTime()) : null),
    deadlineSetAt: row.deadline_set_at ? new Date(row.deadline_set_at).getTime() : (row.deadlineSetAt ? (typeof row.deadlineSetAt === 'number' ? row.deadlineSetAt : new Date(row.deadlineSetAt).getTime()) : null),
    notifyAt: row.notify_at ? new Date(row.notify_at).getTime() : (row.notifyAt ? (typeof row.notifyAt === 'number' ? row.notifyAt : new Date(row.notifyAt).getTime()) : null),
    notified: row.notified,
    notifyPercent: row.notify_percent !== undefined && row.notify_percent !== null ? Number(row.notify_percent) : (row.notifyPercent !== undefined && row.notifyPercent !== null ? Number(row.notifyPercent) : null),
    alertAtDeadline: row.alert_at_deadline || row.alertAtDeadline || false,
    deadlineNotified: row.deadline_notified || row.deadlineNotified || false,
    position: row.position !== null && row.position !== undefined ? Number(row.position) : 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : (row.createdAt ? (typeof row.createdAt === 'number' ? row.createdAt : new Date(row.createdAt).getTime()) : (row.last_updated ? new Date(row.last_updated).getTime() : (row.lastUpdated || Date.now()))),
    lastUpdated: row.last_updated ? new Date(row.last_updated).getTime() : (row.lastUpdated ? (typeof row.lastUpdated === 'number' ? row.lastUpdated : new Date(row.lastUpdated).getTime()) : null),
    repeat: row.repeat || null
  };

  const rawRepeat = row.repeat;
  if (rawRepeat && typeof rawRepeat === 'object') {
    bar.checklistResetEnabled = !!rawRepeat.checklistResetEnabled;
    bar.deadlineResetEnabled = !!rawRepeat.deadlineResetEnabled;

    const rawCount = rawRepeat.resetCount !== undefined 
      ? rawRepeat.resetCount 
      : (rawRepeat.checklistResetCount !== undefined ? rawRepeat.checklistResetCount : rawRepeat.deadlineResetCount);

    bar.resetCount = (rawCount !== undefined && rawCount !== null && rawCount !== '') ? Number(rawCount) : null;
    bar.checklistResetCount = bar.resetCount;
    bar.deadlineResetCount = bar.resetCount;
    bar.lastResetAt = rawRepeat.lastResetAt ? (typeof rawRepeat.lastResetAt === 'number' ? rawRepeat.lastResetAt : new Date(rawRepeat.lastResetAt).getTime()) : null;

    if (rawRepeat.resetTime && typeof rawRepeat.resetTime === 'string') {
      bar.resetTime = rawRepeat.resetTime;
    } else {
      // Migration from duration-based delay or creation time
      let refDate = new Date();
      if (bar.createdAt) refDate = new Date(bar.createdAt);
      else if (bar.lastUpdated) refDate = new Date(bar.lastUpdated);

      const hrs = String(refDate.getHours()).padStart(2, '0');
      const mins = String(refDate.getMinutes()).padStart(2, '0');
      bar.resetTime = `${hrs}:${mins}`;
    }

    if (rawRepeat.deadlineTime && typeof rawRepeat.deadlineTime === 'string') {
      bar.deadlineTime = rawRepeat.deadlineTime;
    } else if (bar.deadlineAt) {
      const d = new Date(bar.deadlineAt);
      bar.deadlineTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } else {
      bar.deadlineTime = null;
    }

    // Persist migrated unified repeat object
    const migratedRepeat = {
      resetTime: bar.resetTime,
      resetCount: bar.resetCount,
      checklistResetEnabled: bar.checklistResetEnabled,
      deadlineResetEnabled: bar.deadlineResetEnabled,
      lastResetAt: bar.lastResetAt,
      deadlineTime: bar.deadlineTime
    };
    bar.repeat = migratedRepeat;
    row.repeat = migratedRepeat;
  } else {
    bar.checklistResetEnabled = false;
    bar.deadlineResetEnabled = false;
    bar.resetCount = null;
    bar.checklistResetCount = null;
    bar.deadlineResetCount = null;
    bar.resetTime = null;
    bar.lastResetAt = null;
    bar.deadlineTime = null;
  }

  return bar;
}

/**
 * Subscribes to real-time updates for a user's progress bars.
 * @param {string} uid The user ID.
 * @param {Function} onUpdate Callback invoked with updated array of bars.
 * @param {Function} onError Callback invoked on error.
 * @returns {Function} Unsubscribe function to stop listening.
 */
export function subscribeToBars(uid, onUpdate, onError) {
  activeUid = (!isConfigured || isGuestMode() || !uid) ? null : uid;
  activeBarsListeners.add(onUpdate);

  if (!activeUid) {
    activeBarsState = getLocalBars();
    // Trigger initial load callback immediately for zero startup latency
    try {
      onUpdate([...activeBarsState]);
    } catch (e) {
      console.warn("Error rendering local bars:", e);
    }

    // Return unsubscribe callback
    return () => {
      activeBarsListeners.delete(onUpdate);
    };
  }

  // 1. Cache-first: read last cached data from local storage and render UI immediately
  const localCached = getCachedUserBars(activeUid);
  activeBarsState = (localCached && localCached.length > 0) ? [...localCached] : [];
  if (activeBarsState.length > 0) {
    try {
      onUpdate([...activeBarsState]);
    } catch (e) {
      console.warn("Error rendering cached bars:", e);
    }
  }

  // 2. Fetch from Supabase in the background
  let isFetching = false;
  const fetchInitial = async () => {
    if (isFetching) return;
    isFetching = true;
    try {
      const { data, error } = await supabase
        .from('trackers')
        .select('*')
        .eq('user_id', activeUid);

      if (error) throw error;

      const rawBars = (data || []).map(mapDatabaseRow);

      // Auto-cleanup any accidental auto-seeded demo cards in cloud account
      const demoCardsInCloud = rawBars.filter(b => isLegacyDemoCard(b));
      if (demoCardsInCloud.length > 0) {
        console.log(`[Auto-Cleanup] Found ${demoCardsInCloud.length} auto-seeded demo card(s) in cloud. Cleaning up...`);
        const idsToDelete = demoCardsInCloud.map(b => b.id);
        deleteMultipleBars(activeUid, idsToDelete).catch(err => console.error("Error deleting cloud demo cards:", err));
      }

      const freshBars = rawBars.filter(b => !isLegacyDemoCard(b));

      // Reconcile with any optimistic in-memory bars that may not have reached Supabase yet (created within last 15s)
      const now = Date.now();
      const optimisticPending = activeBarsState.filter(localBar => {
        const isRecent = localBar.createdAt && (now - localBar.createdAt < 15000);
        const inFresh = freshBars.some(fb => fb.id === localBar.id);
        return isRecent && !inFresh;
      });

      const merged = [...freshBars, ...optimisticPending];

      // Update the UI only if data changed or first load had no cache
      const hasChanged = JSON.stringify(activeBarsState) !== JSON.stringify(merged);
      if (hasChanged || activeBarsState.length === 0) {
        activeBarsState = merged;
        persistActiveBars();
        notifyActiveListeners();
      }
    } catch (err) {
      console.error("Error fetching trackers:", err);
      if (activeBarsState.length === 0 && onError) {
        onError(err);
      }
    } finally {
      isFetching = false;
    }
  };

  // Perform initial fetch in background
  fetchInitial();
  if (typeof navigator !== 'undefined' && navigator.onLine && activeUid) {
    processSyncQueue(activeUid);
  }

  // 3. Subscribe to real-time changes
  const channel = supabase
    .channel(`trackers-user-${activeUid}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'trackers' },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload;
        
        if (eventType === 'INSERT') {
          if (newRow.user_id === activeUid) {
            const mapped = mapDatabaseRow(newRow);
            if (isLegacyDemoCard(mapped)) {
              deleteMultipleBars(activeUid, [mapped.id]).catch(err => console.error("Error purging legacy demo card on insert:", err));
              return;
            }
            const existingIdx = activeBarsState.findIndex(b => b.id === mapped.id);
            if (existingIdx !== -1) {
              // Bar already exists locally from optimistic add; update with canonical server data
              activeBarsState[existingIdx] = { ...activeBarsState[existingIdx], ...mapped };
              persistActiveBars();
            } else {
              // Bar added from another client/session
              activeBarsState.push(mapped);
              persistActiveBars();
              notifyActiveListeners();
            }
          }
        } else if (eventType === 'UPDATE') {
          if (newRow.user_id === activeUid) {
            const mapped = mapDatabaseRow(newRow);
            const idx = activeBarsState.findIndex(b => b.id === mapped.id);
            if (idx !== -1) {
              activeBarsState[idx] = { ...activeBarsState[idx], ...mapped };
            } else {
              activeBarsState.push(mapped);
            }
            persistActiveBars();
            notifyActiveListeners();
          }
        } else if (eventType === 'DELETE') {
          const deleteId = oldRow?.id;
          if (deleteId) {
            const prevLen = activeBarsState.length;
            activeBarsState = activeBarsState.filter(b => b.id !== deleteId);
            if (activeBarsState.length !== prevLen) {
              persistActiveBars();
              notifyActiveListeners();
            }
          }
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Fast resync on connection establish or reconnect to guarantee no missed events
        fetchInitial();
      }
    });

  // Re-sync on tab visibility change or when device returns online
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      if (activeUid && typeof navigator !== 'undefined' && navigator.onLine) {
        processSyncQueue(activeUid).finally(() => fetchInitial());
      } else {
        fetchInitial();
      }
    }
  };
  const onOnline = () => {
    if (activeUid) {
      processSyncQueue(activeUid).finally(() => fetchInitial());
    } else {
      fetchInitial();
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
  }

  // Return unsubscribe callback
  return () => {
    activeBarsListeners.delete(onUpdate);
    supabase.removeChannel(channel);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
    }
  };
}

/**
 * Creates a new progress bar document.
 * @param {string} uid The user ID.
 * @param {Object} barData The progress bar data object.
 * @returns {Promise<string>} The auto-generated bar ID.
 */
export async function createBar(uid, {
  title, type, preset, levels, targetSmallest, currentSmallest, items, text, completed, deadlineAt, deadlineSetAt, createdAt, notifyAt, notified, notifyPercent, alertAtDeadline, deadlineNotified, resetTime, resetCount, checklistResetEnabled, checklistResetCount, deadlineResetEnabled, deadlineResetCount, lastResetAt, repeat
}) {
  let finalRepeat = null;
  const rawCount = resetCount !== undefined 
    ? resetCount 
    : (checklistResetCount !== undefined ? checklistResetCount : (deadlineResetCount !== undefined ? deadlineResetCount : (repeat && (repeat.resetCount ?? repeat.checklistResetCount ?? repeat.deadlineResetCount))));
  const parsedCount = (rawCount !== undefined && rawCount !== null && rawCount !== '') ? Number(rawCount) : null;
  const parsedResetTime = resetTime || (repeat && repeat.resetTime) || null;
  const isChk = !!(checklistResetEnabled || (repeat && repeat.checklistResetEnabled));
  const isDln = !!(deadlineResetEnabled || (repeat && repeat.deadlineResetEnabled));

  const parsedDeadlineTime = (repeat && repeat.deadlineTime) || null;

  if (repeat && typeof repeat === 'object') {
    finalRepeat = {
      resetTime: parsedResetTime,
      resetCount: parsedCount,
      checklistResetEnabled: isChk,
      deadlineResetEnabled: isDln,
      lastResetAt: repeat.lastResetAt || lastResetAt || Date.now(),
      deadlineTime: parsedDeadlineTime
    };
  } else if (checklistResetEnabled !== undefined || deadlineResetEnabled !== undefined || resetTime !== undefined || resetCount !== undefined) {
    finalRepeat = {
      resetTime: parsedResetTime,
      resetCount: parsedCount,
      checklistResetEnabled: isChk,
      deadlineResetEnabled: isDln,
      lastResetAt: lastResetAt || Date.now(),
      deadlineTime: parsedDeadlineTime
    };
  }

  if (!isConfigured || isGuestMode() || !uid) {
    const bars = getLocalBars();
    const now = Date.now();
    const effectiveCreatedAt = (createdAt !== undefined && createdAt !== null) ? Number(createdAt) : now;
    const effectiveDeadlineSetAt = deadlineAt ? (deadlineSetAt ? Number(deadlineSetAt) : effectiveCreatedAt) : null;
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
      createdAt: effectiveCreatedAt,
      lastUpdated: now,
      deadlineAt: deadlineAt || null,
      deadlineSetAt: effectiveDeadlineSetAt,
      deadlineTime: finalRepeat ? finalRepeat.deadlineTime : null,
      notifyAt: notifyAt || null,
      notified: notified || false,
      notifyPercent: notifyPercent || null,
      alertAtDeadline: alertAtDeadline || false,
      deadlineNotified: deadlineNotified || false,
      repeat: finalRepeat,
      resetTime: finalRepeat ? finalRepeat.resetTime : null,
      resetCount: finalRepeat ? finalRepeat.resetCount : null,
      lastResetAt: finalRepeat ? finalRepeat.lastResetAt : null,
      checklistResetEnabled: finalRepeat ? finalRepeat.checklistResetEnabled : false,
      checklistResetCount: finalRepeat ? finalRepeat.resetCount : null,
      deadlineResetEnabled: finalRepeat ? finalRepeat.deadlineResetEnabled : false,
      deadlineResetCount: finalRepeat ? finalRepeat.resetCount : null
    };
    bars.push(newBar);
    setLocalBars(bars);
    activeBarsState = bars;
    notifyActiveListeners();
    return newBar.id;
  }

  const id = (typeof crypto !== 'undefined' && crypto.randomUUID) 
    ? crypto.randomUUID() 
    : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    
  const now = Date.now();
  const effectiveCreatedAt = (createdAt !== undefined && createdAt !== null) ? Number(createdAt) : now;
  const effectiveDeadlineSetAt = deadlineAt ? (deadlineSetAt ? Number(deadlineSetAt) : effectiveCreatedAt) : null;
  const newBar = {
    id,
    title,
    type: type || "goal",
    preset: preset || null,
    levels: levels || null,
    targetSmallest: targetSmallest !== null && targetSmallest !== undefined ? Number(targetSmallest) : 1,
    currentSmallest: currentSmallest !== null && currentSmallest !== undefined ? Number(currentSmallest) : 0,
    items: items || null,
    text: text || null,
    completed: completed || false,
    createdAt: effectiveCreatedAt,
    lastUpdated: now,
    deadlineAt: deadlineAt || null,
    deadlineSetAt: effectiveDeadlineSetAt,
    deadlineTime: finalRepeat ? finalRepeat.deadlineTime : null,
    notifyAt: notifyAt || null,
    notified: notified || false,
    notifyPercent: notifyPercent !== undefined && notifyPercent !== null ? Number(notifyPercent) : null,
    alertAtDeadline: alertAtDeadline || false,
    deadlineNotified: deadlineNotified || false,
    repeat: finalRepeat,
    resetTime: finalRepeat ? finalRepeat.resetTime : null,
    resetCount: finalRepeat ? finalRepeat.resetCount : null,
    lastResetAt: finalRepeat ? finalRepeat.lastResetAt : null,
    checklistResetEnabled: finalRepeat ? finalRepeat.checklistResetEnabled : false,
    checklistResetCount: finalRepeat ? finalRepeat.resetCount : null,
    deadlineResetEnabled: finalRepeat ? finalRepeat.deadlineResetEnabled : false,
    deadlineResetCount: finalRepeat ? finalRepeat.resetCount : null
  };

  // Optimistic UI write (0ms lag)
  activeBarsState.push(newBar);
  persistActiveBars();
  notifyActiveListeners();

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (isOffline) {
    enqueueMutation(uid, {
      id: "mut_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
      barId: id,
      type: 'INSERT',
      payload: { ...newBar },
      timestamp: Date.now()
    });
    return id;
  }

  try {
    const { error } = await supabase.from('trackers').insert({
      id,
      user_id: uid,
      title,
      type: type || "goal",
      preset: preset || null,
      levels: levels || null,
      target_smallest: newBar.targetSmallest,
      current_smallest: newBar.currentSmallest,
      items: items || null,
      text: text || null,
      completed: completed || false,
      created_at: new Date(effectiveCreatedAt).toISOString(),
      deadline_at: deadlineAt ? new Date(deadlineAt).toISOString() : null,
      deadline_set_at: effectiveDeadlineSetAt ? new Date(effectiveDeadlineSetAt).toISOString() : null,
      notify_at: notifyAt ? new Date(notifyAt).toISOString() : null,
      notified: notified || false,
      notify_percent: newBar.notifyPercent,
      alert_at_deadline: alertAtDeadline || false,
      deadline_notified: deadlineNotified || false,
      repeat: finalRepeat,
      last_updated: new Date(now).toISOString()
    });
    if (error) throw error;
    return id;
  } catch (error) {
    console.warn("Error creating progress bar in cloud (offline/network), enqueuing for sync:", error);
    enqueueMutation(uid, {
      id: "mut_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
      barId: id,
      type: 'INSERT',
      payload: { ...newBar },
      timestamp: Date.now()
    });
    notifyActiveListeners();
    return id;
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
  const now = Date.now();
  if (!isConfigured || isGuestMode() || !uid) {
    const bars = getLocalBars();
    const barIndex = bars.findIndex(b => b.id === barId);
    if (barIndex !== -1) {
      bars[barIndex].currentSmallest = Number(currentSmallest);
      bars[barIndex].completed = completed;
      bars[barIndex].lastUpdated = now;
      if (completed) {
        bars[barIndex].notifyAt = null;
      }
      setLocalBars(bars);
      activeBarsState = bars;
      notifyActiveListeners();
    } else {
      throw new Error(`Bar not found: ${barId}`);
    }
    return;
  }

  // Optimistic local update (0ms lag)
  const idx = activeBarsState.findIndex(b => b.id === barId);
  const prevBar = idx !== -1 ? { ...activeBarsState[idx] } : null;
  if (idx !== -1) {
    activeBarsState[idx].currentSmallest = Number(currentSmallest);
    activeBarsState[idx].completed = completed;
    activeBarsState[idx].lastUpdated = now;
    if (completed) {
      activeBarsState[idx].notifyAt = null;
    }
    persistActiveBars();
    notifyActiveListeners();
  }

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (isOffline) {
    enqueueMutation(uid, {
      id: "mut_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
      barId,
      type: 'UPDATE_PROGRESS',
      payload: { currentSmallest: Number(currentSmallest), completed, lastUpdated: now },
      timestamp: now
    });
    return;
  }

  try {
    const updates = {
      current_smallest: Number(currentSmallest),
      completed: completed,
      last_updated: new Date(now).toISOString()
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
    console.warn("Error updating progress bar in cloud (offline/network), enqueuing for sync:", error);
    enqueueMutation(uid, {
      id: "mut_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
      barId,
      type: 'UPDATE_PROGRESS',
      payload: { currentSmallest: Number(currentSmallest), completed, lastUpdated: now },
      timestamp: now
    });
    notifyActiveListeners();
  }
}

/**
 * Deletes a progress bar document.
 * @param {string} uid The user ID.
 * @param {string} barId The ID of the progress bar document.
 */
export async function deleteBar(uid, barId) {
  if (!isConfigured || isGuestMode() || !uid) {
    const bars = getLocalBars().filter(b => b.id !== barId);
    setLocalBars(bars);
    activeBarsState = bars;
    notifyActiveListeners();
    return;
  }

  // Optimistic local delete (0ms lag)
  const originalBars = [...activeBarsState];
  activeBarsState = activeBarsState.filter(b => b.id !== barId);
  persistActiveBars();
  notifyActiveListeners();

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (isOffline) {
    enqueueMutation(uid, {
      id: "mut_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
      barId,
      type: 'DELETE',
      timestamp: Date.now()
    });
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
    console.warn("Error deleting progress bar in cloud (offline/network), enqueuing for sync:", error);
    enqueueMutation(uid, {
      id: "mut_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
      barId,
      type: 'DELETE',
      timestamp: Date.now()
    });
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
  title, levels, targetSmallest, currentSmallest, items, text, completed, deadlineAt, updateDeadline, deadlineSetAt, createdAt, notifyAt, notified, notifyPercent, alertAtDeadline, deadlineNotified, position, resetTime, resetCount, checklistResetEnabled, checklistResetCount, deadlineResetEnabled, deadlineResetCount, lastResetAt, repeat
}) {
  let finalRepeat = undefined;
  const rawCount = resetCount !== undefined 
    ? resetCount 
    : (checklistResetCount !== undefined ? checklistResetCount : (deadlineResetCount !== undefined ? deadlineResetCount : (repeat && (repeat.resetCount ?? repeat.checklistResetCount ?? repeat.deadlineResetCount))));
  const parsedCount = (rawCount !== undefined && rawCount !== null && rawCount !== '') ? Number(rawCount) : null;
  const parsedResetTime = resetTime || (repeat && repeat.resetTime) || null;
  const isChk = !!(checklistResetEnabled || (repeat && repeat.checklistResetEnabled));
  const isDln = !!(deadlineResetEnabled || (repeat && repeat.deadlineResetEnabled));

  const parsedDeadlineTime = (repeat && repeat.deadlineTime) || null;

  if (repeat !== undefined) {
    if (repeat && typeof repeat === 'object') {
      finalRepeat = {
        resetTime: parsedResetTime,
        resetCount: parsedCount,
        checklistResetEnabled: isChk,
        deadlineResetEnabled: isDln,
        lastResetAt: repeat.lastResetAt || lastResetAt || null,
        deadlineTime: parsedDeadlineTime
      };
    } else {
      finalRepeat = null;
    }
  } else if (checklistResetEnabled !== undefined || deadlineResetEnabled !== undefined || resetTime !== undefined || resetCount !== undefined) {
    finalRepeat = {
      resetTime: parsedResetTime,
      resetCount: parsedCount,
      checklistResetEnabled: isChk,
      deadlineResetEnabled: isDln,
      lastResetAt: lastResetAt || null,
      deadlineTime: parsedDeadlineTime
    };
  }

  if (!isConfigured || isGuestMode() || !uid) {
    const bars = getLocalBars();
    const idx = bars.findIndex(b => b.id === barId);
    if (idx !== -1) {
      const original = bars[idx];
      let newDeadlineAt = original.deadlineAt;
      let newDeadlineSetAt = original.deadlineSetAt;

      if (deadlineSetAt !== undefined) {
        newDeadlineSetAt = deadlineSetAt ? Number(deadlineSetAt) : null;
      } else if (updateDeadline) {
        if (deadlineAt) {
          newDeadlineAt = deadlineAt;
          newDeadlineSetAt = (createdAt !== undefined && createdAt !== null) ? Number(createdAt) : (original.deadlineSetAt || Date.now());
        } else {
          newDeadlineAt = null;
          newDeadlineSetAt = null;
        }
      } else if (createdAt !== undefined && createdAt !== null && newDeadlineAt) {
        newDeadlineSetAt = Number(createdAt);
      }

      const effectiveRepeat = finalRepeat !== undefined ? finalRepeat : original.repeat;

      bars[idx] = {
        ...original,
        title,
        createdAt: (createdAt !== undefined && createdAt !== null) ? Number(createdAt) : original.createdAt,
        levels: levels !== undefined ? levels : original.levels,
        targetSmallest: targetSmallest !== null && targetSmallest !== undefined ? Number(targetSmallest) : null,
        currentSmallest: currentSmallest !== null && currentSmallest !== undefined ? Number(currentSmallest) : null,
        items: items !== undefined ? items : original.items,
        text: text !== undefined ? text : original.text,
        completed: completed !== undefined ? completed : original.completed,
        lastUpdated: Date.now(),
        deadlineAt: newDeadlineAt,
        deadlineSetAt: newDeadlineSetAt,
        deadlineTime: effectiveRepeat ? effectiveRepeat.deadlineTime : null,
        notifyAt: notifyAt !== undefined ? notifyAt : original.notifyAt,
        notified: notified !== undefined ? notified : original.notified,
        notifyPercent: notifyPercent !== undefined ? notifyPercent : original.notifyPercent,
        alertAtDeadline: alertAtDeadline !== undefined ? alertAtDeadline : original.alertAtDeadline,
        deadlineNotified: deadlineNotified !== undefined ? deadlineNotified : original.deadlineNotified,
        position: position !== undefined ? position : original.position,
        repeat: effectiveRepeat,
        resetTime: effectiveRepeat ? effectiveRepeat.resetTime : null,
        resetCount: effectiveRepeat ? effectiveRepeat.resetCount : null,
        lastResetAt: effectiveRepeat ? effectiveRepeat.lastResetAt : null,
        checklistResetEnabled: effectiveRepeat ? effectiveRepeat.checklistResetEnabled : false,
        checklistResetCount: effectiveRepeat ? effectiveRepeat.resetCount : null,
        deadlineResetEnabled: effectiveRepeat ? effectiveRepeat.deadlineResetEnabled : false,
        deadlineResetCount: effectiveRepeat ? effectiveRepeat.resetCount : null
      };
      setLocalBars(bars);
      activeBarsState = bars;
      notifyActiveListeners();
    }
    return;
  }

  // Cloud Mode: Optimistic local edit (0ms lag)
  const idx = activeBarsState.findIndex(b => b.id === barId);
  const originalBar = idx !== -1 ? { ...activeBarsState[idx] } : null;

  if (idx !== -1) {
    const original = activeBarsState[idx];
    let newDeadlineAt = original.deadlineAt;
    let newDeadlineSetAt = original.deadlineSetAt;

    if (deadlineSetAt !== undefined) {
      newDeadlineSetAt = deadlineSetAt ? Number(deadlineSetAt) : null;
    } else if (updateDeadline) {
      if (deadlineAt) {
        newDeadlineAt = deadlineAt;
        newDeadlineSetAt = (createdAt !== undefined && createdAt !== null) ? Number(createdAt) : (original.deadlineSetAt || Date.now());
      } else {
        newDeadlineAt = null;
        newDeadlineSetAt = null;
      }
    } else if (createdAt !== undefined && createdAt !== null && newDeadlineAt) {
      newDeadlineSetAt = Number(createdAt);
    }

    const effectiveRepeat = finalRepeat !== undefined ? finalRepeat : original.repeat;

    activeBarsState[idx] = {
      ...original,
      title: title !== undefined ? title : original.title,
      createdAt: (createdAt !== undefined && createdAt !== null) ? Number(createdAt) : original.createdAt,
      levels: levels !== undefined ? levels : original.levels,
      targetSmallest: targetSmallest !== null && targetSmallest !== undefined ? Number(targetSmallest) : original.targetSmallest,
      currentSmallest: currentSmallest !== null && currentSmallest !== undefined ? Number(currentSmallest) : original.currentSmallest,
      items: items !== undefined ? items : original.items,
      text: text !== undefined ? text : original.text,
      completed: completed !== undefined ? completed : original.completed,
      lastUpdated: Date.now(),
      deadlineAt: newDeadlineAt,
      deadlineSetAt: newDeadlineSetAt,
      deadlineTime: effectiveRepeat ? effectiveRepeat.deadlineTime : null,
      notifyAt: notifyAt !== undefined ? notifyAt : original.notifyAt,
      notified: notified !== undefined ? notified : original.notified,
      notifyPercent: notifyPercent !== undefined ? notifyPercent : original.notifyPercent,
      alertAtDeadline: alertAtDeadline !== undefined ? alertAtDeadline : original.alertAtDeadline,
      deadlineNotified: deadlineNotified !== undefined ? deadlineNotified : original.deadlineNotified,
      position: position !== undefined ? position : original.position,
      repeat: effectiveRepeat,
      resetTime: effectiveRepeat ? effectiveRepeat.resetTime : null,
      resetCount: effectiveRepeat ? effectiveRepeat.resetCount : null,
      lastResetAt: effectiveRepeat ? effectiveRepeat.lastResetAt : null,
      checklistResetEnabled: effectiveRepeat ? effectiveRepeat.checklistResetEnabled : false,
      checklistResetCount: effectiveRepeat ? effectiveRepeat.resetCount : null,
      deadlineResetEnabled: effectiveRepeat ? effectiveRepeat.deadlineResetEnabled : false,
      deadlineResetCount: effectiveRepeat ? effectiveRepeat.resetCount : null
    };

    persistActiveBars();
    notifyActiveListeners();
  }

  const nowMs = Date.now();
  const nowStr = new Date(nowMs).toISOString();
  const updates = {
    title,
    last_updated: nowStr
  };

  if (createdAt !== undefined && createdAt !== null) updates.created_at = new Date(createdAt).toISOString();
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
  
  if (finalRepeat !== undefined) {
    updates.repeat = finalRepeat;
  }

  if (deadlineSetAt !== undefined) {
    updates.deadline_set_at = deadlineSetAt ? new Date(deadlineSetAt).toISOString() : null;
    if (updateDeadline) {
      updates.deadline_at = deadlineAt ? new Date(deadlineAt).toISOString() : null;
    }
  } else if (updateDeadline) {
    if (deadlineAt) {
      updates.deadline_at = new Date(deadlineAt).toISOString();
      updates.deadline_set_at = (createdAt !== undefined && createdAt !== null) ? new Date(createdAt).toISOString() : nowStr;
    } else {
      updates.deadline_at = null;
      updates.deadline_set_at = null;
    }
  } else if (createdAt !== undefined && createdAt !== null) {
    updates.deadline_set_at = new Date(createdAt).toISOString();
  }

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (isOffline) {
    enqueueMutation(uid, {
      id: "mut_" + nowMs + "_" + Math.random().toString(36).substr(2, 6),
      barId,
      type: 'UPDATE',
      payload: {
        title, levels, targetSmallest, currentSmallest, items, text, completed,
        deadlineAt: updates.deadline_at ? new Date(updates.deadline_at).getTime() : null,
        deadlineSetAt: updates.deadline_set_at ? new Date(updates.deadline_set_at).getTime() : null,
        notifyAt: updates.notify_at ? new Date(updates.notify_at).getTime() : null,
        notified, notifyPercent, alertAtDeadline, deadlineNotified, position,
        repeat: finalRepeat, lastUpdated: nowMs
      },
      timestamp: nowMs
    });
    return;
  }

  try {
    const { error } = await supabase
      .from('trackers')
      .update(updates)
      .eq('id', barId)
      .eq('user_id', uid);
    if (error) throw error;
  } catch (error) {
    console.warn("Error editing bar in cloud (offline/network), enqueuing for sync:", error);
    enqueueMutation(uid, {
      id: "mut_" + nowMs + "_" + Math.random().toString(36).substr(2, 6),
      barId,
      type: 'UPDATE',
      payload: {
        title, levels, targetSmallest, currentSmallest, items, text, completed,
        deadlineAt: updates.deadline_at ? new Date(updates.deadline_at).getTime() : null,
        deadlineSetAt: updates.deadline_set_at ? new Date(updates.deadline_set_at).getTime() : null,
        notifyAt: updates.notify_at ? new Date(updates.notify_at).getTime() : null,
        notified, notifyPercent, alertAtDeadline, deadlineNotified, position,
        repeat: finalRepeat, lastUpdated: nowMs
      },
      timestamp: nowMs
    });
    notifyActiveListeners();
  }
}

/**
 * Deletes all database progress bars for a specific user ID.
 * @param {string} uid User ID to delete data for.
 */
export async function deleteUserData(uid) {
  activeBarsState = [];
  if (!isConfigured || isGuestMode() || !uid) {
    localStorage.removeItem("progress_shelf_bars");
    notifyActiveListeners();
    return;
  }

  setCachedUserBars(uid, []);
  notifyActiveListeners();

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
  if (!barIds || barIds.length === 0) return;
  const idSet = new Set(barIds);

  if (!isConfigured || isGuestMode() || !uid) {
    const bars = getLocalBars().filter(b => !idSet.has(b.id));
    setLocalBars(bars);
    activeBarsState = bars;
    notifyActiveListeners();
    return;
  }

  // Cloud Mode: Optimistic local batch delete (0ms lag)
  const originalBars = [...activeBarsState];
  activeBarsState = activeBarsState.filter(b => !idSet.has(b.id));
  persistActiveBars();
  notifyActiveListeners();

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (isOffline) {
    barIds.forEach(id => {
      enqueueMutation(uid, {
        id: "mut_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
        barId: id,
        type: 'DELETE',
        timestamp: Date.now()
      });
    });
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
    console.warn("Error deleting multiple progress bars in cloud (offline/network), enqueuing for sync:", error);
    barIds.forEach(id => {
      enqueueMutation(uid, {
        id: "mut_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
        barId: id,
        type: 'DELETE',
        timestamp: Date.now()
      });
    });
  }
}

// ==========================================
// User Settings (Realtime)
// ==========================================

export async function getUserSettings(uid) {
  if (!isConfigured || isGuestMode()) return null;
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', uid)
      .single();
    if (error && error.code !== 'PGRST116') {
      console.warn("User settings query notice:", error.message || error);
    }

    // Retrieve auth metadata as fallback if table column is absent
    const { data: authData } = await supabase.auth.getUser();
    const meta = authData?.user?.user_metadata || {};

    return {
      ...(data || {}),
      font_family: data?.font_family || meta?.font_family || null,
      accent_color: data?.accent_color || meta?.accent_color || null,
      custom_accents: data?.custom_accents || meta?.custom_accents || null,
      preferred_sort: data?.preferred_sort || meta?.preferred_sort || null
    };
  } catch (err) {
    console.warn("Error fetching user settings:", err.message || err);
    return null;
  }
}

export async function updateUserSettings(uid, settings) {
  if (!isConfigured || isGuestMode()) return;
  try {
    const { error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: uid,
        ...settings,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    if (error) {
      console.warn("user_settings upsert notice:", error.message || error);
    }
  } catch (err) {
    console.warn("Error updating user settings table:", err.message || err);
  }
}

let activeSettingsChannel = null;
let activeSettingsUid = null;
let activeSettingsListener = null;

export function subscribeToUserSettings(uid, onUpdate) {
  if (!isConfigured || isGuestMode() || !uid) return () => {};

  activeSettingsListener = onUpdate;

  if (activeSettingsChannel && activeSettingsUid === uid) {
    return () => {
      if (activeSettingsChannel) {
        supabase.removeChannel(activeSettingsChannel);
        activeSettingsChannel = null;
        activeSettingsUid = null;
        activeSettingsListener = null;
      }
    };
  }

  if (activeSettingsChannel) {
    supabase.removeChannel(activeSettingsChannel);
    activeSettingsChannel = null;
    activeSettingsUid = null;
  }

  const existing = supabase.getChannels?.().find(ch => ch.topic === `realtime:user-settings-${uid}` || ch.topic === `user-settings-${uid}`);
  if (existing) {
    supabase.removeChannel(existing);
  }

  activeSettingsUid = uid;
  activeSettingsChannel = supabase
    .channel(`user-settings-${uid}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'user_settings', filter: `user_id=eq.${uid}` },
      (payload) => {
        if (activeSettingsListener) {
          activeSettingsListener(payload.new);
        }
      }
    )
    .subscribe();

  return () => {
    if (activeSettingsChannel) {
      supabase.removeChannel(activeSettingsChannel);
      activeSettingsChannel = null;
      activeSettingsUid = null;
      activeSettingsListener = null;
    }
  };
}
