# Chat Extension Rebuild with Antigravity Plan Reviewer

## TL;DR

> **Quick Summary**: Rebuild the OpenCode VS Code chat experience to full Copilot/Claude-style parity while adding Antigravity-style interactive implementation plan review (inline comments + side panel + proceed with updated plan attachment).
>
> **Deliverables**:
> - Responsive 3-panel chat UX (left sessions, middle conversation, right extended panel with mobile fallback)
> - Interactive plan review tab with text selection comments and editable comments sidebar
> - Proceed flow that posts literal `Proceed` plus updated plan attachment back into chat
> - Composer controls (model/agent/thinking), image attachment UX, thread attachment rendering
> - Event-driven TODO panel and quota monitor hardening (OpenCode, Copilot, Z.ai)
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves + Final Verification
> **Critical Path**: 5 -> 6 -> 7 -> 11 -> 19

---

## Context

### Original Request
Rebuild the extension features lost after reset, keep functionality comparable to major chat extensions, and add Google Antigravity-style implementation plan review workflow with comments and proceed handoff.

### Interview Summary
**Key Discussions**:
- Existing codebase already contains substantial chat, session, quota, and plan-view foundations.
- Core protected features from `AGENTS.md` must remain visible and functional.
- The net-new/high-priority delta is interactive plan comments and proceed-with-updated-plan behavior.
- UI must use shadcn components consistently.

**Research Findings**:
- Chat pipeline and React shell exist: `src/providers/ChatViewProvider.ts`, `webview/shared/src/chat/*`.
- Plan opening flow exists: `enrichMessageWithPlan` and `viewPlan` button in chat messages.
- Plan webview exists: `src/providers/PlanViewProvider.ts`, `webview/shared/src/plan/PlanShell.tsx`.
- Session CRUD persistence exists: `src/services/SessionService.ts`.
- Quota service exists with multi-provider fetch paths: `src/services/QuotaService.ts`.
- Message/event stream pipeline exists: `src/services/MessageStreamService.ts` and chat `messageHandler.ts`.

### Metis Review
**Identified Gaps (addressed)**:
- Remove stale assumptions before execution (some providerName and stats logic already partially fixed).
- Lock exact file paths (`webview/shared/src/*`, not legacy aliases) to avoid wrong-target edits.
- Add explicit acceptance criteria for fallback behaviors (missing provider labels, missing quota provider data, empty comments).
- Require verify-first checks for tasks at risk of becoming no-op due already-restored code.

---

## Work Objectives

### Core Objective
Deliver a stable, production-grade VS Code chat extension experience with Antigravity-style plan review and proceed workflow, while preserving all OpenCode core feature guarantees.

### Concrete Deliverables
- Upgraded `ChatShell`/panels for 3-section responsive behavior.
- Interactive plan comments system in plan webview.
- Proceed prompt pipeline that attaches revised plan markdown to new user message.
- Full composer controls and image attachment flow wired to OpenCode SDK prompt parts.
- Extended right panel with TODO events and quota monitor reliability safeguards.

### Definition of Done
- [ ] Plan button appears for implementation responses and opens plan tab.
- [ ] User can select text in plan markdown, add/edit/delete comments, and see synchronized side panel.
- [ ] Clicking `Proceed` inserts a new user prompt `Proceed` with updated plan attached.
- [ ] Desktop and mobile responsive panel behavior matches requested rules.
- [ ] Model/agent/thinking controls, sessions/history, attachments, quota monitor, and TODO panel all function.
- [ ] Core protected features remain intact (sticky token/session stats, view implementation plan, stop request).

### Must Have
- Preserve core feature invariants and React webview asset contract.
- Agent-executable QA for every task (happy path + failure path).
- shadcn component consistency for new and modified UI.

### Must NOT Have (Guardrails)
- No removal/hidden state for protected plan button, sticky stats, stop request features.
- No undocumented scraping-only dependency for provider quota paths without fallback.
- No human-only verification criteria.
- No scope expansion into unrelated refactors outside chat/plan workflow.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — all checks are agent-executed with commands/tools and evidence files.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (tests-after)
- **Framework**: Existing project build/typecheck + targeted tests where available
- **Agent-Executed QA**: ALWAYS

