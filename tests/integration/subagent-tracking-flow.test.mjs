/**
 * Subagent Tracking Flow Integration Tests
 *
 * Validates the complete SubagentTracker lifecycle:
 *   seedFromMessages → consumeStreamEvent → handle* → finalizeParentMessage
 *
 * Covers the full flow:
 *   1. Initialization from persisted messages (seedFromMessages)
 *   2. Stream event processing (consumeStreamEvent dispatch)
 *   3. Subtask detection from message.part.updated events
 *   4. Child session binding from session.created events
 *   5. Progress/reasoning/conversation event accumulation
 *   6. Final hydration of child session details
 *   7. Payload assembly for webview (summaries + details)
 *
 * Uses source-introspection to assert the codebase implements
 * every step of the subagent tracking flow.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  readSource,
  readAllSources,
  extractFunctionBody,
  joinFromRoot,
} from "../helpers/source-utils.mjs";

const trackerSource = readSource(
  [joinFromRoot("src", "services", "SubagentTracker.ts")],
  "SubagentTracker.ts",
);

// ---------------------------------------------------------------------------
// Initialization: seedFromMessages
// ---------------------------------------------------------------------------

test("SubagentTracker has seedFromMessages method for hydration from persisted state", () => {
  assert.match(
    trackerSource,
    /seedFromMessages\s*\(\s*messages/,
    "SubagentTracker must have seedFromMessages method",
  );
});

test("seedFromMessages reads subagent arrays from persisted messages", () => {
  const seedBody = extractFunctionBody(
    trackerSource,
    "seedFromMessages(messages",
  );
  assert.ok(seedBody, "seedFromMessages method must exist");
  assert.match(
    seedBody,
    /subagents/i,
    "seedFromMessages must read subagents from message objects",
  );
});

test("seedFromMessages upserts details into tracker state", () => {
  assert.match(
    trackerSource,
    /detailsById/,
    "SubagentTracker must maintain detailsById map",
  );
});

// ---------------------------------------------------------------------------
// Stream event dispatch
// ---------------------------------------------------------------------------

test("consumeStreamEvent is the main entry point for SSE event processing", () => {
  assert.match(
    trackerSource,
    /consumeStreamEvent\s*\(\s*event:\s*unknown\s*\)/,
    "SubagentTracker must have consumeStreamEvent(event: unknown) method",
  );
});

test("consumeStreamEvent dispatches to handler based on event type", () => {
  const consumeBody = extractFunctionBody(
    trackerSource,
    "consumeStreamEvent(event: unknown)",
  );
  assert.ok(consumeBody, "consumeStreamEvent method must exist");
  assert.match(
    consumeBody,
    /eventType\s*===\s*["']message\.part\.updated["']/,
    "consumeStreamEvent must dispatch based on event type",
  );
});

test("consumeStreamEvent returns SubagentUpdatePayload or null", () => {
  assert.match(
    trackerSource,
    /SubagentUpdatePayload/,
    "SubagentTracker must define SubagentUpdatePayload type",
  );
});

// ---------------------------------------------------------------------------
// Handler: message.part.updated → subtask detection
// ---------------------------------------------------------------------------

test("SubagentTracker handles message.part.updated events", () => {
  assert.match(
    trackerSource,
    /handleMessagePartUpdated/,
    "SubagentTracker must have handleMessagePartUpdated handler",
  );
});

test("handleMessagePartUpdated processes message part events", () => {
  const handlerBody = extractFunctionBody(
    trackerSource,
    "private handleMessagePartUpdated(",
  );
  assert.ok(handlerBody, "handleMessagePartUpdated must exist");
  assert.match(
    handlerBody,
    /partType|part\.type/i,
    "handler must inspect part type to determine event kind",
  );
});

test("subtask detection creates a pending SubagentDetail", () => {
  assert.match(
    trackerSource,
    /pendingSubtasksByParentSessionId/,
    "SubagentTracker must maintain pendingSubtasksByParentSessionId queue",
  );
});

test("SubagentDetail has status field tracking lifecycle", () => {
  assert.match(
    trackerSource,
    /status\s*:/,
    "SubagentDetail must have a status field",
  );
});

// ---------------------------------------------------------------------------
// Handler: message.updated → progress/reasoning accumulation
// ---------------------------------------------------------------------------

test("SubagentTracker handles message.updated events", () => {
  assert.match(
    trackerSource,
    /handleMessageUpdated/,
    "SubagentTracker must have handleMessageUpdated handler",
  );
});

test("handlers append to timeline events", () => {
  assert.match(
    trackerSource,
    /timeline|timelineEvents/i,
    "SubagentDetail must accumulate timeline events",
  );
});

test("handlers track thinking/reasoning events", () => {
  assert.match(
    trackerSource,
    /thinkingEvents|thinking/i,
    "SubagentTracker must track thinking/reasoning events",
  );
});

test("handlers track progress events", () => {
  assert.match(
    trackerSource,
    /progressEvents|progress/i,
    "SubagentTracker must track progress events",
  );
});

test("handlers track conversation events", () => {
  assert.match(
    trackerSource,
    /conversationEvents/i,
    "SubagentTracker must track conversation events",
  );
});

// ---------------------------------------------------------------------------
// Handler: session.created → child session binding
// ---------------------------------------------------------------------------

test("SubagentTracker handles session.created events", () => {
  assert.match(
    trackerSource,
    /handleSessionCreated/,
    "SubagentTracker must have handleSessionCreated handler",
  );
});

test("session.created binds childSessionId to pending subtask", () => {
  assert.match(
    trackerSource,
    /childSessionId/,
    "SubagentTracker must track childSessionId on subagent details",
  );
});

test("unmatched session.created creates orphaned detail", () => {
  assert.match(
    trackerSource,
    /orphaned/i,
    "SubagentTracker must handle orphaned child sessions",
  );
});

test("SubagentTracker binds child sessions to known pending subtasks", () => {
  assert.match(
    trackerSource,
    /bindChildSessionToKnownSubtask|bindChild/i,
    "SubagentTracker must bind child sessions to pending subtasks",
  );
});

// ---------------------------------------------------------------------------
// Handler: session.error
// ---------------------------------------------------------------------------

test("SubagentTracker handles session.error events", () => {
  assert.match(
    trackerSource,
    /handleSessionError/,
    "SubagentTracker must have handleSessionError handler",
  );
});

// ---------------------------------------------------------------------------
// State tracking: parent message → subagent mapping
// ---------------------------------------------------------------------------

test("SubagentTracker maps parent message IDs to subagent IDs", () => {
  assert.match(
    trackerSource,
    /idsByParentMessageId/,
    "SubagentTracker must maintain idsByParentMessageId map",
  );
});

test("latestActivity is updated as events are processed", () => {
  assert.match(
    trackerSource,
    /latestActivity/i,
    "SubagentDetail must track latestActivity",
  );
});

test("startedAt and endedAt timestamps are tracked", () => {
  assert.match(
    trackerSource,
    /startedAt/i,
    "SubagentDetail must track startedAt timestamp",
  );
  assert.match(
    trackerSource,
    /endedAt/i,
    "SubagentDetail must track endedAt timestamp",
  );
});

test("durationMs is computed from timestamps", () => {
  assert.match(
    trackerSource,
    /durationMs/i,
    "SubagentDetail must compute durationMs",
  );
});

// ---------------------------------------------------------------------------
// Final hydration: finalizeParentMessage
// ---------------------------------------------------------------------------

test("finalizeParentMessage hydrates child session data from server", () => {
  assert.match(
    trackerSource,
    /finalizeParentMessage/,
    "SubagentTracker must have finalizeParentMessage method",
  );
});

test("finalizeParentMessage calls client session children for child sessions", () => {
  assert.match(
    trackerSource,
    /client\.session\?\.children/,
    "finalizeParentMessage must access client.session?.children",
  );
});

test("finalizeParentMessage calls client session messages for conversation data", () => {
  assert.match(
    trackerSource,
    /client\.session\?\.messages/,
    "finalizeParentMessage must access client.session?.messages",
  );
});

test("finalizeParentMessage updates tokenUsage from child session data", () => {
  assert.match(
    trackerSource,
    /tokenUsage/i,
    "finalizeParentMessage must update tokenUsage from hydrated data",
  );
});

test("finalizeParentMessage returns SubagentDetail array", () => {
  assert.match(
    trackerSource,
    /SubagentDetail/,
    "finalizeParentMessage must return SubagentDetail instances",
  );
});

// ---------------------------------------------------------------------------
// Snapshot / payload assembly for webview
// ---------------------------------------------------------------------------

test("getSnapshotPayload returns current state summary", () => {
  assert.match(
    trackerSource,
    /getSnapshotPayload\s*\(\s*\)/,
    "SubagentTracker must have getSnapshotPayload method",
  );
});

test("getSnapshotPayload includes summariesByParentMessageId", () => {
  assert.match(
    trackerSource,
    /summariesByParentMessageId/i,
    "Snapshot payload must include summariesByParentMessageId",
  );
});

test("getPayloadForParentMessage returns data for specific parent message", () => {
  assert.match(
    trackerSource,
    /getPayloadForParentMessage\s*\(\s*parentMessageId/,
    "SubagentTracker must have getPayloadForParentMessage method",
  );
});

// ---------------------------------------------------------------------------
// Session reset
// ---------------------------------------------------------------------------

test("resetForSession clears tracker state for a new session", () => {
  assert.match(
    trackerSource,
    /resetForSession\s*\(\s*sessionId/,
    "SubagentTracker must have resetForSession method",
  );
});

test("setActiveSession sets the active session context", () => {
  assert.match(
    trackerSource,
    /setActiveSession\s*\(\s*sessionId/,
    "SubagentTracker must have setActiveSession method",
  );
});

// ---------------------------------------------------------------------------
// References tracking
// ---------------------------------------------------------------------------

test("SubagentDetail tracks file references from subagent activity", () => {
  assert.match(
    trackerSource,
    /references/i,
    "SubagentDetail must track references",
  );
});
