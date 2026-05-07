import * as vscode from 'vscode';
import { getNonce } from '../utils/getNonce';
import { SkillManagementService } from '../services/SkillManagementService';
import { OpencodeServerManager } from '../services/OpencodeServerManager';
import { createLogger } from '../utils/Logger';
import { LoggingCategories } from '../utils/LoggingSchema';

export class SkillsPanelProvider {
  public static currentPanel: SkillsPanelProvider | undefined;
  public static readonly viewType = 'opencode.skillsPanel';

  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];
  private logger = createLogger(LoggingCategories.UI_INTERACTION);

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly skillManagementService: SkillManagementService,
    private readonly serverManager: OpencodeServerManager
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.logger.info('[SkillsPanel] resolveWebviewView called');
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    this.logger.info('[SkillsPanel] HTML set, webview ready');

    // Listen for messages from the webview
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        await this._handleMessage(message);
      },
      null,
      this._disposables
    );

    // Listen for skill changes
    this.skillManagementService.onDidChangeSkills(() => {
      this.logger.info('[SkillsPanel] onDidChangeSkills fired');
      this._sendSkillsToWebview();
    });

    // Listen for initialization completion
    // This handles the case where the webview is opened before initialization completes
    this.skillManagementService.onInitialized(() => {
      this.logger.info('[SkillsPanel] SkillManagementService initialized, sending skills to webview');
      this._sendSkillsToWebview();
    });

    // Send initial data after a short delay to ensure webview is ready
    setTimeout(() => {
      this.logger.info('[SkillsPanel] Initial setTimeout fired, sending skills to webview');
      this._sendSkillsToWebview();
    }, 100);
  }

  private async _handleMessage(message: any): Promise<void> {
    try {
      this.logger.debug('SkillsPanel received message', { command: message.command });

      switch (message.command) {
        case 'requestData':
          await this._sendSkillsToWebview();
          break;
        case 'enableSkill':
          await this.skillManagementService.enableSkill(message.skillName);
          await this._showInfo(`Enabled skill: ${message.skillName}`);
          await this._promptServerRestart();
          break;
        case 'disableSkill':
          await this.skillManagementService.disableSkill(message.skillName);
          await this._showInfo(`Disabled skill: ${message.skillName}`);
          await this._promptServerRestart();
          break;
        case 'enableMultiple':
          await this.skillManagementService.enableMultipleSkills(message.skillNames);
          await this._showInfo(`Enabled ${message.skillNames.length} skills`);
          await this._promptServerRestart();
          break;
        case 'disableMultiple':
          await this.skillManagementService.disableMultipleSkills(message.skillNames);
          await this._showInfo(`Disabled ${message.skillNames.length} skills`);
          await this._promptServerRestart();
          break;
        case 'enableAll':
          await this.skillManagementService.enableAllSkills();
          await this._showInfo('Enabled all skills');
          break;
        case 'disableAll':
          await this.skillManagementService.disableAllSkills();
          await this._showInfo('Disabled all skills');
          break;
        case 'applyPreset':
          await this.skillManagementService.applyPreset(message.preset);
          await this._showInfo(`Applied preset: ${message.preset}`);
          await this._promptServerRestart();
          break;
        case 'refresh':
          await this.skillManagementService.refreshSkills();
          await this._showInfo('Refreshed skills list');
          await this._promptServerRestart();
          break;
        case 'openConfig':
          await vscode.env.openExternal(vscode.Uri.file(this.skillManagementService['configPath']));
          break;
        default:
          this.logger.warn('Unknown command from SkillsPanel', { command: message.command });
      }
    } catch (error) {
      this.logger.error('Error handling message from SkillsPanel', { command: message.command }, error as Error);
      this._showInfo(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _promptServerRestart(): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      'Skill configuration changed. Restart the OpenCode server to apply changes?',
      'Restart',
      'Later'
    );

    if (action === 'Restart') {
      await vscode.commands.executeCommand('opencode.restartServer');
    }
  }

  private async _showInfo(message: string): Promise<void> {
    if (this._view) {
      this._view.webview.postMessage({ type: 'showNotification', message });
    }
  }

  private async _sendSkillsToWebview(): Promise<void> {
    this.logger.info('[_sendSkillsToWebview] Called', {
      hasView: !!this._view,
      isInitialized: this.skillManagementService.isInitialized()
    });

    if (!this._view) {
      this.logger.warn('[_sendSkillsToWebview] No view available');
      return;
    }

    // Wait for initialization if not already done
    if (!this.skillManagementService.isInitialized()) {
      this.logger.info('[_sendSkillsToWebview] Waiting for SkillManagementService initialization');
      // Wait a bit and retry
      setTimeout(() => this._sendSkillsToWebview(), 500);
      return;
    }

    // Get client for server skills
    const client = this.serverManager.getClient();
    const skills = await this.skillManagementService.getAllSkills(client);

    this.logger.info('[_sendSkillsToWebview] Sending skills to webview', {
      skillCount: skills.length,
      skillNames: skills.slice(0, 5).map(s => s.name),
      serverSkills: skills.filter(s => s.source === 'server').length,
      fileSystemSkills: skills.filter(s => s.source !== 'server').length
    });

    this._view.webview.postMessage({
      type: 'skillsData',
      skills,
      stats: {
        total: skills.length,
        enabled: skills.filter(s => s.enabled).length,
        disabled: skills.filter(s => !s.enabled).length,
        global: skills.filter(s => s.source === 'global').length,
        project: skills.filter(s => s.source === 'project').length,
      },
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
      this._extensionUri, 'webview', 'shared', 'dist', 'skills.js'
    ));
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(
      this._extensionUri, 'webview', 'shared', 'dist', 'chat.css'
    ));

    const skills = this.skillManagementService.getSkills();
    this.logger.info('[_getHtmlForWebview] Generating initial HTML', {
      skillCount: skills.length,
      isInitialized: this.skillManagementService.isInitialized()
    });

    const initialData = JSON.stringify({
      skills,
      stats: {
        total: skills.length,
        enabled: skills.filter((s: { enabled: boolean }) => s.enabled).length,
        disabled: skills.filter((s: { enabled: boolean }) => !s.enabled).length,
        global: skills.filter((s: { source: string }) => s.source === 'global').length,
        project: skills.filter((s: { source: string }) => s.source === 'project').length,
      },
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
  <link href="${stylesUri}" rel="stylesheet">
  <title>Skills</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__SKILLS_DATA__ = ${initialData};</script>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    SkillsPanelProvider.currentPanel = undefined;

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
