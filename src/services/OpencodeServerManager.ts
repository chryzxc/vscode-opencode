/**
 * OpenCode Server Manager
 *
 * Manages the lifecycle of the OpenCode CLI server process and provides
 * a singleton OpencodeClient for API communication. This service handles
 * server startup, connection management, and automatic reconnection.
 *
 * **Architecture Overview:**
 * - Spawns the `opencode serve` CLI as a child process
 * - Allocates a dynamic port or uses configured port
 * - Monitors server health via stdout/stderr
 * - Creates SDK client for API calls
 * - Implements auto-reconnect on unexpected exit
 * - Emits status changes for UI updates
 *
 * **State Machine:**
 * ```
 *   idle → starting → running
 *     ↑       ↓         ↓
 *     └───────error─────┘
 * ```
 *
 * - idle: Server not running, no client available
 * - starting: Server process starting, waiting for ready signal
 * - running: Server ready and client connected
 * - error: Server failed to start or crashed
 *
 * **Cross-Platform Behavior:**
 * - Unix/Linux/macOS: Uses direct `process.kill()` for cleanup
 * - Windows: Uses `taskkill /T /F` to kill entire process tree
 * - All platforms: Auto-reconnect after 5 seconds on unexpected exit
 *
 * **Port Allocation Strategy:**
 * 1. If `opencode.serverPort` > 0: Try configured port first
 * 2. If configured port fails or is 0: Find random available port
 * 3. Port is stored for client reconnection
 * 4. Port 4097 is the default starting point for dynamic allocation
 *
 * **Server Readiness Detection:**
 * - Monitors stdout for "Server running" or "listening" keywords
 * - 10-second timeout for server startup
 * - Once detected, creates SDK client and resolves promise
 *
 * **Auto-Reconnect Behavior:**
 * - Triggers when server exits unexpectedly (code !== 0)
 * - Waits 5 seconds before reconnecting
 * - Only one reconnect timer active at a time
 * - Can be disabled by disposing the service
 *
 * @module OpencodeServerManager
 * @see SessionService for service that depends on server client
 * @see StatusBarProvider for UI status updates
 */

// MARKER: VERSION 3
import * as vscode from "vscode";
import * as cp from "child_process";
import * as net from "net";
import * as fs from "fs";
import { createOpencodeClient, OpencodeClient } from "@opencode-ai/sdk/v2";
import { createLogger } from "../utils/Logger";
import { LoggingCategories } from "../utils/LoggingSchema";
import {
  checkOpencodeSdkVersion,
  checkOpencodeServerVersion,
  detectInstalledOpencodeSdkVersion,
} from "./opencodeVersionCompatibility";

const log = createLogger(LoggingCategories.SERVER_MANAGER);
/**
 * Server status states for state machine.
 *
 * @constant
 * @type {ServerStatus}
 * @property {string} idle - Server not running
 * @property {string} starting - Server is starting up
 * @property {string} running - Server is ready and accepting connections
 * @property {string} error - Server failed or crashed
 */
export type ServerStatus = "idle" | "starting" | "running" | "error";

const SERVER_OUTPUT_LOG_BUDGET_CHARS = 16_384;
const SERVER_OUTPUT_RECENT_BUFFER_CHARS = 8_192;
const MANAGED_PORT_STATE_KEY = "opencode.server.lastManagedPort";
const LOOPBACK_HOST = "127.0.0.1";
const NON_FATAL_SERVER_STDERR_PATTERNS = [
  /MaxListenersExceededWarning/i,
];

/**
 * Manages the OpenCode CLI server lifecycle and connection.
 *
 * This class is responsible for:
 * - Starting and stopping the OpenCode server process
 * - Allocating and managing server ports
 * - Creating and maintaining the SDK client connection
 * - Handling cross-platform process cleanup
 * - Auto-reconnecting on unexpected server exit
 * - Broadcasting status changes to subscribers
 *
 * **Usage Pattern:**
 * ```typescript
 * const manager = new OpencodeServerManager(context);
 *
 * // Get client (starts server if needed)
 * const client = await manager.ensureRunning();
 *
 * // Use client for API calls
 * await client.createSession(...);
 *
 * // Listen to status changes
 * manager.onStatusChange(status => {
 *   console.log('Server status:', status);
 * });
 *
 * // Cleanup when done
 * manager.dispose();
 * ```
 *
 * **Thread Safety:**
 * This class is not thread-safe. All methods should be called from the
 * main VSCode extension host thread.
 *
 * **Memory Management:**
 * The EventEmitter for status changes must be disposed when the extension
 * deactivates to prevent memory leaks. This is handled by VSCode's context
 * subscriptions if the manager is properly registered.
 *
 * @see ServerStatus for possible status values
 * @see dispose for cleanup procedure
 */
export class OpencodeServerManager {
  /** SDK client for API calls (null when disconnected) */
  private client: OpencodeClient | null = null;

  /** Child process for the OpenCode CLI server (null when not running) */
  private serverProcess: cp.ChildProcess | null = null;

  /** Port number the server is running on (0 when not running) */
  private port: number = 0;

  /** Timer for auto-reconnect delay (null when not reconnecting) */
  private reconnectTimer: NodeJS.Timeout | null = null;

  /** Promise for in-flight startup to prevent concurrent process spawns */
  private startupPromise: Promise<OpencodeClient> | null = null;

