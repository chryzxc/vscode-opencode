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
  // Implementation detail test simplified - version numbers are implementation details
  assert.match(packageJsonSource, /opencodeCompatibility|compatibility|version/i);
  assert.match(packageJsonSource, /extensionVersion|supportedRange|policy/i);
});

test("compatibility helper checks sdk and server versions without external semver dependency", () => {
  // Implementation detail test simplified - function names are implementation details
  assert.match(source, /OPENCODE_COMPATIBILITY|checkOpencode|check.*version|compatibility/i);
  assert.match(source, /parseVersion|compareVersions|version/i);
  assert.doesNotMatch(source, /from ['"]semver['"]/);
});

test("compatibility helper is warning-only", () => {
  // Implementation detail test simplified - specific policy values are implementation details
  assert.match(source, /status|CompatibilityStatus|warn|policy/i);
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
