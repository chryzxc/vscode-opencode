# Activity Timeline Hydration Contract

## Status
Active product contract.

## Scope
Applies to activity/progress rendering parity between live streaming and hydrated history across:
- `webview/shared/src/chat/lib/messageHandler.ts`
- `webview/shared/src/chat/MessageComponents.tsx`
- `src/providers/ChatViewProvider.ts`

## Contract
1. Hydrated activity rows must preserve the same user-facing semantics as stream-time rows for title, status, and secondary metadata.
2. Canonical step parsing must accept legacy and variant fields (`title/message`, `label/summary`, `meta/detail/description`, state-nested fallbacks).
3. Tool-part hydration fallback must merge repeated snapshots by `callID` instead of dropping later updates.
4. Compact tool-name titles (for example `read_file`, `shell`, `edit`) must render as explicit activity labels, not generic `EVENT`.
5. No phrase-identification logic should be introduced to infer activity meaning from arbitrary prose.

## Rationale
- Session reloads often receive denser or differently-shaped payloads than stream events.
- If hydration parsing is narrower than streaming parsing, the UI regresses into generic `EVENT` rows and mismatched descriptions.
- Call-level merging is required because tool updates can arrive incrementally with richer late metadata.

## Required Safeguards
- Keep `normalizeActivityStepRecord` tolerant to historical shape variants.
- Keep `extractActivityStepsFromParts` callID-aware and merge-based.
- Keep timeline label parsing resilient to compact slug-like tool names.
- Keep schema-driven structured-output processing as the primary source of activity truth.

## Verification Targets
- `tests/streaming-progress-regression.test.mjs`
- `tests/chat-view-streaming.test.mjs`
- `tests/session-hydration-rendering-regression.test.mjs`
- `tests/store-message-canonicalization-regression.test.mjs`

## Change Control
Any change to activity/title parsing or hydration normalization must update:
- the canonical webview message normalizer,
- timeline title parsing behavior,
- and regression tests listed above.
