# Antigravity-Style Interactive Plan Viewer Redesign

## TL;DR

> **Quick Summary**: Fix the blank Plan viewer tab and redesign `PlanShell.tsx` into an Antigravity IDE-style interactive plan viewer with floating comment popovers, header-placed action buttons, and a proper "Proceed" → attachment chip flow that sends only the word "Proceed" as the chat prompt while attaching the plan as a named chip.
>
> **Deliverables**:
> - `src/providers/PlanViewProvider.ts` — badge.js guard fix (blank tab fix)
> - `webview/shared/src/plan/PlanShell.tsx` — full redesign (markdown rendering, floating popover comments, header buttons)
> - `src/providers/ChatViewProvider.ts` — plan attachment message forwarding
> - `webview/shared/src/chat/lib/messageHandler.ts` — `addPlanAttachment` message type handler
> - `webview/shared/dist/plan.js` — rebuilt artifact
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 2 waves
> **Critical Path**: Task 1 (badge fix) → Task 2 (PlanShell redesign) → Task 3 (attachment wire-up) → Task 4 (build + verify)

---

## Context

### Original Request
User wants the "View Implementation Plan" tab to work like Google Antigravity IDE — a rich interactive plan viewer where:
- The tab is not blank and shows the correct plan title
- Markdown is rendered properly (not as raw `<pre>`)
- Text selection shows a floating popover with a textarea to add an inline comment
- Comments can be deleted from within the popover or the comments panel
- Header has: [Comments(N) badge button] [Proceed button] on the right
- When Proceed is clicked: chat input gets "Proceed" text and a named attachment chip like `📋 Implementation Plan: [goal]` — the full markdown is NOT dumped as the prompt

### Interview Summary
**Key Discussions**:
- Floating popover for comment input (not inline form, not always-visible sidebar)
- Comments panel is hidden by default, opened by a "Comments (N)" button in the header top-right
- Proceed sends `"Proceed"` text + plan as an **attachment chip** (like image attachments) — NOT raw markdown
- The attachment chip should mirror how image attachments work in the input area
- Tab title should equal `plan.goal`

**Research Findings**:
- `dist/badge.js` ✅ exists but is loaded unconditionally — if it ever 404s it may block `plan.js` from running
- `AttachmentItem` type: `{ id, dataUrl, filename, mimeType }` — `dataUrl` is image-oriented but `mimeType` is a freeform string
- Chat input already renders `attachments[]` as `oc-chip oc-chip-removable` chips (lines 921-935 of PanelComponents.tsx)
- `ADD_ATTACHMENT` action already exists in the store
- `handlePlanProceed()` in ChatViewProvider already writes plan to disk and calls `handleSendMessage("Proceed", [planFilePath])` — but doesn't push an attachment chip to the chat input UI
- `marked` library availability is unknown — use simple in-house markdown renderer to avoid new deps, OR check package.json

### Metis Review
**Identified Gaps** (addressed):
- Comment persistence: In-memory only for the session (no disk persistence — simplest correct default)
- AttachmentItem.dataUrl: Store the plan as `data:text/markdown;base64,<content>` — this works in the browser; the chip is visual-only and the actual plan content is in the file path already sent to the AI
- `marked` availability: Executor should check `webview/shared/package.json` first; if absent use a minimal inline markdown renderer (headings, code blocks, bold, italic, lists)
- Large plan size risk: The base64 dataUrl is for the visual chip only; actual AI delivery is via disk file path (already working)
- Multi-proceed: Disable the Proceed button after first click and close panel on proceed

---

## Work Objectives

### Core Objective
Fix the blank plan viewer tab and redesign the interactive plan viewer to feel like Antigravity IDE — rich markdown rendering, inline comment popovers, header action buttons, and proper "Proceed" → attachment chip flow.

### Concrete Deliverables
- Plan viewer tab never shows blank; title equals `plan.goal`
- Markdown renders with headings, code blocks, bold/italic, lists
- Text selection in plan markdown → floating popover with "Add comment" textarea
- Comments panel accessible via header button with badge count
- Proceed button in header top-right: sends "Proceed" + shows plan attachment chip in chat input
- Chat input shows removable `📋 Implementation Plan: [goal]` chip

