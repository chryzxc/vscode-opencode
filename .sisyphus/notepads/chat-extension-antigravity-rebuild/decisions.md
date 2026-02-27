# Decisions

## [2026-02-26] Session Init

### Architecture Decisions
- Use shadcn UI components consistently across all new UI
- 3-panel layout: left (sessions, hamburger), middle (chat), right (stats/quota/todo)
- Right panel: auto-visible >= 1100px; mobile shows floating top summary card
- Proceed button sends literal text "Proceed" as new user prompt + updated plan as attachment
- Anchor model for plan comments: use line numbers (not pixel offsets) for stability
- State management: extend existing store.ts reducer pattern (no new state library)
- Message contract: add new message types without breaking existing ones


## [2026-02-26] F1 compliance verdict

- Verdict: FAIL
- Primary blockers: missing negative QA evidence across tasks, TODO panel/session isolation gaps (Task 16), thinking level not applied to outbound prompts (Task 13), partial plan payload bridge (Task 7), and scope creep items flagged in .


- Correction/append (prior append truncated due to shell quoting): scope creep items flagged in `.sisyphus/evidence/f4-scope-fidelity.txt`.
