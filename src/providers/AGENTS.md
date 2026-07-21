# PROVIDERS KNOWLEDGE BASE

## OVERVIEW
`src/providers/` is the extension-host UI boundary: every file here owns a VS Code-facing contract or a protected user-visible workflow. `ChatViewProvider` delegates internally to 12 modular files in `chat/`.

## STRUCTURE
```text
src/providers/
├── ChatViewProvider.ts        # Main orchestrator (wires all chat/ modules)
├── PlanViewProvider.ts        # Implementation plan viewer webview
├── DiffReviewProvider.ts      # VCS diff review panel
├── SkillsPanelProvider.ts     # Skills management webview
├── ConfigFilesProvider.ts     # Configuration file management
├── StatusBarProvider.ts       # Status bar connection indicator
└── chat/                      # ChatViewProvider modular internals
    ├── index.ts               # Barrel exports
    ├── types.ts               # Shared types for chat modules
    ├── QueueManager.ts        # Send queue with abort/cancel
    ├── StreamEventHandler.ts  # SSE event → webview forwarding
    ├── StructuredOutputProcessor.ts # Structured response handling
    ├── PlanManager.ts         # Plan detection and lifecycle
    ├── SubagentPersistence.ts # Subagent state persistence
    ├── SessionHandler.ts      # Session switch/create/delete
    ├── ModelAndAgentManager.ts # Model/agent list management
    ├── HistoryProcessor.ts    # Chat history loading/processing
    ├── CompactionManager.ts   # History compaction handling
    ├── ErrorBuilder.ts        # Error message construction
    └── DiagnosticsLogger.ts   # Provider-side diagnostics
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Main chat send/receive path | `ChatViewProvider.ts` | Webview protocol, streaming bridge, prompt payload construction |
| Chat module wiring | `ChatViewProvider.ts` → `chat/` | `initializeModules()` / `wireModuleCallbacks()` pattern |
| React host HTML wiring | `ChatViewProvider.ts#getHtmlContent` | Must keep `#root`, `chat.js`, `chat.css` aligned |
| Plan workflow | `PlanViewProvider.ts`, `ChatViewProvider.ts` | Plan detection, open/view flow, persisted plan UX |
| Diff review panel | `DiffReviewProvider.ts` | Session-linked diff inspection UI |
| Skills panel | `SkillsPanelProvider.ts` | Skill management webview host |
| Config files | `ConfigFilesProvider.ts` | Configuration file management host |
| Status indicator | `StatusBarProvider.ts` | Mirrors server availability into status bar |

## CONVENTIONS
- Treat providers as the last safe place to preserve UI/product contracts before data hits the webview.
- Keep message protocol changes symmetrical with `webview/shared/src/chat/lib/messageHandler.ts` and related state types.
- When touching prompt send flow, verify payload stays transport-only: `model`, `agent`, `parts`, optional format fields.
- Provider changes that affect structured output must stay in sync with `src/shared/*` validators and generated webview copies.
- Do not add prompt/content phrase-matching logic to decide behavior; providers should rely on explicit structured fields and declared response types.
- Keep implementation-plan compatibility: `responseType="implementation_plan"` is valid with `plan.file` only (without `plan.content`), and provider normalization/enrichment must preserve that so the `View Plan` flow can open the file.
- Chat modules receive a `postMessage` callback for decoupled webview communication; do not bypass this pattern.
- Message ordering: `chatHistory` MUST be sent to webview BEFORE `initState` on session load.

## ANTI-PATTERNS
- Do not reintroduce wrapper system-prompt injection in `handleSendMessage`, `promptWithStructuredOutput`, or helper calls they use.
- Do not remove plan detection/button hooks or stop-request plumbing during UI or protocol cleanup.
- Do not gate `message.plan` creation on `plan.content` only; filepath-driven plan cards are intentional behavior.
- Do not change host HTML asset wiring without rebuilding the webview and checking the chat mount contract.
- Do not move provider responsibilities into services if they are specifically about webview hosting, VS Code registration, or product-visible contracts.

## VERIFICATION TARGETS
- `tests/system-prompt-and-structured-output-parsing.test.mjs`
- `tests/system-prompt-history-filter.test.mjs`
- `tests/plan-detection.test.mjs`
- `tests/plan-viewer.test.mjs`
- `tests/chat-view-streaming.test.mjs`
- `tests/diff-review.test.mjs`
- `tests/status-bar-provider.test.mjs`

## NOTES
- `ChatViewProvider.ts` is oversized because it centralises multiple contracts; prefer surgical edits over broad refactors unless you can verify the whole send/stream/history surface.
- The root AGENTS file covers repo-wide build/test rules; this file only records provider-local constraints.
- Knowledge base: `docs/knowledge-base/implementation-plan-contract.md` is the canonical provider-facing reference for implementation-plan payload handling.
- Knowledge base: `docs/knowledge-base/activity-timeline-hydration-contract.md` captures provider/webview activity hydration parity requirements.
