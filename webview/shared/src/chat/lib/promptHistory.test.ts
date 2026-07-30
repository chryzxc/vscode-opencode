import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "./types";
import { getNextPromptIndex, getPreviousPromptIndex, getPromptHistory } from "./promptHistory";

describe("prompt history", () => {
  it("returns distinct user prompts in chronological order", () => {
    const messages = [
      { role: "assistant", content: "answer" },
      { role: "user", content: "second", created: 20 },
      { info: { role: "user", time: { created: 10 } }, parts: [{ type: "text", text: "first" }] },
      { role: "user", content: "second", created: 30 },
    ] as Message[];

    assert.deepEqual(getPromptHistory(messages), ["first", "second"]);
  });

  it("moves from newest to oldest and restores the draft after the newest", () => {
    assert.equal(getPreviousPromptIndex(null, 2), 1);
    assert.equal(getPreviousPromptIndex(1, 2), 0);
    assert.equal(getNextPromptIndex(0, 2), 1);
    assert.equal(getNextPromptIndex(1, 2), null);
  });
});
