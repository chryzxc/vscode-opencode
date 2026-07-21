# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-19
**Commit:** e63d4e5
**Branch:** main

## OVERVIEW
VS Code extension that embeds the OpenCode CLI server behind a React webview chat UI. The codebase splits cleanly between extension-host TypeScript in `src/`, a separately built webview package in `webview/shared/`, and a large regression-heavy `tests/` tree.

## STRUCTURE
```text
vscode-opencode/
├── src/                  # Extension host entry, providers, services, shared schema/types
│   ├── providers/        # Webview hosts + UI-facing extension contracts
│   │   └── chat/         # ChatViewProvider modular internals (queue, stream, plan, etc.)
│   ├── services/         # Backend business logic (server, sessions, SSE, quota, skills)
│   ├── shared/           # Structured-output schema + validator (source of truth)
│   ├── utils/            # Logger, LogQuery, nonce helper
│   └── types/            # Shared TypeScript type definitions
├── webview/shared/       # Separate Vite/Tailwind package for React webviews
│   └── src/
│       ├── chat/         # Main chat shell, message rendering, panels, structured output UI
│       ├── components/ui/ # Shared UI primitives (Button, Badge, Stepper, etc.)
│       ├── plan/         # Plan viewer webview
│       ├── diff-review/  # Diff review webview
│       └── skills/       # Skills management webview
├── tests/                # Contract, regression, integration, and unit coverage
├── scripts/              # Contract sync, dev servers, pre-push guard, log analysis
├── resources/            # Extension assets
└── .sisyphus/            # Local planning/evidence scratchpad; not product code
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Extension startup, command wiring | `src/extension.ts` | `activate()` boot order matters: server → sessions → status → providers |
| Main chat backend bridge | `src/providers/ChatViewProvider.ts` | Webview message protocol, send flow, plan detection, streaming fan-out |
| Chat provider modular internals | `src/providers/chat/` | 12 modules: QueueManager, StreamEventHandler, StructuredOutputProcessor, PlanManager, SubagentPersistence, SessionHandler, ModelAndAgentManager, HistoryProcessor, CompactionManager, ErrorBuilder, DiagnosticsLogger |
| Plan viewer host | `src/providers/PlanViewProvider.ts` | Separate webview provider for `plan.md` UX |
| Diff review host | `src/providers/DiffReviewProvider.ts` | Review panel for VCS changes linked to sessions |
| Skills panel host | `src/providers/SkillsPanelProvider.ts` | Skills management webview |
| Config files host | `src/providers/ConfigFilesProvider.ts` | Configuration file management |
| Server lifecycle | `src/services/OpencodeServerManager.ts` | Spawns `opencode serve`, tracks readiness/reconnect |
| Session persistence | `src/services/SessionService.ts` | Active session state, storage, sync |
| Session title generation | `src/services/TitleGeneratorService.ts` | Auto-generates session titles from first user message |
| SSE streaming | `src/services/MessageStreamService.ts` | Event stream transport; feeds providers/tracker |
| Subagent orchestration | `src/services/SubagentTracker.ts` | Parent/child task state and detail timeline assembly |
| Quota polling | `src/services/QuotaService.ts` | Multi-provider quota APIs (OpenAI, Copilot, Gemini, Zhipu, Z.ai) |
| Plan parsing | `src/services/PlanParser.ts` | Parses `plan.md` into structured data |
| Skill management | `src/services/SkillManagerService.ts`, `src/services/SkillManagementService.ts` | Install/validate/discover/enable-disable skills |
| Model capabilities | `src/services/ModelCapabilitiesService.ts` | Reasoning detection via static map + models.dev |
| Checkpoint restore | `src/services/CheckpointRestore.ts` | Startup checkpoint restore |
| Gemini token tracking | `src/services/GeminiTokenUsageTracker.ts` | Singleton, debounced persistence |
| React chat entry | `webview/shared/src/chat/index.tsx` | Mounts chat shell into `#root` |
| Chat UI contracts | `webview/shared/src/chat/` | Message rendering, sticky header, panels, modals, structured output |
| Shared UI primitives | `webview/shared/src/components/ui/` | Reusable components (Badge, Button, Stepper, Tabs, etc.) |
| Shared structured output schema | `src/shared/structuredOutputSchema.ts`, `src/shared/structuredOutputValidator.ts`, `scripts/sync-structured-output-contract.mjs` | Source of truth + sync script |
| Regression selection | `tests/` | Prompt ownership, structured output, chat assets, subagent UI, quota, plans |
| Pre-push guard | `scripts/pre-push-check.mjs` | structured-output:check → compile → conditional webview build → lint → impacted tests |
| Test impact mapping | `scripts/test-impact-map.json` | Maps changed files → test files to run |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `activate` | function | `src/extension.ts` | Extension activation and command/provider registration |
| `ChatViewProvider` | class | `src/providers/ChatViewProvider.ts` | Main extension/webview boundary and protected send path |
| `PlanViewProvider` | class | `src/providers/PlanViewProvider.ts` | Plan webview host |
| `DiffReviewProvider` | class | `src/providers/DiffReviewProvider.ts` | Diff-review panel host |
| `SkillsPanelProvider` | class | `src/providers/SkillsPanelProvider.ts` | Skills management webview host |
| `ConfigFilesProvider` | class | `src/providers/ConfigFilesProvider.ts` | Configuration file management host |
| `StatusBarProvider` | class | `src/providers/StatusBarProvider.ts` | Status item updates from server status |
| `SessionService` | class | `src/services/SessionService.ts` | Session CRUD, persistence, active-session coordination |
| `OpencodeServerManager` | class | `src/services/OpencodeServerManager.ts` | OpenCode CLI process lifecycle |
| `MessageStreamService` | class | `src/services/MessageStreamService.ts` | SSE subscription transport |
| `SubagentTracker` | class | `src/services/SubagentTracker.ts` | Subagent timeline/state collation |
| `PlanParser` | class | `src/services/PlanParser.ts` | Parses `plan.md` into structured data |
| `QuotaService` | class | `src/services/QuotaService.ts` | Multi-provider quota polling |
| `SkillManagerService` | class | `src/services/SkillManagerService.ts` | Skill install/validate/discover |
| `SkillManagementService` | class | `src/services/SkillManagementService.ts` | Skill enable/disable lifecycle |
| `ModelCapabilitiesService` | class | `src/services/ModelCapabilitiesService.ts` | Reasoning detection for model selection |
| `CheckpointRestore` | class | `src/services/CheckpointRestore.ts` | Startup checkpoint restore |