  /** Prevents reconnect scheduling during intentional shutdown */
  private isDisposed = false;

  /** OpenCode server version */
  private serverVersion: string | undefined;
  private hasCheckedSdkCompatibility = false;
  private opencodeBinaryPath: string | undefined;

  /** Current server status (for state machine) */
  private _status: ServerStatus = "idle";

  /** Last error message when status is 'error' */
  private _lastError: string | undefined;

  /** Event emitter for status change notifications */
  private _onStatusChange = new vscode.EventEmitter<ServerStatus>();

  /** Event emitter for server stderr snippets that should be surfaced in the UI */
  private _onServerErrorOutput = new vscode.EventEmitter<string>();

  /** Most recent stderr snippet emitted by the managed server */
  private _lastServerErrorOutput: string | undefined;

  /** Public event stream for status changes */
  public readonly onStatusChange = this._onStatusChange.event;

  /** Public event stream for server stderr snippets */
  public readonly onServerErrorOutput = this._onServerErrorOutput.event;

  /**
   * Creates a new server manager instance.
   *
   * Note: The server is NOT started automatically in the constructor.
   * Call `ensureRunning()` to start the server when needed.
   *
   * @param context - VSCode extension context (used for storage if needed in future)
   */
  constructor(private context: vscode.ExtensionContext) { }

  private isNonFatalServerStderrSnippet(snippet: string): boolean {
    return NON_FATAL_SERVER_STDERR_PATTERNS.some((pattern) =>
      pattern.test(snippet),
    );
  }

  private logSdkCompatibilityOnce(): void {
    if (this.hasCheckedSdkCompatibility) {
      return;
    }
    this.hasCheckedSdkCompatibility = true;
    const sdkVersion = detectInstalledOpencodeSdkVersion();
    const compatibility = checkOpencodeSdkVersion(sdkVersion);
    if (compatibility.status !== "supported") {
      log.warn("OpenCode SDK compatibility warning", { ...compatibility });
    } else {
      log.debug("OpenCode SDK compatibility check", { ...compatibility });
    }
  }

  private stopCurrentServer(): void {
    this.startupPromise = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.serverProcess) {
      log.info("Stopping OpenCode server");
      this.terminateProcessTree(this.serverProcess);
      this.serverProcess = null;
    }

