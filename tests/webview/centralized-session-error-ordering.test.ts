import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { countCanonicalMessagesAtOrBeforeRawIndex } from "../../webview/shared/src/chat/lib/conversationProjection.js";

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
});
