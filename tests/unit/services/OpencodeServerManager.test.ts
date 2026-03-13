/**
 * Comprehensive unit tests for OpencodeServerManager
 * Target: 100% coverage (lines, branches, functions, statements)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'vscode';
import { OpencodeServerManager } from '../../../src/services/OpencodeServerManager';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as net from 'net';

// Mock vscode
vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: vi.fn(),
  },
  EventEmitter: class MockEventEmitter<T> {
    private listeners: ((value: T) => void)[] = [];
    event = (callback: (value: T) => void) => {
      this.listeners.push(callback);
      return { dispose: () => {} };
    };
    fire = (value: T) => {
      this.listeners.forEach((listener) => listener(value));
    };
    dispose = vi.fn();
  },
  window: {
    showErrorMessage: vi.fn(),
  },
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

// Mock net
vi.mock('net', () => ({
  createServer: vi.fn(),
  Socket: vi.fn(),
}));

// Mock @opencode-ai/sdk
vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(),
}));

describe('OpencodeServerManager', () => {
  let manager: OpencodeServerManager;
  let mockContext: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock context
    mockContext = {
      globalState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      subscriptions: [],
    };

    // Setup default workspace
    (vscode.workspace.workspaceFolders as any) = [
      {
        uri: {
          scheme: 'file',
          fsPath: '/test/workspace',
        },
      },
    ];

    (vscode.workspace.getConfiguration as any).mockReturnValue({
      get: vi.fn((key: string, defaultValue: any) => {
        if (key === 'serverPort') return 0;
        return defaultValue;
      }),
    });

    manager = new OpencodeServerManager(mockContext);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with idle status', () => {
      expect(manager.getStatus()).toBe('idle');
    });

    it('should have no client initially', () => {
      expect(manager.getClient()).toBeNull();
    });

    it('should have port 0 initially', () => {
      expect(manager.getPort()).toBe(0);
    });

    it('should expose onStatusChange event', () => {
      expect(manager.onStatusChange).toBeDefined();
    });
  });

  describe('getPersistedManagedPort', () => {
    it('should return 0 when no port is persisted', () => {
      mockContext.globalState.get.mockReturnValue(0);
      // Access private method through reflection
      const port = (manager as any).getPersistedManagedPort();
      expect(port).toBe(0);
    });

    it('should return persisted port when valid', () => {
      mockContext.globalState.get.mockReturnValue(8080);
      const port = (manager as any).getPersistedManagedPort();
      expect(port).toBe(8080);
    });

    it('should return 0 for invalid port types', () => {
      mockContext.globalState.get.mockReturnValue('invalid');
      const port = (manager as any).getPersistedManagedPort();
      expect(port).toBe(0);
    });

    it('should return 0 for negative ports', () => {
      mockContext.globalState.get.mockReturnValue(-1);
      const port = (manager as any).getPersistedManagedPort();
      expect(port).toBe(0);
    });

    it('should floor decimal port numbers', () => {
      mockContext.globalState.get.mockReturnValue(8080.7);
      const port = (manager as any).getPersistedManagedPort();
      expect(port).toBe(8080);
    });
  });

  describe('persistManagedPort', () => {
    it('should persist valid port', async () => {
      mockContext.globalState.update.mockResolvedValue(undefined);
      await (manager as any).persistManagedPort(8080);
      expect(mockContext.globalState.update).toHaveBeenCalledWith(
        'opencode.server.lastManagedPort',
        8080
      );
    });

    it('should persist undefined for port 0', async () => {
      mockContext.globalState.update.mockResolvedValue(undefined);
      await (manager as any).persistManagedPort(0);
      expect(mockContext.globalState.update).toHaveBeenCalledWith(
        'opencode.server.lastManagedPort',
        undefined
      );
    });

    it('should floor port before persisting', async () => {
      mockContext.globalState.update.mockResolvedValue(undefined);
      await (manager as any).persistManagedPort(8080.9);
      expect(mockContext.globalState.update).toHaveBeenCalledWith(
        'opencode.server.lastManagedPort',
        8080
      );
    });

    it('should handle errors gracefully', async () => {
      mockContext.globalState.update.mockRejectedValue(new Error('Storage error'));
      await expect((manager as any).persistManagedPort(8080)).resolves.not.toThrow();
    });
  });

  describe('terminateProcessTree', () => {
    let mockProcess: any;

    beforeEach(() => {
      mockProcess = { pid: 12345 };
    });

    it('should use taskkill on Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      (cp.execSync as any).mockReturnValue('');

      (manager as any).terminateProcessTree(mockProcess);
      expect(cp.execSync).toHaveBeenCalledWith('taskkill /pid 12345 /T /F');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should use process.kill on Unix', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockProcess.kill = vi.fn();

      (manager as any).terminateProcessTree(mockProcess);
      expect(mockProcess.kill).toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should handle Windows taskkill errors gracefully', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      (cp.execSync as any).mockImplementation(() => {
        throw new Error('Taskkill failed');
      });

      expect(() => (manager as any).terminateProcessTree(mockProcess)).not.toThrow();

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should handle Unix kill errors gracefully', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockProcess.kill = vi.fn(() => {
        throw new Error('Kill failed');
      });

      expect(() => (manager as any).terminateProcessTree(mockProcess)).not.toThrow();

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('getWorkspaceDirectory', () => {
    it('should return workspace directory when available', () => {
      (vscode.workspace.workspaceFolders as any) = [
        {
          uri: {
            scheme: 'file',
            fsPath: '/test/workspace',
          },
        },
      ];

      const dir = (manager as any).getWorkspaceDirectory();
      expect(dir).toBe('/test/workspace');
    });

    it('should normalize Windows paths', () => {
      (vscode.workspace.workspaceFolders as any) = [
        {
          uri: {
            scheme: 'file',
            fsPath: 'C:\\Users\\Test\\workspace\\',
          },
        },
      ];

      const dir = (manager as any).getWorkspaceDirectory();
      expect(dir).toBe('C:/Users/Test/workspace');
    });

    it('should return undefined when no workspace', () => {
      (vscode.workspace.workspaceFolders as any) = undefined;
      const dir = (manager as any).getWorkspaceDirectory();
      expect(dir).toBeUndefined();
    });

    it('should return undefined for non-file schemes', () => {
      (vscode.workspace.workspaceFolders as any) = [
        {
          uri: {
            scheme: 'git',
            fsPath: '/test/workspace',
          },
        },
      ];

      const dir = (manager as any).getWorkspaceDirectory();
      expect(dir).toBeUndefined();
    });
  });

  describe('findAvailablePort', () => {
    it('should find an available port', async () => {
      const mockServer = {
        listen: vi.fn((port, callback) => callback()),
        address: vi.fn(() => ({ port: 12345 })),
        close: vi.fn((callback) => callback()),
      };

      (net.createServer as any).mockReturnValue(mockServer);

      const port = await (manager as any).findAvailablePort();
      expect(port).toBe(12345);
      expect(mockServer.listen).toHaveBeenCalledWith(0, expect.any(Function));
      expect(mockServer.close).toHaveBeenCalled();
    });
  });

  describe('isPortReachable', () => {
    it('should return true for reachable port', async () => {
      const mockSocket = {
        setTimeout: vi.fn(),
        once: vi.fn(),
        connect: vi.fn(),
        destroy: vi.fn(),
      };

      (net.Socket as any).mockImplementation(() => mockSocket);

      // Simulate successful connection
      mockSocket.once.mockImplementation((event, callback) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 10);
        }
      });

      const reachable = await (manager as any).isPortReachable(8080);
      expect(reachable).toBe(true);
    });

    it('should return false for unreachable port', async () => {
      const mockSocket = {
        setTimeout: vi.fn(),
        once: vi.fn(),
        connect: vi.fn(),
        destroy: vi.fn(),
      };

      (net.Socket as any).mockImplementation(() => mockSocket);

      // Simulate connection error
      mockSocket.once.mockImplementation((event, callback) => {
        if (event === 'error') {
          setTimeout(() => callback(), 10);
        }
      });

      const reachable = await (manager as any).isPortReachable(8080);
      expect(reachable).toBe(false);
    });

    it('should return false on timeout', async () => {
      const mockSocket = {
        setTimeout: vi.fn(),
        once: vi.fn(),
        connect: vi.fn(),
        destroy: vi.fn(),
      };

      (net.Socket as any).mockImplementation(() => mockSocket);

      // Simulate timeout
      mockSocket.once.mockImplementation((event, callback) => {
        if (event === 'timeout') {
          setTimeout(() => callback(), 10);
        }
      });

      const reachable = await (manager as any).isPortReachable(8080);
      expect(reachable).toBe(false);
    });

    it('should handle connection exceptions', async () => {
      const mockSocket = {
        setTimeout: vi.fn(),
        once: vi.fn(),
        connect: vi.fn(() => {
          throw new Error('Connection failed');
        }),
        destroy: vi.fn(),
      };

      (net.Socket as any).mockImplementation(() => mockSocket);

      const reachable = await (manager as any).isPortReachable(8080);
      expect(reachable).toBe(false);
    });

    it('should set 800ms timeout', async () => {
      const mockSocket = {
        setTimeout: vi.fn(),
        once: vi.fn(),
        connect: vi.fn(),
        destroy: vi.fn(),
      };

      (net.Socket as any).mockImplementation(() => mockSocket);

      mockSocket.once.mockImplementation((event, callback) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 10);
        }
      });

      await (manager as any).isPortReachable(8080);
      expect(mockSocket.setTimeout).toHaveBeenCalledWith(800);
    });
  });

  describe('setStatus', () => {
    it('should update status and fire event when changed', () => {
      const statusCallback = vi.fn();
      manager.onStatusChange(statusCallback);

      (manager as any).setStatus('starting');
      expect(manager.getStatus()).toBe('starting');
      expect(statusCallback).toHaveBeenCalledWith('starting');
    });

    it('should not fire event when status unchanged', () => {
      const statusCallback = vi.fn();
      manager.onStatusChange(statusCallback);

      (manager as any).setStatus('idle');
      expect(statusCallback).not.toHaveBeenCalled();
    });

    it('should fire event multiple times for different changes', () => {
      const statusCallback = vi.fn();
      manager.onStatusChange(statusCallback);

      (manager as any).setStatus('starting');
      (manager as any).setStatus('running');
      (manager as any).setStatus('error');

      expect(statusCallback).toHaveBeenCalledTimes(3);
      expect(statusCallback).toHaveBeenNthCalledWith(1, 'starting');
      expect(statusCallback).toHaveBeenNthCalledWith(2, 'running');
      expect(statusCallback).toHaveBeenNthCalledWith(3, 'error');
    });
  });

  describe('dispose', () => {
    it('should set isDisposed flag', () => {
      (manager as any).dispose();
      expect((manager as any).isDisposed).toBe(true);
    });

    it('should clear startup promise', async () => {
      const startupPromise = (manager as any).ensureRunning();
      (manager as any).dispose();
      expect((manager as any).startupPromise).toBeNull();
      await startupPromise;
    });

    it('should clear reconnect timer if set', () => {
      const mockTimer = setTimeout(() => {}, 5000);
      (manager as any).reconnectTimer = mockTimer;

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      (manager as any).dispose();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimer);
      expect((manager as any).reconnectTimer).toBeNull();

      clearTimeoutSpy.mockRestore();
    });

    it('should terminate server process if running', () => {
      const mockProcess = { pid: 12345 };
      (manager as any).serverProcess = mockProcess;

      const terminateSpy = vi.spyOn(manager as any, 'terminateProcessTree');
      (manager as any).dispose();

      expect(terminateSpy).toHaveBeenCalledWith(mockProcess);
      expect((manager as any).serverProcess).toBeNull();
    });

    it('should clear client and port', () => {
      (manager as any).client = { mock: 'client' };
      (manager as any).port = 8080;

      (manager as any).dispose();

      expect((manager as any).client).toBeNull();
      expect((manager as any).port).toBe(0);
    });

    it('should reset status to idle', () => {
      (manager as any).setStatus('running');
      (manager as any).dispose();
      expect(manager.getStatus()).toBe('idle');
    });

    it('should dispose event emitter', () => {
      const disposeSpy = vi.spyOn((manager as any)._onStatusChange, 'dispose');
      (manager as any).dispose();
      expect(disposeSpy).toHaveBeenCalled();
    });
  });

  describe('fetchVersion', () => {
    it('should fetch and store version when client exists', async () => {
      const { createOpencodeClient } = require('@opencode-ai/sdk');
      const mockClient = createOpencodeClient({ baseUrl: 'http://localhost:8080' });

      (manager as any).client = mockClient;

      await (manager as any).fetchVersion();

      expect((manager as any).serverVersion).toBe('1.0.0-mock');
    });

    it('should handle missing client gracefully', async () => {
      (manager as any).client = null;
      await expect((manager as any).fetchVersion()).resolves.not.toThrow();
      expect((manager as any).serverVersion).toBeUndefined();
    });

    it('should handle fetch errors gracefully', async () => {
      const { createOpencodeClient } = require('@opencode-ai/sdk');
      const mockClient = createOpencodeClient({ baseUrl: 'http://localhost:8080' });

      // Mock health to throw error
      mockClient.global.health = async () => {
        throw new Error('Health check failed');
      };

      (manager as any).client = mockClient;

      await expect((manager as any).fetchVersion()).resolves.not.toThrow();
    });
  });

  describe('getVersion', () => {
    it('should return version when set', () => {
      (manager as any).serverVersion = '1.0.0';
      expect(manager.getVersion()).toBe('1.0.0');
    });

    it('should return undefined when not set', () => {
      expect(manager.getVersion()).toBeUndefined();
    });
  });

  describe('getClient', () => {
    it('should return client when set', () => {
      const mockClient = { mock: 'client' };
      (manager as any).client = mockClient;
      expect(manager.getClient()).toBe(mockClient);
    });

    it('should return null when not set', () => {
      expect(manager.getClient()).toBeNull();
    });
  });

  describe('getPort', () => {
    it('should return port when set', () => {
      (manager as any).port = 8080;
      expect(manager.getPort()).toBe(8080);
    });

    it('should return 0 when not set', () => {
      expect(manager.getPort()).toBe(0);
    });
  });
});
