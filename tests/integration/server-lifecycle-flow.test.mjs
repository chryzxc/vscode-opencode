/**
 * Server Lifecycle Flow Integration Tests
 *
 * Validates the complete OpencodeServerManager lifecycle flow:
 *   idle → starting → running  (happy path)
 *   idle → starting → error    (spawn failure / timeout)
 *   running → error → starting (auto-reconnect)
 *   running → idle             (dispose)
 *
 * Uses source-introspection to assert that the codebase implements
 * every step of the server lifecycle state machine and the
 * cross-service interactions required for each transition.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  readSource,
  readAllSources,
  extractFunctionBody,
  joinFromRoot,
} from "../helpers/source-utils.mjs";

const serverManagerSource = readSource(
  [joinFromRoot("src", "services", "OpencodeServerManager.ts")],
  "OpencodeServerManager.ts",
);

// ---------------------------------------------------------------------------
// State machine definition
// ---------------------------------------------------------------------------

test("OpencodeServerManager defines ServerStatus type with all lifecycle states", () => {
  assert.match(
    serverManagerSource,
    /type\s+ServerStatus\s*=\s*["|']idle["|']\s*\|\s*["|']starting["|']\s*\|\s*["|']running["|']\s*\|\s*["|']error["|']/,
    "ServerStatus must include idle, starting, running, error",
  );
});

test("OpencodeServerManager initial status is idle", () => {
  assert.match(
    serverManagerSource,
    /private\s+_status\s*:\s*ServerStatus\s*=\s*["']idle["']/,
    "Initial _status must be 'idle'",
  );
});

// ---------------------------------------------------------------------------
// Startup flow: idle → starting → running
// ---------------------------------------------------------------------------

test("ensureRunning delegates to internal method that sets status to starting", () => {
  assert.match(
    serverManagerSource,
    /this\.setStatus\(\s*["']starting["']\s*\)/,
    "ensureRunning must transition to 'starting' status",
  );
});

test("ensureRunning tries configured port before spawning a new server", () => {
  assert.match(
    serverManagerSource,
    /configuredPort\s*=\s*config\.get<number>\s*\(\s*["']serverPort["']\s*,\s*0\s*\)/,
    "ensureRunning must read opencode.serverPort configuration",
  );
  assert.match(
    serverManagerSource,
    /if\s*\(\s*configuredPort\s*>\s*0\s*\)/,
    "ensureRunning must attempt configured port when > 0",
  );
});

test("ensureRunning tries persisted managed port as second fallback", () => {
  assert.match(
    serverManagerSource,
    /getPersistedManagedPort/,
    "ensureRunning must check persisted managed port",
  );
});

test("startServer allocates a dynamic port via findAvailablePort", () => {
  const startServerBody = extractFunctionBody(
    serverManagerSource,
    "private async startServer(): Promise<OpencodeClient>",
  );
  assert.ok(startServerBody, "startServer method must exist");
  assert.match(
    startServerBody,
    /this\.port\s*=\s*await\s+this\.findAvailablePort\(\)/,
    "startServer must call findAvailablePort",
  );
});

test("startServer spawns opencode serve with port argument", () => {
  assert.match(
    serverManagerSource,
    /cp\.spawn\(\s*\n?\s*opencodeBinary\s*,\s*\n?\s*\[\s*["']serve["']\s*,\s*["']--port["']\s*,/,
    "startServer must spawn 'opencode serve --port <port>'",
  );
});

test("startServer detects server readiness from stdout tokens", () => {
  assert.match(
    serverManagerSource,
    /output\.includes\(\s*["']Server running["']\s*\)\s*\|\|\s*output\.includes\(\s*["']listening["']\s*\)/,
    "startServer must watch stdout for 'Server running' or 'listening'",
  );
});

test("startServer creates SDK client on successful readiness", () => {
  assert.match(
    serverManagerSource,
    /this\.connectToServer\(\)/,
    "startServer must call connectToServer when server is ready",
  );
});

test("connectToServer creates SDK client with localhost URL and port", () => {
  assert.match(
    serverManagerSource,
    /this\.client\s*=\s*createOpencodeClient\(\s*\{[^}]*baseUrl:\s*`http:\/\/localhost:\$\{(configuredPort|persistedPort)\}`/,
    "connectToServer must create client with http://localhost:<port>",
  );
});

test("connectToServer sets status to running on success", () => {
  const connectBody = extractFunctionBody(
    serverManagerSource,
    "private async connectToServer(): Promise<OpencodeClient>",
  );
  assert.ok(connectBody, "connectToServer method must exist");
  assert.match(
    connectBody,
    /this\.setStatus\(\s*["']running["']\s*\)/,
    "connectToServer must set status to 'running'",
  );
});

test("connectToServer persists managed port after successful connection", () => {
  const connectBody = extractFunctionBody(
    serverManagerSource,
    "private async connectToServer(): Promise<OpencodeClient>",
  );
  assert.match(
    connectBody,
    /this\.persistManagedPort\(\s*this\.port\s*\)/,
    "connectToServer must persist the managed port",
  );
});

// ---------------------------------------------------------------------------
// Startup failure: idle → starting → error
// ---------------------------------------------------------------------------

test("startServer handles ENOENT (CLI not found) with user-facing error message", () => {
  assert.match(
    serverManagerSource,
    /ENOENT/,
    "startServer must handle ENOENT error from spawn",
  );
  assert.match(
    serverManagerSource,
    /vscode\.window\.showErrorMessage/,
    "startServer must show user-facing error on spawn failure",
  );
});

test("startServer enforces a startup timeout", () => {
  assert.match(
    serverManagerSource,
    /startupTimeout\s*=\s*setTimeout/,
    "startServer must set a startup timeout",
  );
  assert.match(
    serverManagerSource,
    /serverReady/,
    "startServer must track serverReady flag to guard against timeout race",
  );
});

test("startServer sets status to error on timeout", () => {
  assert.match(
    serverManagerSource,
    /this\.setStatus\(\s*["']error["']\s*,/,
    "startServer must set status to 'error' on timeout or failure",
  );
});

// ---------------------------------------------------------------------------
// Auto-reconnect: running → error → starting
// ---------------------------------------------------------------------------

test("startServer schedules reconnect on unexpected exit (non-zero code)", () => {
  assert.match(
    serverManagerSource,
    /if\s*\(\s*!this\.isDisposed\s*&&\s*code\s*!==\s*0\s*&&\s*!this\.reconnectTimer\s*\)/,
    "startServer must schedule reconnect when exit code is non-zero and not disposed",
  );
});

test("reconnect uses 5-second delay", () => {
  assert.match(
    serverManagerSource,
    /setTimeout\(\s*\(\)\s*=>\s*\{[^}]*this\.ensureRunning\(\)/,
    "reconnect timer must call ensureRunning",
  );
  assert.match(
    serverManagerSource,
    /5000/,
    "reconnect delay must be 5000ms",
  );
});

test("reconnect clears reconnectTimer before invoking ensureRunning", () => {
  assert.match(
    serverManagerSource,
    /this\.reconnectTimer\s*=\s*null/,
    "reconnectTimer must be cleared before reconnect attempt",
  );
});

// ---------------------------------------------------------------------------
// Existing connection reuse (fast path)
// ---------------------------------------------------------------------------

test("ensureRunning reuses cached client when port is reachable and healthy", () => {
  assert.match(
    serverManagerSource,
    /if\s*\(\s*this\.client\s*&&\s*this\.port\s*>\s*0\s*\)/,
    "ensureRunning must check for cached client + port",
  );
  assert.match(
    serverManagerSource,
    /isPortReachable/,
    "ensureRunning must verify port reachability for cached client",
  );
  assert.match(
    serverManagerSource,
    /fetchVersion/,
    "ensureRunning must verify server health via fetchVersion",
  );
});

test("ensureRunning resets stale client when port is unreachable", () => {
  assert.match(
    serverManagerSource,
    /this\.client\s*=\s*null/,
    "ensureRunning must clear client when connection is stale",
  );
});

test("ensureRunning kills stale managed server process before spawning a fresh one", () => {
  assert.match(
    serverManagerSource,
    /Detected stale client connection; restarting server client/,
    "stale-client recovery log should exist",
  );
  assert.match(
    serverManagerSource,
    /if\s*\(\s*this\.serverProcess\s*\)\s*\{[\s\S]*this\.terminateProcessTree\(\s*this\.serverProcess\s*\)/,
    "stale-client recovery must terminate the managed server process before restart",
  );
  assert.match(
    serverManagerSource,
    /skipPersistedPortReconnect\s*=\s*true/,
    "stale-client recovery should skip reconnecting to the previous managed port",
  );
});

// ---------------------------------------------------------------------------
// Port persistence across sessions
// ---------------------------------------------------------------------------

test("OpencodeServerManager persists managed port to globalState", () => {
  assert.match(
    serverManagerSource,
    /MANAGED_PORT_STATE_KEY/,
    "Must define a state key for port persistence",
  );
  assert.match(
    serverManagerSource,
    /this\.context\.globalState\.update\(\s*MANAGED_PORT_STATE_KEY/,
    "persistManagedPort must write to globalState",
  );
});

test("OpencodeServerManager reads persisted port from globalState on reconnect", () => {
  assert.match(
    serverManagerSource,
    /this\.context\.globalState\.get<number>\s*\(\s*MANAGED_PORT_STATE_KEY/,
    "getPersistedManagedPort must read from globalState",
  );
});

// ---------------------------------------------------------------------------
// Dispose flow: any → idle
// ---------------------------------------------------------------------------

test("dispose cancels reconnect timer", () => {
  const disposeBody = extractFunctionBody(
    serverManagerSource,
    "dispose()",
  );
  assert.ok(disposeBody, "dispose method must exist");
  assert.match(
    disposeBody,
    /clearTimeout\(\s*this\.reconnectTimer\s*\)/,
    "dispose must clear reconnect timer",
  );
});

test("dispose terminates server process", () => {
  const disposeBody = extractFunctionBody(
    serverManagerSource,
    "dispose()",
  );
  assert.match(
    disposeBody,
    /this\.terminateProcessTree\(\s*this\.serverProcess\s*\)/,
    "dispose must terminate the server process",
  );
});

test("dispose resets client and port", () => {
  const disposeBody = extractFunctionBody(
    serverManagerSource,
    "dispose()",
  );
  assert.match(
    disposeBody,
    /this\.client\s*=\s*null/,
    "dispose must clear client reference",
  );
  assert.match(
    disposeBody,
    /this\.port\s*=\s*0/,
    "dispose must reset port to 0",
  );
});

test("dispose sets status to idle", () => {
  const disposeBody = extractFunctionBody(
    serverManagerSource,
    "dispose()",
  );
  assert.match(
    disposeBody,
    /this\.setStatus\(\s*["']idle["']\s*\)/,
    "dispose must set status to 'idle'",
  );
});

// ---------------------------------------------------------------------------
// Status change event emissions
// ---------------------------------------------------------------------------

test("OpencodeServerManager exposes onStatusChange event", () => {
  assert.match(
    serverManagerSource,
    /_onStatusChange\s*=\s*new\s+vscode\.EventEmitter<ServerStatus>/,
    "Must create EventEmitter for status changes",
  );
  assert.match(
    serverManagerSource,
    /onStatusChange\s*=\s*this\._onStatusChange\.event/,
    "Must expose onStatusChange as public readonly event",
  );
});

test("setStatus fires event when status changes", () => {
  const setStatusBody = extractFunctionBody(
    serverManagerSource,
    "private setStatus(status: ServerStatus",
  );
  assert.ok(setStatusBody, "setStatus method must exist");
  assert.match(
    setStatusBody,
    /this\._onStatusChange\.fire/,
    "setStatus must fire the status change event",
  );
});

// ---------------------------------------------------------------------------
// Cross-platform process cleanup
// ---------------------------------------------------------------------------

test("OpencodeServerManager uses taskkill on Windows for process tree termination", () => {
  assert.match(
    serverManagerSource,
    /process\.platform\s*===\s*["']win2["']/,
    "Must detect Windows platform",
  );
  assert.match(
    serverManagerSource,
    /taskkill/,
    "Must use taskkill on Windows",
  );
});

test("OpencodeServerManager uses process.kill on Unix for process termination", () => {
  assert.match(
    serverManagerSource,
    /serverProcess\.kill\(\)/,
    "Must use process.kill on Unix/macOS",
  );
});

// ---------------------------------------------------------------------------
// Version / health check
// ---------------------------------------------------------------------------

test("OpencodeServerManager fetches server version after connection", () => {
  assert.match(
    serverManagerSource,
    /fetchVersion/,
    "Must call fetchVersion after connecting",
  );
});

test("fetchVersion stores server version from health endpoint", () => {
  assert.match(
    serverManagerSource,
    /this\.serverVersion\s*=/,
    "fetchVersion must store the version string",
  );
});

// ---------------------------------------------------------------------------
// Startup deduplication
// ---------------------------------------------------------------------------

test("ensureRunning deduplicates concurrent startup attempts", () => {
  assert.match(
    serverManagerSource,
    /startupPromise/,
    "ensureRunning must track in-flight startup via startupPromise",
  );
  assert.match(
    serverManagerSource,
    /if\s*\(\s*this\.startupPromise\s*\)/,
    "ensureRunning must return existing promise if startup already in progress",
  );
});
