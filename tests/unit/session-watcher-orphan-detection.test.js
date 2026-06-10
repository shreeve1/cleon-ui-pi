import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  checkLastMessageTurnState,
  evaluateStaleStreaming,
  evaluateAttachStaleRecovery,
} from '../../server/session-watcher.js';

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orphan-detection-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeJsonl(filename, entries) {
  const filePath = path.join(tmpDir, filename);
  const text = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await fs.writeFile(filePath, text);
  return filePath;
}

describe('checkLastMessageTurnState', () => {
  it('reports the final assistant message and its stopReason', async () => {
    const filePath = await writeJsonl('session.jsonl', [
      { type: 'message', timestamp: '2026-05-27T10:00:00Z', message: { role: 'user', content: 'hi' } },
      { type: 'message', timestamp: '2026-05-27T10:00:05Z', message: { role: 'assistant', stopReason: 'stop', content: 'hello' } },
    ]);
    const state = await checkLastMessageTurnState(filePath);
    expect(state.lastRole).toBe('assistant');
    expect(state.stopReason).toBe('stop');
    expect(state.timestamp).toBeInstanceOf(Date);
    expect(state.fileMtimeMs).toBeTypeOf('number');
  });

  it('skips non-message entries when finding the last message', async () => {
    const filePath = await writeJsonl('compaction.jsonl', [
      { type: 'message', timestamp: '2026-05-27T10:00:00Z', message: { role: 'user', content: 'hi' } },
      { type: 'message', timestamp: '2026-05-27T10:00:05Z', message: { role: 'assistant', stopReason: 'stop', content: 'first reply' } },
      { type: 'compaction', timestamp: '2026-05-27T10:00:10Z', summary: 'summary', firstKeptEntryId: 'x', tokensBefore: 1000 },
      { type: 'model_change', timestamp: '2026-05-27T10:00:11Z', provider: 'openai', modelId: 'gpt-5.5' },
    ]);
    const state = await checkLastMessageTurnState(filePath);
    // Most recent type:"message" entry is the assistant 'stop' message;
    // compaction/model_change entries are ignored.
    expect(state.lastRole).toBe('assistant');
    expect(state.stopReason).toBe('stop');
  });

  it('returns stopReason "toolUse" when the assistant is mid-tool-call', async () => {
    const filePath = await writeJsonl('toolUse.jsonl', [
      { type: 'message', timestamp: '2026-05-27T10:00:00Z', message: { role: 'user', content: 'list files' } },
      { type: 'message', timestamp: '2026-05-27T10:00:05Z', message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'tool_use', name: 'bash' }] } },
    ]);
    const state = await checkLastMessageTurnState(filePath);
    expect(state.stopReason).toBe('toolUse');
  });

  it('returns user as lastRole when the file ends on a user message', async () => {
    const filePath = await writeJsonl('user-last.jsonl', [
      { type: 'message', timestamp: '2026-05-27T10:00:00Z', message: { role: 'user', content: 'hi' } },
    ]);
    const state = await checkLastMessageTurnState(filePath);
    expect(state.lastRole).toBe('user');
    expect(state.stopReason).toBe(null);
  });

  it('exposes fileMtimeMs even when no message entries exist', async () => {
    const filePath = path.join(tmpDir, 'empty.jsonl');
    await fs.writeFile(filePath, '');
    const state = await checkLastMessageTurnState(filePath);
    expect(state.lastRole).toBe(null);
    expect(state.fileMtimeMs).toBeTypeOf('number');
  });

  it('returns fileMtimeMs null for a missing file', async () => {
    const state = await checkLastMessageTurnState(path.join(tmpDir, 'does-not-exist.jsonl'));
    expect(state.fileMtimeMs).toBe(null);
  });
});

