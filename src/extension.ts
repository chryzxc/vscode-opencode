/**
 * VSCode OpenCode Extension - Main Entry Point
 *
 * This extension provides AI-powered coding assistance with implementation planning capabilities.
 * It integrates with the OpenCode CLI server to provide chat-based code assistance, session
 * management, and interactive implementation plan execution.
 *
 * **Architecture Overview:**
 * - Extension Layer (this file): Command registration and lifecycle management
 * - Service Layer: Server management, session persistence, message streaming
 * - Provider Layer: WebView UI components for chat, plans, and status display
 *
 * **Initialization Order:**
 * 1. OpencodeServerManager - Starts/manages the OpenCode CLI server process
 * 2. SessionService - Handles session persistence and state synchronization
 * 3. StatusBarProvider - Shows connection status in VSCode status bar
 * 4. ChatViewProvider - Main chat interface webview
 *
 * **Command Registration Pattern:**
 * All commands are registered via context.subscriptions.push() to ensure proper cleanup
 * on extension deactivation. Commands follow the pattern: opencode.<commandName>
 *
 * @module extension
 * @see README.md for extension usage documentation
 */

import * as vscode from "vscode";
import { OpencodeServerManager } from "./services/OpencodeServerManager";
import { SessionService } from "./services/SessionService";
import { ChatViewProvider } from "./providers/ChatViewProvider";
import { StatusBarProvider } from "./providers/StatusBarProvider";
import { PlanViewProvider } from "./providers/PlanViewProvider";

/**
 * Global service instances.
 *
 * These are module-level variables to allow command handlers to access services.
 * Services are initialized during activation and disposed during deactivation.
 *
 * @see activate for initialization logic
 * @see deactivate for cleanup logic
 */
let serverManager: OpencodeServerManager;
let sessionService: SessionService;
let chatViewProvider: ChatViewProvider;
let statusBarProvider: StatusBarProvider;

