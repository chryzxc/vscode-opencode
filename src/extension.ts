import * as vscode from 'vscode';
import { OpencodeServerManager } from './services/OpencodeServerManager';
import { SessionService } from './services/SessionService';
import { ChatViewProvider } from './providers/ChatViewProvider';
import { StatusBarProvider } from './providers/StatusBarProvider';
import { PlanViewProvider } from './providers/PlanViewProvider';

let serverManager: OpencodeServerManager;
let sessionService: SessionService;
let chatViewProvider: ChatViewProvider;
let statusBarProvider: StatusBarProvider;

export async function activate(context: vscode.ExtensionContext) {
  console.log(
    `OpenCode extension activating... [Version: ${context.extension.packageJSON.version}]`,
  );

  try {
    // Initialize services
    serverManager = new OpencodeServerManager(context);
    sessionService = new SessionService(context, serverManager);
    statusBarProvider = new StatusBarProvider(serverManager);

    // Register chat view provider
    chatViewProvider = new ChatViewProvider(context, serverManager, sessionService);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('opencode.chatView', chatViewProvider)
    );

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('opencode.focus', async () => {
        await vscode.commands.executeCommand('opencode.chatView.focus');
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('opencode.newSession', async () => {
        await sessionService.createNewSession();
        await vscode.commands.executeCommand('opencode.chatView.focus');
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('opencode.sendSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('No active editor');
          return;
        }

        const selection = editor.document.getText(editor.selection);
        if (!selection) {
          vscode.window.showWarningMessage('No text selected');
          return;
        }

        const fileName = vscode.workspace.asRelativePath(editor.document.uri);
        const message = `\`\`\`${editor.document.languageId}\n// ${fileName}\n${selection}\n\`\`\``;
        
        await chatViewProvider.appendToPrompt(message);
        await vscode.commands.executeCommand('opencode.chatView.focus');
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('opencode.insertFileReference', async () => {
        // TODO: Implement file picker with fuzzy search
        vscode.window.showInformationMessage('File reference picker coming soon!');
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('opencode.toggleMode', async () => {
        await chatViewProvider.toggleMode();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('opencode.showPlan', async (content: string) => {
        PlanViewProvider.show(context.extensionUri, content);
      })
    );

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
            // await chatViewProvider.handleMessage({ type: 'sendMessage', text: prompt });
          } else {
            vscode.window.showErrorMessage("Chat view is not available.");
          }
        },
      ),
    );

    // Auto-start server if configured
    const config = vscode.workspace.getConfiguration('opencode');
    if (config.get('autoStart', true)) {
      await serverManager.ensureRunning();
    }

    console.log('OpenCode extension activated successfully');
  } catch (error) {
    console.error('Failed to activate OpenCode extension:', error);
    vscode.window.showErrorMessage(`OpenCode activation failed: ${error}`);
  }
}

export function deactivate() {
  console.log('OpenCode extension deactivating...');
  
  if (serverManager) {
    serverManager.dispose();
  }

  if (statusBarProvider) {
    statusBarProvider.dispose();
  }
  
  console.log('OpenCode extension deactivated');
}
