import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { HistoryProcessor } from "../../src/providers/chat/HistoryProcessor.js";
import { StructuredOutputProcessor } from "../../src/providers/chat/StructuredOutputProcessor.js";
import { PlanManager } from "../../src/providers/chat/PlanManager.js";
import {
  createTestLogger,
  createTestMemento,
  firstNonEmptyString,
} from "./helpers/test-utils.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function extractMessageBodyText(message: unknown): string {
  const record = asRecord(message);
  if (!record) {
    return "";
  }

  const direct = firstNonEmptyString(record.text, record.content);
  if (direct) {
    return direct;
  }

  const structuredOutput = asRecord(record.structuredOutput);
  const structuredMessage = firstNonEmptyString(structuredOutput?.message);
  if (structuredMessage) {
    return structuredMessage;
  }

  const parts = Array.isArray(record.parts) ? record.parts : [];
  const text = parts
    .map((part) => {
      const partRecord = asRecord(part);
      return firstNonEmptyString(partRecord?.text, partRecord?.content) ?? "";
    })
    .filter((value) => value.length > 0)
    .join("\n");

  return text;
}

function createCompatibleLogger(): ReturnType<
  typeof import("../../src/utils/Logger.js").createLogger
> {
  const base = createTestLogger();

  return {
    error: (message, context, error) => {
      base.error(message, context, error);
    },
    warn: (message, context) => {
      base.warn(message, context);
    },
    info: (message, context) => {
      base.info(message, context);
    },
    debug: (message, context) => {
      base.debug(message, context);
    },
    aiRequest: () => {},
    aiResponse: () => {},
    aiStreamEvent: () => {},
    tokenUsage: () => {},
    serverEvent: () => {},
    sessionEvent: () => {},
    startFeatureFlow: (name, meta) => base.startFeatureFlow(name, meta),
    endFeatureFlow: () => undefined,
    getActiveFeatureFlow: () => undefined,
    featureStep: (id, step, meta) => {
      base.featureStep(id, step, meta);
    },
    logStateChange: (what, from, to, reason) => {
      base.logStateChange(what, from, to, reason);
    },
    logUIInteraction: (_component, _action, _element, _payload) => {},
    performance: (label, durationMs, meta) => {
      base.performance(label, durationMs, meta);
    },
  };
}

function createCompatibleMemento(): vscode.Memento {
  const base = createTestMemento();

  return {
    get: <T>(key: string, defaultValue?: T) => {
      if (arguments.length === 2) {
        return base.get(key, defaultValue as T);
      }
      return base.get<T>(key);
    },
    keys: () => base.keys,
    update: (key, value) => base.update(key, value),
  };
}

function createHistoryProcessor() {
  const logger = createCompatibleLogger();
  const workspaceState = createCompatibleMemento();
  const planManager = new PlanManager(logger, firstNonEmptyString, workspaceState);
  const structuredOutputProcessor = new StructuredOutputProcessor(
    logger,
    asRecord,
    firstNonEmptyString,
    planManager,
  );

  return new HistoryProcessor(
    workspaceState,
    logger,
    structuredOutputProcessor,
    asRecord,
    firstNonEmptyString,
    () => false,
    extractMessageBodyText,
    undefined,
  );
}

