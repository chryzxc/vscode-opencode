/**
 * Regression: Centralized debug payload filter normalizer must check
 * syncEvent.data.type paths for correct live-only event classification.
 *
 * Bug: The normalizedCentralizedEventType() function checked type/event/kind,
 * payload.type, syncEvent.type, and payload.syncEvent.type — but NOT
 * syncEvent.data.type. Many real SSE events carry the event type at
 * syncEvent.data.type, so they resolved to empty type strings and were
 * treated as generic persist events instead of live-only.
 *
 * Fix: Added syncEvent.data.type, syncEvent.data.event, syncEvent.data.kind,
 * payload.syncEvent.data.type, payload.syncEvent.data.event, and
 * payload.syncEvent.data.kind to the normalizer fallback chain.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, extractFunctionBody, joinFromRoot } from "../helpers/source-utils.mjs";

const filterSource = readSource(
  [joinFromRoot("src", "shared", "centralizedDebugPayloadFilter.ts")],
  "centralizedDebugPayloadFilter.ts",
);

const normalizerBody = extractFunctionBody(
  filterSource,
  "export function normalizedCentralizedEventType(",
);

test("normalizer is exported (not internal-only)", () => {
  assert.match(
    filterSource,
    /export function normalizedCentralizedEventType\(/,
    "must be exported for reuse by live-event parsers",
  );
});

test("normalizer checks direct type/event/kind fields", () => {
  assert.match(
    normalizerBody,
    /event\.type \?\? event\.event \?\? event\.kind/,
    "must check top-level type/event/kind",
  );
});

test("normalizer checks syncEvent.data.type path", () => {
  assert.match(
    normalizerBody,
    /syncData\?\.type/,
    "must check syncEvent.data.type — this was the missing path",
  );

  assert.match(
    normalizerBody,
    /syncData\?\.event/,
    "must check syncEvent.data.event",
  );

  assert.match(
    normalizerBody,
    /syncData\?\.kind/,
    "must check syncEvent.data.kind",
  );
});

test("normalizer checks payload.syncEvent.data.type path", () => {
  assert.match(
    normalizerBody,
    /payloadSyncData\?\.type/,
    "must check payload.syncEvent.data.type — this was the missing path",
  );

  assert.match(
    normalizerBody,
    /payloadSyncDataType/,
    "must use payloadSyncDataType in the fallback chain",
  );
});

test("normalizer strips numeric suffixes from event types", () => {
  assert.ok(
    normalizerBody.includes('.replace(/'),
    "must strip numeric suffixes from event types via replace",
  );
  assert.ok(
    normalizerBody.includes('d+$'),
    "must match digit pattern at end of event type string",
  );
});

test("exclusion rules include syncEvent.data.type and payload.syncEvent.data.type paths", () => {
  assert.match(
    filterSource,
    /syncEvent\.data\.type/,
    "exclusion rules must include syncEvent.data.type path",
  );

  assert.match(
    filterSource,
    /payload\.syncEvent\.data\.type/,
    "exclusion rules must include payload.syncEvent.data.type path",
  );
});

test("session.status, tui.show, and tui.toast.show are in exclusion rules", () => {
  const exclusionSection = filterSource.slice(
    filterSource.indexOf("CENTRALIZED_DEBUG_EXCLUDED_PATH_RULES"),
    filterSource.indexOf("function"),
  );

  for (const eventType of ["session.status", "tui.show", "tui.toast.show"]) {
    assert.ok(
      exclusionSection.includes(`"${eventType}"`),
      `exclusion rules must include "${eventType}"`,
    );
  }
});

test("disposition returns live-only for session.status and tui events", () => {
  const dispositionBody = extractFunctionBody(
    filterSource,
    "export function getCentralizedDebugPayloadDisposition(",
  );

  assert.match(
    dispositionBody,
    /session\.status/,
    "disposition must recognize session.status",
  );

  assert.match(
    dispositionBody,
    /tui\.toast\.show/,
    "disposition must recognize tui.toast.show",
  );

  assert.match(
    dispositionBody,
    /tui\.show/,
    "disposition must recognize tui.show",
  );

  assert.match(
    dispositionBody,
    /"live-only"/,
    "must return live-only for these event types",
  );
});

// Obsolete after raw SDK event-driven chat: stream events no longer append to a centralized webview tape.
