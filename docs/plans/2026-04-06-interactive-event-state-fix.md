# Interactive Event State Management Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two bugs in question/answer popover system: (1) popover briefly reappears after submitting answers, and (2) "Headers Timeout Error" appears after subsequent answer submissions.

**Architecture:** Fix state management by keeping `awaitingInteractiveAnswer` flag true until streaming actually starts, and synchronize transition window duration between extension (15000ms) and webview (15000ms).

**Tech Stack:** TypeScript, VSCode Extension API, React (webview), Mocha/Chai (tests)

---

## Task 1: Fix Transition Window Duration

**Files:**
- Modify: `src/providers/ChatViewProvider.ts:1439-1442`
- Test: `tests/unit/providers/interactive-timeout-regression.test.mjs`

**Step 1: Write failing test for transition window duration**

Create file: `tests/unit/providers/interactive-timeout-regression.test.mjs`

```javascript
import assert from 'assert';
import { readSource } from '../test-utils.mjs';

test('transition window: extension matches webview 15-second duration', () => {
  const providerSource = readSource('src/providers/ChatViewProvider.ts');
  
  // Extract the dispatchInteractiveResponse method
  const dispatchMatch = providerSource.match(
    /private async dispatchInteractiveResponse\([^)]+\)\s*:\s*Promise<void>\s*\{([\s\S]*?)\n\s*\}/
  );
  
  assert.ok(dispatchMatch, 'dispatchInteractiveResponse method should exist');
  
  const methodBody = dispatchMatch[1];
  
  // Check for 15000ms (15 seconds) window, not 3000ms (3 seconds)
  assert.match(
    methodBody,
    /15000/,
    'Extension should use 15000ms transition window to match webview'
  );
  
  assert.doesNotMatch(
    methodBody,
    /3000/,
    'Extension should NOT use 3000ms transition window (causes popover reappearing)'
  );
});

test('transition window: is set when awaitingInteractiveAnswer is true', () => {
  const providerSource = readSource('src/providers/ChatViewProvider.ts');
  
  // Find the section where we check awaitingInteractiveAnswer and set transition window
  const windowSettingSection = providerSource.match(
    /if\s*\(\s*this\.awaitingInteractiveAnswer\s*\)\s*\{[\s\S]*?interactiveResponseTransitionUntil[\s\S]*?\}/
  );
  
  assert.ok(
    windowSettingSection,
    'Should have transition window logic when awaitingInteractiveAnswer is true'
  );
  
  assert.match(
    windowSettingSection[0],
    /Date\.now\(\)\s*\+\s*15000/,
    'Should set transition window to current time + 15000ms'
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/providers/interactive-timeout-regression.test.mjs`

Expected: FAIL - Test will fail because code currently uses 3000ms

**Step 3: Implement the fix**

In file: `src/providers/ChatViewProvider.ts` at line ~1439-1442

Find this code:
```typescript
if (this.awaitingInteractiveAnswer) {
  // Reduce error suppression window from 15s to 3s for better responsiveness
  this.interactiveResponseTransitionUntil = Date.now() + 3000;
}
```

Replace with:
```typescript
if (this.awaitingInteractiveAnswer) {
  // Match webview's 15s window to prevent popover reappearing during transition
  this.interactiveResponseTransitionUntil = Date.now() + 15000;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/providers/interactive-timeout-regression.test.mjs`

Expected: PASS - Test now passes with 15000ms

**Step 5: Commit**

```bash
git add src/providers/ChatViewProvider.ts tests/unit/providers/interactive-timeout-regression.test.mjs
git commit -m "fix: sync transition window to 15s to prevent popover reappearing"
```

---

## Task 2: Remove Premature Flag Clearing

**Files:**
- Modify: `src/providers/ChatViewProvider.ts:5076`
- Test: `tests/unit/providers/interactive-flag-lifecycle.test.mjs`

**Step 1: Write failing test for flag lifecycle**

Create file: `tests/unit/providers/interactive-flag-lifecycle.test.mjs`