## CONFIGURATION
| Setting | Type | Default | Description |
|---------|------|-----------|------------|
| `opencode.autoGenerateSessionTitle` | `boolean` | `true` | Automatically generate session title from first message |

## CONVENTIONS
- Root build order is intentional: `structured-output:sync` → `webview:build` → `compile`. Do not reorder those steps.
- `webview/shared/` is a real package boundary with its own `package.json`, Vite config, and Tailwind config.
- Wrapper prompt payloads stay transport-only. Behavioural/system instructions belong to OpenCode agents/server, not this extension.
- Structured output schema originates in `src/shared/*` and is copied into `webview/shared/src/chat/lib/generated/*`; update through the sync script, not manual dual edits.
- Structured-output handling must be schema/data-driven only; we do not want phrase-identification or prompt-text inference logic.
- Implementation-plan contract: for `responseType="plan"`, treat `plan.file` as first-class (filepath-only payloads are valid and expected when the plan is written to disk). Do not require `plan.content` to render the plan card or enable `View Plan`.
- Tests primarily use Node's built-in runner with `.test.mjs`; Vitest exists for targeted unit runs.
- For newly added files, default to modular design: avoid creating large monolith files, split by responsibility early, and prefer adding small focused modules/components over extending a single file.
- Pre-push guard (`scripts/pre-push-check.mjs`) enforces: structured-output:check → compile → conditional webview build → lint → impacted tests. Use `npm run guard:prepush` to run manually.
- Test impact selection (`scripts/test-impact-map.json`) maps changed source files to their related test files for faster CI feedback.
- Message ordering contract: `chatHistory` must be sent to webview BEFORE `initState` on session load.

## ANTI-PATTERNS (THIS PROJECT)
- Do not remove or hide the sticky token/session stats header, implementation-plan affordances, or stop-request control without explicit user request.
- Do not inject wrapper-authored system/policy text into outgoing prompt parts in `ChatViewProvider` send paths.
- Do not break the React chat asset contract in `getHtmlContent`: keep `#root`, `chat.js`, and `chat.css` wired together.
- Do not regress implementation-plan wiring by requiring `plan.content` everywhere; the viewer must continue to work from `plan.file` alone.
- Do not emit raw `[BACKGROUND TASK ...]` text for subagents when structured output fields can carry the same state.
- Do not silently trim information density from the chat UI just to simplify layout.

## GIT SAFETY — MANDATORY (ALL AGENTS)
**NEVER run `git restore`, `git checkout -- <file>`, `git clean -f`, or any command that discards working tree changes without EXPLICIT user instruction.**
- This repo is actively worked on by multiple agents across separate sessions. Unstaged changes may be in-progress work from another agent that has not yet been committed or stashed.
- Before ANY git operation that could discard working tree state, run `git status` and `git diff --stat` first. If there are unstaged/untracked changes, STOP and ask the user what to do with them.
- `git restore <file>` permanently destroys unstaged changes with no recovery path. This has caused irreversible loss of feature work in this project.
- The only safe alternatives: `git stash` (preserves changes), or explicit user confirmation that discarding is intentional.

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
npm run verify                    # full verify: check + build + lint + test
npm run dev                       # dev server (simple, no hotreload)
npm run dev:full                  # dev server with hotreload
npm run guard:prepush             # run pre-push guard manually
npm run test:impacted             # run only tests impacted by changed files
npm run typecheck                 # TypeScript type checking without emit
npm run package                   # package .vsix via @vscode/vsce
npm run analyze-logs              # analyze logs (subcommands: :summary, :flows, :errors, :perf)
```

## NOTES
- Child guides exist only where local rules are stronger than this root document: `src/providers/`, `webview/shared/src/chat/`, `tests/`.
- If chat becomes unstyled or inert, verify asset wiring first, then run `npm run webview:build` and `npm run compile`.
- Existing AGENTS guidance had stale paths like `Shell.tsx`; use current filenames such as `ChatShell.tsx` and the provider/html contract instead.
- Knowledge base: `docs/knowledge-base/implementation-plan-contract.md` defines the implementation-plan payload contract and required safeguards.
- Knowledge base: `docs/knowledge-base/activity-timeline-hydration-contract.md` defines streaming vs hydrated activity parity contracts (title/description/label semantics).
