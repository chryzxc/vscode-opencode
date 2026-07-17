import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("src", "shared", "centralizedDebugPayloadFilter.ts")],
  "centralizedDebugPayloadFilter.ts",
);
const generated = readSource(
  [
    joinFromRoot(
      "webview",
      "shared",
      "src",
      "chat",
      "lib",
      "generated",
      "centralizedDebugPayloadFilter.ts",
    ),
  ],
  "generated centralizedDebugPayloadFilter.ts",
);
const sessionServiceSource = readSource(
  [joinFromRoot("src", "services", "SessionService.ts")],
  "SessionService.ts",
);

test("centralized debug payload filter keeps step-start and step-finish event types", () => {
  assert.doesNotMatch(
    source,
    /"step-start"/,
    "step-start should not be blacklisted from the centralized debug payload filter",
  );
  assert.doesNotMatch(
    source,
    /"step-finish"/,
    "step-finish should not be blacklisted from the centralized debug payload filter",
  );
  assert.match(
    source,
    /"message\.part\.delta"/,
    "explicit message.part.delta event types should remain excluded",
  );
  assert.match(
    source,
    /"tui\.toast\.show"/,
    "toast events should be excluded from the centralized debug payload filter",
  );
  assert.match(
    generated,
    /"tui\.toast\.show"/,
    "generated centralized debug payload filter should also exclude toast events",
  );
  assert.match(
    source,
    /function isEphemeralCentralizedPayload\(/,
    "shared centralized debug payload filter should define an ephemeral payload guard",
  );
  assert.match(
    generated,
    /function isEphemeralCentralizedPayload\(/,
    "generated centralized debug payload filter should stay aligned with the ephemeral payload guard",
  );
  assert.match(
    source,
    /export function getCentralizedDebugPayloadDisposition\(/,
    "shared centralized debug payload filter should export a shared disposition helper",
  );
  assert.match(
    generated,
    /export function getCentralizedDebugPayloadDisposition\(/,
    "generated centralized debug payload filter should export the same disposition helper",
  );
  assert.match(
    source,
    /normalizedCentralizedEventType\(payload\)[\s\S]*message\.part\.updated[\s\S]*hasReasoningLikeChunk\(payload\)/,
    "reasoning-only message.part.updated chunks should be excluded from centralized persistence",
  );
  assert.match(
    generated,
    /normalizedCentralizedEventType\(payload\)[\s\S]*message\.part\.updated[\s\S]*hasReasoningLikeChunk\(payload\)/,
    "generated centralized debug payload filter should also exclude reasoning-only part updates",
  );
  assert.match(
    source,
    /function hasDeltaProperty\(/,
    "shared centralized debug payload filter should detect delta-bearing payloads explicitly",
  );
  assert.match(
    generated,
    /function hasDeltaProperty\(/,
    "generated centralized debug payload filter should stay aligned with delta detection",
  );
  assert.match(
    source,
    /message\.part\.updated[\s\S]*hasReasoningLikeChunk\(payload\)\s*\|\|\s*hasDeltaProperty\(payload\)/,
    "shared centralized debug payload filter should exclude message.part.updated chunks when they carry a delta property",
  );
  assert.match(
    generated,
    /message\.part\.updated[\s\S]*hasReasoningLikeChunk\(payload\)\s*\|\|\s*hasDeltaProperty\(payload\)/,
    "generated centralized debug payload filter should also exclude delta-bearing message.part.updated chunks",
  );
  assert.match(
    source,
    /return getCentralizedDebugPayloadDisposition\(payload\) === "persist"/,
    "shared shouldIncludeCentralizedDebugPayload should delegate to the shared disposition helper",
  );
  assert.match(
    generated,
    /return getCentralizedDebugPayloadDisposition\(payload\) === "persist"/,
    "generated shouldIncludeCentralizedDebugPayload should delegate to the shared disposition helper",
  );
  assert.match(
    source,
    /"server\.connected"/,
    "server.connected should be excluded from the centralized debug payload filter as transport noise",
  );
  assert.match(
    generated,
    /"server\.connected"/,
    "generated centralized debug payload filter should also exclude server.connected",
  );
  assert.doesNotMatch(
    source,
    /"properties\.info\.format\.type"[\s\S]*"json_schema"/,
    "json_schema should not blacklist whole events from the shared centralized debug payload filter",
  );
  assert.doesNotMatch(
    generated,
    /"properties\.info\.format\.type"[\s\S]*"json_schema"/,
    "generated centralized debug payload filter should not blacklist whole events for json_schema metadata",
  );
  assert.match(
    source,
    /CENTRALIZED_DEBUG_STRIP_FORMAT_PATHS[\s\S]*"properties\.info\.format"[\s\S]*"syncEvent\.data\.info\.format"/,
    "shared centralized debug payload filter should strip json_schema format blocks instead of dropping the whole event",
  );
  assert.match(
    generated,
    /CENTRALIZED_DEBUG_STRIP_FORMAT_PATHS[\s\S]*"properties\.info\.format"[\s\S]*"syncEvent\.data\.info\.format"/,
    "generated centralized debug payload filter should strip json_schema format blocks instead of dropping the whole event",
  );
  assert.match(
    source,
    /export function sanitizeCentralizedDebugPayload/,
    "shared centralized debug payload filter should export a sanitizer for stripping json_schema metadata",
  );
  assert.match(
    generated,
    /export function sanitizeCentralizedDebugPayload/,
    "generated centralized debug payload filter should export the same json_schema sanitizer",
  );
});

test("generated centralized debug filter stays aligned with source for /global/event persistence", () => {
  assert.match(
    source,
    /Removed source filtering for "\/global\/event"/,
    "source filter should document that /global/event persistence is intentionally allowed",
  );
  assert.match(
    generated,
    /Removed source filtering for "\/global\/event"/,
    "generated webview filter should carry the same /global/event allowance as the source filter",
  );
  assert.doesNotMatch(
    generated,
    /if \(source === "\/global\/event"\)/,
    "generated filter should not silently drop /global/event payloads after sync/parity changes",
  );
});

test("centralized session persistence policy excludes delta-bearing payloads", () => {
  assert.doesNotMatch(
    source,
    /const CENTRALIZED_SESSION_PERSISTED_EVENT_TYPES = new Set\(/,
    "centralized session persistence should not rely on a narrow hard-coded allowlist",
  );
  assert.match(
    source,
    /Persist every non-noise centralized event/,
    "source filter should document that non-noise event persistence is intentionally broad",
  );
  assert.match(
    generated,
    /Persist every non-noise centralized event/,
    "generated filter should stay aligned with the permissive persistence policy",
  );
  assert.match(
    source,
    /delta-bearing message\.part\.updated lifecycle[\s\S]*payloads are excluded/,
    "source filter should document that delta-bearing message.part.updated payloads are excluded from persistence",
  );
  assert.match(
    generated,
    /delta-bearing message\.part\.updated lifecycle[\s\S]*payloads are excluded/,
    "generated filter should document the same delta-bearing message.part.updated exclusion rule",
  );
  assert.match(
    source,
    /Live-only UI events such as tui\.toast\.show and reasoning chunk frames are[\s\S]*excluded separately/,
    "source filter should document the live-only exclusions for toast and reasoning chunk events",
  );
  assert.match(
    generated,
    /Live-only UI events such as tui\.toast\.show and reasoning chunk frames are[\s\S]*excluded separately/,
    "generated filter should document the same live-only exclusions",
  );
  // Obsolete after raw SDK event-driven chat: SessionService no longer owns raw centralized event persistence.
});
