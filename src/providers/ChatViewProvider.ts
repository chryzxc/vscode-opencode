import * as vscode from 'vscode';
import * as path from "path";
import { OpencodeServerManager } from '../services/OpencodeServerManager';
import { SessionService } from '../services/SessionService';
import { MessageStreamService } from '../services/MessageStreamService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private streamService: MessageStreamService;
  private unsubscribe?: () => void;
  private selectedModel: { providerID: string; modelID: string } = {
    providerID: "opencode",
    modelID: "big-pickle",
  };

  constructor(
    private context: vscode.ExtensionContext,
    private serverManager: OpencodeServerManager,
    private sessionService: SessionService,
  ) {
    this.streamService = new MessageStreamService(serverManager);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    console.log("[ChatViewProvider] resolving webview view");
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "ready": {
          // Fetch models first to ensure we have correct provider IDs
          const models = await this.handleGetModels();

          // Try to resolve the current model's provider if it's generic
          if (models.length > 0) {
            const resolved = models.find(
              (m) => m.modelID === this.selectedModel.modelID,
            );
            if (
              resolved &&
              resolved.providerID !== this.selectedModel.providerID
            ) {
              console.log(
                `Resolved model ${this.selectedModel.modelID} to provider ${resolved.providerID}`,
              );
              this.selectedModel.providerID = resolved.providerID;
            }
          }

          // Send initial state
          this.view?.webview.postMessage({
            type: "initState",
            mode: this.sessionService.getMode(),
            serverStatus: this.serverManager.getStatus(),
            selectedModel: this.selectedModel,
          });

          // Fetch and send chat history and sessions list
          const currentSession = await this.sessionService.getCurrentSession();
          if (currentSession) {
            const messages = await this.sessionService.getMessages(
              currentSession.id,
            );
            this.view?.webview.postMessage({
              type: "chatHistory",
              messages: messages,
            });
          }

          await this.handleGetSessions();
          this.refreshView();
          break;
        }
        case "sendMessage": {
          await this.handleSendMessage(message.text, message.files);
          break;
        }
        case "toggleMode": {
          await this.handleToggleMode();
          break;
        }
        case "newSession": {
          await this.sessionService.createNewSession();
          await this.handleGetSessions(); // Update list
          this.refreshView();

          // Clear webview messages
          this.view?.webview.postMessage({
            type: "chatHistory",
            messages: [],
          });
          break;
        }
        case "viewPlan": {
          await this.handleViewPlan(message.content);
          break;
        }
        case "searchFiles": {
          await this.handleSearchFiles(message.query);
          break;
        }
        case "selectModel": {
          this.selectedModel = message.model;
          break;
        }
        case "getModels": {
          await this.handleGetModels();
          break;
        }
        case "getSessions": {
          await this.handleGetSessions();
          break;
        }
        case "loadSession": {
          await this.handleLoadSession(message.sessionId);
          break;
        }
        case "deleteSession": {
          await this.handleDeleteSession(message.sessionId);
          break;
        }
      }
    });

    // Subscribe to stream events
    this.unsubscribe = this.streamService.subscribe((event) => {
      // Forward events to webview
      this.view?.webview.postMessage({
        type: "streamEvent",
        event,
      });
    });

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Subscribe to status changes
    const statusSubscription = this.serverManager.onStatusChange((status) => {
      this.view?.webview.postMessage({
        type: "statusUpdate",
        status: status,
      });
    });

    // Cleanup on dispose
    webviewView.onDidDispose(() => {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = undefined;
      }
      statusSubscription.dispose();
      this.view = undefined;
    });
  }

  /**
   * Handles getting the sessions list
   */
  private async handleGetSessions(): Promise<void> {
    try {
      const sessions = await this.sessionService.listSessions();
      const currentSession = await this.sessionService.getCurrentSession();

      this.view?.webview.postMessage({
        type: "sessionsList",
        sessions,
        currentSessionId: currentSession?.id,
      });
    } catch (error) {
      console.error("Failed to get sessions:", error);
    }
  }

  /**
   * Handles switching to a specific session
   */
  private async handleLoadSession(sessionId: string): Promise<void> {
    try {
      await this.sessionService.switchSession(sessionId);

      // Reload history for the new session
      const messages = await this.sessionService.getMessages(sessionId);
      this.view?.webview.postMessage({
        type: "chatHistory",
        messages: messages,
      });

      // Update the list selection
      await this.handleGetSessions();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load session: ${error}`);
    }
  }

  /**
   * Handles deleting a session
   */
  private async handleDeleteSession(sessionId: string): Promise<void> {
    try {
      await this.sessionService.deleteSession(sessionId);
      await this.handleGetSessions();

      // If we deleted the current session, create a new one
      const currentSession = await this.sessionService.getCurrentSession();
      if (!currentSession) {
        await this.sessionService.createNewSession();
        this.view?.webview.postMessage({
          type: "chatHistory",
          messages: [],
        });
        await this.handleGetSessions();
      } else if (currentSession.id === sessionId) {
        // Should have been handled by sessionService logic but safe guard
        // If active was deleted, refresh history
        const messages = await this.sessionService.getMessages(
          currentSession.id,
        );
        this.view?.webview.postMessage({
          type: "chatHistory",
          messages: messages,
        });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to delete session: ${error}`);
    }
  }

  /**
   * Gets the system instruction based on the current mode
   */
  private getModeSystemInstruction(): string {
    const mode = this.sessionService.getMode();

    if (mode === "plan") {
      return "[SYSTEM: Current Mode is PLANNING. Discuss architecture, answer questions, and create detailed plans. If you are presenting an implementation plan, you MUST start the plan section with the header '# Implementation Plan' to enable interactive features. Do NOT write full implementation code yet. If the user asks a question, answer it directly.]\n\n";
    } else {
      return "[SYSTEM: Current Mode is BUILDING. Focus on implementing the solution. Write code. IMPORTANT: If the user asks a question, ANSWER it first. Do not ignore user questions to blindly follow previous plans.]\n\n";
    }
  }

  /**
   * Handles sending a message to OpenCode
   */
  private async handleSendMessage(
    text: string,
    files?: string[],
  ): Promise<void> {
    try {
      const client = await this.serverManager.ensureRunning();
      const session = await this.sessionService.getCurrentSession();

      console.log(`Sending message to session ${session.id}:`, text, files);

      // Prepare message parts
      const parts: Array<{ type: "text" | "file"; [key: string]: unknown }> = [
        {
          type: "text",
          text: this.getModeSystemInstruction() + text,
        },
      ];

      // Add file references if any
      if (files && files.length > 0) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
          for (const filePath of files) {
            try {
              // Check if path is absolute
              let absoluteUri: vscode.Uri;
              if (path.isAbsolute(filePath)) {
                absoluteUri = vscode.Uri.file(filePath);
              } else {
                absoluteUri = vscode.Uri.joinPath(
                  workspaceFolder.uri,
                  filePath,
                );
              }

              const content = await vscode.workspace.fs.readFile(absoluteUri);
              const textContent = new TextDecoder().decode(content);

              parts.push({
                type: "file",
                mime: "text/plain",
                filename: filePath.split(/[\\/]/).pop(),
                url: `file://${filePath}`,
                source: {
                  type: "file",
                  path: filePath,
                  text: {
                    value: textContent,
                    start: 0,
                    end: textContent.length,
                  },
                },
              });
            } catch (e) {
              console.error(`Failed to read file ${filePath}:`, e);
            }
          }
        }
      }

      // Send the message using the SDK
      const startTime = Date.now();
      const response = await client.session.prompt({
        path: { id: session.id },
        body: {
          model: this.selectedModel,
          parts: parts,
        },
      });
      const duration = (Date.now() - startTime) / 1000;

      console.log(`Received response in ${duration}s:`, response);

      // Check for errors in the response
      if (response.error) {
        const errorDetails = JSON.stringify(response.error, null, 2);
        console.error("OpenCode API error:", errorDetails);

        let errorMessage =
          Array.isArray(response.error.error) && response.error.error.length > 0
            ? response.error.error[0].message || "Unknown error"
            : "Failed to send message";

        // Handle specific model not found error
        if (
          errorMessage.includes("ProviderModelNotFoundError") ||
          errorMessage.includes("ModelNotFoundError")
        ) {
          errorMessage +=
            "\n\nTIP: Try starting a new session (click +) to use the default model.";
        }

        vscode.window.showErrorMessage(`OpenCode error: ${errorMessage}`);
        this.view?.webview.postMessage({
          type: "error",
          message: errorMessage,
        });
        return;
      }

      // Check for hidden errors in data (e.g. ModelNotFoundError returned as JSON)
      if (
        response.data &&
        (response.data as any).suggestions &&
        (response.data as any).modelID &&
        !(response.data as any).content
      ) {
        const errData = response.data as any;
        let errorMessage = `Model '${errData.modelID}' not found in provider '${errData.providerID}'.`;
        if (errData.suggestions && errData.suggestions.length > 0) {
          errorMessage += ` Did you mean: ${errData.suggestions.join(", ")}?`;
        }
        errorMessage +=
          "\n\nTIP: Check your model selection or local OpenCode configuration.";

        vscode.window.showErrorMessage(errorMessage);
        this.view?.webview.postMessage({
          type: "error",
          message: errorMessage,
        });
        return;
      }

      // Send response back to webview
      if (response.data) {
        this.view?.webview.postMessage({
          type: "messageResponse",
          message: {
            ...response.data,
            timing: {
              duration: duration,
            },
          },
        });
      } else {
        console.warn("No response data received from OpenCode");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to send message: ${errorMessage}`);
      console.error("Send message error:", error);

      // Show error in webview too
      this.view?.webview.postMessage({
        type: "error",
        message: errorMessage,
      });
    }
  }

  /**
   * Handles mode toggle
   */
  private async handleToggleMode(): Promise<void> {
    const newMode = this.sessionService.toggleMode();

    this.view?.webview.postMessage({
      type: "modeChanged",
      mode: newMode,
    });

    vscode.window.showInformationMessage(
      `Switched to ${newMode.toUpperCase()} mode`,
    );
  }

  /**
   * Appends text to the prompt input
   */
  async appendToPrompt(text: string): Promise<void> {
    this.view?.webview.postMessage({
      type: "appendPrompt",
      text,
    });
  }

  /**
   * Toggles the mode
   */
  async toggleMode(): Promise<void> {
    await this.handleToggleMode();
  }

  /**
   * Handles viewing the implementation plan
   */
  private async handleViewPlan(content: string): Promise<void> {
    await vscode.commands.executeCommand("opencode.showPlan", content);
  }

  /**
   * Handles opening the file picker
   */
  private async handleAttachFiles(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: "Attach to Chat",
      filters: {
        "All Files": ["*"],
      },
    });

    if (uris && uris.length > 0) {
      // Convert URIs to relative paths or absolute paths for selection
      // For now, let's just send back the absolute paths as this is what the extension uses
      const files = uris.map((u) => u.fsPath);

      // We need a message type to receive these in the webview
      this.view?.webview.postMessage({
        type: "filesAttached",
        files,
      });
    }
  }

  /**
   * Handles opening settings
   */
  private async handleOpenSettings(): Promise<void> {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "@ext:OpenCode.opencode-vscode",
    );
  }

  /**
   * Refreshes the view with current state
   */
  private refreshView(): void {
    const mode = this.sessionService.getMode();

    this.view?.webview.postMessage({
      type: "init",
      mode,
    });
  }

  /**
   * Generates the HTML content for the webview
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "chat",
        "styles.css",
      ),
    );
    const highlightCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "chat",
        "lib",
        "highlight.css",
      ),
    );
    const vendorScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "chat",
        "lib",
        "vendor.js",
      ),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "chat",
        "app.js",
      ),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <link href="${highlightCssUri}" rel="stylesheet">
  <title>OpenCode Chat</title>
</head>
<body>
  <div id="loading-overlay" class="loading-overlay visible">
    <div class="loading-content">
      <div class="spinner"></div>
      <div id="loading-text" class="loading-text">Starting OpenCode...</div>
    </div>
  </div>

  <div class="chat-container">
    <div id="messages" class="messages">
        <!-- Messages will be injected here -->
        <div id="empty-state" class="empty-state">
            <div class="empty-icon">✴️</div>
            <h2>OpenCode</h2>
            <p>Ready to help you build.</p>
        </div>
    </div>

    <div class="input-wrapper">
        <div class="files-preview" id="files-preview"></div>
        <div class="input-container">
            <textarea 
                id="message-input" 
                placeholder="Ask anything (Ctrl+L), @ to mention, / for workflows"
                rows="1"
            ></textarea>
            
            <div class="input-footer">
                <div class="input-left">
                    <button id="add-context-btn" class="icon-btn" title="Add Context">+</button>
                    <div class="status-pills">
                        <button id="mode-toggle" class="pill-btn" title="Current Mode">
                            <span class="pill-icon">🛠️</span>
                            <span class="mode-text">Planning</span>
                        </button>
                        <button id="model-selector" class="pill-btn secondary" title="Current Model">
                            <span id="current-model-name">GLM 4.7 Coding Plan</span>
                        </button>
                    </div>
                </div>
                <div class="input-right">
                    <button id="send-button" class="send-btn" title="Send (Shift+Enter)">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M8.25 3L14 8.75M14 8.75L8.25 14.5M14 8.75H2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
        <div id="model-dropdown" class="dropdown-menu hidden">
            <div class="model-search-container">
                <input type="text" id="model-search-input" placeholder="Search models or providers..." />
            </div>
            <div id="model-list-container"></div>
        </div>
        <div class="footer-info">
             <span id="files-changed-count">0 Files With Changes</span>
             <button id="review-changes-btn" class="link-btn">Review Changes</button>
        </div>
    </div>
  </div>

  <div id="suggestions" class="suggestions-menu hidden"></div>

  <script src="${vendorScriptUri}"></script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Handles file search requests from the webview
   */
  private async handleSearchFiles(query: string) {
    if (!query) {
      this.view?.webview.postMessage({
        type: "fileSearchResults",
        results: [],
      });
      return;
    }

    try {
      // Simple file search using VS Code API
      // Limit to 20 results for performance
      const files = await vscode.workspace.findFiles(
        `**/*${query}*`,
        "**/node_modules/**",
        20,
      );
      const results = files.map((f) => {
        const relativePath = vscode.workspace.asRelativePath(f);
        return {
          path: relativePath,
          name: relativePath.split(/[\\/]/).pop() || relativePath,
        };
      });

      this.view?.webview.postMessage({
        type: "fileSearchResults",
        results: results,
      });
    } catch (error) {
      this.view?.webview.postMessage({
        type: "fileSearchResults",
        results: [],
      });
    }
  }

  /**
   * Resolves the default model from the CLI config
   */
  private async resolveDefaultModel(
    models: Array<{ providerID: string; modelID: string; name: string }>,
  ): Promise<void> {
    // Only attempt if we are still on the hardcoded default
    if (
      this.selectedModel.modelID !== "big-pickle" ||
      this.selectedModel.providerID !== "opencode"
    ) {
      return;
    }

    try {
      const cp = await import("child_process");
      const util = await import("util");
      const execAsync = util.promisify(cp.exec);

      const { stdout } = await execAsync("opencode config get default_model");
      const defaultId = stdout.trim();

      if (defaultId) {
        console.log(`[ChatViewProvider] Found CLI default model: ${defaultId}`);
        // Find matching model in our list
        const match = models.find(
          (m) => m.modelID === defaultId || m.name === defaultId,
        );

        if (match) {
          this.selectedModel = {
            providerID: match.providerID,
            modelID: match.modelID,
          };
          console.log(
            `[ChatViewProvider] Synced default model to: ${match.modelID} (${match.providerID})`,
          );
        }
      }
    } catch (error) {
      console.warn(
        "[ChatViewProvider] Failed to resolve default model from CLI:",
        error,
      );
    }
  }

  /**
   * Handles fetching available models from OpenCode
   */
  private async handleGetModels(): Promise<
    Array<{
      providerID: string;
      modelID: string;
      name: string;
      providerName: string;
    }>
  > {
    try {
      const client = await this.serverManager.ensureRunning();

      // Add timeout to provider list call
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Provider list timeout")), 5000),
      );

      // Use provider.list() instead of config.get() to see all available models
      const response = (await Promise.race([
        client.provider.list(),
        timeoutPromise,
      ])) as any; // Type assertion since race result type is union

      if (response.data && response.data.all) {
        const models: Array<{
          providerID: string;
          modelID: string;
          name: string;
          providerName: string;
        }> = [];

        for (const provider of response.data.all) {
          if (provider.models) {
            for (const [modelID, modelConfig] of Object.entries(
              provider.models,
            )) {
              models.push({
                providerID: provider.id,
                modelID: modelID,
                name: (modelConfig as any).name || modelID,
                providerName: provider.name || provider.id,
              });
            }
          }
        }

        console.log(
          `Discovered ${models.length} total models across all providers`,
        );

        // Try to sync default model before sending to UI
        await this.resolveDefaultModel(models);

        this.view?.webview.postMessage({
          type: "modelsList",
          models,
          selectedModel: this.selectedModel,
        });

        return models;
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
      // Send empty list to allow UI to proceed
      this.view?.webview.postMessage({
        type: "modelsList",
        models: [],
        selectedModel: this.selectedModel,
      });
    }
    return [];
  }
}
