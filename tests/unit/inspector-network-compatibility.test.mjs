import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const sourcePath = path.join(
  process.cwd(),
  "src",
  "utils",
  "InspectorNetworkCompatibility.ts",
);
const extensionPath = path.join(process.cwd(), "src", "extension.ts");

test("inspector network compatibility ignores malformed events and normalizes protocol lengths", () => {
  const source = fs.readFileSync(sourcePath, "utf8");

  assert.match(source, /Network\.dataReceived/);
  assert.match(source, /!params \|\| params\.data === undefined \|\| params\.data === null/);
  assert.match(source, /Empty chunks remain valid/i);
  assert.match(source, /discard only the malformed diagnostic event/i);
  assert.match(source, /typeof normalized\.dataLength !== "number"/);
  assert.match(source, /normalized\.dataLength = 0/);
  assert.match(source, /typeof normalized\.encodedDataLength !== "number"/);
  assert.match(source, /normalized\.encodedDataLength = normalized\.dataLength/);
});

test("compatibility shim is installed before extension services initialize", () => {
  const source = fs.readFileSync(extensionPath, "utf8");
  const shimIndex = source.indexOf("installInspectorNetworkCompatibility();");
  const serverIndex = source.indexOf("serverManager = new OpencodeServerManager(context);");

  assert.ok(shimIndex >= 0, "activation installs the inspector compatibility shim");
  assert.ok(serverIndex >= 0, "activation initializes the server manager");
  assert.ok(shimIndex < serverIndex, "shim runs before extension services can make requests");
});
