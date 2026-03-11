/**
 * Extension UI Bridge — adapts SDK ExtensionUIContext callbacks
 * into WebSocket messages to the browser and waits for responses.
 *
 * The SDK calls methods like `select()`, `confirm()`, `input()` directly
 * on the ExtensionUIContext. This bridge converts those into the same
 * WebSocket message format that the frontend already understands from
 * RPC mode, and returns the browser's response back to the SDK.
 */

import { randomUUID } from 'crypto';

/**
 * Create an ExtensionUIContext bridge for a session.
 *
 * @param {string} sessionId
 * @param {Function} sendMessage - Function to send messages to the frontend
 * @param {string} username
 * @returns {{ uiContext: import('@mariozechner/pi-coding-agent').ExtensionUIContext, handleResponse: Function }}
 */
export function createExtensionUIBridge(sessionId, sendMessage, username) {
  // Pending UI requests: requestId → { resolve }
  const pending = new Map();

  function getFirstResponseValue(result) {
    if (result === undefined || result === null) return undefined;
    if (typeof result !== 'object') return result;

    const values = Object.values(result);
    if (values.length === 0) return undefined;
    return values[0];
  }

  function normalizeSingleValue(result) {
    const value = getFirstResponseValue(result);
    if (Array.isArray(value)) {
      return value.length > 0 ? value[0] : undefined;
    }
    return value;
  }

  function normalizeSelectValue(result, canPickMany = false) {
    const value = getFirstResponseValue(result);
    if (Array.isArray(value)) {
      return canPickMany ? value : value[0];
    }
    return value;
  }

  /**
   * Send a UI request to the browser and wait for the response.
   */
  function sendAndWait(type, payload) {
    return new Promise((resolve) => {
      const requestId = randomUUID();
      pending.set(requestId, { resolve });

      // Send as a 'question' message matching the existing frontend format
      sendMessage({
        type: 'message',
        sessionId,
        data: {
          type: 'question',
          id: requestId,
          ...payload,
        },
      }, username);
    });
  }

  const uiContext = {
    async select(title, options, opts) {
      const uiOptions = options.map(opt => ({ label: opt }));
      const result = await sendAndWait('select', {
        questions: [{
          question: title || 'Select an option',
          header: title || '',
          options: uiOptions,
          multiSelect: opts?.canPickMany || false,
        }],
      });

      const normalized = normalizeSelectValue(result, opts?.canPickMany || false);
      return normalized;
    },

    async confirm(title, message, opts) {
      const result = await sendAndWait('confirm', {
        questions: [{
          question: message || title || 'Confirm?',
          header: title || '',
          options: [
            { label: 'Yes', description: opts?.confirmLabel || 'Confirm' },
            { label: 'No', description: opts?.cancelLabel || 'Cancel' },
          ],
          multiSelect: false,
        }],
      });

      const normalized = normalizeSingleValue(result);
      if (normalized === undefined || normalized === null) return false;
      return normalized === 'Yes';
    },

    async input(title, placeholder, opts) {
      const result = await sendAndWait('input', {
        questions: [{
          question: title || 'Enter a value',
          header: title || '',
          options: [],
          multiSelect: false,
          freeText: true,
          placeholder: placeholder || '',
        }],
      });

      return normalizeSingleValue(result);
    },

    notify(message, type) {
      // Fire-and-forget notification to the frontend
      sendMessage({
        type: 'message',
        sessionId,
        data: {
          type: 'text',
          content: `\n[${type || 'info'}] ${message}\n`,
          timestamp: new Date().toISOString(),
          messageId: randomUUID(),
        },
      }, username);
    },

    onTerminalInput() {
      // Not applicable for web UI — return noop unsubscribe
      return () => {};
    },

    setStatus(key, text) {
      // Could send status updates to frontend if needed
    },

    setWorkingMessage(message) {
      // Could send working message to frontend if needed
    },

    setWidget(placement, content) {
      // Not applicable for web UI
    },
  };

  return {
    uiContext,

    /**
     * Handle a response from the browser for a pending UI request.
     * @param {string} requestId
     * @param {*} result
     */
    handleResponse(requestId, result) {
      const p = pending.get(requestId);
      if (p) {
        p.resolve(result);
        pending.delete(requestId);
      }
    },

    /**
     * Reject all pending requests (e.g., on session abort/cleanup).
     */
    cleanup() {
      for (const [id, p] of pending) {
        p.resolve(undefined);
      }
      pending.clear();
    },
  };
}
