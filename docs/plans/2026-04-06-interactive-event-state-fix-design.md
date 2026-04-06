# Design: Fix Interactive Event State Management

**Date**: 2026-04-06
**Status**: Approved
**Author**: Claude Sonnet 4.6

## Overview

This design fixes two related bugs in the question/answer popover system:

1. **Bug 1**: Popover briefly reappears (1-3 seconds) after submitting answers
2. **Bug 2**: "Headers Timeout Error" appears after submitting answers from subsequent popovers

Both bugs stem from inconsistent state management between the extension and webview during interactive event transitions.

## Root Cause Analysis

### Bug 1: Popover Reappearing

**Symptom**: After answering the first question, the popover reappears for 1-3 seconds when the answer bubble is shown.

**Cause**:
- Extension sets transition window to 3000ms (3 seconds)
- Webview expects 15000ms (15 seconds)
- Timing mismatch causes popover to re-render during transition

### Bug 2: Timeout Errors

**Symptom**: "Headers Timeout Error" / "fetch failed" appears 10+ seconds after submitting answers from the second popover.

**Cause**:
- `awaitingInteractiveAnswer` flag is cleared in `schedulePromptDispatch` BEFORE message is sent
- Timeout occurs during the 10+ second API wait
- Error suppression check fails because flag is already false
- Error is displayed to user

## Architecture Changes

### Current State Flow

```
1. Question streams in → awaitingInteractiveAnswer = true
2. User answers → batchInteractiveResponse sent
3. dispatchInteractiveResponse() → sets 3s transition window
4. schedulePromptDispatch() → awaitingInteractiveAnswer = false ❌
5. Message sent → timeout occurs (10+ seconds)
6. Error check → awaitingInteractiveAnswer is false ❌
7. Error displayed to user ❌
```

### Proposed State Flow

```
1. Question streams in → awaitingInteractiveAnswer = true
2. User answers → batchInteractiveResponse sent
3. dispatchInteractiveResponse() → sets 15s transition window ✅
4. schedulePromptDispatch() → awaitingInteractiveAnswer stays true ✅
5. Message sent → streaming starts
6. First stream event arrives → awaitingInteractiveAnswer = false ✅
7. Transition window expires → popover cleanup ✅
```

## Component Changes

### 1. ChatViewProvider.ts (Extension Side)

**File**: `src/providers/ChatViewProvider.ts`

**Change 1**: Fix transition window duration (Line ~1439-1442)

```typescript
// BEFORE:
if (this.awaitingInteractiveAnswer) {
  // Reduce error suppression window from 15s to 3s for better responsiveness
  this.interactiveResponseTransitionUntil = Date.now() + 3000;
}

// AFTER:
if (this.awaitingInteractiveAnswer) {
  // Match webview's 15s window to prevent popover reappearing
  this.interactiveResponseTransitionUntil = Date.now() + 15000;
}
```

**Change 2**: Don't clear flag too early (Line ~5076)

```typescript
// BEFORE: (in schedulePromptDispatch, before sending)
this.awaitingInteractiveAnswer = false;

// AFTER: Remove this line - flag will be cleared when streaming starts
```

**Change 3**: Clear flag when streaming actually starts (New logic in stream event handler around Line ~2857)

```typescript
// Add after line 2857 where we check for blocking interactive events
if (this.hasBlockingInteractiveInStreamPayload(enrichedEvent)) {
  this.awaitingInteractiveAnswer = true;
}

// NEW: Clear flag when we receive any stream event after sending interactive answer
// This indicates the model is processing and we're no longer just "awaiting"
if (this.awaitingInteractiveAnswer && enrichedEvent.type !== 'interactive_event') {
  // We're getting real content, not just another question
  this.awaitingInteractiveAnswer = false;
}
```

### 2. messageHandler.ts (Webview Side)

**File**: `webview/shared/src/chat/lib/messageHandler.ts`

**No changes needed** - The webview already has the correct 15-second window logic at line 7883. The extension just needs to match it.

## Data Flow

### Interactive Answer Submission Flow

```
User clicks submit
    ↓
PanelComponents.tsx: submitBatchResponses()
    ↓
PostMessage: batchInteractiveResponse
    ↓
ChatViewProvider: dispatchInteractiveResponse()
    ↓
Set interactiveResponseTransitionUntil = now + 15000ms ✅
    ↓
Call schedulePromptDispatch() with answers
    ↓
[awaitingInteractiveAnswer stays TRUE throughout] ✅
    ↓
Send request to API
    ↓
API responds (may take 10+ seconds)
    ↓
Stream events start arriving
    ↓
First non-interactive event → awaitingInteractiveAnswer = false ✅
    ↓
UserMessageAppended → webview clears popover ✅
    ↓
15s window expires → cleanup complete ✅
```

