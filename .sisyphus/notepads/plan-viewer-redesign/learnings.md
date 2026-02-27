# Plan Viewer Redesign — Notepad

## Learnings
_Append findings here as tasks complete_

## [2026-02-27] Session ses_360daca92ffea5x0v0rAmHXBnm — Initial Setup
- Plan: plan-viewer-redesign (5 tasks, 4 waves)
- Active file: E:\Projects\vscode-opencode\.sisyphus\plans\plan-viewer-redesign.md

### Key File Locations
- PlanViewProvider: src/providers/PlanViewProvider.ts (208 lines)
- PlanShell: webview/shared/src/plan/PlanShell.tsx (355 lines)
- ChatViewProvider: src/providers/ChatViewProvider.ts (~2437 lines)
- messageHandler: webview/shared/src/chat/lib/messageHandler.ts
- PanelComponents: webview/shared/src/chat/PanelComponents.tsx (attachment chips at lines 921-935)
- Vite config: webview/shared/vite.config.ts (builds plan.js, chat.js, diff-review.js)
- dist: webview/shared/dist/ (badge.js, chat.css, chat.js, plan.js — all present)

### Architecture Facts
- PlanViewProvider._getHtmlForWebview() injects window.__PLAN_DATA__ with { raw, parsed, comments, revision }
- badge.js is loaded UNCONDITIONALLY — if it 404s, may block plan.js script execution
- AttachmentItem type: { id, dataUrl, filename, mimeType } — dataUrl is for images but mimeType is freeform
- ADD_ATTACHMENT / REMOVE_ATTACHMENT / CLEAR_ATTACHMENTS actions already in store
- Attachment chips render via oc-chip oc-chip-removable class in PanelComponents.tsx
- handlePlanProceed() in ChatViewProvider already: writes plan to disk, calls handleSendMessage("Proceed", [planFilePath])
- BUT: does NOT post addPlanAttachment message to chat webview — chip is missing from UI

### Constraints
- FORBIDDEN TO REMOVE: StickyHeader token stats, View Implementation Plan button, Stop Request button
- React asset contract: <div id="root">, dist/plan.js, dist/chat.css MUST stay in getHtmlContent
- Do NOT dump full markdown as prompt — only "Proceed" text
- Do NOT add new npm packages without checking package.json first
- Comments: in-memory only (no disk persistence)
[2026-02-27] Badge guard added to PlanViewProvider.ts
- Added fs.existsSync guard to conditionally inject badge.js to prevent 404 blocking plan.js
- Kept plan.js and chat.css inclusion unchanged as required
- Verified build: npm run compile -> exit 0
- Verified grep: src/providers/PlanViewProvider.ts contains badgeChunkTag and fs.existsSync

### [2026-02-27] Action: markdown renderer
- Checked webview/shared/package.json: found dependency "marked": "^17.0.3" (so a markdown library is present).
- Created webview/shared/src/plan/markdownRenderer.ts as a thin wrapper that imports { marked } from 'marked' and exports renderMarkdown(markdown: string): string.
- Reason: Task requires creating renderer; package.json already contains 'marked' so wrapper satisfies requirement and avoids adding new packages.
- Next: PlanShell will import this renderer in a later task (Task 3). If 'marked' is later removed, replace with pure-TS renderer implementing the project's markdown subset and XSS stripping.


### [2026-02-27] Tasks 3–5 Complete — Full Plan Viewer Redesign
- **Task 3**: Rewrote webview/shared/src/plan/PlanShell.tsx (479 lines) — Antigravity-style:
  - Markdown rendered via `renderMarkdown(rawPlan)` + `dangerouslySetInnerHTML` in a `<div ref>` (no `<pre ref>`)
  - Header: Shield icon + plan.goal left, [Comments(N)] [Proceed] buttons right
  - Floating comment popover: `position: fixed`, appears on text selection with getBoundingClientRect
  - Comments panel: `position: fixed; right:0`, slides in via `translateX` transition, hidden by default
  - All existing useEffects preserved (commentsUpdated, postAddComment globals, __pendingPlanAnchor sync)
  - Collapsible sections (Proposed Changes, Task Checklist, Verification Plan) preserved below markdown
  - No `<footer>` element — Proceed is in `<header>`
- **Task 4**: Wired Proceed → attachment chip:
  - messageHandler.ts: added `case 'addPlanAttachment'` that dispatches ADD_ATTACHMENT to Redux store
  - ChatViewProvider.ts: after handleSendMessage('Proceed'), posts addPlanAttachment message to chat webview
  - Chip filename: `📋 Implementation Plan: {planGoal}` (goal extracted from first `# ` heading)
  - dataUrl: base64-encoded plan markdown (`data:text/markdown;base64,...`)
- **Task 5**: Build + compile — both pass exit 0:
  - `npm run build` (webview): produced plan.js (23.49 kB), chat.js (160.28 kB), all artifacts
  - `npm run compile` (extension): exit 0
  - React asset contract intact: `<div id="root">`, chat.js, chat.css all present in ChatViewProvider
  - `<pre ref=` count in PlanShell.tsx: 0 ✅
  - fs.existsSync guard in PlanViewProvider.ts: present ✅
  - addPlanAttachment: present in both ChatViewProvider and messageHandler ✅