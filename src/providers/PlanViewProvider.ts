import * as vscode from 'vscode';
import * as path from 'path';
import { PlanParser } from '../services/PlanParser';

export class PlanViewProvider {
  public static readonly viewType = 'opencode.planView';
  private static currentPanel: PlanViewProvider | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

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
          case 'alert':
            vscode.window.showErrorMessage(message.text);
            return;
          case 'executeStep':
            vscode.window.showInformationMessage(`Executing step: ${message.step}`);
            // Logic for execution will go here
            return;
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
          vscode.Uri.file(path.join(extensionUri.fsPath, 'node_modules'))
        ]
      }
    );

    PlanViewProvider.currentPanel = new PlanViewProvider(panel, extensionUri, content);
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
    this._panel.title = `Plan: ${plan.goal || 'OpenCode Implementation Plan'}`;
    this._panel.webview.html = this._getHtmlForWebview(webview, plan);
  }

  private _getHtmlForWebview(webview: vscode.Webview, plan: import('../types/Plan').ImplementationPlan) {
    // Local path to main script run in the webview
    const scriptPathOnDisk = vscode.Uri.file(
      path.join(this._extensionUri.fsPath, 'webview', 'plan', 'app.js')
    );
    const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

    // Local path to styles
    const stylesPathOnDisk = vscode.Uri.file(
      path.join(this._extensionUri.fsPath, 'webview', 'plan', 'styles.css')
    );
    const stylesUri = webview.asWebviewUri(stylesPathOnDisk);

    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <link href="${stylesUri}" rel="stylesheet">
    <title>Implementation Plan</title>
</head>
<body>
    <div id="app">
        <header>
            <h1>${plan.goal}</h1>
            <div class="status-badge">In Review</div>
        </header>

        <section class="files-section">
            <h2>Proposed Changes</h2>
            <div id="file-list">
                ${plan.files.map((file) => `
                    <div class="file-item ${file.type.toLowerCase()}">
                        <span class="file-type">${file.type}</span>
                        <span class="file-path">${file.path}</span>
                    </div>
                `).join('')}
            </div>
        </section>

        <section class="steps-section">
            <h2>Task Checklist</h2>
            <div id="step-list">
                ${plan.steps.map((step, index) => `
                    <div class="step-item ${step.completed ? 'completed' : ''}">
                        <input type="checkbox" id="step-${index}" ${step.completed ? 'checked' : ''}>
                        <label for="step-${index}">${step.title}</label>
                    </div>
                `).join('')}
            </div>
        </section>

        <section class="verification-section">
            <h2>Verification Plan</h2>
            <div id="verification-list">
                ${plan.verification.map((v) => `
                    <div class="verification-item ${v.type.toLowerCase()}">
                        <span class="v-type">${v.type}</span>
                        <span class="v-desc">${v.description}</span>
                    </div>
                `).join('')}
            </div>
        </section>

        <footer>
            <button id="approve-btn" class="primary-btn">Approve Plan</button>
            <button id="execute-btn" class="secondary-btn">Start Execution</button>
        </footer>
    </div>

    <script nonce="${nonce}">
        const planData = ${JSON.stringify(plan)};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
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
