import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const serverManagerSource = readSource(
  [joinFromRoot('src', 'services', 'OpencodeServerManager.ts')],
  'OpencodeServerManager.ts',
);
const extensionSource = readSource(
  [joinFromRoot('src', 'extension.ts')],
  'extension.ts',
);

test('OpencodeServerManager implements server lifecycle state machine', () => {
  // Verify state machine with idle, starting, running, error states
  assert.match(serverManagerSource, /export type ServerStatus = "idle" \| "starting" \| "running" \| "error"/, 'OpencodeServerManager should define ServerStatus type');
  assert.match(serverManagerSource, /private _status: ServerStatus = "idle"/, 'OpencodeServerManager should initialize status to idle');
  assert.match(serverManagerSource, /getStatus\(\): ServerStatus/, 'OpencodeServerManager should expose getStatus method');
  assert.match(serverManagerSource, /return this\._status/, 'getStatus should return current status');
});

test('OpencodeServerManager broadcasts status changes via EventEmitter', () => {
  // Verify status change event emission
  assert.match(serverManagerSource, /private _onStatusChange = new vscode\.EventEmitter<ServerStatus>\(\)/, 'OpencodeServerManager should have status change EventEmitter');
  assert.match(serverManagerSource, /public readonly onStatusChange = this\._onStatusChange\.event/, 'OpencodeServerManager should expose onStatusChange event stream');
  const setStatusBody = extractFunctionBody(serverManagerSource, 'private setStatus(status: ServerStatus): void');

  assert.match(setStatusBody, /if\s*\(this\._status !== status\)/, 'setStatus should only fire event if status actually changes');
  assert.match(setStatusBody, /this\._onStatusChange\.fire\(status\)/, 'setStatus should fire event with new status');
});

