import test from "node:test";
import assert from "node:assert/strict";

import { getCentralizedAssistantContentChunksFromRawSdkEventPayloads } from "../../webview/shared/src/chat/lib/messageHandler";

test("does not render a text delta whose part ID belongs to reasoning", () => {
  const messageID = "msg-reasoning-reclassified";
  const reasoningPartID = "prt-reasoning-reclassified";

  const chunks = getCentralizedAssistantContentChunksFromRawSdkEventPayloads([
    {
      type: "message.updated",
      properties: { info: { id: messageID, role: "assistant" } },
    },
    {
      type: "message.part.updated",
      properties: {
        part: { id: reasoningPartID, messageID, type: "reasoning", text: "" },
      },
    },
    {
      type: "message.part.updated",
      properties: {
        partID: reasoningPartID,
        field: "text",
        delta: "The",
        part: { id: reasoningPartID, messageID, type: "text", text: "The", delta: "The" },
      },
    },
    {
      type: "message.part.updated",
      properties: {
        part: {
          id: reasoningPartID,
          messageID,
          type: "reasoning",
          text: "The user is testing a permission request.",
        },
      },
    },
  ]);

  assert.deepEqual(chunks, []);
});