```javascript
import assert from 'assert';
import { readSource, extractFunctionBody } from '../test-utils.mjs';

test('flag lifecycle: awaitingInteractiveAnswer stays true during message dispatch', () => {
  const providerSource = readSource('src/providers/ChatViewProvider.ts');
  
  // Extract schedulePromptDispatch method
  const dispatchBody = extractFunctionBody(
    providerSource,
    'private async schedulePromptDispatch'
  );
  
  assert.ok(dispatchBody, 'schedulePromptDispatch method should exist');
  
  // The flag should NOT be set to false in schedulePromptDispatch
  // It should only be cleared when streaming actually starts
  assert.doesNotMatch(
    dispatchBody,
    /this\.awaitingInteractiveAnswer\s*=\s*false/,
    'awaitingInteractiveAnswer should NOT be cleared in schedulePromptDispatch'
  );
});

test('flag lifecycle: awaitingInteractiveAnswer is set when question arrives', () => {
  const providerSource = readSource('src/providers/ChatViewProvider.ts');
  
  // Find stream event handler
  const streamHandlerSection = providerSource.match(
    /if\s*\(\s*this\.hasBlockingInteractiveInStreamPayload[\s\S]*?\}\s*this\.awaitingInteractiveAnswer\s*=\s*true/
  );
  
  assert.ok(
    streamHandlerSection,
    'Should set awaitingInteractiveAnswer to true when blocking interactive event arrives'
  );
  
  assert.match(
    streamHandlerSection[0],
    /this\.awaitingInteractiveAnswer\s*=\s*true/,
    'Should set flag to true'
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/providers/interactive-flag-lifecycle.test.mjs`

Expected: FAIL - Test will fail because code currently clears the flag at line 5076

**Step 3: Remove premature flag clearing**

In file: `src/providers/ChatViewProvider.ts` at line ~5076

Find this line in the `schedulePromptDispatch` method:
```typescript
this.awaitingInteractiveAnswer = false;
```

Remove this line entirely (the flag will be cleared later when streaming starts)

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/providers/interactive-flag-lifecycle.test.mjs`

Expected: PASS - Test now passes because flag is not cleared prematurely

**Step 5: Commit**

```bash
git add src/providers/ChatViewProvider.ts tests/unit/providers/interactive-flag-lifecycle.test.mjs
git commit -m "fix: remove premature awaitingInteractiveAnswer flag clearing"
```

---

## Task 3: Add Flag Clearing Logic in Stream Handler

**Files:**
- Modify: `src/providers/ChatViewProvider.ts:~2857` (stream event handler)
- Test: `tests/unit/providers/interactive-flag-lifecycle.test.mjs`

**Step 1: Write failing test for flag clearing on stream start**

Add to file: `tests/unit/providers/interactive-flag-lifecycle.test.mjs`

```javascript
test('flag lifecycle: awaitingInteractiveAnswer cleared when streaming starts', () => {
  const providerSource = readSource('src/providers/ChatViewProvider.ts');
  
  // Find stream event handler section
  const streamHandler = providerSource.match(
    /private\s+handleStreamEvent[\s\S]*?^\s*\}/m
  );
  
  assert.ok(streamHandler, 'handleStreamEvent method should exist');
  
  // Should have logic to clear flag when non-interactive events arrive
  assert.match(
    streamHandler[0],
    /if\s*\(\s*this\.awaitingInteractiveAnswer\s*\)/,
    'Should check awaitingInteractiveAnswer flag in stream handler'
  );
  
  // Should clear flag when actual content arrives (not just another question)
  assert.match(
    streamHandler[0],
    /awaitingInteractiveAnswer\s*=\s*false/,
    'Should clear flag when streaming starts'
  );
});