### QA Policy
- Frontend/UI: Playwright scenarios with selectors/assertions/screenshots.
- Extension/bridge/API: Bash command assertions and structured output checks.
- Evidence path convention: `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation + contracts, can start immediately):
├── Task 1: Core invariant audit + guardrail assertions [unspecified-high]
├── Task 2: 3-panel responsive shell scaffolding [visual-engineering]
├── Task 3: Left sessions panel behavior parity [quick]
├── Task 4: Right extended panel + mobile floating summary [visual-engineering]
├── Task 5: Shared state/type extensions for comments/attachments/thinking/todo [quick]
└── Task 6: Provider-webview message contract extensions [unspecified-high]

Wave 2 (Plan review system, max parallel after Wave 1):
├── Task 7: PlanViewProvider structured bridge for editable plans [unspecified-high]
├── Task 8: Plan markdown selection mapping and anchor model [deep]
├── Task 9: Selection popover + add-comment UX [visual-engineering]
├── Task 10: Right comments panel edit/delete/sync [visual-engineering]
├── Task 11: Proceed flow: prompt="Proceed" + updated plan attachment [deep]
└── Task 12: Chat plan summary + button detection hardening [quick]

Wave 3 (Composer, attachments, right-panel data):
├── Task 13: Model/agent/thinking controls SDK wiring [unspecified-high]
├── Task 14: Image paste/preview/remove/send pipeline [unspecified-high]
├── Task 15: Thread attachment rendering + prompt visibility guarantees [quick]
├── Task 16: TODO events panel integration from stream events [deep]
└── Task 17: Quota monitor hardening (OpenCode/Copilot/Z.ai + fallback) [unspecified-high]

Wave 4 (Polish + integration verification):
├── Task 18: Session/history UX polish (names/time/delete/new) [quick]
├── Task 19: End-to-end responsive and workflow QA fixes [unspecified-high]
└── Task 20: shadcn consistency + accessibility/keyboard pass [visual-engineering]

Wave FINAL (After ALL tasks — independent review, parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Automated integration QA replay (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: 5 -> 6 -> 7 -> 11 -> 19
Parallel Speedup: ~65% versus sequential
Max Concurrent: 6
```

### Dependency Matrix

- **1**: blocked_by none -> blocks 19,20
- **2**: blocked_by none -> blocks 19,20
- **3**: blocked_by 2 -> blocks 18,19
- **4**: blocked_by 2 -> blocks 16,17,19
- **5**: blocked_by none -> blocks 6,8,13,14,16
- **6**: blocked_by 5 -> blocks 7,11,13,14,15,16,17
- **7**: blocked_by 6 -> blocks 8,9,10,11
- **8**: blocked_by 5,7 -> blocks 9,10,11
- **9**: blocked_by 7,8 -> blocks 19
- **10**: blocked_by 7,8 -> blocks 19
- **11**: blocked_by 6,7,8,10 -> blocks 12,19
- **12**: blocked_by 11 -> blocks 19
- **13**: blocked_by 5,6 -> blocks 19
- **14**: blocked_by 5,6 -> blocks 15,19
- **15**: blocked_by 6,14 -> blocks 19
- **16**: blocked_by 4,5,6 -> blocks 19
- **17**: blocked_by 4,6 -> blocks 19
- **18**: blocked_by 3 -> blocks 19
- **19**: blocked_by 1,2,3,4,9,10,11,12,13,14,15,16,17,18 -> blocks 20,F1-F4
- **20**: blocked_by 1,2,19 -> blocks F1-F4
- **F1-F4**: blocked_by 19,20 -> blocks none

### Agent Dispatch Summary

