# Implementation Plan: Auto-Compaction on Context Limit

## Overview

This plan adds **reliable, persisted auto-compaction** that fires whenever a session's
context window usage approaches or exceeds the configured threshold. The goal is to prevent
request failures caused by hitting the model context limit and to ensure the intent to
compact survives VS Code restarts.

---

## Problem Analysis

### Current State (`maybeAutoCompact` — `ChatViewProvider.ts:4904`)

```typescript
// Fires only after a COMPLETED handleSendMessage → response.data.info.tokens.input
const pct = inputTokens / contextLimit;
const AUTO_COMPACT_THRESHOLD = 0.9; // hardcoded
if (pct >= AUTO_COMPACT_THRESHOLD) → handleCompactSession()
```

### Identified Gaps

| #   | Gap                                                                                                                              | Impact                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | Only fires **after** a successful turn completes. If context is already full, the turn fails before `maybeAutoCompact` can help. | Auto-compact too late — request errors before cleanup. |
| 2   | No persistence of **pending auto-compact intent**. If VS Code restarts mid-session, the flag is lost.                            | Session reloads full without triggering compaction.    |
| 3   | `response.data.info.tokens.input` is absent when the request errors out (network, timeout, model limit exceeded).                | Threshold check never runs on failure path.            |
| 4   | Threshold is hardcoded at `0.9` with no user control or disable path.                                                            | Power users can't tune aggressiveness.                 |
| 5   | No real-time streaming check. Context usage is only evaluated post-turn.                                                         | Proactive compaction impossible during streaming.      |
| 6   | No UI visual cue that approaching threshold. User has no warning before it fires.                                                | Jarring silent mid-session compaction.                 |

---

## Proposed Approach

### Core Principle

- **Write intent first, execute second.** Before calling `handleCompactSession`, persist
  a `pendingAutoCompact: true` flag. Clear it only after the compaction API call succeeds.
- **Check on multiple paths.** Evaluate the threshold after each completed turn AND from
  `message.updated` SSE events (streaming, real-time).
- **Check on session load.** If `pendingAutoCompact` is still set when a session is
  loaded, re-trigger compaction immediately.

---

## Implementation Steps

### Step 1 — Add VS Code Settings for Auto-Compact

**File:** `package.json` (contributes.configuration)

Add two new settings:

```jsonc
"opencode.autoCompact": {
  "type": "boolean",
  "default": true,
  "description": "Automatically compact a session when context usage reaches the threshold."
},
"opencode.autoCompactThreshold": {
  "type": "number",
  "default": 0.9,
  "minimum": 0.5,
  "maximum": 0.99,
  "description": "Fraction of the model context limit at which auto-compaction fires (0.9 = 90%)."
}
```

---

### Step 2 — Extend `PersistedCompactionViewState` Type

**File:** `src/providers/ChatViewProvider.ts`

Add `pendingAutoCompact` and `pendingAutoCompactAt` to the existing persisted state type so
the intent survives restarts.

```typescript
type PersistedCompactionViewState = {
  lastCompactedAt?: number;
  baselineStats?: CompactionBaselineStats;
  compactionDividerIndex?: number;
  compactionDividerBeforeMessageId?: string;
  compactionDividerAfterMessageId?: string;
  collapsed?: boolean;
  // NEW: persisted auto-compact intent
  pendingAutoCompact?: boolean;
  pendingAutoCompactAt?: number; // unix ms when intent was written
};
```

The `normalizeCompactionViewState` helper must be updated to pass these new fields through
without stripping them.

---

### Step 3 — Refactor `maybeAutoCompact` to Read Config + Write Intent

**File:** `src/providers/ChatViewProvider.ts`

Replace the current `maybeAutoCompact` body with the following logic:

```
1. Check opencode.autoCompact setting — return early if disabled.
2. Resolve contextLimit via getSelectedModelContextLimit().
3. Resolve inputTokens from responseData.info.tokens.input (same as today).
4. Read threshold from opencode.autoCompactThreshold config (default 0.9).
5. Compute pct = inputTokens / contextLimit.
6. If pct < threshold → return.
7. PERSIST INTENT:
   await persistAndPublishCompactionViewState(sessionId, {
     pendingAutoCompact: true,
     pendingAutoCompactAt: Date.now(),
   });
8. Fire handleCompactSession(sessionId).
9. On SUCCESS: clear the intent flag:
   await persistAndPublishCompactionViewState(sessionId, {
     pendingAutoCompact: false,
     pendingAutoCompactAt: undefined,
   });
```

Wrap step 8–9 in try/catch so a failed compaction leaves the intent flag set.

---

### Step 4 — Also Check During Streaming (SSE `message.updated` events)

**File:** `src/providers/ChatViewProvider.ts` — stream subscription (around line 1063)

Inside the existing stream callback, after the token tracker block, add:

```typescript
if (
  event.type === "message.updated" &&
  (event.properties as any)?.info?.tokens?.input > 0
) {
  const activeId = this.currentSessionId;
  if (activeId) {
    void this.maybeAutoCompact(activeId, event.properties);
  }
}
```

The `compactingSessions` guard in `maybeAutoCompact` makes this idempotent — successive
events won't stack compactions.

---

### Step 5 — Resume Pending Auto-Compact on Session Load

**File:** `src/providers/ChatViewProvider.ts` — `handleLoadSession` and `sendPersistedCompactionViewState`

After sending the persisted compaction view state to the webview, check the flag:

```typescript
const persisted =
  this.context.workspaceState.get<PersistedCompactionViewState>(
    ChatViewProvider.COMPACTION_VIEW_STATE_PREFIX + sessionId,
  ) ?? {};

if (persisted.pendingAutoCompact && !this.compactingSessions.has(sessionId)) {
  console.log(
    `[ChatViewProvider] Resuming pending auto-compact for session ${sessionId}`,
  );
  vscode.window.showInformationMessage(
    "Resuming auto-compaction for this session — context was full on last use.",
  );
  this.handleCompactSession(sessionId).catch((err) => {
    console.error("[ChatViewProvider] Resumed auto-compact failed:", err);
  });
}
```

Call location: end of `sendPersistedCompactionViewState()`, after the `postMessage` call.

---

### Step 6 — Clear Intent Flag After Successful Compaction

**File:** `src/providers/ChatViewProvider.ts` — `handleCompactSession` (line ~4943)

After the existing call to `postCompactionStatus({ status: "done", ... })` succeeds, add:

```typescript
await this.persistAndPublishCompactionViewState(sessionId, {
  pendingAutoCompact: false,
  pendingAutoCompactAt: undefined,
});
```

This ensures the flag is only cleared after the server call _and_ the view state have both
been committed.

---

### Step 7 — Add UI Visual Warning When Approaching Threshold

**File:** `webview/shared/src/chat/Shell.tsx` (sticky header)
**File:** `webview/shared/src/chat/lib/store.ts`

#### 7a — Add `contextUsagePct` to `AppState`

```typescript
contextUsagePct?: number;   // 0–1, latest per-turn input / contextLimit
```

#### 7b — Dispatch from `messageHandler.ts`

When a `streamEvent` of type `message.updated` arrives with `info.tokens.input`, compute
`pct = input / contextLimit` and dispatch:

```typescript
dispatch({ type: "SET_CONTEXT_USAGE_PCT", pct });
```

#### 7c — Render in sticky header

In the token usage row in `Shell.tsx`, color the progress bar red when
`contextUsagePct >= threshold`, yellow between `threshold * 0.75` and `threshold`, and
green otherwise. Also show a small tooltip:

```
Context window: 91% full — auto-compaction will run after this turn
```

The compaction threshold for the UI can be read from the VS Code extension via the `initState`
message, forwarding the `opencode.autoCompactThreshold` config value.

---

### Step 8 — Pass `triggeredBy` to `postCompactionStatus`

**File:** `src/providers/ChatViewProvider.ts`

Extend the compaction status messages to include a `triggeredBy: "manual" | "auto"` field.
`handleCompactSession` should accept an `options?: { triggeredBy: "manual" | "auto" }` param
and forward it through `postCompactionStatus`. The webview can then display "Auto-compacted"
vs "Compacted" in the divider label.

---

### Step 9 — Add Regression Tests

**File:** `tests/compaction-persistence-regression.test.mjs`

Add assertions that verify:

1. `PersistedCompactionViewState` type has `pendingAutoCompact` and `pendingAutoCompactAt` fields.
2. `normalizeCompactionViewState` retains both new fields on pass-through.
3. `maybeAutoCompact` reads `opencode.autoCompact` config before firing.
4. `maybeAutoCompact` reads `opencode.autoCompactThreshold` config for the threshold value.
5. `sendPersistedCompactionViewState` (or `handleLoadSession`) checks `pendingAutoCompact`
   and calls `handleCompactSession` when set.
6. `handleCompactSession` calls `persistAndPublishCompactionViewState` with
   `{ pendingAutoCompact: false }` on the success path.

---

## File Change Map

| File                                               | Changes                                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                     | Add `opencode.autoCompact` and `opencode.autoCompactThreshold` settings                                                                                                                                                                                                 |
| `src/providers/ChatViewProvider.ts`                | Extend `PersistedCompactionViewState`; refactor `maybeAutoCompact` (config + intent write); add streaming check in subscription; add resume check in `sendPersistedCompactionViewState`; clear flag in `handleCompactSession` success path; add `triggeredBy` to status |
| `webview/shared/src/chat/lib/store.ts`             | Add `contextUsagePct` to `AppState`; add `SET_CONTEXT_USAGE_PCT` reducer                                                                                                                                                                                                |
| `webview/shared/src/chat/lib/messageHandler.ts`    | Dispatch `SET_CONTEXT_USAGE_PCT` from `streamEvent` `message.updated`                                                                                                                                                                                                   |
| `webview/shared/src/chat/Shell.tsx`                | Use `contextUsagePct` for header coloring and threshold tooltip                                                                                                                                                                                                         |
| `tests/compaction-persistence-regression.test.mjs` | Add 6 new structural assertions                                                                                                                                                                                                                                         |

---

## Non-Goals

- Changing the compaction algorithm itself (that is server-side).
- Modifying `SessionService` storage backend.
- Supporting per-model threshold overrides (can be added later).
- Changing the `GeminiTokenUsageTracker` daily quota logic (unrelated).

---

## Risk Notes

- The streaming path (Step 4) will call `maybeAutoCompact` many times per turn.
  The `compactingSessions` guard makes this safe; the only overhead is a few comparisons
  per SSE event — negligible.
- The session-load resume (Step 5) must check `this.compactingSessions` to avoid double-fire
  if auto-compact was triggered via the stream AND a reload happens simultaneously.
- Clearing the intent flag must happen **after** `postCompactionStatus` succeeds to avoid
  losing the flag on a crash between the API call and the flag clear.