describe('evaluateAttachStaleRecovery', () => {
  const now = Date.parse('2026-05-27T12:00:00Z');

  it('recovers streaming inactive sessions when no session file is known', () => {
    const result = evaluateAttachStaleRecovery({
      registryStatus: 'streaming',
      isActive: false,
      sessionFile: null,
      turnState: null,
    }, now);
    expect(result.recover).toBe(true);
    expect(result.reason).toBe('missing-session-file');
  });

  it('recovers streaming inactive sessions when turn state has no usable file mtime', () => {
    const result = evaluateAttachStaleRecovery({
      registryStatus: 'streaming',
      isActive: false,
      sessionFile: '/tmp/session.jsonl',
      turnState: {
        lastRole: null,
        timestamp: null,
        stopReason: null,
        fileMtimeMs: null,
      },
    }, now);
    expect(result.recover).toBe(true);
    expect(result.reason).toBe('unusable-turn-state');
  });

  it('does not recover active streaming sessions', () => {
    const result = evaluateAttachStaleRecovery({
      registryStatus: 'streaming',
      isActive: true,
      sessionFile: null,
      turnState: null,
    }, now);
    expect(result.recover).toBe(false);
  });

  it('does not recover non-streaming sessions', () => {
    const result = evaluateAttachStaleRecovery({
      registryStatus: 'idle',
      isActive: false,
      sessionFile: null,
      turnState: null,
    }, now);
    expect(result.recover).toBe(false);
  });

  it('delegates normal stale decisions to evaluateStaleStreaming', () => {
    const result = evaluateAttachStaleRecovery({
      registryStatus: 'streaming',
      isActive: false,
      sessionFile: '/tmp/session.jsonl',
      turnState: {
        lastRole: 'assistant',
        stopReason: 'stop',
        timestamp: new Date(now - 5000),
        fileMtimeMs: now - 5000,
      },
    }, now);
    expect(result.recover).toBe(true);
    expect(result.reason).toBe('message-age');
  });

  it('keeps fresh inactive streaming sessions streaming', () => {
    const result = evaluateAttachStaleRecovery({
      registryStatus: 'streaming',
      isActive: false,
      sessionFile: '/tmp/session.jsonl',
      turnState: {
        lastRole: 'assistant',
        stopReason: 'toolUse',
        timestamp: new Date(now - 60_000),
        fileMtimeMs: now - 2_000,
      },
    }, now);
    expect(result.recover).toBe(false);
  });
});

describe('evaluateStaleStreaming', () => {
  const now = Date.parse('2026-05-27T12:00:00Z');

  it('flags a clean assistant turn that has been quiet >3s', () => {
    const result = evaluateStaleStreaming({
      lastRole: 'assistant',
      stopReason: 'stop',
      timestamp: new Date(now - 5000),
      fileMtimeMs: now - 5000,
    }, now);
    expect(result.stale).toBe(true);
    expect(result.reason).toBe('message-age');
  });

  it('does NOT flag a clean assistant turn that is still fresh', () => {
    const result = evaluateStaleStreaming({
      lastRole: 'assistant',
      stopReason: 'stop',
      timestamp: new Date(now - 500),
      fileMtimeMs: now - 500,
    }, now);
    expect(result.stale).toBe(false);
    expect(result.reason).toBe(null);
  });

  it('flags a mid-toolUse crash once the file goes quiet for >5min', () => {
    // Previously a false-negative: stopReason='toolUse' kept the predicate
    // skipping forever even though the owning process had died.
    const result = evaluateStaleStreaming({
      lastRole: 'assistant',
      stopReason: 'toolUse',
      timestamp: new Date(now - 10 * 60_000),
      fileMtimeMs: now - 10 * 60_000,
    }, now);
    expect(result.stale).toBe(true);
    expect(result.reason).toBe('file-age');
  });

  it('flags a crash right after a user prompt once the file is quiet', () => {
    // Previously a false-negative: lastRole='user' skipped the assistant gate.
    const result = evaluateStaleStreaming({
      lastRole: 'user',
      stopReason: null,
      timestamp: new Date(now - 10 * 60_000),
      fileMtimeMs: now - 10 * 60_000,
    }, now);
    expect(result.stale).toBe(true);
    expect(result.reason).toBe('file-age');
  });

  it('does NOT flag an in-progress toolUse when the file is still being written', () => {
    const result = evaluateStaleStreaming({
      lastRole: 'assistant',
      stopReason: 'toolUse',
      timestamp: new Date(now - 60_000),
      fileMtimeMs: now - 2_000,
    }, now);
    expect(result.stale).toBe(false);
  });

  it('does NOT flag a CLI session mid-LLM-call (long generation after user prompt)', () => {
    // Pi only persists *complete* messages, so during a long LLM call the
    // file mtime can be older than a minute while the session is still live.
    // 5-min threshold (= session-watcher.ACTIVE_THRESHOLD_MS) keeps this from
    // tripping the orphan check.
    const result = evaluateStaleStreaming({
      lastRole: 'user',
      stopReason: null,
      timestamp: new Date(now - 90_000),
      fileMtimeMs: now - 90_000,
    }, now);
    expect(result.stale).toBe(false);
  });

  it('handles a fileMtimeMs-only turnState (no last message entry)', () => {
    // checkLastMessageTurnState returns nulls for lastRole/stopReason when
    // the file is empty or has no message entries. Predicate should still
    // be able to evict via file-age alone.
    const result = evaluateStaleStreaming({
      lastRole: null,
      stopReason: null,
      timestamp: null,
      fileMtimeMs: now - 10 * 60_000,
    }, now);
    expect(result.stale).toBe(true);
    expect(result.reason).toBe('file-age');
  });

  it('returns stale=false when both signals are absent', () => {
    const result = evaluateStaleStreaming({
      lastRole: null,
      stopReason: null,
      timestamp: null,
      fileMtimeMs: null,
    }, now);
    expect(result.stale).toBe(false);
    expect(result.reason).toBe(null);
  });
});

