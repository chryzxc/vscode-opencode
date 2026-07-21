import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SubagentTracker } from "../../src/services/SubagentTracker.js";
import { StructuredOutputProcessor } from "../../src/providers/chat/StructuredOutputProcessor.js";
import { StreamEventHandler } from "../../src/providers/chat/StreamEventHandler.js";
import { createTestLogger, captureMessages } from "./helpers/test-utils.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function createStubPlanManager() {
  return {
    persistPlan: async () => undefined,
    collectPlanFileCandidatesFromStructuredPlan: () => [],
    prioritizePlanFileCandidates: (c: string[]) => c,
    resolvePlanTitle: (opts: any) => firstNonEmptyString(opts?.fallback) || "Untitled Plan",
    isLikelyPlanMarkdownFile: () => false,
    extractMarkdownFileReferences: () => [],
  };
}

function createStubSubagentPersistence() {
  const calls: any[] = [];
  return {
    persistSubagentUpdateSnapshot: async (payload: any, sid: any) => {
      calls.push({ payload, sid });
    },
    _calls: calls,
  };
}

function createStubCompactionManager() {
  const calls: any[] = [];
  return { forwardCompactionStatusFromStreamEvent: (c: any) => calls.push(c), _calls: calls };
}

function createStubDiagnosticsLogger() {
  return { logStreamEventDiagnostics: () => {} };
}

function createStubGeminiTokenTracker() {
  const recordings: any[] = [];
  return { recordUsage: (m: string, u: any) => recordings.push({ m, u }), _recordings: recordings };
}

function createStubSessionService() {
  const appendedRawSdkEvents: Array<{ sessionId: string; payload: any }> = [];
  const flushedSessions: string[] = [];
  return {
    appendRawSdkEventPayload: async (sessionId: string, payload: any) => {
      appendedRawSdkEvents.push({ sessionId, payload });
    },
    flushRawSdkEventPayloads: async (sessionId: string) => {
      flushedSessions.push(sessionId);
    },
    _appendedRawSdkEvents: appendedRawSdkEvents,
    _flushedSessions: flushedSessions,
  };
}

function getStreamEntries(getMessagesByType: (type: string) => any[]): any[] {
  const single = getMessagesByType("streamEvent").map((message) => ({
    event: message.event,
    sessionId: message.sessionId,
  }));
  const batched = getMessagesByType("streamEventBatch").flatMap((message) => message.events);
  return [...single, ...batched];
}

function flattenStreamMessages(messages: any[]): any[] {
  const entries: any[] = [];
  for (const message of messages) {
    if (message?.type === "streamEvent") {
      entries.push({ event: message.event, sessionId: message.sessionId });
    } else if (message?.type === "streamEventBatch" && Array.isArray(message.events)) {
      entries.push(...message.events);
    }
  }
  return entries;
}

function setupFlow() {
  const logger = createTestLogger();
  const planManager = createStubPlanManager();
  const structuredOutputProcessor = new StructuredOutputProcessor(
    logger, asRecord, firstNonEmptyString, planManager,
  );
  const subagentTracker = new SubagentTracker();
  const subagentPersistence = createStubSubagentPersistence();
  const compactionManager = createStubCompactionManager();
  const diagnosticsLogger = createStubDiagnosticsLogger();
  const geminiTokenTracker = createStubGeminiTokenTracker();
  const sessionService = createStubSessionService();
  const { postMessage, getMessages, getMessagesByType } = captureMessages();

  const streamHandler = new StreamEventHandler(
    structuredOutputProcessor,
    subagentPersistence,
    compactionManager,
    diagnosticsLogger,
    geminiTokenTracker,
    sessionService as any,
    logger,
  );
  streamHandler.setPostMessage(postMessage);
  streamHandler.setGetCurrentSessionId(() => "session-1");

  return {
    structuredOutputProcessor,
    subagentTracker,
    streamHandler,
    subagentPersistence,
    compactionManager,
    geminiTokenTracker,
    sessionService,
    getMessages,
    getMessagesByType,
    logger,
  };
}

