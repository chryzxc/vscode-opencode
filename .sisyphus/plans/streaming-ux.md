# Streaming UX Improvements — Claude-Like Response Experience

## TL;DR

> **Quick Summary**: Improve the chat streaming UX to feel like Claude's response experience — instant loading feedback, progressive text display, smooth streaming-to-final transition, and provider name visibility alongside model names.
> 
> **Deliverables**:
> - Smooth streaming-to-final message transition (no flash/jump)
> - Provider name displayed alongside model name in assistant responses
> - Improved loading state with immediate visual feedback
> - Double token accumulation fix
> - Legacy StreamingComponents.tsx cleanup
> - Extension-side provider name propagation to streaming events
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 (provider storage) → Task 3 (provider in streaming) → Task 5 (provider in UI) → Task 8 (final QA)

---

## Context

### Original Request
User wants the chat to stream AI responses like Claude — show a loading animation immediately on send, display text incrementally as tokens arrive (not waiting for complete response), stack text progressively, show provider name alongside model name, and fix any incorrect approaches in the existing conversation handling.

### Interview Summary
**Key Discussions**:
- Streaming infrastructure already exists (SSE → React useReducer → StreamingCard)
- Several UX issues identified through code analysis:
  - Visual flash when streaming card transitions to final message
  - Provider name not shown in assistant responses
  - Potential double token counting
  - Legacy unused StreamingCard component
  - Auto-scroll may be janky during rapid streaming updates

**Research Findings**:
- `selectedModel` only stores `{ providerID, modelID }` — missing `providerName`. Provider name IS available from `handleGetModels()` model list but not persisted in selection.
- Streaming card is rendered as a synthetic `AssistantMessage` with `info.model = state.selectedModel`, so it also lacks provider name.
- `CLEAR_STREAMING` + `ADD_MESSAGE` dispatch causes DOM removal then re-render — the visual flash.
- Token stats are accumulated in both `handleStreamEvent` (on `message.updated` with `finish: true`) AND `messageResponse` handler — potential double-counting.

### Gap Analysis
**Identified Gaps (addressed in plan)**:
- Provider name not propagated through `selectedModel` — resolved by extending model storage
- Streaming-to-final transition flash — resolved by introducing `TRANSITION_STREAMING` action
- Token double-counting — resolved by removing duplicate accumulation point
- Unused legacy component — resolved by deletion task
- Error state during streaming — addressed via error scenario in QA

---

## Work Objectives

### Core Objective
Transform the streaming chat UX from functional-but-rough to polished Claude-like experience, with smooth transitions, provider visibility, and correct token accounting.

### Concrete Deliverables
- Modified `store.ts` — New `TRANSITION_STREAMING` reducer action for smooth handoff
- Modified `messageHandler.ts` — Fix double token accumulation, use transition action
- Modified `ChatShell.tsx` — Provider name display in streaming message, improved scroll
- Modified `MessageComponents.tsx` — Provider name label in `AssistantMessage`
- Modified `ChatViewProvider.ts` — Persist `providerName` in `selectedModel`
- Modified `types.ts` — Extended `SelectedModel` type with `providerName`
- Deleted `StreamingComponents.tsx` — Remove unused legacy component

### Definition of Done
- [ ] Provider name visible next to model name in ALL assistant messages (streaming AND final)
- [ ] No visible flash/jump when streaming transitions to final message
- [ ] Token counts are accurate (no double-counting)
- [ ] Loading animation appears within 100ms of pressing send
- [ ] Text streams progressively during response generation
- [ ] Legacy StreamingComponents.tsx deleted with zero regressions
- [ ] `npm run build` succeeds with zero errors

### Must Have
- Provider name displayed in assistant response headers
- Smooth streaming-to-final transition (no DOM removal flash)
- Correct token accumulation (single source of truth)
- Progressive text display during streaming (already works, preserve)

