/**
 * Comprehensive unit tests for SessionService
 * Target: 100% coverage (lines, branches, functions, statements)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionService } from '../../../src/services/SessionService';
import { OpencodeServerManager } from '../../../src/services/OpencodeServerManager';
import * as vscode from 'vscode';
import type { Session } from '@opencode-ai/sdk';

// Mock vscode FIRST before any imports that might use it
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn((section: string) => {
      const defaultConfig: Record<string, any> = {
        opencode: {
          persistSessions: true,
          serverPort: 0,
          logging: {
            level: 'info',
          },
        },
      };

      const config = section
        ? (defaultConfig[section] || {})
        : defaultConfig;

      return {
        get: vi.fn((key: string, defaultValue?: any) => {
          if (key && config[key] !== undefined) {
            return config[key];
          }
          return defaultValue;
        }),
        update: vi.fn(),
      };
    }),
    workspaceFolders: undefined,
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
}));

// Mock @opencode-ai/sdk
vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(),
}));

describe('SessionService', () => {
  let service: SessionService;
  let mockContext: any;
  let mockServerManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create mock context with workspaceState
    mockContext = {
      workspaceState: {
        get: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
      },
      globalState: {
        get: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
      },
      subscriptions: [],
    };

    // Create mock server manager
    mockServerManager = {
      ensureRunning: vi.fn(),
      getClient: vi.fn(),
      getPort: vi.fn(),
      getStatus: vi.fn(),
    };

    // Setup default mock client
    const mockClient = {
      session: {
        create: vi.fn(),
        get: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
        messages: vi.fn(),
      },
    };

    mockServerManager.ensureRunning.mockResolvedValue(mockClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with provided context and serverManager', () => {
      service = new SessionService(mockContext, mockServerManager);
      expect(service).toBeInstanceOf(SessionService);
    });

    it('should start loading persisted state asynchronously', async () => {
      mockContext.workspaceState.get.mockImplementation((key: string) => {
        if (key === 'opencode.sessions') return [];
        if (key === 'opencode.currentSessionId') return undefined;
        return undefined;
      });

      service = new SessionService(mockContext, mockServerManager);

      // Initialization should be in progress
      await vi.advanceTimersByTimeAsync(0);

      // Should have loaded state
      expect(mockContext.workspaceState.get).toHaveBeenCalledWith('opencode.sessions', []);
    });

    it('should respect persistSessions configuration', async () => {
      const originalMock = vscode.workspace.getConfiguration;
      (vscode.workspace.getConfiguration as any).mockImplementation((section: string) => {
        return {
          get: vi.fn((key: string, defaultValue?: any) => {
            if (key === 'persistSessions') return false;
            return defaultValue;
          }),
          update: vi.fn(),
        };
      });

      mockContext.workspaceState.get.mockReturnValue([]);

      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);

      // Should not load state when persistSessions is false
      expect(mockContext.workspaceState.get).not.toHaveBeenCalled();

      // Reset to default
      (vscode.workspace.getConfiguration as any).mockImplementation(originalMock);
    });

    it('should restore previous current session on initialization', async () => {
      const mockSession: Session = {
        id: 'session-123',
        title: 'Test Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      // Create the mock client first
      const mockClient = {
        session: {
          create: vi.fn(),
          get: vi.fn(),
          list: vi.fn(),
          delete: vi.fn(),
          update: vi.fn(),
          messages: vi.fn(),
        },
      };

      mockClient.session.get.mockResolvedValue({
        data: mockSession,
        response: { status: 200 },
      });

      mockServerManager.ensureRunning.mockResolvedValue(mockClient);

      mockContext.workspaceState.get.mockImplementation((key: string) => {
        if (key === 'opencode.sessions') return [mockSession];
        if (key === 'opencode.currentSessionId') return 'session-123';
        return undefined;
      });

      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);

      // Should try to restore the session
      expect(mockClient.session.get).toHaveBeenCalledWith({
        path: { id: 'session-123' },
      });
    });

    it('should handle missing session on server during initialization', async () => {
      const mockSession: Session = {
        id: 'session-123',
        title: 'Test Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      // Create the mock client first
      const mockClient = {
        session: {
          create: vi.fn(),
          get: vi.fn(),
          list: vi.fn(),
          delete: vi.fn(),
          update: vi.fn(),
          messages: vi.fn(),
        },
      };

      mockClient.session.get.mockRejectedValue(new Error('Not found'));
      mockClient.session.create.mockResolvedValue({
        data: {
          id: 'new-session',
          title: 'New Session',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        response: { status: 200 },
      });

      mockServerManager.ensureRunning.mockResolvedValue(mockClient);

      mockContext.workspaceState.get.mockImplementation((key: string) => {
        if (key === 'opencode.sessions') return [mockSession];
        if (key === 'opencode.currentSessionId') return 'session-123';
        return undefined;
      });

      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);

      // Should fall back to local session
      const currentSession = await service.getCurrentSession();
      expect(currentSession.id).toBe('new-session'); // Will create new session since switch failed
    });
  });

  describe('createNewSession', () => {
    beforeEach(async () => {
      mockContext.workspaceState.get.mockReturnValue([]);
      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);
    });

    it('should create a new session with provided title', async () => {
      const mockSession: Session = {
        id: 'new-session-123',
        title: 'My Custom Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.create.mockResolvedValue({
        data: mockSession,
        response: { status: 200 },
      });

      const result = await service.createNewSession('My Custom Session');

      expect(result).toEqual(mockSession);
      expect(mockClient.session.create).toHaveBeenCalledWith({
        body: { title: 'My Custom Session' },
      });
      expect(mockContext.workspaceState.update).toHaveBeenCalled();
    });

    it('should create a new session with auto-generated title', async () => {
      const mockSession: Session = {
        id: 'new-session-123',
        title: 'Session 12:00:00',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.create.mockResolvedValue({
        data: mockSession,
        response: { status: 200 },
      });

      const result = await service.createNewSession();

      expect(result).toEqual(mockSession);
      expect(mockClient.session.create).toHaveBeenCalledWith({
        body: { title: expect.stringMatching(/Session \d{2}:\d{2}:\d{2}/) },
      });
    });

    it('should add new session to history', async () => {
      const mockSession: Session = {
        id: 'new-session-123',
        title: 'New Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.create.mockResolvedValue({
        data: mockSession,
        response: { status: 200 },
      });

      await service.createNewSession('New Session');
      const sessions = await service.listSessions();

      expect(sessions).toContainEqual(mockSession);
    });

    it('should not add duplicate session to history', async () => {
      const existingSession: Session = {
        id: 'existing-123',
        title: 'Existing Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      // Manually add to history
      (service as any).sessionHistory = [existingSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.create.mockResolvedValue({
        data: existingSession,
        response: { status: 200 },
      });

      await service.createNewSession('Existing Session');
      const sessions = await service.listSessions();

      expect(sessions.length).toBe(1);
    });

    it('should throw error when server fails to create session', async () => {
      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.create.mockResolvedValue({
        data: null,
        error: { message: 'Server error' },
        response: { status: 500 },
      });

      await expect(service.createNewSession('Test')).rejects.toThrow('Failed to create session');
    });

    it('should handle error response with errors array', async () => {
      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.create.mockResolvedValue({
        data: null,
        error: {
          errors: [{ message: 'Validation failed' }],
        },
        response: { status: 400 },
      });

      await expect(service.createNewSession('Test')).rejects.toThrow('Validation failed');
    });
  });

  describe('getCurrentSession', () => {
    it('should wait for initialization before returning session', async () => {
      let initializationComplete = false;

      mockContext.workspaceState.get.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            initializationComplete = true;
            resolve([]);
          }, 100);
        });
      });

      service = new SessionService(mockContext, mockServerManager);

      // Should not have session yet
      expect(initializationComplete).toBe(false);

      // Wait for initialization
      await vi.advanceTimersByTimeAsync(100);
      expect(initializationComplete).toBe(true);

      // Now getCurrentSession should work
      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.create.mockResolvedValue({
        data: {
          id: 'new-session',
          title: 'New Session',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        response: { status: 200 },
      });

      const session = await service.getCurrentSession();
      expect(session).toBeDefined();
    });

    it('should return existing current session if available', async () => {
      const mockSession: Session = {
        id: 'existing-123',
        title: 'Existing Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      mockContext.workspaceState.get.mockReturnValue([]);

      service = new SessionService(mockContext, mockServerManager);
      (service as any).currentSession = mockSession;

      const result = await service.getCurrentSession();
      expect(result).toEqual(mockSession);
    });

    it('should create new session if none exists', async () => {
      mockContext.workspaceState.get.mockReturnValue([]);

      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);

      const mockSession: Session = {
        id: 'new-123',
        title: 'New Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.create.mockResolvedValue({
        data: mockSession,
        response: { status: 200 },
      });

      const result = await service.getCurrentSession();
      expect(result).toEqual(mockSession);
      expect(mockClient.session.create).toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    beforeEach(async () => {
      mockContext.workspaceState.get.mockReturnValue([]);
      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);
    });

    it('should merge server and local sessions', async () => {
      const localSession: Session = {
        id: 'local-123',
        title: 'Local Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const serverSession: Session = {
        id: 'server-456',
        title: 'Server Session',
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };

      // Add local session
      (service as any).sessionHistory = [localSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.list.mockResolvedValue({
        data: [serverSession],
        response: { status: 200 },
      });

      const result = await service.listSessions();

      expect(result.length).toBe(2);
      expect(result).toContainEqual(localSession);
      expect(result).toContainEqual(serverSession);
    });

    it('should prioritize server sessions over local with same ID', async () => {
      const localSession: Session = {
        id: 'shared-123',
        title: 'Local Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const serverSession: Session = {
        id: 'shared-123',
        title: 'Server Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };

      (service as any).sessionHistory = [localSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.list.mockResolvedValue({
        data: [serverSession],
        response: { status: 200 },
      });

      const result = await service.listSessions();

      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Server Title');
    });

    it('should preserve local-only sessions', async () => {
      const localSession: Session = {
        id: 'local-only-123',
        title: 'Local Only',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [localSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.list.mockResolvedValue({
        data: [],
        response: { status: 200 },
      });

      const result = await service.listSessions();

      expect(result).toContainEqual(localSession);
    });

    it('should fall back to local sessions on server error', async () => {
      const localSession: Session = {
        id: 'local-123',
        title: 'Local Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [localSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.list.mockRejectedValue(new Error('Server error'));

      const result = await service.listSessions();

      expect(result).toContainEqual(localSession);
    });

    it('should persist merged sessions', async () => {
      const mockSession: Session = {
        id: 'test-123',
        title: 'Test Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.list.mockResolvedValue({
        data: [mockSession],
        response: { status: 200 },
      });

      await service.listSessions();

      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'opencode.sessions',
        expect.any(Array)
      );
    });

    it('should wait for initialization before listing', async () => {
      let initialized = false;

      mockContext.workspaceState.get.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            initialized = true;
            resolve([]);
          }, 100);
        });
      });

      service = new SessionService(mockContext, mockServerManager);

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.list.mockResolvedValue({
        data: [],
        response: { status: 200 },
      });

      const listPromise = service.listSessions();
      expect(initialized).toBe(false);

      await vi.advanceTimersByTimeAsync(100);
      await listPromise;

      expect(initialized).toBe(true);
    });
  });

  describe('switchSession', () => {
    beforeEach(async () => {
      mockContext.workspaceState.get.mockReturnValue([]);
      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);
    });

    it('should fetch session from server and set as current', async () => {
      const mockSession: Session = {
        id: 'target-123',
        title: 'Target Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.get.mockResolvedValue({
        data: mockSession,
        response: { status: 200 },
      });

      const result = await service.switchSession('target-123');

      expect(result).toEqual(mockSession);
      expect((service as any).currentSession).toEqual(mockSession);
      expect(mockClient.session.get).toHaveBeenCalledWith({
        path: { id: 'target-123' },
      });
    });

    it('should persist current session ID after switching', async () => {
      const mockSession: Session = {
        id: 'target-123',
        title: 'Target Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.get.mockResolvedValue({
        data: mockSession,
        response: { status: 200 },
      });

      await service.switchSession('target-123');

      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'opencode.currentSessionId',
        'target-123'
      );
    });

    it('should fall back to local session on server error', async () => {
      const localSession: Session = {
        id: 'local-123',
        title: 'Local Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [localSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.get.mockRejectedValue(new Error('Not found'));

      const result = await service.switchSession('local-123');

      expect(result).toEqual(localSession);
      expect((service as any).currentSession).toEqual(localSession);
    });

    it('should throw error when session not found locally or on server', async () => {
      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.get.mockRejectedValue(new Error('Not found'));

      await expect(service.switchSession('nonexistent-123')).rejects.toThrow();
    });
  });

  describe('deleteSession', () => {
    beforeEach(async () => {
      mockContext.workspaceState.get.mockReturnValue([]);
      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);
    });

    it('should delete session from server and local cache', async () => {
      const mockSession: Session = {
        id: 'delete-123',
        title: 'Delete Me',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [mockSession];
      (service as any).currentSession = mockSession;

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.delete.mockResolvedValue({
        response: { status: 200 },
      });

      await service.deleteSession('delete-123');

      expect(mockClient.session.delete).toHaveBeenCalledWith({
        path: { id: 'delete-123' },
      });
      expect((service as any).sessionHistory).not.toContainEqual(mockSession);
      expect((service as any).currentSession).toBeNull();
    });

    it('should clear current session if deleting active session', async () => {
      const mockSession: Session = {
        id: 'current-123',
        title: 'Current Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [mockSession];
      (service as any).currentSession = mockSession;

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.delete.mockResolvedValue({
        response: { status: 200 },
      });

      await service.deleteSession('current-123');

      expect((service as any).currentSession).toBeNull();
    });

    it('should not clear current session if deleting different session', async () => {
      const currentSession: Session = {
        id: 'current-123',
        title: 'Current Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const otherSession: Session = {
        id: 'other-456',
        title: 'Other Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [currentSession, otherSession];
      (service as any).currentSession = currentSession;

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.delete.mockResolvedValue({
        response: { status: 200 },
      });

      await service.deleteSession('other-456');

      expect((service as any).currentSession).toEqual(currentSession);
    });

    it('should delete cached messages', async () => {
      const mockSession: Session = {
        id: 'delete-123',
        title: 'Delete Me',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [mockSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.delete.mockResolvedValue({
        response: { status: 200 },
      });

      await service.deleteSession('delete-123');

      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'opencode.session.messages.delete-123',
        undefined
      );
    });

    it('should handle server deletion failures gracefully', async () => {
      const mockSession: Session = {
        id: 'delete-123',
        title: 'Delete Me',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [mockSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.delete.mockRejectedValue(new Error('Server error'));

      await expect(service.deleteSession('delete-123')).resolves.not.toThrow();

      // Should still remove from local cache
      expect((service as any).sessionHistory).not.toContainEqual(mockSession);
    });

    it('should persist state after deletion', async () => {
      const mockSession: Session = {
        id: 'delete-123',
        title: 'Delete Me',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [mockSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.delete.mockResolvedValue({
        response: { status: 200 },
      });

      await service.deleteSession('delete-123');

      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'opencode.sessions',
        []
      );
    });
  });

  describe('renameSession', () => {
    beforeEach(async () => {
      mockContext.workspaceState.get.mockReturnValue([]);
      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);
    });

    it('should rename session on server and update local state', async () => {
      const originalSession: Session = {
        id: 'rename-123',
        title: 'Original Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const updatedSession: Session = {
        id: 'rename-123',
        title: 'New Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };

      (service as any).sessionHistory = [originalSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.update.mockResolvedValue({
        data: updatedSession,
        response: { status: 200 },
      });

      const result = await service.renameSession('rename-123', 'New Title');

      expect(result).toEqual(updatedSession);
      expect(mockClient.session.update).toHaveBeenCalledWith({
        path: { id: 'rename-123' },
        body: { title: 'New Title' },
      });
    });

    it('should update session in history', async () => {
      const originalSession: Session = {
        id: 'rename-123',
        title: 'Original Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const updatedSession: Session = {
        id: 'rename-123',
        title: 'New Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };

      (service as any).sessionHistory = [originalSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.update.mockResolvedValue({
        data: updatedSession,
        response: { status: 200 },
      });

      await service.renameSession('rename-123', 'New Title');

      expect((service as any).sessionHistory[0].title).toBe('New Title');
    });

    it('should update current session if renaming active session', async () => {
      const originalSession: Session = {
        id: 'current-123',
        title: 'Original Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const updatedSession: Session = {
        id: 'current-123',
        title: 'New Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };

      (service as any).sessionHistory = [originalSession];
      (service as any).currentSession = originalSession;

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.update.mockResolvedValue({
        data: updatedSession,
        response: { status: 200 },
      });

      await service.renameSession('current-123', 'New Title');

      expect((service as any).currentSession.title).toBe('New Title');
    });

    it('should throw error when server fails to rename', async () => {
      const mockSession: Session = {
        id: 'rename-123',
        title: 'Original Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [mockSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.update.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
        response: { status: 500 },
      });

      await expect(service.renameSession('rename-123', 'New Title')).rejects.toThrow(
        'Failed to rename session'
      );
    });

    it('should update local state even when server fails (optimistic update)', async () => {
      const originalSession: Session = {
        id: 'rename-123',
        title: 'Original Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [originalSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.update.mockRejectedValue(new Error('Network error'));

      const result = await service.renameSession('rename-123', 'New Title');

      expect(result.title).toBe('New Title');
      expect((service as any).sessionHistory[0].title).toBe('New Title');
    });

    it('should persist state after renaming', async () => {
      const originalSession: Session = {
        id: 'rename-123',
        title: 'Original Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const updatedSession: Session = {
        id: 'rename-123',
        title: 'New Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };

      (service as any).sessionHistory = [originalSession];

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.update.mockResolvedValue({
        data: updatedSession,
        response: { status: 200 },
      });

      await service.renameSession('rename-123', 'New Title');

      expect(mockContext.workspaceState.update).toHaveBeenCalled();
    });
  });

  describe('getMessages', () => {
    beforeEach(async () => {
      mockContext.workspaceState.get.mockReturnValue([]);
      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);
    });

    it('should fetch messages from server and merge with local', async () => {
      const localMessages = [
        { id: 'msg-1', content: 'Local message' },
      ];

      const serverMessages = [
        { id: 'msg-2', content: 'Server message' },
      ];

      mockContext.workspaceState.get.mockImplementation((key: string) => {
        if (key === 'opencode.session.messages.session-123') {
          return localMessages;
        }
        return undefined;
      });

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.messages.mockResolvedValue({
        data: serverMessages,
        response: { status: 200 },
      });

      const result = await service.getMessages('session-123');

      expect(result).toEqual(serverMessages);
      expect(mockClient.session.messages).toHaveBeenCalledWith({
        path: { id: 'session-123' },
      });
    });

    it('should fall back to local messages on server error', async () => {
      const localMessages = [
        { id: 'msg-1', content: 'Local message' },
      ];

      mockContext.workspaceState.get.mockReturnValue(localMessages);

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.messages.mockRejectedValue(new Error('Server error'));

      const result = await service.getMessages('session-123');

      expect(result).toEqual(localMessages);
    });

    it('should return empty array when no messages exist', async () => {
      mockContext.workspaceState.get.mockReturnValue(undefined);

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.messages.mockRejectedValue(new Error('Not found'));

      const result = await service.getMessages('session-123');

      expect(result).toEqual([]);
    });

    it('should persist merged messages', async () => {
      const serverMessages = [
        { id: 'msg-1', content: 'Server message' },
      ];

      mockContext.workspaceState.get.mockReturnValue([]);

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.messages.mockResolvedValue({
        data: serverMessages,
        response: { status: 200 },
      });

      await service.getMessages('session-123');

      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'opencode.session.messages.session-123',
        expect.any(Array)
      );
    });

    it('should handle server returning no messages', async () => {
      const localMessages = [
        { id: 'msg-1', content: 'Local message' },
      ];

      mockContext.workspaceState.get.mockReturnValue(localMessages);

      const mockClient = await mockServerManager.ensureRunning();
      mockClient.session.messages.mockResolvedValue({
        data: null,
        response: { status: 200 },
      });

      const result = await service.getMessages('session-123');

      expect(result).toEqual(localMessages);
    });
  });

  describe('saveSessionMessages', () => {
    beforeEach(async () => {
      mockContext.workspaceState.get.mockReturnValue([]);
      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);
    });

    it('should save messages to workspace state', async () => {
      const messages = [
        { id: 'msg-1', content: 'Message 1' },
        { id: 'msg-2', content: 'Message 2' },
      ];

      await service.saveSessionMessages('session-123', messages);

      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'opencode.session.messages.session-123',
        messages
      );
    });

    it('should limit messages to MAX_CACHED_MESSAGES_PER_SESSION', async () => {
      // Create more messages than limit
      const messages = Array.from({ length: 250 }, (_, i) => ({
        id: `msg-${i}`,
        content: `Message ${i}`,
      }));

      await service.saveSessionMessages('session-123', messages);

      const savedMessages = (mockContext.workspaceState.update as any).mock.calls.find(
        (call: any[]) => call[0] === 'opencode.session.messages.session-123'
      )?.[1];

      expect(savedMessages.length).toBe(200);
    });

    it('should compact large messages to fit size limit', async () => {
      // Create messages that would exceed 4MB
      const largeContent = 'x'.repeat(100000); // 100KB per message
      const messages = Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i}`,
        content: largeContent,
      }));

      await service.saveSessionMessages('session-123', messages);

      // Should compact to fit within 4MB
      expect(mockContext.workspaceState.update).toHaveBeenCalled();
    });
  });

  describe('loadSessionMessages', () => {
    beforeEach(async () => {
      mockContext.workspaceState.get.mockReturnValue([]);
      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);
    });

    it('should load messages from workspace state', async () => {
      const messages = [
        { id: 'msg-1', content: 'Message 1' },
        { id: 'msg-2', content: 'Message 2' },
      ];

      mockContext.workspaceState.get.mockReturnValue(messages);

      const result = await service.loadSessionMessages('session-123');

      expect(result).toEqual(messages);
      expect(mockContext.workspaceState.get).toHaveBeenCalledWith(
        'opencode.session.messages.session-123'
      );
    });

    it('should return empty array when no messages cached', async () => {
      mockContext.workspaceState.get.mockReturnValue(undefined);

      const result = await service.loadSessionMessages('session-123');

      expect(result).toEqual([]);
    });

    it('should return empty array when cached value is not array', async () => {
      mockContext.workspaceState.get.mockReturnValue('not an array');

      const result = await service.loadSessionMessages('session-123');

      expect(result).toEqual([]);
    });
  });

  describe('appendMessage', () => {
    beforeEach(async () => {
      mockContext.workspaceState.get.mockReturnValue([]);
      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);
    });

    it('should append message to existing messages', async () => {
      const existingMessages = [
        { id: 'msg-1', content: 'Message 1' },
      ];

      const newMessage = { id: 'msg-2', content: 'Message 2' };

      mockContext.workspaceState.get.mockReturnValue(existingMessages);

      await service.appendMessage('session-123', newMessage);

      const savedMessages = (mockContext.workspaceState.update as any).mock.calls.find(
        (call: any[]) => call[0] === 'opencode.session.messages.session-123'
      )?.[1];

      expect(savedMessages).toEqual([...existingMessages, newMessage]);
    });

    it('should create new array if no messages exist', async () => {
      const newMessage = { id: 'msg-1', content: 'Message 1' };

      mockContext.workspaceState.get.mockReturnValue(undefined);

      await service.appendMessage('session-123', newMessage);

      const savedMessages = (mockContext.workspaceState.update as any).mock.calls.find(
        (call: any[]) => call[0] === 'opencode.session.messages.session-123'
      )?.[1];

      expect(savedMessages).toEqual([newMessage]);
    });
  });

  describe('upsertMessage', () => {
    beforeEach(async () => {
      mockContext.workspaceState.get.mockReturnValue([]);
      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);
    });

    it('should add new message if not exists', async () => {
      const existingMessages = [
        { id: 'msg-1', role: 'user', content: 'Message 1' },
      ];

      const newMessage = { id: 'msg-2', role: 'user', content: 'Message 2' };

      mockContext.workspaceState.get.mockReturnValue(existingMessages);

      await service.upsertMessage('session-123', newMessage);

      const savedMessages = (mockContext.workspaceState.update as any).mock.calls.find(
        (call: any[]) => call[0] === 'opencode.session.messages.session-123'
      )?.[1];

      expect(savedMessages.length).toBe(2);
    });

    it('should update existing message if found by signature', async () => {
      const existingMessages = [
        { id: 'msg-1', role: 'user', content: 'Old content' },
      ];

      const updatedMessage = { id: 'msg-1', role: 'user', content: 'New content' };

      mockContext.workspaceState.get.mockReturnValue(existingMessages);

      await service.upsertMessage('session-123', updatedMessage);

      const savedMessages = (mockContext.workspaceState.update as any).mock.calls.find(
        (call: any[]) => call[0] === 'opencode.session.messages.session-123'
      )?.[1];

      expect(savedMessages.length).toBe(1);
      expect(savedMessages[0].content).toBe('New content');
    });
  });

  describe('persistState', () => {
    it('should persist sessions and current session ID', async () => {
      mockContext.workspaceState.get.mockReturnValue([]);

      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);

      const mockSession: Session = {
        id: 'session-123',
        title: 'Test Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [mockSession];
      (service as any).currentSession = mockSession;

      (service as any).persistState();

      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'opencode.sessions',
        [mockSession]
      );
      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'opencode.currentSessionId',
        'session-123'
      );
    });

    it('should not persist when persistSessions is false', async () => {
      const originalMock = vscode.workspace.getConfiguration;
      (vscode.workspace.getConfiguration as any).mockImplementation((section: string) => {
        return {
          get: vi.fn((key: string, defaultValue?: any) => {
            if (key === 'persistSessions') return false;
            return defaultValue;
          }),
          update: vi.fn(),
        };
      });

      mockContext.workspaceState.get.mockReturnValue([]);

      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);

      const mockSession: Session = {
        id: 'session-123',
        title: 'Test Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [mockSession];
      (service as any).currentSession = mockSession;

      (service as any).persistState();

      expect(mockContext.workspaceState.update).not.toHaveBeenCalled();

      // Reset to default
      (vscode.workspace.getConfiguration as any).mockImplementation(originalMock);
    });

    it('should not persist current session ID if null', async () => {
      mockContext.workspaceState.get.mockReturnValue([]);

      service = new SessionService(mockContext, mockServerManager);
      await vi.advanceTimersByTimeAsync(0);

      const mockSession: Session = {
        id: 'session-123',
        title: 'Test Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (service as any).sessionHistory = [mockSession];
      (service as any).currentSession = null;

      (service as any).persistState();

      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'opencode.sessions',
        [mockSession]
      );

      // Should not call update for current session ID
      const updateCalls = (mockContext.workspaceState.update as any).mock.calls;
      const sessionIdUpdate = updateCalls.find(
        (call: any[]) => call[0] === 'opencode.currentSessionId'
      );
      expect(sessionIdUpdate).toBeUndefined();
    });
  });

  describe('MESSAGE_FALLBACK_ID constant', () => {
    it('should be defined', () => {
      expect(SessionService.MESSAGE_FALLBACK_ID).toBe('opencode.fallback');
    });
  });
});
