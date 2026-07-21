import * as vscode from 'vscode';
import * as path from "path";
import {
  CssGenerator,
  FileThemeProcessor,
  type FileThemeProcessorObserver,
  type FileThemeProcessorState,
} from "vscode-file-theme-processor";

export class PlanViewProvider implements FileThemeProcessorObserver {
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
  private readonly _fileThemeProcessor: FileThemeProcessor;
  private readonly _cssGenerator: CssGenerator;
  private _themeCss: string | undefined;

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
    this._fileThemeProcessor = new FileThemeProcessor(context);
    this._cssGenerator = new CssGenerator();
    this._fileThemeProcessor.subscribe(this);
    // The processor can already be ready from its cache before this panel
    // subscribes, so hydrate the current theme synchronously as well.
    this.updateThemeCss();

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
    for (const [key, val] of Array.from(this._commentsByPlan.entries())) {
      obj[key] = val;
    }
    this._context.workspaceState.update('opencode.planComments', obj);
  }

  public static show(
    context: vscode.ExtensionContext,
    payload: string | { content?: string; title?: string; sourceFile?: string },
  ) {
    void this.showResolved(context, payload);
  }

  private static async showResolved(
    context: vscode.ExtensionContext,
    payload: string | { content?: string; title?: string; sourceFile?: string },
  ) {
    const sourceFile = typeof payload === 'string' ? undefined : payload?.sourceFile;
    const content = await this.resolvePlanContent(
      context,
      sourceFile,
      typeof payload === 'string' ? payload : payload?.content ?? '',
    );
    const title = typeof payload === 'string' ? undefined : payload?.title;
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

  private static async resolvePlanContent(
    context: vscode.ExtensionContext,
    sourceFile?: string,
    content: string = "",
  ): Promise<string> {
    const normalizedSourceFile = sourceFile?.trim();
    if (!normalizedSourceFile) {
      return content;
    }

    const candidatePaths = new Set<string>([normalizedSourceFile]);
    if (!path.isAbsolute(normalizedSourceFile)) {
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (folder.uri.scheme !== "file") {
          continue;
        }
        candidatePaths.add(
          path.join(folder.uri.fsPath, normalizedSourceFile),
        );
      }
    }

    for (const candidatePath of candidatePaths) {
      try {
        const fileBytes = await vscode.workspace.fs.readFile(
          vscode.Uri.file(path.normalize(candidatePath)),
        );
        const fileText = Buffer.from(fileBytes).toString("utf-8");
        if (fileText.trim()) {
          return fileText;
        }
      } catch {
        // Try the next candidate path.
      }
    }

    return "";
  }

  public static closeCurrentPanel() {
    PlanViewProvider.currentPanel?._panel.dispose();
  }

  public dispose() {
    PlanViewProvider.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();
    this._fileThemeProcessor.unsubscribe(this);

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  public notify(state: FileThemeProcessorState): void {
    if (state !== "ready") return;

    if (!this.updateThemeCss()) return;

    this._update(this._currentContent, this._currentTitle);
  }

  private updateThemeCss(): boolean {
    const themeData = this._fileThemeProcessor.getThemeData();
    if (!themeData.data || !themeData.themeId) return false;

    const cssData = this._cssGenerator.getCss(
      themeData.data,
      themeData.themeId,
      this._panel.webview,
    );
    this._themeCss = `${cssData.fontFaceCss}\n${cssData.iconCss}`;

    if (themeData.localResourceRoots.length > 0) {
      this._panel.webview.options = {
        ...this._panel.webview.options,
        localResourceRoots: [
          this._extensionUri,
          ...themeData.localResourceRoots.map((root) => vscode.Uri.file(root)),
        ],
      };
    }

    return true;
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
      workspaceRoot: this.getWorkspaceRootForSourceFile(this._currentSourceFile),
      comments: this._commentsByPlan.get(planId) ?? [],
      revision: 0,
      planId,
    };
    const planDataJson = JSON.stringify(planData);
    const themeCssBlock = this._themeCss
      ? `<style id="vscode-theme-icons">${this._themeCss}</style>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
    <link href="${stylesUri}" rel="stylesheet">
    ${themeCssBlock}
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

  private getWorkspaceRootForSourceFile(sourceFile?: string): string | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) return undefined;

    const normalizedSource = sourceFile ? path.normalize(sourceFile) : undefined;
    const matchingFolder = normalizedSource
      ? folders.find((folder) => {
          if (folder.uri.scheme !== "file") return false;
          const root = path.normalize(folder.uri.fsPath);
          return normalizedSource === root || normalizedSource.startsWith(`${root}${path.sep}`);
        })
      : undefined;

    return (matchingFolder ?? folders[0]).uri.fsPath;
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