describe("HistoryProcessor", () => {
  let processor: HistoryProcessor;

  beforeEach(() => {
    processor = createHistoryProcessor();
  });

  describe("getMessageOverrideStorageKey", () => {
    it("prefixes the message id with the override namespace", () => {
      assert.equal(
        processor.getMessageOverrideStorageKey("msg-123"),
        "opencode.messageOverride.msg-123",
      );
    });
  });

  describe("extractHistoryMessageId", () => {
    it("prefers id, then messageId, then info.id", () => {
      assert.equal(
        processor.extractHistoryMessageId({
          id: "direct-id",
          messageId: "secondary-id",
          info: { id: "nested-id" },
        }),
        "direct-id",
      );

      assert.equal(
        processor.extractHistoryMessageId({
          messageId: "secondary-id",
          info: { id: "nested-id" },
        }),
        "secondary-id",
      );

      assert.equal(
        processor.extractHistoryMessageId({
          messageId: "   ",
          info: { id: "nested-id" },
        }),
        "nested-id",
      );
    });

    it("returns undefined when no identifier exists", () => {
      assert.equal(processor.extractHistoryMessageId(undefined), undefined);
      assert.equal(processor.extractHistoryMessageId({}), undefined);
    });
  });

  describe("historyMessageFingerprint", () => {
    it("builds a fingerprint from id, role, and truncated content", () => {
      const content = "x".repeat(140);
      const result = processor.historyMessageFingerprint({
        id: "msg-1",
        role: "assistant",
        content,
      });

      assert.equal(
        result,
        `id:msg-1|role:assistant|content:${content.slice(0, 100)}`,
      );
    });

    it("returns undefined when id, role, and content are all absent", () => {
      assert.equal(processor.historyMessageFingerprint({}), undefined);
      assert.equal(processor.historyMessageFingerprint(null), undefined);
    });
  });

  describe("isRenderableHistoryMessage", () => {
    it("returns false for nullish or empty payloads", () => {
      assert.equal(processor.isRenderableHistoryMessage(null), false);
      assert.equal(processor.isRenderableHistoryMessage(undefined), false);
      assert.equal(
        processor.isRenderableHistoryMessage({ role: "assistant", content: "   " }),
        false,
      );
    });

    it("keeps assistant messages that only contain parts", () => {
      const result = processor.isRenderableHistoryMessage({
        role: "assistant",
        parts: [{ type: "text", text: "Question body" }],
      });

      assert.equal(result, true);
    });

    it("keeps internal system reminders renderable", () => {
      const result = processor.isRenderableHistoryMessage({
        role: "system",
        content: "[background task completed] Test run finished",
      });

      assert.equal(result, true);
    });

    it("treats structured output and activity payloads as renderable", () => {
      assert.equal(
        processor.isRenderableHistoryMessage({
          role: "assistant",
          structuredOutput: { responseType: "message", message: "Hello" },
        }),
        true,
      );
      assert.equal(
        processor.isRenderableHistoryMessage({
          role: "assistant",
          progressUpdates: [{ title: "Running checks" }],
        }),
        true,
      );
    });
  });

  describe("dedupeMirrorHistoryMessages", () => {
    it("removes later duplicates with the same fingerprint", () => {
      const messages = [
        { id: "a", role: "assistant", content: "Hello" },
        { id: "a", role: "assistant", content: "Hello" },
        { id: "b", role: "assistant", content: "Hello" },
      ];

      const result = processor.dedupeMirrorHistoryMessages(messages);

      assert.deepEqual(result, [messages[0], messages[2]]);
    });

    it("keeps messages that do not produce a fingerprint", () => {
      const idlessA = { metadata: { unseen: true } };
      const idlessB = { metadata: { unseen: true } };

      const result = processor.dedupeMirrorHistoryMessages([idlessA, idlessB]);

      assert.deepEqual(result, [idlessA, idlessB]);
    });
  });

  describe("mergeAdjacentAssistantActivityMessages", () => {
    it("merges adjacent activity-only assistant messages with the same id", () => {
      const result = processor.mergeAdjacentAssistantActivityMessages([
        {
          id: "assistant-1",
          role: "assistant",
          progressUpdates: [{ title: "Started" }],
          parts: [{ type: "activity", marker: "started" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          subagents: [{ id: "sub-1", name: "Explore" }],
          parts: [{ type: "activity", marker: "spawned-subagent" }],
        },
      ]);

      assert.equal(result.length, 1);
      assert.deepEqual(result[0].parts, [
        { type: "activity", marker: "started" },
        { type: "activity", marker: "spawned-subagent" },
      ]);
      assert.equal(result[0].content, "");
    });

    it("does not merge activity messages when ids differ or adjacency is broken", () => {
      const first = {
        id: "assistant-1",
        role: "assistant",
        progressUpdates: [{ title: "Started" }],
      };
      const barrier = { role: "user", content: "continue" };
      const third = {
        id: "assistant-2",
        role: "assistant",
        subagents: [{ id: "sub-1", name: "Explore" }],
      };

      const result = processor.mergeAdjacentAssistantActivityMessages([
        first,
        barrier,
        third,
      ]);

      assert.deepEqual(result, [first, barrier, third]);
    });
  });

  describe("mergeConsecutiveAssistantBursts", () => {
    it("coalesces assistant activity with a final reply when they share an id", () => {
      const result = processor.mergeConsecutiveAssistantBursts([
        {
          id: "assistant-1",
          role: "assistant",
          progressUpdates: [{ title: "Searching" }],
          subagents: [{ id: "sub-1", name: "Explore" }],
          rawResponse: "partial-response",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Final answer",
          parts: [{ type: "text", text: "Final answer" }],
          reasoning: ["step one"],
          rawResponse: "final-response",
        },
      ]);

      assert.equal(result.length, 1);
      assert.equal(result[0].content, "Final answer");
      assert.deepEqual(result[0].progressUpdates, [{ title: "Searching" }]);
      assert.deepEqual(result[0].subagents, [{ id: "sub-1", name: "Explore" }]);
      assert.deepEqual(result[0].parts, [{ type: "text", text: "Final answer" }]);
      assert.equal(result[0].rawResponse, "final-response");
    });

    it("does not merge distinct user-facing assistant replies", () => {
      const first = { id: "assistant-1", role: "assistant", content: "First reply" };
      const second = { id: "assistant-1", role: "assistant", content: "Second reply" };

      const result = processor.mergeConsecutiveAssistantBursts([first, second]);

      assert.deepEqual(result, [first, second]);
    });

    it("flushes an assistant burst before a non-assistant message", () => {
      const assistant = {
        id: "assistant-1",
        role: "assistant",
        progressUpdates: [{ title: "Searching" }],
      };
      const user = { role: "user", content: "Thanks" };

      const result = processor.mergeConsecutiveAssistantBursts([assistant, user]);

      assert.deepEqual(result, [assistant, user]);
    });
  });

  describe("getLatestAssistantHistoryMarker", () => {
    it("returns an empty marker for empty input or missing assistant messages", () => {
      assert.deepEqual(processor.getLatestAssistantHistoryMarker([]), {
        id: undefined,
        fingerprint: undefined,
        createdAt: undefined,
        richness: -1,
      });

      assert.deepEqual(
        processor.getLatestAssistantHistoryMarker([{ role: "user", content: "hi" }]),
        {
          id: undefined,
          fingerprint: undefined,
          createdAt: undefined,
          richness: -1,
        },
      );
    });

    it("selects the richest assistant message rather than the newest one", () => {
      const sparse = {
        id: "assistant-1",
        role: "assistant",
        content: "Short",
        createdAt: 2_000,
      };
      const rich = {
        id: "assistant-2",
        role: "assistant",
        content: "A".repeat(600),
        subagents: [{ id: "sub-1", name: "Explore" }],
        structuredOutput: { responseType: "message", message: "A".repeat(600) },
        createdAt: 1_000,
      };

      const result = processor.getLatestAssistantHistoryMarker([sparse, rich]);

      assert.equal(result.id, "assistant-2");
      assert.equal(result.createdAt, 1_000);
      assert.equal(
        result.fingerprint,
        `id:assistant-2|role:assistant|content:${"A".repeat(100)}`,
      );
      assert.ok(result.richness > 10);
    });
  });

  describe("hasAssistantHistoryAdvanced", () => {
    it("returns false when the current marker cannot be resolved", () => {
      assert.equal(processor.hasAssistantHistoryAdvanced([], []), false);
      assert.equal(processor.hasAssistantHistoryAdvanced(undefined, undefined), false);
    });

    it("returns true when current assistant history exists but previous is absent", () => {
      assert.equal(
        processor.hasAssistantHistoryAdvanced(
          [{ id: "assistant-1", role: "assistant", content: "Hello" }],
          [],
        ),
        true,
      );
    });

    it("returns true when assistant id or fingerprint changes", () => {
      assert.equal(
        processor.hasAssistantHistoryAdvanced(
          { id: "assistant-2", fingerprint: "new", createdAt: 2_000, richness: 5 },
          { id: "assistant-1", fingerprint: "old", createdAt: 1_000, richness: 5 },
        ),
        true,
      );
    });

    it("returns true when createdAt advances by more than one second", () => {
      assert.equal(
        processor.hasAssistantHistoryAdvanced(
          { id: "assistant-1", fingerprint: "same", createdAt: 3_500, richness: 5 },
          { id: "assistant-1", fingerprint: "same", createdAt: 2_000, richness: 5 },
        ),
        true,
      );
    });

    it("returns false when the marker is effectively unchanged", () => {
      assert.equal(
        processor.hasAssistantHistoryAdvanced(
          { id: "assistant-1", fingerprint: "same", createdAt: 2_500, richness: 10 },
          { id: "assistant-1", fingerprint: "same", createdAt: 2_000, richness: 4 },
        ),
        false,
      );
    });

    it("returns true when richness jumps by more than twelve", () => {
      assert.equal(
        processor.hasAssistantHistoryAdvanced(
          { id: "assistant-1", fingerprint: "same", createdAt: 2_500, richness: 20 },
          { id: "assistant-1", fingerprint: "same", createdAt: 2_000, richness: 7 },
        ),
        true,
      );
    });
  });
});
