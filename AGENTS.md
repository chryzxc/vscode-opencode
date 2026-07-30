# Agent Instructions

These rules apply to AI agents working in this repository.

## Before editing

- Read the nearest `AGENTS.md` files for the files being changed.
- Inspect `git status --short` and preserve unrelated worktree changes.
- For streaming chat, activity timelines, hydration, deduplication, ordering,
  structured output, or collapsed/expanded response rendering, use the fixture
  or SDK debug data supplied with the issue. If none exists, add a minimal
  behavioral fixture before changing production code.
- Trace the full path: SDK event → normalization → store/merge → ownership and
  ordering → rendered component.

## Required implementation behavior

- Add or update a regression test before changing streaming UI behavior.
- Rendered activity rows are append-only within an assistant turn. Later
  partial events may enrich rows but must not clear or replace already rendered
  rows without an explicit removal event.
- SDK transport IDs are not semantic visible-action identity. Do not dedupe
  distinct actions by title, timestamp, or mutable status.
- Preserve first-arrival order across assistant phases and hydration.
- A live response card and its transcript counterpart must have one response
  body owner; never render both copies for one assistant turn.
- Structured output must be selected and rendered in both live and hydrated
  paths. Collapsed and expanded views must choose the same final response.
- Do not add a fallback state owner or a new dedupe layer without a regression
  test covering the existing owner and merge path.

## Validation

Run the focused tests first, then:

```bash
npm run guard:streaming
npm run typecheck
npm run webview:build
npm run build
```

Run `npm run guard:prepush` before handing off broad or cross-layer changes.
The streaming contract guard is authoritative. Do not weaken, remove, skip, or
rewrite a failing regression merely to make the guard pass.

## Repository boundaries

- `src/` is the extension host; `webview/shared/` is a separate Vite package.
- Structured-output source files live in `src/shared/`; update generated
  webview contracts through `npm run structured-output:sync`.
- Keep transport-only prompt payloads free of wrapper-authored policy text.
- Do not remove existing user-facing controls or information density without
  explicit user direction.
- Never use `git restore`, `git checkout --`, `git clean`, or reset commands to
  discard changes unless the user explicitly authorizes it.

## Canonical references

- Streaming behavior: `skills/streaming-ui-debugger/SKILL.md`
- Streaming enforcement: `scripts/streaming-contract-check.mjs`
- Activity hydration contract: `docs/knowledge-base/activity-timeline-hydration-contract.md`
- Implementation-plan contract: `docs/knowledge-base/implementation-plan-contract.md`
- Test impact mapping: `scripts/test-impact-map.json`