- **Wave 1**: 6 tasks - T1 `unspecified-high`, T2 `visual-engineering`, T3 `quick`, T4 `visual-engineering`, T5 `quick`, T6 `unspecified-high`
- **Wave 2**: 6 tasks - T7 `unspecified-high`, T8 `deep`, T9 `visual-engineering`, T10 `visual-engineering`, T11 `deep`, T12 `quick`
- **Wave 3**: 5 tasks - T13 `unspecified-high`, T14 `unspecified-high`, T15 `quick`, T16 `deep`, T17 `unspecified-high`
- **Wave 4**: 3 tasks - T18 `quick`, T19 `unspecified-high`, T20 `visual-engineering`
- **FINAL**: 4 tasks - F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs
- [ ] 1. Core invariants audit; refs: `AGENTS.md`, `src/providers/ChatViewProvider.ts`, `webview/shared/src/chat/MessageComponents.tsx`; wave:1; cat:`unspecified-high`; blocks:19,20.
  **What to do**: verify protected features and add regression checks for plan button, sticky stats, stop request.
  **Must NOT do**: remove/hide protected controls.
  **Acceptance Criteria**: protected controls present; no regressions.
  **QA Scenarios**:
  ```
  Happy: Playwright checks sticky stats + plan button + stop button -> .sisyphus/evidence/task-1-happy.png
  Negative: abort long stream; assert no deadlock -> .sisyphus/evidence/task-1-negative.png
  ```
  **Commit**: YES (`chore(chat): lock protected feature invariants`)

- [ ] 2. 3-panel shell scaffolding; refs: `webview/shared/src/chat/ChatShell.tsx`; wave:1; cat:`visual-engineering`; blocks:3,4,19,20.
  **What to do**: implement explicit left/middle/right structure with desktop-first behavior.
  **Must NOT do**: break message rendering hooks.
  **Acceptance Criteria**: desktop shows 3 sections; no overflow regressions.
  **QA Scenarios**:
  ```
  Happy: desktop viewport shows 3 sections -> .sisyphus/evidence/task-2-happy.png
  Negative: small viewport has no horizontal overflow -> .sisyphus/evidence/task-2-negative.png
  ```
  **Commit**: YES (`feat(chat): scaffold responsive three-panel shell`)

- [ ] 3. Left sessions panel parity; refs: `webview/shared/src/chat/PanelComponents.tsx`, `src/services/SessionService.ts`; wave:1; cat:`quick`; blocked_by:2; blocks:18,19.
  **What to do**: preserve create/delete/switch with title/time display and hamburger behavior.
  **Must NOT do**: alter session API contracts.
  **Acceptance Criteria**: CRUD works and state persists.
  **QA Scenarios**:
  ```
  Happy: create/switch/delete session cycle -> .sisyphus/evidence/task-3-happy.png
  Negative: deleting active session auto-recovers -> .sisyphus/evidence/task-3-negative.png
  ```
  **Commit**: YES (`feat(chat): restore left session panel parity`)

- [ ] 4. Right panel + mobile floating summary; refs: `webview/shared/src/chat/ChatShell.tsx`, `webview/shared/src/chat/PanelComponents.tsx`; wave:1; cat:`visual-engineering`; blocked_by:2; blocks:16,17,19.
  **What to do**: desktop persistent right panel; small screens show floating top summary card.
  **Must NOT do**: duplicate right-panel state sources.
  **Acceptance Criteria**: behavior matches requested responsive rules.
  **QA Scenarios**:
  ```
  Happy: desktop right panel visible -> .sisyphus/evidence/task-4-happy.png
  Negative: mobile shows floating summary instead of full panel -> .sisyphus/evidence/task-4-negative.png
  ```
  **Commit**: YES (`feat(chat): add right-panel mobile fallback`)

- [ ] 5. State/type extensions (comments/attachments/thinking/todo); refs: `webview/shared/src/chat/lib/types.ts`, `webview/shared/src/chat/lib/store.ts`; wave:1; cat:`quick`; blocks:6,8,13,14,16.
  **What to do**: add new state fields/actions with backward-safe defaults.
  **Must NOT do**: require blocking migration.
  **Acceptance Criteria**: typecheck passes; legacy sessions still load.
  **QA Scenarios**:
  ```
  Happy: `npx tsc --noEmit` passes -> .sisyphus/evidence/task-5-happy.txt
  Negative: load old session data and verify no crash -> .sisyphus/evidence/task-5-negative.png
  ```
  **Commit**: YES (`refactor(state): extend shared chat and plan state`)

