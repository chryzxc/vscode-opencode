import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlanManager } from "../../src/providers/chat/PlanManager.js";
import {
  createTestLogger,
  createTestMemento,
  firstNonEmptyString,
} from "./helpers/test-utils.js";

function createPlanManager() {
  return new PlanManager(
    createTestLogger(),
    firstNonEmptyString,
    createTestMemento(),
  );
}

function getCommentRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object", "expected comment object");
  return value as Record<string, unknown>;
}

describe("PlanManager", () => {
  describe("isPlanProceedMessageText", () => {
    it("matches the exact command", () => {
      const manager = createPlanManager();
      assert.equal(manager.isPlanProceedMessageText("/plan:proceed"), true);
    });

    it("matches the command prefix with trailing text", () => {
      const manager = createPlanManager();
      assert.equal(manager.isPlanProceedMessageText("/plan:proceed ship it"), true);
    });

    it("is case-insensitive and trims surrounding whitespace", () => {
      const manager = createPlanManager();
      assert.equal(manager.isPlanProceedMessageText("  /PLAN:PROCEED   comment  "), true);
    });

    it("rejects lookalike commands and nullish values", () => {
      const manager = createPlanManager();
      assert.equal(manager.isPlanProceedMessageText("/plan:proceeding"), false);
      assert.equal(manager.isPlanProceedMessageText("/plan: proceed"), false);
      assert.equal(manager.isPlanProceedMessageText(null), false);
      assert.equal(manager.isPlanProceedMessageText(undefined), false);
      assert.equal(manager.isPlanProceedMessageText([]), false);
    });
  });

  describe("normalizePlanProceedUserMessage", () => {
    it("normalizes a plan proceed message and preserves unrelated fields", () => {
      const manager = createPlanManager();
      const message = {
        text: "/plan:proceed ready to merge",
        content: "/plan:proceed ready to merge",
        role: "user",
        metadata: { source: "test" },
      };

      const normalized = manager.normalizePlanProceedUserMessage(message);

      assert.notStrictEqual(normalized, message);
      assert.equal(normalized.text, "/plan:proceed");
      assert.equal(normalized.content, "/plan:proceed");
      assert.equal(normalized.role, "user");
      assert.deepEqual(normalized.metadata, { source: "test" });

      const comment = getCommentRecord(normalized.planProceedComment);
      assert.equal(comment.text, "ready");
      assert.equal(typeof comment.id, "string");
      assert.equal(typeof comment.createdAt, "number");
      assert.deepEqual(comment.anchor, {
        startLine: 0,
        endLine: 0,
        selectedText: "ready",
      });
    });

    it("captures only the first whitespace-delimited token after the command", () => {
      const manager = createPlanManager();
      const normalized = manager.normalizePlanProceedUserMessage({
        text: "/plan:proceed 'looks good'",
      });

      const comment = getCommentRecord(normalized.planProceedComment);
      assert.equal(comment.text, "'looks");
    });

    it("uses content when text is absent", () => {
      const manager = createPlanManager();
      const normalized = manager.normalizePlanProceedUserMessage({
        content: "/plan:proceed continue",
        role: "user",
      });

      assert.equal(normalized.text, "/plan:proceed");
      assert.equal(normalized.content, "/plan:proceed");
      const comment = getCommentRecord(normalized.planProceedComment);
      assert.equal(comment.text, "continue");
    });

    it("does not add a comment for the bare command", () => {
      const manager = createPlanManager();
      const normalized = manager.normalizePlanProceedUserMessage({
        text: "/plan:proceed",
        extra: true,
      });

      assert.equal(normalized.text, "/plan:proceed");
      assert.equal("planProceedComment" in normalized, false);
      assert.equal(normalized.extra, true);
    });

    it("returns the original object for non-plan messages or empty payloads", () => {
      const manager = createPlanManager();
      const plainMessage = { text: "hello" };

      assert.strictEqual(manager.normalizePlanProceedUserMessage(plainMessage), plainMessage);
      assert.strictEqual(manager.normalizePlanProceedUserMessage({ content: "   " }).content, "   ");
      assert.equal(manager.normalizePlanProceedUserMessage(null), null);
    });
  });

  describe("isGenericPlanTitle", () => {
    it("matches known generic titles case-insensitively", () => {
      const manager = createPlanManager();
      assert.equal(manager.isGenericPlanTitle("Implementation Plan"), true);
      assert.equal(manager.isGenericPlanTitle("  development plan  "), true);
      assert.equal(manager.isGenericPlanTitle("MY PLAN"), true);
    });

    it("rejects specific titles and non-string edge cases", () => {
      const manager = createPlanManager();
      assert.equal(manager.isGenericPlanTitle("Implementation Plan - Chat UX"), false);
      assert.equal(manager.isGenericPlanTitle("Release readiness"), false);
      assert.equal(manager.isGenericPlanTitle(undefined), false);
      assert.equal(manager.isGenericPlanTitle([]), false);
    });
  });

  describe("derivePlanTitleFromFilePath", () => {
    it("derives a title from plan filenames", () => {
      const manager = createPlanManager();
      assert.equal(
        manager.derivePlanTitleFromFilePath("docs/plan_chat-shell.md"),
        "Chat Shell",
      );
    });

    it("derives a title from plan-prefixed filenames without an extension", () => {
      const manager = createPlanManager();
      assert.equal(
        manager.derivePlanTitleFromFilePath("plans/plan_release-readiness"),
        "Release Readiness",
      );
    });

    it("strips markdown wrappers, file URIs, and timestamp suffixes", () => {
      const manager = createPlanManager();
      assert.equal(
        manager.derivePlanTitleFromFilePath("<file:///tmp/plan_request-budgeter_20260421010101.md>"),
        "Request Budgeter",
      );
    });

    it("returns undefined for generic filenames or invalid input", () => {
      const manager = createPlanManager();
      assert.equal(manager.derivePlanTitleFromFilePath("plan.md"), undefined);
      assert.equal(manager.derivePlanTitleFromFilePath("''"), undefined);
      assert.equal(manager.derivePlanTitleFromFilePath(undefined), undefined);
    });
  });

  describe("resolvePlanTitle", () => {
    it("prefers an explicit non-generic plan title", () => {
      const manager = createPlanManager();
      assert.equal(
        manager.resolvePlanTitle({
          plan: { title: "Chat Shell Refresh", file: "plan.md" },
          planFile: "docs/plan_other.md",
          fallback: "Fallback Title",
        }),
        "Chat Shell Refresh",
      );
    });

    it("falls back from a generic plan title to the explicit planFile", () => {
      const manager = createPlanManager();
      assert.equal(
        manager.resolvePlanTitle({
          plan: { title: "Implementation Plan", file: "docs/plan.md" },
          planFile: "plans/plan_chat-streaming.md",
          fallback: "Fallback Title",
        }),
        "Chat Streaming",
      );
    });

    it("uses plan.file when planFile is absent", () => {
      const manager = createPlanManager();
      assert.equal(
        manager.resolvePlanTitle({
          plan: { title: "Project Plan", file: "plans/plan_model-selection.md" },
        }),
        "Model Selection",
      );
    });

    it("uses a non-generic fallback when no file-derived title exists", () => {
      const manager = createPlanManager();
      assert.equal(
        manager.resolvePlanTitle({
          plan: { title: "Plan", file: "plan.md" },
          fallback: "Quota Guardrails",
        }),
        "Quota Guardrails",
      );
    });

    it("returns undefined when every source is generic or empty", () => {
      const manager = createPlanManager();
      assert.equal(
        manager.resolvePlanTitle({
          plan: { title: "Plan", file: "plan.md" },
          fallback: "Implementation Plan",
        }),
        undefined,
      );
    });
  });

  describe("getPlanFileCandidateScore", () => {
    it("heavily favors plan.md in plan directories", () => {
      const manager = createPlanManager();
      const top = manager.getPlanFileCandidateScore("plans/plan.md");
      const plain = manager.getPlanFileCandidateScore("docs/notes.md");
      assert.ok(top > plain);
      assert.ok(top >= 170);
      assert.equal(plain, 0);
    });

    it("rewards plan-like names and penalizes deeper paths", () => {
      const manager = createPlanManager();
      const shallow = manager.getPlanFileCandidateScore("plan.md");
      const deep = manager.getPlanFileCandidateScore("docs/archive/2026/plan.md");
      assert.ok(shallow > deep);
      assert.ok(deep > 0);
    });

    it("zeroes out paths inside node_modules or .git", () => {
      const manager = createPlanManager();
      assert.equal(manager.getPlanFileCandidateScore("repo/node_modules/pkg/plan.md"), 0);
      assert.equal(manager.getPlanFileCandidateScore("repo/.git/hooks/plan.md"), 0);
    });
  });

  describe("prioritizePlanFileCandidates", () => {
    it("puts explicit files before higher-scored implicit candidates", () => {
      const manager = createPlanManager();
      const explicitFiles = new Set(["docs/plan-notes.md"]);
      const prioritized = manager.prioritizePlanFileCandidates(
        ["plans/plan.md", "docs/plan-notes.md", "notes.md"],
        explicitFiles,
      );

      assert.deepEqual(prioritized, [
        "docs/plan-notes.md",
        "plans/plan.md",
        "notes.md",
      ]);
    });

    it("sorts non-explicit candidates by descending score", () => {
      const manager = createPlanManager();
      const prioritized = manager.prioritizePlanFileCandidates([
        "notes.md",
        "planning/overview.md",
        "docs/plan.md",
      ]);

      assert.deepEqual(prioritized, [
        "planning/overview.md",
        "docs/plan.md",
        "notes.md",
      ]);
    });

    it("normalizes wrappers, filters empties, and preserves duplicates", () => {
      const manager = createPlanManager();
      const explicitFiles = new Set(["docs/plan.md"]);
      const prioritized = manager.prioritizePlanFileCandidates([
        "`docs/plan.md`",
        "",
        undefined,
        "docs/plan.md",
      ], explicitFiles);

      assert.deepEqual(prioritized, ["docs/plan.md", "docs/plan.md"]);
    });
  });

  describe("collectPlanFileCandidatesFromStructuredPlan", () => {
    it("collects normalized file and files entries without duplicates", () => {
      const manager = createPlanManager();
      const candidates = manager.collectPlanFileCandidatesFromStructuredPlan({
        file: "`plans/plan.md`",
        files: ["plans/plan.md", "docs/plan.md", "", null],
      });

      assert.deepEqual(candidates, ["plans/plan.md", "docs/plan.md"]);
    });

    it("returns an empty list for content-only or invalid structures", () => {
      const manager = createPlanManager();
      assert.deepEqual(
        manager.collectPlanFileCandidatesFromStructuredPlan({
          content: "See [plan](docs/plan.md)",
        }),
        [],
      );
      assert.deepEqual(manager.collectPlanFileCandidatesFromStructuredPlan(null), []);
    });
  });

  describe("extractMarkdownFileReferences", () => {
    it("extracts markdown links, reference definitions, and bare markdown filenames", () => {
      const manager = createPlanManager();
      const references = manager.extractMarkdownFileReferences(`
See [plan](docs/plan.md) and release-plan.md.

[follow-up]: plans/next-steps.md
      `);

      assert.deepEqual(references, [
        "docs/plan.md",
        "plans/next-steps.md",
        "plan.md",
        "release-plan.md",
        "next-steps.md",
      ]);
    });

    it("ignores references inside fenced and inline code while deduplicating matches", () => {
      const manager = createPlanManager();
      const references = manager.extractMarkdownFileReferences([
        "```md",
        "[skip](docs/code-block-plan.md)",
        "```",
        "",
        "Use [real plan](docs/actual-plan.md) and docs/actual-plan.md again.",
        "Inline `docs/inline-plan.md` should not count.",
      ].join("\n"));

      assert.deepEqual(references, ["docs/actual-plan.md", "actual-plan.md"]);
    });

    it("returns an empty list for nullish or non-matching input", () => {
      const manager = createPlanManager();
      assert.deepEqual(manager.extractMarkdownFileReferences(undefined), []);
      assert.deepEqual(manager.extractMarkdownFileReferences("No markdown files here."), []);
      assert.deepEqual(manager.extractMarkdownFileReferences(["not", "text"]), []);
    });
  });

  describe("isLikelyPlanMarkdownFile", () => {
    it("accepts plan markdown files by filename or directory", () => {
      const manager = createPlanManager();
      assert.equal(manager.isLikelyPlanMarkdownFile("plan_auth.md"), true);
      assert.equal(manager.isLikelyPlanMarkdownFile("planning/overview.md"), true);
      assert.equal(manager.isLikelyPlanMarkdownFile("docs/release-plan.md"), true);
    });

    it("rejects non-markdown, comment files, and node_modules paths", () => {
      const manager = createPlanManager();
      assert.equal(manager.isLikelyPlanMarkdownFile("docs/release-plan.txt"), false);
      assert.equal(manager.isLikelyPlanMarkdownFile("plans/plan_comments_a1b2.md"), false);
      assert.equal(manager.isLikelyPlanMarkdownFile("docs/release_comments.md"), false);
      assert.equal(manager.isLikelyPlanMarkdownFile("repo/node_modules/pkg/plan.md"), false);
      assert.equal(manager.isLikelyPlanMarkdownFile("docs/design.md"), false);
    });
  });
});
