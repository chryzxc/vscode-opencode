import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from "child_process";
export interface DiffHunk {
  header: string;
  lines: string[];
}

export interface DiffFile {
  path: string;
  added: number;
  deleted: number;
  type?: 'create' | 'modify' | 'delete';
  hunks: DiffHunk[];
}

export interface DiffComment {
  id: string;
  anchor: {
    startLine: number;
    endLine: number;
    selectedText: string;
    surroundingText?: string;
  };
  text: string;
  createdAt: number;
}

export interface DiffData {
  files: DiffFile[];
  comments?: DiffComment[];
}

export class DiffReviewProvider {
  public static readonly viewType = "opencode.diffReview";
  private static currentPanel: DiffReviewProvider | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    data: DiffData,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtmlForWebview(panel.webview, data);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.visible) {
          this._panel.webview.html = this._getHtmlForWebview(
            this._panel.webview,
            data,
          );
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case "approveDiff": {
            const filePath = message.file;
            const fullPath = path.isAbsolute(filePath)
              ? filePath
              : path.join(
                  vscode.workspace.workspaceFolders?.[0].uri.fsPath || "",
                  filePath,
                );
            const cwd = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            if (cwd) {
              cp.execFile(
                "git",
                ["add", fullPath],
                { cwd },
                (err: Error | null) => {
                  if (err) {
                    vscode.window.showErrorMessage(
                      `Failed to approve (git add) ${filePath}: ${err.message}`,
                    );
                  } else {
                    vscode.window.showInformationMessage(
                      `Approved and staged: ${filePath}`,
                    );
                  }
                },
              );
            }
            return;
          }
          case "rejectDiff": {
            const filePath = message.file;
            const fullPath = path.isAbsolute(filePath)
              ? filePath
              : path.join(
                  vscode.workspace.workspaceFolders?.[0].uri.fsPath || "",
                  filePath,
                );
            const cwd = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            if (cwd) {
              cp.execFile(
                "git",
                ["checkout", "--", fullPath],
                { cwd },
                (err: Error | null) => {
                  if (err) {
                    // Fallback: it might be an untracked file
                    cp.execFile(
                      "git",
                      ["clean", "-f", "--", fullPath],
                      { cwd },
                      (err2: Error | null) => {
                        if (err2) {
                          vscode.window.showErrorMessage(
                            `Failed to reject ${filePath}: ${err.message}`,
                          );
                        } else {
                          vscode.window.showInformationMessage(
                            `Rejected (deleted untracked): ${filePath}`,
                          );
                        }
                      },
                    );
                  } else {
                    vscode.window.showInformationMessage(
                      `Rejected and reverted: ${filePath}`,
                    );
                  }
                },
              );
            }
            return;
          }
          case "addComment":
            this._addComment(message.comment, data);
            return;
          case "updateComment":
            this._updateComment(message.comment, data);
            return;
          case "deleteComment":
            this._deleteComment(message.id, data);
            return;
          case "openFile": {
            const filePath = message.file;
            const fullPath = path.isAbsolute(filePath)
              ? filePath
              : path.join(
                  vscode.workspace.workspaceFolders?.[0].uri.fsPath || "",
                  filePath,
                );
            vscode.commands.executeCommand(
              "vscode.open",
              vscode.Uri.file(fullPath),
            );
            return;
          }
        }
      },
      null,
      this._disposables,
    );
  }

  public static show(extensionUri: vscode.Uri, data: DiffData) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DiffReviewProvider.currentPanel) {
      DiffReviewProvider.currentPanel._panel.reveal(column);
      DiffReviewProvider.currentPanel._panel.webview.html =
        DiffReviewProvider.currentPanel._getHtmlForWebview(
          DiffReviewProvider.currentPanel._panel.webview,
          data,
        );
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DiffReviewProvider.viewType,
      "Diff Review",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(
            path.join(extensionUri.fsPath, "webview", "shared", "dist"),
          ),
        ],
      },
    );

    DiffReviewProvider.currentPanel = new DiffReviewProvider(
      panel,
      extensionUri,
      data,
    );
  }

  public dispose() {
    DiffReviewProvider.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _addComment(comment: DiffComment, data: DiffData) {
    if (!data.comments) data.comments = [];
    data.comments.push(comment);
    this._panel.webview.postMessage({
      type: "commentsUpdated",
      comments: data.comments,
    });
  }

  private _updateComment(comment: DiffComment, data: DiffData) {
    if (!data.comments) return;
    const idx = data.comments.findIndex(
      (c: DiffComment) => c.id === comment.id,
    );
    if (idx !== -1) {
      data.comments[idx] = comment;
      this._panel.webview.postMessage({
        type: "commentsUpdated",
        comments: data.comments,
      });
    }
  }

  private _deleteComment(id: string, data: DiffData) {
    if (!data.comments) return;
    data.comments = data.comments.filter((c: DiffComment) => c.id !== id);
    this._panel.webview.postMessage({
      type: "commentsUpdated",
      comments: data.comments,
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview, data: DiffData) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(
          this._extensionUri.fsPath,
          "webview",
          "shared",
          "dist",
          "diff-review.js",
        ),
      ),
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(
          this._extensionUri.fsPath,
          "webview",
          "shared",
          "dist",
          "chat.css",
        ),
      ),
    );
    const nonce = getNonce();
    const diffDataJson = JSON.stringify(data);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
    <link href="${stylesUri}" rel="stylesheet">
    <title>Diff Review</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}">
        window.__DIFF_DATA__ = ${diffDataJson};
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
