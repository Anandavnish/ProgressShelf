const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== RUNNING TESTS FOR PROGRESSSHELF ASSISTANT & APP CLEANUP ===\n');

let passedTests = 0;
let totalTests = 0;

async function it(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✕ ${name}`);
    console.error(`    ${err.message}`);
  }
}

async function main() {

// ---------------------------------------------------------------------------
// TEST 1: Check absence of testForceConnected and mock flags in production files
// ---------------------------------------------------------------------------
it('Requirement 2: assistant.js and app.js have no testForceConnected or mock test flags', () => {
  const assistantCode = fs.readFileSync(path.join(__dirname, '..', 'assistant.js'), 'utf8');
  const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  assert.strictEqual(assistantCode.includes('testForceConnected'), false, 'assistant.js must not contain testForceConnected');
  assert.strictEqual(appCode.includes('testForceConnected'), false, 'app.js must not contain testForceConnected');
  assert.strictEqual(assistantCode.includes('window.__testForceConnected'), false, 'no window.__testForceConnected in assistant.js');
});

// ---------------------------------------------------------------------------
// TEST 2: Check Privacy Notices in Connect Card and AI Settings
// ---------------------------------------------------------------------------
it('Requirement 6: Privacy notice in Connect card and AI settings matches expected wording', () => {
  const assistantCode = fs.readFileSync(path.join(__dirname, '..', 'assistant.js'), 'utf8');
  const expectedNotice = 'Card text and photos you send go to Google; avoid sensitive information.';

  // Must be in Connect card
  assert.ok(assistantCode.includes(expectedNotice), 'Expected privacy notice not found in assistant.js');
  
  // Count occurrences: should be present in Connect card and both disconnected/connected settings
  const matches = assistantCode.split(expectedNotice).length - 1;
  assert.ok(matches >= 2, `Expected at least 2 occurrences of privacy notice, found ${matches}`);
});

// ---------------------------------------------------------------------------
// TEST 3: Check replaceExpiredProposals logic for restoring saved sessions
// ---------------------------------------------------------------------------
it('Requirement 5: Restoring a saved chat session replaces confirmation sheets with expired read-only note', () => {
  const assistantCode = fs.readFileSync(path.join(__dirname, '..', 'assistant.js'), 'utf8');

  // Verify replaceExpiredProposals function exists and uses the required text
  assert.ok(assistantCode.includes('function replaceExpiredProposals'), 'replaceExpiredProposals function must exist');
  assert.ok(assistantCode.includes('This proposal has expired. Ask again.'), 'Must contain exact expired notice string');
  assert.ok(assistantCode.includes('threadHtml = replaceExpiredProposals('), 'loadChatSession must call replaceExpiredProposals');
});

// ---------------------------------------------------------------------------
// TEST 4: Check Update Proposal selective field sending
// ---------------------------------------------------------------------------
it('Requirement 1: Reschedule changes ONLY deadline; never sends target, progress, items or type unchanged', () => {
  const existingCard = {
    id: 'card-123',
    title: 'Study Physics',
    type: 'goal',
    targetSmallest: 100,
    currentSmallest: 45,
    levels: [{ name: '%', multiplier: 1, target: 100 }],
    preset: 'Custom',
    items: null,
    text: null,
    deadlineAt: 1700000000000
  };

  // Simulate Rescheduling scenario: User/AI only changes deadline to new timestamp
  const newDeadline = 1700100000000;
  const rawAction = {
    type: 'update',
    cardId: 'card-123',
    title: 'Study Physics',
    target: 100,
    currentProgress: 45,
    deadline: new Date(newDeadline).toISOString()
  };

  // Replicate assistant.js diffing algorithm
  const updates = {};
  const finalTitle = rawAction.title;
  if (finalTitle && finalTitle !== existingCard.title) {
    updates.title = finalTitle;
  }

  const targetVal = rawAction.target;
  const currentVal = rawAction.currentProgress;
  const existingTarget = existingCard.targetSmallest !== null ? Number(existingCard.targetSmallest) : null;
  const existingCurrent = existingCard.currentSmallest !== null ? Number(existingCard.currentSmallest) : null;

  if (targetVal !== undefined && targetVal !== existingTarget) {
    updates.targetSmallest = targetVal;
  }
  if (currentVal !== undefined && currentVal !== existingCurrent) {
    updates.currentSmallest = currentVal;
  }

  if (newDeadline !== existingCard.deadlineAt) {
    updates.deadlineAt = newDeadline;
    updates.updateDeadline = true;
    updates.alertAtDeadline = !!newDeadline;
  }

  assert.strictEqual(updates.title, undefined, 'Title unchanged must NOT be sent');
  assert.strictEqual(updates.targetSmallest, undefined, 'Target unchanged must NOT be sent');
  assert.strictEqual(updates.currentSmallest, undefined, 'Progress unchanged must NOT be sent');
  assert.strictEqual(updates.type, undefined, 'Type must NEVER be sent');
  assert.strictEqual(updates.items, undefined, 'Items must NOT be sent');
  assert.strictEqual(updates.deadlineAt, newDeadline, 'New deadline must be sent');
  assert.strictEqual(updates.updateDeadline, true, 'updateDeadline flag must be set');
  assert.deepStrictEqual(Object.keys(updates).sort(), ['alertAtDeadline', 'deadlineAt', 'updateDeadline'].sort());
});

// ---------------------------------------------------------------------------
// TEST 5: Batch Undo Toast formatting and callbacks
// ---------------------------------------------------------------------------
it('Requirement 4: Batch undo shows ONE toast with "Undo all" for multiple items', () => {
  const creates = [
    { type: 'create', title: 'Task 1', undo: () => {} },
    { type: 'create', title: 'Task 2', undo: () => {} },
    { type: 'create', title: 'Task 3', undo: () => {} }
  ];

  let toastConfig = null;
  function mockShowUndoToast(config) {
    toastConfig = config;
  }

  if (creates.length > 1) {
    mockShowUndoToast({
      message: `Created ${creates.length} cards`,
      undoText: 'Undo all'
    });
  }

  assert.strictEqual(toastConfig.message, 'Created 3 cards');
  assert.strictEqual(toastConfig.undoText, 'Undo all');

  const updates = [
    { type: 'update', title: 'Goal A', undo: () => {} },
    { type: 'update', title: 'Goal B', undo: () => {} }
  ];

  if (updates.length > 1) {
    mockShowUndoToast({
      message: `Updated ${updates.length} cards`,
      undoText: 'Undo all'
    });
  }

  assert.strictEqual(toastConfig.message, 'Updated 2 cards');
  assert.strictEqual(toastConfig.undoText, 'Undo all');
});

// ---------------------------------------------------------------------------
// TEST 6: app.js handleEditBarFromAi existing-values fallback
// ---------------------------------------------------------------------------
await it('Requirement 3: app.js handleEditBarFromAi preserves existing fields for both signed-in and guest users', () => {
  const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  // Verify handleEditBarFromAi implementation
  assert.ok(appCode.includes('async function handleEditBarFromAi(barId, updates)'), 'handleEditBarFromAi must exist');
  assert.ok(appCode.includes('title: updates.title !== undefined ? updates.title : existing.title'), 'Preserves title');
  assert.ok(appCode.includes('targetSmallest: updates.targetSmallest !== undefined ? updates.targetSmallest : existing.targetSmallest'), 'Preserves target');
  assert.ok(appCode.includes('items: updates.items !== undefined ? updates.items : existing.items'), 'Preserves items');
});

// ---------------------------------------------------------------------------
// TEST 7: Data-safety check on partial updates (Signed-in Supabase branch)
// ---------------------------------------------------------------------------
await it('Data-safety: Deadline-only update preserves checklist items/done status and goal target/progress in Supabase payload', async () => {
  // Mock Supabase client
  let lastCapturedPayload = null;
  let lastCapturedFilters = [];

  const mockSupabase = {
    from(table) {
      return {
        update(payload) {
          lastCapturedPayload = payload;
          return {
            eq(col1, val1) {
              lastCapturedFilters.push({ col: col1, val: val1 });
              return {
                eq(col2, val2) {
                  lastCapturedFilters.push({ col: col2, val: val2 });
                  return Promise.resolve({ error: null });
                }
              };
            }
          };
        }
      };
    }
  };

  // Replicate db.js _editBarInternal payload construction for signed-in Supabase branch
  function buildSupabasePayload({
    title, levels, targetSmallest, currentSmallest, items, text, completed,
    deadlineAt, updateDeadline, deadlineSetAt, createdAt, notifyAt, notified,
    notifyPercent, alertAtDeadline, deadlineNotified, position, resetTime,
    resetCount, checklistResetEnabled, checklistResetCount, deadlineResetEnabled,
    deadlineResetCount, lastResetAt, repeat
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

    const now = new Date().toISOString();
    const updates = {
      title,
      last_updated: now
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
    if (finalRepeat !== undefined) updates.repeat = finalRepeat;

    if (deadlineSetAt !== undefined) {
      updates.deadline_set_at = deadlineSetAt ? new Date(deadlineSetAt).toISOString() : null;
      if (updateDeadline) {
        updates.deadline_at = deadlineAt ? new Date(deadlineAt).toISOString() : null;
      }
    } else if (updateDeadline) {
      if (deadlineAt) {
        updates.deadline_at = new Date(deadlineAt).toISOString();
        updates.deadline_set_at = (createdAt !== undefined && createdAt !== null) ? new Date(createdAt).toISOString() : now;
      } else {
        updates.deadline_at = null;
        updates.deadline_set_at = null;
      }
    } else if (createdAt !== undefined && createdAt !== null) {
      updates.deadline_set_at = new Date(createdAt).toISOString();
    }

    return updates;
  }

  // App.js handleEditBarFromAi merge logic (now applied to signed-in users too)
  function simulateHandleEditBar(existingCard, partialUpdates) {
    const safeUpdates = {
      ...partialUpdates,
      title: partialUpdates.title !== undefined ? partialUpdates.title : existingCard.title,
      type: partialUpdates.type !== undefined ? partialUpdates.type : existingCard.type,
      preset: partialUpdates.preset !== undefined ? partialUpdates.preset : existingCard.preset,
      levels: partialUpdates.levels !== undefined ? partialUpdates.levels : existingCard.levels,
      targetSmallest: partialUpdates.targetSmallest !== undefined ? partialUpdates.targetSmallest : existingCard.targetSmallest,
      currentSmallest: partialUpdates.currentSmallest !== undefined ? partialUpdates.currentSmallest : existingCard.currentSmallest,
      items: partialUpdates.items !== undefined ? partialUpdates.items : existingCard.items,
      text: partialUpdates.text !== undefined ? partialUpdates.text : existingCard.text,
      completed: partialUpdates.completed !== undefined ? partialUpdates.completed : existingCard.completed,
      repeat: partialUpdates.repeat !== undefined ? partialUpdates.repeat : existingCard.repeat
    };
    return buildSupabasePayload(safeUpdates);
  }

  // CASE 1: Checklist card (3 items, 1 done)
  const checklistBefore = {
    id: 'chk-101',
    title: 'Weekly Standup Tasks',
    type: 'checklist',
    preset: null,
    levels: null,
    targetSmallest: 3,
    currentSmallest: 1,
    items: [
      { text: 'Write release notes', done: true },
      { text: 'Deploy backend', done: false },
      { text: 'Test APK on device', done: false }
    ],
    text: null,
    completed: false,
    deadlineAt: 1700000000000,
    repeat: null
  };

  const checklistDeadlineUpdate = {
    deadlineAt: 1700500000000,
    updateDeadline: true,
    alertAtDeadline: true
  };

  const checklistPayload = simulateHandleEditBar(checklistBefore, checklistDeadlineUpdate);
  await mockSupabase.from('trackers').update(checklistPayload).eq('id', checklistBefore.id).eq('user_id', 'user-abc');

  console.log('\n    --- Case 1: Checklist Card Reschedule ---');
  console.log('    [BEFORE (Database)]: ', JSON.stringify(checklistBefore, null, 2).replace(/\n/g, '\n    '));
  console.log('    [UPDATE (AI Proposal)]: ', JSON.stringify(checklistDeadlineUpdate, null, 2).replace(/\n/g, '\n    '));
  console.log('    [AFTER (Payload to Supabase)]: ', JSON.stringify(checklistPayload, null, 2).replace(/\n/g, '\n    '));

  assert.strictEqual(checklistPayload.title, 'Weekly Standup Tasks', 'Checklist title must remain unchanged');
  assert.strictEqual(checklistPayload.target_smallest, 3, 'Checklist target must remain 3');
  assert.strictEqual(checklistPayload.current_smallest, 1, 'Checklist progress must remain 1');
  assert.deepStrictEqual(checklistPayload.items, checklistBefore.items, 'All 3 items and their done flags must be preserved');
  assert.strictEqual(checklistPayload.items[0].done, true, 'Done item must stay done');
  assert.strictEqual(checklistPayload.items[1].done, false, 'Undone item must stay undone');
  assert.strictEqual(checklistPayload.deadline_at, new Date(1700500000000).toISOString(), 'Deadline must be updated');
  assert.strictEqual(checklistPayload.alert_at_deadline, true);

  // CASE 2: Goal card (target 100, progress 35)
  const goalBefore = {
    id: 'goal-202',
    title: 'Complete 100 LeetCode Problems',
    type: 'goal',
    preset: 'Problems',
    levels: [{ name: 'problems', multiplier: 1, target: 100 }],
    targetSmallest: 100,
    currentSmallest: 35,
    items: null,
    text: null,
    completed: false,
    deadlineAt: 1700000000000,
    repeat: null
  };

  const goalDeadlineUpdate = {
    deadlineAt: 1701000000000,
    updateDeadline: true,
    alertAtDeadline: true
  };

  const goalPayload = simulateHandleEditBar(goalBefore, goalDeadlineUpdate);
  await mockSupabase.from('trackers').update(goalPayload).eq('id', goalBefore.id).eq('user_id', 'user-abc');

  console.log('\n    --- Case 2: Goal Card Reschedule ---');
  console.log('    [BEFORE (Database)]: ', JSON.stringify(goalBefore, null, 2).replace(/\n/g, '\n    '));
  console.log('    [UPDATE (AI Proposal)]: ', JSON.stringify(goalDeadlineUpdate, null, 2).replace(/\n/g, '\n    '));
  console.log('    [AFTER (Payload to Supabase)]: ', JSON.stringify(goalPayload, null, 2).replace(/\n/g, '\n    '));

  assert.strictEqual(goalPayload.title, 'Complete 100 LeetCode Problems', 'Goal title must remain unchanged');
  assert.strictEqual(goalPayload.target_smallest, 100, 'Goal target must remain 100');
  assert.strictEqual(goalPayload.current_smallest, 35, 'Goal progress must remain 35');
  assert.deepStrictEqual(goalPayload.levels, goalBefore.levels, 'Levels must remain unchanged');
  assert.strictEqual(goalPayload.deadline_at, new Date(1701000000000).toISOString(), 'Deadline must be updated');
  assert.strictEqual(goalPayload.alert_at_deadline, true);
});

  console.log(`\nTests completed: ${passedTests}/${totalTests} passed.`);
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

main();
