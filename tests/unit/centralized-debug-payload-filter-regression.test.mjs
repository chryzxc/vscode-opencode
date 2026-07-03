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
    "streaming delta events should remain excluded",
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

test("centralized session persistence is permissive for meaningful non-delta events", () => {
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
});