### Must NOT Have (Guardrails)
- **No typing/typewriter animation** — text should appear as chunks arrive, not character-by-character
- **No changes to SSE infrastructure** — `MessageStreamService.ts` streaming protocol stays as-is
- **No changes to message persistence** — `SessionService.ts` save logic untouched
- **No new npm dependencies** — all changes use existing React/CSS capabilities
- **No removal of FORBIDDEN TO REMOVE sections** — all protected markers preserved
- **No changes to token stats display** — stats UI stays, only fix double-counting source
- **No changes to plan/artifact detection workflow** — `enrichMessageWithArtifacts` core logic preserved
- **No redesign of MessageList or InputArea** — additive changes only

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (build system with `npm run build`)
- **Automated tests**: None (no existing test framework configured for webview)
- **Framework**: N/A
- **Agent QA**: Playwright for UI verification, build commands for compilation

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **Build**: Use Bash — `npm run build`, verify zero errors
- **Type safety**: Use Bash — `npx tsc --noEmit`, verify zero type errors

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation changes):
├── Task 1: Extend selectedModel type to include providerName [quick]
├── Task 2: Add TRANSITION_STREAMING reducer action [quick]
├── Task 3: Delete legacy StreamingComponents.tsx [quick]

Wave 2 (After Wave 1 — core UX improvements):
├── Task 4: Propagate providerName in extension-side model selection [quick]
├── Task 5: Display provider name in AssistantMessage component [quick]
├── Task 6: Implement smooth streaming-to-final transition [deep]
├── Task 7: Fix double token accumulation [quick]

Wave 3 (After Wave 2 — integration verification):
├── Task 8: Build verification + comprehensive UI QA [unspecified-high]

Wave FINAL (After ALL tasks — independent review):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: Real manual QA [unspecified-high]
├── Task F4: Scope fidelity check [deep]

Critical Path: Task 1 → Task 4 → Task 5 → Task 8 → F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 4 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | — | 2, 4, 5, 6 |
| 2 | — | 6 |
| 3 | — | 8 |
| 4 | 1 | 5, 6, 8 |
| 5 | 1, 4 | 8 |
| 6 | 1, 2, 4 | 8 |
| 7 | — | 8 |
| 8 | 3, 5, 6, 7 | F1-F4 |
| F1-F4 | 8 | — |

### Agent Dispatch Summary

