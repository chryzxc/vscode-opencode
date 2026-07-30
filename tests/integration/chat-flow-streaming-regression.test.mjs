import assert from "node:assert/strict";
import test from "node:test";

import {
  simulateMessageSend,
  withConversationTest,
} from "./conversation-flow/helpers/conversation-test-utils.mjs";

const sessionId = "ses-stream-contract";

function partEvent({ messageID, partID, part, time }) {
  return {
    type: "message.part.updated",
    properties: {
      sessionID: sessionId,
      messageID,
      part: { id: partID, sessionID: sessionId, messageID, ...part },
      time,
    },
  };
}

function messageUpdated({ messageID, text, structured, time }) {
  return {
    type: "message.updated",
    properties: {
      sessionID: sessionId,
      message: {
        id: messageID,
        sessionID: sessionId,
        role: "assistant",
        content: text,
        text,
        ...(structured ? { structured } : {}),
        time: { created: time },
      },
    },
  };
}

test("chat flow keeps every activity event across assistant step phases", async () => {
  const events = [
    partEvent({ messageID: "msg-phase-1", partID: "part-step-1", part: { type: "step-start" }, time: 1 }),
    partEvent({
      messageID: "msg-phase-1",
      partID: "part-tool-1",
      part: { type: "tool", tool: "read", callID: "call-read-1", state: { status: "completed", input: { file: "Arena.tsx" } } },
      time: 2,
    }),
    partEvent({ messageID: "msg-phase-1", partID: "part-step-finish-1", part: { type: "step-finish", reason: "tool-calls" }, time: 3 }),
    // A new SDK assistant phase belongs to the same visible turn. It appends;
    // it must not replace the already-forwarded first phase.
    partEvent({ messageID: "msg-phase-2", partID: "part-step-2", part: { type: "step-start" }, time: 4 }),
    partEvent({
      messageID: "msg-phase-2",
      partID: "part-tool-2",
      part: { type: "tool", tool: "bash", callID: "call-bash-2", state: { status: "completed", input: { command: "git diff --check" } } },
      time: 5,
    }),
    messageUpdated({ messageID: "msg-phase-2", text: "Verified the patch.", time: 6 }),
  ];

  await withConversationTest(async (env) => {
    await simulateMessageSend(env, "Inspect the arena", { sessionId, streamEvents: events });

    const forwarded = env.mocks.webview._getMessagesByType("streamEvent").map((message) => message.event);
    assert.equal(forwarded.length, events.length);
    assert.deepEqual(
      forwarded.map((event) => event.properties.part?.id ?? event.properties.message?.id),
      ["part-step-1", "part-tool-1", "part-step-finish-1", "part-step-2", "part-tool-2", "msg-phase-2"],
      "a later step-start must not clear or reorder already-forwarded activity rows",
    );
    assert.equal(forwarded[1].properties.part.state.input.file, "Arena.tsx");
    assert.equal(forwarded[4].properties.part.state.input.command, "git diff --check");
  });
});

test("chat flow keeps response-card data scoped to its assistant phase", async () => {
  const structured = { type: "message", text: "Final response from phase two.", walkthrough: { title: "Verification" } };
  const events = [
    partEvent({ messageID: "msg-phase-1", partID: "part-response-1", part: { type: "text", text: "Earlier phase response." }, time: 10 }),
    messageUpdated({ messageID: "msg-phase-1", text: "Earlier phase response.", time: 11 }),
    partEvent({ messageID: "msg-phase-2", partID: "part-response-2", part: { type: "text", text: structured.text }, time: 12 }),
    messageUpdated({ messageID: "msg-phase-2", text: structured.text, structured, time: 13 }),
  ];

  await withConversationTest(async (env) => {
    await simulateMessageSend(env, "Finish the change", { sessionId, streamEvents: events });

    const completions = env.mocks.webview
      ._getMessagesByType("streamEvent")
      .map((message) => message.event)
      .filter((event) => event.type === "message.updated");
    assert.equal(completions.length, 2);
    assert.equal(completions[0].properties.message.id, "msg-phase-1");
    assert.equal(completions[0].properties.message.text, "Earlier phase response.");
    assert.equal(completions[1].properties.message.id, "msg-phase-2");
    assert.equal(completions[1].properties.message.structured.text, structured.text);
    assert.equal(completions[0].properties.message.structured, undefined);
  });
});
