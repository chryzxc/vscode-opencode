// Runtime regression tests for webview/shared/src/chat/lib/subagentDuration.ts
//
// Why this file exists:
// - The existing colocated subagent-duration test under `webview/shared/src/chat/`
//   is not picked up by `npm test`, so CI does not exercise this behavior.
// - That orphaned test only covers 2 duration cases, while the runtime helpers have
//   multiple status, timestamp, detail-fallback, and stale-activity branches.
// - Duration math is user-visible in subagent cards; regressions here can make live
//   tasks appear frozen, completed tasks keep counting, or terminal rows show stale text.
//
// These tests execute the actual TypeScript implementation via `tsx` so they catch
// real behavior regressions, not source-text or mock drift.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { importWebviewModule } from "../helpers/webview-module.mjs";

const MODULE_PATH = "webview/shared/src/chat/lib/subagentDuration.ts";
const {
  getSubagentDisplayDurationMs,
  getSubagentDisplayActivity,
} = await importWebviewModule(MODULE_PATH);

function makeSubagent(overrides = {}) {
  return {
    id: "subagent-1",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    status: "running",
    latestActivity: "Running",
    references: [],
    ...overrides,
  };
}

function makeDetail(overrides = {}) {
  return {
    ...makeSubagent({ id: "subagent-detail" }),
    thinkingEvents: [],
    progressEvents: [],
    timelineEvents: [],
    ...overrides,
  };
}

