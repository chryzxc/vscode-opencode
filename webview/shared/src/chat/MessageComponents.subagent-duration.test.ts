import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSubagentDisplayActivity,
  getSubagentDisplayDurationMs,
} from "./lib/subagentDuration";
import type { SubagentSummary } from "./lib/types";

function makeSubagent(overrides: Partial<SubagentSummary>): SubagentSummary {
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

describe("getSubagentDisplayDurationMs", () => {
  it("keeps running subagent duration live after backend updates go quiet", () => {
    const subagent = makeSubagent({
      startedAt: 1_000,
      durationMs: 3_100,
    });

    assert.strictEqual(
      getSubagentDisplayDurationMs(subagent, undefined, 8_250),
      7_250,
    );
  });

  it("keeps completed subagent duration fixed", () => {
    const subagent = makeSubagent({
      status: "done",
      startedAt: 1_000,
      endedAt: 4_100,
      durationMs: 3_100,
    });

    assert.strictEqual(
      getSubagentDisplayDurationMs(subagent, undefined, 8_250),
      3_100,
    );
  });
});

describe("getSubagentDisplayActivity", () => {
  it("replaces stale running activity when the row is completed", () => {
    const subagent = makeSubagent({
      status: "done",
      latestActivity: "Running",
    });

    assert.strictEqual(
      getSubagentDisplayActivity(subagent, undefined, "done", "Completed"),
      "Completed",
    );
  });
});