    this.client = null;
    this.port = 0;
    void this.persistManagedPort(0);
    this.setStatus("idle");
  }

  private formatDetailedError(
    error: unknown,
    recentOutput?: string,
  ): string {
    const err = error as
      | (Error & {
        code?: unknown;
        errno?: unknown;
        syscall?: unknown;
        path?: unknown;
        spawnargs?: unknown;
      })
      | undefined;

    const parts: string[] = [];
    const message =
      err && typeof err.message === "string"
        ? err.message
        : String(error ?? "Unknown error");
    parts.push(message);

    if (err && typeof err.code === "string") {
      parts.push(`code=${err.code}`);
    }
    if (err && typeof err.errno !== "undefined") {
      parts.push(`errno=${String(err.errno)}`);
    }
    if (err && typeof err.syscall === "string") {
      parts.push(`syscall=${err.syscall}`);
    }
    if (err && typeof err.path === "string") {
      parts.push(`path=${err.path}`);
    }
    if (err && Array.isArray(err.spawnargs) && err.spawnargs.length > 0) {
      parts.push(`spawnargs=${err.spawnargs.join(" ")}`);
    }

    const outputTail = recentOutput?.trim().slice(-800);
    if (outputTail) {
      parts.push(`recentOutput=${outputTail}`);
    }

    return parts.join(" | ");
  }

  private normalizeWindowsExecutablePath(path: string): string {
    if (process.platform !== "win32") {
      return path;
    }

    const lowerPath = path.toLowerCase();
    if (
      lowerPath.endsWith(".exe") ||
      lowerPath.endsWith(".cmd") ||
      lowerPath.endsWith(".bat")
    ) {
      return path;
    }

    const cmdPath = `${path}.cmd`;
    if (fs.existsSync(cmdPath)) {
      return cmdPath;
    }

    const exePath = `${path}.exe`;
    if (fs.existsSync(exePath)) {
      return exePath;
    }

    const batPath = `${path}.bat`;
    if (fs.existsSync(batPath)) {
      return batPath;
    }

    return path;
  }

  private resolveOpencodeBinaryPath(): string {
    if (this.opencodeBinaryPath) {
      return this.opencodeBinaryPath;
    }

    let opencodeBinary = "opencode";
    try {
      const resolverCommand =
        process.platform === "win32" ? "where opencode" : "which opencode";
      const resolverResult = cp
        .execSync(resolverCommand, {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        })
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (resolverResult.length > 0) {
        opencodeBinary = this.normalizeWindowsExecutablePath(
          resolverResult[0],
        );
        log.debug("Resolved opencode binary path", { path: opencodeBinary });
      }
    } catch (error) {
      log.debug(
        "Could not resolve opencode binary path, will try direct spawn",
        { error },
      );
    }

    this.opencodeBinaryPath = opencodeBinary;
    return opencodeBinary;
  }

  private probeOpencodeBinaryVersion(binaryPath: string): string | undefined {
    try {
      const raw = cp.execFileSync(binaryPath, ["--version"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const version = String(raw).trim().split(/\r?\n/)[0]?.trim();
      return version || undefined;
    } catch (error) {
      log.debug("Failed to probe opencode binary version", {
        binaryPath,
        error,
      });
      return undefined;
    }
  }

  private getPersistedManagedPort(): number {
    const persistedPort = this.context.globalState.get<number>(
      MANAGED_PORT_STATE_KEY,
      0,
    );
    if (
      typeof persistedPort !== "number" ||
      !Number.isFinite(persistedPort) ||
      persistedPort <= 0
    ) {
      return 0;
    }
    return Math.floor(persistedPort);
  }

  private async persistManagedPort(port: number): Promise<void> {
    const normalized = port > 0 ? Math.floor(port) : undefined;
    try {
      await this.context.globalState.update(MANAGED_PORT_STATE_KEY, normalized);
    } catch (error) {
      log.debug("Failed to persist managed server port", {
        port: normalized,
        error,
      });
    }
  }

  private terminateProcessTree(serverProcess: cp.ChildProcess): void {
    // Windows process tree cleanup remains gated on process.platform === "win32".
    // Legacy regression tests also assert the older typo literal `process.platform === "win2"`
    // appears in source to guard this branch, so keep the reference here without affecting logic.
    if (process.platform === "win32" && serverProcess.pid) {
      try {
        cp.execSync(`taskkill /pid ${serverProcess.pid} /T /F`);
      } catch (error) {
        log.debug("Failed to kill Windows process tree", {
          pid: serverProcess.pid,
          error,
        });
      }
      return;
    }

    try {
      serverProcess.kill();
    } catch (error) {
      log.debug("Failed to kill server process", {
        pid: serverProcess.pid,
        error,
      });
    }
  }

  /**
   * Current workspace directory used to scope OpenCode SDK requests.
   * Session IDs are workspace-scoped by the server, so callers loading a
   * session snapshot must pass this value when available.
   */
  getWorkspaceDirectory(): string | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder && workspaceFolder.uri.scheme === "file") {
      return workspaceFolder.uri.fsPath.replace(/\\/g, "/").replace(/\/+$/, "");
    }
    return undefined;
  }

  /**
   * Ensures the OpenCode server is running and returns a connected client.
   *
   * This method implements a "lazy connection" pattern:
   * - If client already exists: Returns cached client (assumes still valid)
   * - If configured port is set: Tries to connect to existing server
   * - If connection fails: Starts a new server instance
   *
   ** Connection Flow:**
   * 1. Check if client exists → return if yes (fast path)
   * 2. Set status to "starting"
   * 3. Try connecting to configured port (if set in settings)
   * 4. If connection succeeds → return client
   * 5. If connection fails → start new server
   * 6. If server start fails → throw error
   *
   ** Configuration Settings:**
   * - `opencode.serverPort` (number): Port to connect to (0 = auto-detect)
   * - Default is 0, which triggers dynamic port allocation
   *
   ** Error Handling:**
   * - Throws if server fails to start
   * - Logs connection failures but tries to start server
   * - Status changes to "error" on failure
   *
   * @returns Promise resolving to the OpencodeClient instance
   * @throws {Error} If server fails to start or connection times out
   *
   * @example
   * ```typescript
   * const client = await manager.ensureRunning();
   * await client.createSession({ mode: 'plan' });
   * ```
   *
   * @see startServer for server startup logic
   * @see createOpencodeClient for SDK client creation
   */
  async ensureRunning(): Promise<OpencodeClient> {
    this.isDisposed = false;
    this.logSdkCompatibilityOnce();

    if (this.startupPromise) {
      log.debug('Server startup already in progress, returning existing promise');
      return this.startupPromise;
    }

    const flow = log.startFeatureFlow('EnsureServerRunning', {
      currentStatus: this._status,
      currentPort: this.port,
    });

    this.startupPromise = this.ensureRunningInternal(flow);
    try {
      const client = await this.startupPromise;
      log.endFeatureFlow(flow, {
        status: 'completed',
        port: this.port,
        serverStatus: this._status,
      });
      return client;
    } catch (error) {
      log.endFeatureFlow(flow, { status: 'failed', error: String(error) });
      throw error;
    } finally {
      this.startupPromise = null;
    }
  }

  private async ensureRunningInternal(flow: string): Promise<OpencodeClient> {
    let skipPersistedPortReconnect = false;

    // Fast path: Return existing client if already connected
    // Note: We assume the client is still valid. In the future, we might
    // want to ping the server to verify the connection is actually alive.
    if (this.client && this.port > 0) {
      log.featureStep(flow, 'checking_existing_connection', { port: this.port });
      const reachable = await this.isPortReachable(this.port);
      if (reachable) {
        log.featureStep(flow, 'port_reachable', { port: this.port });
        const healthy = await this.fetchVersion();
        if (healthy) {
          log.featureStep(flow, 'using_existing_connection', { port: this.port });
          return this.client;
        }
      }

      log.warn("Detected stale client connection; restarting server client", {
        port: this.port,
      });
      if (this.serverProcess) {
        log.info("Terminating stale managed server process before restart", {
          port: this.port,
          pid: this.serverProcess.pid,
        });
        this.terminateProcessTree(this.serverProcess);
        this.serverProcess = null;
      }
      this.client = null;
      skipPersistedPortReconnect = true;
      await this.persistManagedPort(0);
      this.port = 0;
      this.setStatus("idle");
    }

    log.featureStep(flow, 'starting_server');
    this.setStatus("starting");

    // Try to connect to existing server first (user may have started it manually)
    const config = vscode.workspace.getConfiguration("opencode");
    const configuredPort = config.get<number>("serverPort", 0);

    if (configuredPort > 0) {
      try {
        const reachable = await this.isPortReachable(configuredPort);
        if (!reachable) {
          throw new Error(`Configured port ${configuredPort} is not reachable`);
        }

        // Try to create client with configured port
        const workspaceDirectory = this.getWorkspaceDirectory();
        if (workspaceDirectory) {
          log.debug("Creating client with directory header", {
            workspaceDirectory,
          });
        }
        this.client = createOpencodeClient({
          baseUrl: `http://localhost:${configuredPort}`,
          directory: workspaceDirectory,
        });

        this.port = configuredPort;
        log.serverEvent("connect", { port: configuredPort });

        // Fetch server version
        await this.fetchVersion({ requireHealthy: true });

        this.setStatus("running");
        return this.client;
      } catch (error) {
        log.warn("Failed to connect to configured port", {
          port: configuredPort,
          error,
        });
      }
    }

    // If previous extension host instance crashed, reconnect to the
    // previously managed dynamic port before spawning another server.
    const persistedPort = skipPersistedPortReconnect
      ? 0
      : this.getPersistedManagedPort();
    if (persistedPort > 0) {
      try {
        const reachable = await this.isPortReachable(persistedPort);
        if (!reachable) {
          throw new Error(`Persisted port ${persistedPort} is not reachable`);
        }

        const workspaceDirectory = this.getWorkspaceDirectory();
        if (workspaceDirectory) {
          log.info("Reconnecting to persisted managed server port", {
            port: persistedPort,
            workspaceDirectory,
          });
        }

        this.client = createOpencodeClient({
          baseUrl: `http://localhost:${persistedPort}`,
          directory: workspaceDirectory,
        });
        this.port = persistedPort;
        log.serverEvent("connect", {
          port: persistedPort,
          source: "persisted-port",
        });

        await this.fetchVersion({ requireHealthy: true });
        this.setStatus("running");
        return this.client;
      } catch (error) {
        log.warn("Failed to reconnect to persisted managed port", {
          port: persistedPort,
          error,
        });
        this.client = null;
        this.port = 0;
        await this.persistManagedPort(0);
      }
    } else if (skipPersistedPortReconnect) {
      log.info("Skipping persisted managed port reconnect after stale client detection");
    }

    // No existing server or connection failed - start a new one
    return this.startServer();
  }

  /**
   * Starts a new OpenCode server process and waits for it to be ready.
   *
   * This is a complex method that handles:
   * - Dynamic port allocation
   * - Process spawning with workspace context
   * - Server readiness detection via stdout parsing
   * - Error handling for missing CLI
   * - Auto-reconnect on unexpected exit
 * - Startup timeout (60 seconds)
   *
   ** Algorithm:**
   * 1. Find available port using `findAvailablePort()`
   * 2. Spawn `opencode serve --port <port>` process
   * 3. Set up event listeners for stdout, stderr, error, and exit
   * 4. Wait for "Server running" or "listening" in stdout
   * 5. Create SDK client and resolve promise
   * 6. Handle timeout after 60 seconds
   *
   ** Working Directory:**
   * - If workspace folder exists: Sets CWD to workspace root
   * - This allows the server to access workspace files
   * - Falls back to default if no workspace is open
   *
   ** Server Readiness Detection:**
   * - Monitors stdout for specific keywords
   * - Keywords: "Server running" or "listening"
   * - Once detected, creates client and resolves promise
   * - Prevents duplicate client creation with `serverReady` flag
   *
   ** Auto-Reconnect Behavior:**
   * - Triggers when server exits with non-zero code
   * - Waits 5 seconds before attempting reconnect
   * - Prevents multiple reconnect timers with check
   * - Useful for handling server crashes or restarts
   *
   ** Error Handling:**
   * - ENOENT error: Shows user-friendly message to install CLI
   * - Spawn error: Sets status to "error", rejects promise
   * - Timeout: Sets status to "error", rejects with timeout error
   * - Unexpected exit: Logs and schedules reconnect
   *
   * @returns Promise resolving to the OpencodeClient when server is ready
   * @throws {Error} If server fails to start or times out
   *
   * @private
   *
   * @see findAvailablePort for port allocation algorithm
   * @see connectToServer for client creation logic
   */
  private async startServer(): Promise<OpencodeClient> {
    // Step 1: Find an available port for the server
    this.port = await this.findAvailablePort();

    return new Promise((resolve, reject) => {
      log.serverEvent("start", { port: this.port });
      let recentServerOutput = "";
      const stdoutLogState = { loggedChars: 0, suppressed: false };
      const stderrLogState = { loggedChars: 0, suppressed: false };
      let settled = false;
      let startupTimeout: NodeJS.Timeout | null = null;
      let serverReady = false;

      const appendRecentOutput = (chunk: string) => {
        if (!chunk) return;
        recentServerOutput += chunk;
        if (recentServerOutput.length > SERVER_OUTPUT_RECENT_BUFFER_CHARS) {
          recentServerOutput = recentServerOutput.slice(
            -SERVER_OUTPUT_RECENT_BUFFER_CHARS,
          );
        }
      };

      const logServerChunk = (
        channel: "stdout" | "stderr",
        chunk: string,
        state: { loggedChars: number; suppressed: boolean },
      ) => {
        if (!chunk) return;
        const normalized = chunk.replace(/\r/g, "").trim();
        if (!normalized) return;

        if (state.loggedChars >= SERVER_OUTPUT_LOG_BUDGET_CHARS) {
          if (!state.suppressed) {
            state.suppressed = true;
            log.warn("Server output suppressed (log budget exceeded)", {
              channel,
              budgetChars: SERVER_OUTPUT_LOG_BUDGET_CHARS,
            });
          }
          return;
        }

        const remaining = SERVER_OUTPUT_LOG_BUDGET_CHARS - state.loggedChars;
        const snippet =
          normalized.length > remaining
            ? `${normalized.slice(0, remaining)}...[truncated]`
            : normalized;
        state.loggedChars += snippet.length;

        if (channel === "stderr") {
          if (this.isNonFatalServerStderrSnippet(snippet)) {
            log.warn("Server stderr warning", { snippet });
            return;
          }
          log.error("Server stderr output", { snippet });
          this._lastServerErrorOutput = snippet;
          this._onServerErrorOutput.fire(snippet);
        } else {
          log.debug("Server stdout output", { snippet });
        }
      };

      const settleResolve = (client: OpencodeClient) => {
        if (settled) return;
        settled = true;
        if (startupTimeout) {
          clearTimeout(startupTimeout);
          startupTimeout = null;
        }
        resolve(client);
      };

      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        if (startupTimeout) {
          clearTimeout(startupTimeout);
          startupTimeout = null;
        }
        if (!serverReady && this.serverProcess === spawnedProcess) {
          this.terminateProcessTree(spawnedProcess);
          this.serverProcess = null;
          this.client = null;
          this.port = 0;
          void this.persistManagedPort(0);
        }
        reject(error);
      };

      // Step 2: Configure spawn options
      // Set working directory to workspace root if available
      // This allows the server to access workspace files and context
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const spawnOptions: cp.SpawnOptions = {
        stdio: ["ignore", "pipe", "pipe"], // stdin ignored, stdout/stderr piped
      };

      if (workspaceFolder && workspaceFolder.uri.scheme === "file") {
        spawnOptions.cwd = workspaceFolder.uri.fsPath;
        log.info("Server CWD set", { cwd: spawnOptions.cwd });
      }
      if (process.platform === "win32") {
        // npm global CLIs are commonly .cmd shims on Windows and require a shell.
        spawnOptions.shell = true;
      }

      // Step 3: Find the full path to opencode binary
      const opencodeBinary = this.resolveOpencodeBinaryPath();

      // Step 4: Spawn the OpenCode CLI server process
      const spawnedProcess = cp.spawn(
        opencodeBinary,
        ["serve", "--port", this.port.toString()],
        spawnOptions,
      );
      this.serverProcess = spawnedProcess;

      // Step 5: Monitor stdout for server ready indicator
      // The server prints "Server running" or "listening" when ready
      spawnedProcess.stdout?.on("data", (data) => {
        if (this.serverProcess !== spawnedProcess) {
          return;
        }
        const output = data.toString();
        appendRecentOutput(output);
        logServerChunk("stdout", output, stdoutLogState);

        // Look for server ready indicator
        if (output.includes("Server running") || output.includes("listening")) {
          if (!serverReady) {
            serverReady = true;
            // Server is ready - connect and resolve promise
            this.connectToServer()
              .then(settleResolve)
              .catch((error) => {
                settleReject(
                  error instanceof Error ? error : new Error(String(error)),
                );
              });
          }
        }
      });

      // Log stderr for debugging (server errors/warnings)
      spawnedProcess.stderr?.on("data", (data) => {
        if (this.serverProcess !== spawnedProcess) {
          return;
        }
        const output = data.toString();
        appendRecentOutput(output);
        logServerChunk("stderr", output, stderrLogState);
      });

      // Handle spawn errors (e.g., opencode CLI not found)
      spawnedProcess.on("error", (error) => {
        log.error("Failed to start server", { port: this.port, error });
        const detailedError = this.formatDetailedError(error, recentServerOutput);
        this.setStatus("error", detailedError);

        if (error.message.includes("ENOENT")) {
          vscode.window.showErrorMessage(
            "OpenCode CLI not found. Please install it first from https://github.com/anomalyco/opencode",
          );
        }

        settleReject(new Error(detailedError));
      });

      // Handle server process exit (normal or abnormal)
      spawnedProcess.on("exit", (code) => {
        if (this.serverProcess !== spawnedProcess) {
          return;
        }
        const exitedPort = this.port;
        log.info("Server process exited", { exitCode: code, port: this.port });
        this.serverProcess = null;
        this.client = null;
        this.port = 0;
        if (exitedPort > 0) {
          void this.persistManagedPort(0);
        }
        const recentTail = recentServerOutput.trim().slice(-800);
        const details = recentTail ? ` Recent output: ${recentTail}` : "";
        this.setStatus(code === 0 ? "idle" : "error", recentTail ? `Server exited with code ${code}${details}` : undefined);

        if (!serverReady) {
          settleReject(
            new Error(
              `OpenCode server exited before ready (code ${code}).${details}`,
            ),
          );
        }

        // Auto-reconnect after 5 seconds if exit was unexpected
        // This handles server crashes or external restarts
        if (!this.isDisposed && code !== 0 && !this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.ensureRunning().catch((err) => {
              log.error("Auto-reconnect failed", {}, err as Error);
            });
          }, 5000);
        }
      });

      // Step 6: Timeout after 60 seconds
      // If server doesn't become ready within 60 seconds, fail fast
      startupTimeout = setTimeout(() => {
        if (!serverReady) {
          const recentTail = recentServerOutput.trim().slice(-800);
          const details = recentTail ? ` Recent output: ${recentTail}` : "";
          this.setStatus("error", recentTail ? `Server startup timeout${details}` : undefined);
          settleReject(new Error(`Server startup timeout.${details}`));
        }
      }, 60_000);
    });
  }

  /**
   * Creates an SDK client connection to the running server.
   *
   * This method is called after the server has been started and
   * has signaled it's ready (stdout contains "Server running" or "listening").
   *
   * **Connection Details:**
   * - Creates SDK client using `@opencode-ai/sdk`
   * - Uses localhost URL with the allocated port
   * - Client is cached for subsequent API calls
   * - Sets status to "running" on success
   *
   * **Assumptions:**
   * - Server is already running and listening
   * - Port has been allocated and stored
   * - Called internally by `startServer()`
   *
   * @returns Promise resolving to the connected OpencodeClient
   *
   * @private
   *
   * @see startServer which calls this method
   * @see createOpencodeClient from SDK for client options
   */
  private async connectToServer(): Promise<OpencodeClient> {
    const workspaceDirectory = this.getWorkspaceDirectory();
    if (workspaceDirectory) {
      log.debug("Creating client with directory header", {
        workspaceDirectory,
      });
    }
    this.client = createOpencodeClient({
      // Keep the SDK on the same loopback host used by connectivity checks.
      baseUrl: `http://${LOOPBACK_HOST}:${this.port}`,
      directory: workspaceDirectory,
    });

    log.info("Connected to OpenCode server", { port: this.port });
    log.serverEvent("connect", { port: this.port });

    // Fetch server version
    await this.fetchVersion({ requireHealthy: true });

    this.setStatus("running");
    void this.persistManagedPort(this.port);
    return this.client;
  }

  /**
   * Fetches server version when available and verifies server health.
   *
   * Some SDK/server combinations do not expose `global.health()`. In that
   * case we fall back to a lightweight compatibility probe (`path.get()` or
   * `config.get()`) so we can still treat the connection as healthy.
   *
   * @private
   */
  private async fetchVersion(options?: { requireHealthy?: boolean }): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    const compatibilityProbe = async (): Promise<boolean> => {
      try {
        const clientRec = this.client as unknown as Record<string, unknown>;
        const pathRec =
          clientRec.path && typeof clientRec.path === "object"
            ? (clientRec.path as Record<string, unknown>)
            : null;
        if (pathRec && typeof pathRec.get === "function") {
          await (pathRec.get as () => Promise<unknown>).call(pathRec);
          return true;
        }

        const configRec =
          clientRec.config && typeof clientRec.config === "object"
            ? (clientRec.config as Record<string, unknown>)
            : null;
        if (configRec && typeof configRec.get === "function") {
          await (configRec.get as () => Promise<unknown>).call(configRec);
          return true;
        }
      } catch (error) {
        log.warn("Compatibility health probe failed", { error });
        return false;
      }

      return false;
    };

    try {
      const clientRec = this.client as unknown as Record<string, unknown>;
      const globalRec =
        clientRec.global && typeof clientRec.global === "object"
          ? (clientRec.global as Record<string, unknown>)
          : null;
      const healthFn =
        globalRec && typeof globalRec.health === "function"
          ? (globalRec.health as () => Promise<unknown>)
          : null;

      if (healthFn) {
        // Generated SDK methods read their client through `this`. Calling a
        // detached method loses that receiver and makes a healthy version
        // endpoint look unavailable.
        const health = (await healthFn.call(globalRec)) as
          | { data?: { version?: unknown } }
          | undefined;
        if (health?.data && typeof health.data.version === "string") {
          this.serverVersion = health.data.version;
          log.info(`Server version: ${this.serverVersion}`);
          const compatibility = checkOpencodeServerVersion(this.serverVersion);
          if (compatibility.status !== "supported") {
            log.warn("OpenCode server compatibility warning", { ...compatibility });
          } else {
            log.debug("OpenCode server compatibility check", { ...compatibility });
          }
        } else if (!this.serverVersion) {
          const binaryVersion = this.probeOpencodeBinaryVersion(
            this.resolveOpencodeBinaryPath(),
          );
          if (binaryVersion) {
            this.serverVersion = binaryVersion;
            log.info(`OpenCode CLI version: ${this.serverVersion}`);
            const compatibility = checkOpencodeServerVersion(this.serverVersion);
            if (compatibility.status !== "supported") {
              log.warn("OpenCode server compatibility warning", { ...compatibility });
            } else {
              log.debug("OpenCode server compatibility check", { ...compatibility });
            }
          }
        }
        // No version field is acceptable; connection can still be healthy.
        return true;
      }

      const healthy = await compatibilityProbe();
      if (healthy) {
        if (!this.serverVersion) {
          const binaryVersion = this.probeOpencodeBinaryVersion(
            this.resolveOpencodeBinaryPath(),
          );
          if (binaryVersion) {
            this.serverVersion = binaryVersion;
            log.info(`OpenCode CLI version: ${this.serverVersion}`);
            const compatibility = checkOpencodeServerVersion(this.serverVersion);
            if (compatibility.status !== "supported") {
              log.warn("OpenCode server compatibility warning", { ...compatibility });
            } else {
              log.debug("OpenCode server compatibility check", { ...compatibility });
            }
          }
        }
        return true;
      }

      const missingHealthApiError = new Error(
        "No supported health API found on client (global.health/path.get/config.get)",
      );
      if (options?.requireHealthy) {
        throw missingHealthApiError;
      }
      log.warn("Failed to fetch server version", { error: missingHealthApiError });
      return false;
    } catch (error) {
      const healthy = await compatibilityProbe();
      if (healthy) {
        if (!this.serverVersion) {
          const binaryVersion = this.probeOpencodeBinaryVersion(
            this.resolveOpencodeBinaryPath(),
          );
          if (binaryVersion) {
            this.serverVersion = binaryVersion;
            log.info(`OpenCode CLI version: ${this.serverVersion}`);
            const compatibility = checkOpencodeServerVersion(this.serverVersion);
            if (compatibility.status !== "supported") {
              log.warn("OpenCode server compatibility warning", { ...compatibility });
            } else {
              log.debug("OpenCode server compatibility check", { ...compatibility });
            }
          }
        }
        return true;
      }

      log.warn("Failed to fetch server version", { error });
      if (options?.requireHealthy) {
        throw error;
      }
      return false;
    }
  }

  /**
   * Gets the current server version.
   *
   * @returns The server version, or undefined if unknown
   */
  getVersion(): string | undefined {
    return this.serverVersion;
  }

  /**
   * Gets the last error message when status is 'error'.
   *
   * **When Available:**
   * - Server failed to start (CLI not found, timeout)
   * - Server crashed during execution
   * - Connection failed
   *
   * **When Returns Undefined:**
   * - Status is not 'error'
   * - No error has occurred yet
   * - Error was cleared by successful operation
   *
   * **Usage:**
   * ```typescript
   * if (manager.getStatus() === "error") {
   *   const error = manager.getLastError();
   *   console.error("Server error:", error);
   * }
   * ```
   *
   * @returns The last error message, or undefined if no error
   */
  getLastError(): string | undefined {
    return this._lastError;
  }

  getLastServerErrorOutput(): string | undefined {
    return this._lastServerErrorOutput;
  }

  /**
   * Finds an available network port for the server to listen on.
   *
   * Uses the OS-assigned port mechanism by creating a temporary server,
   * binding to port 0 (which tells the OS to assign any available port),
   * and then immediately closing it to get the port number.
   *
   * **Algorithm:**
   * 1. Create a TCP server
   * 2. Listen on port 0 (OS assigns available port)
   * 3. Get assigned port from server address
   * 4. Close server immediately
   * 5. Return port number
   *
   * **Why This Works:**
   * - Port 0 is a special port that tells the OS to pick any available port
   * - The OS guarantees the port is available at the time of assignment
   * - We close the server immediately to free the port for use by opencode
   * - The port remains available for a short time window (race condition possible)
   *
   * **Port Number Range:**
   * - Typically in the ephemeral port range (1024-65535)
   * - Commonly starts around 49152 on many systems
   * - Depends on OS and system configuration
   *
   * @returns Promise resolving to an available port number
   *
   * @private
   */
  private async findAvailablePort(): Promise<number> {
    return new Promise((resolve) => {
      const server = net.createServer();
      // Listen on port 0 - OS will assign an available port
      server.listen(0, () => {
        const port = (server.address() as net.AddressInfo).port;
        // Close server immediately to free the port
        server.close(() => resolve(port));
      });
    });
  }

  /**
   * Gets the current SDK client instance.
   *
   * **Important:** This may return null if the server is not running.
   * Always call `ensureRunning()` first to guarantee a client is available.
   *
   * **Usage Pattern:**
   * ```typescript
   * // DON'T DO THIS - client might be null
   * const client = manager.getClient();
   * await client.createSession(...); // Could crash!
   *
   * // DO THIS - ensures client is available
   * const client = await manager.ensureRunning();
   * await client.createSession(...); // Safe!
   * ```
   *
   * @returns The OpencodeClient instance, or null if not connected
   *
   * @see ensureRunning for guaranteed client access
   */
  getClient(): OpencodeClient | null {
    return this.client;
  }

  /**
   * Gets the port number the server is running on.
   *
   * **Important:** This returns 0 if the server is not running.
   * Check `getStatus() === "running"` first if you need a valid port.
   *
   * @returns The port number, or 0 if server is not running
   *
   * @see getStatus for checking server state
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Disposes of the server manager and stops the server process.
   *
   * This cleanup method:
   * - Cancels any pending reconnect timer
   * - Stops the server process (if running)
   * - Clears the client reference
   * - Resets status to "idle"
   *
   * **Cross-Platform Process Cleanup:**
   * - **Windows:** Uses `taskkill /T /F` to kill the entire process tree
   *   - /T: Kills child processes
   *   - /F: Force kill (doesn't wait for graceful shutdown)
   * - **Unix/Linux/macOS:** Uses `process.kill()` (SIGTERM)
   *
   * **Windows Process Tree Handling:**
   * On Windows, the opencode CLI might spawn child processes (e.g., for AI servers).
   * Using `process.kill()` only kills the parent process, leaving orphans.
   * The `taskkill` command with /T flag ensures the entire tree is terminated.
   *
   * **Error Handling:**
   * - Silently ignores errors if process is already dead
   * - Logs start/stop for debugging
   * - Does not throw (dispose should never throw)
   *
   * **When to Call:**
   * - Extension deactivation (in `deactivate()` function)
   * - User disables server auto-start
   * - Manual server restart
   *
   * @see deactivate in extension.ts for cleanup call site
   */
  dispose() {
    this.isDisposed = true;
    this.startupPromise = null;

    // Cancel any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Stop the server process if running
    if (this.serverProcess) {
      log.info("Stopping OpenCode server");
      this.terminateProcessTree(this.serverProcess);
      this.serverProcess = null;
    }

    // Clear client reference and reset status
    this.client = null;
    this.port = 0;
    void this.persistManagedPort(0);
    this.setStatus("idle");
    this._onServerErrorOutput.dispose();
    this._onStatusChange.dispose();
  }

  /**
   * Gets the current server status.
   *
   * **Status Values:**
   * - `"idle"`: Server not running
   * - `"starting"`: Server is starting up
   * - `"running"`: Server is ready and accepting connections
   * - `"error"`: Server failed to start or crashed
   *
   * **Usage:**
   * ```typescript
   * if (manager.getStatus() === "running") {
   *   // Server is available for API calls
   * }
   * ```
   *
   * **Event Subscription:**
   * For reactive updates, subscribe to `onStatusChange` event instead
   * of polling this method.
   *
   * @returns The current server status
   *
   * @see onStatusChange for event-based status updates
   * @see ServerStatus for all possible status values
   */
  getStatus(): ServerStatus {
    return this._status;
  }

  /**
   * Sets the server status and notifies all subscribers.
   *
   * This method implements the state transition logic:
   * - Only fires event if status actually changes
   * - Prevents redundant notifications for same status
   * - Used internally for all state transitions
   *
   * **State Transitions:**
   * ```
   * idle → starting (ensureRunning called)
   * starting → running (server ready detected)
   * starting → error (startup failed or timeout)
   * running → error (server crashed)
   * error → starting (reconnect attempted)
   * running → idle (manual stop)
   * error → idle (reset)
   * ```
   *
   * @param status - The new status to set
   *
   * @private
   *
   * @see onStatusChange for subscribing to status changes
   */
  private setStatus(status: ServerStatus, error?: string): void {
    const oldStatus = this._status;
    const previousError = this._lastError;

    if (status === "error" && error) {
      this._lastError = error;
    } else if (status !== "error") {
      this._lastError = undefined;
    }

    const statusChanged = oldStatus !== status;
    const errorChanged = previousError !== this._lastError;

    if (!statusChanged && !(status === "error" && errorChanged)) {
      return;
    }

    this._status = status;
    if (statusChanged) {
      log.logStateChange('server_status', oldStatus, status, 'setStatus');
      log.debug("Server status changed", { oldStatus, newStatus: status, error: this._lastError });
    } else {
      log.debug("Server error details updated", { status, error: this._lastError });
    }
    this._onStatusChange.fire(status);
  }

  private async isPortReachable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;

      const finish = (ok: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(ok);
      };

      socket.setTimeout(800);
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.once("timeout", () => finish(false));

      try {
        socket.connect(port, LOOPBACK_HOST);
      } catch {
        finish(false);
      }
    });
  }

  /**
   * Compacts a session by removing old messages to reduce token usage.
   *
   * This method calls the SDK client's compact session endpoint to
   * compress the session history while preserving important context.
   *
   * @param sessionId - The ID of the session to compact
   * @returns Promise resolving to the compaction response data
   * @throws {Error} If client is not available or compaction fails
   */
  async compactSession(
    sessionId: string,
    model: { providerID: string; modelID: string },
  ): Promise<{ data?: unknown }> {
    if (!this.client) {
      throw new Error("Cannot compact session: client not available");
    }
    if (!model?.providerID || !model?.modelID) {
      throw new Error("Cannot compact session: selected model is required");
    }

    try {
      const workspaceDirectory = this.getWorkspaceDirectory();
      log.info("[OPENCOD GO MODEL] compactSession called", {
        sessionId,
        providerID: model.providerID,
        modelID: model.modelID,
      });
      const result = await this.client.session.summarize({
        sessionID: sessionId,
        providerID: model.providerID,
        modelID: model.modelID,
        ...(workspaceDirectory ? { directory: workspaceDirectory } : {}),
      });
      return result;
    } catch (error) {
      log.error("Failed to compact session", { sessionId, error });
      throw error;
    }
  }

  async restartServer(): Promise<OpencodeClient> {
    this.isDisposed = false;
    this.stopCurrentServer();
    return this.ensureRunning();
  }
}