describe("subagentDuration runtime behavior", () => {
  describe("getSubagentDisplayDurationMs", () => {
    describe("live running and pending durations", () => {
      it("uses live elapsed time for running subagents when backend duration went quiet", () => {
        const subagent = makeSubagent({ startedAt: 1_000, durationMs: 3_100 });

        assert.strictEqual(
          getSubagentDisplayDurationMs(subagent, undefined, 8_250),
          7_250,
        );
      });

      it("keeps the larger backend duration when live elapsed is smaller", () => {
        const subagent = makeSubagent({ startedAt: 1_000, durationMs: 10_000 });

        assert.strictEqual(
          getSubagentDisplayDurationMs(subagent, undefined, 8_250),
          10_000,
        );
      });

      it("uses live elapsed time for running subagents with a zero backend duration", () => {
        const subagent = makeSubagent({ startedAt: 2_000, durationMs: 0 });

        assert.strictEqual(
          getSubagentDisplayDurationMs(subagent, undefined, 5_500),
          3_500,
        );
      });

      it("returns backend duration only for running subagents without a startedAt timestamp", () => {
        const subagent = makeSubagent({ durationMs: 4_200 });

        assert.strictEqual(
          getSubagentDisplayDurationMs(subagent, undefined, 9_999),
          4_200,
        );
      });

      it("treats pending subagents as live and lets elapsed time win", () => {
        const subagent = makeSubagent({ status: "pending", startedAt: 10_000, durationMs: 250 });

        assert.strictEqual(
          getSubagentDisplayDurationMs(subagent, undefined, 14_500),
          4_500,
        );
      });
    });

    describe("terminal and non-live durations", () => {
      it("keeps completed subagent duration fixed from startedAt and endedAt, ignoring now", () => {
        const subagent = makeSubagent({
          status: "done",
          startedAt: 1_000,
          endedAt: 4_100,
          durationMs: 99_999,
        });

        assert.strictEqual(
          getSubagentDisplayDurationMs(subagent, undefined, 20_000),
          3_100,
        );
      });

      it("falls back to backend duration for done subagents without ended timestamps", () => {
        const subagent = makeSubagent({ status: "done", startedAt: 1_000, durationMs: 3_100 });

        assert.strictEqual(
          getSubagentDisplayDurationMs(subagent, undefined, 8_250),
          3_100,
        );
      });

      it("falls back to backend duration for error and orphaned subagents without ended timestamps", () => {
        assert.strictEqual(
          getSubagentDisplayDurationMs(
            makeSubagent({ status: "error", startedAt: 1_000, durationMs: 5_500 }),
            undefined,
            20_000,
          ),
          5_500,
        );
        assert.strictEqual(
          getSubagentDisplayDurationMs(
            makeSubagent({ status: "orphaned", startedAt: 1_000, durationMs: 6_600 }),
            undefined,
            20_000,
          ),
          6_600,
        );
      });

      it("clamps negative endedAt-minus-startedAt values to zero for clock skew", () => {
        const subagent = makeSubagent({ status: "done", startedAt: 5_000, endedAt: 4_000 });

        assert.strictEqual(
          getSubagentDisplayDurationMs(subagent, undefined, 10_000),
          0,
        );
      });
    });

    describe("fallbacks, overrides, and numeric guards", () => {
      it("uses detail startedAt, endedAt, durationMs, and status when summary fields are missing", () => {
        const subagent = makeSubagent({ status: undefined, latestActivity: "" });
        const detail = makeDetail({
          status: "done",
          startedAt: 2_000,
          endedAt: 7_250,
          durationMs: 123,
        });

        assert.strictEqual(
          getSubagentDisplayDurationMs(subagent, detail, 99_999),
          5_250,
        );
      });

      it("lets resolvedStatus override detail.status and subagent.status", () => {
        const subagent = makeSubagent({ status: "running", startedAt: 1_000, endedAt: 2_500, durationMs: 250 });
        const detail = makeDetail({ status: "pending" });

        assert.strictEqual(
          getSubagentDisplayDurationMs(subagent, detail, 10_000, "done"),
          1_500,
        );
      });

      it("ignores non-finite summary numbers and safely falls back to finite detail values", () => {
        const subagent = makeSubagent({
          startedAt: Number.NaN,
          endedAt: Number.POSITIVE_INFINITY,
          durationMs: Number.NEGATIVE_INFINITY,
        });
        const detail = makeDetail({ startedAt: 100, endedAt: 175, durationMs: 25 });

        assert.strictEqual(
          getSubagentDisplayDurationMs(subagent, detail, 175),
          75,
        );
      });

      it("uses Date.now() as the default now value when now is omitted", () => {
        const originalDateNow = Date.now;
        Date.now = () => 5_000;

        try {
          const subagent = makeSubagent({ startedAt: 4_500, durationMs: 0 });

          assert.strictEqual(getSubagentDisplayDurationMs(subagent), 500);
        } finally {
          Date.now = originalDateNow;
        }
      });
    });
  });

  describe("getSubagentDisplayActivity", () => {
    describe("activity selection", () => {
      it("returns trimmed subagent latestActivity when present and not stale", () => {
        const subagent = makeSubagent({ latestActivity: "  Generating plan  " });

        assert.strictEqual(
          getSubagentDisplayActivity(subagent, undefined, "running", "Running"),
          "Generating plan",
        );
      });

      it("falls back to statusText when activity is empty or whitespace", () => {
        assert.strictEqual(
          getSubagentDisplayActivity(makeSubagent({ latestActivity: "" }), undefined, "running", "Running"),
          "Running",
        );
        assert.strictEqual(
          getSubagentDisplayActivity(makeSubagent({ latestActivity: "   " }), undefined, "running", "Running"),
          "Running",
        );
      });

      it("prefers subagent.latestActivity and then detail.latestActivity", () => {
        assert.strictEqual(
          getSubagentDisplayActivity(
            makeSubagent({ latestActivity: "Reading files" }),
            makeDetail({ latestActivity: "Writing files" }),
            "running",
            "Running",
          ),
          "Reading files",
        );
        assert.strictEqual(
          getSubagentDisplayActivity(
            makeSubagent({ latestActivity: "" }),
            makeDetail({ latestActivity: "Writing files" }),
            "running",
            "Running",
          ),
          "Writing files",
        );
      });
    });

    describe("stale terminal activity", () => {
      it("replaces stale non-terminal activity with statusText for terminal statuses", () => {
        assert.strictEqual(
          getSubagentDisplayActivity(makeSubagent({ latestActivity: "running" }), undefined, "done", "Completed"),
          "Completed",
        );
        assert.strictEqual(
          getSubagentDisplayActivity(makeSubagent({ latestActivity: "pending" }), undefined, "error", "Failed"),
          "Failed",
        );
        assert.strictEqual(
          getSubagentDisplayActivity(makeSubagent({ latestActivity: "initializing" }), undefined, "orphaned", "Lost"),
          "Lost",
        );
        assert.strictEqual(
          getSubagentDisplayActivity(
            makeSubagent({ latestActivity: "waiting for next progress..." }),
            undefined,
            "done",
            "Completed",
          ),
          "Completed",
        );
      });

      it("preserves non-stale activity even when resolvedStatus is terminal", () => {
        const subagent = makeSubagent({ status: "done", latestActivity: "Generating plan" });

        assert.strictEqual(
          getSubagentDisplayActivity(subagent, undefined, "done", "Completed"),
          "Generating plan",
        );
      });

      it("performs stale activity checks case-insensitively", () => {
        assert.strictEqual(
          getSubagentDisplayActivity(makeSubagent({ latestActivity: "RUNNING" }), undefined, "done", "Completed"),
          "Completed",
        );
        assert.strictEqual(
          getSubagentDisplayActivity(makeSubagent({ latestActivity: "Running" }), undefined, "done", "Completed"),
          "Completed",
        );
        assert.strictEqual(
          getSubagentDisplayActivity(makeSubagent({ latestActivity: "running" }), undefined, "done", "Completed"),
          "Completed",
        );
      });
    });
  });
});
