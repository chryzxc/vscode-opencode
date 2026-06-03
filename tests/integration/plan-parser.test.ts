import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlanParser } from "../../src/services/PlanParser.js";

const BASIC_PLAN = `## Add User Authentication

This plan adds authentication to the application.

### Proposed Changes
#### [MODIFY] src/app.ts - Add auth middleware
#### [NEW] src/services/AuthService.ts
#### [DELETE] src/old/legacy.js

### Tasks
- [x] Design API
- [ ] Implement login UI
- [ ] Add tests

### Verification Plan
- Automated test for login flow
- Manual review of security
`;

describe("PlanParser", () => {
  describe("parse", () => {
    it("extracts goal from first header", () => {
      const plan = PlanParser.parse(BASIC_PLAN);
      assert.equal(plan.goal, "Add User Authentication");
    });

    it("extracts description between goal and first section", () => {
      const plan = PlanParser.parse(BASIC_PLAN);
      assert.ok(plan.description);
      assert.ok(plan.description!.includes("authentication to the application"));
    });

    it("extracts file operations with types", () => {
      const plan = PlanParser.parse(BASIC_PLAN);
      assert.equal(plan.files.length, 3);
      assert.deepEqual(plan.files[0], { type: "MODIFY", path: "src/app.ts" });
      assert.deepEqual(plan.files[1], { type: "NEW", path: "src/services/AuthService.ts" });
      assert.deepEqual(plan.files[2], { type: "DELETE", path: "src/old/legacy.js" });
    });

    it("extracts checklist steps with completion state", () => {
      const plan = PlanParser.parse(BASIC_PLAN);
      assert.equal(plan.steps.length, 3);
      assert.equal(plan.steps[0].title, "Design API");
      assert.equal(plan.steps[0].completed, true);
      assert.equal(plan.steps[1].title, "Implement login UI");
      assert.equal(plan.steps[1].completed, false);
      assert.equal(plan.steps[2].title, "Add tests");
      assert.equal(plan.steps[2].completed, false);
    });

    it("extracts verification steps with auto-detected type", () => {
      const plan = PlanParser.parse(BASIC_PLAN);
      assert.ok(plan.verification.length >= 1, `Expected >= 1 verification step, got ${plan.verification.length}`);
      assert.equal(plan.verification[0].type, "Automated");
      assert.ok(plan.verification[0].description.includes("login flow"));
    });

    it("preserves rawContent", () => {
      const plan = PlanParser.parse(BASIC_PLAN);
      assert.equal(plan.rawContent, BASIC_PLAN);
    });

    it("returns valid plan for empty input", () => {
      const plan = PlanParser.parse("");
      assert.equal(plan.goal, "");
      assert.deepEqual(plan.files, []);
      assert.deepEqual(plan.steps, []);
      assert.deepEqual(plan.verification, []);
    });

    it("handles file operations without header prefix", () => {
      const md = `## Plan
[MODIFY] src/a.ts
[NEW] src/b.ts`;
      const plan = PlanParser.parse(md);
      assert.equal(plan.files.length, 2);
      assert.equal(plan.files[0].path, "src/a.ts");
      assert.equal(plan.files[1].path, "src/b.ts");
    });

    it("handles file operations with file:/// prefix", () => {
      const md = `## Plan
[MODIFY] src/a.ts (file:///absolute/path/src/a.ts)`;
      const plan = PlanParser.parse(md);
      assert.equal(plan.files.length, 1);
      assert.equal(plan.files[0].type, "MODIFY");
      assert.ok(plan.files[0].path.includes("src/a.ts"));
    });

    it("handles alternate header levels (#, ##, ###)", () => {
      for (const level of ["#", "##", "###"]) {
        const md = `${level} My Goal`;
        const plan = PlanParser.parse(md);
        assert.equal(plan.goal, "My Goal", `Failed for header level ${level}`);
      }
    });

    it("handles steps with [/] as incomplete", () => {
      const md = `## Plan
- [/] In-progress task`;
      const plan = PlanParser.parse(md);
      assert.equal(plan.steps.length, 1);
      assert.equal(plan.steps[0].completed, false);
    });

    it("extracts plain bullet tasks when the tasks section has no checkboxes", () => {
      const md = `## Plan

### Tasks
- Audit the current history hydration path
- Patch the fallback task parser
- Verify diff preview hydration`;
      const plan = PlanParser.parse(md);
      assert.deepEqual(
        plan.steps.map((step) => step.title),
        [
          "Audit the current history hydration path",
          "Patch the fallback task parser",
          "Verify diff preview hydration",
        ],
      );
      assert.ok(plan.steps.every((step) => step.completed === false));
    });

    it("does not confuse file operations with list items", () => {
      const md = `## Plan
- [ ] Some task
- [MODIFY] src/a.ts`;
      const plan = PlanParser.parse(md);
      assert.ok(plan.files.length >= 1, "file op should be extracted");
    });

    it("classifies verification steps with 'script' as Automated", () => {
      const md = `## Plan

- [x] Some step

### Verification Plan
- Run script to verify output`;
      const plan = PlanParser.parse(md);
      assert.ok(plan.verification.length >= 1);
      assert.equal(plan.verification[0].type, "Automated");
    });
  });

  describe("toMarkdown", () => {
    it("round-trips a parsed plan through toMarkdown → parse", () => {
      const original = PlanParser.parse(BASIC_PLAN);
      const regenerated = PlanParser.toMarkdown(original);
      const reparsed = PlanParser.parse(regenerated);

      assert.equal(reparsed.goal, original.goal);
      assert.equal(reparsed.files.length, original.files.length);
      assert.equal(reparsed.steps.length, original.steps.length);
      assert.equal(reparsed.verification.length, original.verification.length);

      for (let i = 0; i < original.files.length; i++) {
        assert.equal(reparsed.files[i].type, original.files[i].type);
        assert.equal(reparsed.files[i].path, original.files[i].path);
      }
      for (let i = 0; i < original.steps.length; i++) {
        assert.equal(reparsed.steps[i].title, original.steps[i].title);
        assert.equal(reparsed.steps[i].completed, original.steps[i].completed);
      }
    });

    it("produces valid markdown with all sections", () => {
      const plan = PlanParser.parse(BASIC_PLAN);
      const md = PlanParser.toMarkdown(plan);

      assert.ok(md.includes("# Add User Authentication"));
      assert.ok(md.includes("## Proposed Changes"));
      assert.ok(md.includes("[MODIFY]"));
      assert.ok(md.includes("## Tasks"));
      assert.ok(md.includes("[x]"));
      assert.ok(md.includes("## Verification Plan"));
    });

    it("handles plan with only goal", () => {
      const md = PlanParser.toMarkdown({
        goal: "Simple Plan",
        files: [],
        steps: [],
        verification: [],
        rawContent: "",
      });
      assert.equal(md.trim(), "# Simple Plan");
    });
  });
});