/**
 * Activates the OpenCode VSCode extension.
 *
 * This is the main entry point called by VSCode when the extension is activated.
 * It initializes all core services, registers commands, and sets up the UI.
 *
 * **Service Initialization Order (Important - Services have dependencies):**
 * 1. OpencodeServerManager - Must be first (starts server, other services depend on it)
 * 2. SessionService - Depends on OpencodeServerManager for server client
 * 3. StatusBarProvider - Depends on OpencodeServerManager for status events
 * 4. ChatViewProvider - Depends on both OpencodeServerManager and SessionService
 *
 * **Error Handling Strategy:**
 * - Logs activation failures to console for debugging
 * - Shows user-facing error message via VSCode API
 * - Does not throw; ensures extension degrades gracefully
 * - Extension remains partially functional if some services fail
 *
 * **Command Registration:**
 * All commands are registered with context.subscriptions to ensure proper
 * cleanup on deactivation. Each command handler is documented with its own
 * block comment explaining its purpose and behavior.
 *
 * **Configuration:**
 * Respects the following VSCode settings:
 * - `opencode.serverPort`: Port number for server connection (0 = auto-detect)
 * - `opencode.autoStart`: Whether to start server on activation (default: true)
 *
 * @param context - VSCode extension context providing subscriptions, storage, and URIs
 * @returns Promise that resolves when activation completes or rejects on critical failure
 *
 * @example
 * ```typescript
 * // Called automatically by VSCode extension host
 * await activate(context);
 * // Extension is now ready to handle user interactions
 * ```
 *
 * @see OpencodeServerManager for server lifecycle management
 * @see SessionService for session persistence strategy
 * @see ChatViewProvider for webview communication protocol
 *
 * @extensionGuide ADDING A NEW COMMAND
 * To add a new command:
 * 1. Add command to package.json contributes.commands section
 * 2. Register in this activate() function using context.subscriptions.push()
 * 3. Implement async handler function
 * 4. Update README.md with command description
 * 5. Add keyboard shortcut in package.json keybindings if needed
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log(
    `OpenCode extension activating... [Version: ${context.extension.packageJSON.version}]`,
  );

  try {
    // ============================================================================
    // PHASE 1: Initialize Core Services
    // ============================================================================
    // Services are initialized in dependency order. Each service receives the
    // context for VSCode API access and any services it depends on.

    serverManager = new OpencodeServerManager(context);
    sessionService = new SessionService(context, serverManager);
    statusBarProvider = new StatusBarProvider(serverManager);

    // ============================================================================
    // PHASE 2: Register WebView Providers
    // ============================================================================
    // WebView providers provide the UI for the extension. They must be registered
    // with VSCode before commands that use them can be invoked.

    chatViewProvider = new ChatViewProvider(
      context,
      serverManager,
      sessionService,
    );
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        "opencode.chatView",
        chatViewProvider,
      ),
    );

    // ============================================================================
    // PHASE 3: Register Commands
    // ============================================================================
    // Commands are registered with context.subscriptions for automatic cleanup.
    // Each command handler is documented below with its purpose and behavior.

    // ============================================================================
    // COMMAND: opencode.focus
    // ============================================================================
    // Purpose: Focus the chat view in the sidebar
    // Parameters: None
    // Side Effects: Opens the sidebar and focuses the chat interface
    // Error Handling: None (delegates to VSCode command execution)
    // Keyboard Shortcut: None by default (can be configured in keybindings)
    // ============================================================================
    context.subscriptions.push(
      vscode.commands.registerCommand("opencode.focus", async () => {
        await vscode.commands.executeCommand("opencode.chatView.focus");
      }),
    );

    // ============================================================================
    // COMMAND: opencode.newSession
    // ============================================================================
    // Purpose: Create a new chat session and switch to it
    // Parameters: None
    // Side Effects:
    //   - Creates new session via SessionService
    //   - Switches chat view to new session
    //   - Focuses the chat view
    // Error Handling:
    //   - SessionService handles creation errors
    //   - User sees error if creation fails
    // Usage: Called from keyboard shortcut, command palette, or UI
    // ============================================================================
    context.subscriptions.push(
      vscode.commands.registerCommand("opencode.newSession", async () => {
        await sessionService.createNewSession();
        await vscode.commands.executeCommand("opencode.chatView.focus");
      }),
    );

    // ============================================================================
    // COMMAND: opencode.sendSelection
    // ============================================================================
    // Purpose: Send selected code (or current line) to chat as context
    // Parameters: None (extracted from active text editor)
    // Side Effects:
    //   - Opens chat view
    //   - Adds file context with selection to current session
    //   - Focuses chat input
    // Behavior:
    //   - If text is selected: Sends the selection
    //   - If no selection: Sends the current line
    //   - Includes file path and line numbers
    //   - Detects language for syntax highlighting
    // Error Handling:
    //   - Shows warning if no active editor
    //   - Shows warning if selection is empty
    // Usage: Right-click context menu, command palette, or keyboard shortcut
    // Integration: Adds context via ChatViewProvider.addContext()
    // ============================================================================
    context.subscriptions.push(
      vscode.commands.registerCommand("opencode.sendSelection", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage("No active editor");
          return;
        }

        let selection = editor.document.getText(editor.selection);
        if (!selection) {
          // If no selection, get the current line
          const position = editor.selection.active;
          const line = editor.document.lineAt(position.line);
          selection = line.text;
        }

        if (!selection || selection.trim().length === 0) {
          vscode.window.showWarningMessage("No text to send");
          return;
        }

        const fileName = vscode.workspace.asRelativePath(editor.document.uri);
        const startLine = editor.selection.start.line + 1;
        const endLine = editor.selection.end.line + 1;
        const lineInfo =
          startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;

        await chatViewProvider.addContext({
          file: fileName,
          lineInfo: lineInfo,
          content: selection,
          languageId: editor.document.languageId,
        });
        await vscode.commands.executeCommand("opencode.chatView.focus");
      }),
    );

    // ============================================================================
    // COMMAND: opencode.insertFileReference
    // ============================================================================
    // Purpose: Insert a file reference at cursor position (not yet implemented)
    // Parameters: None
    // Side Effects: None currently (shows info message)
    // Status: PLANNED - Will open file picker with fuzzy search
    // TODO: Implement fuzzy file search picker dialog
    // Extension Point: To implement, create QuickPick with workspace files
    // ============================================================================
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "opencode.insertFileReference",
        async () => {
          // TODO: Implement file picker with fuzzy search
          // 1. Get all workspace files
          // 2. Show QuickPick with fuzzy filtering
          // 3. Insert selected file path at active cursor position
          vscode.window.showInformationMessage(
            "File reference picker coming soon!",
          );
        },
      ),
    );

    // ============================================================================
    // COMMAND: opencode.showPlan
    // ============================================================================
    // Purpose: Display an implementation plan in a dedicated webview panel
    // Parameters:
    //   - content: string - The markdown content of the plan to display
    // Side Effects:
    //   - Opens new webview panel with plan content
    //   - Renders plan with interactive checkboxes for steps
    //   - Provides "Proceed to Implementation" button
    // Usage: Called from plan detection in ChatViewProvider or manually
    // Integration: Uses PlanViewProvider.show() for rendering
    // ============================================================================
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "opencode.showPlan",
        async (content: string) => {
          PlanViewProvider.show(context.extensionUri, content);
        },
      ),
    );

    // ============================================================================
    // COMMAND: opencode.executePlan
    // ============================================================================
    // Purpose: Execute an implementation plan by sending it to the AI
    // Parameters:
    //   - planContent: string - The markdown content of the plan to execute
    // Side Effects:
    //   - Populates chat input with implementation request
    //   - Focuses chat view for user to send
    //   - Does NOT auto-send (requires user confirmation)
    // Usage: Called from PlanViewProvider "Proceed to Implementation" button
    // Flow:
    //   1. PlanViewProvider sends plan content
    //   2. Command creates prompt asking AI to implement
    //   3. Prompt is added to chat input (not auto-sent)
    //   4. User reviews and sends manually
    // Error Handling: Shows error if chat view unavailable
    // TODO: Consider adding auto-send option with user preference
    // ============================================================================
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "opencode.executePlan",
        async (planContent: string) => {
          // Find the active chat view and send a message
          if (chatViewProvider) {
            // Send a message to the chat view effectively asking the AI to implement the plan
            const prompt = `Please implement the following plan:\n\n${planContent}`;
            await chatViewProvider.appendToPrompt(prompt);
            await vscode.commands.executeCommand("opencode.chatView.focus");

            // Optionally auto-send? For now, let's just populate the input
            // Future: Add user preference for auto-send behavior
            // await chatViewProvider.handleMessage({ type: 'sendMessage', text: prompt });
          } else {
            vscode.window.showErrorMessage("Chat view is not available.");
          }
        },
      ),
    );

    // ============================================================================
    // PHASE 4: Auto-Start Server (Optional)
    // ============================================================================
    // If configured, start the OpenCode server automatically. This allows the
    // extension to be ready for use immediately without requiring the user to
    // manually start the server.

    const config = vscode.workspace.getConfiguration("opencode");
    if (config.get("autoStart", true)) {
      await serverManager.ensureRunning();
    }

    console.log("OpenCode extension activated successfully");
  } catch (error) {
    // Activation failed - log and notify user but don't crash
    console.error("Failed to activate OpenCode extension:", error);
    vscode.window.showErrorMessage(`OpenCode activation failed: ${error}`);
  }
}

/**
 * Deactivates the OpenCode extension.
 *
 * This function is called by VSCode when the extension is deactivated, which
 * occurs when:
 * - VSCode is shutting down
 * - The extension is disabled or uninstalled
 * - The extension host is being reloaded
 *
 * **Cleanup Strategy:**
 * - Disposes of the server manager (stops server process if auto-started)
 * - Disposes of status bar provider (removes status indicators)
 * - Other disposables are handled via context.subscriptions
 *
 * **What Gets Cleaned Up:**
 * 1. OpencodeServerManager: Stops server process, closes connections
 * 2. StatusBarProvider: Removes status bar items
 * 3. WebView providers: Automatically cleaned up by VSCode via subscriptions
 * 4. Commands: Automatically unregistered by VSCode via subscriptions
 *
 * **What Gets Preserved:**
 * - Session history: Stored in VSCode globalState (persists across restarts)
 * - User settings: Stored in VSCode settings
 * - Implementation plans: Saved as workspace files
 *
 * **Graceful Degradation:**
 * This function does not throw errors. Cleanup failures are logged but do not
 * prevent VSCode from shutting down cleanly.
 *
 * @see activate for the corresponding initialization function
 * @see OpencodeServerManager.dispose for server cleanup details
 */
export function deactivate() {
  console.log("OpenCode extension deactivating...");

  // Clean up server manager - stops server process and closes connections
  if (serverManager) {
    serverManager.dispose();
  }

  // Clean up status bar provider - removes status bar items
  if (statusBarProvider) {
    statusBarProvider.dispose();
  }

  // Note: WebView providers and commands are automatically cleaned up by VSCode
  // through context.subscriptions, so we don't need to dispose them manually.

  console.log("OpenCode extension deactivated");
}
