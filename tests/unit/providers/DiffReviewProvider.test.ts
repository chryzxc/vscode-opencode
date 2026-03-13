import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import {
  DiffReviewProvider,
  DiffData,
  DiffFile,
  DiffHunk,
  DiffComment,
} from '../../../src/providers/DiffReviewProvider';

describe('DiffReviewProvider', () => {
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
    (DiffReviewProvider as any).currentPanel = undefined;
  });

  describe('show', () => {
    it('should create new webview panel when none exists', () => {
      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
    });

    it('should reuse existing panel', () => {
      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);
      DiffReviewProvider.show(mockExtensionUri, diffData);

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(mockPanel.reveal).toHaveBeenCalled();
    });

    it('should update webview HTML when reusing panel', () => {
      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      const firstHtml = mockPanel.webview.html;

      DiffReviewProvider.show(mockExtensionUri, diffData);

      expect(mockPanel.webview.html).toBeTruthy();
    });

    it('should use correct view type', () => {
      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'opencode.diffReview',
        'Diff Review',
        expect.anything(),
        expect.anything()
      );
    });

    it('should use active editor column if available', () => {
      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        vscode.ViewColumn.One,
        expect.anything()
      );
    });

    it('should enable scripts in webview', () => {
      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      const createCall = vi.mocked(vscode.window.createWebviewPanel).mock.calls[0];
      expect(createCall[3].enableScripts).toBe(true);
    });

    it('should set local resource roots', () => {
      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      const createCall = vi.mocked(vscode.window.createWebviewPanel).mock.calls[0];
      expect(createCall[3].localResourceRoots).toBeDefined();
    });

    it('should handle diff data with files', () => {
      const diffData: DiffData = {
        files: [
          {
            path: 'test.ts',
            added: 10,
            deleted: 5,
            type: 'modify',
            hunks: [],
          },
        ],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      expect(mockPanel.webview.html).toContain('test.ts');
    });

    it('should handle diff data with comments', () => {
      const comment: DiffComment = {
        id: 'comment-1',
        anchor: {
          startLine: 1,
          endLine: 3,
          selectedText: 'test',
        },
        text: 'Test comment',
        createdAt: Date.now(),
      };

      const diffData: DiffData = {
        files: [],
        comments: [comment],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      expect(mockPanel.webview.html).toBeTruthy();
    });
  });

  describe('message handling', () => {
    let receiveMessageCallback: any;
    let diffData: DiffData;

    beforeEach(() => {
      diffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      // Get the onDidReceiveMessage callback
      const onDidReceiveMessageCalls = vi.mocked(
        mockPanel.webview.onDidReceiveMessage
      ).mock.calls;

      if (onDidReceiveMessageCalls.length > 0) {
        receiveMessageCallback = onDidReceiveMessageCalls[0][0];
      }
    });

    describe('approveDiff message', () => {
      it('should execute git add for relative file path', () => {
        vi.mocked(cp.execFile).mockImplementation(
          (
            cmd: string,
            args: string[],
            options: any,
            callback: (err: Error | null, stdout: string, stderr: string) => void
          ) => {
            if (typeof options === 'function') {
              callback = options;
            }
            callback(null, '', '');
          }
        );

        receiveMessageCallback({
          type: 'approveDiff',
          file: 'src/test.ts',
        });

        expect(cp.execFile).toHaveBeenCalledWith(
          'git',
          ['add', '/mock/workspace/src/test.ts'],
          { cwd: '/mock/workspace' },
          expect.any(Function)
        );
      });

      it('should execute git add for absolute file path', () => {
        vi.mocked(cp.execFile).mockImplementation(
          (
            cmd: string,
            args: string[],
            options: any,
            callback: (err: Error | null, stdout: string, stderr: string) => void
          ) => {
            if (typeof options === 'function') {
              callback = options;
            }
            callback(null, '', '');
          }
        );

        receiveMessageCallback({
          type: 'approveDiff',
          file: '/absolute/path/test.ts',
        });

        expect(cp.execFile).toHaveBeenCalledWith(
          'git',
          ['add', '/absolute/path/test.ts'],
          { cwd: '/mock/workspace' },
          expect.any(Function)
        );
      });

      it('should show success message on approval', () => {
        vi.mocked(cp.execFile).mockImplementation(
          (
            cmd: string,
            args: string[],
            options: any,
            callback: (err: Error | null, stdout: string, stderr: string) => void
          ) => {
            if (typeof options === 'function') {
              callback = options;
            }
            callback(null, '', '');
          }
        );

        receiveMessageCallback({
          type: 'approveDiff',
          file: 'src/test.ts',
        });

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          expect.stringContaining('Approved and staged')
        );
      });

      it('should show error message on approval failure', () => {
        vi.mocked(cp.execFile).mockImplementation(
          (
            cmd: string,
            args: string[],
            options: any,
            callback: (err: Error | null, stdout: string, stderr: string) => void
          ) => {
            if (typeof options === 'function') {
              callback = options;
            }
            callback(new Error('Git error'), '', '');
          }
        );

        receiveMessageCallback({
          type: 'approveDiff',
          file: 'src/test.ts',
        });

        expect(vscode.window.showErrorMessage).toHaveBeenCalled();
      });
    });

    describe('rejectDiff message', () => {
      it('should execute git checkout for tracked files', () => {
        vi.mocked(cp.execFile).mockImplementation(
          (
            cmd: string,
            args: string[],
            options: any,
            callback: (err: Error | null, stdout: string, stderr: string) => void
          ) => {
            if (typeof options === 'function') {
              callback = options;
            }
            callback(null, '', '');
          }
        );

        receiveMessageCallback({
          type: 'rejectDiff',
          file: 'src/test.ts',
        });

        expect(cp.execFile).toHaveBeenCalledWith(
          'git',
          ['checkout', '--', '/mock/workspace/src/test.ts'],
          { cwd: '/mock/workspace' },
          expect.any(Function)
        );
      });

      it('should fallback to git clean for untracked files', () => {
        vi.mocked(cp.execFile).mockImplementation(
          (
            cmd: string,
            args: string[],
            options: any,
            callback: (err: Error | null, stdout: string, stderr: string) => void
          ) => {
            if (typeof options === 'function') {
              callback = options;
            }

            // First call (checkout) fails, second call (clean) succeeds
            if (args[0] === 'checkout') {
              callback(new Error('not tracked'), '', '');
            } else {
              callback(null, '', '');
            }
          }
        );

        receiveMessageCallback({
          type: 'rejectDiff',
          file: 'src/test.ts',
        });

        expect(cp.execFile).toHaveBeenCalledWith(
          'git',
          ['clean', '-f', '--', '/mock/workspace/src/test.ts'],
          { cwd: '/mock/workspace' },
          expect.any(Function)
        );
      });

      it('should show success message for tracked files', () => {
        vi.mocked(cp.execFile).mockImplementation(
          (
            cmd: string,
            args: string[],
            options: any,
            callback: (err: Error | null, stdout: string, stderr: string) => void
          ) => {
            if (typeof options === 'function') {
              callback = options;
            }
            callback(null, '', '');
          }
        );

        receiveMessageCallback({
          type: 'rejectDiff',
          file: 'src/test.ts',
        });

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          expect.stringContaining('Rejected and reverted')
        );
      });

      it('should show success message for untracked files', () => {
        vi.mocked(cp.execFile).mockImplementation(
          (
            cmd: string,
            args: string[],
            options: any,
            callback: (err: Error | null, stdout: string, stderr: string) => void
          ) => {
            if (typeof options === 'function') {
              callback = options;
            }

            if (args[0] === 'checkout') {
              callback(new Error('not tracked'), '', '');
            } else {
              callback(null, '', '');
            }
          }
        );

        receiveMessageCallback({
          type: 'rejectDiff',
          file: 'src/test.ts',
        });

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          expect.stringContaining('Rejected (deleted untracked)')
        );
      });
    });

    describe('addComment message', () => {
      it('should add comment to data', () => {
        const comment: DiffComment = {
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

      it('should initialize comments array if undefined', () => {
        const comment: DiffComment = {
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

        expect(mockWebview.postMessage).toHaveBeenCalled();
      });
    });

    describe('updateComment message', () => {
      it('should update existing comment', () => {
        const comment1: DiffComment = {
          id: 'comment-1',
          anchor: {
            startLine: 1,
            endLine: 3,
            selectedText: 'test',
          },
          text: 'Original',
          createdAt: Date.now(),
        };

        const comment2: DiffComment = {
          id: 'comment-2',
          anchor: {
            startLine: 5,
            endLine: 7,
            selectedText: 'test2',
          },
          text: 'Another',
          createdAt: Date.now(),
        };

        diffData.comments = [comment1, comment2];

        DiffReviewProvider.show(mockExtensionUri, diffData);

        const updatedComment = {
          ...comment1,
          text: 'Updated',
        };

        receiveMessageCallback({
          type: 'updateComment',
          comment: updatedComment,
        });

        expect(mockWebview.postMessage).toHaveBeenCalledWith({
          type: 'commentsUpdated',
          comments: [updatedComment, comment2],
        });
      });

      it('should not update if comment not found', () => {
        const comment: DiffComment = {
          id: 'comment-1',
          anchor: {
            startLine: 1,
            endLine: 3,
            selectedText: 'test',
          },
          text: 'Test',
          createdAt: Date.now(),
        };

        diffData.comments = [comment];

        DiffReviewProvider.show(mockExtensionUri, diffData);

        receiveMessageCallback({
          type: 'updateComment',
          comment: {
            ...comment,
            id: 'non-existent',
          },
        });

        // Should still send update even if not found
        expect(mockWebview.postMessage).toHaveBeenCalled();
      });
    });

    describe('deleteComment message', () => {
      it('should delete comment by id', () => {
        const comment1: DiffComment = {
          id: 'comment-1',
          anchor: {
            startLine: 1,
            endLine: 3,
            selectedText: 'test',
          },
          text: 'Test',
          createdAt: Date.now(),
        };

        const comment2: DiffComment = {
          id: 'comment-2',
          anchor: {
            startLine: 5,
            endLine: 7,
            selectedText: 'test2',
          },
          text: 'Another',
          createdAt: Date.now(),
        };

        diffData.comments = [comment1, comment2];

        DiffReviewProvider.show(mockExtensionUri, diffData);

        receiveMessageCallback({
          type: 'deleteComment',
          id: 'comment-1',
        });

        expect(mockWebview.postMessage).toHaveBeenCalledWith({
          type: 'commentsUpdated',
          comments: [comment2],
        });
      });

      it('should handle deleting non-existent comment', () => {
        diffData.comments = [];

        DiffReviewProvider.show(mockExtensionUri, diffData);

        receiveMessageCallback({
          type: 'deleteComment',
          id: 'non-existent',
        });

        expect(mockWebview.postMessage).toHaveBeenCalledWith({
          type: 'commentsUpdated',
          comments: [],
        });
      });
    });

    describe('openFile message', () => {
      it('should open file with vscode.open command', () => {
        receiveMessageCallback({
          type: 'openFile',
          file: 'src/test.ts',
        });

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
          'vscode.open',
          expect.objectContaining({
            fsPath: '/mock/workspace/src/test.ts',
          })
        );
      });

      it('should handle absolute file paths', () => {
        receiveMessageCallback({
          type: 'openFile',
          file: '/absolute/path/test.ts',
        });

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
          'vscode.open',
          expect.objectContaining({
            fsPath: '/absolute/path/test.ts',
          })
        );
      });
    });
  });

  describe('dispose', () => {
    it('should dispose panel', () => {
      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      const provider = (DiffReviewProvider as any).currentPanel;
      provider.dispose();

      expect(mockPanel.dispose).toHaveBeenCalled();
      expect((DiffReviewProvider as any).currentPanel).toBeUndefined();
    });

    it('should dispose all disposables', () => {
      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      const onDidDisposeMock = vi.fn();
      mockPanel.onDidDispose.mockImplementation((callback: any) => {
        onDidDisposeMock.mockImplementation(callback);
        return { dispose: vi.fn() };
      });

      const provider = (DiffReviewProvider as any).currentPanel;

      // Trigger dispose callback
      if (onDidDisposeMock.mock.calls.length > 0) {
        onDidDisposeMock.mock.calls[0][0]();
      }

      expect((DiffReviewProvider as any).currentPanel).toBeUndefined();
    });
  });

  describe('HTML generation', () => {
    it('should generate HTML with CSP nonce', () => {
      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      expect(mockPanel.webview.html).toContain('nonce-');
    });

    it('should include diff data in HTML', () => {
      const diffData: DiffData = {
        files: [
          {
            path: 'test.ts',
            added: 10,
            deleted: 5,
            hunks: [],
          },
        ],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      expect(mockPanel.webview.html).toContain('test.ts');
    });

    it('should include script URI', () => {
      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      expect(mockPanel.webview.html).toContain('script');
    });

    it('should include styles URI', () => {
      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      expect(mockPanel.webview.html).toContain('stylesheet');
    });
  });

  describe('edge cases', () => {
    it('should handle empty diff data', () => {
      const diffData: DiffData = {
        files: [],
      };

      expect(() =>
        DiffReviewProvider.show(mockExtensionUri, diffData)
      ).not.toThrow();
    });

    it('should handle missing workspace folder', () => {
      vi.mocked(vscode.workspace.workspaceFolders).setValue(undefined);

      const diffData: DiffData = {
        files: [],
      };

      expect(() =>
        DiffReviewProvider.show(mockExtensionUri, diffData)
      ).not.toThrow();
    });

    it('should handle file operations without workspace', () => {
      vi.mocked(vscode.workspace.workspaceFolders).setValue(undefined);

      const diffData: DiffData = {
        files: [],
      };

      DiffReviewProvider.show(mockExtensionUri, diffData);

      const receiveMessageCallback = vi.mocked(
        mockPanel.webview.onDidReceiveMessage
      ).mock.calls[0][0];

      receiveMessageCallback({
        type: 'openFile',
        file: '/absolute/path/test.ts',
      });

      expect(vscode.commands.executeCommand).toHaveBeenCalled();
    });
  });
});
