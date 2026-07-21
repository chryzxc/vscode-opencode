import * as path from "path";
import * as vscode from "vscode";
import {
  CssGenerator,
  FileThemeProcessor,
  type FileThemeProcessorObserver,
  type FileThemeProcessorState,
} from "vscode-file-theme-processor";

export interface WalkthroughViewPayload {
  content?: string;
  title?: string;
  sourceFile?: string;
}

/** Read-only viewer for a completed-work walkthrough artifact. */
export class WalkthroughViewProvider implements FileThemeProcessorObserver {
  static readonly viewType = "opencode.walkthroughView";
  private static currentPanel: WalkthroughViewProvider | undefined;
  private readonly fileThemeProcessor: FileThemeProcessor;
  private readonly cssGenerator: CssGenerator;
  private themeCss: string | undefined;
  private currentContent = "";
  private currentTitle = "Walkthrough";
  private currentSourceFile: string | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.fileThemeProcessor = new FileThemeProcessor(context);
    this.cssGenerator = new CssGenerator();
    this.fileThemeProcessor.subscribe(this);
    this.updateThemeCss();
    panel.onDidDispose(() => {
      this.fileThemeProcessor.unsubscribe(this);
      WalkthroughViewProvider.currentPanel = undefined;
    });
  }

  public notify(state: FileThemeProcessorState): void {
    if (state !== "ready" || !this.updateThemeCss()) return;
    this.update(this.currentContent, this.currentTitle, this.currentSourceFile);
  }

  private updateThemeCss(): boolean {
    const themeData = this.fileThemeProcessor.getThemeData();
    if (!themeData.data || !themeData.themeId) return false;
    const cssData = this.cssGenerator.getCss(themeData.data, themeData.themeId, this.panel.webview);
    this.themeCss = `${cssData.fontFaceCss}\n${cssData.iconCss}`;
    if (themeData.localResourceRoots.length > 0) {
      this.panel.webview.options = {
        ...this.panel.webview.options,
        localResourceRoots: [
          this.context.extensionUri,
          ...themeData.localResourceRoots.map((root) => vscode.Uri.file(root)),
        ],
      };
    }
    return true;
  }

  static async show(
    context: vscode.ExtensionContext,
    payload: WalkthroughViewPayload,
  ): Promise<void> {
    const content = await this.resolveContent(payload.sourceFile, payload.content);
    if (!content) {
      void vscode.window.showErrorMessage("Could not read walkthrough artifact.");
      return;
    }
    const title = payload.title?.trim() || this.deriveTitle(content) || "Walkthrough";
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (this.currentPanel) {
      this.currentPanel.panel.reveal(column);
      this.currentPanel.update(content, title, payload.sourceFile);
      return;
    }
    const panel = vscode.window.createWebviewPanel(this.viewType, title, column, {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionUri.fsPath, "webview", "shared", "dist")),
      ],
    });
    const provider = new WalkthroughViewProvider(panel, context);
    this.currentPanel = provider;
    provider.update(content, title, payload.sourceFile);
  }

  private static async resolveContent(sourceFile?: string, fallback = ""): Promise<string> {
    const file = sourceFile?.trim();
    if (!file) return fallback;
    const candidates = path.isAbsolute(file)
      ? [file]
      : (vscode.workspace.workspaceFolders ?? [])
        .filter((folder) => folder.uri.scheme === "file")
        .map((folder) => path.join(folder.uri.fsPath, file));
    for (const candidate of candidates) {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path.normalize(candidate)));
        const content = Buffer.from(bytes).toString("utf8");
        if (content.trim()) return content;
      } catch {
        // Try the next workspace folder, then the inline fallback.
      }
    }
    return fallback;
  }

  private static deriveTitle(content: string): string | undefined {
    return content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() || undefined;
  }

  private update(content: string, title: string, sourceFile?: string): void {
    this.currentContent = content;
    this.currentTitle = title;
    this.currentSourceFile = sourceFile;
    this.panel.title = title;
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionUri.fsPath, "webview", "shared", "dist", "walkthrough.js")));
    const stylesUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionUri.fsPath, "webview", "shared", "dist", "chat.css")));
    const nonce = Array.from({ length: 32 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 62))).join("");
    const data = JSON.stringify({ raw: content, title, sourceFile });
    const themeCssBlock = this.themeCss ? `<style id="vscode-theme-icons">${this.themeCss}</style>` : "";
    webview.html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';"><link href="${stylesUri}" rel="stylesheet">${themeCssBlock}<title>Walkthrough</title></head><body><div id="root"></div><script nonce="${nonce}">window.__WALKTHROUGH_DATA__ = ${data};</script><script type="module" nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
  }
}
