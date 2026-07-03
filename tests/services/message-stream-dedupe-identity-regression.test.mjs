import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("src", "services", "MessageStreamService.ts")],
  "MessageStreamService.ts",
);

test("stream dedupe keys off stable event identity instead of full payload snapshots", () => {
  const signatureBody = extractFunctionBody(
    source,
    "  private getEventSignature(event: StreamEvent): string {",
  );

  assert.match(
    signatureBody,
    /const eventId =/,
    "dedupe should derive a stable event identity first",
  );
  assert.match(
    signatureBody,
    /part\?\.id|info\?\.id|syncId/,
    "dedupe identity should consider stable ids from event, part, info, or sync wrappers",
  );
  assert.doesNotMatch(
    signatureBody,
    /properties:\s*event\.properties/,
    "dedupe should not hash the full event properties payload anymore",
  );
});

test("stream dedupe does not suppress events that have no stable identity", () => {
  const duplicateBody = extractFunctionBody(
    source,
    "  private isDuplicateEvent(event: StreamEvent): boolean {",
  );

  assert.match(
    duplicateBody,
    /if \(!signature\) \{\s*return false;\s*\}/,
    "events without stable ids should be preserved for downstream centralized handling",
  );
});
