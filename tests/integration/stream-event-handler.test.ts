import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestLogger, captureMessages } from "./helpers/test-utils.js";

function createStubStructuredOutputProcessor() {
  return {
    enrichStreamEvent: (event: any) => {
      if (!event) return event;
      const enriched = { ...event };
      const properties = event.properties || {};
      const part = properties.part || {};
      const candidate = part.structured || properties.structured;
      if (candidate) {
        enriched.structured = candidate;
        enriched.structuredOutput = candidate;
        enriched.hasStructuredOutput = true;
      }
      return enriched;
    },
    normalizeStructuredOutput: (raw: any) => raw,
    applyStructuredOutputToMessage: (msg: any, s: any) => ({ ...msg, structuredOutput: s }),
    extractStructuredOutput: (msg: any) => msg?.structuredOutput,
  };
}

function createStubSubagentPersistence() {
  const calls: any[] = [];
  return {
    persistSubagentUpdateSnapshot: async (payload: any, sessionId: any, sessionService: any, postMessage: any) => {
      calls.push({ payload, sessionId, sessionService, postMessage });
    },
    _calls: calls,
  };
}

function createStubCompactionManager() {
  const calls: any[] = [];
  return {
    forwardCompactionStatusFromStreamEvent: (compaction: any) => {
      calls.push(compaction);
    },
    _calls: calls,
  };
}

function createStubDiagnosticsLogger() {
  const calls: any[] = [];
  return {
    logStreamEventDiagnostics: (event: any, enrichedEvent: any) => {
      calls.push({ event, enrichedEvent });
    },
    _calls: calls,
  };
}

function createStubGeminiTokenTracker() {
  const recordings: Array<{ model: string; usage: any }> = [];
  return {
    recordUsage: (model: string, usage: any) => {
      recordings.push({ model, usage });
    },
    _recordings: recordings,
  };
}

function createSubagentTracker() {
  const calls: any[] = [];
  return {
    consumeStreamEvent: (event: any) => {
      calls.push(event);
      return null;
    },
    _calls: calls,
  };
}

import { StreamEventHandler } from "../../src/providers/chat/StreamEventHandler.js";

function createStreamEventHandler() {
  const logger = createTestLogger();
  const structuredOutputProcessor = createStubStructuredOutputProcessor();
  const subagentPersistence = createStubSubagentPersistence();
  const compactionManager = createStubCompactionManager();
  const diagnosticsLogger = createStubDiagnosticsLogger();
  const geminiTokenTracker = createStubGeminiTokenTracker();
  const subagentTracker = createSubagentTracker();

  const handler = new StreamEventHandler(
    structuredOutputProcessor,
    subagentPersistence,
    compactionManager,
    diagnosticsLogger,
    geminiTokenTracker,
    subagentTracker,
    logger,
  );

  return {
    handler,
    logger,
    structuredOutputProcessor,
    subagentPersistence,
    compactionManager,
    diagnosticsLogger,
    geminiTokenTracker,
    subagentTracker,
  };
}