- **Wave 1**: **3 tasks** — T1 → `quick`, T2 → `quick`, T3 → `quick`
- **Wave 2**: **4 tasks** — T4 → `quick`, T5 → `quick`, T6 → `deep`, T7 → `quick`
- **Wave 3**: **1 task** — T8 → `unspecified-high`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high` + `playwright`, F4 → `deep`

---

## TODOs


- [ ] 1. Extend `selectedModel` Type to Include `providerName`

  **What to do**:
  - In `webview/chat/lib/types.ts`, find the `selectedModel` field type (currently just uses inline `{ providerID, modelID }` shape). Add `providerName?: string` to it.
  - In `src/providers/ChatViewProvider.ts`, update the `selectedModel` property type (line 186) from `{ providerID: string; modelID: string }` to include `providerName: string`.
  - Update all places where `selectedModel` is set/persisted (model selection handler, `resolveDefaultModel`, init state) to include `providerName`.
  - Ensure `providerName` is included when `selectedModel` is sent to webview via `initState` and `modelsList` messages.

  **Must NOT do**:
  - Do not change the model list fetching logic in `handleGetModels()`
  - Do not rename existing fields
  - Do not change the persistence key format for global state

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple type extension across 2 files, mechanical changes
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 4, 5, 6
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/providers/ChatViewProvider.ts:186` — Current `selectedModel` type definition: `{ providerID: string; modelID: string }`
  - `src/providers/ChatViewProvider.ts:517-524` — Model selection handler where `selectedModel` is set and persisted
  - `src/providers/ChatViewProvider.ts:2153-2158` — `resolveDefaultModel` where selectedModel is synced

  **API/Type References**:
  - `webview/chat/lib/types.ts` — `AppState.selectedModel` type and `ModelRecord` type (has `providerName` already)
  - `src/providers/ChatViewProvider.ts:2209-2215` — Model array type with `providerName: string` field

  **WHY Each Reference Matters**:
  - Line 186: This is the source type that MUST be extended — it flows to all downstream uses
  - Lines 517-524: When user picks a model from dropdown, `providerName` must be captured from the models list
  - Lines 2209-2215: The models list already has `providerName` — this is where we extract it from
  - `types.ts` `ModelRecord`: Already has `providerName?` field — webview side type is already compatible

  **Acceptance Criteria**:
  - [ ] `npm run build` succeeds with zero errors
  - [ ] `selectedModel` in ChatViewProvider includes `providerName` field
  - [ ] When model is selected, `providerName` is persisted alongside `providerID` and `modelID`

  **QA Scenarios:**

  ```
  Scenario: Build succeeds after type extension
    Tool: Bash
    Preconditions: All type changes applied
    Steps:
      1. Run `npm run build`
      2. Check exit code is 0
      3. Check stdout/stderr for "error" — expect none
    Expected Result: Build completes with 0 errors
    Failure Indicators: Non-zero exit code, TypeScript errors in output
    Evidence: .sisyphus/evidence/task-1-build-success.txt

  Scenario: Type consistency check
    Tool: Bash
    Preconditions: Type changes applied
    Steps:
      1. Run `npx tsc --noEmit`
      2. Grep output for errors related to selectedModel or providerName
    Expected Result: Zero type errors
    Failure Indicators: Type mismatch errors mentioning providerName
    Evidence: .sisyphus/evidence/task-1-type-check.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `refactor(chat): extend selectedModel type with providerName`
  - Files: `src/providers/ChatViewProvider.ts`, `webview/chat/lib/types.ts`
  - Pre-commit: `npm run build`

---

- [ ] 2. Add `TRANSITION_STREAMING` Reducer Action to Store

  **What to do**:
  - In `webview/chat/lib/types.ts`, add a new action type `TRANSITION_STREAMING` to the `AppAction` union. Payload: `{ message: Message }` — the final message to replace the streaming card with.
  - In `webview/chat/lib/store.ts`, add a new case for `TRANSITION_STREAMING` in the reducer. This action should:
    1. Add the final message to `state.messages` (same as `ADD_MESSAGE`)
    2. Clear `state.streamingCard` to `null`
    3. Do both in a SINGLE state update (one return) — this prevents the DOM flash caused by separate `CLEAR_STREAMING` + `ADD_MESSAGE`
  - Ensure `renderedMessageIds` de-duplication still works in the new action (check if message ID already exists before adding).

  **Must NOT do**:
  - Do not remove existing `CLEAR_STREAMING` or `ADD_MESSAGE` actions — they're still needed for other flows
  - Do not change the `START_STREAMING`, `APPEND_STREAMING_TEXT`, or `APPEND_STREAMING_REASONING` actions
  - Do not modify the streaming card state shape

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Adding one new reducer case — mechanical, pattern-following work
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 6
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `webview/chat/lib/store.ts:ADD_MESSAGE case` — Follow exact pattern for message de-duplication and state update
  - `webview/chat/lib/store.ts:CLEAR_STREAMING case` — Reference for streaming card clearing logic

  **API/Type References**:
  - `webview/chat/lib/types.ts:AppAction` — Union type to extend with new action
  - `webview/chat/lib/types.ts:Message` — Message interface used in payload
  - `webview/chat/lib/types.ts:StreamingCardState` — Streaming state that gets cleared

  **WHY Each Reference Matters**:
  - `ADD_MESSAGE` case: Must replicate the de-dup check (`renderedMessageIds`) to avoid duplicate messages
  - `CLEAR_STREAMING` case: Must replicate the streaming card nullification to complete the transition
  - Combined into one atomic state update = no intermediate render = no flash

  **Acceptance Criteria**:
  - [ ] `TRANSITION_STREAMING` action type exists in `AppAction` union
  - [ ] Reducer handles `TRANSITION_STREAMING` with atomic message-add + streaming-clear
  - [ ] De-duplication check prevents duplicate messages
  - [ ] `npm run build` succeeds

  **QA Scenarios:**

  ```
  Scenario: Reducer action correctly defined
    Tool: Bash
    Preconditions: store.ts and types.ts updated
    Steps:
      1. Run `npx tsc --noEmit`
      2. Search store.ts for `TRANSITION_STREAMING` case — expect exactly 1 match
      3. Search types.ts for `TRANSITION_STREAMING` — expect at least 1 match in AppAction
    Expected Result: Type checks pass, action exists in both files
    Failure Indicators: TypeScript errors, missing case in reducer
    Evidence: .sisyphus/evidence/task-2-reducer-check.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(chat): add TRANSITION_STREAMING atomic reducer action`
  - Files: `webview/chat/lib/store.ts`, `webview/chat/lib/types.ts`
  - Pre-commit: `npm run build`

- [ ] 3. Delete Legacy `StreamingComponents.tsx`

  **What to do**:
  - Delete `webview/chat/StreamingComponents.tsx` entirely.
  - Search the entire codebase for any imports of `StreamingComponents` — remove any found (expect none based on analysis, but verify).
  - Verify that the ACTIVE `StreamingCard` in `MessageComponents.tsx` is the one used everywhere.

  **Must NOT do**:
  - Do not delete `MessageComponents.tsx` — it contains the ACTIVE StreamingCard
  - Do not modify any other component's logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file deletion + import verification
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 8
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `webview/chat/StreamingComponents.tsx` — The file to DELETE (158 lines, contains unused legacy StreamingCard)
  - `webview/chat/MessageComponents.tsx` — Contains the ACTIVE StreamingCard (DO NOT touch)

  **WHY Each Reference Matters**:
  - `StreamingComponents.tsx`: Verified unused — `ChatShell.tsx` imports `StreamingCard` from `MessageComponents.tsx`, not this file
  - `MessageComponents.tsx`: Confirmation that the active component is safe and separate

  **Acceptance Criteria**:
  - [ ] `webview/chat/StreamingComponents.tsx` no longer exists
  - [ ] No import references to `StreamingComponents` remain in codebase
  - [ ] `npm run build` succeeds (confirming nothing depended on the deleted file)

  **QA Scenarios:**

  ```
  Scenario: File deleted and no broken imports
    Tool: Bash
    Preconditions: StreamingComponents.tsx deleted
    Steps:
      1. Verify file does not exist: `ls webview/chat/StreamingComponents.tsx` should fail
      2. Search for imports: `grep -r "StreamingComponents" webview/ src/` — expect 0 matches
      3. Run `npm run build` — expect success
    Expected Result: File gone, zero references, build passes
    Failure Indicators: File still exists, import errors in build
    Evidence: .sisyphus/evidence/task-3-deletion-verified.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `refactor(chat): remove unused legacy StreamingComponents.tsx`
  - Files: `webview/chat/StreamingComponents.tsx` (deleted)
  - Pre-commit: `npm run build`

