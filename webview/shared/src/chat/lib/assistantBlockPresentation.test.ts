import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAssistantBlockPresentation } from "./assistantBlockPresentation";

describe("buildAssistantBlockPresentation", () => {
  it("selects the first expanded card and the last text-bearing collapsed card", () => {
    const result = buildAssistantBlockPresentation([
      { role: "user", userBlockKey: "user-1" },
      { role: "assistant", hasResponseText: true },
      { role: "assistant", hasResponseText: false },
      { role: "assistant", hasResponseText: true },
    ]);

    assert.deepStrictEqual(result.entryBlockKeys, ["user-1", "user-1", "user-1", "user-1"]);
    assert.equal(result.isFirstInBlockByIndex.get(1), true);
    assert.equal(result.isFirstInBlockByIndex.get(2), false);
    assert.equal(result.isAbsoluteLastInBlockByIndex.get(3), true);
    assert.equal(result.isLastTextInBlockByIndex.get(3), true);
    assert.equal(result.isLastTextInBlockByIndex.get(1), false);
    assert.equal(result.blockSizeByKey.get("user-1"), 3);
  });

  it("keeps the physical last card visible when an activity-only block has no text", () => {
    const result = buildAssistantBlockPresentation([
      { role: "user", userBlockKey: "user-1" },
      { role: "assistant", hasResponseText: false },
      { role: "assistant", hasResponseText: false, hasInlineAbort: true },
    ]);

    assert.equal(result.isLastTextInBlockByIndex.get(1), false);
    assert.equal(result.isLastTextInBlockByIndex.get(2), true);
    assert.equal(result.blockHasInlineAbortByKey.get("user-1"), true);
  });

  it("does not create collapse anchors for a single-card response", () => {
    const result = buildAssistantBlockPresentation([
      { role: "user", userBlockKey: "user-1" },
      { role: "assistant", hasResponseText: true },
    ]);

    assert.equal(result.isFirstInBlockByIndex.get(1), true);
    assert.equal(result.isAbsoluteLastInBlockByIndex.get(1), false);
    assert.equal(result.isLastTextInBlockByIndex.get(1), false);
    assert.equal(result.blockSizeByKey.get("user-1"), 1);
  });

  it("keeps adjacent assistant phases in one response block despite different SDK IDs", () => {
    const result = buildAssistantBlockPresentation([
      { role: "user", userBlockKey: "user-1" },
      { role: "assistant", assistantBlockKey: "assistant-tool-call", hasResponseText: false },
      { role: "assistant", assistantBlockKey: "assistant-final", hasResponseText: true },
    ]);

    assert.deepStrictEqual(result.entryBlockKeys, [
      "user-1",
      "user-1",
      "user-1",
    ]);
    assert.equal(result.blockSizeByKey.get("user-1"), 2);
    assert.equal(result.isLastTextInBlockByIndex.get(1), false);
    assert.equal(result.isLastTextInBlockByIndex.get(2), true);
  });

  it("starts a new response block after a user answer even when SDK parentID repeats", () => {
    const result = buildAssistantBlockPresentation([
      { role: "user", userBlockKey: "prompt" },
      { role: "assistant", assistantBlockKey: "prompt", hasResponseText: false },
      { role: "user", userBlockKey: "answer" },
      { role: "assistant", assistantBlockKey: "prompt", hasResponseText: false },
    ]);

    assert.deepStrictEqual(result.entryBlockKeys, [
      "prompt",
      "prompt",
      "answer",
      "answer",
    ]);
    assert.equal(result.blockSizeByKey.get("prompt"), 1);
    assert.equal(result.blockSizeByKey.get("answer"), 1);
  });

  it("marks identical activity-only snapshots in one parent block as duplicates", () => {
    const result = buildAssistantBlockPresentation([
      { role: "user", userBlockKey: "user-1" },
      { role: "assistant", activitySnapshotKey: "read:OnboardingFlow" },
      { role: "assistant", activitySnapshotKey: "read:OnboardingFlow" },
      { role: "assistant", activitySnapshotKey: "read:GameScreen" },
    ]);

    assert.equal(result.isDuplicateActivityByIndex.get(1), false);
    assert.equal(result.isDuplicateActivityByIndex.get(2), true);
    assert.equal(result.isDuplicateActivityByIndex.get(3), false);
  });
});