- [ ] 6. Provider-webview contract extensions; refs: `src/providers/ChatViewProvider.ts`, `webview/shared/src/chat/lib/messageHandler.ts`; wave:1; cat:`unspecified-high`; blocked_by:5; blocks:7,11,13,14,15,16,17.
  **What to do**: add message types for plan comments/proceed/thinking/attachments/todo updates.
  **Must NOT do**: break existing message types.
  **Acceptance Criteria**: round-trip works; unknown events safely ignored.
  **QA Scenarios**:
  ```
  Happy: send each new message type and verify handling -> .sisyphus/evidence/task-6-happy.txt
  Negative: inject unknown type and confirm no crash -> .sisyphus/evidence/task-6-negative.png
  ```
  **Commit**: YES (`feat(chat): extend provider-webview contract`)

- [ ] 7. PlanViewProvider structured bridge; refs: `src/providers/PlanViewProvider.ts`, `src/services/PlanParser.ts`; wave:2; cat:`unspecified-high`; blocked_by:6; blocks:8,9,10,11.
  **What to do**: provide editable plan payload (raw + parsed + comments + revision metadata).
  **Must NOT do**: loosen CSP.
  **Acceptance Criteria**: plan webview gets structured payload and mutation channel.
  **QA Scenarios**:
  ```
  Happy: open plan tab and verify payload keys -> .sisyphus/evidence/task-7-happy.txt
  Negative: confirm no CSP console violations -> .sisyphus/evidence/task-7-negative.png
  ```
  **Commit**: YES (`feat(plan): add structured payload bridge`)

- [ ] 8. Markdown selection anchor model; refs: `webview/shared/src/plan/PlanShell.tsx`; wave:2; cat:`deep`; blocked_by:5,7; blocks:9,10,11.
  **What to do**: map selections to stable line/range anchors.
  **Must NOT do**: rely on pixel offsets only.
  **Acceptance Criteria**: deterministic anchor metadata; empty selections rejected.
  **QA Scenarios**:
  ```
  Happy: select text and create anchor -> .sisyphus/evidence/task-8-happy.png
  Negative: empty selection blocked -> .sisyphus/evidence/task-8-negative.png
  ```
  **Commit**: YES (`feat(plan): implement selection anchor model`)

- [ ] 9. Selection popover add-comment UX; refs: `webview/shared/src/plan/PlanShell.tsx`; wave:2; cat:`visual-engineering`; blocked_by:7,8; blocks:19.
  **What to do**: show `Add comments` popover and submit/cancel flow.
  **Must NOT do**: popover on zero-length selections.
  **Acceptance Criteria**: comments created from valid selection.
  **QA Scenarios**:
  ```
  Happy: create comment via popover -> .sisyphus/evidence/task-9-happy.png
  Negative: cancel leaves no comment -> .sisyphus/evidence/task-9-negative.png
  ```
  **Commit**: YES (`feat(plan): add selection popover comment entry`)

- [ ] 10. Right comments panel edit/delete; refs: `webview/shared/src/plan/PlanShell.tsx`; wave:2; cat:`visual-engineering`; blocked_by:7,8; blocks:11,19.
  **What to do**: implement editable synchronized comments side panel.
  **Must NOT do**: desync anchor/panel state.
  **Acceptance Criteria**: edit/delete works; anchor focus sync works.
  **QA Scenarios**:
  ```
  Happy: edit/delete comment in side panel -> .sisyphus/evidence/task-10-happy.png
  Negative: orphan anchor handled safely -> .sisyphus/evidence/task-10-negative.png
  ```
  **Commit**: YES (`feat(plan): add editable comments side panel`)

- [ ] 11. Proceed flow with updated plan attachment; refs: `webview/shared/src/plan/PlanShell.tsx`, `src/providers/PlanViewProvider.ts`, `src/providers/ChatViewProvider.ts`; wave:2; cat:`deep`; blocked_by:6,7,8,10; blocks:12,19.
  **What to do**: send literal `Proceed` prompt plus updated plan payload attachment.
  **Must NOT do**: send stale revision.
  **Acceptance Criteria**: new user prompt is `Proceed`; attachment contains latest edits.
  **QA Scenarios**:
  ```
  Happy: proceed creates prompt+attachment -> .sisyphus/evidence/task-11-happy.png
  Negative: last-second edit appears in payload -> .sisyphus/evidence/task-11-negative.png
  ```
  **Commit**: YES (`feat(plan): proceed with updated plan attachment`)

