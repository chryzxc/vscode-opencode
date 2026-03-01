import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PlanParser } from '../services/PlanParser';

export class PlanViewProvider {
  public static readonly viewType = 'opencode.planView';
  private static currentPanel: PlanViewProvider | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  // Simple in-memory store for comments keyed by planId (fallback key 'default')
  // Keep comments as a simple local structure to avoid cross-package import issues
  private _commentsByPlan: Map<string, { id: string; anchor: { startLine: number; endLine: number; selectedText: string }; text: string; createdAt: number; }[]> = new Map();

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, content: string) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set the webview's initial html content
    this._update(content);

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Update the content based on view state changes
    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.visible) {
          this._update(content);
        }
      },
      null,
      this._disposables
    );

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.type) {
          case "alert":
            vscode.window.showErrorMessage(message.text);
            return;
          case "executeStep":
            vscode.window.showInformationMessage(
              `Executing step: ${message.step}`,
            );
            // Logic for execution will go here
            return;
          case "executePlan":
            // Forward execution request to the ChatViewProvider
            vscode.commands.executeCommand(
              "opencode.executePlan",
              message.plan,
            );
            this._panel.dispose(); // Close plan view after starting execution
            return;
          case 'addComment': {
            const planId = message.planId ?? 'default';
            const existing = this._commentsByPlan.get(planId) ?? [];
            existing.push(message.comment);
            this._commentsByPlan.set(planId, existing);
            this._panel.webview.postMessage({ type: 'commentsUpdated', comments: existing });
            return;
          }
          case 'updateComment': {
            const planId = message.planId ?? 'default';
            const existing = this._commentsByPlan.get(planId) ?? [];
            const idx = existing.findIndex(c => c.id === message.comment.id);
            if (idx >= 0) {
              existing[idx] = message.comment;
              this._commentsByPlan.set(planId, existing);
            }
            this._panel.webview.postMessage({ type: 'commentsUpdated', comments: existing });
            return;
          }
          case 'deleteComment': {
            const planId = message.planId ?? 'default';
            const existing = this._commentsByPlan.get(planId) ?? [];
            const next = existing.filter(c => c.id !== message.id);
            this._commentsByPlan.set(planId, next);
            this._panel.webview.postMessage({ type: 'commentsUpdated', comments: next });
            return;
          }
          case 'proceedWithPlan': {
            const payload = {
              rawPlan: message.rawPlan ?? '',
              comments: message.comments ?? [],
            };
            vscode.commands.executeCommand('opencode.planProceed', payload);
            return;
          }
        }
      },
      null,
      this._disposables
    );
  }

  public static show(extensionUri: vscode.Uri, content: string) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (PlanViewProvider.currentPanel) {
      PlanViewProvider.currentPanel._panel.reveal(column);
      PlanViewProvider.currentPanel._update(content);
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      PlanViewProvider.viewType,
      'Implementation Plan',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(extensionUri.fsPath, 'webview', 'plan')),
          vscode.Uri.file(path.join(extensionUri.fsPath, 'webview', 'shared', 'dist')),
          vscode.Uri.file(path.join(extensionUri.fsPath, 'node_modules'))
        ]
      }
    );

    PlanViewProvider.currentPanel = new PlanViewProvider(panel, extensionUri, content);
  }

  public static closeCurrentPanel() {
    PlanViewProvider.currentPanel?._panel.dispose();
  }

  public dispose() {
    PlanViewProvider.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update(content: string) {
    const webview = this._panel.webview;
    const plan = PlanParser.parse(content);
    console.log("Parsed Plan:", JSON.stringify(plan, null, 2));
    this._panel.title = `Plan: ${plan.goal || 'OpenCode Implementation Plan'}`;
    this._panel.webview.html = this._getHtmlForWebview(webview, plan);
  }

  private _getHtmlForWebview(webview: vscode.Webview, plan: import('../types/Plan').ImplementationPlan) {

    const scriptUri = webview.asWebviewUri(vscode.Uri.file(
      path.join(this._extensionUri.fsPath, 'webview', 'shared', 'dist', 'plan.js')
    ));
    const stylesUri = webview.asWebviewUri(vscode.Uri.file(
      path.join(this._extensionUri.fsPath, 'webview', 'shared', 'dist', 'chat.css')
    ));

    const nonce = getNonce();
    // Inject wrapper payload: raw + parsed + comments + revision
    const planId = plan.goal || "default";
    const planData = {
      raw: plan.rawContent ?? "",
      parsed: plan,
      comments: this._commentsByPlan.get(planId) ?? [],
      revision: 0,
    };
    const planDataJson = JSON.stringify(planData);

    // Badge chunk is extracted by Vite — only include it if the file actually exists on disk
    const badgeChunkPath = path.join(this._extensionUri.fsPath, 'webview', 'shared', 'dist', 'badge.js');
    const badgeChunkTag = fs.existsSync(badgeChunkPath)
      ? `<script type="module" nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.file(badgeChunkPath))}"></script>`
      : "<!-- badge.js not found, skipped -->";

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
    <link href="${stylesUri}" rel="stylesheet">
    <title>Implementation Plan</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}">
        window.__PLAN_DATA__ = ${planDataJson};
    </script>
    ${badgeChunkTag}
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(possible.length * Math.random()));
  }
  return text;
}
