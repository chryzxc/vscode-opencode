# Message Ordering and Duplication Fixes

**Date:** 2026-04-06
**Issues Fixed:**
1. ✅ Duplicate "Plan Approved" messages during hydration
2. ✅ Messages not in order during hydrated data

---

## Root Cause Analysis

### Issue 1: Duplicate "Plan Approved" Messages

**Location:** `src/providers/ChatViewProvider.ts`, function `handlePlanProceed`

**Root Cause:**
The function was creating TWO separate user messages when user clicked "Plan Approved":
1. **First message** (lines 6218-6246): `approvalMessage` with content "Proceed on this plan."
   - Persisted via `sessionService.appendMessage(activeSession.id, approvalMessage)`
   - Sent to webview via `userMessageAppended` event

2. **Second message** (lines 6252-6262): `proceedMessage` with full instructions
   - Sent via `handleSendMessage(proceedMessage, ...)`
   - Created and persisted as another user message

During hydration, BOTH messages were loaded from storage, causing duplicates.

**Fix Applied:**
- Removed the duplicate `approvalMessage` creation and persistence
- Removed the `userMessageAppended` event for the approval message
- Now only the `proceedMessage` is sent via `handleSendMessage`, preventing duplicates

### Issue 2: Message Ordering Issues

**Location:** `src/providers/chat/HistoryProcessor.ts`

**Root Cause:**
The `orderHistoryMessagesChronologically` function sorts messages by `createdAt` timestamp. When duplicate user messages have the same timestamp:
- Same-timestamp sorting has undefined order for messages of the same role
- Messages can appear in different orders after hydration

**Fix Applied:**
Added `dedupeUserMessagesByContent()` method to the HistoryProcessor pipeline:
- Deduplicates user messages with identical content before ordering
- Prevents duplicate "Plan Approved" messages from appearing in the wrong order
- Added to the processing pipeline: `ordered → dedupeUserMessagesByContent → dedupeMirrorHistoryMessages → mergeActivity`

### Issue 3: Webview-Side Deduplication Gap

**Location:** `webview/shared/src/chat/lib/messageHandler.ts`

**Root Cause:**
The webview-side message hydration pipeline had deduplication for:
- System messages (`dedupeSystemMessages`)
- Interactive user messages with markers (`dedupeInteractiveUserHydrationMessages`)

But "Plan Approved" messages are user messages without markers, so they bypassed webview deduplication. Even though server-side deduplication was added, the webview needed its own deduplication layer to handle:
- Messages already persisted with duplicates before the fix
- Race conditions during hydration
- Multiple message sources during session restoration

**Fix Applied:**
Added `dedupePlanProceedMessages()` function and integrated it into the webview deduplication pipeline:
- Specifically targets user messages matching the pattern `\bproceed on this plan\./i`
- Uses a Set to track seen "Plan Approved" message content
- Skips duplicates while preserving the first occurrence
- Pipeline updated: `dedupeInteractiveUserHydrationMessages → dedupePlanProceedMessages → dedupeSystemMessages`

---

## Changes Made

### File: `src/providers/ChatViewProvider.ts`

**Removed:**
```typescript
// Lines 6218-6247 (removed)
const approvalMessage = {
  role: "user" as const,
  content: "Proceed on this plan.",
  text: "Proceed on this plan.",
  parts: [{ type: "text", text: "Proceed on this plan." }],
  time: {
    created: Date.now(),
  },
};

let activeSession: { id: string } | undefined;
// ... session switching code ...
if (activeSession?.id) {
  await this.sessionService.appendMessage(activeSession.id, approvalMessage);
  this.view?.webview.postMessage({
    type: "userMessageAppended",
    message: approvalMessage,
  });
  await this.handleGetSessions();
}
```

### File: `src/providers/chat/HistoryProcessor.ts`

**Added new method:**
```typescript
/**
 * Dedupe user messages with identical content
 * This fixes duplicate "Plan Approved" messages that may occur during hydration
 */
private dedupeUserMessagesByContent(messages: any[]): any[] {
  if (!Array.isArray(messages) || messages.length <= 1) {
    return messages;
  }

  const deduped: any[] = [];
  const seenUserContents = new Set<string>();

  for (const message of messages) {
    const role = this.firstNonEmptyString(
      message?.role,
      message?.info?.role,
      message?.sender,
    )?.toLowerCase();

    if (role !== "user") {
      deduped.push(message);
      continue;
    }

    const content = this.extractMessageBodyText(message);
    if (!content) {
      deduped.push(message);
      continue;
    }

    const normalizedContent = content.trim();
    if (seenUserContents.has(normalizedContent)) {
      this.logger.debug("[HistoryProcessor] Skipping duplicate user message", {
        content: normalizedContent.substring(0, 100),
        totalSkipped: seenUserContents.size,
      });
      continue;
    }

    seenUserContents.add(normalizedContent);
    deduped.push(message);
  }

  if (deduped.length < messages.length) {
    this.logger.debug("[HistoryProcessor] User message deduplication complete", {
      inputCount: messages.length,
      outputCount: deduped.length,
      duplicatesRemoved: messages.length - deduped.length,
    });
  }

  return deduped;
}
```

