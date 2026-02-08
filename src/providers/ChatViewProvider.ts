import * as vscode from 'vscode';
import * as path from "path";
import * as cp from "child_process";
import { OpencodeServerManager } from '../services/OpencodeServerManager';
import { SessionService } from '../services/SessionService';
import { MessageStreamService } from '../services/MessageStreamService';
import type { Session, SessionPromptData } from "@opencode-ai/sdk";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private streamService: MessageStreamService;
  private unsubscribe?: () => void;
  private selectedModel: { providerID: string; modelID: string } = {
    providerID: "opencode",
    modelID: "big-pickle",
  };
  private selectedAgent: string = "general";

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

          // Fetch agents and default agent from CLI
          await this.syncCLIAgents();

          // Send initial state
          this.view?.webview.postMessage({
            type: "initState",
            mode: this.sessionService.getMode(),
            serverStatus: this.serverManager.getStatus(),
            selectedModel: this.selectedModel,
            selectedAgent: this.selectedAgent,
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
          await this.handleSendMessage(
            message.text,
            message.files,
            message.contexts,
          );
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
          const file = message.plan?.file || message.content;
          if (file) {
            await this.handleViewPlan(file);
          }
          break;
        }
        case "openDiff": {
          this.handleOpenDiff(message.file);
          break;
        }
        case "reviewChanges": {
          this.handleReviewChanges();
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
        case "selectAgent": {
          this.selectedAgent = message.agent;
          break;
        }
        case "getAgents": {
          this.handleGetAgents();
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
        case "stopRequest": {
          await this.handleStopRequest(message.sessionId);
          break;
        }
        case "log": {
          const { level, message: logMsg } = message;
          const prefix = "[WebView]";
          switch (level) {
            case "error":
              console.error(prefix, logMsg);
              break;
            case "warn":
              console.warn(prefix, logMsg);
              break;
            default:
              console.log(prefix, logMsg);
              break;
          }
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
      const rawMessages = await this.sessionService.getMessages(sessionId);
      const messages = rawMessages.map((m: any) =>
        this.enrichMessageWithPlan(m),
      );

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
    contexts?: any[],
  ): Promise<void> {
    try {
      const client = await this.serverManager.ensureRunning();
      const session = await this.sessionService.getCurrentSession();

      const existingMessages = await this.sessionService.getMessages(
        session.id,
      );
      const isNewSession = existingMessages.length === 0;

      // Save user message to local history immediately
      await this.sessionService.appendMessage(session.id, {
        role: "user",
        parts: [
          {
            type: "text",
            text: text,
          },
        ],
        time: {
          created: Date.now(),
        },
      });

      console.log(
        `[ChatViewProvider] Session ${session.id}: ${existingMessages.length} existing messages. isNew: ${isNewSession}`,
      );

      // Prepare message parts
      const parts: NonNullable<SessionPromptData["body"]>["parts"] = [
        {
          type: "text",
          text: (isNewSession ? this.getModeSystemInstruction() : "") + text,
        },
      ];

      // Add context fragments if any
      if (contexts && contexts.length > 0) {
        for (const ctx of contexts) {
          parts.push({
            type: "text",
            text: `\`\`\`${ctx.languageId}\n// ${ctx.file}:${ctx.lineInfo}\n${ctx.content}\n\`\`\``,
          });
        }
      }

      // Add file references if any
      // ... (rest of the file part logic remains the same)

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
          agent: this.selectedAgent,
          parts: parts,
        },
      });
      const duration = (Date.now() - startTime) / 1000;

      console.log(`Received response in ${duration}s:`, response);

      // Check for errors in the response
      if (response.error) {
        const errorDetails = JSON.stringify(response.error, null, 2);
        console.error("OpenCode API error:", errorDetails);

        // Safely extract error message
        let errorMessage = "Failed to send message";
        const err = response.error as any;

        if (Array.isArray(err.errors) && err.errors.length > 0) {
          errorMessage = err.errors[0].message || JSON.stringify(err.errors[0]);
        } else if (err.data && err.data.message) {
          errorMessage = err.data.message;
        } else if (err.message) {
          errorMessage = err.message;
        }

        // Handle Session Not Found error (likely server restart)
        if (
          errorMessage.toLowerCase().includes("not found") &&
          errorMessage.toLowerCase().includes("session")
        ) {
          console.warn(
            `[ChatViewProvider] Session ${session.id} not found on server. Re-creating...`,
          );
          // Re-create the session on the server
          try {
            const newSession = await this.sessionService.createNewSession(
              session.title,
            );
            console.log(
              `[ChatViewProvider] Re-created session with new ID: ${newSession.id}`,
            );

            // Migrate local messages from old ID to new ID
            const localMessages = await this.sessionService.loadSessionMessages(
              session.id,
            );
            await this.sessionService.saveSessionMessages(
              newSession.id,
              localMessages,
            );
            // Optionally delete old messages? No, leave them for now.

            // Set as current session and retry
            await this.sessionService.switchSession(newSession.id);

            // Notify UI of the ID change if possible, or just refresh sessions
            await this.handleGetSessions();

            // Retry sending (recursive call)
            return this.handleSendMessage(text, files, contexts);
          } catch (recreateError) {
            console.error(
              "[ChatViewProvider] Failed to re-create session:",
              recreateError,
            );
          }
        }

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
        const enrichedMessage = this.enrichMessageWithPlan(response.data);

        // Save assistant message to local history
        await this.sessionService.appendMessage(session.id, {
          ...enrichedMessage,
          timing: {
            duration: duration,
          },
        });

        this.view?.webview.postMessage({
          type: "messageResponse",
          message: {
            ...enrichedMessage,
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
   * Enriches a message with plan information if detected.
   * FORBIDDEN TO REMOVE: This logic ensures the Implementation Plan button appears,
   * which is a core feature for user transparency and workflow.
   */
  private enrichMessageWithPlan(message: any): any {
    if (!message) return message;

    // Check for implementation plan in edits, parts, or message content
    const edits = message.edits || [];
    const parts = message.parts || [];
    const info = message.info || {};

    // 1. Check for explicit filename in edits/parts
    const hasPlanFile =
      edits.some(
        (e: any) => e.file && e.file.endsWith("implementation_plan.md"),
      ) ||
      parts.some(
        (p: any) =>
          p.type === "patch" &&
          p.files &&
          p.files.some((f: string) => f.endsWith("implementation_plan.md")),
      );

    // 2. Fallback: Check for plan-like content in message summary, parts, or plain content
    const partsContent = parts
      .map((p: any) => {
        let c = p.text || p.content || p.reasoning || "";
        // Check for file part text/language if available
        if (p.type === "text" && p.text) c += " " + p.text;
        if (p.files && Array.isArray(p.files)) c += " " + p.files.join(" ");
        return c;
      })
      .join(" ");

    const fullContent =
      (info.summary?.title || "") +
      " " +
      (info.summary?.body || "") +
      " " +
      (message.content || "") +
      " " +
      partsContent;

    // Broadened regex to catch more variations of "Implementation Plan"
    // Also check if the title itself strongly indicates a plan
    const hasPlanKeywords =
      /implementation\s*plan/i.test(fullContent) ||
      /goal\s*description/i.test(fullContent) ||
      /proposed\s*changes/i.test(fullContent) ||
      /implementation_plan\.md/i.test(fullContent) ||
      (/(plan|roadmap)/i.test(info.summary?.title || "") &&
        /(implementation|feature)/i.test(info.summary?.title || ""));

    if (hasPlanFile || hasPlanKeywords) {
      // Extract the content that looks like a plan to pass it directly
      // in case the file isn't written yet.
      const planContent = message.content || partsContent;

      // PERSISTENCE FIX: Automatically save the detected plan to disk
      // This ensures handleViewPlan can read it even if the SDK didn't write it.
      if (planContent && planContent.length > 100) {
        this.persistPlan(planContent).catch((err) => {
          console.error("[ChatViewProvider] Failed to auto-persist plan:", err);
        });
      }

      return {
        ...message,
        plan: {
          file: "implementation_plan.md",
          content: planContent,
        },
      };
    }

    return message;
  }

  /**
   * Automatically persists an implementation plan to the workspace
   */
  private async persistPlan(content: string): Promise<void> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) return;

      const filePath = path.join(
        workspaceFolders[0].uri.fsPath,
        "implementation_plan.md",
      );
      const fileUri = vscode.Uri.file(filePath);

      // Extra safety: only write if it looks like a real plan
      if (
        !content.includes("# Implementation Plan") &&
        !content.includes("Proposed Changes")
      ) {
        return;
      }

      await vscode.workspace.fs.writeFile(
        fileUri,
        new TextEncoder().encode(content),
      );
      console.log(`[ChatViewProvider] Auto-persisted plan to ${filePath}`);
    } catch (err) {
      console.error("[ChatViewProvider] persistPlan error:", err);
    }
  }

  /**
   * Handles stopping a request
   */
  private async handleStopRequest(sessionId: string): Promise<void> {
    try {
      const client = this.serverManager.getClient();
      if (!client) {
        return;
      }

      console.log(
        `[ChatViewProvider] Stopping request for session ${sessionId}`,
      );

      await client.session.abort({
        path: { id: sessionId },
      });
    } catch (error) {
      console.error("Failed to stop request:", error);
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
   * Adds a context badge to the prompt input
   */
  async addContext(context: any): Promise<void> {
    this.view?.webview.postMessage({
      type: "addContext",
      context,
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
    let planData = content;

    // If it looks like a filename, try to read the actual file
    if (content.endsWith(".md") && !content.includes("\n")) {
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
          const filePath = path.join(workspaceFolders[0].uri.fsPath, content);
          const fileUri = vscode.Uri.file(filePath);
          const uint8Array = await vscode.workspace.fs.readFile(fileUri);
          planData = new TextDecoder().decode(uint8Array);
          console.log(`[ChatViewProvider] Read plan from ${filePath}`);
        }
      } catch (err) {
        console.error(
          `[ChatViewProvider] Failed to read plan file ${content}:`,
          err,
        );
        // Fallback to original content or show error
        vscode.window.showErrorMessage(`Could not read plan file: ${content}`);
        return;
      }
    }

    await vscode.commands.executeCommand("opencode.showPlan", planData);
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
  <div id="loading-overlay" class="loading-overlay">
    <div class="loading-content">
      <div class="spinner"></div>
      <div id="loading-text" class="loading-text">Starting OpenCode...</div>
    </div>
  </div>

  <div class="chat-container">
    <!-- FORBIDDEN TO REMOVE: Token counters and session info are required for user transparency. -->
    <div id="chat-header" class="chat-header hidden" title="Important: Do not remove this header">
        <div class="header-info">
            <div class="stat-group">
                <span class="stat-label">Tokens:</span>
                <span id="session-tokens" class="stat" title="Total Tokens">0</span>
                <div class="stat-details">
                    <span id="tokens-in" title="Input Tokens">0i</span>
                    <span id="tokens-out" title="Output Tokens">0o</span>
                    <span id="tokens-read" title="Cache Read">0r</span>
                    <span id="tokens-write" title="Cache Write">0w</span>
                </div>
            </div>
            <span class="separator">|</span>
            <span id="session-time" class="stat">0s</span>
        </div>
        <div class="header-session-info">
            <span class="stat-label">Session:</span>
            <span id="header-session-id" class="stat">New</span>
        </div>
    </div>
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
                    <button id="add-context-btn" class="icon-btn" title="New Chat">+</button>
                    <div class="status-pills">
                        <button id="mode-toggle" class="pill-btn" title="Current Mode">
                            <span class="pill-icon">🛠️</span>
                            <span class="mode-text">Planning</span>
                        </button>
                        <button id="model-selector" class="pill-btn secondary" title="Current Model">
                            <span id="current-model-name">GLM-4.7 z.ai Coding Plan</span>
                        </button>
                        <button id="agent-selector" class="pill-btn secondary" title="Current Agent">
                            <span id="current-agent-name">General</span>
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
        <div id="agent-dropdown" class="dropdown-menu hidden">
            <div class="model-search-container">
                <input type="text" id="agent-search-input" placeholder="Search agents..." />
            </div>
            <div id="agent-list-container"></div>
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
        setTimeout(() => reject(new Error("Provider list timeout")), 15000),
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
      console.error("Failed to get models:", error);
      // Send empty list to allow UI to proceed
      this.view?.webview.postMessage({
        type: "modelsList",
        models: [],
        selectedModel: this.selectedModel,
      });
    }
    return [];
  }

  /**
   * Handles fetching available agents
   */
  private async handleGetAgents(): Promise<void> {
    const agents = await this.getCLIAgents();

    this.view?.webview.postMessage({
      type: "agentsList",
      agents,
      selectedAgent: this.selectedAgent,
    });
  }

  /**
   * Syncs agents and default agent from CLI
   */
  private async syncCLIAgents(): Promise<void> {
    try {
      // Get default agent first
      const defaultAgent = await this.getCLIDefaultAgent();
      if (defaultAgent) {
        this.selectedAgent = defaultAgent;
        console.log(
          `[ChatViewProvider] Default agent set from CLI: ${this.selectedAgent}`,
        );
      }
    } catch (error) {
      console.error("[ChatViewProvider] Failed to sync CLI agents:", error);
    }
  }

  /**
   * Fetches the default agent from CLI config
   */
  private async getCLIDefaultAgent(): Promise<string> {
    return new Promise((resolve) => {
      cp.exec("opencode debug config", (error, stdout) => {
        if (error) {
          console.error(
            "[ChatViewProvider] Error fetching default agent:",
            error,
          );
          resolve("sisyphus"); // Default fallback
          return;
        }
        try {
          const config = JSON.parse(stdout);
          resolve(config.default_agent || "sisyphus");
        } catch (e) {
          console.error("[ChatViewProvider] Error parsing CLI config:", e);
          resolve("sisyphus");
        }
      });
    });
  }

  /**
   * Fetches the list of available agents from CLI
   */
  private async getCLIAgents(): Promise<
    Array<{ id: string; name: string; description: string }>
  > {
    return new Promise((resolve) => {
      cp.exec("opencode agent list", (error, stdout) => {
        if (error) {
          console.error("[ChatViewProvider] Error fetching agents:", error);
          resolve([
            {
              id: "sisyphus",
              name: "Sisyphus",
              description: "Default OpenCode Agent",
            },
          ]);
          return;
        }

        const lines = stdout.split("\n");
        const agents: Array<{ id: string; name: string; description: string }> =
          [];

        // Always include sisyphus if it's the default but not in list
        const discoveredIds = new Set<string>();

        for (const line of lines) {
          const trimmed = line.trim();
          // Filter for lines that look like agent names (no leading space, not JSON)
          if (
            trimmed &&
            !line.startsWith(" ") &&
            !trimmed.startsWith("[") &&
            !trimmed.startsWith("]") &&
            !trimmed.startsWith("{") &&
            !trimmed.startsWith("}") &&
            !trimmed.includes(":")
          ) {
            const id = trimmed.split(" ")[0];
            if (!discoveredIds.has(id)) {
              agents.push({
                id,
                name: trimmed,
                description: `OpenCode CLI Agent: ${trimmed}`,
              });
              discoveredIds.add(id);
            }
          }
        }

        // Add sisyphus if not present as it's often the default
        if (!discoveredIds.has("sisyphus")) {
          agents.unshift({
            id: "sisyphus",
            name: "Sisyphus (default)",
            description: "Default OpenCode Agent",
          });
        }

        resolve(agents);
      });
    });
  }

  private async handleReviewChanges() {
    try {
      // In VS Code, the standard way to review changes is the Source Control view
      await vscode.commands.executeCommand("workbench.view.scm");
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `Failed to open changes: ${error.message}`,
      );
    }
  }

  private async handleOpenDiff(filePath: string) {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;

      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceFolder.uri.fsPath, filePath);
      const fileUri = vscode.Uri.file(fullPath);

      // In a real scenario, we'd compare against a backup or git state.
      // For now, if we don't have the original, we just open the file.
      // Ideally, we'd have the 'original' URI stored in a session temp folder.

      // Let's try to find if there's a backup (this is speculative but good for the logic)
      // For this implementation, we will use the file itself as both sides OR
      // check if it's a git repo and use the HEAD version.

      try {
        // Try to get HEAD content via git if available
        const gitExtension =
          vscode.extensions.getExtension("vscode.git")?.exports;
        if (gitExtension) {
          const api = gitExtension.getAPI(1);
          const repository = api.repositories[0];
          if (repository) {
            // This is the correct way to show a diff in VS Code for git-tracked files
            await vscode.commands.executeCommand("git.openChange", fileUri);
            return;
          }
        }
      } catch (e) {
        // Fallback to simple open if git fails
      }

      // Default fallback: Just open the file if we can't do a proper diff
      await vscode.commands.executeCommand("vscode.open", fileUri);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open diff: ${error.message}`);
    }
  }
}
