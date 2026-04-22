import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { QueueManager } from "../../src/providers/chat/QueueManager.js";
import type { QueuedPrompt } from "../../src/providers/chat/types.js";
import { createTestLogger, captureMessages } from "./helpers/test-utils.js";

function makePrompt(overrides?: Partial<QueuedPrompt>): QueuedPrompt {
  return {
    id: `prompt-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: "session-1",
    createdAt: Date.now(),
    text: "Hello world",
    ...overrides,
  };
}

describe("QueueManager", () => {
  let qm: QueueManager;
  let logger: ReturnType<typeof createTestLogger>;
  let messages: ReturnType<typeof captureMessages>;
  let sentTexts: string[];

  beforeEach(() => {
    logger = createTestLogger();
    messages = captureMessages();
    sentTexts = [];

    qm = new QueueManager(logger as any);
    qm.setPostMessage(messages.postMessage);
    qm.setHandleSendMessage(async (text) => {
      sentTexts.push(text);
    });
    qm.setGetCurrentSessionId(() => "session-1");
    qm.setHandleStopRequest(() => {});
  });

  describe("enqueuePrompt", () => {
    it("adds prompt to the back of the queue", () => {
      qm.enqueuePrompt(makePrompt({ text: "first" }));
      qm.enqueuePrompt(makePrompt({ text: "second" }));

      const state = qm.getQueueState();
      assert.equal(state.length, 2);
      assert.equal(state[0].text, "first");
      assert.equal(state[1].text, "second");
    });

    it("adds prompt to front when atFront=true", () => {
      qm.enqueuePrompt(makePrompt({ text: "first" }));
      qm.enqueuePrompt(makePrompt({ text: "priority" }), true);

      const state = qm.getQueueState();
      assert.equal(state.length, 2);
      assert.equal(state[0].text, "priority");
      assert.equal(state[1].text, "first");
    });
  });

  describe("getQueueState", () => {
    it("returns serializable queue items without images", () => {
      qm.enqueuePrompt(
        makePrompt({
          text: "hello",
          files: ["a.ts"],
          images: [{ dataUrl: "data:image/png;base64,abc123" }],
          agent: "explore",
        }),
      );

      const state = qm.getQueueState();
      assert.equal(state.length, 1);
      assert.equal(state[0].text, "hello");
      assert.deepEqual(state[0].files, ["a.ts"]);
      assert.equal(state[0].agent, "explore");
      assert.equal((state[0] as any).images, undefined, "images should be excluded");
    });

    it("returns empty array when queue is empty", () => {
      assert.deepEqual(qm.getQueueState(), []);
    });
  });

  describe("executeQueue", () => {
    it("executes all prompts in order", async () => {
      qm.enqueuePrompt(makePrompt({ text: "first" }));
      qm.enqueuePrompt(makePrompt({ text: "second" }));

      await qm.executeQueue(async (prompt) => {
        sentTexts.push(prompt.text);
      });

      assert.deepEqual(sentTexts, ["first", "second"]);
      assert.equal(qm.getQueueState().length, 0);
    });

    it("returns immediately when queue is empty", async () => {
      await qm.executeQueue(async () => {});
      assert.deepEqual(sentTexts, []);
    });

    it("prevents concurrent execution", async () => {
      qm.enqueuePrompt(makePrompt({ text: "a" }));
      qm.enqueuePrompt(makePrompt({ text: "b" }));

      let callCount = 0;
      const firstExecution = qm.executeQueue(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 50));
      });

      const secondExecution = qm.executeQueue(async () => {
        callCount++;
      });

      await Promise.all([firstExecution, secondExecution]);
      assert.equal(callCount, 2, "second call should be skipped due to isExecuting guard");
    });

    it("continues processing after a prompt fails", async () => {
      qm.enqueuePrompt(makePrompt({ text: "fail" }));
      qm.enqueuePrompt(makePrompt({ text: "succeed" }));

      await qm.executeQueue(async (prompt) => {
        if (prompt.text === "fail") throw new Error("boom");
        sentTexts.push(prompt.text);
      });

      assert.deepEqual(sentTexts, ["succeed"]);
      assert.equal(qm.getQueueState().length, 0);
    });
  });

  describe("clearQueue", () => {
    it("removes all items from the queue", () => {
      qm.enqueuePrompt(makePrompt());
      qm.enqueuePrompt(makePrompt());

      qm.clearQueue();
      assert.equal(qm.getQueueState().length, 0);
    });
  });

  describe("handleDispatchQueuedItem", () => {
    it("dispatches by ID", async () => {
      const prompt = makePrompt({ text: "dispatch me" });
      qm.enqueuePrompt(prompt);

      await qm.handleDispatchQueuedItem("send-now", "session-1", prompt.id);

      assert.deepEqual(sentTexts, ["dispatch me"]);
    });

    it("dispatches by index", async () => {
      qm.enqueuePrompt(makePrompt({ text: "indexed" }));

      await qm.handleDispatchQueuedItem("send-now", "session-1", undefined, 0);

      assert.deepEqual(sentTexts, ["indexed"]);
    });

    it("does nothing when no session ID available", async () => {
      qm.setGetCurrentSessionId(() => undefined);
      qm.enqueuePrompt(makePrompt({ text: "orphan" }));

      await qm.handleDispatchQueuedItem("send-now", undefined);

      assert.deepEqual(sentTexts, []);
    });

    it("does nothing for unknown ID", async () => {
      qm.enqueuePrompt(makePrompt());

      await qm.handleDispatchQueuedItem("send-now", "session-1", "nonexistent");

      assert.deepEqual(sentTexts, []);
    });
  });

  describe("handleRemoveFromQueue", () => {
    it("removes prompt by ID", async () => {
      const p1 = makePrompt({ text: "keep" });
      const p2 = makePrompt({ text: "remove" });
      qm.enqueuePrompt(p1);
      qm.enqueuePrompt(p2);

      await qm.handleRemoveFromQueue({ id: p2.id });

      const state = qm.getQueueState();
      assert.equal(state.length, 1);
      assert.equal(state[0].text, "keep");
    });

    it("does nothing for unknown ID", async () => {
      const p1 = makePrompt();
      qm.enqueuePrompt(p1);

      await qm.handleRemoveFromQueue({ id: "nonexistent" });

      assert.equal(qm.getQueueState().length, 1);
    });
  });

  describe("sendQueueUpdate", () => {
    it("posts queueUpdate message to webview", () => {
      qm.enqueuePrompt(makePrompt({ text: "hello" }));

      qm.sendQueueUpdate("session-1");

      const msg = messages.getLastMessage() as any;
      assert.equal(msg.type, "queueUpdate");
      assert.equal(msg.sessionId, "session-1");
      assert.equal(msg.queue.length, 1);
      assert.equal(msg.queue[0].text, "hello");
    });
  });
});
