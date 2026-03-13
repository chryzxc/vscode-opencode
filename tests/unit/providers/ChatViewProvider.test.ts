import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as path from 'path';
import { ChatViewProvider } from '../../../src/providers/ChatViewProvider';
import { OpencodeServerManager } from '../../../src/services/OpencodeServerManager';
import { SessionService } from '../../../src/services/SessionService';
import { MessageStreamService } from '../../../src/services/MessageStreamService';

describe('ChatViewProvider', () => {
  let chatViewProvider: ChatViewProvider;
  let mockContext: vscode.ExtensionContext;
  let mockServerManager: OpencodeServerManager;
  let mockSessionService: SessionService;
  let mockWebviewView: vscode.WebviewView;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock extension context
    mockContext = {
      globalState: {
        get: vi.fn(),
        update: vi.fn(),
        keys: [],
      },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
        keys: [],
      },
      extensionUri: {
        fsPath: '/mock/extension',
      } as vscode.Uri,
      subscriptions: [],
    } as any;

    // Mock server manager
    mockServerManager = {
      getClient: vi.fn(),
      getPort: vi.fn(),
      getStatus: vi.fn(() => 'running'),
      getVersion: vi.fn(() => '1.0.0'),
      onStatusChange: vi.fn(() => ({ dispose: vi.fn() })),
    } as any;

    // Mock session service
    mockSessionService = {
      getCurrentSession: vi.fn(),
      createNewSession: vi.fn(),
      switchSession: vi.fn(),
      deleteSession: vi.fn(),
      renameSession: vi.fn(),
      getMessages: vi.fn(() => []),
      listSessions: vi.fn(() => []),
      upsertMessage: vi.fn(),
    } as any;

    // Mock webview view
    mockWebviewView = {
      webview: {
        html: '',
        options: {},
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn(),
        cspSource: 'https://mock-csp',
        asWebviewUri: vi.fn((uri: vscode.Uri) => uri.toString()),
      },
      onDidDispose: vi.fn(),
      visible: true,
    } as any;

    // Mock vscode window APIs
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (chatViewProvider) {
      // Clean up if needed
    }
  });

  describe('constructor', () => {
    it('should create provider instance', () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      expect(chatViewProvider).toBeInstanceOf(ChatViewProvider);
    });

    it('should initialize stream service', () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      expect((chatViewProvider as any).streamService).toBeInstanceOf(
        MessageStreamService
      );
    });

    it('should load persisted model selection from global state', () => {
      vi.mocked(mockContext.globalState.get).mockReturnValue({
        providerID: 'test-provider',
        modelID: 'test-model',
        providerName: 'Test Provider',
      });

      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      expect(mockContext.globalState.get).toHaveBeenCalledWith('selectedModel');
    });

    it('should use default model when no persisted selection', () => {
      vi.mocked(mockContext.globalState.get).mockReturnValue(undefined);

      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      expect((chatViewProvider as any).selectedModel).toEqual({
        providerID: 'opencode',
        modelID: 'big-pickle',
        providerName: undefined,
      });
    });

    it('should ignore invalid persisted model selection', () => {
      vi.mocked(mockContext.globalState.get).mockReturnValue({ invalid: 'data' });

      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      // Should fall back to default
      expect((chatViewProvider as any).selectedModel).toEqual({
        providerID: 'opencode',
        modelID: 'big-pickle',
        providerName: undefined,
      });
    });

    it('should initialize quota service', () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      expect((chatViewProvider as any).quotaService).toBeDefined();
    });

    it('should initialize subagent tracker', () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      expect((chatViewProvider as any).subagentTracker).toBeDefined();
    });

    it('should initialize request budgeter', () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      expect((chatViewProvider as any).budgeter).toBeDefined();
    });

    it('should initialize gemini token tracker', () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      expect((chatViewProvider as any).geminiTokenTracker).toBeDefined();
    });
  });

  describe('resolveWebviewView', () => {
    beforeEach(() => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );
    });

    it('should set webview options', () => {
      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      expect(mockWebviewView.webview.options.enableScripts).toBe(true);
    });

    it('should set local resource roots', () => {
      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      expect(mockWebviewView.webview.options.localResourceRoots).toBeDefined();
    });

    it('should set up message handler', () => {
      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      expect(mockWebviewView.webview.onDidReceiveMessage).toHaveBeenCalled();
    });

    it('should set up dispose handler', () => {
      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      expect(mockWebviewView.onDidDispose).toHaveBeenCalled();
    });

    it('should set webview HTML', () => {
      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      expect(mockWebviewView.webview.html).toBeTruthy();
    });

    it('should subscribe to status changes', () => {
      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      expect(mockServerManager.onStatusChange).toHaveBeenCalled();
    });

    it('should store view reference', () => {
      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      expect((chatViewProvider as any).view).toBe(mockWebviewView);
    });
  });

  describe('message handling - ready', () => {
    let receiveMessageCallback: any;

    beforeEach(async () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      // Mock session service methods
      vi.mocked(mockSessionService.getCurrentSession).mockResolvedValue({
        id: 'session-1',
        title: 'Test Session',
      });
      vi.mocked(mockSessionService.getMessages).mockResolvedValue([]);
      vi.mocked(mockSessionService.listSessions).mockResolvedValue([]);

      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      // Get the onDidReceiveMessage callback
      const onDidReceiveMessageCalls = vi.mocked(
        mockWebviewView.webview.onDidReceiveMessage
      ).mock.calls;

      if (onDidReceiveMessageCalls.length > 0) {
        receiveMessageCallback = onDidReceiveMessageCalls[0][0];
      }
    });

    it('should send initState on ready', async () => {
      await receiveMessageCallback({ type: 'ready' });

      expect(mockWebviewView.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'initState',
        })
      );
    });

    it('should include server status in initState', async () => {
      await receiveMessageCallback({ type: 'ready' });

      expect(mockWebviewView.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'initState',
          serverStatus: 'running',
        })
      );
    });

    it('should include selected model in initState', async () => {
      await receiveMessageCallback({ type: 'ready' });

      expect(mockWebviewView.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'initState',
          selectedModel: expect.any(Object),
        })
      );
    });

    it('should include selected agent in initState', async () => {
      await receiveMessageCallback({ type: 'ready' });

      expect(mockWebviewView.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'initState',
          selectedAgent: 'build',
        })
      );
    });

    it('should include server version in initState', async () => {
      await receiveMessageCallback({ type: 'ready' });

      expect(mockWebviewView.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'initState',
          serverVersion: '1.0.0',
        })
      );
    });

    it('should send chatHistory on ready', async () => {
      await receiveMessageCallback({ type: 'ready' });

      expect(mockWebviewView.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chatHistory',
        })
      );
    });

    it('should send sessionsList on ready', async () => {
      await receiveMessageCallback({ type: 'ready' });

      expect(mockWebviewView.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sessionsList',
        })
      );
    });

    it('should handle ready message only once', async () => {
      await receiveMessageCallback({ type: 'ready' });
      await receiveMessageCallback({ type: 'ready' });

      // Should not re-initialize
      expect((chatViewProvider as any).hasInitializedWebview).toBe(true);
    });
  });

  describe('message handling - createSession', () => {
    let receiveMessageCallback: any;

    beforeEach(async () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      const newSession = {
        id: 'new-session',
        title: 'New Session',
      };
      vi.mocked(mockSessionService.createNewSession).mockResolvedValue(
        newSession as any
      );
      vi.mocked(mockSessionService.listSessions).mockResolvedValue([]);

      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      const onDidReceiveMessageCalls = vi.mocked(
        mockWebviewView.webview.onDidReceiveMessage
      ).mock.calls;

      if (onDidReceiveMessageCalls.length > 0) {
        receiveMessageCallback = onDidReceiveMessageCalls[0][0];
      }
    });

    it('should create new session', async () => {
      await receiveMessageCallback({ type: 'createSession' });

      expect(mockSessionService.createNewSession).toHaveBeenCalled();
    });

    it('should update current session ID', async () => {
      await receiveMessageCallback({ type: 'createSession' });

      expect((chatViewProvider as any).currentSessionId).toBe('new-session');
    });

    it('should send empty chat history', async () => {
      await receiveMessageCallback({ type: 'createSession' });

      expect(mockWebviewView.webview.postMessage).toHaveBeenCalledWith({
        type: 'chatHistory',
        messages: [],
      });
    });

    it('should refresh sessions list', async () => {
      await receiveMessageCallback({ type: 'createSession' });

      expect(mockSessionService.listSessions).toHaveBeenCalled();
    });
  });

  describe('message handling - switchSession', () => {
    let receiveMessageCallback: any;

    beforeEach(async () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      const session = {
        id: 'session-1',
        title: 'Test Session',
        agent: 'build',
        model: {
          providerID: 'opencode',
          modelID: 'big-pickle',
        },
      };
      vi.mocked(mockSessionService.switchSession).mockResolvedValue(session);
      vi.mocked(mockSessionService.getMessages).mockResolvedValue([]);
      vi.mocked(mockSessionService.listSessions).mockResolvedValue([session]);

      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      const onDidReceiveMessageCalls = vi.mocked(
        mockWebviewView.webview.onDidReceiveMessage
      ).mock.calls;

      if (onDidReceiveMessageCalls.length > 0) {
        receiveMessageCallback = onDidReceiveMessageCalls[0][0];
      }
    });

    it('should switch to specified session', async () => {
      await receiveMessageCallback({
        type: 'switchSession',
        sessionId: 'session-1',
      });

      expect(mockSessionService.switchSession).toHaveBeenCalledWith('session-1');
    });

    it('should update current session ID', async () => {
      await receiveMessageCallback({
        type: 'switchSession',
        sessionId: 'session-1',
      });

      expect((chatViewProvider as any).currentSessionId).toBe('session-1');
    });

    it('should send updated chat history', async () => {
      await receiveMessageCallback({
        type: 'switchSession',
        sessionId: 'session-1',
      });

      expect(mockWebviewView.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chatHistory',
        })
      );
    });

    it('should refresh sessions list', async () => {
      await receiveMessageCallback({
        type: 'switchSession',
        sessionId: 'session-1',
      });

      expect(mockSessionService.listSessions).toHaveBeenCalled();
    });
  });

  describe('message handling - deleteSession', () => {
    let receiveMessageCallback: any;

    beforeEach(async () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      const currentSession = {
        id: 'session-1',
        title: 'Current Session',
      };
      vi.mocked(mockSessionService.getCurrentSession).mockResolvedValue(
        currentSession as any
      );
      vi.mocked(mockSessionService.deleteSession).mockResolvedValue(undefined);
      vi.mocked(mockSessionService.createNewSession).mockResolvedValue({
        id: 'session-2',
        title: 'New Session',
      } as any);
      vi.mocked(mockSessionService.listSessions).mockResolvedValue([]);

      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      (chatViewProvider as any).currentSessionId = 'session-1';

      const onDidReceiveMessageCalls = vi.mocked(
        mockWebviewView.webview.onDidReceiveMessage
      ).mock.calls;

      if (onDidReceiveMessageCalls.length > 0) {
        receiveMessageCallback = onDidReceiveMessageCalls[0][0];
      }
    });

    it('should delete specified session', async () => {
      await receiveMessageCallback({
        type: 'deleteSession',
        sessionId: 'session-1',
      });

      expect(mockSessionService.deleteSession).toHaveBeenCalledWith('session-1');
    });

    it('should create new session if deleting current', async () => {
      await receiveMessageCallback({
        type: 'deleteSession',
        sessionId: 'session-1',
      });

      expect(mockSessionService.createNewSession).toHaveBeenCalled();
    });

    it('should show error on failure', async () => {
      vi.mocked(mockSessionService.deleteSession).mockRejectedValue(
        new Error('Delete failed')
      );

      await receiveMessageCallback({
        type: 'deleteSession',
        sessionId: 'session-1',
      });

      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });
  });

  describe('message handling - renameSession', () => {
    let receiveMessageCallback: any;

    beforeEach(async () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      vi.mocked(mockSessionService.renameSession).mockResolvedValue(undefined);
      vi.mocked(mockSessionService.listSessions).mockResolvedValue([]);

      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      const onDidReceiveMessageCalls = vi.mocked(
        mockWebviewView.webview.onDidReceiveMessage
      ).mock.calls;

      if (onDidReceiveMessageCalls.length > 0) {
        receiveMessageCallback = onDidReceiveMessageCalls[0][0];
      }
    });

    it('should rename session with new title', async () => {
      await receiveMessageCallback({
        type: 'renameSession',
        sessionId: 'session-1',
        newTitle: 'New Title',
      });

      expect(mockSessionService.renameSession).toHaveBeenCalledWith(
        'session-1',
        'New Title'
      );
    });

    it('should refresh sessions list after rename', async () => {
      await receiveMessageCallback({
        type: 'renameSession',
        sessionId: 'session-1',
        newTitle: 'New Title',
      });

      expect(mockSessionService.listSessions).toHaveBeenCalled();
    });

    it('should show error on failure', async () => {
      vi.mocked(mockSessionService.renameSession).mockRejectedValue(
        new Error('Rename failed')
      );

      await receiveMessageCallback({
        type: 'renameSession',
        sessionId: 'session-1',
        newTitle: 'New Title',
      });

      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });
  });

  describe('message handling - selectModel', () => {
    let receiveMessageCallback: any;

    beforeEach(async () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      const onDidReceiveMessageCalls = vi.mocked(
        mockWebviewView.webview.onDidReceiveMessage
      ).mock.calls;

      if (onDidReceiveMessageCalls.length > 0) {
        receiveMessageCallback = onDidReceiveMessageCalls[0][0];
      }
    });

    it('should update selected model', async () => {
      await receiveMessageCallback({
        type: 'selectModel',
        model: {
          providerID: 'test-provider',
          modelID: 'test-model',
          providerName: 'Test Provider',
        },
      });

      expect((chatViewProvider as any).selectedModel).toEqual({
        providerID: 'test-provider',
        modelID: 'test-model',
        providerName: 'Test Provider',
      });
    });

    it('should persist model selection to global state', async () => {
      await receiveMessageCallback({
        type: 'selectModel',
        model: {
          providerID: 'test-provider',
          modelID: 'test-model',
        },
      });

      expect(mockContext.globalState.update).toHaveBeenCalledWith(
        'selectedModel',
        expect.objectContaining({
          providerID: 'test-provider',
          modelID: 'test-model',
        })
      );
    });

    it('should persist model selection to session if active', async () => {
      (chatViewProvider as any).currentSessionId = 'session-1';

      await receiveMessageCallback({
        type: 'selectModel',
        model: {
          providerID: 'test-provider',
          modelID: 'test-model',
        },
      });

      // Verify session settings are persisted
      expect(mockContext.globalState.update).toHaveBeenCalled();
    });

    it('should ignore invalid model selection', async () => {
      await receiveMessageCallback({
        type: 'selectModel',
        model: {},
      });

      // Should not update
      expect((chatViewProvider as any).selectedModel).toEqual({
        providerID: 'opencode',
        modelID: 'big-pickle',
      });
    });
  });

  describe('message handling - setThinkingLevel', () => {
    let receiveMessageCallback: any;

    beforeEach(async () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      const onDidReceiveMessageCalls = vi.mocked(
        mockWebviewView.webview.onDidReceiveMessage
      ).mock.calls;

      if (onDidReceiveMessageCalls.length > 0) {
        receiveMessageCallback = onDidReceiveMessageCalls[0][0];
      }
    });

    it('should persist thinking level to global state', async () => {
      await receiveMessageCallback({
        type: 'setThinkingLevel',
        level: 'high',
      });

      expect(mockContext.globalState.update).toHaveBeenCalledWith(
        'thinkingLevel',
        'high'
      );
    });

    it('should send thinkingLevelUpdate message', async () => {
      await receiveMessageCallback({
        type: 'setThinkingLevel',
        level: 'medium',
      });

      expect(mockWebviewView.webview.postMessage).toHaveBeenCalledWith({
        type: 'thinkingLevelUpdate',
        level: 'medium',
      });
    });

    it('should persist to session if active', async () => {
      (chatViewProvider as any).currentSessionId = 'session-1';

      await receiveMessageCallback({
        type: 'setThinkingLevel',
        level: 'low',
      });

      expect(mockContext.globalState.update).toHaveBeenCalled();
    });
  });

  describe('HTML generation', () => {
    beforeEach(() => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );
    });

    it('should generate HTML with CSP nonce', () => {
      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      expect(mockWebviewView.webview.html).toContain('nonce-');
    });

    it('should include script tags', () => {
      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      expect(mockWebviewView.webview.html).toContain('<script');
    });

    it('should include CSP meta tag', () => {
      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      expect(mockWebviewView.webview.html).toContain(
        'Content-Security-Policy'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle missing session gracefully', async () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      vi.mocked(mockSessionService.getCurrentSession).mockResolvedValue(
        undefined
      );

      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      const receiveMessageCallback = vi.mocked(
        mockWebviewView.webview.onDidReceiveMessage
      ).mock.calls[0][0];

      await expect(
        receiveMessageCallback({ type: 'ready' })
      ).resolves.not.toThrow();
    });

    it('should handle service errors gracefully', async () => {
      chatViewProvider = new ChatViewProvider(
        mockContext,
        mockServerManager,
        mockSessionService
      );

      vi.mocked(mockSessionService.listSessions).mockRejectedValue(
        new Error('Service error')
      );

      chatViewProvider.resolveWebviewView(mockWebviewView, {} as any, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });

      const receiveMessageCallback = vi.mocked(
        mockWebviewView.webview.onDidReceiveMessage
      ).mock.calls[0][0];

      await expect(
        receiveMessageCallback({ type: 'ready' })
      ).resolves.not.toThrow();
    });
  });
});
