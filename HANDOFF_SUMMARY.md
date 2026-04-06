# Handoff Summary

## Main UI/Timeline Changes Completed
- Unified **Activity + Reasoning** into a single Stepper timeline in:
  - `webview/shared/src/chat/MessageComponents.tsx`
- Removed separate reasoning block and removed `step #1/#2` labels.
- Reasoning rows now render as Stepper rows labeled **`Reasoning`**.
- Reasoning rows are interleaved by timeline order (not appended at bottom).
- Removed visible section titles like `Activity`/`Reasoning` from timeline header.

## Internal Rows Behavior
- Internal events are now shown in the **same main Stepper** (not separate Stepper), controlled by toggle:
  - `internal N on/off`
- Internal rows are hidden by default, but when enabled they appear inline in order.

## Provenance + Raw Debug
- Activity row provenance fields implemented (`source`, `partType`, `internal`) and used in UI.
- Raw debug parse status chip shown: `parse parsed|empty|unparseable|truncated`.
- Activity normalization merges from stream + final + raw-debug parts.

## Reasoning Leak Handling (Stream + Final)
- Added stream-time guard so content is renderable only for trusted text part types:
  - `text`, `message`, `output_text`
- Deferred non-final structured-message chunks into reasoning lane (instead of assistant markdown body) when not safe.
- Added normalization guard to suppress reasoning-only fallback when raw debug indicates reasoning-only final payload.
- Refined that guard to still allow streamed final text fallback **if** it was explicitly marked renderable (`hasRenderableContent`), fixing “final answer not shown” regressions.

## Root Cause Fixed For `isLikelyPlanMarkdownFile` Artifact
- Source issue found in diagnostics path:
  - debug file path was literally `.opencode-debug/isLikelyPlanMarkdownFile`
- Changed to:
  - `.opencode-debug/render-parity.ndjson`
  - in `src/providers/chat/DiagnosticsLogger.ts`
- Removed stale old file from workspace:
  - `.opencode-debug/isLikelyPlanMarkdownFile`

## Files Changed (This Session)
- `webview/shared/src/chat/lib/types.ts`
- `webview/shared/src/chat/lib/messageHandler.ts`
- `webview/shared/src/chat/MessageComponents.tsx`
- `src/providers/chat/DiagnosticsLogger.ts`
- `tests/regression/streaming-progress-regression.test.mjs`
- `tests/webview/ui-rendering-enhancements.test.mjs`

## Tests/Build Run
- `node --test tests/regression/streaming-progress-regression.test.mjs tests/webview/ui-rendering-enhancements.test.mjs`
  - Passing (42/42)
- `npm run webview:build`
  - Passing
- `npm run compile`
  - Passing

## Remaining Validation For Next Agent
- Validate with live repro on provider `zai-coding-plan/glm-4.7`:
  1. Reasoning never appears in assistant markdown body.
  2. Reasoning appears in unified stepper.
  3. Final user-facing answer still appears when model provides one via stream snapshot.
