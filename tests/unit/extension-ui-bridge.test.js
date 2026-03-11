import { describe, it, expect, vi } from 'vitest';
import { createExtensionUIBridge } from '../../server/extension-ui-bridge.js';

function setupBridge() {
  const messages = [];
  const sendMessage = vi.fn((payload) => {
    messages.push(payload);
  });

  const bridge = createExtensionUIBridge('session-1', sendMessage, 'james');

  return { ...bridge, messages, sendMessage };
}

describe('createExtensionUIBridge', () => {
  it('maps array-backed confirm response "Yes" to true', async () => {
    const { uiContext, handleResponse, messages } = setupBridge();

    const pending = uiContext.confirm('Confirm action', 'Proceed?');
    const requestId = messages[0].data.id;

    handleResponse(requestId, { 0: ['Yes'] });

    await expect(pending).resolves.toBe(true);
  });

  it('maps array-backed confirm response "No" to false', async () => {
    const { uiContext, handleResponse, messages } = setupBridge();

    const pending = uiContext.confirm('Confirm action', 'Proceed?');
    const requestId = messages[0].data.id;

    handleResponse(requestId, { 0: ['No'] });

    await expect(pending).resolves.toBe(false);
  });

  it('unwraps single-select array responses to a string', async () => {
    const { uiContext, handleResponse, messages } = setupBridge();

    const pending = uiContext.select('Choose one', ['Alpha', 'Beta']);
    const requestId = messages[0].data.id;

    handleResponse(requestId, { 0: ['Beta'] });

    await expect(pending).resolves.toBe('Beta');
  });

  it('preserves multi-select array responses', async () => {
    const { uiContext, handleResponse, messages } = setupBridge();

    const pending = uiContext.select('Choose many', ['Alpha', 'Beta'], { canPickMany: true });
    const requestId = messages[0].data.id;

    handleResponse(requestId, { 0: ['Alpha', 'Beta'] });

    await expect(pending).resolves.toEqual(['Alpha', 'Beta']);
  });

  it('unwraps array-backed input responses to a string', async () => {
    const { uiContext, handleResponse, messages } = setupBridge();

    const pending = uiContext.input('Enter name', 'Name');
    const requestId = messages[0].data.id;

    handleResponse(requestId, { 0: ['Cleon'] });

    await expect(pending).resolves.toBe('Cleon');
  });
});
