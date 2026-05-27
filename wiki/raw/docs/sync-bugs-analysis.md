# State Synchronization Bug Analysis Report

## Executive Summary

Found **2 critical synchronization bugs** that affect multi-tab/multi-device users:

1. ✅ **FIXED**: Session closure doesn't remove from server registry
2. 🔴 **NEW BUG**: Session closure not broadcast to other tabs/devices
3. ⚠️ **MINOR**: Session creation not broadcast to other tabs (but less critical)

---

## Bug #2: Multi-Tab Session Closure Not Synchronized

### Severity: HIGH
### Impact: User confusion, stale state, potential data corruption

### Description
When a user closes a session in Tab A, Tab B (or other browser/device) is not notified. The session remains visible until page refresh, creating confusion.

### Evidence

**Current server code (index.js:384-392):**
```javascript
case 'close-session': {
  if (msg.sessionId) {
    removeSession(msg.sessionId);  // ✓ Removes from registry
    logger.info('Session closed and removed from registry', {
      sessionId: msg.sessionId,
      username: user.username
    });
    // ❌ NO BROADCAST TO OTHER TABS
  }
  break;
}
```

**Compare with other operations (pi-agent.js:889):**
```javascript
setStatus(currentSessionId, 'idle');
publish(username, { type: 'session-status', sessionId: currentSessionId, status: 'idle' });
// ✓ Broadcasts to all connected clients via SSE
```

### Reproduction Steps
1. Open app in Chrome Tab A
2. Open app in Chrome Tab B (same user)
3. Create session in Tab A
4. Close session in Tab A
5. Observe Tab B: Session still visible
6. Refresh Tab B: Session disappears (confusing!)

### Expected Behavior
Tab B should immediately remove the session when Tab A closes it.

---

## Bug #3: Session Creation Not Broadcast

### Severity: MEDIUM
### Impact: Other tabs don't see new sessions until refresh

### Description
When a new session is created, it's sent only to the WebSocket that initiated it, not broadcast to all user's connections.

### Evidence

**pi-agent.js:777-779:**
```javascript
if (!sessionId) {
  sendMessage(ws, { type: 'session-created', sessionId: currentSessionId }, username);
}
```

**sendMessage function (pi-agent.js:267-275):**
```javascript
function sendMessage(ws, data, username) {
  if (data.sessionId) {
    broadcastToSession(data.sessionId, data);
    if (username) publish(username, data);  // This DOES broadcast!
  } else {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(data));  // ❌ Direct send, no broadcast
    }
  }
}
```

The bug: `session-created` message has NO sessionId (it's being created), so it takes the `else` branch and only sends to the initiating WebSocket!

### Reproduction Steps
1. Open Tab A and Tab B
2. Create new session in Tab A
3. Tab B doesn't see new session
4. Refresh Tab B: New session appears

### Expected Behavior
Tab B should see the new session appear immediately.

---

## Recommended Fixes

### Fix for Bug #2: Broadcast Session Closure

**server/index.js:**
```javascript
case 'close-session': {
  if (msg.sessionId) {
    removeSession(msg.sessionId);
    publish(user.username, {
      type: 'session-closed',
      sessionId: msg.sessionId
    });
    logger.info('Session closed and removed from registry', {
      sessionId: msg.sessionId,
      username: user.username
    });
  }
  break;
}
```

**public/app.js (add after line 1180):**
```javascript
if (event.type === 'session-closed') {
  const index = state.sessions.findIndex(s => s.sessionId === event.sessionId);
  if (index >= 0) {
    closeSession(index);
  }
  return;
}
```

### Fix for Bug #3: Broadcast Session Creation

**Option A: Add sessionId to message so it broadcasts**
```javascript
// pi-agent.js line 777
if (!sessionId) {
  const message = { type: 'session-created', sessionId: currentSessionId };
  broadcastToSession(currentSessionId, message);
  publish(username, message);
}
```

**Option B: Always broadcast to user**
```javascript
// pi-agent.js line 777
if (!sessionId) {
  publish(username, { type: 'session-created', sessionId: currentSessionId });
}
```

---

## Other Potential Issues (Lower Priority)

### Issue #4: Model Selection Not Synced
**Location:** public/app.js:745
```javascript
localStorage.setItem('selectedModel', modelKey);
```

**Question:** Should model selection sync across devices?
- Currently: Per-browser only
- Alternative: Per-user preference on server

**Recommendation:** Keep as-is (user preference, not critical)

### Issue #5: Favorites Not Synced
**Location:** public/app.js:619

**Question:** Should favorite projects sync to server?
- Currently: Per-browser only
- Alternative: User profile on server

**Recommendation:** Consider for future, but low priority

---

## Testing Checklist

After implementing fixes:

- [ ] **Multi-tab test**: Tab A closes session → Tab B removes it
- [ ] **Multi-tab creation**: Tab A creates session → Tab B shows it
- [ ] **Multi-browser test**: Chrome closes session → Firefox removes it
- [ ] **Rapid open/close**: Create and immediately close session
- [ ] **Network disconnect**: Close during reconnect, verify sync after
- [ ] **Page refresh**: Close in Tab A, refresh Tab B, verify consistency
- [ ] **Registry persistence**: Close session, restart server, verify session doesn't reappear

---

## Architecture Considerations

### Current Pattern Issues
1. **Dual source of truth**: localStorage + server registry
2. **Optimistic updates**: Frontend assumes success without confirmation
3. **No conflict resolution**: Last write wins
4. **No versioning**: Can't detect stale updates

### Future Improvements
1. **Server as single source of truth**: Frontend always fetches from server
2. **Operational transforms**: Handle concurrent edits
3. **Event sourcing**: All changes as immutable events
4. **CRDTs**: Conflict-free replicated data types

---

## Summary

| Bug | Severity | Status | Fix Complexity |
|-----|----------|--------|----------------|
| Session closure registry sync | HIGH | ✅ FIXED | Low (done) |
| Multi-tab closure broadcast | HIGH | 🔴 NEW | Low (5 lines) |
| Multi-tab creation broadcast | MEDIUM | 🔴 NEW | Low (2 lines) |
| Model selection sync | LOW | ⚠️ Design choice | N/A |
| Favorites sync | LOW | ⚠️ Design choice | N/A |

**Recommended Action:** Implement fixes for Bug #2 and #3 immediately. These are simple changes that significantly improve multi-tab UX.
