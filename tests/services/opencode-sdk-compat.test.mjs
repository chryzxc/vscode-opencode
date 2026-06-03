import test from "node:test";
import assert from "node:assert/strict";
import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("src", "services", "opencodeSdkCompat.ts")],
  "opencodeSdkCompat.ts",
);

test("compat adapter normalizes sdk sync wrappers into canonical event records", () => {
  assert.match(source, /export function normalizeSdkStreamEvent/);
  assert.match(source, /value\.type !== "sync"/);
  assert.match(source, /name\.replace\(\/\\\.\\d\+\$\/,\s*""\)/);
  assert.match(source, /properties:\s*data/);
});

test("compat adapter preserves directory metadata from global wrappers", () => {
  assert.match(source, /inheritedDirectory/);
  assert.match(source, /normalized\.directory = inheritedDirectory/);
});

test("compat adapter normalizes message.part.delta into a part update compatible payload", () => {
  assert.match(source, /message\.part\.delta/);
  assert.match(source, /partID/);
  assert.match(source, /delta/);
  assert.match(source, /type:\s*"message.part.updated"/);
});

test("compat adapter exposes safe accessors for final prompt response data", () => {
  assert.match(source, /export function getSdkResponseData/);
  assert.match(source, /export function getSdkResponseError/);
  assert.match(source, /export function normalizeSdkAssistantMessage/);
});
