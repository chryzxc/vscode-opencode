import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SubagentTracker } from "../../src/services/SubagentTracker.js";
import { adaptSdkMessage } from "../../src/services/SdkMessageAdapter.js";
import { normalizeMessage } from "../../webview/shared/src/chat/lib/messageHandler.js";

function makeEvent(type: string, properties: Record<string, unknown>) {
  return { type, properties };
}

function makeSubtaskPart(
  sessionId: string,
  messageId: string,
  partId: string,
  overrides?: Record<string, unknown>,
) {
  return {
    type: "subtask",
    sessionID: sessionId,
    messageID: messageId,
    id: partId,
    ...overrides,
  };
}

describe("SubagentTracker", () => {
  let tracker: SubagentTracker;

  beforeEach(() => {
    tracker = new SubagentTracker();
    tracker.setActiveSession("parent-session-1");
  });

  describe("resetForSession", () => {
    it("clears all internal state", () => {
      const event = makeEvent("message.part.updated", {
        part: makeSubtaskPart("parent-session-1", "msg-1", "part-1", {
          description: "Build feature",
        }),
      });
      tracker.consumeStreamEvent(event);
      assert.ok(tracker.getSnapshotPayload().detailsById);

      tracker.resetForSession("new-session");
      const snapshot = tracker.getSnapshotPayload();
      assert.deepEqual(Object.keys(snapshot.summariesByParentMessageId), []);
      assert.deepEqual(Object.keys(snapshot.detailsById), []);
    });
  });

  describe("consumeStreamEvent — subtask creation", () => {
    it("links native call_omo_agent child sessions without a session.created event", () => {
      const launch = tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: {
            type: "tool",
            id: "part-launch",
            callID: "call-launch",
            sessionID: "parent-session-1",
            messageID: "msg-1",
            tool: "call_omo_agent",
            state: {
              status: "completed",
              input: { description: "Explore login/auth flow", subagent_type: "explore" },
              output: "Background agent task launched successfully.\n\nTask ID: bg_auth\nSession ID: ses_auth\nDescription: Explore login/auth flow\nAgent: explore (subagent)",
            },
          },
        }),
      );

      assert.ok(launch);
      const detail = Object.values(launch.detailsById)[0];
      assert.equal(detail.backgroundTaskId, "bg_auth");
      assert.equal(detail.childSessionId, "ses_auth");
      assert.equal(detail.latestActivity, "Explore login/auth flow");

      const childActivity = tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: {
            type: "reasoning",
            id: "child-thought",
            sessionID: "ses_auth",
            messageID: "child-message-1",
            text: "Inspecting authentication routes",
          },
        }),
      );
      assert.ok(childActivity, "mapped child activity should update the parent card");
      const updated = Object.values(childActivity.detailsById)[0];
      assert.equal(updated.parentMessageId, "msg-1");
      assert.equal(updated.thinkingEvents[0].text, "Inspecting authentication routes");
      assert.equal(updated.conversationEvents[0].text, "Inspecting authentication routes");
      assert.ok(
        updated.timelineEvents.some((event) => event.label === "Inspecting authentication routes"),
        "child stream activity should be emitted to the parent-owned modal timeline",
      );
      assert.ok(
        updated.rawEvents.some((event: any) => event?.properties?.part?.id === "child-thought"),
        "the child event tape should reach the modal",
      );
    });

    it("creates a subagent from a subtask part in the active session", () => {
      const payload = tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-1", "part-1", {
            description: "Build feature X",
            agent: "explore",
          }),
        }),
      );

      assert.ok(payload, "should return a payload");
      assert.ok("msg-1" in payload.summariesByParentMessageId, "should track parent message");
      const summaries = payload.summariesByParentMessageId["msg-1"];
      assert.equal(summaries.length, 1);
      assert.equal(summaries[0].status, "pending");
      assert.equal(summaries[0].latestActivity, "Build feature X");
      assert.equal(summaries[0].agentId, "explore");
    });

    it("creates a subagent from an agent part in the active session", () => {
      const payload = tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: {
            type: "agent",
            sessionID: "parent-session-1",
            messageID: "msg-1",
            id: "bg_123",
            name: "sisyphus-worker",
            description: "Investigate failing tests",
          },
        }),
      );

      assert.ok(payload, "should return a payload");
      const summaries = payload.summariesByParentMessageId["msg-1"];
      assert.equal(summaries.length, 1);
      assert.equal(summaries[0].id, "subtask:parent-session-1:msg-1:bg_123");
      assert.equal(summaries[0].status, "pending");
      assert.equal(summaries[0].latestActivity, "Investigate failing tests");
      assert.equal(summaries[0].agentId, "sisyphus-worker");
    });

    it("ignores events for sessions other than the active one", () => {
      const payload = tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("other-session", "msg-1", "part-1"),
        }),
      );

      assert.equal(payload, null, "should not produce payload for unrelated session");
    });

    it("ignores events without sessionId or messageId", () => {
      const payload = tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: { type: "subtask", id: "part-1" },
        }),
      );

      assert.equal(payload, null);
    });

    it("ignores non-object events", () => {
      assert.equal(tracker.consumeStreamEvent(null), null);
      assert.equal(tracker.consumeStreamEvent(undefined), null);
      assert.equal(tracker.consumeStreamEvent("string"), null);
      assert.equal(tracker.consumeStreamEvent(42), null);
    });
  });

  describe("consumeStreamEvent — session.created (child session binding)", () => {
    it("binds a child session to an existing subtask", () => {
      tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-1", "part-1", {
            description: "Explore codebase",
          }),
        }),
      );

      const payload = tracker.consumeStreamEvent(
        makeEvent("session.created", {
          info: {
            id: "child-session-1",
            parentID: "parent-session-1",
          },
        }),
      );

      assert.ok(payload);
      const details = Object.values(payload.detailsById);
      assert.ok(details.length >= 1);
      const subtaskDetail = details.find((d) => d.parentMessageId === "msg-1");
      assert.ok(subtaskDetail, "child session should be bound to the subtask");
      assert.equal(subtaskDetail.childSessionId, "child-session-1");
      assert.equal(subtaskDetail.status, "running");
    });
  });

  describe("getActiveProcessingSessionIds", () => {
    it("returns parent session IDs with pending or running subagents", () => {
      tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-1", "part-1"),
        }),
      );

      const active = tracker.getActiveProcessingSessionIds();
      assert.deepEqual(active, ["parent-session-1"]);
    });

    it("returns empty array when no subagents are processing", () => {
      assert.deepEqual(tracker.getActiveProcessingSessionIds(), []);
    });
  });

  describe("getLatestParentMessageId", () => {
    it("tracks the latest parent message for a session", () => {
      tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-1", "part-1"),
        }),
      );
      assert.equal(tracker.getLatestParentMessageId("parent-session-1"), "msg-1");

      tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-2", "part-2"),
        }),
      );
      assert.equal(tracker.getLatestParentMessageId("parent-session-1"), "msg-2");
    });

    it("returns undefined for unknown sessions", () => {
      assert.equal(tracker.getLatestParentMessageId("unknown"), undefined);
    });
  });

  describe("seedFromMessages", () => {
    it("recreates call_omo_agent ownership from the rehydrated SDK transcript", () => {
      const sdkMessage = {
        info: {
          id: "msg-1",
          role: "assistant",
          sessionID: "parent-session-1",
          time: { created: 1 },
        },
        parts: [{
          type: "tool",
          id: "part-launch",
          tool: "call_omo_agent",
          state: {
            status: "completed",
            input: { description: "Explore gameplay flow", subagent_type: "explore" },
            output: "Task ID: bg_gameplay\nSession ID: ses_gameplay\nDescription: Explore gameplay flow\nAgent: explore (subagent)",
          },
        }],
      } as any;

      const rendered = adaptSdkMessage(sdkMessage);
      assert.equal(rendered.subagents?.[0]?.backgroundTaskId, "bg_gameplay");
      assert.equal(rendered.subagents?.[0]?.childSessionId, "ses_gameplay");
      const normalized = normalizeMessage(rendered as any, null);
      assert.equal(
        normalized?.subagents?.[0]?.childSessionId,
        "ses_gameplay",
        "the rehydrated invocation must remain available to the inline subagent card",
      );

      tracker.seedFromMessages([sdkMessage]);
      const detail = Object.values(tracker.getSnapshotPayload().detailsById)[0];
      assert.equal(detail.backgroundTaskId, "bg_gameplay");
      assert.equal(detail.childSessionId, "ses_gameplay");
    });

    it("seeds subagent state from persisted message history", () => {
      const messages = [
        {
          role: "assistant",
          id: "msg-1",
          sessionID: "parent-session-1",
          subagents: [
            {
              id: "sub-1",
              parentSessionId: "parent-session-1",
              parentMessageId: "msg-1",
              childSessionId: "child-1",
              status: "done",
              latestActivity: "Completed",
            },
          ],
        },
      ];

      tracker.seedFromMessages(messages);

      const snapshot = tracker.getSnapshotPayload();
      assert.ok("sub-1" in snapshot.detailsById);
      assert.equal(snapshot.detailsById["sub-1"].status, "done");
    });

    it("skips non-assistant messages", () => {
      const messages = [
        { role: "user", id: "msg-1", text: "hello" },
      ];
      tracker.seedFromMessages(messages);
      const snapshot = tracker.getSnapshotPayload();
      assert.deepEqual(Object.keys(snapshot.detailsById), []);
    });

    it("skips messages without subagents", () => {
      const messages = [
        { role: "assistant", id: "msg-1", sessionID: "s1" },
      ];
      tracker.seedFromMessages(messages);
      assert.deepEqual(Object.keys(tracker.getSnapshotPayload().detailsById), []);
    });
  });

  describe("getSnapshotPayload", () => {
    it("returns empty payload when no subagents tracked", () => {
      const payload = tracker.getSnapshotPayload();
      assert.deepEqual(payload.summariesByParentMessageId, {});
      assert.deepEqual(payload.detailsById, {});
    });

    it("returns all tracked subagents", () => {
      tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-1", "part-1"),
        }),
      );
      tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-1", "part-2"),
        }),
      );

      const payload = tracker.getSnapshotPayload();
      assert.ok("msg-1" in payload.summariesByParentMessageId);
      assert.equal(payload.summariesByParentMessageId["msg-1"].length, 2);
    });
  });

  describe("getPayloadForParentMessage", () => {
    it("returns payload scoped to a specific parent message", () => {
      tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-1", "part-1"),
        }),
      );
      tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-2", "part-2"),
        }),
      );

      const payload = tracker.getPayloadForParentMessage("msg-1");
      assert.ok("msg-1" in payload.summariesByParentMessageId);
      assert.ok(!("msg-2" in payload.summariesByParentMessageId));
    });
  });

  describe("session.error handling", () => {
    it("marks subagent as errored on session.error event", () => {
      tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-1", "part-1"),
        }),
      );

      tracker.consumeStreamEvent(
        makeEvent("session.created", {
          info: {
            id: "child-1",
            parentID: "parent-session-1",
          },
        }),
      );

      const payload = tracker.consumeStreamEvent(
        makeEvent("session.error", {
          sessionID: "child-1",
          error: { message: "Something went wrong" },
        }),
      );

      assert.ok(payload);
      const erroredDetail = Object.values(payload.detailsById).find(
        (d) => d.childSessionId === "child-1",
      );
      assert.ok(erroredDetail);
      assert.equal(erroredDetail.status, "error");
    });

    it("prefers the nested server error message over the UnknownError wrapper name", () => {
      tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-1", "part-1"),
        }),
      );

      tracker.consumeStreamEvent(
        makeEvent("session.created", {
          info: {
            id: "child-1",
            parentID: "parent-session-1",
          },
        }),
      );

      const payload = tracker.consumeStreamEvent(
        makeEvent("session.error", {
          sessionID: "child-1",
          error: {
            name: "UnknownError",
            data: {
              message: "Unexpected server error. Check server logs for details.",
            },
          },
        }),
      );

      assert.ok(payload);
      const erroredDetail = Object.values(payload.detailsById).find(
        (d) => d.childSessionId === "child-1",
      );
      assert.ok(erroredDetail);
      assert.equal(
        erroredDetail.errorText,
        "Unexpected server error. Check server logs for details.",
      );
    });

    it("keeps an actionable model error when a later ProviderModelNotFound stack arrives", () => {
      tracker.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-1", "part-1"),
        }),
      );
      tracker.consumeStreamEvent(
        makeEvent("session.created", {
          info: { id: "child-1", parentID: "parent-session-1" },
        }),
      );
      tracker.consumeStreamEvent(
        makeEvent("session.error", {
          sessionID: "child-1",
          error: {
            message:
              "Model not found: opencode-go/qwen3.5-plus. Did you mean: qwen3.6-plus?",
          },
        }),
      );

      const payload = tracker.consumeStreamEvent(
        makeEvent("session.error", {
          sessionID: "child-1",
          error: {
            message:
              "ProviderModelNotFoundError: at <anonymous> (/$bunfs/root/chunk.js:1:1)",
          },
        }),
      );

      const erroredDetail = Object.values(payload!.detailsById).find(
        (detail) => detail.childSessionId === "child-1",
      );
      assert.ok(erroredDetail);
      assert.equal(
        erroredDetail.errorText,
        "Model not found: opencode-go/qwen3.5-plus. Did you mean: qwen3.6-plus?",
      );
      assert.equal(
        erroredDetail.timelineEvents.filter((event) => event.type === "session.error").length,
        1,
      );
    });

    it("uses the model named by a not-found error instead of the parent-model fallback", () => {
      const trackerWithParentFallback = new SubagentTracker(() => ({
        providerID: "zai-coding-plan",
        modelID: "glm-5.2",
      }));
      trackerWithParentFallback.setActiveSession("parent-session-1");
      trackerWithParentFallback.consumeStreamEvent(
        makeEvent("message.part.updated", {
          part: makeSubtaskPart("parent-session-1", "msg-1", "part-1"),
        }),
      );
      trackerWithParentFallback.consumeStreamEvent(
        makeEvent("session.created", {
          info: { id: "child-1", parentID: "parent-session-1" },
        }),
      );

      const beforeError = Object.values(
        trackerWithParentFallback.getSnapshotPayload().detailsById,
      ).find((detail) => detail.childSessionId === "child-1");
      assert.equal(beforeError?.providerID, "zai-coding-plan");
      assert.equal(beforeError?.modelID, "glm-5.2");

      const payload = trackerWithParentFallback.consumeStreamEvent(
        makeEvent("session.error", {
          sessionID: "child-1",
          error: {
            message:
              "Model not found: opencode/gpt-5-nano. Did you mean: gpt-5-nano?",
          },
        }),
      );
      const erroredDetail = Object.values(payload!.detailsById).find(
        (detail) => detail.childSessionId === "child-1",
      );

      assert.equal(erroredDetail?.providerID, "opencode");
      assert.equal(erroredDetail?.modelID, "gpt-5-nano");
    });
  });
});
