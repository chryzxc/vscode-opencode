import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  coalesceWebviewStreamDelta,
  compactWebviewStreamDeltaForTransport,
} from "../../src/providers/chat/streamEventCoalescing";

function deltaEvent(
  delta: string,
  overrides: {
    field?: string;
    messageID?: string;
    partID?: string;
    sessionId?: string;
  } = {},
) {
  const field = overrides.field ?? "text";
  const messageID = overrides.messageID ?? "msg-1";
  const partID = overrides.partID ?? "part-1";
  const sessionId = overrides.sessionId ?? "session-1";
  return {
    sessionId,
    event: {
      type: "message.part.updated",
      properties: {
        sessionID: sessionId,
        messageID,
        partID,
        field,
        delta,
        part: {
          id: partID,
          sessionID: sessionId,
          messageID,
          type: field === "text" ? "text" : field,
          [field]: delta,
          delta,
        },
      },
    },
  };
}

describe("coalesceWebviewStreamDelta", () => {
  it("merges adjacent adapted deltas for the same response part", () => {
    const queue = [deltaEvent("Hello")];

    assert.strictEqual(coalesceWebviewStreamDelta(queue, deltaEvent(" world")), true);
    assert.strictEqual(queue.length, 1);
    const properties = (queue[0].event as any).properties;
    assert.strictEqual(properties.delta, "Hello world");
    assert.strictEqual(properties.part.text, "Hello world");
    assert.strictEqual(properties.part.delta, "Hello world");
  });

  it("keeps reasoning deltas separate from response text while coalescing each identity", () => {
    const queue = [deltaEvent("Think", { field: "reasoning" })];

    assert.strictEqual(
      coalesceWebviewStreamDelta(queue, deltaEvent("ing", { field: "reasoning" })),
      true,
    );
    assert.strictEqual((queue[0].event as any).properties.delta, "Thinking");
    assert.strictEqual(
      coalesceWebviewStreamDelta(queue, deltaEvent("Answer", { field: "text" })),
      false,
    );
  });

  it("does not merge different messages, parts, sessions, or immediate events", () => {
    const variants = [
      deltaEvent("next", { messageID: "msg-2" }),
      deltaEvent("next", { partID: "part-2" }),
      deltaEvent("next", { sessionId: "session-2" }),
      { ...deltaEvent("next"), immediate: true },
    ];

    for (const incoming of variants) {
      assert.strictEqual(
        coalesceWebviewStreamDelta([deltaEvent("first")], incoming),
        false,
      );
    }
  });

  it("does not merge full snapshots, tool events, or structured payloads", () => {
    const fullSnapshot = deltaEvent("snapshot");
    (fullSnapshot.event.properties.part as any).text = "full accumulated snapshot";
    const toolEvent = {
      sessionId: "session-1",
      event: {
        type: "message.part.updated",
        properties: {
          part: { id: "tool-1", type: "tool", state: { status: "running" } },
        },
      },
    };
    const structured = deltaEvent("question");
    (structured.event as any).structuredOutput = { responseType: "question" };

    assert.strictEqual(
      coalesceWebviewStreamDelta([deltaEvent("first")], fullSnapshot),
      false,
    );
    assert.strictEqual(
      coalesceWebviewStreamDelta([deltaEvent("first")], toolEvent),
      false,
    );
    assert.strictEqual(
      coalesceWebviewStreamDelta([deltaEvent("first")], structured),
      false,
    );
  });
});

describe("compactWebviewStreamDeltaForTransport", () => {
  it("keeps one delta string plus the part identity required by the webview", () => {
    const input = deltaEvent("Hello world");
    const compacted = compactWebviewStreamDeltaForTransport(input.event) as any;

    assert.strictEqual(compacted.properties.delta, "Hello world");
    assert.strictEqual(compacted.properties.part.id, "part-1");
    assert.strictEqual(compacted.properties.part.messageID, "msg-1");
    assert.strictEqual(compacted.properties.part.type, "text");
    assert.strictEqual(compacted.properties.part.text, undefined);
    assert.strictEqual(compacted.properties.part.delta, undefined);
    assert.strictEqual((input.event.properties.part as any).text, "Hello world");
  });

  it("returns non-delta and structured events unchanged", () => {
    const tool = {
      type: "message.part.updated",
      properties: { part: { id: "tool-1", type: "tool" } },
    };
    const structured = deltaEvent("question").event as any;
    structured.structuredOutput = { responseType: "question" };

    assert.strictEqual(compactWebviewStreamDeltaForTransport(tool), tool);
    assert.strictEqual(compactWebviewStreamDeltaForTransport(structured), structured);
  });
});
