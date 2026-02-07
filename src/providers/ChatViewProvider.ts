import * as vscode from 'vscode';
import { OpencodeServerManager } from '../services/OpencodeServerManager';
import { SessionService } from '../services/SessionService';
import { MessageStreamService } from '../services/MessageStreamService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private streamService: MessageStreamService;
  private unsubscribe?: () => void;
  private selectedModel: { providerID: string; modelID: string } = { providerID: 'opencode', modelID: 'big-pickle' };

  constructor(
    private context: vscode.ExtensionContext,
    private serverManager: OpencodeServerManager,
    private sessionService: SessionService
  ) {
    this.streamService = new MessageStreamService(serverManager);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
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
        type: 'streamEvent',
        event,
      });
    });

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'ready':
          // Send initial state
          this.view?.webview.postMessage({
            type: 'initState',
            mode: this.sessionService.getMode(),
            serverStatus: this.serverManager.getStatus(),
            selectedModel: this.selectedModel,
          });
          this.refreshView();
          await this.handleGetModels();
          break;
        case 'sendMessage':
          await this.handleSendMessage(message.text, message.files);
          break;
        case 'toggleMode':
          await this.handleToggleMode();
          break;
        case 'newSession':
          await this.sessionService.createNewSession();
          this.refreshView();
          break;
        case 'viewPlan': // Handle view implementation plan request
          await this.handleViewPlan(message.content);
          break;
        case 'searchFiles':
          await this.handleSearchFiles(message.query);
          break;
        case 'selectModel':
          this.selectedModel = message.model;
          break;
        case 'getModels':
          await this.handleGetModels();
          break;
      }
    });

    // Subscribe to status changes
    const statusSubscription = this.serverManager.onStatusChange((status) => {
      this.view?.webview.postMessage({
        type: 'statusUpdate',
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
  private async handleSendMessage(text: string, files?: string[]): Promise<void> {
    try {
      const client = await this.serverManager.ensureRunning();
      const session = await this.sessionService.getCurrentSession();

      console.log(`Sending message to session ${session.id}:`, text, files);

      // Prepare message parts
      const parts: Array<{ type: 'text' | 'file'; [key: string]: unknown }> = [
        {
          type: 'text',
          text: text,
        },
      ];

      // Add file references if any
      if (files && files.length > 0) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
          for (const filePath of files) {
            try {
              const absoluteUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
              const content = await vscode.workspace.fs.readFile(absoluteUri);
              const textContent = new TextDecoder().decode(content);
              
              parts.push({
                type: 'file',
                mime: 'text/plain',
                filename: filePath.split(/[\\/]/).pop(),
                url: `file://${filePath}`,
                source: {
                  type: 'file',
                  path: filePath,
                  text: {
                    value: textContent,
                    start: 0,
                    end: textContent.length
                  }
                }
              });
            } catch (e) {
              console.error(`Failed to read file ${filePath}:`, e);
            }
          }
        }
      }

      // Send the message using the SDK
      const response = await client.session.prompt({
        path: { id: session.id },
        body: {
          model: this.selectedModel,
          parts: parts,
        },
      });

      console.log('Received response:', response);

      // Check for errors in the response
      if (response.error) {
        const errorDetails = JSON.stringify(response.error, null, 2);
        console.error('OpenCode API error:', errorDetails);
        
        let errorMessage = Array.isArray(response.error.error) && response.error.error.length > 0
          ? response.error.error[0].message || 'Unknown error'
          : 'Failed to send message';
        
        // Handle specific model not found error
        if (errorMessage.includes('ProviderModelNotFoundError') || errorMessage.includes('ModelNotFoundError')) {
          errorMessage += '\n\nTIP: Try starting a new session (click +) to use the default model.';
        }
        
        vscode.window.showErrorMessage(`OpenCode error: ${errorMessage}`);
        this.view?.webview.postMessage({
          type: 'error',
          message: errorMessage,
        });
        return;
      }

      // Send response back to webview
      if (response.data) {
        this.view?.webview.postMessage({
          type: 'messageResponse',
          message: response.data,
        });
      } else {
        console.warn('No response data received from OpenCode');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to send message: ${errorMessage}`);
      console.error('Send message error:', error);
      
      // Show error in webview too
      this.view?.webview.postMessage({
        type: 'error',
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
      type: 'modeChanged',
      mode: newMode,
    });

    vscode.window.showInformationMessage(`Switched to ${newMode.toUpperCase()} mode`);
  }

  /**
   * Appends text to the prompt input
   */
  async appendToPrompt(text: string): Promise<void> {
    this.view?.webview.postMessage({
      type: 'appendPrompt',
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
    await vscode.commands.executeCommand('opencode.showPlan', content);
  }

  /**
   * Handles opening the file picker
   */
  private async handleAttachFiles(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach to Chat',
      filters: {
        'All Files': ['*']
      }
    });

    if (uris && uris.length > 0) {
      // Convert URIs to relative paths or absolute paths for selection
      // For now, let's just send back the absolute paths as this is what the extension uses
      const files = uris.map(u => u.fsPath);
      
      // We need a message type to receive these in the webview
      this.view?.webview.postMessage({
        type: 'filesAttached',
        files
      });
    }
  }

  /**
   * Handles opening settings
   */
  private async handleOpenSettings(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:OpenCode.opencode-vscode');
  }

  /**
   * Refreshes the view with current state
   */
  private refreshView(): void {
    const mode = this.sessionService.getMode();
    
    this.view?.webview.postMessage({
      type: 'init',
      mode,
    });
  }

  /**
   * Generates the HTML content for the webview
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'chat', 'styles.css')
    );
    const highlightCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'chat', 'lib', 'highlight.css')
    );
    const vendorScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'chat', 'lib', 'vendor.js')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'chat', 'app.js')
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
    <div class="chat-header">
      <div class="header-left">
        <button id="model-selector" class="dropdown-button" title="Switch AI Model">
          <span id="current-model">OpenCode / big-pickle</span> <span>▼</span>
        </button>
        <div id="model-dropdown" class="model-dropdown hidden">
          <!-- Models will be populated here -->
        </div>
      </div>
      <div class="header-right">
        <button id="mode-toggle" class="mode-toggle" title="Toggle Plan/Build Mode">
          <span class="mode-text">BUILD 🛠️</span>
        </button>
        <button id="new-session" class="icon-button" title="New Session">
          <span>+</span>
        </button>
      </div>
    </div>

    <div id="messages" class="messages">
      <div id="empty-state" class="empty-state">
        <div class="empty-state-logo">
          <span>✴️</span> OpenCode
        </div>
        <div class="empty-state-icon">
          👾
        </div>
        <p class="empty-state-hint">
          Use OpenCode in the terminal to configure MCP servers.<br>
          They'll work here, too!
        </p>
      </div>
    </div>

    <div class="input-wrapper">
      <div class="input-container">
        <textarea 
          id="message-input" 
          placeholder="ctrl esc to focus or unfocus OpenCode"
          rows="1"
        ></textarea>
        <div class="input-actions">
          <div class="left-actions">
            <!-- Placeholders for future features -->
            <button class="action-icon" title="Attachments">📎</button>
            <button class="action-icon" title="Settings">⚙️</button>
          </div>
          <div class="right-actions">
            <button id="send-button" class="send-button" title="Send (Shift+Enter)">
              ➤
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

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
      this.view?.webview.postMessage({ type: 'fileSearchResults', results: [] });
      return;
    }

    try {
      // Simple file search using VS Code API
      // Limit to 20 results for performance
      const files = await vscode.workspace.findFiles(`**/*${query}*`, '**/node_modules/**', 20);
      const results = files.map(f => {
        const relativePath = vscode.workspace.asRelativePath(f);
        return {
          path: relativePath,
          name: relativePath.split(/[\\/]/).pop() || relativePath
        };
      });

      this.view?.webview.postMessage({
        type: 'fileSearchResults',
        results: results
      });
    } catch (error) {
      this.view?.webview.postMessage({ type: 'fileSearchResults', results: [] });
    }
  }

  /**
   * Handles fetching available models from OpenCode
   */
  private async handleGetModels() {
    try {
      const client = await this.serverManager.ensureRunning();
      const response = await client.config.get();
      
      if (response.data && response.data.provider) {
        const models: Array<{ providerID: string; modelID: string; name: string; providerName: string }> = [];
        
        const providerData = response.data.provider as Record<string, { name?: string, models?: Record<string, { name?: string }> }>;
        for (const [providerID, providerConfig] of Object.entries(providerData)) {
          if (providerConfig.models) {
            for (const [modelID, modelConfig] of Object.entries(providerConfig.models)) {
              models.push({
                providerID,
                modelID,
                name: modelConfig.name || modelID,
                providerName: providerConfig.name || providerID
              });
            }
          }
        }
        
        this.view?.webview.postMessage({
          type: 'modelsList',
          models,
          selectedModel: this.selectedModel
        });
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  }
}
