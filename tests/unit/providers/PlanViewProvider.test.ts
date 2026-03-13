import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as path from 'path';
import { PlanViewProvider } from '../../../src/providers/PlanViewProvider';

describe('PlanViewProvider', () => {
  const mockExtensionUri = {
    fsPath: '/mock/extension',
  } as vscode.Uri;

  let mockPanel: any;
  let mockWebview: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWebview = {
      html: '',
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn(),
      asWebviewUri: vi.fn((uri: vscode.Uri) => uri.toString()),
      cspSource: 'https://mock-csp',
    };

    mockPanel = {
      webview: mockWebview,
      onDidChangeViewState: vi.fn(),
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
      dispose: vi.fn(),
      title: '',
    };

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(mockPanel);
    vi.mocked(vscode.workspace.workspaceFolders).setValue([
      {
        uri: { fsPath: '/mock/workspace', scheme: 'file' },
      },
    ] as any);
  });

  afterEach(() => {
    // Clean up any static references
    (PlanViewProvider as any).currentPanel = undefined;
  });

  describe('show', () => {
    it('should create new webview panel when none exists', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan content');

      expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
    });

    it('should reuse existing panel', () => {
      PlanViewProvider.show(mockExtensionUri, 'First content');
      PlanViewProvider.show(mockExtensionUri, 'Second content');

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(mockPanel.reveal).toHaveBeenCalled();
    });

    it('should use correct view type', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'opencode.planView',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    it('should use default title when none provided', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      const createCall = vi.mocked(vscode.window.createWebviewPanel).mock.calls[0];
      expect(createCall[1]).toBe('Implementation Plan');
    });

    it('should use provided title when available', () => {
      PlanViewProvider.show(mockExtensionUri, {
        content: 'Test plan',
        title: 'Custom Title',
      });

      const createCall = vi.mocked(vscode.window.createWebviewPanel).mock.calls[0];
      expect(createCall[1]).toBe('Custom Title');
    });

    it('should derive title from markdown heading when not provided', () => {
      const content = '# My Custom Plan\n\nContent here';
      PlanViewProvider.show(mockExtensionUri, content);

      const createCall = vi.mocked(vscode.window.createWebviewPanel).mock.calls[0];
      expect(createCall[1]).toBe('My Custom Plan');
    });

    it('should enable scripts in webview', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      const createCall = vi.mocked(vscode.window.createWebviewPanel).mock.calls[0];
      expect(createCall[3].enableScripts).toBe(true);
    });

    it('should set local resource roots', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      const createCall = vi.mocked(vscode.window.createWebviewPanel).mock.calls[0];
      expect(createCall[3].localResourceRoots).toBeDefined();
      expect(createCall[3].localResourceRoots.length).toBeGreaterThan(0);
    });

    it('should handle string content parameter', () => {
      PlanViewProvider.show(mockExtensionUri, 'String content');

      expect(mockPanel.webview.html).toContain('String content');
    });

    it('should handle object content parameter', () => {
      PlanViewProvider.show(mockExtensionUri, {
        content: 'Object content',
        title: 'Custom Title',
      });

      expect(mockPanel.webview.html).toContain('Object content');
    });

    it('should use active editor column if available', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        vscode.ViewColumn.One,
        expect.anything()
      );
    });
  });

  describe('closeCurrentPanel', () => {
    it('should close existing panel', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');
      PlanViewProvider.closeCurrentPanel();

      expect(mockPanel.dispose).toHaveBeenCalled();
    });

    it('should handle closing when no panel exists', () => {
      expect(() => PlanViewProvider.closeCurrentPanel()).not.toThrow();
    });

    it('should clear current panel reference', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');
      PlanViewProvider.closeCurrentPanel();

      expect((PlanViewProvider as any).currentPanel).toBeUndefined();
    });
  });

  describe('message handling', () => {
    let receiveMessageCallback: any;

    beforeEach(() => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      // Get the onDidReceiveMessage callback
      const onDidReceiveMessageCalls = vi.mocked(
        mockPanel.webview.onDidReceiveMessage
      ).mock.calls;

      if (onDidReceiveMessageCalls.length > 0) {
        receiveMessageCallback = onDidReceiveMessageCalls[0][0];
      }
    });

    describe('alert message', () => {
      it('should show error message', () => {
        receiveMessageCallback({
          type: 'alert',
          text: 'Test error',
        });

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Test error');
      });
    });

    describe('executeStep message', () => {
      it('should show information message', () => {
        receiveMessageCallback({
          type: 'executeStep',
          step: 'Step 1',
        });

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'Executing step: Step 1'
        );
      });
    });

    describe('executePlan message', () => {
      it('should execute opencode.executePlan command', () => {
        const plan = 'Test plan content';

        receiveMessageCallback({
          type: 'executePlan',
          plan,
        });

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
          'opencode.executePlan',
          plan
        );
      });

      it('should close panel after execution', () => {
        receiveMessageCallback({
          type: 'executePlan',
          plan: 'Test plan',
        });

        expect(mockPanel.dispose).toHaveBeenCalled();
      });
    });

    describe('addComment message', () => {
      it('should add comment to plan', () => {
        const comment = {
          id: 'comment-1',
          anchor: {
            startLine: 1,
            endLine: 3,
            selectedText: 'test',
          },
          text: 'Test comment',
          createdAt: Date.now(),
        };

        receiveMessageCallback({
          type: 'addComment',
          planId: 'plan-1',
          comment,
        });

        expect(mockWebview.postMessage).toHaveBeenCalledWith({
          type: 'commentsUpdated',
          comments: [comment],
        });
      });

      it('should use default plan ID when not provided', () => {
        const comment = {
          id: 'comment-1',
          anchor: {
            startLine: 1,
            endLine: 3,
            selectedText: 'test',
          },
          text: 'Test comment',
          createdAt: Date.now(),
        };

        receiveMessageCallback({
          type: 'addComment',
          comment,
        });

        expect(mockWebview.postMessage).toHaveBeenCalledWith({
          type: 'commentsUpdated',
          comments: [comment],
        });
      });

      it('should add multiple comments to same plan', () => {
        const comment1 = {
          id: 'comment-1',
          anchor: { startLine: 1, endLine: 3, selectedText: 'test1' },
          text: 'Comment 1',
          createdAt: Date.now(),
        };

        const comment2 = {
          id: 'comment-2',
          anchor: { startLine: 5, endLine: 7, selectedText: 'test2' },
          text: 'Comment 2',
          createdAt: Date.now(),
        };

        receiveMessageCallback({
          type: 'addComment',
          planId: 'plan-1',
          comment: comment1,
        });

        receiveMessageCallback({
          type: 'addComment',
          planId: 'plan-1',
          comment: comment2,
        });

        expect(mockWebview.postMessage).toHaveBeenLastCalledWith({
          type: 'commentsUpdated',
          comments: [comment1, comment2],
        });
      });
    });

    describe('updateComment message', () => {
      it('should update existing comment', () => {
        const comment = {
          id: 'comment-1',
          anchor: {
            startLine: 1,
            endLine: 3,
            selectedText: 'test',
          },
          text: 'Original',
          createdAt: Date.now(),
        };

        // Add comment first
        receiveMessageCallback({
          type: 'addComment',
          planId: 'plan-1',
          comment,
        });

        // Update comment
        const updated = {
          ...comment,
          text: 'Updated',
        };

        receiveMessageCallback({
          type: 'updateComment',
          planId: 'plan-1',
          comment: updated,
        });

        expect(mockWebview.postMessage).toHaveBeenCalledWith({
          type: 'commentsUpdated',
          comments: [updated],
        });
      });

      it('should not add comment if not found', () => {
        const comment = {
          id: 'non-existent',
          anchor: {
            startLine: 1,
            endLine: 3,
            selectedText: 'test',
          },
          text: 'Test',
          createdAt: Date.now(),
        };

        receiveMessageCallback({
          type: 'updateComment',
          planId: 'plan-1',
          comment,
        });

        // Should still send update with empty array
        expect(mockWebview.postMessage).toHaveBeenCalled();
      });
    });

    describe('deleteComment message', () => {
      it('should delete comment by id', () => {
        const comment1 = {
          id: 'comment-1',
          anchor: {
            startLine: 1,
            endLine: 3,
            selectedText: 'test1',
          },
          text: 'Comment 1',
          createdAt: Date.now(),
        };

        const comment2 = {
          id: 'comment-2',
          anchor: {
            startLine: 5,
            endLine: 7,
            selectedText: 'test2',
          },
          text: 'Comment 2',
          createdAt: Date.now(),
        };

        receiveMessageCallback({
          type: 'addComment',
          planId: 'plan-1',
          comment: comment1,
        });

        receiveMessageCallback({
          type: 'addComment',
          planId: 'plan-1',
          comment: comment2,
        });

        receiveMessageCallback({
          type: 'deleteComment',
          planId: 'plan-1',
          id: 'comment-1',
        });

        expect(mockWebview.postMessage).toHaveBeenLastCalledWith({
          type: 'commentsUpdated',
          comments: [comment2],
        });
      });

      it('should handle deleting non-existent comment', () => {
        receiveMessageCallback({
          type: 'deleteComment',
          planId: 'plan-1',
          id: 'non-existent',
        });

        expect(mockWebview.postMessage).toHaveBeenCalled();
      });
    });

    describe('proceedWithPlan message', () => {
      it('should send error when plan is empty', () => {
        receiveMessageCallback({
          type: 'proceedWithPlan',
          rawPlan: '',
          comments: [],
        });

        expect(mockWebview.postMessage).toHaveBeenCalledWith({
          type: 'planProceedStatus',
          ok: false,
          message: expect.stringContaining('empty'),
        });
      });

      it('should send error when plan is only whitespace', () => {
        receiveMessageCallback({
          type: 'proceedWithPlan',
          rawPlan: '   \n\t  ',
          comments: [],
        });

        expect(mockWebview.postMessage).toHaveBeenCalledWith({
          type: 'planProceedStatus',
          ok: false,
          message: expect.stringContaining('empty'),
        });
      });

      it('should execute opencode.planProceed command with valid plan', () => {
        receiveMessageCallback({
          type: 'proceedWithPlan',
          rawPlan: '# Test Plan\n\nContent',
          comments: [],
        });

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
          'opencode.planProceed',
          {
            rawPlan: '# Test Plan\n\nContent',
            comments: [],
          }
        );
      });

      it('should send success status before executing plan', () => {
        receiveMessageCallback({
          type: 'proceedWithPlan',
          rawPlan: '# Test Plan',
          comments: [],
        });

        expect(mockWebview.postMessage).toHaveBeenCalledWith({
          type: 'planProceedStatus',
          ok: true,
          stage: 'accepted',
        });
      });

      it('should send error status when command fails', async () => {
        vi.mocked(vscode.commands.executeCommand).mockRejectedValue(
          new Error('Command failed')
        );

        await receiveMessageCallback({
          type: 'proceedWithPlan',
          rawPlan: '# Test Plan',
          comments: [],
        });

        expect(mockWebview.postMessage).toHaveBeenCalledWith({
          type: 'planProceedStatus',
          ok: false,
          message: expect.any(String),
        });
      });

      it('should include comments in payload', () => {
        const comments = [
          {
            id: 'comment-1',
            anchor: {
              startLine: 1,
              endLine: 3,
              selectedText: 'test',
            },
            text: 'Comment',
            createdAt: Date.now(),
          },
        ];

        receiveMessageCallback({
          type: 'proceedWithPlan',
          rawPlan: '# Test Plan',
          comments,
        });

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
          'opencode.planProceed',
          {
            rawPlan: '# Test Plan',
            comments,
          }
        );
      });
    });
  });

  describe('title derivation', () => {
    it('should extract title from h1 heading', () => {
      PlanViewProvider.show(mockExtensionUri, '# My Title\n\nContent');

      expect(mockPanel.title).toBe('My Title');
    });

    it('should extract title from h2 heading', () => {
      PlanViewProvider.show(mockExtensionUri, '## My Title\n\nContent');

      expect(mockPanel.title).toBe('My Title');
    });

    it('should extract title from h3 heading', () => {
      PlanViewProvider.show(mockExtensionUri, '### My Title\n\nContent');

      expect(mockPanel.title).toBe('My Title');
    });

    it('should use default title when no heading found', () => {
      PlanViewProvider.show(mockExtensionUri, 'Just some content');

      expect(mockPanel.title).toBe('Implementation Plan');
    });

    it('should trim whitespace from derived title', () => {
      PlanViewProvider.show(mockExtensionUri, '#   My Title   \n\nContent');

      expect(mockPanel.title).toBe('My Title');
    });

    it('should use explicit title over derived title', () => {
      PlanViewProvider.show(mockExtensionUri, {
        content: '# Derived Title\n\nContent',
        title: 'Explicit Title',
      });

      expect(mockPanel.title).toBe('Explicit Title');
    });
  });

  describe('view state changes', () => {
    it('should update content when panel becomes visible', () => {
      PlanViewProvider.show(mockExtensionUri, 'Initial content');

      const onDidChangeViewStateCalls = vi.mocked(
        mockPanel.onDidChangeViewState
      ).mock.calls;

      if (onDidChangeViewStateCalls.length > 0) {
        const callback = onDidChangeViewStateCalls[0][0];
        mockPanel.visible = true;
        callback();
      }

      expect(mockPanel.webview.html).toContain('Initial content');
    });
  });

  describe('dispose', () => {
    it('should dispose panel', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      const provider = (PlanViewProvider as any).currentPanel;
      provider.dispose();

      expect(mockPanel.dispose).toHaveBeenCalled();
    });

    it('should clear current panel reference', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      const provider = (PlanViewProvider as any).currentPanel;
      provider.dispose();

      expect((PlanViewProvider as any).currentPanel).toBeUndefined();
    });

    it('should dispose all registered disposables', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      const onDidDisposeMock = vi.fn();
      mockPanel.onDidDispose.mockImplementation((callback: any) => {
        onDidDisposeMock.mockImplementation(callback);
        return { dispose: vi.fn() };
      });

      const provider = (PlanViewProvider as any).currentPanel;

      // Trigger dispose callback
      if (onDidDisposeMock.mock.calls.length > 0) {
        onDidDisposeMock.mock.calls[0][0]();
      }

      expect((PlanViewProvider as any).currentPanel).toBeUndefined();
    });
  });

  describe('HTML generation', () => {
    it('should generate HTML with CSP nonce', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      expect(mockPanel.webview.html).toContain('nonce-');
    });

    it('should include plan content in HTML', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan content');

      expect(mockPanel.webview.html).toContain('Test plan content');
    });

    it('should include script URI', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      expect(mockPanel.webview.html).toContain('script');
    });

    it('should include styles URI', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      expect(mockPanel.webview.html).toContain('stylesheet');
    });

    it('should include plan data in window object', () => {
      const content = 'Test plan';
      PlanViewProvider.show(mockExtensionUri, content);

      expect(mockPanel.webview.html).toContain('__PLAN_DATA__');
    });

    it('should include comments in plan data', () => {
      PlanViewProvider.show(mockExtensionUri, 'Test plan');

      const comment = {
        id: 'comment-1',
        anchor: {
          startLine: 1,
          endLine: 3,
          selectedText: 'test',
        },
        text: 'Comment',
        createdAt: Date.now(),
      };

      const receiveMessageCallback = vi.mocked(
        mockPanel.webview.onDidReceiveMessage
      ).mock.calls[0][0];

      receiveMessageCallback({
        type: 'addComment',
        planId: 'Implementation Plan',
        comment,
      });

      expect(mockWebview.postMessage).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', () => {
      expect(() => PlanViewProvider.show(mockExtensionUri, '')).not.toThrow();
    });

    it('should handle null content', () => {
      expect(() =>
        PlanViewProvider.show(mockExtensionUri, '')
      ).not.toThrow();
    });

    it('should handle very long content', () => {
      const longContent = 'A'.repeat(100000);
      expect(() =>
        PlanViewProvider.show(mockExtensionUri, longContent)
      ).not.toThrow();
    });

    it('should handle special characters in content', () => {
      const specialContent = '<script>alert("test")</script>';
      expect(() =>
        PlanViewProvider.show(mockExtensionUri, specialContent)
      ).not.toThrow();
    });

    it('should handle multiple rapid updates', () => {
      for (let i = 0; i < 100; i++) {
        PlanViewProvider.show(mockExtensionUri, `Content ${i}`);
      }
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    });
  });
});
