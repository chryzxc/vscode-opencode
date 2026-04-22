import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CompactionManager } from "../../src/providers/chat/CompactionManager.js";
import type { HistoryProcessor } from "../../src/providers/chat/HistoryProcessor.js";
import type { ModelAndAgentManager } from "../../src/providers/chat/ModelAndAgentManager.js";
import { SessionHandler } from "../../src/providers/chat/SessionHandler.js";
import type { SubagentPersistence } from "../../src/providers/chat/SubagentPersistence.js";
import type { SessionService } from "../../src/services/SessionService.js";
import { captureMessages, createTestLogger, waitFor } from "./helpers/test-utils.js";

type SessionRecord = {
  id: string;
  title?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  parentSessionId?: string;
  parentID?: string;
};

type HistoryMessage = {
  id: string;
  role: string;
  content?: string;
};

type ChatHistoryMessage = {
  type: "chatHistory";
  sessionId: string;
  messages: unknown[];
};

type SessionsListMessage = {
  type: "sessionsList";
  sessions: Array<{
    id: string;
    title: string;
    createdAt?: string | number;
    updatedAt?: string | number;
    parentSessionId?: string;
  }>;
};

type SessionsListUpdateMessage = {
  type: "sessionsListUpdate";
  processingSessionIds: string[];
};

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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function messageType(message: unknown): string {
  return typeof asRecord(message)?.type === "string"
    ? String(asRecord(message)?.type)
    : "unknown";
}

function requireSessionsListMessage(message: unknown): SessionsListMessage {
  const record = asRecord(message);
  assert.ok(record, "expected sessions list message");
  assert.equal(record.type, "sessionsList");
  assert.ok(Array.isArray(record.sessions), "expected sessions array");
  return message as SessionsListMessage;
}

function requireSessionsListUpdateMessage(message: unknown): SessionsListUpdateMessage {
  const record = asRecord(message);
  assert.ok(record, "expected processing update message");
  assert.equal(record.type, "sessionsListUpdate");
  assert.ok(
    Array.isArray(record.processingSessionIds),
    "expected processingSessionIds array",
  );
  return message as SessionsListUpdateMessage;
}

