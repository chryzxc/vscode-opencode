/**
 * Contract test: liveEventRouter is the canonical routing table for
 * live-only stream events, and both streamEvent + streamEventBatch
 * handlers use it for toast and session-status dispatch.
 *
 * This covers the streamEventBatch gap fix where the batch handler
 * was missing UPDATE_LIVE_SESSION_STATUS dispatch (only dispatched
 * toast before the router was introduced).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, joinFromRoot } from "../helpers/source-utils.mjs";

const routerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "liveEventRouter.ts")],
  "liveEventRouter.ts",
);

const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("liveEventRouter exports canonical routing table and entry point", () => {
  assert.match(
    routerSource,
    /export const LIVE_EVENT_ROUTES/,
    "must export canonical routing table",
  );

  assert.match(
    routerSource,
    /export const LIVE_ONLY_EVENT_TYPES/,
    "must export flat array of live-only event types",
  );

  assert.match(
    routerSource,
    /export function routeLiveEvent\(/,
    "must export single entry point function",
  );
});

test("routing table maps tui.toast.show and tui.show to toast destination", () => {
  assert.match(
    routerSource,
    /tui\.toast\.show/,
    "must include tui.toast.show",
  );

  assert.match(
    routerSource,
    /tui\.show/,
    "must include tui.show as alternate name",
  );

  assert.match(
    routerSource,
    /"toast"/,
    "must map to toast destination",
  );
});

test("routing table maps session.status to session-status destination", () => {
  assert.match(
    routerSource,
    /session\.status/,
    "must include session.status",
  );

  assert.match(
    routerSource,
    /"session-status"/,
    "must map to session-status destination",
  );
});

test("routeLiveEvent returns structured result with toast and sessionStatus fields", () => {
  assert.match(
    routerSource,
    /toast\?/,
    "result type must include optional toast field",
  );

  assert.match(
    routerSource,
    /sessionStatus\?/,
    "result type must include optional sessionStatus field",
  );
});

test("messageHandler imports routeLiveEvent from liveEventRouter", () => {
  assert.match(
    handlerSource,
    /import \{ routeLiveEvent \} from "\.\/liveEventRouter"/,
    "must import routeLiveEvent",
  );
});

test("streamEvent handler uses routeLiveEvent for both toast and session status", () => {
  const streamEventSection = handlerSource.slice(
    handlerSource.indexOf('case "streamEvent"'),
    handlerSource.indexOf('case "streamEventBatch"'),
  );

  assert.match(
    streamEventSection,
    /const liveRoute = routeLiveEventToUi\([\s\S]*?payload,[\s\S]*?"streamEvent"/,
    "streamEvent must route through the shared live-event UI entry point",
  );

  assert.match(
    streamEventSection,
    /liveRoute\.toast/,
    "streamEvent must check toast from route result",
  );

  assert.match(
    streamEventSection,
    /liveRoute\.sessionStatus/,
    "streamEvent must check sessionStatus from route result",
  );

  assert.match(
    handlerSource,
    /APPEND_LIVE_TOAST_NOTIFICATION/,
    "streamEvent route must be able to dispatch toast notifications",
  );

  assert.match(
    handlerSource,
    /UPDATE_LIVE_SESSION_STATUS/,
    "streamEvent route must be able to dispatch session status updates",
  );
});

test("streamEventBatch handler uses routeLiveEvent for both toast and session status (gap fix)", () => {
  const batchSection = handlerSource.slice(
    handlerSource.indexOf('case "streamEventBatch"'),
  );

  assert.match(
    batchSection,
    /routeLiveEventToUi\([\s\S]*?evtPayload,[\s\S]*?"streamEventBatch",[\s\S]*?eventIndex,[\s\S]*?\)/,
    "streamEventBatch must route live events with event index",
  );

  assert.match(
    handlerSource,
    /if \(liveRoute\.toast\)[\s\S]*?APPEND_LIVE_TOAST_NOTIFICATION/,
    "shared live-event route must dispatch toast notifications",
  );

  assert.match(
    handlerSource,
    /if \(liveRoute\.sessionStatus\)[\s\S]*?UPDATE_LIVE_SESSION_STATUS/,
    "shared live-event route must dispatch sessionStatus updates",
  );

  assert.match(
    handlerSource,
    /APPEND_LIVE_TOAST_NOTIFICATION/,
    "streamEventBatch route must be able to dispatch toast notifications",
  );

  assert.match(
    handlerSource,
    /UPDATE_LIVE_SESSION_STATUS/,
    "streamEventBatch route must be able to dispatch session status updates — this was the gap fix",
  );
});

test("streamEventBatch iterates with eventIndex for routeLiveEvent", () => {
  const batchSection = handlerSource.slice(
    handlerSource.indexOf('case "streamEventBatch"'),
  );

  assert.match(
    batchSection,
    /events\.entries\(\)/,
    "must use entries() to get index for each event",
  );
});

test("live session status dispatches before the break gate in streamEvent", () => {
  const streamEventSection = handlerSource.slice(
    handlerSource.indexOf('case "streamEvent"'),
    handlerSource.indexOf('case "streamEventBatch"'),
  );

  const dispatchIndex = streamEventSection.indexOf("routeLiveEventToUi");
  const breakGateIndex = streamEventSection.indexOf("breaking early");

  // The dispatch should appear before any break gate that could skip it
  // when no streaming state is active
  assert.ok(
    dispatchIndex > -1,
    "streamEvent live-event routing must exist before processing break gates",
  );

  // Find the first meaningful break gate (not inside a case)
  if (breakGateIndex > -1 && breakGateIndex < dispatchIndex) {
    assert.fail(
      "UPDATE_LIVE_SESSION_STATUS dispatch must appear BEFORE the break gate " +
      "so session.status events are not dropped when streaming hasn't started yet",
    );
  }
});