describe("cross-module flow", () => {
  describe("streaming event → structured output → webview", () => {
    it("processes a text message stream event end-to-end", async () => {
      const { streamHandler, getMessagesByType } = setupFlow();

      await streamHandler.handleStreamEvent({
        type: "message.completed",
        properties: {
          sessionID: "session-1",
          messageID: "msg-1",
          part: { type: "text", text: "Hello world" },
        },
      });

      const streamMsgs = getMessagesByType("streamEvent");
      assert.ok(streamMsgs.length >= 1);
      assert.equal(streamMsgs[0].sessionId, "session-1");
    });

    it("processes a structured output event through SOP → webview", async () => {
      const { streamHandler, getMessagesByType } = setupFlow();

      await streamHandler.handleStreamEvent({
        type: "message.completed",
        properties: {
          sessionID: "session-1",
          messageID: "msg-2",
          part: {
            type: "text",
            text: JSON.stringify({
              responseType: "message",
              message: "Structured response",
            }),
            structured: {
              responseType: "message",
              message: "Structured response",
            },
          },
        },
      });

      const streamMsgs = getMessagesByType("streamEvent");
      assert.ok(streamMsgs.length >= 1);
      const lastMsg = streamMsgs[streamMsgs.length - 1];
      assert.ok(lastMsg.event);
      assert.ok(lastMsg.event.hasStructuredOutput);
    });

    it("processes a plan structured output end-to-end", async () => {
      const { streamHandler, getMessagesByType } = setupFlow();

      await streamHandler.handleStreamEvent({
        type: "message.completed",
        properties: {
          sessionID: "session-1",
          messageID: "msg-3",
          part: {
            type: "text",
            structured: {
              responseType: "implementation_plan",
              message: "Here's the plan",
              plan: { file: "./plan.md", title: "Refactor Auth" },
            },
          },
        },
      });

      const streamMsgs = getMessagesByType("streamEvent");
      assert.ok(streamMsgs.length >= 1);
      const lastEvent = streamMsgs[streamMsgs.length - 1].event;
      assert.ok(lastEvent.hasStructuredOutput);
      assert.equal(lastEvent.structuredOutput.responseType, "implementation_plan");
      assert.equal(lastEvent.structuredOutput.plan.file, "./plan.md");
    });
  });

  describe("streaming event → subagent tracking → persistence", () => {
    it("tracks subagent creation through direct tracker + handler pipeline", async () => {
      const { streamHandler, subagentTracker, getMessagesByType } = setupFlow();

      subagentTracker.resetForSession("session-1");

      subagentTracker.consumeStreamEvent({
        type: "message.part.updated",
        properties: {
          sessionID: "session-1",
          messageID: "msg-1",
          part: {
            type: "subtask",
            sessionID: "session-1",
            messageID: "msg-1",
            id: "part-1",
            description: "Explore the codebase",
            prompt: "Find all auth files",
          },
        },
      });

      await streamHandler.handleStreamEvent({
        type: "message.completed",
        properties: {
          sessionID: "session-1",
          messageID: "msg-1",
          part: { type: "text", text: "Working on it..." },
        },
      });

      const snapshot = subagentTracker.getSnapshotPayload();
      assert.ok(snapshot);
      const details = Object.values(snapshot.detailsById);
      assert.ok(details.length >= 1, "should have tracked the subtask");
      const subtask = details[0] as any;
      assert.equal(subtask.latestActivity, "Explore the codebase");
      assert.equal(subtask.status, "pending");
      assert.ok(getStreamEntries(getMessagesByType).length >= 1, "handler should forward events");
    });

    it("binds child session and propagates through pipeline", async () => {
      const { subagentTracker } = setupFlow();

      subagentTracker.resetForSession("session-1");

      subagentTracker.consumeStreamEvent({
        type: "message.part.updated",
        properties: {
          sessionID: "session-1",
          messageID: "msg-1",
          part: {
            type: "subtask",
            sessionID: "session-1",
            messageID: "msg-1",
            id: "part-1",
            info: { name: "explore", description: "Find auth files", prompt: "search" },
          },
        },
      });

      subagentTracker.consumeStreamEvent({
        type: "session.created",
        properties: {
          info: { id: "child-session-1", parentID: "session-1" },
        },
      });

      const snapshot = subagentTracker.getSnapshotPayload();
      assert.ok(snapshot);
      const bound = Object.values(snapshot.detailsById).find(
        (d: any) => d.childSessionId === "child-session-1",
      );
      assert.ok(bound, "child session should be bound to subtask");
      assert.equal((bound as any).status, "running");
    });

    it("marks subagent as errored via session.error", async () => {
      const { subagentTracker } = setupFlow();

      subagentTracker.resetForSession("session-1");

      subagentTracker.consumeStreamEvent({
        type: "message.part.updated",
        properties: {
          sessionID: "session-1",
          messageID: "msg-1",
          part: {
            type: "subtask",
            sessionID: "session-1",
            messageID: "msg-1",
            id: "part-1",
            info: { name: "explore", description: "search" },
          },
        },
      });

      subagentTracker.consumeStreamEvent({
        type: "session.created",
        properties: {
          info: { id: "child-1", parentID: "session-1" },
        },
      });

      subagentTracker.consumeStreamEvent({
        type: "session.error",
        properties: {
          sessionID: "child-1",
          error: { message: "Timeout" },
        },
      });

      const snapshot = subagentTracker.getSnapshotPayload();
      const errored = Object.values(snapshot.detailsById).find(
        (d: any) => d.childSessionId === "child-1",
      );
      assert.ok(errored);
      assert.equal((errored as any).status, "error");
      assert.equal((errored as any).errorText, "Timeout");
    });
  });

  describe("streaming event → token tracking", () => {
    it("records Gemini token usage from message.updated events", async () => {
      const { streamHandler, geminiTokenTracker } = setupFlow();

      await streamHandler.handleStreamEvent({
        type: "message.updated",
        properties: {
          sessionID: "session-1",
          usage: { inputTokens: 150, outputTokens: 75 },
          info: { providerID: "google", modelID: "gemini-2.5-flash" },
        },
      });

      assert.equal(geminiTokenTracker._recordings.length, 1);
      assert.equal(geminiTokenTracker._recordings[0].m, "google/gemini-2.5-flash");
      assert.deepEqual(geminiTokenTracker._recordings[0].u, { inputTokens: 150, outputTokens: 75 });
    });

    it("records multiple token usage events", async () => {
      const { streamHandler, geminiTokenTracker } = setupFlow();

      await streamHandler.handleStreamEvent({
        type: "message.updated",
        properties: {
          usage: { inputTokens: 100 },
          info: { providerID: "google", modelID: "gemini-2.5-pro" },
        },
      });

      await streamHandler.handleStreamEvent({
        type: "message.updated",
        properties: {
          usage: { inputTokens: 200, outputTokens: 50 },
          info: { providerID: "openai", modelID: "gpt-4o" },
        },
      });

      assert.equal(geminiTokenTracker._recordings.length, 2);
    });
  });

  describe("streaming event → compaction forwarding", () => {
    it("forwards compaction only on message.completed", async () => {
      const { streamHandler, compactionManager } = setupFlow();

      const compaction = { status: "completed", originalCount: 100, compactedCount: 30 };

      await streamHandler.handleStreamEvent({
        type: "message.part.updated",
        properties: { compaction },
      });
      assert.equal(compactionManager._calls.length, 0);

      await streamHandler.handleStreamEvent({
        type: "message.completed",
        properties: { compaction },
      });
      assert.equal(compactionManager._calls.length, 1);
      assert.deepEqual(compactionManager._calls[0], compaction);
    });
  });

  describe("multi-event streaming sequence", () => {
    it("matches the chat stream lifecycle from chunks through terminal flush", async () => {
      const {
        streamHandler,
        compactionManager,
        geminiTokenTracker,
        sessionService,
        getMessages,
        logger,
      } = setupFlow();

      streamHandler.startStream("session-1", "msg-exact");

      await streamHandler.handleStreamEvent(
        {
          type: "message.part.updated",
          properties: {
            sessionID: "session-1",
            messageID: "msg-exact",
            part: { id: "part-text", type: "text", text: "Working" },
          },
        },
        { source: "sdk", sequence: 1 },
      );

      await streamHandler.handleStreamEvent(
        {
          type: "message.part.updated",
          properties: {
            sessionID: "session-1",
            messageID: "msg-exact",
            part: {
              id: "part-structured",
              type: "text",
              structured: {
                type: "implementation_plan",
                text: "Plan ready",
                plan: {
                  file: "./plan.md",
                  title: "Exact Flow Plan",
                },
              },
            },
          },
        },
        { source: "sdk", sequence: 2 },
      );

      assert.equal(
        getMessages().length,
        0,
        "non-terminal chunks should wait for the terminal event before posting",
      );

      await streamHandler.handleStreamEvent(
        {
          type: "message.updated",
          properties: {
            sessionID: "session-1",
            messageID: "msg-exact",
            usage: { inputTokens: 12, outputTokens: 8 },
            info: { providerID: "openai", modelID: "gpt-5" },
          },
        },
        { source: "sdk", sequence: 3 },
      );

      await streamHandler.handleStreamEvent(
        {
          type: "message.completed",
          properties: {
            sessionID: "session-1",
            messageID: "msg-exact",
            compaction: { status: "completed", originalCount: 20, compactedCount: 7 },
          },
        },
        { source: "sdk", sequence: 4 },
      );

      const messages = getMessages();
      assert.equal(messages.length, 1, "terminal event should flush one webview batch");
      assert.equal(messages[0].type, "streamEventBatch");

      const entries = flattenStreamMessages(messages);
      assert.deepEqual(
        entries.map((entry) => entry.event.type),
        [
          "message.part.updated",
          "message.part.updated",
          "message.updated",
          "message.completed",
        ],
      );
      assert.deepEqual(
        entries.map((entry) => entry.sessionId),
        ["session-1", "session-1", "session-1", "session-1"],
      );
      assert.equal(entries[1].event.hasStructuredOutput, true);
      assert.equal(entries[1].event.structuredOutput.responseType, "implementation_plan");
      assert.equal(entries[1].event.structuredOutput.plan.file, "./plan.md");

      assert.deepEqual(geminiTokenTracker._recordings, [
        {
          m: "openai/gpt-5",
          u: { inputTokens: 12, outputTokens: 8 },
        },
      ]);
      assert.deepEqual(compactionManager._calls, [
        { status: "completed", originalCount: 20, compactedCount: 7 },
      ]);
      assert.deepEqual(
        sessionService._appendedRawSdkEvents.map((entry) => ({
          sessionId: entry.sessionId,
          sequence: entry.payload.sequence,
          payloadSessionId: entry.payload.sessionId,
        })),
        [
          { sessionId: "session-1", sequence: 1, payloadSessionId: "session-1" },
          { sessionId: "session-1", sequence: 2, payloadSessionId: "session-1" },
          { sessionId: "session-1", sequence: 3, payloadSessionId: "session-1" },
          { sessionId: "session-1", sequence: 4, payloadSessionId: "session-1" },
        ],
      );

      streamHandler.endStream("session-1", "msg-exact", true);

      assert.deepEqual(sessionService._flushedSessions, ["session-1"]);
      const performanceLog = logger
        .getEntriesByLevel("performance")
        .find((entry: any) => entry.message === "ai-stream");
      assert.equal(performanceLog?.context?.eventCount, 4);
      assert.equal(performanceLog?.context?.success, true);
    });

    it("processes a complete message lifecycle", async () => {
      const { streamHandler, subagentTracker, geminiTokenTracker, sessionService, getMessagesByType, logger } = setupFlow();
      subagentTracker.resetForSession("session-1");

      streamHandler.startStream("session-1", "msg-lifecycle");

      await streamHandler.handleStreamEvent({
        type: "message.part.updated",
        properties: {
          sessionID: "session-1",
          messageID: "msg-lifecycle",
          part: { type: "text", text: "Starting work..." },
        },
      });

      await streamHandler.handleStreamEvent({
        type: "message.part.updated",
        properties: {
          sessionID: "session-1",
          messageID: "msg-lifecycle",
          part: {
            type: "subtask",
            sessionID: "session-1",
            messageID: "msg-lifecycle",
            id: "part-subtask",
            info: { name: "research", description: "Find files" },
          },
        },
      });

      await streamHandler.handleStreamEvent({
        type: "message.updated",
        properties: {
          sessionID: "session-1",
          messageID: "msg-lifecycle",
          usage: { inputTokens: 500, outputTokens: 200 },
          info: { providerID: "anthropic", modelID: "claude-4-sonnet" },
        },
      });

      streamHandler.endStream("session-1", "msg-lifecycle", true);

      assert.ok(getStreamEntries(getMessagesByType).length >= 3, "should have forwarded multiple events");
      assert.equal(geminiTokenTracker._recordings.length, 1, "should have recorded token usage");
      assert.deepEqual(sessionService._flushedSessions, ["session-1"]);

      const startLog = logger.getEntriesByLevel("debug").find((e: any) => e.message === "AI stream started");
      const endLog = logger.getEntriesByLevel("debug").find((e: any) => e.message === "AI stream ended");
      assert.ok(startLog, "should log stream start");
      assert.ok(endLog, "should log stream end");
      assert.equal(endLog?.context?.success, true);
    });
  });
});
