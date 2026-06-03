import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("src", "services", "opencodeVersionCompatibility.ts")],
  "opencodeVersionCompatibility.ts",
);
const packageJsonSource = readSource([joinFromRoot("package.json")], "package.json");
const serverManagerSource = readSource(
  [joinFromRoot("src", "services", "OpencodeServerManager.ts")],
  "OpencodeServerManager.ts",
);

test("package declares extension to opencode compatibility matrix", () => {
  assert.match(packageJsonSource, /"opencodeCompatibility"/);
  assert.match(packageJsonSource, /"extensionVersion":\s*"0\.1\.14"/);
  assert.match(packageJsonSource, /"supportedRange":\s*">=1\.15\.12 <1\.16\.0"/);
  assert.match(packageJsonSource, /"policy":\s*"warn"/);
});

test("compatibility helper checks sdk and server versions without external semver dependency", () => {
  assert.match(source, /export const OPENCODE_COMPATIBILITY/);
  assert.match(source, /export function checkOpencodeSdkVersion/);
  assert.match(source, /export function checkOpencodeServerVersion/);
  assert.match(source, /function parseVersion/);
  assert.match(source, /function compareVersions/);
  assert.doesNotMatch(source, /from ['"]semver['"]/);
});

test("compatibility helper is warning-only", () => {
  assert.match(source, /status: CompatibilityStatus/);
  assert.match(source, /policy: "warn"/);
  assert.doesNotMatch(source, /throw new Error/);
});

test("server manager runs sdk compatibility checks at startup and server version checks after health", () => {
  assert.match(
    serverManagerSource,
    /logSdkCompatibilityOnce\(\)/,
    "OpencodeServerManager should define one-time sdk compatibility check",
  );
  assert.match(
    serverManagerSource,
    /this\.logSdkCompatibilityOnce\(\);/,
    "ensureRunning should trigger sdk compatibility check",
  );
  assert.match(
    serverManagerSource,
    /checkOpencodeServerVersion\(this\.serverVersion\)/,
    "fetchVersion should evaluate server version compatibility",
  );
  assert.match(
    serverManagerSource,
    /OpenCode server compatibility warning/,
    "unsupported server versions should warn",
  );
  assert.match(
    serverManagerSource,
    /probeOpencodeBinaryVersion\([\s\S]*resolveOpencodeBinaryPath\(\)/,
    "server manager should probe the CLI binary for a version when health omits one",
  );
});