test('OpencodeServerManager implements lazy connection with fast path for existing client', () => {
  // Verify ensureRunning returns existing client if available
  assert.match(serverManagerSource, /async ensureRunning\(\): Promise<OpencodeClient>/, 'OpencodeServerManager should expose ensureRunning method');
  const ensureBody = extractFunctionBody(serverManagerSource, 'async ensureRunning(): Promise<OpencodeClient>');

  assert.match(ensureBody, /if\s*\(this\.client && this\.port > 0\)/, 'ensureRunning should check if client exists');
  assert.match(ensureBody, /const reachable = await this\.isPortReachable\(this\.port\)/, 'ensureRunning should verify existing client is reachable');
  assert.match(ensureBody, /if\s*\(reachable\)\s*\{[\s\S]*return this\.client/, 'ensureRunning should return existing client if reachable');
  assert.match(ensureBody, /this\.setStatus\("starting"\)/, 'ensureRunning should set status to starting when connecting');
});

test('OpencodeServerManager handles stale client connections', () => {
  // Verify detection and handling of dead client connections
  const ensureBody = extractFunctionBody(serverManagerSource, 'async ensureRunning(): Promise<OpencodeClient>');

  assert.match(ensureBody, /log\.warn\("Detected stale client connection; restarting server client"/, 'ensureRunning should warn about stale connections');
  assert.match(ensureBody, /this\.client = null/, 'ensureRunning should clear stale client');
  assert.match(ensureBody, /this\.port = 0/, 'ensureRunning should reset port on stale connection');
  assert.match(ensureBody, /this\.setStatus\("idle"\)/, 'ensureRunning should set status to idle on stale connection');
});

test('OpencodeServerManager connects to configured port if available', () => {
  // Verify connection to user-configured port before starting new server
  const ensureBody = extractFunctionBody(serverManagerSource, 'async ensureRunning(): Promise<OpencodeClient>');

  assert.match(ensureBody, /const configuredPort = config\.get<number>\("serverPort",\s*0\)/, 'ensureRunning should read serverPort from config');
  assert.match(ensureBody, /if\s*\(configuredPort > 0\)/, 'ensureRunning should check if configured port is set');
  assert.match(ensureBody, /const reachable = await this\.isPortReachable\(configuredPort\)/, 'ensureRunning should verify configured port is reachable');
  assert.match(ensureBody, /createOpencodeClient\(\{\s*baseUrl:\s*`http:\/\/localhost:\${configuredPort}`/, 'ensureRunning should create client for configured port');
  assert.match(ensureBody, /this\.port = configuredPort/, 'ensureRunning should store configured port');
  assert.match(ensureBody, /this\.setStatus\("running"\)/, 'ensureRunning should set status to running on successful connect');
});

test('OpencodeServerManager spawns server process with workspace context', () => {
  // Verify server process spawning with correct working directory
  const startBody = extractFunctionBody(serverManagerSource, 'private async startServer(): Promise<OpencodeClient>');

  assert.match(startBody, /this\.port = await this\.findAvailablePort\(\)/, 'startServer should find available port');
  assert.match(startBody, /const workspaceFolder = vscode\.workspace\.workspaceFolders\?\.\[0\]/, 'startServer should get workspace folder');
  assert.match(startBody, /spawnOptions: cp\.SpawnOptions = \{[\s\S]*stdio:\s*\["ignore",\s*"pipe",\s*"pipe"\]/, 'startServer should configure stdio for spawn');
  assert.match(startBody, /shell:\s*true/, 'startServer should use shell for cross-platform compatibility');
  assert.match(startBody, /if\s*\(workspaceFolder[\s\S]*spawnOptions\.cwd = workspaceFolder\.uri\.fsPath/, 'startServer should set cwd to workspace root');
  assert.match(startBody, /cp\.spawn\(\s*"opencode",\s*\["serve",\s*"--port",\s*this\.port\.toString\(\)\]/, 'startServer should spawn opencode serve command');
});

test('OpencodeServerManager detects server readiness via stdout parsing', () => {
  // Verify server ready detection from stdout
  const startBody = extractFunctionBody(serverManagerSource, 'private async startServer(): Promise<OpencodeClient>');

  assert.match(startBody, /this\.serverProcess\.stdout\?\.on\("data",\s*\(data\)\s*=>/, 'startServer should listen to stdout');
  assert.match(startBody, /if\s*\(output\.includes\("Server running"\)\s*\|\|\s*output\.includes\("listening"\)\)/, 'startServer should detect ready keyword in output');
  assert.match(startBody, /let serverReady = false/, 'startServer should track server ready flag');
  assert.match(startBody, /if\s*\(!serverReady\)\s*\{[\s\S]*serverReady = true/, 'startServer should prevent duplicate client creation');
  assert.match(startBody, /this\.connectToServer\(\)\.then\(settleResolve\)/, 'startServer should connect to server when ready');
});

test('OpencodeServerManager implements port reachability check', () => {
  // Verify TCP socket-based port checking
  assert.match(serverManagerSource, /private async isPortReachable\(port: number\): Promise<boolean>/, 'OpencodeServerManager should have isPortReachable method');
  const reachBody = extractFunctionBody(serverManagerSource, 'private async isPortReachable(port: number): Promise<boolean>');

  assert.match(reachBody, /const socket = new net\.Socket\(\)/, 'isPortReachable should create TCP socket');
  assert.match(reachBody, /socket\.setTimeout\(800\)/, 'isPortReachable should set 800ms timeout');
  assert.match(reachBody, /socket\.once\("connect",\s*\(\)\s*=>\s*finish\(true\)\)/, 'isPortReachable should resolve true on connect');
  assert.match(reachBody, /socket\.once\("error",\s*\(\)\s*=>\s*finish\(false\)\)/, 'isPortReachable should resolve false on error');
  assert.match(reachBody, /socket\.once\("timeout",\s*\(\)\s*=>\s*finish\(false\)\)/, 'isPortReachable should resolve false on timeout');
  assert.match(reachBody, /socket\.connect\(port,\s*"127\.0\.0\.1"\)/, 'isPortReachable should connect to localhost');
});

test('OpencodeServerManager implements auto-reconnect on unexpected exit', () => {
  // Verify auto-reconnect scheduling after server crash
  const startBody = extractFunctionBody(serverManagerSource, 'private async startServer(): Promise<OpencodeClient>');

  assert.match(startBody, /this\.serverProcess\.on\("exit",\s*\(code\)\s*=>/, 'startServer should handle process exit');
  assert.match(startBody, /if\s*\(!this\.isDisposed && code !== 0 && !this\.reconnectTimer\)/, 'startServer should schedule reconnect if unexpected exit');
  assert.match(startBody, /this\.reconnectTimer = setTimeout/, 'startServer should schedule reconnect timer');
  assert.match(startBody, /this\.ensureRunning\(\)\.catch\(console\.error\)/, 'startServer should call ensureRunning in reconnect');
  assert.match(startBody, /5000/, 'reconnect should use 5 second delay');
});

test('OpencodeServerManager implements server startup timeout', () => {
  // Verify 10-second timeout for server startup
  const startBody = extractFunctionBody(serverManagerSource, 'private async startServer(): Promise<OpencodeClient>');

  assert.match(startBody, /let startupTimeout: NodeJS\.Timeout \| null = null/, 'startServer should track startup timeout');
  assert.match(startBody, /startupTimeout = setTimeout/, 'startServer should set timeout handler');
  assert.match(startBody, /if\s*\(!serverReady\)/, 'timeout handler should check server ready flag');
  assert.match(startBody, /this\.setStatus\("error"\)/, 'timeout should set status to error');
  assert.match(startBody, /Server startup timeout/, 'timeout should mention startup timeout');
  assert.match(startBody, /10000/, 'timeout should be 10 seconds');
});

test('OpencodeServerManager handles missing CLI with user-friendly message', () => {
  // Verify ENOENT error handling
  const startBody = extractFunctionBody(serverManagerSource, 'private async startServer(): Promise<OpencodeClient>');

  assert.match(startBody, /this\.serverProcess\.on\("error",\s*\(error\)\s*=>/, 'startServer should handle spawn errors');
  assert.match(startBody, /if\s*\(error\.message\.includes\("ENOENT"\)\)/, 'startServer should detect ENOENT error');
  assert.match(startBody, /vscode\.window\.showErrorMessage\(/, 'startServer should show error message to user');
  assert.match(startBody, /"OpenCode CLI not found/, 'error message should mention missing CLI');
  assert.match(startBody, /this\.setStatus\("error"\)/, 'startServer should set status to error');
});

test('OpencodeServerManager implements cross-platform process cleanup', () => {
  // Verify Windows-specific process tree killing
  const disposeBody = extractFunctionBody(serverManagerSource, 'dispose()');

  assert.match(disposeBody, /this\.isDisposed = true/, 'dispose should set isDisposed flag');
  assert.match(disposeBody, /if\s*\(this\.reconnectTimer\)/, 'dispose should cancel reconnect timer');
  assert.match(disposeBody, /clearTimeout\(this\.reconnectTimer\)/, 'dispose should clear reconnect timer');
  assert.match(disposeBody, /if\s*\(this\.serverProcess\)/, 'dispose should check if server process exists');
  assert.match(disposeBody, /if\s*\(process\.platform === "win32" && this\.serverProcess\.pid\)/, 'dispose should check Windows platform');
  assert.match(disposeBody, /cp\.execSync\(`taskkill \/pid \${this\.serverProcess\.pid} \/T \/F`\)/, 'dispose should use taskkill on Windows');
  assert.match(disposeBody, /this\.serverProcess\.kill\(\)/, 'dispose should use process.kill on Unix');
  assert.match(disposeBody, /this\.setStatus\("idle"\)/, 'dispose should reset status to idle');
});

test('OpencodeServerManager implements dynamic port allocation', () => {
  // Verify port 0 binding for OS-assigned port
  assert.match(serverManagerSource, /private async findAvailablePort\(\): Promise<number>/, 'OpencodeServerManager should have findAvailablePort method');
  const portBody = extractFunctionBody(serverManagerSource, 'private async findAvailablePort(): Promise<number>');

  assert.match(portBody, /const server = net\.createServer\(\)/, 'findAvailablePort should create TCP server');
  assert.match(portBody, /server\.listen\(0,\s*\(\)\s*=>/, 'findAvailablePort should listen on port 0');
  assert.match(portBody, /const port = \(server\.address\(\) as net\.AddressInfo\)\.port/, 'findAvailablePort should extract assigned port');
  assert.match(portBody, /server\.close\(\(\)\s*=>\s*resolve\(port\)\)/, 'findAvailablePort should close server and return port');
});

test('OpencodeServerManager implements server output logging with budget', () => {
  // Verify log budget to prevent disk bloat
  const startBody = extractFunctionBody(serverManagerSource, 'private async startServer(): Promise<OpencodeClient>');

  assert.match(startBody, /const stdoutLogState = \{\s*loggedChars:\s*0,\s*suppressed:\s*false\s*\}/, 'startServer should track stdout log state');
  assert.match(startBody, /const stderrLogState = \{\s*loggedChars:\s*0,\s*suppressed:\s*false\s*\}/, 'startServer should track stderr log state');
  assert.match(startBody, /SERVER_OUTPUT_LOG_BUDGET_CHARS/, 'startServer should reference log budget constant');
  assert.match(startBody, /if\s*\(state\.loggedChars >= SERVER_OUTPUT_LOG_BUDGET_CHARS\)/, 'startServer should check log budget');
  assert.match(startBody, /console\.warn/, 'startServer should warn when budget exceeded');
  assert.match(startBody, /truncated/, 'startServer should truncate long output');
});

test('OpencodeServerManager exposes client and port getters', () => {
  // Verify public getters for client and port
  assert.match(serverManagerSource, /getClient\(\): OpencodeClient \| null/, 'OpencodeServerManager should expose getClient method');
  assert.match(serverManagerSource, /return this\.client/, 'getClient should return client field');
  assert.match(serverManagerSource, /getPort\(\): number/, 'OpencodeServerManager should expose getPort method');
  assert.match(serverManagerSource, /return this\.port/, 'getPort should return port field');
});

test('extension registers OpencodeServerManager for proper lifecycle', () => {
  // Verify extension creates and disposes server manager
  assert.match(extensionSource, /serverManager = new OpencodeServerManager\(context\)/, 'extension should create OpencodeServerManager');
  assert.match(extensionSource, /let serverManager: OpencodeServerManager/, 'extension should declare serverManager variable');
  assert.match(extensionSource, /context\.subscriptions\.push\(/, 'extension should push to context subscriptions');
});