### Definition of Done
- [ ] Plan viewer opens without blank tab on any plan content
- [ ] Tab title = `plan.goal`
- [ ] Markdown renders (headings, code, lists visible)
- [ ] Select text → floating popover appears with comment textarea
- [ ] Add comment → comment appears in Comments panel
- [ ] Comments(N) header button shows badge count, opens panel on click
- [ ] Proceed button in header → chat input gets "Proceed" text + plan chip
- [ ] Plan chip is removable (×) and shows "📋 Implementation Plan: [goal]"
- [ ] Full markdown is NOT inserted as chat prompt text
- [ ] `npm run webview:build` succeeds
- [ ] Extension activates without errors (no TS compile errors)

### Must Have
- badge.js conditional load (fs.existsSync guard)
- Header layout: Comments button + Proceed button on the right
- Floating popover for comment input (position near the selected text)
- Plan attachment chip in chat input

### Must NOT Have (Guardrails)
- Do NOT remove or alter the StickyHeader token stats, Stop Request button, or View Implementation Plan button in the chat webview (AGENTS.md FORBIDDEN TO REMOVE)
- Do NOT dump the full markdown as the prompt text — only `"Proceed"` is the prompt
- Do NOT add heavy new dependencies without checking what's already in `webview/shared/package.json`
- Do NOT break the React asset contract: `<div id="root">`, `dist/plan.js`, `dist/chat.css` must stay wired in `getHtmlContent`
- Do NOT add comment persistence to disk in this iteration (in-memory only)
- Do NOT rework the chat input system beyond adding the `addPlanAttachment` message handler

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: Unknown (check `package.json` for test scripts)
- **Automated tests**: None required for this iteration
- **Agent-Executed QA**: ALWAYS (mandatory for all tasks)

### QA Policy
Every task has agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — can run in parallel):
├── Task 1: Fix badge.js blank-tab issue in PlanViewProvider.ts [quick]
└── Task 2: Check marked availability + implement markdown renderer util [quick]

Wave 2 (After Wave 1 — sequential core work):
├── Task 3: Redesign PlanShell.tsx (markdown, popover, header, comments panel) [visual-engineering]

Wave 3 (After Task 3):
├── Task 4: Wire Proceed → chat attachment chip (messageHandler + ChatViewProvider) [unspecified-high]

