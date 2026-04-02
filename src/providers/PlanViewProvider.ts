import * as vscode from 'vscode';
import * as path from "path";

export class PlanViewProvider {
  public static readonly viewType = 'opencode.planView';
  private static currentPanel: PlanViewProvider | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  // Simple in-memory store for comments keyed by planId with fallback key 'default'
  // Keep comments as a simple local structure to avoid cross-package import issues
  private _commentsByPlan: Map<string, { id: string; anchor: { startLine: number; endLine: number; selectedText: string; surroundingText?: string }; text: string; createdAt: number; resolved?: boolean }[]> = new Map;

  private _currentContent: string;
  private _currentTitle: string;
  private _currentSourceFile?: string;

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    content: string,
    title?: string,
    sourceFile?: string,
  ) {
    this._panel = panel;
    this._context = context;
    this._extensionUri = context.extensionUri;
    this._currentContent = content;
    this._currentTitle = title?.trim() || this.deriveTitle(content) || 'Implementation Plan';
    this._currentSourceFile = sourceFile?.trim() || undefined;

    this.loadComments();

    // Set the webview's initial html content
    this._update(content, title);

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Update the content based on view state changes
    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.visible) {
          this._update(this._currentContent, this._currentTitle);
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
            this.saveComments();
            this._panel.webview.postMessage({ type: 'commentsUpdated', comments: existing });
            return;
          }
          case 'updateComment': {
            const planId = message.planId ?? 'default';
            const existing = this._commentsByPlan.get(planId) ?? [];
            const idx = existing.findIndex((c: any) => c.id === message.comment.id);
            if (idx >= 0) {
              existing[idx] = message.comment;
              this._commentsByPlan.set(planId, existing);
              this.saveComments();
            }
            this._panel.webview.postMessage({ type: 'commentsUpdated', comments: existing });
            return;
          }
          case 'deleteComment': {
            const planId = message.planId ?? 'default';
            const existing = this._commentsByPlan.get(planId) ?? [];
            const next = existing.filter((c: any) => c.id !== message.id);
            this._commentsByPlan.set(planId, next);
            this.saveComments();
            this._panel.webview.postMessage({ type: 'commentsUpdated', comments: next });
            return;
          }
          case 'proceedWithPlan': {
            const payload = {
              rawPlan: message.rawPlan ?? '',
              comments: message.comments ?? [],
              sourceFile:
                typeof message.sourceFile === "string"
                  ? message.sourceFile
                  : this._currentSourceFile,
            };
            if (!payload.rawPlan.trim()) {
              this._panel.webview.postMessage({
                type: 'planProceedStatus',
                ok: false,
                message: 'Cannot proceed because plan content is empty.',
              });
              return;
            }
            this._panel.webview.postMessage({
              type: 'planProceedStatus',
              ok: true,
              stage: 'accepted',
            });
            vscode.commands
              .executeCommand('opencode.planProceed', payload)
              .then(undefined, (err: any) => {
                this._panel.webview.postMessage({
                  type: 'planProceedStatus',
                  ok: false,
                  message:
                    err instanceof Error
                      ? err.message
                      : 'Failed to start plan execution.',
                });
              });
            return;
          }
        }
      },
      null,
      this._disposables
    );
  }

  private loadComments() {
    const saved = this._context.workspaceState.get<{ [planId: string]: any[] }>('opencode.planComments');
    if (saved) {
      for (const [key, val] of Object.entries(saved)) {
        this._commentsByPlan.set(key, val);
      }
    }
  }

  private saveComments() {
    const obj: { [planId: string]: any[] } = {};
    for (const [key, val] of this._commentsByPlan.entries()) {
      obj[key] = val;
    }
    this._context.workspaceState.update('opencode.planComments', obj);
  }

  public static show(
    context: vscode.ExtensionContext,
    payload: string | { content?: string; title?: string; sourceFile?: string },
  ) {
    const content = typeof payload === 'string' ? payload : payload?.content ?? '';
    const title = typeof payload === 'string' ? undefined : payload?.title;
    const sourceFile = typeof payload === 'string' ? undefined : payload?.sourceFile;
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (PlanViewProvider.currentPanel) {
      PlanViewProvider.currentPanel._panel.reveal(column);
      PlanViewProvider.currentPanel._update(content, title, sourceFile);
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      PlanViewProvider.viewType,
      title?.trim() || 'Implementation Plan',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionUri.fsPath, 'webview', 'plan')),
          vscode.Uri.file(path.join(context.extensionUri.fsPath, 'webview', 'shared', 'dist')),
          vscode.Uri.file(path.join(context.extensionUri.fsPath, 'node_modules'))
        ]
      }
    );

    PlanViewProvider.currentPanel = new PlanViewProvider(
      panel,
      context,
      content,
      title,
      sourceFile,
    );
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

  private deriveTitle(content: string): string | undefined {
    const match = content.match(/^#{1,3}\s+(.+)$/m);
    const value = match?.[1]?.trim();
    return value || undefined;
  }

  private _update(content: string, explicitTitle?: string, sourceFile?: string) {
    this._currentContent = content;
    if (sourceFile && sourceFile.trim()) {
      this._currentSourceFile = sourceFile.trim();
    }
    const webview = this._panel.webview;
    this._currentTitle =
      explicitTitle?.trim() || this.deriveTitle(content) || this._currentTitle || 'Implementation Plan';
    this._panel.title = this._currentTitle;
    this._panel.webview.html = this._getHtmlForWebview(webview, content, this._currentTitle);
  }

  private _getHtmlForWebview(webview: vscode.Webview, content: string, title: string) {

    const scriptUri = webview.asWebviewUri(vscode.Uri.file(
      path.join(this._extensionUri.fsPath, 'webview', 'shared', 'dist', 'plan.js')
    ));
    const stylesUri = webview.asWebviewUri(vscode.Uri.file(
      path.join(this._extensionUri.fsPath, 'webview', 'shared', 'dist', 'chat.css')
    ));

    const nonce = getNonce();
    // Inject wrapper payload: raw + parsed + comments + revision
    const planId = this._currentSourceFile || title || "default";
    const planData = {
      raw: content,
      title,
      sourceFile: this._currentSourceFile,
      comments: this._commentsByPlan.get(planId) ?? [],
      revision: 0,
      planId,
    };
    const planDataJson = JSON.stringify(planData);

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