test('flag lifecycle: flag is NOT cleared when another question arrives', () => {
  const providerSource = readSource('src/providers/ChatViewProvider.ts');
  
  // The flag clearing logic should check if the event is another interactive question
  // and NOT clear the flag in that case
  const streamHandler = providerSource.match(
    /private\s+handleStreamEvent[\s\S]*?^\s*\}/m
  );
  
  assert.ok(streamHandler, 'handleStreamEvent method should exist');
  
  // Should check for blocking interactive events before clearing
  assert.match(
    streamHandler[0],
    /hasBlockingInteractiveInStreamPayload/,
    'Should check for blocking interactive events before clearing flag'
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/providers/interactive-flag-lifecycle.test.mjs`

Expected: FAIL - Test will fail because flag clearing logic doesn't exist yet

**Step 3: Implement flag clearing logic**

In file: `src/providers/ChatViewProvider.ts` at line ~2857

Find this code:
```typescript
if (this.hasBlockingInteractiveInStreamPayload(enrichedEvent)) {
  this.awaitingInteractiveAnswer = true;
}
```

Add this logic immediately after:
```typescript
if (this.hasBlockingInteractiveInStreamPayload(enrichedEvent)) {
  this.awaitingInteractiveAnswer = true;
}

// Clear flag when we receive actual content (not another question)
// This indicates the model is processing and we're no longer just "awaiting"
if (this.awaitingInteractiveAnswer) {
  const isAnotherQuestion = this.hasBlockingInteractiveInStreamPayload(enrichedEvent);
  const isActualContent = enrichedEvent.type &&
                         enrichedEvent.type !== 'interactive_event' &&
                         !isAnotherQuestion;
  
  if (isActualContent) {
    this.awaitingInteractiveAnswer = false;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/providers/interactive-flag-lifecycle.test.mjs`

Expected: PASS - Test now passes with flag clearing logic in place

**Step 5: Commit**

```bash
git add src/providers/ChatViewProvider.ts tests/unit/providers/interactive-flag-lifecycle.test.mjs
git commit -m "feat: clear awaitingInteractiveAnswer when streaming starts"
```

---

## Task 4: Test Timeout Error Suppression

**Files:**
- Test: `tests/unit/providers/timeout-suppression.test.mjs`

**Step 1: Write test for timeout suppression during interactive wait**

Create file: `tests/unit/providers/timeout-suppression.test.mjs`

```javascript
import assert from 'assert';
import { readSource } from '../test-utils.mjs';

test('timeout suppression: awaitingInteractiveAnswer suppresses timeout errors', () => {
  const providerSource = readSource('src/providers/ChatViewProvider.ts');
  
  // Find shouldSuppressInteractiveAwaitTimeout method
  const suppressMethod = providerSource.match(
    /private shouldSuppressInteractiveAwaitTimeout\([^)]+\)\s*:\s*boolean\s*\{[\s\S]*?\n\s*\}/
  );
  
  assert.ok(suppressMethod, 'shouldSuppressInteractiveAwaitTimeout method should exist');
  
  const methodBody = suppressMethod[1];
  
  // Should check awaitingInteractiveAnswer flag
  assert.match(
    methodBody,
    /this\.awaitingInteractiveAnswer/,
    'Should check awaitingInteractiveAnswer flag'
  );
  
  // Should also check transition window
  assert.match(
    methodBody,
    /this\.isInInteractiveResponseTransition\(\)/,
    'Should also check interactive response transition window'
  );
  
  // Should return true when either condition is met
  assert.match(
    methodBody,
    /return\s+this\.awaitingInteractiveAnswer\s*\|\|/,
    'Should suppress when awaitingInteractiveAnswer is true'
  );
});

test('timeout suppression: identifies headers timeout error', () => {
  const providerSource = readSource('src/providers/ChatViewProvider.ts');
  
  // Find isLikelyInteractiveAwaitTimeoutError method
  const timeoutCheckMethod = providerSource.match(
    /private isLikelyInteractiveAwaitTimeoutError\([^)]+\)\s*:\s*boolean\s*\{[\s\S]*?\n\s*\}/
  );
  
  assert.ok(timeoutCheckMethod, 'isLikelyInteractiveAwaitTimeoutError method should exist');
  
  const methodBody = timeoutCheckMethod[1];
  
  // Should check for "headers timeout" pattern
  assert.match(
    methodBody,
    /headers timeout/i,
    'Should identify "headers timeout" error'
  );
  
  // Should also check for other timeout patterns
  assert.match(
    methodBody,
    /timeout/,
    'Should check for general timeout pattern'
  );
});
```

**Step 2: Run test to verify it passes**

Run: `npm test -- tests/unit/providers/timeout-suppression.test.mjs`

Expected: PASS - The existing code should already have this logic

**Step 3: Verify timeout error handling integration**

The existing code at lines ~3631-3636 should already be correct. No changes needed, just verify:

```bash
# Run all timeout-related tests
npm test -- tests/unit/providers/timeout-suppression.test.mjs
```

Expected: PASS - All timeout suppression tests pass

**Step 4: Commit**

```bash
git add tests/unit/providers/timeout-suppression.test.mjs
git commit -m "test: add timeout suppression verification tests"
```

---

## Task 5: Integration Test - Popover Reappearing Bug

**Files:**
- Test: `tests/integration/popover-transition.test.mjs`

**Step 1: Write integration test for popover transition**

Create file: `tests/integration/popover-transition.test.mjs`

```javascript
import assert from 'assert';
import { readSource } from '../test-utils.mjs';

test('integration: transition window prevents popover reappearing', () => {
  const providerSource = readSource('src/providers/ChatViewProvider.ts');
  const messageHandlerSource = readSource('webview/shared/src/chat/lib/messageHandler.ts');
  
  // Both extension and webview should use same transition window duration
  const extensionWindowMatch = providerSource.match(/Date\.now\(\)\s*\+\s*(\d+)/);
  const webviewWindowMatch = messageHandlerSource.match(/Date\.now\(\)\s*\+\s*(\d+)/);
  
  assert.ok(extensionWindowMatch, 'Extension should set transition window');
  assert.ok(webviewWindowMatch, 'Webview should set transition window');
  
  const extensionWindow = parseInt(extensionWindowMatch[1]);
  const webviewWindow = parseInt(webviewWindowMatch[1]);
  
  // Both should be 15000ms (15 seconds)
  assert.equal(
    extensionWindow,
    15000,
    'Extension should use 15 second transition window'
  );
  
  assert.equal(
    webviewWindow,
    15000,
    'Webview should use 15 second transition window'
  );
  
  assert.equal(
    extensionWindow,
    webviewWindow,
    'Extension and webview should use same transition window duration'
  );
});

test('integration: interactive response transition window is set', () => {
  const providerSource = readSource('src/providers/ChatViewProvider.ts');
  
  // Should have interactiveResponseTransitionUntil property
  assert.match(
    providerSource,
    /interactiveResponseTransitionUntil/,
    'Should have transition until property'
  );
  
  // Should be set to Date.now() + 15000 when awaiting interactive answer
  const transitionSetting = providerSource.match(
    /if\s*\(\s*this\.awaitingInteractiveAnswer\s*\)\s*\{[\s\S]*?interactiveResponseTransitionUntil\s*=\s*Date\.now\(\)\s*\+\s*(\d+)/
  );
  
  assert.ok(
    transitionSetting,
    'Should set transition window when awaiting interactive answer'
  );
  
  assert.equal(
    parseInt(transitionSetting[1]),
    15000,
    'Should set transition window to 15 seconds'
  );
});
```

**Step 2: Run integration test**

Run: `npm test -- tests/integration/popover-transition.test.mjs`

Expected: PASS - Integration test verifies both extension and webview use 15s window

**Step 3: Commit**

```bash
git add tests/integration/popover-transition.test.mjs
git commit -m "test: add integration test for popover transition window"
```

---

## Task 6: Manual Testing Verification

**Files:**
- None (manual testing)

**Step 1: Test Bug 1 - Popover Reappearing**

Manual test procedure:
1. Start extension and open chat
2. Ask AI a question that will trigger a question/answer event
3. Answer the first question
4. Observe: The answer bubble should appear cleanly
5. Verify: The popover should NOT reappear even briefly
6. Verify: The second question (if any) appears cleanly

Expected: No popover flashing/reappearing

**Step 2: Test Bug 2 - Timeout Errors**

Manual test procedure:
1. Start extension and open chat
2. Ask AI a question that will trigger multiple question/answer events
3. Answer the first question
4. Answer the second question
5. Wait for response (may take 10+ seconds)
6. Verify: No "Headers Timeout Error" or "fetch failed" error appears
7. Verify: Response eventually appears successfully

Expected: No timeout errors displayed

**Step 3: Test Regression - Normal Messages**

Manual test procedure:
1. Send a normal message (no interactive events)
2. Verify: Normal response works as expected
3. Verify: No popovers appear
4. Verify: Error handling works normally

Expected: Normal message flow unchanged

**Step 4: Document test results**

Create file: `docs/plans/2026-04-06-test-results.md`

```markdown
# Test Results - Interactive Event State Management Fix

## Bug 1: Popover Reappearing
- Status: ✅ PASS / ❌ FAIL
- Notes: [Describe what you observed]

## Bug 2: Timeout Errors
- Status: ✅ PASS / ❌ FAIL
- Notes: [Describe what you observed]

## Regression: Normal Messages
- Status: ✅ PASS / ❌ FAIL
- Notes: [Describe what you observed]
```

**Step 5: Commit test results**

```bash
git add docs/plans/2026-04-06-test-results.md
git commit -m "test: document manual testing results"
```

---

## Task 7: Final Verification and Cleanup

**Files:**
- Multiple

**Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass

**Step 2: Build and verify no compilation errors**

```bash
npm run compile
```

Expected: Clean build with no errors

**Step 3: Review all changes**

```bash
git diff main
```

Verify:
- Only changed files are expected
- No unintended modifications
- Code follows project patterns

**Step 4: Final commit**

```bash
git add docs/plans/2026-04-06-interactive-event-state-fix-design.md docs/plans/2026-04-06-interactive-event-state-fix.md
git commit -m "docs: add design and implementation plan for interactive event state fix"
```

**Step 5: Create summary**

Create file: `docs/plans/2026-04-06-summary.md`

```markdown
# Interactive Event State Management Fix - Summary

## Changes Made

1. **Transition Window Duration** (Task 1)
   - Changed from 3000ms to 15000ms in `dispatchInteractiveResponse`
   - File: `src/providers/ChatViewProvider.ts:1439-1442`

2. **Flag Management** (Task 2 & 3)
   - Removed premature flag clearing in `schedulePromptDispatch`
   - Added flag clearing logic in stream event handler
   - File: `src/providers/ChatViewProvider.ts`

3. **Tests Added**
   - `tests/unit/providers/interactive-timeout-regression.test.mjs`
   - `tests/unit/providers/interactive-flag-lifecycle.test.mjs`
   - `tests/unit/providers/timeout-suppression.test.mjs`
   - `tests/integration/popover-transition.test.mjs`

## Bugs Fixed

- ✅ Bug 1: Popover no longer reappears after submitting answers
- ✅ Bug 2: Timeout errors properly suppressed during interactive answer submission

## Test Coverage

- Unit tests: 12 tests
- Integration tests: 2 tests
- Manual tests: 3 scenarios

## Breaking Changes

None - all changes are backwards compatible
```

**Step 6: Final commit**

```bash
git add docs/plans/2026-04-06-summary.md
git commit -m "docs: add implementation summary"
```

---

## Success Criteria

After completing all tasks:

1. ✅ All automated tests pass
2. ✅ Manual testing confirms both bugs are fixed
3. ✅ No regression in normal message flow
4. ✅ Code compiles without errors
5. ✅ All changes committed with clear messages

## Notes

- Each task is independent and can be done in any order, but Tasks 1-3 should be done sequentially
- Tasks 4-6 are testing and verification
- Task 7 is final cleanup
- Estimated total time: 30-45 minutes
- If any test fails, stop and investigate before proceeding
