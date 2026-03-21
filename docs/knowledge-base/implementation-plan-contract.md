# Implementation Plan Contract

## Status
Active product contract.

## Scope
Applies to structured output handling for `responseType="implementation_plan"` across:
- `src/shared/structuredOutputSchema.ts`
- `src/shared/structuredOutputValidator.ts`
- `src/providers/ChatViewProvider.ts`
- `webview/shared/src/chat/*` rendering path

## Contract
1. `implementation_plan` payload is valid when either `plan.file` or `plan.content` is provided.
2. `plan.file` is first-class and must be preserved end-to-end (validator -> provider normalization -> message payload -> UI card).
3. Plan card and `View Plan` action must remain available for file-backed plans even when `plan.content` is absent.
4. Clarification/question responses must not be promoted into implementation plans.

## Rationale
- The source of truth is often the markdown file produced by tools.
- Requiring embedded markdown content in every response causes false negatives and drops valid plan UX.
- `handleViewPlan` is designed to prefer disk content when available.

## Required Safeguards
- Do not reintroduce `plan.content`-only gating for plan attachment.
- Do not synthesize placeholder plan paths (for example hardcoding `implementation_plan.md`) when the response did not provide that exact file.
- `plan.file` should be emitted as a full markdown filepath (absolute preferred; workspace-relative accepted), not a bare filename.
- Preserve and prioritize concrete plan file hints from `plan.file`, `plan.files`, and markdown path references before opening the plan tab.
- When `plan.file` is present, `View Plan` must render disk content from that filepath as source-of-truth; only fall back to `plan.content` when no filepath was provided.
- Keep schema and generated contract files in sync via `npm run structured-output:sync`.
- Keep provider and webview behavior aligned with this contract.

## Verification Targets
- `tests/plan-detection.test.mjs`
- `tests/plan-viewer.test.mjs`
- `tests/structured-output-validator.test.mjs`
- `tests/unit/providers/ChatViewProvider.test.ts`
- `tests/unit/shared/structuredOutputValidator.test.ts`

## Change Control
Any change to this contract must update:
- schema + validator,
- provider plan wiring,
- and regression tests listed above.

