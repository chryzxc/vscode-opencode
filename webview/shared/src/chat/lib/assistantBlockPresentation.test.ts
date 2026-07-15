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

  it("keeps separate SDK assistant message IDs as separate response blocks", () => {
    const result = buildAssistantBlockPresentation([
      { role: "user", userBlockKey: "user-1" },
      { role: "assistant", assistantBlockKey: "assistant-tool-call", hasResponseText: false },
      { role: "assistant", assistantBlockKey: "assistant-final", hasResponseText: true },
    ]);

    assert.deepStrictEqual(result.entryBlockKeys, [
      "user-1",
      "assistant-tool-call",
      "assistant-final",
    ]);
    assert.equal(result.blockSizeByKey.get("assistant-tool-call"), 1);
    assert.equal(result.blockSizeByKey.get("assistant-final"), 1);
    assert.equal(result.isLastTextInBlockByIndex.get(1), false);
    assert.equal(result.isLastTextInBlockByIndex.get(2), false);
  });
});
