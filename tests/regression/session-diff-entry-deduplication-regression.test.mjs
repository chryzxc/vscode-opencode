import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

test("centralized transcript projection deduplicates repeated session.diff conversation entries", () => {
  const projectionBody = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedTranscriptProjection(",
  );

  assert.match(
    chatShellSource,
    /function buildCentralizedSessionDiffFingerprint\(\s*diff: CentralizedSessionDiffEvent,\s*\): string/s,
    "chat shell should derive a stable fingerprint for session.diff entries",
  );
  assert.match(
    projectionBody,
    /const seenSessionDiffFingerprints = new Set<string>\(\);/,
    "projection should track already-rendered session.diff entries",
  );
  assert.match(
    projectionBody,
    /const diffFingerprint = buildCentralizedSessionDiffFingerprint\(diff\);[\s\S]*if \(seenSessionDiffFingerprints\.has\(diffFingerprint\)\) \{\s*continue;\s*\}[\s\S]*seenSessionDiffFingerprints\.add\(diffFingerprint\);/s,
    "projection should skip duplicate session.diff cards while leaving the raw tape untouched",
  );
});

test("session.diff fingerprint ignores per-event ids and timestamps so repeated snapshots collapse", () => {
  const fingerprintBody = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedSessionDiffFingerprint(",
  );

  assert.doesNotMatch(
    fingerprintBody,
    /id:\s*firstNonEmptyString\(diff\.id\)/,
    "fingerprint should not depend on the session.diff event id when the file snapshot is unchanged",
  );
  assert.doesNotMatch(
    fingerprintBody,
    /createdAt:/,
    "fingerprint should not depend on the session.diff timestamp when the file snapshot is unchanged",
  );
  assert.match(
    fingerprintBody,
    /sessionId:\s*firstNonEmptyString\(diff\.sessionId\)/,
    "fingerprint should remain session-scoped",
  );
  assert.match(
    fingerprintBody,
    /files:\s*fileFingerprint/,
    "fingerprint should be driven by the normalized diff file payload",
  );
});
