# CHAT WEBVIEW KNOWLEDGE BASE

## OVERVIEW
`webview/shared/src/chat/` owns the main React chat surface: message rendering, sticky stats, right-panel controls, structured-output rendering, streaming UI, and chat-specific state helpers.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App entry and mount | `index.tsx`, `ChatShell.tsx` | Root shell, top-level layout, host message bootstrapping |
| Message rendering | `MessageComponents.tsx` | Assistant/user cards, plan button UI, errors, reasoning, file/image affordances |
| Header, sidebars, controls | `PanelComponents.tsx` | Sticky header, history, active task, quota, todo, MCP/LSP, agents, settings |
| Streaming UI | `StreamingComponents.tsx` | Live progress steps and streaming card presentation |
| Chat reducer/state | `lib/store.ts`, `lib/types.ts` | Canonical frontend state and actions |
| Extension event parsing | `lib/messageHandler.ts` | Converts provider events into store updates; structured output normalisation |
| Structured output contract | `lib/structuredOutputValidator.ts`, `lib/generated/*` | Local validation + generated schema copies |
| Chat-specific modals | `SubagentDetailModal.tsx`, `ImagePreviewModal.tsx` | Detail inspection and preview UX |

## CONVENTIONS
- Keep the UI additive and information-dense; the product deliberately exposes advanced status panels and token metrics.
- Structured output should flow through validated/normalised channels, not by scraping plain markdown or generic text fields.
- Do not implement phrase-identification or prompt-text heuristics in the webview; render directly from structured JSON fields.
- State shape changes must be mirrored across `lib/types.ts`, `lib/store.ts`, and `lib/messageHandler.ts`.
- Prefer local chat components for chat-only UI; shared primitives belong in `../components/ui/` only when reused across chat/plan/diff-review.

## ANTI-PATTERNS
- Do not remove the sticky header token/session stats, plan affordances, stop controls, or subagent/side-panel surfaces during layout simplification.
- Do not parse structured output from arbitrary `content`/`text` blobs when explicit structured channels exist.
- Do not emit legacy interactive event shapes when the top-level structured `question` object is available.
- Do not break `MessageComponents.tsx` plan button rendering or structured subagent cards while cleaning message presentation.

## VERIFICATION TARGETS
- `tests/chat-message-flow.test.mjs`
- `tests/chat-view-streaming.test.mjs`
- `tests/chat-css-regression.test.mjs`
- `tests/structured-output-streaming.test.mjs`
- `tests/structured-output-validator.test.mjs`
- `tests/subagent-ui-contract.test.mjs`
- `tests/subagent-ui-features.test.mjs`
- `tests/active-task-panel.test.mjs`
- `tests/mcp-lsp-panels.test.mjs`
- `tests/todo-panel.test.mjs`

## NOTES
- `MessageComponents.tsx` and `PanelComponents.tsx` are the dominant hotspots; touch them carefully and verify neighbouring features, not just the one you changed.
- Generated structured-output files are downstream artefacts. Update the shared schema source and sync script instead of hand-editing generated copies unless you are debugging generation itself.
