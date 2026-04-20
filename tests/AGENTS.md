# TEST SUITE KNOWLEDGE BASE

## OVERVIEW
`tests/` is a regression-first suite guarding product contracts: prompt ownership, structured output, React chat wiring, subagent UI, quota/budget behaviour, session persistence, and plan workflow.

## WHERE TO LOOK
| Change area | Test cluster | Notes |
|-------------|--------------|-------|
| Prompt payload construction | `system-prompt-and-structured-output-parsing.test.mjs`, `system-prompt-history-filter.test.mjs` | Guards against wrapper-authored system prompt injection |
| Structured output schema / parsing | `structured-output-*.test.mjs`, `interactive-events-contract.test.mjs` | Backend/webview contract sync and parser correctness |
| Chat webview rendering | `chat-*.test.mjs`, `panel-layout.test.mjs`, `ui-rendering-enhancements.test.mjs` | Covers layout, CSS, streaming, readability |
| Subagent UI and tracking | `subagent-*.test.mjs`, `active-task-panel.test.mjs`, `interactive-events.test.mjs` | Inline cards, timelines, persistence |
| Plan workflow | `plan-*.test.mjs`, `plan-viewer.test.mjs` | Detection, parsing, viewer behaviour |
| Budget / quota | `request-budgeter.test.mjs`, `quota-service.test.mjs`, `integration/budget-quota-integration-regression.test.mjs` | Warning/enforcement flows |
| Extension/provider plumbing | `status-bar-provider.test.mjs`, `diff-review.test.mjs`, `session-crud.test.mjs`, `message-stream-service.test.mjs` | Host-side correctness |

## CONVENTIONS
- Most high-value tests are contract/regression named; use filenames to choose intent, not just folder location.
- Root-level `.test.mjs` files are the main Node runner suite; `tests/unit/` and `tests/integration/` narrow scope when you know the affected layer.
- `tests/unit/**/*.test.ts` runs via Vitest with 100% coverage thresholds; separate from the main Node suite.
- When changing prompt paths or structured output, prioritise policy/contract tests before broader UI sweeps.
- Test impact selection: `scripts/test-impact-map.json` maps source files → test files; run via `npm run test:impacted`.

## ANTI-PATTERNS
- Do not run only happy-path unit tests when touching prompt ownership, structured output, or chat asset wiring.
- Do not rename or weaken regression tests that encode protected product behaviour just to match refactors.
- Do not assume one UI test is enough for `ChatViewProvider` or chat-shell changes; select across prompt, streaming, and panel clusters.

## FAST SELECTION GUIDE
- Prompt send-flow change → `system-prompt-and-structured-output-parsing.test.mjs` + `system-prompt-history-filter.test.mjs`
- Structured output/schema change → `structured-output-contract-sync.test.mjs` + `structured-output-validator.test.mjs` + `structured-output-streaming.test.mjs`
- Chat layout/component change → `chat-css-regression.test.mjs` + `panel-layout.test.mjs` + relevant subagent/todo/MCP panel tests
- Plan workflow change → `plan-detection.test.mjs` + `plan-parser.test.mjs` + `plan-viewer.test.mjs`
- Budget/quota change → `quota-service.test.mjs` + `request-budgeter.test.mjs` + integration regression

## NOTES
- This tree is intentionally broad because it protects user-visible behaviour more than isolated implementation details.
- If a change crosses provider + webview boundaries, combine tests from this file with the root and child AGENTS guides rather than relying on a single folder heuristic.
