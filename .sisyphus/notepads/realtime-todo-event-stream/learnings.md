2026-03-19 - Normalization notes

- Introduced normalizeTodoRecord(raw) to validate and coerce incoming todo items.
  - Ensures id and text are present and non-empty.
  - Normalizes status to one of TodoItem.status union and rejects unknown statuses.
  - Returns null for malformed records so callers can skip safely.

- Unified ingestion path: todoUpdate handler and stream-derived todo_update both route to
  the same reducer actions. The todoUpdate case preserves test-friendly explicit
  'add'/'update' branches, falling back to ingestNormalizedTodo when action is absent.

- Guards: missing/malformed item → ignored; try/catch prevents postMessage payloads from throwing.

2026-03-19 - Task 16 ordering/replay hardening

- UPDATE_TODO_ITEM now short-circuits to `state` when replayed patches do not change effective fields.
- Rank checks are enforced for status-bearing patches: higher rank promotes, same-rank same-status is idempotent, same-rank different-status is ignored, lower-rank is rejected.
- Terminal status guard remains transition-immutable (`completed`/`failed`/`cancelled` cannot be downgraded).
- `ingestNormalizedTodo` continues to route existing IDs to `UPDATE_TODO_ITEM`; new IDs use `ADD_TODO_ITEM`.
- Added test assertions in `tests/todo-panel.test.mjs` for lifecycle ordering markers and replay no-op behavior.

2026-03-19 - Inline summary boundary notes (Task 15)

- Added `TodoInlineSummary` in `MessageComponents.tsx` to render only aggregate lifecycle data inline:
  - total task count
  - in_progress count
  - latest transition line (`Latest: "<task>" - <status>`)
- Kept inline output compact to 1-2 lines and visually subtle (`text-[11px]`, muted panel styling) so it does not compete with primary assistant content.
- Avoided any per-item list rendering in conversation stream (`todoItems.map(...)` absent in MessageComponents), preserving TodoPanel as the only full-list surface.
- Scoped summary visibility to the latest assistant message to prevent repeated summary blocks across older conversation cards.

2026-03-19 - Task 14 panel boundary + failed status rendering

- Enforced hybrid panel ownership in `PanelComponents.tsx`: `ActiveTaskPanel` is now subagent/progress-only and does not render todo rows.
- Kept the authoritative full todo list in `TodoPanel` as the sole `todoItems.map(...)` render site.
- Preserved existing pending/in_progress/completed icon mapping and added explicit status labeling/tone classes so `failed` renders with a distinct red treatment and label without changing test-sensitive icon switch structure.

2026-03-19 - Task 18: Webview reducer + rendering tests

- Added source-level tests in `tests/todo-panel.test.mjs` to guard:
  - presence of `normalizeTodoRecord` and `ingestNormalizedTodo` in `messageHandler.ts`
  - `LIFECYCLE_RANK` includes `failed` and `cancelled` in `store.ts`
  - `ADD_TODO_ITEM`/`UPDATE_TODO_ITEM` upsert semantics and rank comparisons in reducer
  - `TodoItem.status` union still contains `cancelled` (regression guard) in `types.ts`
  - `TodoPanel` renders `failed`/`cancelled` icon branch in `PanelComponents.tsx`

Evidence:
- tests run: node --test tests/todo-panel.test.mjs -> saved to .sisyphus/evidence/task-18-webview-tests-pass.txt
- full npm test run saved to .sisyphus/evidence/task-18-regression-guard.txt

Notes:
 - Followed existing test style (source-level regex assertions) to avoid touching production code.
 - Verified `npm run compile` completed successfully.

2026-03-19 - Task 17 (provider tests)

- Added tests to validate provider todo forwarding and session persistence:
  - tests/todo-provider.test.mjs covers: todoUpdate postMessage emission, workspaceState persistence guard, initState todo rehydration, helper presence, and missing sessionId fallback handling.
  - Evidence saved to .sisyphus/evidence/task-17-provider-tests-pass.txt and .sisyphus/evidence/task-17-session-fallback-guard.txt

- Notes:
  - Tests are file-level regex assertions (consistent with existing suite style).
  - No production code changes were made; tests inspect ChatViewProvider.ts source text for expected patterns.
  - Verified: existing tests (tests/todo-panel.test.mjs) remain green, new tests pass, and npm run compile completes.

2026-03-19 - Task 19: Session switch rehydration tests

- Added tests/todo-session-switch.test.mjs to assert:
  - handleLoadSession calls clearSessionTodos() before posting initState with todoItems loaded from workspaceState.
  - clearSessionTodos() resets this.currentTodoItems to an empty array.
  - initState sent on webview ready includes todoItems: this.loadPersistedTodos(this.currentSessionId).items
  - messageHandler exposes normalizeTodoRecord and ingestNormalizedTodo helpers used by the reducer ingestion path.

- Evidence files created under .sisyphus/evidence/ capturing live test run results and guard assertions.

- Added  with source-level regex assertions for lifecycle rank progression, terminal immutability, messageHandler normalization/ingestion, provider forwarding, and TodoInlineSummary aggregate rendering.
- Captured evidence artifacts for full new-suite pass output and failed-status guard confirmation in reducer lifecycle rank + terminal checks.

- Added tests/todo-e2e-stream.test.mjs with source-level regex assertions for lifecycle rank progression, terminal immutability, messageHandler normalization/ingestion, provider forwarding, and TodoInlineSummary aggregate rendering.
- Captured evidence artifacts for full new-suite pass output and failed-status guard confirmation in reducer lifecycle rank plus terminal checks.

2026-03-19 - Post-refactor verification

- Ran structured-output:check, compile, and full npm test to verify no regressions after cleanup.
  - structured-output:check -> pass
  - npm run compile -> build complete
  - npm test -> 755 pass, 41 fail (no new failures introduced)
- Executed focused todo tests via node --test and confirmed all 27 todo-specific tests passed.
- Created evidence files under .sisyphus/evidence/ capturing command outputs for audit.
- No behavioral changes were made; only evidence and minor whitespace/clarity edits appended to notepad.
