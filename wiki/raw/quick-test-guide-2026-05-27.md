# Quick Test Guide - Sync Bug Fixes

## Server Status
✓ **Server running on port 3015** (PID: 96672)

## Quick Test Steps (2 minutes)

### Test 1: Original Bug - Session Deletion Persistence
1. Open: http://localhost:3015
2. Create a session (pick any project)
3. Close the session tab (click X on the tab)
4. **Refresh the page**
5. ✅ **Expected**: Session does NOT come back

### Test 2: Multi-Tab Sync - Closure
1. Open 2 tabs: http://localhost:3015
2. Tab A: Create a session
3. Tab B: Wait 2 seconds, verify session appears
4. Tab A: Close the session
5. ✅ **Expected**: Tab B session disappears immediately

### Test 3: Multi-Tab Sync - Creation
1. Keep both tabs open
2. Tab A: Create a new session
3. ✅ **Expected**: Tab B shows new session within 2 seconds

## What Was Fixed

### Bug #1: Session Reappearing After Deletion + Refresh
**Problem**: Closing a tab only removed from localStorage, not server registry
**Fix**: Now sends `close-session` message to server

### Bug #2: Multi-Tab Closure Not Synced
**Problem**: Closing in Tab A didn't notify Tab B
**Fix**: Server now broadcasts `session-closed` event to all tabs

### Bug #3: Multi-Tab Creation Not Synced
**Problem**: Creating in Tab A didn't show in Tab B
**Fix**: Server now broadcasts `session-created` event to all tabs

## Files Changed
- `server/index.js` - Added broadcast for session closure
- `server/pi-agent.js` - Added broadcast for session creation
- `public/app.js` - Added handlers for remote session events

## Full Documentation
See: `docs/sync-bugs-analysis.md`