describe("StreamEventHandler", () => {
  describe("handleStreamEvent", () => {
    it("forwards enriched stream event to webview", async () => {
      const { handler } = createStreamEventHandler();
      const { postMessage, getMessages } = captureMessages();
      handler.setPostMessage(postMessage);
      handler.setGetCurrentSessionId(() => "session-1");

      await handler.handleStreamEvent({
        type: "message.part.updated",
        properties: {
          sessionID: "session-1",
          messageID: "msg-1",
        },
      });

      const msgs = getMessages();
      assert.ok(msgs.length >= 1, "should post at least one message");
      const streamMsg = msgs.find((m: any) => m.type === "streamEvent");
      assert.ok(streamMsg, "should have streamEvent message");
      assert.equal(streamMsg.sessionId, "session-1");
      assert.ok(streamMsg.event, "should include the event");
    });

    it("returns early for null event", async () => {
      const { handler } = createStreamEventHandler();
      const { postMessage, getMessages } = captureMessages();
      handler.setPostMessage(postMessage);

      await handler.handleStreamEvent(null);

      assert.equal(getMessages().length, 0, "should not post any messages");
    });

    it("returns early for undefined event", async () => {
      const { handler } = createStreamEventHandler();
      const { postMessage, getMessages } = captureMessages();
      handler.setPostMessage(postMessage);

      await handler.handleStreamEvent(undefined);

      assert.equal(getMessages().length, 0, "should not post any messages");
    });

    it("extracts sessionId from multiple locations", async () => {
      const { handler } = createStreamEventHandler();
      const { postMessage, getMessages } = captureMessages();
      handler.setPostMessage(postMessage);
      handler.setGetCurrentSessionId(() => "fallback-session");

      await handler.handleStreamEvent({
        type: "message.part.updated",
        properties: { sessionId: "from-properties" },
      });

      const msg1 = getMessages().find((m: any) => m.type === "streamEvent");
      assert.equal(msg1.sessionId, "from-properties");
    });

    it("falls back to getCurrentSessionId when event has no sessionId", async () => {
      const { handler } = createStreamEventHandler();
      const { postMessage, getMessages } = captureMessages();
      handler.setPostMessage(postMessage);
      handler.setGetCurrentSessionId(() => "fallback-session");

      await handler.handleStreamEvent({
        type: "message.part.updated",
        properties: {},
      });

      const msg = getMessages().find((m: any) => m.type === "streamEvent");
      assert.equal(msg.sessionId, "fallback-session");
    });

    it("forwards compaction status on message.completed", async () => {
      const { handler, compactionManager } = createStreamEventHandler();
      const { postMessage } = captureMessages();
      handler.setPostMessage(postMessage);
      handler.setGetCurrentSessionId(() => "session-1");

      const compactionData = { status: "completed", messageCount: 50 };
      await handler.handleStreamEvent({
        type: "message.completed",
        properties: { compaction: compactionData },
      });

      assert.equal(compactionManager._calls.length, 1);
      assert.deepEqual(compactionManager._calls[0], compactionData);
    });

    it("does not forward compaction for non-completed events", async () => {
      const { handler, compactionManager } = createStreamEventHandler();
      const { postMessage } = captureMessages();
      handler.setPostMessage(postMessage);
      handler.setGetCurrentSessionId(() => "session-1");

      await handler.handleStreamEvent({
        type: "message.part.updated",
        properties: { compaction: { status: "completed" } },
      });

      assert.equal(compactionManager._calls.length, 0, "should not forward compaction for part events");
    });

    it("records token usage when properties.usage is present", async () => {
      const { handler, geminiTokenTracker } = createStreamEventHandler();
      const { postMessage } = captureMessages();
      handler.setPostMessage(postMessage);
      handler.setGetCurrentSessionId(() => "session-1");

      await handler.handleStreamEvent({
        type: "message.updated",
        properties: {
          usage: { inputTokens: 100, outputTokens: 50 },
          info: {
            providerID: "openai",
            modelID: "gpt-4",
          },
        },
      });

      assert.equal(geminiTokenTracker._recordings.length, 1);
      assert.equal(geminiTokenTracker._recordings[0].model, "openai/gpt-4");
      assert.deepEqual(geminiTokenTracker._recordings[0].usage, { inputTokens: 100, outputTokens: 50 });
    });

    it("records token usage with unknown provider when info is missing", async () => {
      const { handler, geminiTokenTracker } = createStreamEventHandler();
      const { postMessage } = captureMessages();
      handler.setPostMessage(postMessage);
      handler.setGetCurrentSessionId(() => "session-1");

      await handler.handleStreamEvent({
        type: "message.updated",
        properties: {
          usage: { tokens: 42 },
        },
      });

      assert.equal(geminiTokenTracker._recordings.length, 1);
      assert.equal(geminiTokenTracker._recordings[0].model, "unknown/unknown");
    });

    it("calls diagnostics logger for each event", async () => {
      const { handler, diagnosticsLogger } = createStreamEventHandler();
      const { postMessage } = captureMessages();
      handler.setPostMessage(postMessage);
      handler.setGetCurrentSessionId(() => "session-1");

      await handler.handleStreamEvent({
        type: "message.part.updated",
        properties: { sessionID: "s1" },
      });

      assert.equal(diagnosticsLogger._calls.length, 1);
    });

    it("persists subagent updates when subagentsDelta is present", async () => {
      const { handler, subagentPersistence } = createStreamEventHandler();
      const { postMessage } = captureMessages();
      handler.setPostMessage(postMessage);
      handler.setGetCurrentSessionId(() => "session-1");

      const delta = { summariesByParentMessageId: { "msg-1": {} } };
      await handler.handleStreamEvent({
        type: "message.part.updated",
        properties: { subagentsDelta: delta },
      });

      assert.equal(subagentPersistence._calls.length, 1);
      assert.deepEqual(subagentPersistence._calls[0].payload, delta);
    });

    it("persists subagent updates from enriched structured.subagentsDelta", async () => {
      const { handler, subagentPersistence } = createStreamEventHandler();
      const { postMessage } = captureMessages();
      handler.setPostMessage(postMessage);
      handler.setGetCurrentSessionId(() => "session-1");

      const delta = { summariesByParentMessageId: { "msg-1": {} } };
      await handler.handleStreamEvent({
        type: "message.part.updated",
        properties: {
          structured: {
            subagentsDelta: delta,
          },
        },
      });

      assert.equal(subagentPersistence._calls.length, 1);
    });
  });

  describe("startStream / endStream", () => {
    it("logs stream start with session and message ID", () => {
      const { handler, logger } = createStreamEventHandler();

      handler.startStream("session-1", "msg-1");

      const infoLogs = logger.getEntriesByLevel("info");
      const startLog = infoLogs.find((e: any) => e.message === "AI stream started");
      assert.ok(startLog, "should log 'AI stream started'");
      assert.equal(startLog.context?.sessionId, "session-1");
      assert.equal(startLog.context?.messageId, "msg-1");
    });

    it("logs stream end with duration and event count", () => {
      const { handler, logger } = createStreamEventHandler();

      handler.startStream("session-1", "msg-1");
      handler.endStream("session-1", "msg-1", true);

      const infoLogs = logger.getEntriesByLevel("info");
      const endLog = infoLogs.find((e: any) => e.message === "AI stream ended");
      assert.ok(endLog, "should log 'AI stream ended'");
      assert.equal(endLog.context?.sessionId, "session-1");
      assert.equal(endLog.context?.success, true);
      assert.ok(typeof endLog.context?.duration === "number");
    });

    it("logs performance metrics on stream end", () => {
      const { handler, logger } = createStreamEventHandler();

      handler.startStream("session-1", "msg-1");
      handler.endStream("session-1", "msg-1", true);

      const perfLogs = logger.getEntries().filter((e: any) => e.level === "performance");
      assert.ok(perfLogs.length >= 1, "should have performance log");
      assert.equal(perfLogs[0].message, "ai-stream");
    });

    it("warns when endStream called without startStream", () => {
      const { handler, logger } = createStreamEventHandler();

      handler.endStream("session-1", "msg-1", false);

      const warnLogs = logger.getEntriesByLevel("warn");
      const warnLog = warnLogs.find((e: any) => e.message === "Stream ended but never started");
      assert.ok(warnLog, "should warn about stream end without start");
    });

    it("resets state after endStream", () => {
      const { handler, logger } = createStreamEventHandler();

      handler.startStream("session-1", "msg-1");
      handler.endStream("session-1", "msg-1", true);
      logger.clear();

      handler.endStream("session-1", "msg-2", true);
      const warnLogs = logger.getEntriesByLevel("warn");
      assert.ok(warnLogs.length >= 1, "should warn because state was reset");
    });
  });

  describe("logStructuredOutputProcessing", () => {
    it("logs structured output details", () => {
      const { handler, logger } = createStreamEventHandler();

      handler.logStructuredOutputProcessing("session-1", "msg-1", {
        responseType: "implementation_plan",
        plan: { file: "/path/to/plan.md" },
        progressUpdates: [],
        interactiveEvents: [],
      });

      const infoLogs = logger.getEntriesByLevel("info");
      const log = infoLogs.find((e: any) => e.message === "Structured output processed");
      assert.ok(log, "should log structured output processing");
      assert.equal(log.context?.responseType, "implementation_plan");
      assert.equal(log.context?.hasPlan, true);
      assert.equal(log.context?.hasProgressUpdates, false);
      assert.equal(log.context?.hasInteractiveEvents, false);
    });
  });
});
