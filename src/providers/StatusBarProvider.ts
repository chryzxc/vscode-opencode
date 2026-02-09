/**
 * Status Bar Provider - VSCode Status Bar Integration
 *
 * Manages the OpenCode status indicator in VSCode's status bar.
 * Shows connection status and provides quick access to the chat view.
 *
 * **Status Display:**
 * - Connected: "$(robot) OpenCode" icon with port in tooltip
 * - Disconnected: "$(debug-disconnect) OpenCode" icon
 * - Position: Right side of status bar
 * - Priority: 100 (lower priority = more left)
 *
 * **Interaction:**
 * - Clicking the status item executes `opencode.focus` command
 * - This opens and focuses the chat view in the sidebar
 *
 * **Update Strategy:**
 * The status bar should be updated when:
 * - Server status changes (starting → running → error)
 * - Port number changes
 * - Connection is lost/established
 *
 * @module StatusBarProvider
 * @see OpencodeServerManager for server status events
 * @see extension.ts for provider initialization
 */

import * as vscode from 'vscode';
import { OpencodeServerManager } from '../services/OpencodeServerManager';

/**
 * Manages the OpenCode status bar item.
 *
 * This provider creates and updates a status bar item that shows
 * the OpenCode server connection status.
 *
 * **Usage:**
 * ```typescript
 * const provider = new StatusBarProvider(serverManager);
 *
 * // Later: Update when status changes
 * serverManager.onStatusChange(() => {
 *   provider.updateStatus();
 * });
 *
 * // On deactivation: Dispose
 * provider.dispose();
 * ```
 *
 * **Status Bar Item Configuration:**
 * - Alignment: Right (left side of right section)
 * - Priority: 100 (higher numbers = more left)
 * - Command: opencode.focus (click to open chat)
 *
 * **Icons Used:**
 * - `$(robot)`: Robot icon for connected state
 * - `$(debug-disconnect)`: Disconnect icon for disconnected state
 */
export class StatusBarProvider {
  /** The VSCode status bar item instance */
  private statusBarItem: vscode.StatusBarItem;

  /**
   * Creates a new status bar provider.
   *
   * **Initialization:**
   * - Creates status bar item on right side with priority 100
   * - Sets click command to `opencode.focus`
   * - Updates status to reflect current server state
   * - Shows the status item immediately
   *
   * **Automatic Updates:**
   * Constructor does NOT subscribe to status changes automatically.
   * The caller should listen to `serverManager.onStatusChange` and
   * call `updateStatus()` when status changes.
   *
   * **Usage Pattern:**
   * ```typescript
   * const provider = new StatusBarProvider(serverManager);
   *
   * // Subscribe to status changes
   * serverManager.onStatusChange(() => {
   *   provider.updateStatus();
   * });
   * ```
   *
   * @param serverManager - Server manager for status and port information
   */
  constructor(private serverManager: OpencodeServerManager) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );

    // Click to focus chat view
    this.statusBarItem.command = "opencode.focus";

    // Set initial status
    this.updateStatus();

    // Show the status item
    this.statusBarItem.show();
  }

  /**
   * Updates the status bar item to reflect current server state.
   *
   * **Display Logic:**
   * - If client exists (server running): Show connected icon + port in tooltip
   * - If no client (server not running): Show disconnected icon
   *
   * **Connected State:**
   * - Text: "$(robot) OpenCode"
   * - Tooltip: "OpenCode connected (Port: XXXX)"
   *
   * **Disconnected State:**
   * - Text: "$(debug-disconnect) OpenCode"
   * - Tooltip: "OpenCode disconnected"
   *
   * **When to Call:**
   * - After construction (called automatically)
   * - When server status changes
   * - When port changes
   * - After connection/reconnection events
   *
   * **Integration:**
   * ```typescript
   * serverManager.onStatusChange(() => {
   *   statusBarProvider.updateStatus();
   * });
   * ```
   *
   * @see OpencodeServerManager.onStatusChange for status change events
   */
  updateStatus(): void {
    const client = this.serverManager.getClient();

    if (client) {
      // Server is connected
      this.statusBarItem.text = `$(robot) OpenCode`;
      this.statusBarItem.tooltip = `OpenCode connected (Port: ${this.serverManager.getPort()})`;
    } else {
      // Server is disconnected
      this.statusBarItem.text = "$(debug-disconnect) OpenCode";
      this.statusBarItem.tooltip = "OpenCode disconnected";
    }
  }

  /**
   * Disposes of the status bar provider.
   *
   * **Cleanup Actions:**
   * - Disposes the status bar item
   * - Removes it from VSCode's status bar
   *
   * **When to Call:**
   * - During extension deactivation
   * - When the provider is no longer needed
   *
   * **Note:**
   * After disposal, the status item will disappear from the status bar.
   * Create a new instance to restore it.
   */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}