Wave 4 (After all):
├── Task 5: Build webview + verify full flow [quick]
```

### Dependency Matrix
- **1**: — — 3
- **2**: — — 3
- **3**: 1, 2 — 4
- **4**: 3 — 5
- **5**: 4 — —

---

## TODOs

---

- [ ] 1. Fix blank tab: conditional badge.js loading in PlanViewProvider.ts

  **What to do**:
  - Open `src/providers/PlanViewProvider.ts`
  - Add `import * as fs from 'fs';` at the top (after existing imports)
  - In `_getHtmlForWebview()`, find the badge.js script tag injection (line ~176-194)
  - Replace the unconditional `<script nonce="${nonce}" src="${badgeChunkUri}"></script>` with:
    ```ts
    const badgeChunkPath = path.join(this._extensionUri.fsPath, 'webview', 'shared', 'dist', 'badge.js');
    const badgeChunkTag = fs.existsSync(badgeChunkPath)
      ? `<script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.file(badgeChunkPath))}"></script>`
      : '<!-- badge.js not found, skipped -->';
    ```
  - In the returned HTML template string, replace `<script nonce="${nonce}" src="${badgeChunkUri}"></script>` with `${badgeChunkTag}`
  - Also remove the now-unused `badgeChunkUri` variable declaration (the one that calls `webview.asWebviewUri`) — the new code inlines it
  - Verify `this._panel.title` is set from `plan.goal` (it already is on line 152 — confirm it's correct)

  **Must NOT do**:
  - Do NOT remove the plan.js or chat.css script/link tags
  - Do NOT change the CSP header
  - Do NOT touch any other logic in the file

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:
  - `src/providers/PlanViewProvider.ts:175-198` — `_getHtmlForWebview()` badge.js section to modify
  - `src/providers/PlanViewProvider.ts:148-154` — `_update()` where title is set from `plan.goal`

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: badge.js present — plan tab opens successfully
    Tool: Bash
    Preconditions: dist/badge.js exists in webview/shared/dist/
    Steps:
      1. Run: node -e "const fs=require('fs'); console.log(fs.existsSync('webview/shared/dist/badge.js'))"
         Expected: "true"
      2. Read src/providers/PlanViewProvider.ts and verify fs.existsSync guard is present
         Expected: Code contains "fs.existsSync(badgeChunkPath)"
    Expected Result: Guard code present in file
    Evidence: .sisyphus/evidence/task-1-badge-guard.txt

  Scenario: HTML template uses conditional badgeChunkTag variable
    Tool: Bash
    Preconditions: File edited
    Steps:
      1. grep -n "badgeChunkTag" src/providers/PlanViewProvider.ts
         Expected: at least 2 matches (assignment + usage in template)
    Expected Result: Template uses ${badgeChunkTag} not hardcoded src
    Evidence: .sisyphus/evidence/task-1-template-check.txt
  ```

  **Evidence to Capture**:
  - [ ] task-1-badge-guard.txt — grep output confirming guard code

  **Commit**: YES (groups with Task 2)
  - Message: `fix(plan): conditionally load badge.js chunk to prevent blank tab`
  - Files: `src/providers/PlanViewProvider.ts`
  - Pre-commit: `npm run compile` (ensure TypeScript compiles)

---

