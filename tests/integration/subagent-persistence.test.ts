import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type * as vscode from "vscode";
import type { SubagentUpdatePayload } from "../../src/services/SubagentTracker.js";
import { SubagentTracker } from "../../src/services/SubagentTracker.js";
import { SubagentPersistence } from "../../src/providers/chat/SubagentPersistence.js";
import {
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

function normalizeSubagentStatus(
  value: unknown,
): "pending" | "running" | "done" | "error" | "orphaned" {
  const status = firstNonEmptyString(value)?.toLowerCase();
  if (
    status === "pending" ||
    status === "running" ||
    status === "done" ||
    status === "error" ||
    status === "orphaned"
  ) {
    return status;
  }
  if (
    status === "completed" ||
    status === "complete" ||
    status === "success" ||
    status === "finished"
  ) {
    return "done";
  }
  if (status === "failed") {
    return "error";
  }
  return "pending";
}

function mergeSubagentEntries(
  existingRaw: unknown,
  incoming: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();

  const upsert = (value: unknown, preferIncoming = false) => {
    const rec = asRecord(value);
    if (!rec) {
      return;
    }
    const id = firstNonEmptyString(rec.id);
    if (!id) {
      return;
    }

    const current = byId.get(id);
    if (!current) {
      byId.set(id, { ...rec, id });
      return;
    }

    byId.set(
      id,
      preferIncoming ? { ...current, ...rec, id } : { ...rec, ...current, id },
    );
  };

  if (Array.isArray(existingRaw)) {
    existingRaw.forEach((entry) => {
      upsert(entry, false);
    });
  }
  incoming.forEach((entry) => {
    upsert(entry, true);
  });

  return Array.from(byId.values());
}

function hydrateSubagentsFromPayload(
  parentMessageId: string,
  payload: {
    summariesByParentMessageId?: Record<string, unknown>;
    detailsById?: Record<string, unknown>;
  },
  fallbackSessionId?: string,
): Array<Record<string, unknown>> {
  const summariesMap = asRecord(payload.summariesByParentMessageId) || {};
  const detailsMap = asRecord(payload.detailsById) || {};
  const summariesRaw = summariesMap[parentMessageId];
  const summaries = Array.isArray(summariesRaw) ? summariesRaw : [];

  return summaries
    .map((summaryRaw) => {
      const summary = asRecord(summaryRaw);
      if (!summary) {
        return null;
      }
      const id = firstNonEmptyString(summary.id);
      if (!id) {
        return null;
      }
      const detail = asRecord(detailsMap[id]) || {};
      const merged: Record<string, unknown> = {
        ...summary,
        ...detail,
        id,
      };
      merged.parentMessageId = firstNonEmptyString(
        merged.parentMessageId,
        parentMessageId,
      );
      merged.parentSessionId = firstNonEmptyString(
        merged.parentSessionId,
        fallbackSessionId,
      );
      merged.status = normalizeSubagentStatus(merged.status);
      merged.latestActivity =
        firstNonEmptyString(
          merged.latestActivity,
          merged.description,
          summary.latestActivity,
        ) || "Subagent update";
      if (!Array.isArray(merged.references)) {
        merged.references = [];
      }
      if (!Array.isArray(merged.progressEvents)) {
        merged.progressEvents = [];
      }
      if (!Array.isArray(merged.thinkingEvents)) {
        merged.thinkingEvents = [];
      }
      if (!Array.isArray(merged.conversationEvents)) {
        merged.conversationEvents = [];
      }
      if (!Array.isArray(merged.timelineEvents)) {
        merged.timelineEvents = [];
      }
      return merged;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function resolveSubagentPayloadSessionId(payload: {
  summariesByParentMessageId?: Record<string, unknown>;
  sessionId?: string;
  childSessionId?: string;
}): string | undefined {
  const summariesMap = asRecord(payload.summariesByParentMessageId) || {};
  for (const summariesRaw of Object.values(summariesMap)) {
    if (!Array.isArray(summariesRaw)) {
      continue;
    }
    for (const summaryRaw of summariesRaw) {
      const summary = asRecord(summaryRaw);
      const sessionId = firstNonEmptyString(summary?.parentSessionId);
      if (sessionId) {
        return sessionId;
      }
    }
  }

  return firstNonEmptyString(payload.sessionId, payload.childSessionId);
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

function createPersistence() {
  const workspaceState = new TestWorkspaceState();
  const persistence = new SubagentPersistence(
    workspaceState,
    new SubagentTracker(),
    createTestLogger(),
    asRecord,
    firstNonEmptyString,
    normalizeSubagentStatus,
    mergeSubagentEntries,
    hydrateSubagentsFromPayload,
    resolveSubagentPayloadSessionId,
  );

  return { persistence, workspaceState };
}

describe("SubagentPersistence", () => {
  describe("getSubagentSnapshotStorageKey", () => {
    it("prefixes session ids with the subagent snapshot namespace", () => {
      const { persistence } = createPersistence();

      assert.equal(
        persistence.getSubagentSnapshotStorageKey("session-123"),
        "opencode.session.subagents.session-123",
      );
    });
  });

  describe("normalizeSubagentPayload", () => {
    it("returns empty maps for nullish or malformed payloads", () => {
      const { persistence } = createPersistence();

      assert.deepEqual(persistence.normalizeSubagentPayload(undefined), {
        summariesByParentMessageId: {},
        detailsById: {},
      });
      assert.deepEqual(persistence.normalizeSubagentPayload(null), {
        summariesByParentMessageId: {},
        detailsById: {},
      });
      assert.deepEqual(persistence.normalizeSubagentPayload("bad"), {
        summariesByParentMessageId: {},
        detailsById: {},
      });
    });

    it("preserves object maps and drops malformed top-level fields", () => {
      const { persistence } = createPersistence();

      assert.deepEqual(
        persistence.normalizeSubagentPayload({
          summariesByParentMessageId: {
            "msg-1": [{ id: "sub-1" }],
          },
          detailsById: {
            "sub-1": { id: "sub-1", status: "running" },
          },
          ignored: true,
        }),
        {
          summariesByParentMessageId: {
            "msg-1": [{ id: "sub-1" }],
          },
          detailsById: {
            "sub-1": { id: "sub-1", status: "running" },
          },
        },
      );
    });
  });

  describe("mergeSubagentPayloads", () => {
    it("merges summary arrays by id and detail records by key", () => {
      const { persistence } = createPersistence();
      const existing: SubagentUpdatePayload = {
        summariesByParentMessageId: {
          "msg-1": [
            {
              id: "sub-1",
              parentSessionId: "session-1",
              parentMessageId: "msg-1",
              status: "running",
              latestActivity: "Old activity",
              references: [],
            },
          ],
        },
        detailsById: {
          "sub-1": {
            id: "sub-1",
            parentSessionId: "session-1",
            parentMessageId: "msg-1",
            status: "running",
            latestActivity: "Old activity",
            references: [],
            thinkingEvents: [],
            conversationEvents: [],
            progressEvents: [],
            timelineEvents: [],
            childSessionId: "child-old",
          },
        },
      };
      const incoming: SubagentUpdatePayload = {
        summariesByParentMessageId: {
          "msg-1": [
            {
              id: "sub-1",
              parentSessionId: "session-1",
              parentMessageId: "msg-1",
              status: "done",
              latestActivity: "New activity",
              references: [],
            },
          ],
          "msg-2": [
            {
              id: "sub-2",
              parentSessionId: "session-1",
              parentMessageId: "msg-2",
              status: "pending",
              latestActivity: "Queued",
              references: [],
            },
          ],
        },
        detailsById: {
          "sub-1": {
            id: "sub-1",
            parentSessionId: "session-1",
            parentMessageId: "msg-1",
            status: "done",
            latestActivity: "New activity",
            references: [],
            thinkingEvents: [],
            conversationEvents: [],
            progressEvents: [],
            timelineEvents: [],
            endedAt: 50,
          },
          "sub-2": {
            id: "sub-2",
            parentSessionId: "session-1",
            parentMessageId: "msg-2",
            status: "pending",
            latestActivity: "Queued",
            references: [],
            thinkingEvents: [],
            conversationEvents: [],
            progressEvents: [],
            timelineEvents: [],
          },
        },
      };

      const merged = persistence.mergeSubagentPayloads(existing, incoming);

      assert.deepEqual(merged.summariesByParentMessageId["msg-1"], [
        {
          id: "sub-1",
          parentSessionId: "session-1",
          parentMessageId: "msg-1",
          status: "done",
          latestActivity: "New activity",
          references: [],
        },
      ]);
      assert.deepEqual(merged.summariesByParentMessageId["msg-2"], [
        {
          id: "sub-2",
          parentSessionId: "session-1",
          parentMessageId: "msg-2",
          status: "pending",
          latestActivity: "Queued",
          references: [],
        },
      ]);
      assert.deepEqual(merged.detailsById["sub-1"], {
        id: "sub-1",
        parentSessionId: "session-1",
        parentMessageId: "msg-1",
        status: "done",
        latestActivity: "New activity",
        references: [],
        thinkingEvents: [],
        conversationEvents: [],
        progressEvents: [],
        timelineEvents: [],
        childSessionId: "child-old",
        endedAt: 50,
      });
      assert.deepEqual(merged.detailsById["sub-2"], {
        id: "sub-2",
        parentSessionId: "session-1",
        parentMessageId: "msg-2",
        status: "pending",
        latestActivity: "Queued",
        references: [],
        thinkingEvents: [],
        conversationEvents: [],
        progressEvents: [],
        timelineEvents: [],
      });
    });
  });

  describe("buildSubagentPayloadFromMessage", () => {
    it("builds normalized summaries and details from assistant message subagents", () => {
      const { persistence } = createPersistence();

      const payload = persistence.buildSubagentPayloadFromMessage(
        {
          info: { id: "parent-msg" },
          subagents: [
            {
              id: "sub-1",
              status: "completed",
              description: "Investigate code path",
              childSessionId: "child-1",
              agentId: "explore",
              providerID: "provider-a",
              modelID: "model-a",
              startedAt: 10,
              endedAt: 20,
              durationMs: 10,
              references: [{ messageID: "m1" }],
            },
            null,
            { status: "running" },
          ],
        },
        "fallback-session",
      );

      assert.deepEqual(payload, {
        summariesByParentMessageId: {
          "parent-msg": [
            {
              id: "sub-1",
              parentSessionId: "fallback-session",
              parentMessageId: "parent-msg",
              childSessionId: "child-1",
              agentId: "explore",
              providerID: "provider-a",
              modelID: "model-a",
              startedAt: 10,
              endedAt: 20,
              durationMs: 10,
              status: "done",
              latestActivity: "Investigate code path",
              references: [{ messageID: "m1" }],
            },
          ],
        },
        detailsById: {
          "sub-1": {
            id: "sub-1",
            status: "done",
            description: "Investigate code path",
            childSessionId: "child-1",
            agentId: "explore",
            providerID: "provider-a",
            modelID: "model-a",
            startedAt: 10,
            endedAt: 20,
            durationMs: 10,
            references: [{ messageID: "m1" }],
            parentSessionId: "fallback-session",
            parentMessageId: "parent-msg",
            latestActivity: "Investigate code path",
            progressEvents: [],
            thinkingEvents: [],
            conversationEvents: [],
            timelineEvents: [],
          },
        },
      });
    });

    it("returns null when message id or valid subagents are missing", () => {
      const { persistence } = createPersistence();

      assert.equal(
        persistence.buildSubagentPayloadFromMessage(
          { subagents: [{ id: "sub-1" }] },
          "fallback-session",
        ),
        null,
      );
      assert.equal(
        persistence.buildSubagentPayloadFromMessage(
          { id: "parent-msg", subagents: [] },
          "fallback-session",
        ),
        null,
      );
      assert.equal(
        persistence.buildSubagentPayloadFromMessage(null, "fallback-session"),
        null,
      );
    });

    it("preserves explicit parent ids and defaults latestActivity when needed", () => {
      const { persistence } = createPersistence();

      const payload = persistence.buildSubagentPayloadFromMessage(
        {
          id: "message-root",
          subagents: [
            {
              id: "sub-2",
              parentSessionId: "explicit-session",
              parentMessageId: "explicit-parent",
              status: "mystery-state",
            },
          ],
        },
        "fallback-session",
      );

      assert.deepEqual(payload, {
        summariesByParentMessageId: {
          "message-root": [
            {
              id: "sub-2",
              parentSessionId: "explicit-session",
              parentMessageId: "explicit-parent",
              childSessionId: undefined,
              agentId: undefined,
              providerID: undefined,
              modelID: undefined,
              startedAt: undefined,
              endedAt: undefined,
              durationMs: undefined,
              status: "pending",
              latestActivity: "Subagent update",
              references: [],
            },
          ],
        },
        detailsById: {
          "sub-2": {
            id: "sub-2",
            parentSessionId: "explicit-session",
            parentMessageId: "explicit-parent",
            status: "pending",
            latestActivity: "Subagent update",
            references: [],
            progressEvents: [],
            thinkingEvents: [],
            conversationEvents: [],
            timelineEvents: [],
          },
        },
      });
    });
  });

  describe("persisted subagent snapshots", () => {
    it("loads normalized snapshots from workspace state and ignores empty payloads", async () => {
      const { persistence, workspaceState } = createPersistence();
      const sessionId = "session-load";

      await workspaceState.update(
        persistence.getSubagentSnapshotStorageKey(sessionId),
        {
          summariesByParentMessageId: {
            "msg-1": [{ id: "sub-1" }],
          },
          detailsById: {
            "sub-1": { id: "sub-1", status: "running" },
          },
        },
      );

      assert.deepEqual(await persistence.loadPersistedSubagentSnapshot(sessionId), {
        summariesByParentMessageId: {
          "msg-1": [{ id: "sub-1" }],
        },
        detailsById: {
          "sub-1": { id: "sub-1", status: "running" },
        },
      });

      await workspaceState.update(
        persistence.getSubagentSnapshotStorageKey("session-empty"),
        {},
      );
      assert.equal(
        await persistence.loadPersistedSubagentSnapshot("session-empty"),
        null,
      );
    });

    it("saves and clears snapshot payloads", async () => {
      const { persistence, workspaceState } = createPersistence();
      const sessionId = "session-save";
      const payload: SubagentUpdatePayload = {
        summariesByParentMessageId: {
          "msg-1": [
            {
              id: "sub-1",
              parentSessionId: "session-save",
              parentMessageId: "msg-1",
              status: "pending",
              latestActivity: "Queued",
              references: [],
            },
          ],
        },
        detailsById: {
          "sub-1": {
            id: "sub-1",
            parentSessionId: "session-save",
            parentMessageId: "msg-1",
            status: "pending",
            latestActivity: "Queued",
            references: [],
            thinkingEvents: [],
            conversationEvents: [],
            progressEvents: [],
            timelineEvents: [],
          },
        },
      };
      const key = persistence.getSubagentSnapshotStorageKey(sessionId);

      await persistence.savePersistedSubagentSnapshot(sessionId, payload);
      assert.deepEqual(workspaceState.get(key), payload);
      assert.deepEqual(await persistence.loadPersistedSubagentSnapshot(sessionId), payload);

      await persistence.clearPersistedSubagentSnapshot(sessionId);
      assert.equal(workspaceState.get(key), undefined);
      assert.equal(await persistence.loadPersistedSubagentSnapshot(sessionId), null);
    });
  });
});