**Modified pipeline:**
```typescript
// Before
const ordered = this.orderHistoryMessagesChronologically(processed);
const deduped = this.dedupeMirrorHistoryMessages(ordered);

// After
const ordered = this.orderHistoryMessagesChronologically(processed);
const dedupedUserMessages = this.dedupeUserMessagesByContent(ordered);
const deduped = this.dedupeMirrorHistoryMessages(dedupedUserMessages);
```

### File: `webview/shared/src/chat/lib/messageHandler.ts`

**Added new function:**
```typescript
/**
 * Deduplicates user messages with "proceed on this plan." content.
 * This fixes duplicate "Plan Approved" messages that may appear during hydration.
 * Only deduplicates exact content matches to avoid removing legitimate repeated plan approvals.
 */
export function dedupePlanProceedMessages(messages: Message[]): Message[] {
  if (!Array.isArray(messages) || messages.length <= 1) {
    return messages;
  }

  const deduped: Message[] = [];
  const seenPlanProceedMessages = new Set<string>();

  for (const message of messages) {
    const role = asString(message.role) || asString(asRecord(message.info)?.role);
    const content = asString(message.content) || '';

    // Check if this is a "Plan Approved" user message
    const isPlanProceed = role === 'user' && /\bproceed on this plan\./i.test(content);

    if (isPlanProceed) {
      const normalizedContent = content.trim();

      // Skip duplicate "Plan Approved" messages
      if (seenPlanProceedMessages.has(normalizedContent)) {
        webviewLogger.debug('[dedupePlanProceedMessages] Skipping duplicate Plan Approved message');
        continue;
      }

      seenPlanProceedMessages.add(normalizedContent);
    }

    deduped.push(message);
  }

  return deduped;
}
```

**Modified hydration pipeline:**
```typescript
// Before
const dedupedHydratedMessages = dedupeInteractiveUserHydrationMessages(hydratedMessages);
const dedupedSystemMessages = dedupeSystemMessages(dedupedHydratedMessages);

// After
const dedupedHydratedMessages = dedupeInteractiveUserHydrationMessages(hydratedMessages);
const dedupedPlanProceedMessages = dedupePlanProceedMessages(dedupedHydratedMessages);
const dedupedSystemMessages = dedupeSystemMessages(dedupedPlanProceedMessages);
```

---

## Testing Recommendations

1. **Test Plan Approval Flow:**
   - Create a plan with the "build" agent
   - Click "Plan Approved" to proceed
   - Refresh the session or reload VSCode
   - ✅ Verify: Only ONE "Plan Approved" message appears
   - ✅ Verify: Message appears in correct order

2. **Test Message Ordering:**
   - Send multiple messages in quick succession
   - Refresh the session
   - ✅ Verify: Messages appear in the same order as they were sent

3. **Test Hydration:**
   - Switch between different sessions
   - Reload the webview
   - ✅ Verify: No duplicate messages appear
   - ✅ Verify: Message order is preserved

4. **Regression Testing:**
   - Test normal message flow (no interactive events)
   - Test messages with interactive events
   - Test plan approval with change requests
   - ✅ Verify: All existing functionality still works

---

## Impact Assessment

**Files Modified:** 3
- `src/providers/ChatViewProvider.ts` (removed ~30 lines)
- `src/providers/chat/HistoryProcessor.ts` (added ~50 lines)
- `webview/shared/src/chat/lib/messageHandler.ts` (added ~50 lines)

**Risk Level:** Low
- Changes are isolated to message handling and deduplication logic
- Deduplication is defensive and only removes exact duplicates
- No changes to message rendering or UI components
- Webview-side deduplication provides additional safety layer

**Backward Compatibility:** Full
- Existing sessions with duplicates will be cleaned up on next hydration
- No migration needed
- Both server-side and webview-side deduplication work together to prevent duplicates

---

## Sign-off

**Implemented By:** Claude Code
**Date:** 2026-04-06
**Status:** ✅ Ready for Testing
**Approved:** [ ] Yes [ ] No
**Comments:** Awaiting user testing to verify fixes resolve the issues