// Higher-fidelity: drive the predicate from a real session file on disk,
// proving checkLastMessageTurnState + evaluateStaleStreaming compose
// correctly without an HTTP layer.
describe('orphan-detection: file → predicate end-to-end', () => {
  it('flags a crashed mid-toolUse session whose file is old', async () => {
    const filePath = await writeJsonl('crashed-tooluse.jsonl', [
      { type: 'message', timestamp: '2026-05-27T10:00:00Z', message: { role: 'user', content: 'list files' } },
      { type: 'message', timestamp: '2026-05-27T10:00:05Z', message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'tool_use', name: 'bash' }] } },
    ]);
    // Backdate mtime so it's well beyond STALE_FILE_AGE_MS (5min).
    const oldMs = Date.now() - 10 * 60_000;
    await fs.utimes(filePath, oldMs / 1000, oldMs / 1000);

    const turnState = await checkLastMessageTurnState(filePath);
    expect(turnState.stopReason).toBe('toolUse');

    const decision = evaluateStaleStreaming(turnState);
    expect(decision.stale).toBe(true);
    expect(decision.reason).toBe('file-age');
  });

  it('does NOT flag a live CLI session whose file was just touched', async () => {
    const filePath = await writeJsonl('live-cli.jsonl', [
      { type: 'message', timestamp: new Date().toISOString(), message: { role: 'user', content: 'still streaming' } },
    ]);
    const turnState = await checkLastMessageTurnState(filePath);
    expect(turnState.lastRole).toBe('user');

    const decision = evaluateStaleStreaming(turnState);
    expect(decision.stale).toBe(false);
  });

  it('flags a normal completed turn after the 3s grace period', async () => {
    const old = new Date(Date.now() - 5000).toISOString();
    const filePath = await writeJsonl('completed-turn.jsonl', [
      { type: 'message', timestamp: old, message: { role: 'user', content: 'hi' } },
      { type: 'message', timestamp: old, message: { role: 'assistant', stopReason: 'stop', content: 'done' } },
    ]);
    const turnState = await checkLastMessageTurnState(filePath);
    const decision = evaluateStaleStreaming(turnState);
    expect(decision.stale).toBe(true);
    expect(decision.reason).toBe('message-age');
  });
});
