import assert from "node:assert/strict";
import { test } from "node:test";

import { importWebviewModule } from "../helpers/webview-module.mjs";

const { normalizeMessage } = await importWebviewModule(
  "webview/shared/src/chat/lib/messageHandler.ts",
);

test("rehydrated SDK type/text structured output keeps the final AI response body", () => {
  const message = normalizeMessage(
    {
      info: {
        id: "msg_final-structured",
        sessionID: "ses_fixture",
        role: "assistant",
        parentID: "msg_user",
        time: { created: 1785335492489, completed: 1785335505969 },
        structured: {
          type: "message",
          text: "Updated WASD movement to be relative to the Adventurer’s facing direction.",
          walkthrough: {
            title: "Facing-Relative WASD Movement",
            file: ".opencode/artifacts/walkthroughs/facing-relative-wasd-movement-walkthrough.md",
          },
        },
        finish: "tool-calls",
      },
      parts: [
        {
          id: "part_structured_output",
          messageID: "msg_final-structured",
          type: "tool",
          tool: "StructuredOutput",
          state: { status: "completed" },
        },
      ],
    },
    null,
  );

  assert.equal(
    message?.structuredOutput?.responseType,
    "message",
    "the SDK type must normalize to the response type",
  );
  assert.match(
    message?.structuredOutput?.message ?? "",
    /Updated WASD movement/,
    "the SDK text must remain available as the final rendered response body",
  );
});
