import * as vscode from 'vscode';
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
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Subscribe to stream events
    this.unsubscribe = this.streamService.subscribe((event) => {
      // Forward events to webview
      this.view?.webview.postMessage({
        type: "streamEvent",
        event,
      });
    });

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "ready":
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
          this.refreshView();
          break;
        case "sendMessage":
          await this.handleSendMessage(message.text, message.files);
          break;
        case "toggleMode":
          await this.handleToggleMode();
          break;
        case "newSession":
          await this.sessionService.createNewSession();
          this.refreshView();
          break;
        case "viewPlan": // Handle view implementation plan request
          await this.handleViewPlan(message.content);
          break;
        case "searchFiles":
          await this.handleSearchFiles(message.query);
          break;
        case "selectModel":
          this.selectedModel = message.model;
          break;
        case "getModels":
          await this.handleGetModels();
          break;
      }
    });

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
          text: text,
        },
      ];

      // Add file references if any
      if (files && files.length > 0) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
          for (const filePath of files) {
            try {
              const absoluteUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                filePath,
              );
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
      // Use provider.list() instead of config.get() to see all available models, including free ones
      const response = await client.provider.list();

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

        this.view?.webview.postMessage({
          type: "modelsList",
          models,
          selectedModel: this.selectedModel,
        });

        return models;
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
    return [];
  }
}