- [ ] 12. Plan summary/button detection hardening; refs: `src/providers/ChatViewProvider.ts`, `webview/shared/src/chat/MessageComponents.tsx`; wave:2; cat:`quick`; blocked_by:11; blocks:19.
  **What to do**: keep compact plan summary + button/card rendering robust.
  **Must NOT do**: rename/remove core button behavior.
  **Acceptance Criteria**: plan responses show button; non-plan responses do not.
  **QA Scenarios**:
  ```
  Happy: implementation response shows view-plan actions -> .sisyphus/evidence/task-12-happy.png
  Negative: non-plan prompt has no false-positive button -> .sisyphus/evidence/task-12-negative.png
  ```
  **Commit**: YES (`fix(chat): harden plan detection and actions`)

- [ ] 13. Composer controls (model/agent/thinking); refs: `webview/shared/src/chat/PanelComponents.tsx`, `src/providers/ChatViewProvider.ts`; wave:3; cat:`unspecified-high`; blocked_by:5,6; blocks:19.
  **What to do**: wire model/agent/thinking selectors to outbound prompt options and persistence.
  **Must NOT do**: provider-unsupported thinking hard-fail.
  **Acceptance Criteria**: selections persist and influence outbound requests.
  **QA Scenarios**:
  ```
  Happy: selector values persist across reload -> .sisyphus/evidence/task-13-happy.png
  Negative: unsupported thinking falls back gracefully -> .sisyphus/evidence/task-13-negative.png
  ```
  **Commit**: YES (`feat(chat): wire thinking/model/agent controls`)

- [ ] 14. Image paste/preview/remove/send; refs: `webview/chat/app.js`, `webview/shared/src/chat/PanelComponents.tsx`, `src/providers/ChatViewProvider.ts`; wave:3; cat:`unspecified-high`; blocked_by:5,6; blocks:15,19.
  **What to do**: restore attachment UX in composer and include image payload in prompt.
  **Must NOT do**: invisible or non-removable attachment send.
  **Acceptance Criteria**: preview/removal works; payload includes image when sent.
  **QA Scenarios**:
  ```
  Happy: paste image, preview, send -> .sisyphus/evidence/task-14-happy.png
  Negative: remove image before send yields text-only payload -> .sisyphus/evidence/task-14-negative.png
  ```
  **Commit**: YES (`feat(chat): restore image attachment pipeline`)

- [ ] 15. Thread attachment rendering + AI visibility; refs: `webview/shared/src/chat/MessageComponents.tsx`, `webview/shared/src/chat/lib/types.ts`; wave:3; cat:`quick`; blocked_by:6,14; blocks:19.
  **What to do**: render sent attachments in thread and preserve context in message parts.
  **Must NOT do**: duplicate attachment chips.
  **Acceptance Criteria**: sent attachments visible once and consumed downstream.
  **QA Scenarios**:
  ```
  Happy: sent image appears in user message -> .sisyphus/evidence/task-15-happy.png
  Negative: duplicate prevention holds -> .sisyphus/evidence/task-15-negative.png
  ```
  **Commit**: YES (`fix(chat): render attachments in thread correctly`)

- [ ] 16. Event-driven TODO panel; refs: `src/services/MessageStreamService.ts`, `webview/shared/src/chat/lib/messageHandler.ts`, `webview/shared/src/chat/PanelComponents.tsx`; wave:3; cat:`deep`; blocked_by:4,5,6; blocks:19.
  **What to do**: derive TODO list/status from stream events, scoped per session.
  **Must NOT do**: leak TODOs across sessions.
  **Acceptance Criteria**: status lifecycle updates in near real-time.
  **QA Scenarios**:
  ```
  Happy: todo items progress pending->in_progress->completed -> .sisyphus/evidence/task-16-happy.png
  Negative: switching session isolates todo list -> .sisyphus/evidence/task-16-negative.png
  ```
  **Commit**: YES (`feat(chat): add event-driven todo panel`)

- [ ] 17. Quota monitor hardening; refs: `src/services/QuotaService.ts`, `webview/shared/src/chat/PanelComponents.tsx`; wave:3; cat:`unspecified-high`; blocked_by:4,6; blocks:19.
  **What to do**: strengthen provider refresh/error fallback for OpenCode/Copilot/Z.ai cards.
  **Must NOT do**: rely only on undocumented scraping.
  **Acceptance Criteria**: partial provider failure does not break panel.
  **QA Scenarios**:
  ```
  Happy: refresh updates quota timestamp/cards -> .sisyphus/evidence/task-17-happy.png
  Negative: one provider failure shows scoped error fallback -> .sisyphus/evidence/task-17-negative.png
  ```
  **Commit**: YES (`fix(chat): harden quota monitor fallbacks`)

