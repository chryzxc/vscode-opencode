import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Message } from "./types.ts";
import {
  buildMessageConversationEntries,
  countCanonicalMessagesAtOrBeforeRawIndex,
} from "./conversationProjection.ts";

describe("conversationProjection", () => {
  it("orders visible messages by message timestamp instead of raw arrival order", () => {
    const entries = [
      {
        message: { role: "user", content: "newest canonical first" } as Message,
        index: 0,
        ids: ["user-2"],
        rawOrder: 20,
        renderKind: "user",
      },
      {
        message: {
          role: "assistant",
          content: "assistant follows canonical order",
          created: 3_000,
        } as Message,
        index: 1,
        ids: ["assistant-2"],
        rawOrder: 21,
        renderKind: "assistant",
      },
      {
        message: {
          role: "user",
          content: "older raw order but already canonicalized",
          created: 1_000,
        } as Message,
        index: 2,
        ids: ["user-1"],
        rawOrder: 10,
        renderKind: "user",
      },
      {
        message: {
          role: "user",
          content: "middle",
          created: 2_000,
        } as Message,
        index: 3,
        ids: ["user-3"],
        rawOrder: 5,
        renderKind: "user",
      },
    ];

    const conversationEntries = buildMessageConversationEntries(entries);

    assert.deepStrictEqual(
      conversationEntries.map((entry) => entry.kind === "message" ? entry.key : entry.kind),
      ["message:user-1", "message:user-3", "message:assistant-2", "message:user-2"],
    );
  });

  it("skips hidden entries without changing the canonical order of visible messages", () => {
    const entries = [
      {
        message: { role: "assistant", content: "hidden background helper" } as Message,
        index: 0,
        ids: ["hidden-1"],
        rawOrder: 10,
        renderKind: "hidden",
      },
      {
        message: { role: "user", content: "visible user" } as Message,
        index: 1,
        ids: ["user-1"],
        rawOrder: 11,
        renderKind: "user",
      },
      {
        message: { role: "assistant", content: "visible assistant" } as Message,
        index: 2,
        ids: ["assistant-1"],
        rawOrder: 12,
        renderKind: "assistant",
      },
    ];

    const conversationEntries = buildMessageConversationEntries(entries);

    assert.deepStrictEqual(
      conversationEntries.map((entry) => entry.kind === "message" ? entry.key : entry.kind),
      ["message:user-1", "message:assistant-1"],
    );
    assert.deepStrictEqual(
      conversationEntries.map((entry) => entry.order),
      [10, 20],
    );
  });

  it("counts canonical messages before a raw tape index for diff placement", () => {
    const entries = [
      {
        message: { role: "user", content: "first" } as Message,
        index: 0,
        ids: ["user-1"],
        rawOrder: 3,
        renderKind: "user",
      },
      {
        message: { role: "assistant", content: "second" } as Message,
        index: 1,
        ids: ["assistant-1"],
        rawOrder: 8,
        renderKind: "assistant",
      },
      {
        message: { role: "assistant", content: "third" } as Message,
        index: 2,
        ids: ["assistant-2"],
        rawOrder: 15,
        renderKind: "assistant",
      },
    ];

    assert.strictEqual(countCanonicalMessagesAtOrBeforeRawIndex(entries, 2), 0);
    assert.strictEqual(countCanonicalMessagesAtOrBeforeRawIndex(entries, 8), 2);
    assert.strictEqual(countCanonicalMessagesAtOrBeforeRawIndex(entries, 99), 3);
  });
});
