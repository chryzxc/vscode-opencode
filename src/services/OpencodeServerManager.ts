// MARKER: VERSION 3
import * as vscode from "vscode";
import * as cp from "child_process";
import * as net from "net";
import { createOpencodeClient, OpencodeClient } from "@opencode-ai/sdk";

export type ServerStatus = "idle" | "starting" | "running" | "error";

export class OpencodeServerManager {
  private client: OpencodeClient | null = null;
  private serverProcess: cp.ChildProcess | null = null;
  private port: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private _status: ServerStatus = "idle";
  private _onStatusChange = new vscode.EventEmitter<ServerStatus>();
  public readonly onStatusChange = this._onStatusChange.event;

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Ensures OpenCode server is running and returns a connected client
   */
  async ensureRunning(): Promise<OpencodeClient> {
    if (this.client) {
      // Assume client is still valid if it exists
      return this.client;
    }

    this.setStatus("starting");

    // Try to connect to existing server first
    const config = vscode.workspace.getConfiguration("opencode");
    const configuredPort = config.get<number>("serverPort", 0);

    if (configuredPort > 0) {
      try {
        this.client = createOpencodeClient({
          baseUrl: `http://localhost:${configuredPort}`,
        });

        this.port = configuredPort;
        console.log(
          `Connected to existing OpenCode server on port ${configuredPort}`,
        );
        this.setStatus("running");
        return this.client;
      } catch (error) {
        console.log(`Failed to connect to port ${configuredPort}:`, error);
        // Don't set error yet, we might start a new server
      }
    }

    // Start new server
    return this.startServer();
  }

  /**
   * Starts a new OpenCode server process
   */
  private async startServer(): Promise<OpencodeClient> {
    // Find available port
    this.port = await this.findAvailablePort();

    return new Promise((resolve, reject) => {
      console.log(`Starting OpenCode server on port ${this.port}...`);

      // Spawn opencode serve in the workspace root if available
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const spawnOptions: cp.SpawnOptions = {
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      };

      if (workspaceFolder && workspaceFolder.uri.scheme === "file") {
        spawnOptions.cwd = workspaceFolder.uri.fsPath;
        console.log(`OpenCode server CWD set to: ${spawnOptions.cwd}`);
      }

      this.serverProcess = cp.spawn(
        "opencode",
        ["serve", "--port", this.port.toString()],
        spawnOptions,
      );

      let serverReady = false;

      this.serverProcess.stdout?.on("data", (data) => {
        const output = data.toString();
        console.log(`[OpenCode Server] ${output}`);

        // Look for server ready indicator
        if (output.includes("Server running") || output.includes("listening")) {
          if (!serverReady) {
            serverReady = true;
            this.connectToServer().then(resolve).catch(reject);
          }
        }
      });

      this.serverProcess.stderr?.on("data", (data) => {
        console.error(`[OpenCode Server Error] ${data.toString()}`);
      });

      this.serverProcess.on("error", (error) => {
        console.error("Failed to start OpenCode server:", error);
        this.setStatus("error");

        if (error.message.includes("ENOENT")) {
          vscode.window.showErrorMessage(
            "OpenCode CLI not found. Please install it first: npm install -g opencode-ai",
          );
        }

        reject(error);
      });

      this.serverProcess.on("exit", (code) => {
        console.log(`OpenCode server exited with code ${code}`);
        this.serverProcess = null;
        this.client = null;
        this.setStatus(code === 0 ? "idle" : "error");

        // Auto-reconnect after 5 seconds
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.ensureRunning().catch(console.error);
          }, 5000);
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!serverReady) {
          this.setStatus("error");
          reject(new Error("Server startup timeout"));
        }
      }, 10000);
    });
  }

  /**
   * Connects to the running server
   */
  private async connectToServer(): Promise<OpencodeClient> {
    this.client = createOpencodeClient({
      baseUrl: `http://localhost:${this.port}`,
    });

    console.log(`Connected to OpenCode server on port ${this.port}`);
    this.setStatus("running");
    return this.client;
  }

  /**
   * Finds an available port starting from 4097
   */
  private async findAvailablePort(): Promise<number> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(0, () => {
        const port = (server.address() as net.AddressInfo).port;
        server.close(() => resolve(port));
      });
    });
  }

  /**
   * Gets the current client (may be null if not connected)
   */
  getClient(): OpencodeClient | null {
    return this.client;
  }

  /**
   * Gets the server port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Disposes the server manager
   */
  dispose() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.serverProcess) {
      console.log("Stopping OpenCode server...");

      // On Windows, we need to kill the process tree to ensure the CLI and its children are killed
      if (process.platform === "win32" && this.serverProcess.pid) {
        try {
          cp.execSync(`taskkill /pid ${this.serverProcess.pid} /T /F`);
        } catch (e) {
          // Ignore error if process is already dead
        }
      } else {
        this.serverProcess.kill();
      }

      this.serverProcess = null;
    }

    this.client = null;
    this.setStatus("idle");
  }

  /**
   * Gets the current status
   */
  getStatus(): ServerStatus {
    return this._status;
  }

  /**
   * Sets the status and notifies subscribers
   */
  private setStatus(status: ServerStatus): void {
    if (this._status !== status) {
      this._status = status;
      this._onStatusChange.fire(status);
    }
  }
}