## Error Handling

### Timeout Error Suppression Logic

**Current Problem**: Timeout errors occur 10+ seconds after sending, but `awaitingInteractiveAnswer` is already `false`, so errors aren't suppressed.

**Solution**: Keep flag true until streaming starts

```typescript
// In stream event handler (ChatViewProvider.ts ~2857)
private handleStreamEvent(event: any) {
  const enrichedEvent = this.enrichStreamEvent(event);

  // Set flag when blocking interactive event arrives
  if (this.hasBlockingInteractiveInStreamPayload(enrichedEvent)) {
    this.awaitingInteractiveAnswer = true;
  }

  // NEW: Clear flag when we get actual content (not another question)
  if (this.awaitingInteractiveAnswer) {
    const isAnotherQuestion = this.hasBlockingInteractiveInStreamPayload(enrichedEvent);
    const isActualContent = enrichedEvent.type &&
                           enrichedEvent.type !== 'interactive_event' &&
                           !isAnotherQuestion;

    if (isActualContent) {
      this.awaitingInteractiveAnswer = false;
    }
  }

  // ... rest of handler
}
```

**Error Suppression Check** (existing code around Line ~3631-3636):
```typescript
// This now works correctly because flag stays true longer
private shouldSuppressInteractiveAwaitTimeout(message: string): boolean {
  if (!this.isLikelyInteractiveAwaitTimeoutError(message)) {
    return false;
  }
  // This now returns true during the 10+ second wait
  return this.awaitingInteractiveAnswer || this.isInInteractiveResponseTransition();
}
```

## Testing Strategy

### Unit Tests

1. **Test `awaitingInteractiveAnswer` lifecycle**
   - Verify flag is set when question arrives
   - Verify flag stays true during message dispatch
   - Verify flag is cleared when streaming starts

2. **Test transition window duration**
   - Verify extension uses 15000ms (not 3000ms)
   - Verify window matches webview's timing

3. **Test timeout suppression**
   - Mock timeout error during interactive answer submission
   - Verify error is suppressed when flag is true
   - Verify error is shown when flag is false

### Integration Tests

1. **Test popover doesn't reappear**
   - Submit answer to first question
   - Verify bubble appears
   - Verify popover doesn't flash/reappear
   - Verify second question appears cleanly

2. **Test timeout doesn't show errors**
   - Mock slow API response (10+ seconds)
   - Submit interactive answer
   - Verify no timeout error is displayed
   - Verify response eventually appears

### Regression Tests

1. **Test normal messages still work**
   - Send regular message (no interactive events)
   - Verify `awaitingInteractiveAnswer` stays false
   - Verify normal error handling works

2. **Test multiple questions in sequence**
   - Answer Q1 → Q2 arrives
   - Answer Q2 → Q3 arrives
   - Verify no popovers reappear
   - Verify no timeout errors

## Implementation Plan

### Phase 1: Fix Transition Window (5 minutes)
- Change 3000ms to 15000ms in `dispatchInteractiveResponse`
- Test that popovers don't reappear

### Phase 2: Fix Flag Management (15 minutes)
- Remove `awaitingInteractiveAnswer = false` from `schedulePromptDispatch`
- Add flag clearing logic in stream event handler
- Test that timeout errors are suppressed

### Phase 3: Testing & Validation (10 minutes)
- Run existing test suite
- Add new unit tests for flag lifecycle
- Manual testing with actual question/answer flows

**Total estimated time: 30 minutes**

## Success Criteria

1. ✅ Popover no longer reappears after submitting answers
2. ✅ No "Headers Timeout Error" displayed after submitting answers
3. ✅ All existing tests pass
4. ✅ New tests cover the flag lifecycle
5. ✅ Normal message flow is not affected

## Risks & Mitigations

### Risk: Flag never gets cleared
**Mitigation**: Add timeout fallback - clear flag after 30 seconds regardless

### Risk: Breaking normal message flow
**Mitigation**: Extensive regression testing of non-interactive messages

### Risk: Transition window too long
**Mitigation**: Monitor user feedback, adjust if needed

## Alternatives Considered

1. **Immediate UI State Clear**: Would fix Bug 1 quickly but not address root cause of Bug 2
2. **Redesign Event Flow**: More robust but requires significant refactoring
3. **Selected Approach (State Management Fix)**: Addresses root causes with minimal changes

## Related Issues

- Bug 1: Popover reappearing after answer submission
- Bug 2: Timeout errors during interactive answer submission
- Related: Interactive event transition window management
