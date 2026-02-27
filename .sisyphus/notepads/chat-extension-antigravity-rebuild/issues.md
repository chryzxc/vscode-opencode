Task 17 issues

- LSP diagnostics showed minor info/warnings (import ordering, node: import suggestions) — not introduced by changes.
- Running top-level `npx tsc --noEmit` errors because root tsconfig expects Node16 module config; project build still succeeds via esbuild.

## [2026-02-26] Task 19 integration audit issues

- Session CRUD wiring mismatch: webview posted `createSession` / `switchSession` while ChatViewProvider only handled `newSession` / `loadSession` aliases, which could block session create/switch from sidebar actions.
- Quota event forwarding mismatch: provider emitted `quotaUpdate` to webview, but Task 19 integration contract requires `quotaData` from extension->webview on quota refresh/update path.
- Image payload shape mismatch on send: webview sent string data URLs while provider image handling expected objects with `dataUrl`; this dropped markdown image parts for model prompts and could desync persisted user-message image shape.
- Root `npx tsc --noEmit` remains blocked by repository tsconfig (`module: commonjs` with `moduleResolution: node16`), independent of Task 19 flow wiring changes.


## [2026-02-26] F1 plan compliance audit issues

- Must Have QA policy not met: no task-*-negative evidence, no Playwright artifacts, and task-8-happy.txt is empty.
- Task 16 TODO panel not integrated: TodoPanel exists in webview/shared/src/chat/PanelComponents.tsx but is not rendered by webview/shared/src/chat/ChatShell.tsx; TODO items are also not session-scoped (no filtering by sessionId).
- Task 13 thinking control not fully wired: thinking level is stored (globalState + webview state) but not used when sending prompts in src/providers/ChatViewProvider.ts.
- Task 7 plan payload bridge is partial: src/providers/PlanViewProvider.ts injects comments: [] and revision: 0 and does not bump revision on comment mutations.
- Guardrail risk / scope creep: package.json scripts and src/services/OpencodeServerManager.ts changed outside the explicit chat/plan file refs in the plan (though some changes may be justifiable).