- [ ] 18. Session/history UX polish; refs: `webview/shared/src/chat/PanelComponents.tsx`, `src/services/SessionService.ts`; wave:4; cat:`quick`; blocked_by:3; blocks:19.
  **What to do**: improve readability of session metadata and active-state styling.
  **Must NOT do**: alter session persistence semantics.
  **Acceptance Criteria**: session metadata clearer; CRUD unchanged.
  **QA Scenarios**:
  ```
  Happy: multi-session list readable and switch works -> .sisyphus/evidence/task-18-happy.png
  Negative: reload preserves active session/list -> .sisyphus/evidence/task-18-negative.png
  ```
  **Commit**: YES (`refactor(chat): polish session history UX`)

- [ ] 19. Integrated E2E workflow verification and fixes; refs: `webview/shared/src/chat/*`, `webview/shared/src/plan/*`, `src/providers/*`; wave:4; cat:`unspecified-high`; blocked_by:1,2,3,4,9,10,11,12,13,14,15,16,17,18; blocks:20,F1-F4.
  **What to do**: run full antigravity + chat flow QA and fix discovered integration defects.
  **Must NOT do**: unrelated refactors.
  **Acceptance Criteria**: all end-to-end journeys pass with evidence.
  **QA Scenarios**:
  ```
  Happy: full flow (plan->comments->proceed->attached prompt) passes -> .sisyphus/evidence/task-19-happy.png
  Negative: mobile flow passes with floating summary behavior -> .sisyphus/evidence/task-19-negative.png
  ```
  **Commit**: YES (`fix(chat): resolve integration defects across rebuilt workflows`)

- [ ] 20. shadcn consistency + accessibility pass; refs: `webview/shared/src/components/ui/*`, `webview/shared/src/chat/PanelComponents.tsx`, `webview/shared/src/plan/PlanShell.tsx`; wave:4; cat:`visual-engineering`; blocked_by:1,2,19; blocks:F1-F4.
  **What to do**: align new controls to shadcn patterns and keyboard/focus accessibility.
  **Must NOT do**: ship inaccessible popover/panel interactions.
  **Acceptance Criteria**: keyboard-only comment/proceed flow works.
  **QA Scenarios**:
  ```
  Happy: keyboard-only comment + proceed flow succeeds -> .sisyphus/evidence/task-20-happy.png
  Negative: focus returns correctly on close/escape -> .sisyphus/evidence/task-20-negative.png
  ```
  **Commit**: YES (`style(chat): enforce shadcn consistency and a11y polish`)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Verify every Must Have/Must NOT Have against actual implementation and evidence files.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run build/type/lint/tests as available; flag anti-patterns and protected-feature regressions.
  Output: `Build | Typecheck | Lint | Tests | VERDICT`

- [ ] F3. **Automated Integration QA Replay** — `unspecified-high` (+ `playwright`)
  Replay all task QA scenarios, capture fresh evidence under `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N] | Integration [N/N] | Edge Cases [N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  Compare delivered diffs against task scopes; reject scope creep and missing items.
  Output: `Tasks [N/N] | Contamination | Unaccounted Changes | VERDICT`

---

## Commit Strategy

- **1**: `chore(chat): establish guarded 3-panel foundation and shared state contracts`
- **2**: `feat(plan): add interactive plan comments and proceed attachment workflow`
- **3**: `feat(chat): wire composer controls, attachments, todo stream, and quota robustness`
- **4**: `refactor(chat): finalize session UX, responsiveness, shadcn consistency, and integration fixes`

---

## Success Criteria

### Verification Commands
```bash
npm run build
npx tsc --noEmit
npm test
```

### Final Checklist
- [ ] Protected core features intact and visible
- [ ] Plan review comments workflow fully functional
- [ ] Proceed prompt includes updated plan attachment
- [ ] 3-panel responsive behavior matches requirements
- [ ] Attachments, sessions, model/agent/thinking, todo panel, quota panel all pass QA
