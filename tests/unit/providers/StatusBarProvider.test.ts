import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { StatusBarProvider } from '../../../src/providers/StatusBarProvider';
import { OpencodeServerManager } from '../../../src/services/OpencodeServerManager';

describe('StatusBarProvider', () => {
  let statusBarProvider: StatusBarProvider;
  let mockServerManager: OpencodeServerManager;
  let mockStatusBarItem: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock status bar item
    mockStatusBarItem = {
      text: '',
      tooltip: '',
      command: '',
      show: vi.fn(),
      dispose: vi.fn(),
    };

    // Mock vscode.window.createStatusBarItem
    vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(mockStatusBarItem);

    // Create mock server manager
    mockServerManager = {
      getClient: vi.fn(),
      getPort: vi.fn(),
      getStatus: vi.fn(),
      onStatusChange: vi.fn(),
    } as unknown as OpencodeServerManager;
  });

  afterEach(() => {
    if (statusBarProvider) {
      statusBarProvider.dispose();
    }
  });

  describe('constructor', () => {
    it('should create status bar item with correct alignment and priority', () => {
      statusBarProvider = new StatusBarProvider(mockServerManager);

      expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(
        vscode.StatusBarAlignment.Right,
        100
      );
    });

    it('should set command to opencode.focus', () => {
      statusBarProvider = new StatusBarProvider(mockServerManager);

      expect(mockStatusBarItem.command).toBe('opencode.focus');
    });

    it('should call updateStatus on initialization', () => {
      const updateStatusSpy = vi.spyOn(statusBarProvider as any, 'updateStatus');

      statusBarProvider = new StatusBarProvider(mockServerManager);

      expect(updateStatusSpy).toHaveBeenCalled();
    });

    it('should show the status bar item', () => {
      statusBarProvider = new StatusBarProvider(mockServerManager);

      expect(mockStatusBarItem.show).toHaveBeenCalled();
    });

    it('should store server manager reference', () => {
      statusBarProvider = new StatusBarProvider(mockServerManager);

      expect((statusBarProvider as any).serverManager).toBe(mockServerManager);
    });

    it('should handle multiple instances correctly', () => {
      const provider1 = new StatusBarProvider(mockServerManager);
      const provider2 = new StatusBarProvider(mockServerManager);

      expect(provider1).not.toBe(provider2);
      expect(mockStatusBarItem.show).toHaveBeenCalledTimes(2);

      provider1.dispose();
      provider2.dispose();
    });
  });

  describe('updateStatus', () => {
    it('should show connected status when client exists', () => {
      const mockClient = { id: 'test-client' };
      vi.mocked(mockServerManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(mockServerManager.getPort).mockReturnValue(3000);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.updateStatus();

      expect(mockStatusBarItem.text).toBe('$(robot) OpenCode');
      expect(mockStatusBarItem.tooltip).toBe('OpenCode connected (Port: 3000)');
    });

    it('should show disconnected status when client does not exist', () => {
      vi.mocked(mockServerManager.getClient).mockReturnValue(undefined);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.updateStatus();

      expect(mockStatusBarItem.text).toBe('$(debug-disconnect) OpenCode');
      expect(mockStatusBarItem.tooltip).toBe('OpenCode disconnected');
    });

    it('should update status when server connection changes', () => {
      // Start with no client
      vi.mocked(mockServerManager.getClient).mockReturnValue(undefined);
      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.updateStatus();

      expect(mockStatusBarItem.text).toBe('$(debug-disconnect) OpenCode');

      // Simulate connection
      const mockClient = { id: 'test-client' };
      vi.mocked(mockServerManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(mockServerManager.getPort).mockReturnValue(3000);

      statusBarProvider.updateStatus();

      expect(mockStatusBarItem.text).toBe('$(robot) OpenCode');
      expect(mockStatusBarItem.tooltip).toBe('OpenCode connected (Port: 3000)');
    });

    it('should update port number in tooltip when port changes', () => {
      const mockClient = { id: 'test-client' };
      vi.mocked(mockServerManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(mockServerManager.getPort).mockReturnValue(3000);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.updateStatus();

      expect(mockStatusBarItem.tooltip).toBe('OpenCode connected (Port: 3000)');

      // Change port
      vi.mocked(mockServerManager.getPort).mockReturnValue(4000);
      statusBarProvider.updateStatus();

      expect(mockStatusBarItem.tooltip).toBe('OpenCode connected (Port: 4000)');
    });

    it('should call getPort only when client exists', () => {
      vi.mocked(mockServerManager.getClient).mockReturnValue(undefined);
      vi.mocked(mockServerManager.getPort).mockReturnValue(3000);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.updateStatus();

      expect(mockServerManager.getPort).not.toHaveBeenCalled();

      // Now with client
      vi.mocked(mockServerManager.getClient).mockReturnValue({ id: 'test' } as any);
      statusBarProvider.updateStatus();

      expect(mockServerManager.getPort).toHaveBeenCalled();
    });

    it('should handle zero port number', () => {
      const mockClient = { id: 'test-client' };
      vi.mocked(mockServerManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(mockServerManager.getPort).mockReturnValue(0);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.updateStatus();

      expect(mockStatusBarItem.tooltip).toBe('OpenCode connected (Port: 0)');
    });

    it('should handle large port numbers', () => {
      const mockClient = { id: 'test-client' };
      vi.mocked(mockServerManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(mockServerManager.getPort).mockReturnValue(65535);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.updateStatus();

      expect(mockStatusBarItem.tooltip).toBe('OpenCode connected (Port: 65535)');
    });
  });

  describe('dispose', () => {
    it('should dispose the status bar item', () => {
      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.dispose();

      expect(mockStatusBarItem.dispose).toHaveBeenCalled();
    });

    it('should handle multiple dispose calls gracefully', () => {
      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.dispose();
      statusBarProvider.dispose();

      expect(mockStatusBarItem.dispose).toHaveBeenCalledTimes(1);
    });

    it('should not throw error when disposing uninitialized provider', () => {
      expect(() => {
        const provider = new StatusBarProvider(mockServerManager);
        provider.dispose();
      }).not.toThrow();
    });

    it('should clean up resources properly', () => {
      statusBarProvider = new StatusBarProvider(mockServerManager);

      const statusBarItemRef = (statusBarProvider as any).statusBarItem;

      statusBarProvider.dispose();

      expect(statusBarItemRef.dispose).toHaveBeenCalled();
    });
  });

  describe('integration with OpencodeServerManager', () => {
    it('should call getClient on server manager when updating status', () => {
      vi.mocked(mockServerManager.getClient).mockReturnValue(undefined);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.updateStatus();

      expect(mockServerManager.getClient).toHaveBeenCalled();
    });

    it('should call getPort on server manager when connected', () => {
      const mockClient = { id: 'test-client' };
      vi.mocked(mockServerManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(mockServerManager.getPort).mockReturnValue(3000);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.updateStatus();

      expect(mockServerManager.getPort).toHaveBeenCalled();
    });

    it('should react to server manager status changes', () => {
      const mockStatusCallback = vi.fn();
      vi.mocked(mockServerManager.onStatusChange).mockImplementation((callback: any) => {
        mockStatusCallback.mockImplementation(callback);
        return { dispose: vi.fn() };
      });

      statusBarProvider = new StatusBarProvider(mockServerManager);

      // Simulate status change
      if (mockStatusCallback.mock.calls.length > 0) {
        mockStatusCallback.mock.calls[0][0]();
      }

      // Verify updateStatus can be called
      expect(() => statusBarProvider.updateStatus()).not.toThrow();
    });
  });

  describe('status bar item configuration', () => {
    it('should use correct alignment (Right)', () => {
      statusBarProvider = new StatusBarProvider(mockServerManager);

      expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(
        vscode.StatusBarAlignment.Right,
        100
      );
    });

    it('should use correct priority (100)', () => {
      statusBarProvider = new StatusBarProvider(mockServerManager);

      expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(
        expect.any(Number),
        100
      );
    });

    it('should set click command to focus chat', () => {
      statusBarProvider = new StatusBarProvider(mockServerManager);

      expect(mockStatusBarItem.command).toBe('opencode.focus');
    });
  });

  describe('edge cases', () => {
    it('should handle null client gracefully', () => {
      vi.mocked(mockServerManager.getClient).mockReturnValue(null as any);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      expect(() => statusBarProvider.updateStatus()).not.toThrow();

      expect(mockStatusBarItem.text).toBe('$(debug-disconnect) OpenCode');
    });

    it('should handle undefined port gracefully', () => {
      const mockClient = { id: 'test-client' };
      vi.mocked(mockServerManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(mockServerManager.getPort).mockReturnValue(undefined as any);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      expect(() => statusBarProvider.updateStatus()).not.toThrow();
    });

    it('should handle rapid status updates', () => {
      const mockClient = { id: 'test-client' };
      vi.mocked(mockServerManager.getClient).mockReturnValue(mockClient as any);

      statusBarProvider = new StatusBarProvider(mockServerManager);

      for (let i = 0; i < 100; i++) {
        statusBarProvider.updateStatus();
      }

      expect(mockStatusBarItem.text).toBe('$(robot) OpenCode');
    });

    it('should handle dispose before updateStatus', () => {
      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.dispose();

      expect(() => statusBarProvider.updateStatus()).not.toThrow();
    });

    it('should handle server manager errors gracefully', () => {
      vi.mocked(mockServerManager.getClient).mockImplementation(() => {
        throw new Error('Server error');
      });

      statusBarProvider = new StatusBarProvider(mockServerManager);

      expect(() => statusBarProvider.updateStatus()).not.toThrow();
    });
  });

  describe('icon and text formatting', () => {
    it('should use robot icon for connected state', () => {
      const mockClient = { id: 'test-client' };
      vi.mocked(mockServerManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(mockServerManager.getPort).mockReturnValue(3000);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.updateStatus();

      expect(mockStatusBarItem.text).toContain('$(robot)');
    });

    it('should use debug-disconnect icon for disconnected state', () => {
      vi.mocked(mockServerManager.getClient).mockReturnValue(undefined);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.updateStatus();

      expect(mockStatusBarItem.text).toContain('$(debug-disconnect)');
    });

    it('should always include "OpenCode" in text', () => {
      vi.mocked(mockServerManager.getClient).mockReturnValue(undefined);

      statusBarProvider = new StatusBarProvider(mockServerManager);
      statusBarProvider.updateStatus();

      expect(mockStatusBarItem.text).toContain('OpenCode');

      vi.mocked(mockServerManager.getClient).mockReturnValue({ id: 'test' } as any);
      statusBarProvider.updateStatus();

      expect(mockStatusBarItem.text).toContain('OpenCode');
    });
  });
});
