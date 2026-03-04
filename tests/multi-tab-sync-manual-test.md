# Manual Test Plan - Multi-Tab Synchronization

## Test Environment Setup
1. Start server: `npm start`
2. Open Chrome (or any browser)
3. Open at least 2 tabs to the same URL (e.g., http://localhost:3010)

## Test Suite 1: Session Closure Synchronization

### Test 1.1: Basic Multi-Tab Closure
**Steps:**
1. Tab A: Create a new session for any project
2. Tab B: Verify the new session appears (may need to wait 1-2 seconds)
3. Tab A: Close the session tab
4. Tab B: Verify the session disappears immediately

**Expected:** Session removed from both tabs
**Actual:** ___________
**Status:** ☐ PASS ☐ FAIL

---

### Test 1.2: Cross-Browser Closure
**Steps:**
1. Chrome Tab A: Create a session
2. Firefox Tab B: Verify session appears
3. Chrome Tab A: Close the session
4. Firefox Tab B: Verify session disappears

**Expected:** Session removed from both browsers
**Actual:** ___________
**Status:** ☐ PASS ☐ FAIL

---

### Test 1.3: Multiple Sessions
**Steps:**
1. Tab A: Create sessions 1, 2, 3
2. Tab B: Verify all 3 appear
3. Tab A: Close session 2
4. Tab B: Verify only sessions 1 and 3 remain

**Expected:** Correct session removed
**Actual:** ___________
**Status:** ☐ PASS ☐ FAIL

---

## Test Suite 2: Session Creation Synchronization

### Test 2.1: Basic Multi-Tab Creation
**Steps:**
1. Tab A: Start new session
2. Tab B: Verify new session appears within 1-2 seconds
3. Tab B: Check session has correct project name

**Expected:** New session appears in Tab B
**Actual:** ___________
**Status:** ☐ PASS ☐ FAIL

---

### Test 2.2: Streaming Status Sync
**Steps:**
1. Tab A: Start a chat (send a message)
2. Tab B: Verify the session shows as streaming
3. Wait for response to complete
4. Tab B: Verify session shows as idle

**Expected:** Streaming status synchronized
**Actual:** ___________
**Status:** ☐ PASS ☐ FAIL

---

## Test Suite 3: Edge Cases

### Test 3.1: Network Disconnect During Close
**Steps:**
1. Tab A: Create session
2. Tab B: Verify session appears
3. Disconnect network (turn off WiFi)
4. Tab A: Close session
5. Reconnect network
6. Tab B: Refresh page
7. Verify session doesn't reappear

**Expected:** Session stays closed after reconnect
**Actual:** ___________
**Status:** ☐ PASS ☐ FAIL

---

### Test 3.2: Rapid Open/Close
**Steps:**
1. Tab A: Create session, immediately close it
2. Tab B: Verify session doesn't appear (or appears then disappears)
3. Refresh both tabs
4. Verify session is gone

**Expected:** No orphaned sessions
**Actual:** ___________
**Status:** ☐ PASS ☐ FAIL

---

### Test 3.3: Close Active Session
**Steps:**
1. Tab A: Create 2 sessions
2. Tab B: Verify both appear
3. Tab A: Close the active session
4. Tab B: Verify session disappears
5. Tab B: Verify it switches to another session automatically

**Expected:** Graceful handling of active session closure
**Actual:** ___________
**Status:** ☐ PASS ☐ FAIL

---

## Test Suite 4: Persistence & Recovery

### Test 4.1: Server Restart
**Steps:**
1. Tab A: Create session
2. Tab B: Verify session appears
3. Tab A: Close session
4. Restart server (PM2 restart or kill/restart)
5. Tab B: Refresh page
6. Verify session doesn't reappear

**Expected:** Registry persists, closed session stays closed
**Actual:** ___________
**Status:** ☐ PASS ☐ FAIL

---

### Test 4.2: Multi-Device Persistence
**Steps:**
1. Device A (Desktop): Create session
2. Device B (Phone): Verify session appears
3. Device A: Close session
4. Device B: Verify session disappears
5. Device B: Close browser, reopen
6. Device B: Verify session still gone

**Expected:** Cross-device sync works
**Actual:** ___________
**Status:** ☐ PASS ☐ FAIL

---

## Regression Tests

### Regression Test 1: Original Bug (Session Reappearance)
**Steps:**
1. Create a session
2. Close the session tab
3. Refresh the page

**Expected:** Session does NOT reappear
**Actual:** ___________
**Status:** ☐ PASS ☐ FAIL

---

### Regression Test 2: Single Tab Behavior
**Steps:**
1. Single tab: Create session
2. Close session
3. Refresh page

**Expected:** Normal operation, no errors
**Actual:** ___________
**Status:** ☐ PASS ☐ FAIL

---

## Notes

**Browser Tested:** ___________
**OS:** ___________
**Date:** ___________
**Tester:** ___________

**Issues Found:**
_____________________________________
_____________________________________
_____________________________________

**Overall Status:** ☐ ALL TESTS PASS ☐ SOME FAILURES (document above)