function requireChatHistoryMessage(message: unknown): ChatHistoryMessage {
  const record = asRecord(message);
  assert.ok(record, "expected chat history message");
  assert.equal(record.type, "chatHistory");
  assert.equal(typeof record.sessionId, "string");
  assert.ok(Array.isArray(record.messages), "expected messages array");
  return message as ChatHistoryMessage;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class SessionServiceStub {
  listSessionsResult: SessionRecord[] = [];
  loadSessionMessagesResult: HistoryMessage[] | null = [];
  readonly calls: string[];

  constructor(calls: string[]) {
    this.calls = calls;
  }

  async listSessions(): Promise<SessionRecord[]> {
    this.calls.push("sessionService.listSessions");
    return this.listSessionsResult;
  }

  async switchSession(sessionId: string): Promise<{ id: string }> {
    this.calls.push("sessionService.switchSession");
    return { id: sessionId };
  }

  async loadSessionMessages(sessionId: string): Promise<HistoryMessage[] | null> {
    this.calls.push("sessionService.loadSessionMessages");
    assert.equal(typeof sessionId, "string");
    return this.loadSessionMessagesResult;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.calls.push("sessionService.deleteSession");
    assert.equal(typeof sessionId, "string");
  }

  async renameSession(sessionId: string, newTitle: string): Promise<{ id: string; title: string }> {
    this.calls.push("sessionService.renameSession");
    assert.equal(typeof sessionId, "string");
    assert.equal(typeof newTitle, "string");
    return { id: sessionId, title: newTitle };
  }
}

class HistoryProcessorStub {
  processedMessages: unknown[] = [];
  readonly calls: string[];
  readonly processCalls: Array<{ rawMessages: HistoryMessage[]; sessionId: string }> = [];

  constructor(calls: string[]) {
    this.calls = calls;
  }

  async processHistoryMessages(rawMessages: HistoryMessage[], sessionId: string): Promise<unknown[]> {
    this.calls.push("historyProcessor.processHistoryMessages");
    this.processCalls.push({ rawMessages, sessionId });
    return this.processedMessages;
  }

  applySessionMessageOverrides(messages: unknown[]): unknown[] {
    this.calls.push("historyProcessor.applySessionMessageOverrides");
    return messages;
  }
}

class SubagentPersistenceStub {
  readonly calls: string[];
  readonly syncCalls: Array<{ sessionId: string; messages: unknown[] }> = [];
  readonly clearCalls: string[] = [];

  constructor(calls: string[]) {
    this.calls = calls;
  }

  async syncSubagentSnapshotForSession(sessionId: string, messages: unknown[]): Promise<void> {
    this.calls.push("subagentPersistence.syncSubagentSnapshotForSession");
    this.syncCalls.push({ sessionId, messages });
  }

  async clearPersistedSubagentSnapshot(sessionId: string): Promise<void> {
    this.calls.push("subagentPersistence.clearPersistedSubagentSnapshot");
    this.clearCalls.push(sessionId);
  }
}

class CompactionManagerStub {
  readonly calls: string[];
  readonly sentSessionIds: string[] = [];
  readonly clearedSessionIds: string[] = [];

  constructor(calls: string[]) {
    this.calls = calls;
  }

  async clearPersistedCompactionViewState(sessionId: string): Promise<void> {
    this.calls.push("compactionManager.clearPersistedCompactionViewState");
    this.clearedSessionIds.push(sessionId);
  }

  async sendPersistedCompactionViewState(sessionId: string): Promise<void> {
    this.calls.push("compactionManager.sendPersistedCompactionViewState");
    this.sentSessionIds.push(sessionId);
  }

  resolveSessionCompactionDividerState(): undefined {
    this.calls.push("compactionManager.resolveSessionCompactionDividerState");
    return undefined;
  }
}

class ModelAndAgentManagerStub {
  readonly calls: string[];
  readonly appliedSessionIds: string[] = [];

  constructor(calls: string[]) {
    this.calls = calls;
  }

  async applySessionSettings(sessionId: string): Promise<void> {
    this.calls.push("modelAndAgentManager.applySessionSettings");
    this.appliedSessionIds.push(sessionId);
  }
}

type Harness = {
  handler: SessionHandler;
  sessionService: SessionServiceStub;
  historyProcessor: HistoryProcessorStub;
  subagentPersistence: SubagentPersistenceStub;
  compactionManager: CompactionManagerStub;
  modelAndAgentManager: ModelAndAgentManagerStub;
  logger: ReturnType<typeof createCompatibleLogger>;
  calls: string[];
  getMessages: () => unknown[];
  getMessagesByType: (type: string) => unknown[];
  getCurrentSessionId: () => string | undefined;
};

function createHarness(initialCurrentSessionId?: string): Harness {
  const calls: string[] = [];
  const sessionService = new SessionServiceStub(calls);
  const historyProcessor = new HistoryProcessorStub(calls);
  const subagentPersistence = new SubagentPersistenceStub(calls);
  const compactionManager = new CompactionManagerStub(calls);
  const modelAndAgentManager = new ModelAndAgentManagerStub(calls);
  const logger = createCompatibleLogger();
  const capture = captureMessages();
  let currentSessionId = initialCurrentSessionId;

  const handler = new SessionHandler(
    sessionService as unknown as SessionService,
    historyProcessor as unknown as HistoryProcessor,
    subagentPersistence as unknown as SubagentPersistence,
    compactionManager as unknown as CompactionManager,
    modelAndAgentManager as unknown as ModelAndAgentManager,
    logger,
  );

  handler.setPostMessage((message) => {
    calls.push(`postMessage:${messageType(message)}`);
    capture.postMessage(message);
  });
  handler.setGetCurrentSessionId(() => currentSessionId);
  handler.setSetCurrentSessionId((nextSessionId) => {
    calls.push(`setCurrentSessionId:${nextSessionId ?? "undefined"}`);
    currentSessionId = nextSessionId;
  });

  return {
    handler,
    sessionService,
    historyProcessor,
    subagentPersistence,
    compactionManager,
    modelAndAgentManager,
    logger,
    calls,
    getMessages: capture.getMessages,
    getMessagesByType: capture.getMessagesByType,
    getCurrentSessionId: () => currentSessionId,
  };
}

describe("SessionHandler", () => {
  describe("handleGetSessions", () => {
    it("filters to top-level sessions, normalizes parent aliases, and suppresses duplicate payloads", async () => {
      const harness = createHarness();
      harness.sessionService.listSessionsResult = [
        {
          id: "root-1",
          title: "Root Session",
          createdAt: 1,
          updatedAt: 11,
        },
        {
          id: "child-1",
          title: "Child Session",
          createdAt: 2,
          updatedAt: 12,
          parentSessionId: "root-1",
        },
        {
          id: "orphan-1",
          title: "Orphan Child",
          createdAt: 3,
          updatedAt: 13,
          parentID: "missing-parent",
        },
        {
          id: "self-parented",
          title: "Self Parented",
          createdAt: 4,
          updatedAt: 14,
          parentID: "self-parented",
        },
        {
          id: "fallback-title",
          createdAt: 5,
          updatedAt: 15,
        },
      ];

      await harness.handler.handleGetSessions();
      await harness.handler.handleGetSessions();

      const posted = harness.getMessagesByType("sessionsList");
      assert.equal(posted.length, 1);
      assert.deepEqual(requireSessionsListMessage(posted[0]), {
        type: "sessionsList",
        sessions: [
          {
            id: "root-1",
            title: "Root Session",
            createdAt: 1,
            updatedAt: 11,
            parentSessionId: undefined,
          },
          {
            id: "orphan-1",
            title: "Orphan Child",
            createdAt: 3,
            updatedAt: 13,
            parentSessionId: "missing-parent",
          },
          {
            id: "self-parented",
            title: "Self Parented",
            createdAt: 4,
            updatedAt: 14,
            parentSessionId: "self-parented",
          },
          {
            id: "fallback-title",
            title: "fallback-title",
            createdAt: 5,
            updatedAt: 15,
            parentSessionId: undefined,
          },
        ],
      });
    });

    it("posts an empty sessions list when no sessions exist", async () => {
      const harness = createHarness();

      await harness.handler.handleGetSessions();

      assert.deepEqual(requireSessionsListMessage(harness.getMessages()[0]), {
        type: "sessionsList",
        sessions: [],
      });
    });
  });

  describe("sendProcessingSessionsUpdate", () => {
    it("posts the current processing session ids", () => {
      const harness = createHarness();

      harness.handler.sendProcessingSessionsUpdate();

      assert.deepEqual(requireSessionsListUpdateMessage(harness.getMessages()[0]), {
        type: "sessionsListUpdate",
        processingSessionIds: [],
      });
    });
  });

  describe("handleLoadSession", () => {
    it("switches session, processes history, syncs dependents, and posts chat history in order", async () => {
      const harness = createHarness();
      const switchDeferred = createDeferred<void>();
      const rawMessages: HistoryMessage[] = [
        { id: "msg-1", role: "user", content: "hello" },
        { id: "msg-2", role: "assistant", content: "world" },
      ];
      const processedMessages = [
        { id: "msg-1", role: "user", content: "hello" },
        { id: "msg-2", role: "assistant", content: "processed world" },
      ];

      harness.sessionService.loadSessionMessagesResult = rawMessages;
      harness.historyProcessor.processedMessages = processedMessages;
      harness.sessionService.switchSession = async (sessionId: string) => {
        harness.calls.push("sessionService.switchSession");
        assert.equal(sessionId, "session-1");
        await switchDeferred.promise;
        return { id: sessionId };
      };

      const loadPromise = harness.handler.handleLoadSession({ sessionId: "session-1" });

      await waitFor(() => harness.getMessagesByType("sessionsListUpdate").length === 1);
      assert.deepEqual(
        requireSessionsListUpdateMessage(harness.getMessagesByType("sessionsListUpdate")[0]),
        {
          type: "sessionsListUpdate",
          processingSessionIds: ["session-1"],
        },
      );

      switchDeferred.resolve();
      await loadPromise;

      assert.deepEqual(harness.historyProcessor.processCalls, [
        { rawMessages, sessionId: "session-1" },
      ]);
      assert.deepEqual(harness.subagentPersistence.syncCalls, [
        { sessionId: "session-1", messages: processedMessages },
      ]);
      assert.deepEqual(harness.compactionManager.sentSessionIds, ["session-1"]);
      assert.deepEqual(harness.modelAndAgentManager.appliedSessionIds, ["session-1"]);

      const chatHistoryMessage = requireChatHistoryMessage(
        harness.getMessagesByType("chatHistory")[0],
      );
      assert.deepEqual(chatHistoryMessage, {
        type: "chatHistory",
        sessionId: "session-1",
        messages: processedMessages,
      });

      const processingUpdates = harness
        .getMessagesByType("sessionsListUpdate")
        .map((message) => requireSessionsListUpdateMessage(message));
      assert.deepEqual(processingUpdates, [
        { type: "sessionsListUpdate", processingSessionIds: ["session-1"] },
        { type: "sessionsListUpdate", processingSessionIds: [] },
      ]);

      assert.equal(harness.getCurrentSessionId(), "session-1");
      assert.deepEqual(harness.calls, [
        "postMessage:sessionsListUpdate",
        "sessionService.switchSession",
        "sessionService.loadSessionMessages",
        "historyProcessor.processHistoryMessages",
        "subagentPersistence.syncSubagentSnapshotForSession",
        "compactionManager.sendPersistedCompactionViewState",
        "modelAndAgentManager.applySessionSettings",
        "postMessage:chatHistory",
        "setCurrentSessionId:session-1",
        "postMessage:sessionsListUpdate",
      ]);
    });

    it("treats null message history as an empty chat history payload", async () => {
      const harness = createHarness();
      harness.sessionService.loadSessionMessagesResult = null;

      await harness.handler.handleLoadSession({ sessionId: "session-2" });

      assert.equal(harness.historyProcessor.processCalls.length, 0);
      assert.deepEqual(harness.subagentPersistence.syncCalls, [
        { sessionId: "session-2", messages: [] },
      ]);
      assert.deepEqual(
        requireChatHistoryMessage(harness.getMessagesByType("chatHistory")[0]),
        {
          type: "chatHistory",
          sessionId: "session-2",
          messages: [],
        },
      );
    });

    it("ignores empty session ids", async () => {
      const harness = createHarness();

      await harness.handler.handleLoadSession({ sessionId: "" });

      assert.deepEqual(harness.calls, []);
      assert.deepEqual(harness.getMessages(), []);
    });
  });

  describe("handleDeleteSession", () => {
    it("deletes the session, clears persisted snapshots, clears active session, and refreshes the list", async () => {
      const harness = createHarness("session-1");
      harness.sessionService.listSessionsResult = [
        {
          id: "session-2",
          title: "Remaining Session",
          createdAt: 20,
          updatedAt: 21,
        },
      ];

      await harness.handler.handleDeleteSession("session-1");

      assert.deepEqual(harness.subagentPersistence.clearCalls, ["session-1"]);
      assert.deepEqual(harness.compactionManager.clearedSessionIds, ["session-1"]);
      assert.equal(harness.getCurrentSessionId(), undefined);
      assert.deepEqual(requireSessionsListMessage(harness.getMessagesByType("sessionsList")[0]), {
        type: "sessionsList",
        sessions: [
          {
            id: "session-2",
            title: "Remaining Session",
            createdAt: 20,
            updatedAt: 21,
            parentSessionId: undefined,
          },
        ],
      });
      assert.deepEqual(harness.calls, [
        "sessionService.deleteSession",
        "subagentPersistence.clearPersistedSubagentSnapshot",
        "compactionManager.clearPersistedCompactionViewState",
        "setCurrentSessionId:undefined",
        "sessionService.listSessions",
        "postMessage:sessionsList",
      ]);
    });
  });

  describe("handleRenameSession", () => {
    it("renames the session and refreshes the sessions list", async () => {
      const harness = createHarness();
      harness.sessionService.listSessionsResult = [
        {
          id: "session-9",
          title: "Renamed Session",
          createdAt: 90,
          updatedAt: 99,
        },
      ];

      await harness.handler.handleRenameSession("session-9", "Renamed Session");

      assert.deepEqual(requireSessionsListMessage(harness.getMessagesByType("sessionsList")[0]), {
        type: "sessionsList",
        sessions: [
          {
            id: "session-9",
            title: "Renamed Session",
            createdAt: 90,
            updatedAt: 99,
            parentSessionId: undefined,
          },
        ],
      });
      assert.deepEqual(harness.calls, [
        "sessionService.renameSession",
        "sessionService.listSessions",
        "postMessage:sessionsList",
      ]);
    });

    it("returns early for missing session ids or titles", async () => {
      const harness = createHarness();

      await harness.handler.handleRenameSession("", "Title");
      await harness.handler.handleRenameSession("session-1", "");
      await harness.handler.handleDeleteSession("");

      assert.deepEqual(harness.calls, []);
      assert.deepEqual(harness.getMessages(), []);
    });
  });
});
