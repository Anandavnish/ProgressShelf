/**
 * Test Harness for ProgressShelf AI Assistant
 * Provides test utilities for simulated/mock AI state and testing proposal lifecycles.
 */

export function createAssistantTestHarness(targetWindow = (typeof window !== 'undefined' ? window : null)) {
  if (!targetWindow) return null;

  return {
    simulateConnectedState(status = { connected: true, last4: 'test' }) {
      if (typeof targetWindow.renderAssistantState === 'function') {
        targetWindow.renderAssistantState(status);
      }
    },
    simulateGuestState() {
      if (typeof targetWindow.renderAssistantState === 'function') {
        targetWindow.renderAssistantState({ connected: false, last4: null });
      }
    },
    mockAiStatus(status) {
      targetWindow.aiStatus = async () => status;
    }
  };
}

if (typeof window !== 'undefined') {
  window.createAssistantTestHarness = createAssistantTestHarness;
}