---

- [ ] 4. Propagate `providerName` in Extension-Side Model Selection and Stream Events

  **What to do**:
  - In `src/providers/ChatViewProvider.ts`, update the model selection handler (around line 517) to look up `providerName` from the cached models list when user selects a model, and include it in `this.selectedModel`.
  - Update the stream event enrichment (lines 631-639) so that `info.model` includes `providerName` when injecting `this.selectedModel`.
  - Update `enrichMessageWithArtifacts` (line 1520-1521) to ensure `providerName` flows through to enriched messages.
  - Ensure `initState` message (line 416) sends `selectedModel` with `providerName` to webview on ready.

  **Must NOT do**:
  - Do not change the SSE streaming protocol or `MessageStreamService.ts`
  - Do not modify the stream subscription pattern
  - Do not change how `provider.list()` API is called

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Wiring changes in a single file, mechanical model field propagation
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7)
  - **Blocks**: Tasks 5, 6, 8
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/providers/ChatViewProvider.ts:629-658` — Stream event subscription and enrichment block
  - `src/providers/ChatViewProvider.ts:515-524` — `selectModel` message handler where model is stored
  - `src/providers/ChatViewProvider.ts:1497-1525` — `enrichMessageWithArtifacts` that attaches model info

  **API/Type References**:
  - `src/providers/ChatViewProvider.ts:2222-2228` — Where `providerName` is built from `provider.name || provider.id`
  - `src/providers/ChatViewProvider.ts:186` — `selectedModel` property (now extended with `providerName` from Task 1)

  **WHY Each Reference Matters**:
  - Lines 629-658: This is WHERE streaming events get `info.model` — if `providerName` is in `selectedModel`, it automatically flows
  - Lines 515-524: When user picks a model, we need to look up `providerName` from the models list and include it
  - Lines 2222-2228: This is the SOURCE of `providerName` data — extract from here during model selection

  **Acceptance Criteria**:
  - [ ] `selectedModel` includes `providerName` after model selection
  - [ ] Stream events forwarded to webview include `providerName` in `info.model`
  - [ ] `initState` message includes `providerName` in `selectedModel`
  - [ ] `npm run build` succeeds

  **QA Scenarios:**

  ```
  Scenario: providerName flows through stream enrichment
    Tool: Bash
    Preconditions: Tasks 1 and 4 complete
    Steps:
      1. Search ChatViewProvider.ts for `providerName` — expect matches in selectedModel assignment
      2. Verify the stream enrichment block (lines ~631-639) passes selectedModel which now includes providerName
      3. Run `npm run build` — expect success
    Expected Result: providerName is propagated in model selection, stream enrichment, and init state
    Failure Indicators: Build errors, providerName not found in model selection path
    Evidence: .sisyphus/evidence/task-4-provider-propagation.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(chat): propagate providerName through model selection and stream events`
  - Files: `src/providers/ChatViewProvider.ts`
  - Pre-commit: `npm run build`

- [ ] 5. Display Provider Name in `AssistantMessage` Component

  **What to do**:
  - In `webview/chat/MessageComponents.tsx`, modify the `AssistantMessage` component to display the provider name alongside the model label.
  - Find where `modelLabel` is rendered (look for model name display in the assistant message header/metadata area).
  - Add provider name display: format as `ProviderName / ModelName` or `ModelName (ProviderName)` — use the pattern that matches existing UI conventions.
  - Extract `providerName` from `message.info.model.providerName` or `message.info.model.providerID` as fallback.
  - In `webview/chat/ChatShell.tsx`, update the streaming message construction (lines 1452-1463) to ensure the synthetic streaming message includes `providerName` from `state.selectedModel`.
  - Style the provider name with slightly muted/secondary text color to differentiate from model name.

  **Must NOT do**:
  - Do not change the agent label display
  - Do not modify the message content rendering
  - Do not add new CSS classes — reuse existing muted/secondary text patterns
  - Do not change `View Plan` or `View Artifact` button positioning

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: UI label addition in 2 files, CSS styling follows existing patterns
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 6, 7)
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 4

  **References**:

  **Pattern References**:
  - `webview/chat/MessageComponents.tsx` — `AssistantMessage` component, specifically the header area where `agentLabel` and `modelLabel` are rendered
  - `webview/chat/ChatShell.tsx:1452-1463` — Synthetic streaming message construction — must include `providerName` in `info.model`
  - `webview/chat/ChatShell.tsx:1090-1097` — `ModelRecord` type definition showing available fields including `providerName`

  **API/Type References**:
  - `webview/chat/lib/types.ts:Message.info.model` — Where model info lives on each message
  - `webview/chat/lib/types.ts:ModelRecord` — Type with `providerName?: string` field

  **WHY Each Reference Matters**:
  - `AssistantMessage` header: This is WHERE the label appears — add provider name to existing label structure
  - Lines 1452-1463: Streaming messages construct `info.model` from `state.selectedModel` — must include providerName
  - `ModelRecord`: Confirms `providerName` is already a valid field in the type system

  **Acceptance Criteria**:
  - [ ] Provider name visible in assistant message headers for ALL messages (history, streaming, final)
  - [ ] Provider name styled as secondary/muted text
  - [ ] Fallback to `providerID` if `providerName` is undefined
  - [ ] Streaming messages show provider name while streaming
  - [ ] `npm run build` succeeds

  **QA Scenarios:**

  ```
  Scenario: Provider name visible in assistant messages
    Tool: Playwright (playwright skill)
    Preconditions: Extension running, chat open, at least one assistant message visible
    Steps:
      1. Navigate to the chat webview
      2. Send a test message: "Hello"
      3. Wait for assistant response to complete (timeout: 30s)
      4. Find the assistant message header area
      5. Assert text content contains provider name (e.g., "anthropic", "openai", or similar)
      6. Take screenshot of the assistant message header showing provider name
    Expected Result: Provider name visible alongside model name in message header
    Failure Indicators: Only model name shown, provider name missing or undefined
    Evidence: .sisyphus/evidence/task-5-provider-name-visible.png

  Scenario: Streaming message shows provider name
    Tool: Playwright (playwright skill)
    Preconditions: Extension running, chat open
    Steps:
      1. Send a message that triggers a long response
      2. While response is streaming (before completion), take screenshot
      3. Assert streaming message header contains provider name
    Expected Result: Provider name visible during streaming, not just after completion
    Failure Indicators: Provider name only appears after streaming finishes
    Evidence: .sisyphus/evidence/task-5-streaming-provider-name.png
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(chat): display provider name alongside model in assistant messages`
  - Files: `webview/chat/MessageComponents.tsx`, `webview/chat/ChatShell.tsx`
  - Pre-commit: `npm run build`

- [ ] 6. Implement Smooth Streaming-to-Final Message Transition

  **What to do**:
  - In `webview/chat/lib/messageHandler.ts`, find the `messageResponse` handler (the case that handles the final assistant message arriving from the extension).
  - Currently this handler dispatches `CLEAR_STREAMING` then `ADD_MESSAGE` as two separate actions, causing a DOM flash (streaming card disappears, brief empty state, then final message appears).
  - Replace with a SINGLE `dispatch({ type: 'TRANSITION_STREAMING', message: finalMessage })` call that atomically adds the final message and clears the streaming card.
  - Keep `CLEAR_STREAMING` as a fallback for edge cases (e.g., error states, manual stop) but the normal happy-path should use `TRANSITION_STREAMING`.
  - Verify that `renderedMessageIds` de-duplication still prevents duplicates.
  - Also review the `message.updated` handler with `finish: true` — ensure it does NOT also try to add the final message (only `messageResponse` should do that).

  **Must NOT do**:
  - Do not remove `CLEAR_STREAMING` dispatch from error/stop flows — only replace in happy path
  - Do not change the streaming event handlers (`message.part.updated`, `APPEND_STREAMING_TEXT`, etc.)
  - Do not modify the `START_STREAMING` trigger logic
  - Do not touch `FORBIDDEN TO REMOVE` token accumulation logic

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires understanding the full streaming lifecycle and careful modification of state transitions
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5, 7)
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 2, 4

  **References**:

  **Pattern References**:
  - `webview/chat/lib/messageHandler.ts` — The `messageResponse` case in the message handler switch — THIS IS THE PRIMARY EDIT TARGET
  - `webview/chat/lib/messageHandler.ts` — The `message.updated` handler with `finish: true` check — verify it doesn't duplicate final message
  - `webview/chat/lib/store.ts` — `TRANSITION_STREAMING` case (created in Task 2) — this is what we dispatch

  **API/Type References**:
  - `webview/chat/lib/types.ts:TRANSITION_STREAMING` — The new action type from Task 2
  - `webview/chat/lib/types.ts:Message` — Shape of the final message payload

  **Test References**:
  - No existing tests — rely on QA scenarios below

  **WHY Each Reference Matters**:
  - `messageResponse` handler: This is the EXACT code that causes the flash — the `CLEAR_STREAMING` + `ADD_MESSAGE` two-step
  - `message.updated` with `finish`: Need to ensure this only updates streaming state (marks it as finished) but does NOT add a new message — that's `messageResponse`'s job
  - `TRANSITION_STREAMING` reducer: The atomic action that fixes the flash by combining both operations

  **Acceptance Criteria**:
  - [ ] `messageResponse` handler uses `TRANSITION_STREAMING` for happy-path transition
  - [ ] Error/stop flows still use `CLEAR_STREAMING` separately
  - [ ] No visible flash/jump when streaming finishes and final message appears
  - [ ] `renderedMessageIds` prevents duplicate messages
  - [ ] `npm run build` succeeds

  **QA Scenarios:**

  ```
  Scenario: Smooth transition from streaming to final message
    Tool: Playwright (playwright skill)
    Preconditions: Extension running, chat open, clean conversation
    Steps:
      1. Send a message: "Explain what TypeScript is in 2 sentences"
      2. Wait for streaming to start (streaming card appears)
      3. Observe the transition from streaming to final message
      4. Assert: NO brief blank/empty state between streaming card and final message
      5. Assert: Final message contains the same text that was streaming
      6. Assert: Only ONE assistant message exists after completion (no duplicates)
      7. Take screenshot showing final state
    Expected Result: Streaming text smoothly becomes the final message with no visual interruption
    Failure Indicators: Brief flash of empty space, duplicate messages, text content mismatch
    Evidence: .sisyphus/evidence/task-6-smooth-transition.png

  Scenario: Stop request still works correctly
    Tool: Playwright (playwright skill)
    Preconditions: Extension running, chat open
    Steps:
      1. Send a message: "Write a very long essay about the history of computing"
      2. Wait for streaming to start (2s)
      3. Click the stop button (Escape key or stop button)
      4. Assert: Streaming card is cleared
      5. Assert: Partial response is either shown as final message or cleared (both acceptable)
      6. Assert: No error state, UI is ready for new input
    Expected Result: Stop request cleanly terminates streaming without errors
    Failure Indicators: Streaming card stuck, error messages, UI frozen
    Evidence: .sisyphus/evidence/task-6-stop-request.png
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `fix(chat): use atomic TRANSITION_STREAMING for smooth streaming-to-final handoff`
  - Files: `webview/chat/lib/messageHandler.ts`
  - Pre-commit: `npm run build`

