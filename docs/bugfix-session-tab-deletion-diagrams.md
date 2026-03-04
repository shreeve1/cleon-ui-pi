# Session Tab Deletion Bug - Visual Flow

## Before Fix: Sessions Reappear After Refresh

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER CLOSES TAB                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
           ┌─────────────────────────────────────┐
           │   Frontend closeSession(index)      │
           │   - Remove from state.sessions ✓    │
           │   - Update localStorage ✓           │
           │   - Tell server to remove ✗ MISSING │
           └──────────────┬──────────────────────┘
                          │
          ┌───────────────┴────────────┐
          │                            │
          ▼                            ▼
   ┌─────────────┐            ┌──────────────────┐
   │ Browser     │            │ Server Registry  │
   │ localStorage│            │ (persists to     │
   │             │            │  disk)           │
   │ Sessions:   │            │                  │
   │ [A, B]      │            │ Sessions:        │
   │ (C removed) │            │ [A, B, C] ← BUG  │
   └─────────────┘            └──────────────────┘
          │                            │
          │                            │
          │         PAGE REFRESH       │
          │                            │
          ▼                            ▼
   ┌─────────────┐            ┌──────────────────┐
   │ Restore     │            │ SSE Connects     │
   │ from local  │            │                  │
   │ Storage     │            │ Sends ALL        │
   │             │            │ sessions in      │
   │ Restores:   │            │ registry:        │
   │ [A, B]      │            │ [A, B, C]        │
   └──────┬──────┘            └────────┬─────────┘
          │                            │
          │      state-snapshot        │
          │  ◄─────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  Frontend sees session C         │
   │  "orphaned" in state-snapshot    │
   │                                  │
   │  Auto-adopts C back → BUG        │
   │  (app.js:1143-1156)              │
   └──────────────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  RESULT: All 3 tabs back         │
   │  [A] [B] [C] ← C should be gone  │
   └──────────────────────────────────┘
```

## After Fix: Proper Session Removal

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER CLOSES TAB                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
           ┌─────────────────────────────────────┐
           │   Frontend closeSession(index)      │
           │   - Remove from state.sessions ✓    │
           │   - Update localStorage ✓           │
           │   - Send WebSocket message:         │
           │     { type: 'close-session',        │
           │       sessionId: 'C' } ✓ NEW        │
           └──────────────┬──────────────────────┘
                          │
          ┌───────────────┴────────────┐
          │                            │
          ▼                            ▼
   ┌─────────────┐            ┌──────────────────┐
   │ Browser     │            │ Server Handler   │
   │ localStorage│            │                  │
   │             │            │ case 'close-     │
   │ Sessions:   │            │   session':      │
   │ [A, B]      │            │   remove('C') ✓  │
   │ (C removed) │            │                  │
   └─────────────┘            │ Sessions: [A,B]  │
          │                   └──────────────────┘
          │                            │
          │         PAGE REFRESH       │
          │                            │
          ▼                            ▼
   ┌─────────────┐            ┌──────────────────┐
   │ Restore     │            │ SSE Connects     │
   │ from local  │            │                  │
   │ Storage     │            │ Sends ALL        │
   │             │            │ sessions in      │
   │ Restores:   │            │ registry:        │
   │ [A, B]      │            │ [A, B] ✓         │
   └──────┬──────┘            └────────┬─────────┘
          │                            │
          │      state-snapshot        │
          │  ◄─────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  state-snapshot matches          │
   │  localStorage                    │
   │                                  │
   │  No orphaned sessions            │
   └──────────────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  RESULT: Correct tabs shown      │
   │  [A] [B] ✓ C is gone             │
   └──────────────────────────────────┘
```

## Code Changes Summary

### Server (`server/index.js`)

```diff
+ import { getSessionsForUser, getSession as getRegistrySession, 
+          isStreaming as isSessionStreaming, 
+          remove as removeSession } from './session-registry.js';

  switch (msg.type) {
+   case 'close-session': {
+     if (msg.sessionId) {
+       removeSession(msg.sessionId);
+       logger.info('Session closed and removed from registry', { 
+         sessionId: msg.sessionId, 
+         username: user.username 
+       });
+     }
+     break;
+   }
  }
```

### Frontend (`public/app.js`)

```diff
  function closeSession(index) {
    if (index < 0 || index >= state.sessions.length) return;
    const session = state.sessions[index];

    // Abort if streaming
    if (session.isStreaming && session.sessionId) {
      state.ws.send(JSON.stringify({ type: 'abort', sessionId: session.sessionId }));
    }

+   // Remove from server registry if session exists
+   if (session.sessionId && state.ws && state.ws.readyState === WebSocket.OPEN) {
+     state.ws.send(JSON.stringify({ type: 'close-session', sessionId: session.sessionId }));
+   }

    // Clean up timers
    clearTimeout(session.fileMentionDebounceTimer);
    // ... rest of function
  }
```

## Key Points

1. **State synchronization is critical**: Any entity lifecycle change must propagate to all state holders
2. **Server registry persists to disk**: Sessions survive restarts, so proper cleanup is essential
3. **Auto-adopt feature is helpful** for recovering sessions after crashes, but needs accurate registry
4. **Pattern established**: Other session operations (abort, question-response) already follow this pattern

## Testing Checklist

- [ ] Close tab with active session → refresh → session stays closed
- [ ] Close multiple tabs → refresh → only non-closed tabs appear
- [ ] Close tab without session ID (new unsaved session) → no error
- [ ] Close tab while WebSocket disconnected → handled gracefully
- [ ] Server logs show session removal
- [ ] Registry file on disk is updated after session close
