import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type * as vscode from "vscode";
import type { OpencodeServerManager } from "../../src/services/OpencodeServerManager.js";
import { CompactionManager } from "../../src/providers/chat/CompactionManager.js";
import {
  captureMessages,
  createTestLogger,
  createTestMemento,
  firstNonEmptyString,
} from "./helpers/test-utils.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

class TestWorkspaceState implements vscode.Memento {
  constructor(private readonly inner = createTestMemento()) {}

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.inner.get<T>(key);
    return value === undefined ? defaultValue : value;
  }

  keys(): readonly string[] {
    return this.inner.keys;
  }

  update(key: string, value: unknown): Thenable<void> {
    return this.inner.update(key, value);
  }
}

function createManager(options?: {
  contextLimit?: number;
  selectedModel?: { providerID: string; modelID: string };
  compactSession?: (
    sessionId: string,
    model: { providerID: string; modelID: string },
  ) => Promise<{ data?: unknown }>;
}) {
  const workspaceState = new TestWorkspaceState();
  const logger = createTestLogger();
  const serverManager = {
    compactSession:
      options?.compactSession ?? (async () => ({ data: true })),
  } as unknown as OpencodeServerManager;
  const manager = new CompactionManager(
    workspaceState,
    serverManager,
    logger,
    asRecord,
    firstNonEmptyString,
    async (messages: unknown[]) => messages,
  );
  manager.setGetSelectedModelContextLimit(() => options?.contextLimit);
  manager.setGetSelectedModel(
    () => options?.selectedModel ?? { providerID: "openai", modelID: "gpt-test" },
  );

  return { manager, workspaceState };
}

