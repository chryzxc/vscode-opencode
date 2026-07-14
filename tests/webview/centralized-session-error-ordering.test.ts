import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  countCanonicalMessagesAtOrBeforeRawIndex,
  getCollapsedConversationEntries,
} from "../../webview/shared/src/chat/lib/conversationProjection.js";

describe("centralized session-error ordering helpers", () => {
  it("ignores hidden canonical messages when anchoring non-message transcript rows", () => {
    const count = countCanonicalMessagesAtOrBeforeRawIndex(
      [
        {
          message: {} as never,
          index: 0,
          ids: ["msg-user-1"],
          rawOrder: 0,
          renderKind: "user",
        },
        {
          message: {} as never,
          index: 1,
          ids: ["msg-assistant-hidden"],
          rawOrder: 3,
          renderKind: "hidden",
        },
        {
          message: {} as never,
          index: 2,
          ids: ["msg-user-2"],
          rawOrder: 7,
          renderKind: "user",
        },
      ],
      3,
    );

    assert.equal(
      count,
      1,
      "hidden assistant placeholders must not push session.error rows below later visible user messages",
    );
  });

  it("retains session errors when compacted message history is collapsed", () => {
    const entries = getCollapsedConversationEntries([
      {
        kind: "message",
        key: "message:user-1",
        message: {} as never,
        messageIndex: 0,
        order: 0,
        renderKind: "user",
      },
      {
        kind: "session.error",
        key: "session.error:error-1",
        error: {
          message: "Model not found",
          rawIndex: 1,
          source: "session.error",
        },
        order: 6,
      },
      {
        kind: "message",
        key: "message:user-2",
        message: {} as never,
        messageIndex: 1,
        order: 10,
        renderKind: "user",
      },
    ], 1);

    assert.deepEqual(
      entries.map((entry) => entry.key),
      ["session.error:error-1", "message:user-2"],
      "the collapsed transcript must retain an error where its hidden turn triggered it",
    );
  });
});
