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

function createManager() {
  const workspaceState = new TestWorkspaceState();
  const logger = createTestLogger();
  const serverManager = {
    compactSession: async (_sessionId: string) => ({ data: {} }),
  } as unknown as OpencodeServerManager;
  const manager = new CompactionManager(
    workspaceState,
    serverManager,
    logger,
    asRecord,
    firstNonEmptyString,
    async (messages: unknown[]) => messages,
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
});
