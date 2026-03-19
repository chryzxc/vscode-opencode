# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-19
**Commit:** cfa49e8
**Branch:** main

## OVERVIEW
VS Code extension that embeds the OpenCode CLI server behind a React webview chat UI. The codebase splits cleanly between extension-host TypeScript in `src/`, a separately built webview package in `webview/shared/`, and a large regression-heavy `tests/` tree.

## STRUCTURE
```text
vscode-opencode/
├── src/                  # Extension host entry, providers, services, shared schema/types
│   └── providers/        # Webview hosts + UI-facing extension contracts
├── webview/shared/       # Separate Vite/Tailwind package for React webviews
│   └── src/chat/         # Main chat shell, message rendering, panels, structured output UI
├── tests/                # Contract, regression, integration, and unit coverage
├── scripts/              # Contract sync + maintenance scripts
├── resources/            # Extension assets
└── .sisyphus/            # Local planning/evidence scratchpad; not product code
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Extension startup, command wiring | `src/extension.ts` | `activate()` boot order matters: server → sessions → status → providers |
| Main chat backend bridge | `src/providers/ChatViewProvider.ts` | Webview message protocol, send flow, plan detection, streaming fan-out |
| Plan viewer host | `src/providers/PlanViewProvider.ts` | Separate webview provider for `implementation_plan.md` UX |
| Diff review host | `src/providers/DiffReviewProvider.ts` | Review panel for VCS changes linked to sessions |
| Server lifecycle | `src/services/OpencodeServerManager.ts` | Spawns `opencode serve`, tracks readiness/reconnect |
| Session persistence | `src/services/SessionService.ts` | Active session state, storage, sync |
| SSE streaming | `src/services/MessageStreamService.ts` | Event stream transport; feeds providers/tracker |
| Subagent orchestration | `src/services/SubagentTracker.ts` | Parent/child task state and detail timeline assembly |
| React chat entry | `webview/shared/src/chat/index.tsx` | Mounts chat shell into `#root` |
| Chat UI contracts | `webview/shared/src/chat/` | Message rendering, sticky header, panels, modals, structured output |
| Shared structured output schema | `src/shared/structuredOutputSchema.ts`, `src/shared/structuredOutputValidator.ts`, `scripts/sync-structured-output-contract.mjs` | Source of truth + sync script |
| Regression selection | `tests/` | Prompt ownership, structured output, chat assets, subagent UI, quota, plans |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `activate` | function | `src/extension.ts` | Extension activation and command/provider registration |
| `ChatViewProvider` | class | `src/providers/ChatViewProvider.ts` | Main extension/webview boundary and protected send path |
| `PlanViewProvider` | class | `src/providers/PlanViewProvider.ts` | Plan webview host |
| `DiffReviewProvider` | class | `src/providers/DiffReviewProvider.ts` | Diff-review panel host |
| `StatusBarProvider` | class | `src/providers/StatusBarProvider.ts` | Status item updates from server status |
| `SessionService` | class | `src/services/SessionService.ts` | Session CRUD, persistence, active-session coordination |
| `OpencodeServerManager` | class | `src/services/OpencodeServerManager.ts` | OpenCode CLI process lifecycle |
| `MessageStreamService` | class | `src/services/MessageStreamService.ts` | SSE subscription transport |
| `SubagentTracker` | class | `src/services/SubagentTracker.ts` | Subagent timeline/state collation |
| `PlanParser` | class | `src/services/PlanParser.ts` | Parses `implementation_plan.md` into structured data |
| `RequestBudgeter` | class | `src/services/RequestBudgeter.ts` | Daily allowance / warning logic |

## CONVENTIONS
- Root build order is intentional: `structured-output:sync` → `webview:build` → `compile`. Do not reorder those steps.
- `webview/shared/` is a real package boundary with its own `package.json`, Vite config, and Tailwind config.
- Wrapper prompt payloads stay transport-only. Behavioural/system instructions belong to OpenCode agents/server, not this extension.
- Structured output schema originates in `src/shared/*` and is copied into `webview/shared/src/chat/lib/generated/*`; update through the sync script, not manual dual edits.
- Tests primarily use Node's built-in runner with `.test.mjs`; Vitest exists for targeted unit runs.

## ANTI-PATTERNS (THIS PROJECT)
- Do not remove or hide the sticky token/session stats header, implementation-plan affordances, or stop-request control without explicit user request.
- Do not inject wrapper-authored system/policy text into outgoing prompt parts in `ChatViewProvider` send paths.
- Do not break the React chat asset contract in `getHtmlContent`: keep `#root`, `chat.js`, and `chat.css` wired together.
- Do not emit raw `[BACKGROUND TASK ...]` text for subagents when structured output fields can carry the same state.
- Do not silently trim information density from the chat UI just to simplify layout.

## UNIQUE STYLES
- Providers are the enforcement layer for user-visible product contracts; services stay reusable and backend-lean.
- The chat UI is feature-dense by design: sticky stats, right-side panels, queue controls, subagent detail, quotas, MCP/LSP status.
- The test suite is policy-oriented: many files are named after regressions/contracts instead of generic component names.

## COMMANDS
```bash
npm run build                     # sync schema, build webview, compile extension
npm run webview:build             # rebuild React assets after webview changes
npm run compile                   # rebuild extension host bundle
npm run watch                     # watch extension bundle
npm run webview:watch             # watch webview bundle
npm run structured-output:sync    # copy schema/validator into webview generated files
npm run structured-output:check   # verify generated contract is current
npm test                          # run Node regression/contract suite
npm run test:unit                 # run Vitest unit suite
npm run lint                      # lint extension-host TypeScript
```

## NOTES
- Child guides exist only where local rules are stronger than this root document: `src/providers/`, `webview/shared/src/chat/`, `tests/`.
- If chat becomes unstyled or inert, verify asset wiring first, then run `npm run webview:build` and `npm run compile`.
- Existing AGENTS guidance had stale paths like `Shell.tsx`; use current filenames such as `ChatShell.tsx` and the provider/html contract instead.