- [ ] 2. Check marked availability + prepare markdown renderer

  **What to do**:
  - Read `webview/shared/package.json` — check if `marked`, `react-markdown`, `markdown-it`, or similar is already a dependency
  - **If `marked` or `react-markdown` is present**: Plan to import and use it in Task 3. Note the import path.
  - **If NO markdown lib is present**: Create a minimal inline renderer at `webview/shared/src/plan/markdownRenderer.ts` with these rules:
    - `# heading` → `<h1>`, `## heading` → `<h2>`, `### heading` → `<h3>`
    - `**text**` or `__text__` → `<strong>`
    - `*text*` or `_text_` → `<em>`
    - ` ```lang ... ``` ` (fenced code blocks, multiline) → `<pre><code class="lang-X">`
    - `` `inline code` `` → `<code>`
    - `- item` or `* item` → `<ul><li>`
    - `1. item` → `<ol><li>`
    - Blank lines → paragraph breaks
    - Lines not matching → wrapped in `<p>`
    - The renderer returns an HTML string (to be set via `dangerouslySetInnerHTML`)
    - Must NOT execute scripts — sanitize by stripping `<script>` tags from output
  - This file is self-contained and has no external deps

  **Must NOT do**:
  - Do NOT install new npm packages
  - Do NOT use `eval()` or dynamic `new Function()` for rendering
  - Do NOT import react in this utility file

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:
  - `webview/shared/package.json` — check existing deps

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: Renderer converts headings and code blocks
    Tool: Bash
    Preconditions: markdownRenderer.ts created (or marked confirmed present)
    Steps:
      1. If using custom renderer: run a quick node/bun inline test:
         bun -e "import { renderMarkdown } from './webview/shared/src/plan/markdownRenderer'; console.log(renderMarkdown('# Hello\n\`\`\`js\nconst x = 1;\n\`\`\`'))"
         Expected output contains: <h1>Hello</h1> and <pre><code
      2. If using marked: confirm import works in a TS file (no TS errors)
    Expected Result: Renderer outputs valid HTML without script tags
    Evidence: .sisyphus/evidence/task-2-renderer-check.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(plan): add markdown renderer utility for plan content`
  - Files: `webview/shared/src/plan/markdownRenderer.ts` (if created)
  - Pre-commit: N/A (no compile step needed yet)

---

- [ ] 3. Redesign PlanShell.tsx — markdown rendering, floating popover, header layout, comments panel

  **What to do**:
  This is the core UI redesign. Rewrite `webview/shared/src/plan/PlanShell.tsx` with the following structure:

  **Layout**:
  ```
  <div h-screen flex-col>
    <header>
      left: Shield icon + plan.goal title
      right: [Comments(N) badge button] [Proceed button]
    </header>
    <main flex-1 overflow-y-auto px-6 py-4>
      [markdown rendered content — the plan's rawContent]
      [selection highlight markers for commented lines]
    </main>
    <CommentsPanel open={commentsPanelOpen} onClose={...} comments={...} />
    <CommentPopover anchor={popoverAnchor} onAdd={...} onClose={...} />
  </div>
  ```

  **Detailed implementation steps**:

  1. **Remove** the `<aside>` always-visible comments panel
  2. **Remove** the `<footer>` with the Proceed button
  3. **Remove** the inline `pendingAnchor` comment form from the main content area
  4. **Remove** the `Section` wrapper around plan content — display markdown directly in main scroll area

  5. **Header** (right side):
     - Comments button: `<Button variant="outline" size="sm">` with `MessageSquare` icon + badge showing `comments.length`
     - Proceed button: `<Button variant="default" size="sm">` with `Play` icon
     - Both buttons flush right in the header

  6. **Markdown rendering** (in the main area):
     - Use the renderer from Task 2 (either `marked(rawPlan)` or the custom `renderMarkdown(rawPlan)`)
     - Render using `<div ref={planContentRef} dangerouslySetInnerHTML={{ __html: renderedHtml }} className="prose prose-invert text-xs ... select-text cursor-text" />`
     - Add `line-highlight` CSS class to any `<p>`, `<li>`, `<code>` lines that have associated comments (use anchor.startLine to map)

  7. **Floating comment popover** (`CommentPopover` component, defined in the same file):
     - State: `popoverPos: { x: number; y: number } | null` and `pendingAnchor: PlanComment['anchor'] | null`
     - On `mouseup` in the `planContentRef` div: if selection is non-empty and within the div, call `getSelection()`, compute startLine/endLine/selectedText, set `pendingAnchor` and `popoverPos` based on `getBoundingClientRect()` of the selection range
     - The popover renders as a `position: fixed` div at `{ top: popoverPos.y, left: popoverPos.x }` with a slight upward offset (e.g., `top - 10px`)
     - Popover contains:
       - Small label showing the selected text (truncated, max 60 chars)
       - `<Textarea>` for comment text
       - `[Add Comment]` and `[Cancel]` buttons
       - On Add: create comment, call `window.postAddComment()`, clear `pendingAnchor` + `popoverPos`
       - On Cancel: clear `pendingAnchor` + `popoverPos`
       - Close on Escape key or click outside
     - Use `z-50` and VS Code panel background color for the popover card

  8. **Comments panel** (`CommentsPanel` component, defined in the same file or inline):
     - State in parent: `commentsPanelOpen: boolean`
     - Renders as a fixed-position right-side panel (`position: fixed; right: 0; top: 0; bottom: 0; width: 320px`) that slides in/out
     - Header: "Comments" title + close (×) button
     - List of comments: for each comment, show:
       - Quoted selected text (italic, truncated)
       - Comment body
       - Edit button (inline textarea, saves via `window.postUpdateComment()`)
       - Delete button (calls `window.postDeleteComment()`)
     - Empty state: "No comments yet. Highlight text to add one."
     - Use VS Code sidebar background color

  9. **Proceed handler**:
     - On click: `setExecuting(true)`, post `{ type: 'proceedWithPlan', rawPlan, comments }` to the extension (same message as before — existing backend handles it)
     - After posting, close the plan panel: existing `PlanViewProvider` already calls `PlanViewProvider.closeCurrentPanel()` via the backend after executing — this is fine

  10. **Highlighted lines**:
      - For each comment, split the rendered HTML by line and add a yellow highlight marker at `anchor.startLine` — OR simpler: after rendering HTML, walk the DOM with a `useEffect` and add a yellow highlight class to lines containing the anchor's `selectedText`
      - Simplest approach: in the `planContentRef` element, after mount+comments change, use `querySelectorAll` to find text nodes containing the comment's `selectedText` and wrap them in a `<mark class="plan-comment-highlight">`

  **Styles to add** (via inline styles or `className`):
  - `plan-comment-highlight`: `background: rgba(255, 220, 0, 0.25); border-radius: 2px;`
  - Popover card: VS Code panel background, border, shadow, rounded corners
  - Comments panel: slide-in transition (`transform: translateX(0)` when open, `translateX(100%)` when closed)

  **Must NOT do**:
  - Do NOT remove the `useEffect` that listens for `commentsUpdated` messages from the extension
  - Do NOT remove `window.postAddComment`, `postUpdateComment`, `postDeleteComment` globals
  - Do NOT add a `<footer>` — Proceed button is in the header only
  - Do NOT show the `Section` collapsible structure for the main plan content (keep only the Plan Content section as flat markdown)
  - Keep the "Proposed Changes", "Task Checklist", and "Verification Plan" sections BELOW the markdown content (they can remain as collapsible sections)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: needed for popover positioning, slide-in panel, highlight UX

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential after Wave 1)
  - **Blocks**: Task 4
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `webview/shared/src/plan/PlanShell.tsx` — full current file (355 lines) to redesign
  - `webview/shared/src/components/ui/badge.tsx` — Badge component
  - `webview/shared/src/components/ui/button.tsx` — Button component
  - `webview/shared/src/components/ui/textarea.tsx` — Textarea component
  - `webview/shared/src/chat/lib/types.ts:297-302` — `PlanComment` type
  - `webview/shared/src/plan/markdownRenderer.ts` (from Task 2) — markdown utility
  - `webview/shared/src/chat/PanelComponents.tsx:921-935` — reference for how attachment chips look (oc-chip pattern)

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: Plan viewer renders markdown (not raw pre tag)
    Tool: Bash (grep/read the built plan.js or the source)
    Preconditions: PlanShell.tsx saved
    Steps:
      1. grep -n "dangerouslySetInnerHTML\|renderMarkdown\|marked(" webview/shared/src/plan/PlanShell.tsx
         Expected: at least 1 match showing HTML rendering approach
      2. grep -n "<pre ref=" webview/shared/src/plan/PlanShell.tsx
         Expected: 0 matches (old raw pre tag removed)
    Expected Result: Markdown rendered via HTML, not raw pre
    Evidence: .sisyphus/evidence/task-3-markdown-render.txt

  Scenario: Header has Comments and Proceed buttons
    Tool: Bash
    Preconditions: PlanShell.tsx saved
    Steps:
      1. grep -n "commentsPanelOpen\|Comments\|Proceed\|handleProceed" webview/shared/src/plan/PlanShell.tsx
         Expected: "commentsPanelOpen" state, Comments button, Proceed button — all in header section
    Expected Result: Both buttons exist in header (not footer)
    Evidence: .sisyphus/evidence/task-3-header-buttons.txt

  Scenario: Popover appears on text selection (source-level check)
    Tool: Bash
    Preconditions: PlanShell.tsx saved
    Steps:
      1. grep -n "popoverPos\|getBoundingClientRect\|position.*fixed\|CommentPopover" webview/shared/src/plan/PlanShell.tsx
         Expected: popoverPos state and getBoundingClientRect call present
    Expected Result: Floating popover logic exists
    Evidence: .sisyphus/evidence/task-3-popover-logic.txt

  Scenario: Comments panel is hidden by default (not visible on load)
    Tool: Bash
    Preconditions: PlanShell.tsx saved
    Steps:
      1. grep -n "commentsPanelOpen.*false\|useState.*false" webview/shared/src/plan/PlanShell.tsx | head -5
         Expected: commentsPanelOpen initialized to false
    Expected Result: Panel hidden by default
    Evidence: .sisyphus/evidence/task-3-panel-hidden.txt
  ```

  **Commit**: YES (independent commit)
  - Message: `feat(plan): redesign PlanShell with markdown rendering, floating popover comments, and header action buttons`
  - Files: `webview/shared/src/plan/PlanShell.tsx`, `webview/shared/src/plan/markdownRenderer.ts` (if created)
  - Pre-commit: none (build happens in Task 5)

---

- [ ] 4. Wire Proceed → plan attachment chip in chat input

  **What to do**:
  This task enables the chat input to show a named `📋 Implementation Plan` chip when Proceed is clicked.

  **Part A — `src/providers/ChatViewProvider.ts`** (method `handlePlanProceed`, lines ~1661-1690):
  - After writing the plan file and calling `handleSendMessage("Proceed", [planFilePath])`, also post a message to the chat webview to add an attachment chip:
    ```ts
    // Build a dataUrl from the plan content for the chip (visual only)
    const planBase64 = Buffer.from(updatedPlanMd, 'utf-8').toString('base64');
    const dataUrl = `data:text/markdown;base64,${planBase64}`;
    const planGoal = payload?.goal ?? 'Implementation Plan';
    this.view?.webview.postMessage({
      type: 'addPlanAttachment',
      payload: {
        id: crypto.randomUUID ? crypto.randomUUID() : `plan-${Date.now()}`,
        filename: `📋 Implementation Plan: ${planGoal}`,
        mimeType: 'text/markdown',
        dataUrl,
      }
    });
    ```
  - Note: `payload.goal` may not be available yet — check if `handlePlanProceed` has access to the goal. If not, extract it from `rawPlan` by parsing the first `# ` heading line: `const planGoal = rawPlan.match(/^#\s+(.+)/m)?.[1]?.trim() ?? 'Implementation Plan';`
  - The `this.view?.webview.postMessage` line should already be available; check how other messages are posted to the chat webview in ChatViewProvider (e.g., search for `postMessage` calls to `this.view?.webview`)

  **Part B — `webview/shared/src/chat/lib/messageHandler.ts`**:
  - Find the `createMessageHandler` function (the main switch/if block handling message types)
  - Add a new case for `addPlanAttachment`:
    ```ts
    case 'addPlanAttachment': {
      const p = asRecord(data.payload);
      if (!p) break;
      dispatch({
        type: 'ADD_ATTACHMENT',
        payload: {
          id: asString(p.id) || crypto.randomUUID(),
          filename: asString(p.filename, 'Implementation Plan'),
          mimeType: asString(p.mimeType, 'text/markdown'),
          dataUrl: asString(p.dataUrl),
        }
      });
      break;
    }
    ```
  - Existing helper functions `asRecord`, `asString` are already defined at the top of this file (lines 20-30)

  **Part C — `webview/shared/src/chat/PanelComponents.tsx`** (optional enhancement):
  - The existing chip renderer (lines 921-935) already renders `a.filename` and a remove button
  - Verify the chip correctly shows the full filename including the emoji and plan goal
  - If the chip truncates at 140px (`max-w-[140px]`), that is acceptable — the emoji + "Implementation Plan" will be visible

  **Must NOT do**:
  - Do NOT change the `handleSendMessage("Proceed", [planFilePath])` call — keep it (that's what delivers the plan to the AI)
  - Do NOT modify the `AttachmentItem` type interface (the shape already works with `mimeType: 'text/markdown'`)
  - Do NOT add a new Redux action type — reuse existing `ADD_ATTACHMENT`
  - Do NOT remove the `CLEAR_ATTACHMENTS` dispatch that fires after send (it should clear the plan chip too, which is correct)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Task 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 3

  **References**:
  - `src/providers/ChatViewProvider.ts:1661-1690` — `handlePlanProceed()` to modify
  - `webview/shared/src/chat/lib/messageHandler.ts:1-80` — helper functions (`asRecord`, `asString`) and structure
  - `webview/shared/src/chat/lib/store.ts:122-124` — `ADD_ATTACHMENT`, `REMOVE_ATTACHMENT`, `CLEAR_ATTACHMENTS` actions
  - `webview/shared/src/chat/PanelComponents.tsx:920-935` — existing chip render (confirm filename display)
  - `webview/shared/src/chat/lib/types.ts:279-284` — `AttachmentItem` interface

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: messageHandler handles addPlanAttachment message
    Tool: Bash
    Preconditions: messageHandler.ts modified
    Steps:
      1. grep -n "addPlanAttachment" webview/shared/src/chat/lib/messageHandler.ts
         Expected: at least 1 match in the handler switch/if block
    Expected Result: Handler dispatches ADD_ATTACHMENT
    Evidence: .sisyphus/evidence/task-4-handler.txt

  Scenario: ChatViewProvider posts addPlanAttachment after Proceed
    Tool: Bash
    Preconditions: ChatViewProvider.ts modified
    Steps:
      1. grep -n "addPlanAttachment\|text/markdown" src/providers/ChatViewProvider.ts
         Expected: at least 1 match in handlePlanProceed method
    Expected Result: Provider sends attachment message to chat webview
    Evidence: .sisyphus/evidence/task-4-provider.txt

  Scenario: Attachment chip label includes plan goal (not just "plan.md")
    Tool: Bash
    Preconditions: ChatViewProvider.ts modified
    Steps:
      1. grep -n "Implementation Plan\|planGoal\|📋" src/providers/ChatViewProvider.ts
         Expected: filename includes "Implementation Plan" and the goal variable
    Expected Result: Chip label is human-readable, not a file path
    Evidence: .sisyphus/evidence/task-4-chip-label.txt
  ```

  **Commit**: YES (independent commit)
  - Message: `feat(plan): wire Proceed to inject plan attachment chip into chat input`
  - Files: `src/providers/ChatViewProvider.ts`, `webview/shared/src/chat/lib/messageHandler.ts`
  - Pre-commit: `npm run compile` (TypeScript check)

---

- [ ] 5. Build webview, compile extension, and run full verification

  **What to do**:
  1. Run `npm run webview:build` from the `webview/shared/` directory to rebuild `dist/plan.js` and `dist/chat.js`
  2. Run `npm run compile` from the root extension directory to compile TypeScript
  3. Fix any TypeScript or build errors that arise
  4. Verify the key invariants from AGENTS.md:
     - `getHtmlContent` in `ChatViewProvider.ts` includes `<div id="root"></div>`
     - `getHtmlContent` includes `<script src=".../webview/shared/dist/chat.js"></script>`
     - `getHtmlContent` includes `<link href=".../webview/shared/dist/chat.css" rel="stylesheet">`
  5. Verify `PlanViewProvider._getHtmlForWebview()` has:
     - `<div id="root"></div>`
     - `<script ... src="${scriptUri}">` (plan.js)
     - `<link ... href="${stylesUri}">` (chat.css)
  6. Confirm `dist/plan.js` was updated (check file timestamp)

  **Must NOT do**:
  - Do NOT change any HTML structure in `getHtmlContent`
  - Do NOT skip fixing TypeScript errors — all must be resolved

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (final)
  - **Blocks**: Nothing
  - **Blocked By**: Task 4

  **References**:
  - `AGENTS.md` — React Chat Asset Contract (required invariants)
  - `webview/shared/package.json` — check build script name
  - `src/providers/ChatViewProvider.ts` — `getHtmlContent` method for invariant verification

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: webview build succeeds
    Tool: Bash
    Preconditions: All source files modified
    Steps:
      1. Run: cd webview/shared && npm run build (or the correct build script)
         Expected: Exit code 0, no errors
      2. ls webview/shared/dist/plan.js
         Expected: File exists, timestamp is recent (today)
    Expected Result: plan.js built successfully
    Evidence: .sisyphus/evidence/task-5-build.txt

  Scenario: TypeScript compile succeeds
    Tool: Bash
    Preconditions: Source files modified
    Steps:
      1. Run: npm run compile (from root)
         Expected: Exit code 0, no TS errors
    Expected Result: Extension compiles cleanly
    Evidence: .sisyphus/evidence/task-5-compile.txt

  Scenario: React asset contract invariants present
    Tool: Bash
    Preconditions: Build complete
    Steps:
      1. grep -n 'id="root"' src/providers/ChatViewProvider.ts | head -3
         Expected: at least 1 match
      2. grep -n 'dist/chat.js\|dist/chat.css' src/providers/ChatViewProvider.ts | head -5
         Expected: both chat.js and chat.css referenced
    Expected Result: Asset contract intact
    Evidence: .sisyphus/evidence/task-5-contract.txt
  ```

  **Commit**: YES (final commit)
  - Message: `build: rebuild webview dist artifacts after plan viewer redesign`
  - Files: `webview/shared/dist/plan.js`, `webview/shared/dist/chat.js` (if changed)
  - Pre-commit: N/A (build IS the pre-step)

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read plan end-to-end. Verify: blank tab is fixed (fs.existsSync guard present), tab title set from plan.goal, markdown rendered (no raw `<pre>` for plan content), floating popover logic present, header has Comments + Proceed buttons, comments panel hidden by default, Proceed posts `proceedWithPlan` message, `addPlanAttachment` handler in messageHandler.ts, ChatViewProvider sends `addPlanAttachment` after proceed. Check all "Must NOT Have" items.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **TypeScript & Build Quality** — `quick`
  Run `npm run compile` + `npm run webview:build`. Check for: any TypeScript errors, unused imports, console.log left in production code, any `as any` casts introduced.
  Output: `Compile [PASS/FAIL] | Build [PASS/FAIL] | VERDICT`

- [ ] F3. **Scope Fidelity** — `unspecified-high`
  For each task's "What to do" vs actual git diff: verify nothing outside scope was touched. Specifically: chat webview layout not broken, StickyHeader still present, attachment chip renders existing images fine (no regression), no new npm packages added to package.json.
  Output: `Tasks [N/N compliant] | No regressions | VERDICT`

---

## Commit Strategy

1. `fix(plan): conditionally load badge.js chunk to prevent blank tab` — PlanViewProvider.ts
2. `feat(plan): add markdown renderer utility for plan content` — markdownRenderer.ts (if created)
3. `feat(plan): redesign PlanShell with markdown rendering, floating popover comments, and header action buttons` — PlanShell.tsx
4. `feat(plan): wire Proceed to inject plan attachment chip into chat input` — ChatViewProvider.ts, messageHandler.ts
5. `build: rebuild webview dist artifacts after plan viewer redesign` — dist/

---

## Success Criteria

### Verification Commands
```bash
# Build check
cd webview/shared && npm run build        # Expected: exit 0
cd ../.. && npm run compile               # Expected: exit 0

# File existence checks
ls webview/shared/dist/plan.js            # Expected: file exists

# Key code checks
grep -n "fs.existsSync" src/providers/PlanViewProvider.ts             # Expected: 1+ match
grep -n "addPlanAttachment" src/providers/ChatViewProvider.ts         # Expected: 1+ match
grep -n "addPlanAttachment" webview/shared/src/chat/lib/messageHandler.ts  # Expected: 1+ match
grep -c "<pre ref=" webview/shared/src/plan/PlanShell.tsx             # Expected: 0
grep -n "dangerouslySetInnerHTML\|renderMarkdown\|marked(" webview/shared/src/plan/PlanShell.tsx  # Expected: 1+ match
grep -n "commentsPanelOpen" webview/shared/src/plan/PlanShell.tsx     # Expected: 1+ match
grep -n "popoverPos\|getBoundingClientRect" webview/shared/src/plan/PlanShell.tsx  # Expected: 1+ match
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent (especially: full markdown NOT dumped as prompt, StickyHeader intact)
- [ ] Builds pass (webview:build + compile)
- [ ] No new npm packages added