describe("CompactionManager", () => {
  describe("getCompactionViewStateStorageKey", () => {
    it("prefixes the session id with the compaction storage namespace", () => {
      const { manager } = createManager();

      assert.equal(
        manager.getCompactionViewStateStorageKey("session-123"),
        "opencode.session.compaction-view.session-123",
      );
    });
  });

  describe("normalizeCompactionBaselineStats", () => {
    it("returns undefined for nullish, malformed, or empty values", () => {
      const { manager } = createManager();

      assert.equal(manager.normalizeCompactionBaselineStats(undefined), undefined);
      assert.equal(manager.normalizeCompactionBaselineStats(null), undefined);
      assert.equal(manager.normalizeCompactionBaselineStats("bad"), undefined);
      assert.equal(manager.normalizeCompactionBaselineStats({}), undefined);
      assert.equal(
        manager.normalizeCompactionBaselineStats({
          input: -1,
          output: "2",
          read: Number.NaN,
          write: Infinity,
          duration: -4,
        }),
        undefined,
      );
    });

    it("floors valid numbers and fills missing counters with zeroes", () => {
      const { manager } = createManager();

      assert.deepEqual(
        manager.normalizeCompactionBaselineStats({
          input: 10.9,
          output: 0,
          read: 2.2,
          write: -5,
          duration: 8.7,
        }),
        {
          input: 10,
          output: 0,
          read: 2,
          write: 0,
          duration: 8,
        },
      );
    });
  });

  describe("normalizeCompactionViewState", () => {
    it("returns null for non-objects or objects with no valid persisted fields", () => {
      const { manager } = createManager();

      assert.equal(manager.normalizeCompactionViewState(undefined), null);
      assert.equal(manager.normalizeCompactionViewState(null), null);
      assert.equal(manager.normalizeCompactionViewState("bad"), null);
      assert.equal(manager.normalizeCompactionViewState({}), null);
      assert.equal(
        manager.normalizeCompactionViewState({
          lastCompactedAt: 0,
          compactionDividerIndex: -1,
          compactionDividerBeforeMessageId: "   ",
          compactionDividerAfterMessageId: "",
        }),
        null,
      );
    });

    it("keeps only valid fields and normalizes nested baseline stats", () => {
      const { manager } = createManager();

      assert.deepEqual(
        manager.normalizeCompactionViewState({
          lastCompactedAt: 123.9,
          baselineStats: {
            input: 4.8,
            output: 2,
            read: -1,
            write: 1.2,
            duration: 6.6,
          },
          compactionDividerIndex: 7.4,
          compactionDividerBeforeMessageId: "before-msg",
          compactionDividerAfterMessageId: "after-msg",
          collapsed: false,
          ignored: true,
        }),
        {
          lastCompactedAt: 123,
          baselineStats: {
            input: 4,
            output: 2,
            read: 0,
            write: 1,
            duration: 6,
          },
          compactionDividerIndex: 7,
          compactionDividerBeforeMessageId: "before-msg",
          compactionDividerAfterMessageId: "after-msg",
          collapsed: false,
        },
      );
    });
  });

  describe("resolveCompactionSessionId", () => {
    it("prefers sessionId, then compactSession, then undefined", async () => {
      const { manager } = createManager();

      assert.equal(
        await manager.resolveCompactionSessionId({
          sessionId: "primary-session",
          compactSession: "fallback-session",
        }),
        "primary-session",
      );
      assert.equal(
        await manager.resolveCompactionSessionId({
          compactSession: "fallback-session",
        }),
        "fallback-session",
      );
      assert.equal(await manager.resolveCompactionSessionId({}), undefined);
    });
  });

  describe("persisted compaction view state", () => {
    it("loads normalized state from workspace storage", async () => {
      const { manager, workspaceState } = createManager();
      const sessionId = "persisted-session";

      await workspaceState.update(
        manager.getCompactionViewStateStorageKey(sessionId),
        {
          lastCompactedAt: 456.2,
          baselineStats: { input: 9.9 },
          compactionDividerIndex: 3.4,
          compactionDividerBeforeMessageId: "before-1",
          compactionDividerAfterMessageId: "after-1",
          collapsed: true,
        },
      );

      assert.deepEqual(
        await manager.loadPersistedCompactionViewState(sessionId),
        {
          lastCompactedAt: 456,
          baselineStats: {
            input: 9,
            output: 0,
            read: 0,
            write: 0,
            duration: 0,
          },
          compactionDividerIndex: 3,
          compactionDividerBeforeMessageId: "before-1",
          compactionDividerAfterMessageId: "after-1",
          collapsed: true,
        },
      );
    });

    it("saves and clears workspace state entries", async () => {
      const { manager, workspaceState } = createManager();
      const sessionId = "session-clear";
      const state = {
        collapsed: false,
        compactionDividerIndex: 2,
      };
      const key = manager.getCompactionViewStateStorageKey(sessionId);

      await manager.savePersistedCompactionViewState(sessionId, state);
      assert.deepEqual(workspaceState.get(key), state);
      assert.deepEqual(await manager.loadPersistedCompactionViewState(sessionId), state);

      await manager.clearPersistedCompactionViewState(sessionId);
      assert.equal(workspaceState.get(key), undefined);
      assert.equal(await manager.loadPersistedCompactionViewState(sessionId), null);
    });
  });

  describe("maybeAutoCompact", () => {
    it("triggers from the SDK assistant message input token count", async () => {
      const calls: string[] = [];
      const { manager } = createManager({
        contextLimit: 1000,
        compactSession: async (sessionId: string) => {
          calls.push(sessionId);
          return {
            data: true,
          };
        },
      });

      await manager.maybeAutoCompact(
        "sdk-session",
        {
          info: {
            tokens: {
              input: 910,
              output: 25,
              reasoning: 5,
              cache: { read: 0, write: 0 },
            },
          },
        },
        { getMessages: async () => [] },
      );

      assert.deepEqual(calls, ["sdk-session"]);
    });

    it("does not infer context usage by summing non-input token fields", async () => {
      const calls: string[] = [];
      const { manager } = createManager({
        contextLimit: 1000,
        compactSession: async (sessionId: string) => {
          calls.push(sessionId);
          return { data: true };
        },
      });

      await manager.maybeAutoCompact(
        "sdk-session",
        {
          info: {
            tokens: {
              input: 500,
              output: 450,
              reasoning: 100,
              cache: { read: 0, write: 0 },
            },
          },
        },
        { getMessages: async () => [] },
      );

      assert.deepEqual(calls, []);
    });
  });

  describe("forwardCompactionStatusFromStreamEvent", () => {
    it("forwards normalized compaction status payloads to the webview", () => {
      const { manager } = createManager();
      const captured = captureMessages();
      manager.setPostMessage(captured.postMessage);

      manager.forwardCompactionStatusFromStreamEvent({
        sessionID: "session-42",
        status: "completed",
        compacted: true,
        error: "Minor warning",
        baselineStats: {
          input: 12.4,
          output: 3,
          read: 1.9,
          write: 0,
          duration: 7.7,
        },
        compactionDividerBeforeMessageId: "before-42",
        compactionDividerAfterMessageId: "after-42",
      });

      assert.deepEqual(captured.getLastMessage(), {
        type: "compactionStatus",
        sessionId: "session-42",
        status: "done",
        compacted: true,
        error: "Minor warning",
        baselineStats: {
          input: 12,
          output: 3,
          read: 1,
          write: 0,
          duration: 7,
        },
        compactionDividerBeforeMessageId: "before-42",
        compactionDividerAfterMessageId: "after-42",
      });
    });

    it("does not post when the event lacks a session id or compaction signal", () => {
      const { manager } = createManager();
      const captured = captureMessages();
      manager.setPostMessage(captured.postMessage);

      manager.forwardCompactionStatusFromStreamEvent({ status: "running" });
      manager.forwardCompactionStatusFromStreamEvent({ sessionId: "session-1" });
      manager.forwardCompactionStatusFromStreamEvent(null);

      assert.deepEqual(captured.getMessages(), []);
    });

    it("uses unknown status when only auxiliary compaction fields are present", () => {
      const { manager } = createManager();
      const captured = captureMessages();
      manager.setPostMessage(captured.postMessage);

      manager.forwardCompactionStatusFromStreamEvent({
        sessionId: "session-aux",
        baselineStats: { input: 2 },
      });

      assert.deepEqual(captured.getLastMessage(), {
        type: "compactionStatus",
        sessionId: "session-aux",
        status: "unknown",
        compacted: false,
        error: undefined,
        baselineStats: {
          input: 2,
          output: 0,
          read: 0,
          write: 0,
          duration: 0,
        },
        compactionDividerBeforeMessageId: undefined,
        compactionDividerAfterMessageId: undefined,
      });
    });
  });

  describe("SDK compaction anchors", () => {
    it("derives the compacted history boundary from CompactionPart.tail_start_id", () => {
      const { manager } = createManager();
      const messages = [
        { id: "old-user", role: "user", content: "Long context" },
        {
          id: "compact-marker",
          role: "assistant",
          parts: [
            {
              type: "compaction",
              auto: true,
              tail_start_id: "retained-user",
            },
          ],
        },
        { id: "retained-user", role: "user", content: "Recent request" },
        { id: "retained-assistant", role: "assistant", content: "Recent answer" },
      ];

      assert.deepEqual(manager.resolveSdkCompactionDividerState(messages), {
        compactionDividerIndex: 2,
        compactionDividerBeforeMessageId: "compact-marker",
        compactionDividerAfterMessageId: "retained-user",
      });
    });

    it("publishes SDK-derived compaction view state for hydrated messages", async () => {
      const { manager, workspaceState } = createManager();
      const captured = captureMessages();
      manager.setPostMessage(captured.postMessage);

      await manager.sendCompactionViewStateForMessages("session-sdk", [
        { id: "old-user", role: "user", content: "Long context" },
        {
          id: "compact-marker",
          role: "assistant",
          parts: [{ type: "compaction", auto: false, tail_start_id: "tail-1" }],
        },
        { id: "tail-1", role: "user", content: "Retained tail" },
      ]);

      const posted = captured.getLastMessage() as Record<string, unknown>;
      assert.equal(posted.type, "compactionViewState");
      assert.equal(posted.sessionId, "session-sdk");
      assert.equal(posted.compactionDividerIndex, 2);
      assert.equal(posted.compactionDividerBeforeMessageId, "compact-marker");
      assert.equal(posted.compactionDividerAfterMessageId, "tail-1");
      assert.equal(posted.collapsed, true);
      assert.equal(typeof posted.lastCompactedAt, "number");

      const persisted = workspaceState.get<Record<string, unknown>>(
        "opencode.session.compaction-view.session-sdk",
      );
      assert.equal(persisted?.compactionDividerAfterMessageId, "tail-1");
    });

    it("consumes session.next compaction completion by refreshing messages and posting view state", async () => {
      const { manager } = createManager();
      const captured = captureMessages();
      manager.setPostMessage(captured.postMessage);

      const handled = await manager.handleSdkCompactionStreamEvent(
        {
          type: "session.next.compaction.ended",
          properties: {
            sessionID: "session-live",
            timestamp: Date.now(),
            text: "Compacted",
          },
        },
        {
          getMessages: async () => [
            { id: "old-user", role: "user", content: "Long context" },
            {
              id: "compact-marker",
              role: "assistant",
              parts: [{ type: "compaction", auto: true, tail_start_id: "tail-1" }],
            },
            { id: "tail-1", role: "user", content: "Retained tail" },
          ],
        },
      );

      assert.equal(handled, true);
      const messages = captured.getMessages();
      assert.equal(messages.some((msg) => msg.type === "chatHistory"), true);
      assert.equal(
        messages.some(
          (msg) =>
            msg.type === "compactionStatus" &&
            msg.status === "done" &&
            msg.compactionDividerAfterMessageId === "tail-1",
        ),
        true,
      );
    });
  });
});
