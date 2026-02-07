import * as vscode from 'vscode';
import { OpencodeServerManager } from '../services/OpencodeServerManager';

export class StatusBarProvider {
  private statusBarItem: vscode.StatusBarItem;

  constructor(private serverManager: OpencodeServerManager) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    
    this.statusBarItem.command = 'opencode.focus';
    this.updateStatus();
    this.statusBarItem.show();
  }

  updateStatus(mode?: 'plan' | 'build'): void {
    const client = this.serverManager.getClient();
    
    if (client) {
      const modeIcon = mode === 'plan' ? '$(notebook)' : '$(code)';
      const modeText = mode ? ` ${mode.toUpperCase()}` : '';
      this.statusBarItem.text = `$(robot) OpenCode${modeText}`;
      this.statusBarItem.tooltip = `OpenCode connected (Port: ${this.serverManager.getPort()})`;
    } else {
      this.statusBarItem.text = '$(debug-disconnect) OpenCode';
      this.statusBarItem.tooltip = 'OpenCode disconnected';
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