- [ ] 7. Fix Double Token Accumulation

  **What to do**:
  - In `webview/chat/lib/messageHandler.ts`, identify the TWO places where `ACCUMULATE_SESSION_STATS` is dispatched:
    1. In the `message.updated` handler when `finish: true` is detected
    2. In the `messageResponse` handler when the final message arrives
  - Remove the accumulation from ONE of these — keep it in `messageResponse` only (more reliable, arrives after streaming is fully complete).
  - Verify token counts are correct after the fix by checking that stats update exactly once per assistant response.

  **Must NOT do**:
  - Do not remove BOTH accumulation points — ONE must remain
  - Do not change the `ACCUMULATE_SESSION_STATS` reducer action itself
  - Do not modify the token stats display UI
  - Do not touch `FORBIDDEN TO REMOVE` comments or tooltips

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Remove one dispatch call, verify other remains — simple fix
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5, 6)
  - **Blocks**: Task 8
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `webview/chat/lib/messageHandler.ts` — Search for `ACCUMULATE_SESSION_STATS` — expect exactly 2 dispatch calls currently
  - `webview/chat/lib/store.ts:ACCUMULATE_SESSION_STATS case` — The reducer that processes the accumulation (DO NOT modify)

  **API/Type References**:
  - `webview/chat/lib/types.ts:ACCUMULATE_SESSION_STATS` — Action type (DO NOT modify)

  **WHY Each Reference Matters**:
  - Two dispatch sites = tokens counted twice = inflated counts in header stats
  - Keep `messageResponse` site: it has the final, complete message with accurate token info
  - Remove `message.updated finish:true` site: it may have incomplete/intermediate token data

  **Acceptance Criteria**:
  - [ ] Only ONE `dispatch({ type: 'ACCUMULATE_SESSION_STATS' })` call remains in `messageHandler.ts`
  - [ ] The remaining call is in the `messageResponse` handler
  - [ ] Token counts in header stats update exactly once per assistant response
  - [ ] `npm run build` succeeds

  **QA Scenarios:**

  ```
  Scenario: Token counts accumulate exactly once per response
    Tool: Playwright (playwright skill)
    Preconditions: Extension running, fresh session (zero tokens)
    Steps:
      1. Note the initial token counts in the header (should be 0/0)
      2. Send a message: "Say hello"
      3. Wait for response to complete (timeout: 15s)
      4. Read the token counts from the header stats
      5. Send another message: "Say goodbye"
      6. Wait for response to complete
      7. Read the updated token counts
      8. Assert: Second count = first count + new response tokens (not first count * 2 + new)
    Expected Result: Token counts increase proportionally, not doubled
    Failure Indicators: Token counts jump disproportionately after each message
    Evidence: .sisyphus/evidence/task-7-token-counts.png
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `fix(chat): remove duplicate token accumulation in streaming finish handler`
  - Files: `webview/chat/lib/messageHandler.ts`
  - Pre-commit: `npm run build`


- [ ] 8. Build Verification + Comprehensive Integration QA

  **What to do**:
  - Run `npm run build` and verify zero errors.
  - Run `npx tsc --noEmit` and verify zero type errors.
  - Verify all cross-task integration points work together:
    - Provider name shows in both streaming AND final messages
    - Smooth transition works with provider name present
    - Token counts are accurate (not doubled)
    - Legacy StreamingComponents.tsx is gone and nothing is broken
  - Search codebase for regressions:
    - `grep -r 'FORBIDDEN TO REMOVE'` — all markers intact
    - `grep -r 'StreamingComponents'` — zero results
    - All `data-message-id` de-duplication still works

  **Must NOT do**:
  - Do not make code changes — this is a verification-only task
  - If issues are found, report them with file:line but do not fix in this task

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Requires careful cross-file verification and integration testing
  - **Skills**: `['playwright']`
    - `playwright`: Needed for UI verification of streaming behavior

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (solo)
  - **Blocks**: F1-F4 (Final Verification)
  - **Blocked By**: Tasks 3, 5, 6, 7

  **References**:

  **All task files from this plan:**
  - `webview/chat/lib/types.ts` — Verify `TRANSITION_STREAMING` in AppAction, `providerName` in model types
  - `webview/chat/lib/store.ts` — Verify `TRANSITION_STREAMING` case in reducer
  - `webview/chat/lib/messageHandler.ts` — Verify single `ACCUMULATE_SESSION_STATS`, `TRANSITION_STREAMING` dispatch
  - `webview/chat/MessageComponents.tsx` — Verify provider name in AssistantMessage
  - `webview/chat/ChatShell.tsx` — Verify provider name in streaming message construction
  - `src/providers/ChatViewProvider.ts` — Verify providerName in selectedModel, stream enrichment
  - `webview/chat/StreamingComponents.tsx` — Verify DELETED (should not exist)

  **Acceptance Criteria**:
  - [ ] `npm run build` exits with code 0
  - [ ] `npx tsc --noEmit` exits with code 0
  - [ ] All `FORBIDDEN TO REMOVE` markers intact
  - [ ] Zero references to `StreamingComponents` in codebase
  - [ ] Provider name visible in UI
  - [ ] Smooth transition verified visually
  - [ ] Token counts accurate

  **QA Scenarios:**

  ```
  Scenario: Full end-to-end streaming experience
    Tool: Playwright (playwright skill)
    Preconditions: Extension running with all Wave 1+2 changes, fresh session
    Steps:
      1. Open the chat panel
      2. Verify loading state: send a message "Hello", observe immediate loading animation
      3. Verify streaming: watch text appear progressively during response generation
      4. Verify provider name: check assistant message header shows provider name alongside model name
      5. Verify smooth transition: observe no flash/jump when streaming completes
      6. Verify token counts: check header stats show reasonable token counts (not doubled)
      7. Verify message de-duplication: only ONE assistant message visible after response
      8. Send a second message: "What is 2+2?" — repeat all checks
      9. Take screenshots at each verification step
    Expected Result: Complete streaming flow works smoothly from loading → streaming → final message with provider name and accurate tokens
    Failure Indicators: Flash during transition, missing provider name, doubled token counts, duplicate messages
    Evidence: .sisyphus/evidence/task-8-e2e-streaming.png

  Scenario: Session switching preserves provider names
    Tool: Playwright (playwright skill)
    Preconditions: Extension running, at least 2 sessions with messages
    Steps:
      1. Open history sidebar
      2. Switch to an older session
      3. Verify assistant messages in history show provider name
      4. Switch back to current session
      5. Verify streaming messages still show provider name
    Expected Result: Provider name visible in both current and historical sessions
    Failure Indicators: Provider name missing in history messages, crash on session switch
    Evidence: .sisyphus/evidence/task-8-session-switch.png

  Scenario: Build and type verification
    Tool: Bash
    Preconditions: All changes from Tasks 1-7 applied
    Steps:
      1. Run `npm run build` — capture output
      2. Run `npx tsc --noEmit` — capture output
      3. Run `grep -r 'FORBIDDEN TO REMOVE' webview/ src/` — verify markers present
      4. Run `grep -r 'StreamingComponents' webview/ src/` — verify zero matches
    Expected Result: Build and type checks pass, all markers intact, legacy file gone
    Failure Indicators: Build errors, type errors, missing markers, legacy references
    Evidence: .sisyphus/evidence/task-8-build-verification.txt
  ```

  **Commit**: NO (QA-only task, no code changes)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, check rendered UI). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run build`. Review all changed files for: `as any` additions, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify no `FORBIDDEN TO REMOVE` sections were altered.
  Output: `Build [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration: send a message, watch streaming appear with provider name, observe smooth transition to final message, verify token counts. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `refactor(chat): extend model type with providerName and add streaming transition action` — types.ts, store.ts, StreamingComponents.tsx (deleted)
- **Wave 2**: `feat(chat): display provider name and smooth streaming transition` — ChatViewProvider.ts, ChatShell.tsx, MessageComponents.tsx, messageHandler.ts
- **Wave 3**: No commit (QA only)

---

## Success Criteria

### Verification Commands
```bash
npm run build           # Expected: zero errors
npx tsc --noEmit        # Expected: zero type errors
```

### Final Checklist
- [ ] Provider name visible in assistant message headers
- [ ] No flash/jump during streaming-to-final transition
- [ ] Token counts accurate (no double-counting)
- [ ] Loading animation appears immediately on send
- [ ] Text streams progressively (preserved from current behavior)
- [ ] StreamingComponents.tsx deleted, no import references remain
- [ ] Build succeeds with zero errors
- [ ] All `FORBIDDEN TO REMOVE` sections intact
