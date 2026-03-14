/**
 * Comprehensive unit tests for MessageStreamService
 * Target: 100% coverage (lines, branches, functions, statements)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageStreamService } from '../../../src/services/MessageStreamService';
import type { OpencodeClient } from '@opencode-ai/sdk';
import * as vscode from 'vscode';

// Mock OpencodeServerManager
const mockServerManager = {
  ensureRunning: vi.fn(),
};

describe('MessageStreamService', () => {
  let service: MessageStreamService;
  let mockClient: OpencodeClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create mock client with event.subscribe method
    mockClient = {
      event: {
        subscribe: vi.fn(),
      },
      global: {
        event: vi.fn(),
      },
    } as unknown as OpencodeClient;

    mockServerManager.ensureRunning.mockResolvedValue(mockClient);

    // Mock vscode.workspace.workspaceFolders
    (vscode.workspace.workspaceFolders as any) = undefined;

    service = new MessageStreamService(mockServerManager as any);
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  describe('Constructor', () => {
    it('should create instance with serverManager', () => {
      expect(service).toBeInstanceOf(MessageStreamService);
      expect((service as any).serverManager).toBe(mockServerManager);
    });

    it('should NOT start listening automatically', () => {
      const startListeningSpy = vi.spyOn(service, 'startListening');
      new MessageStreamService(mockServerManager as any);
      expect(startListeningSpy).not.toHaveBeenCalled();
      startListeningSpy.mockRestore();
    });

    it('should initialize callbacks Set', () => {
      expect((service as any).callbacks).toBeInstanceOf(Set);
      expect((service as any).callbacks.size).toBe(0);
    });

    it('should initialize abortController to null', () => {
      expect((service as any).abortController).toBeNull();
    });

    it('should initialize reconnectTimer to null', () => {
      expect((service as any).reconnectTimer).toBeNull();
    });

    it('should initialize recentEventSignatures Map', () => {
      expect((service as any).recentEventSignatures).toBeInstanceOf(Map);
      expect((service as any).recentEventSignatures.size).toBe(0);
    });
  });

  describe('subscribe(callback)', () => {
    it('should add callback to callbacks Set', () => {
      const callback = vi.fn();
      service.subscribe(callback);

      expect((service as any).callbacks.has(callback)).toBe(true);
    });

    it('should auto-start listening when first subscriber joins', async () => {
      const startListeningSpy = vi.spyOn(service, 'startListening').mockResolvedValue();

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect(startListeningSpy).toHaveBeenCalled();
      startListeningSpy.mockRestore();
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('unsubscribe should remove callback', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      expect((service as any).callbacks.has(callback)).toBe(true);

      unsubscribe();

      expect((service as any).callbacks.has(callback)).toBe(false);
    });

    it('should auto-stop listening when last subscriber leaves', async () => {
      const startListeningSpy = vi.spyOn(service, 'startListening').mockResolvedValue();
      const stopListeningSpy = vi.spyOn(service, 'stopListening');

      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      unsubscribe();

      expect(stopListeningSpy).toHaveBeenCalled();
      startListeningSpy.mockRestore();
      stopListeningSpy.mockRestore();
    });

    it('should allow multiple subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      service.subscribe(callback1);
      service.subscribe(callback2);
      service.subscribe(callback3);

      expect((service as any).callbacks.size).toBe(3);
    });

    it('should dispatch events to all subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      service.subscribe(callback1);
      service.subscribe(callback2);
      service.subscribe(callback3);

      const testEvent = { type: 'test.event', properties: {} };
      (service as any).notifyCallbacks(testEvent);

      expect(callback1).toHaveBeenCalledWith(testEvent);
      expect(callback2).toHaveBeenCalledWith(testEvent);
      expect(callback3).toHaveBeenCalledWith(testEvent);
    });

    it('should not auto-start if already has subscribers', async () => {
      const startListeningSpy = vi.spyOn(service, 'startListening').mockResolvedValue();

      const callback1 = vi.fn();
      const callback2 = vi.fn();

      service.subscribe(callback1);
      await vi.runOnlyPendingTimersAsync();

      startListeningSpy.mockClear();

      service.subscribe(callback2);
      await vi.runOnlyPendingTimersAsync();

      expect(startListeningSpy).not.toHaveBeenCalled();
      startListeningSpy.mockRestore();
    });
  });

  describe('startListening()', () => {
    it('should get server port from serverManager', async () => {
      const mockStream = async function* () {
        yield ({ type: 'test', data: '{}' });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect(mockServerManager.ensureRunning).toHaveBeenCalled();
    });

    it('should stop existing connection before starting new one', async () => {
      const mockStream = async function* () {
        yield ({ type: 'test', data: '{}' });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const stopListeningSpy = vi.spyOn(service, 'stopListening');

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // First subscription should call stopListening to clean up
      expect(stopListeningSpy).toHaveBeenCalled();
      stopListeningSpy.mockRestore();
    });

    it('should create AbortController', async () => {
      const mockStream = async function* () {
        yield ({ type: 'test', data: '{}' });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect((service as any).abortController).toBeInstanceOf(AbortController);
    });

    it('should connect to SDK event.subscribe()', async () => {
      const mockStream = async function* () {
        yield ({ type: 'test', data: '{}' });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect(mockClient.event.subscribe).toHaveBeenCalled();
    });

    it('should handle workspace directory filtering', async () => {
      const mockStream = async function* () {
        yield ({ type: 'test', data: '{"type":"message.updated"}' });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      // Mock workspace folder
      (vscode.workspace.workspaceFolders as any) = [
        {
          uri: {
            scheme: 'file',
            fsPath: 'e:/projects/test',
          },
        },
      ];

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect(mockClient.event.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            directory: expect.any(String),
          }),
        })
      );
    });

    it('should subscribe to both /event and /global/event (fallback)', async () => {
      const mockStream = async function* () {
        yield ({ type: 'test', data: '{}' });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      mockClient.global.event = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect(mockClient.event.subscribe).toHaveBeenCalled();
      expect(mockClient.global.event).toHaveBeenCalled();
    });

    it('should handle connection errors with auto-reconnect', async () => {
      const error = new Error('Connection failed');
      mockClient.event.subscribe = vi.fn().mockRejectedValue(error);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[MessageStreamService] SSE stream error:',
        error
      );

      // Advance timer to trigger reconnect
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockClient.event.subscribe).toHaveBeenCalledTimes(2);

      consoleErrorSpy.mockRestore();
    });

    it('should auto-reconnect after 5 seconds on failure if subscribers exist', async () => {
      let callCount = 0;
      const mockStream = async function* () {
        if (callCount < 2) {
          callCount++;
          throw new Error('Connection failed');
        }
        yield ({ type: 'test', data: '{}' });
      };

      mockClient.event.subscribe = vi.fn().mockImplementation(() => {
        if (callCount < 2) {
          return Promise.reject(new Error('Connection failed'));
        }
        return Promise.resolve({
          stream: mockStream(),
        });
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect(mockClient.event.subscribe).toHaveBeenCalledTimes(1);

      // Wait 5 seconds for reconnect
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockClient.event.subscribe).toHaveBeenCalledTimes(2);

      consoleErrorSpy.mockRestore();
    });

    it('should clear reconnect timer and recentEventSignatures on start', async () => {
      const mockStream = async function* () {
        yield ({ type: 'test', data: '{}' });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      // Set some state
      (service as any).reconnectTimer = setTimeout(() => {}, 1000);
      (service as any).recentEventSignatures.set('test', { timestamp: Date.now() });

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect((service as any).reconnectTimer).toBeNull();
      expect((service as any).recentEventSignatures.size).toBe(0);
    });

    it('should not reconnect if no subscribers exist', async () => {
      mockClient.event.subscribe = vi.fn().mockRejectedValue(new Error('Connection failed'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Unsubscribe before reconnect timer fires
      unsubscribe();

      // Advance past reconnect time
      await vi.advanceTimersByTimeAsync(6000);

      // Should only be called once (initial attempt, no reconnect)
      expect(mockClient.event.subscribe).toHaveBeenCalledTimes(1);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('stopListening()', () => {
    it('should abort fetch request via AbortController', async () => {
      const abortController = new AbortController();
      const abortSpy = vi.spyOn(abortController, 'abort');

      (service as any).abortController = abortController;

      service.stopListening();

      expect(abortSpy).toHaveBeenCalled();
    });

    it('should clear abort controller reference', async () => {
      const abortController = new AbortController();
      (service as any).abortController = abortController;

      service.stopListening();

      expect((service as any).abortController).toBeNull();
    });

    it('should NOT clear callbacks', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      // Simulate connection started
      (service as any).abortController = new AbortController();

      service.stopListening();

      expect((service as any).callbacks.size).toBe(1);
      expect((service as any).callbacks.has(callback)).toBe(true);
    });

    it('should clear reconnect timer', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      (service as any).reconnectTimer = setTimeout(() => {}, 1000);

      service.stopListening();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect((service as any).reconnectTimer).toBeNull();

      clearTimeoutSpy.mockRestore();
    });

    it('should clear recentEventSignatures', async () => {
      (service as any).recentEventSignatures.set('test', { timestamp: Date.now() });

      service.stopListening();

      expect((service as any).recentEventSignatures.size).toBe(0);
    });
  });

  describe('dispose()', () => {
    it('should call stopListening()', () => {
      const stopListeningSpy = vi.spyOn(service, 'stopListening');

      service.dispose();

      expect(stopListeningSpy).toHaveBeenCalled();
      stopListeningSpy.mockRestore();
    });

    it('should clear all callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      service.subscribe(callback1);
      service.subscribe(callback2);
      service.subscribe(callback3);

      expect((service as any).callbacks.size).toBe(3);

      service.dispose();

      expect((service as any).callbacks.size).toBe(0);
    });

    it('should clean up all resources', () => {
      const callback = vi.fn();
      service.subscribe(callback);

      // Simulate active connection
      (service as any).abortController = new AbortController();
      (service as any).reconnectTimer = setTimeout(() => {}, 1000);
      (service as any).recentEventSignatures.set('test', { timestamp: Date.now() });

      service.dispose();

      expect((service as any).abortController).toBeNull();
      expect((service as any).reconnectTimer).toBeNull();
      expect((service as any).recentEventSignatures.size).toBe(0);
      expect((service as any).callbacks.size).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('AbortError should not be logged as error', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';

      mockClient.event.subscribe = vi.fn().mockRejectedValue(abortError);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect(consoleLogSpy).toHaveBeenCalledWith('[MessageStreamService] Listening aborted');
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        '[MessageStreamService] SSE stream error:',
        abortError
      );

      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('network errors should trigger auto-reconnect', async () => {
      const networkError = new Error('Network error');

      mockClient.event.subscribe = vi.fn().mockRejectedValue(networkError);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[MessageStreamService] SSE stream error:',
        networkError
      );

      // Wait for reconnect
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockClient.event.subscribe).toHaveBeenCalledTimes(2);

      consoleErrorSpy.mockRestore();
    });

    it('callback errors should be caught and logged without affecting other callbacks', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error');
      });
      const normalCallback = vi.fn();

      service.subscribe(errorCallback);
      service.subscribe(normalCallback);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const testEvent = { type: 'test.event', properties: {} };
      (service as any).notifyCallbacks(testEvent);

      expect(errorCallback).toHaveBeenCalledWith(testEvent);
      expect(normalCallback).toHaveBeenCalledWith(testEvent);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Callback error:', expect.any(Error));

      consoleErrorSpy.mockRestore();
    });

    it('should handle invalid JSON in events gracefully', async () => {
      const mockStream = async function* () {
        yield ({ type: 'invalid', data: 'not json' });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Invalid JSON should be caught and logged
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Event Processing', () => {
    it('heartbeat events should be filtered/ignored', async () => {
      const mockStream = async function* () {
        yield ({ type: 'server.heartbeat', data: '{}' });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Heartbeat events should not be dispatched
      expect(callback).not.toHaveBeenCalled();
    });

    it('should filter events by workspace directory', async () => {
      const mockStream = async function* () {
        yield ({
          type: 'message.updated',
          directory: '/other/project',
          data: JSON.stringify({ type: 'message.updated' }),
        });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      // Mock workspace folder
      (vscode.workspace.workspaceFolders as any) = [
        {
          uri: {
            scheme: 'file',
            fsPath: 'e:/projects/test',
          },
        },
      ];

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Event from different directory should be filtered
      expect(callback).not.toHaveBeenCalled();
    });

    it('should allow events from matching workspace directory', async () => {
      const mockStream = async function* () {
        yield ({
          type: 'message.updated',
          directory: 'e:/projects/test',
          data: JSON.stringify({ type: 'message.updated', properties: {} }),
        });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      // Mock workspace folder
      (vscode.workspace.workspaceFolders as any) = [
        {
          uri: {
            scheme: 'file',
            fsPath: 'e:/projects/test',
          },
        },
      ];

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Event from matching directory should be delivered
      expect(callback).toHaveBeenCalled();
    });

    it('duplicate events should be dropped', async () => {
      const event = {
        type: 'message.part.updated',
        properties: {
          messageID: 'msg123',
          part: {
            id: 'part456',
            type: 'text',
            delta: 'hello',
          },
        },
      };

      const mockStream = async function* () {
        yield ({ type: event.type, data: JSON.stringify(event) });
        yield ({ type: event.type, data: JSON.stringify(event) });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Second duplicate should be dropped
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should normalize events from different SDK shapes', async () => {
      const mockStream = async function* () {
        // Shape 1: direct event
        yield ({ type: 'message.updated', data: JSON.stringify({ type: 'message.updated', properties: {} }) });
        // Shape 2: payload wrapper
        yield ({
          type: 'wrapper',
          data: JSON.stringify({
            payload: { type: 'message.updated', properties: {} },
          }),
        });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Both shapes should be normalized and delivered
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should normalize events from /global/event fallback', async () => {
      const eventStream = async function* () {
        yield ({ type: 'message.updated', data: JSON.stringify({ type: 'message.updated', properties: {} }) });
      };

      const globalStream = async function* () {
        yield ({
          type: 'global.wrapper',
          data: JSON.stringify({
            directory: 'e:/projects/test',
            payload: { type: 'message.updated', properties: {} },
          }),
        });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: eventStream(),
      });

      mockClient.global.event = vi.fn().mockResolvedValue({
        stream: globalStream(),
      });

      // Mock workspace folder
      (vscode.workspace.workspaceFolders as any) = [
        {
          uri: {
            scheme: 'file',
            fsPath: 'e:/projects/test',
          },
        },
      ];

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Should receive events from both streams
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('Private Methods (tested via public API effects)', () => {
    describe('normalizeDirectory', () => {
      it('should normalize Windows paths', () => {
        const service = new MessageStreamService(mockServerManager as any);
        const result = (service as any).normalizeDirectory('E:\\Projects\\Test\\');
        expect(result).toBe('e:/projects/test');
      });

      it('should normalize Unix paths', () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', {
          value: 'linux',
        });

        const service = new MessageStreamService(mockServerManager as any);
        const result = (service as any).normalizeDirectory('/home/user/projects//');
        expect(result).toBe('/home/user/projects');

        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
        });
      });
    });

    describe('asRecord', () => {
      it('should return object for valid objects', () => {
        const service = new MessageStreamService(mockServerManager as any);
        const obj = { key: 'value' };
        expect((service as any).asRecord(obj)).toEqual(obj);
      });

      it('should return null for primitives', () => {
        const service = new MessageStreamService(mockServerManager as any);
        expect((service as any).asRecord('string')).toBeNull();
        expect((service as any).asRecord(123)).toBeNull();
        expect((service as any).asRecord(null)).toBeNull();
        expect((service as any).asRecord(undefined)).toBeNull();
      });
    });

    describe('isHeartbeatEvent', () => {
      it('should identify heartbeat events', () => {
        const service = new MessageStreamService(mockServerManager as any);
        expect((service as any).isHeartbeatEvent('server.heartbeat')).toBe(true);
        expect((service as any).isHeartbeatEvent('message.updated')).toBe(false);
        expect((service as any).isHeartbeatEvent(null)).toBe(false);
        expect((service as any).isHeartbeatEvent(123)).toBe(false);
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete subscribe -> receive -> unsubscribe flow', async () => {
      let eventIndex = 0;
      const mockStream = async function* () {
        yield ({ type: 'message.part.updated', data: JSON.stringify({ type: 'message.part.updated', properties: { part: { delta: 'Hello' } } }) });
        yield ({ type: 'message.part.updated', data: JSON.stringify({ type: 'message.part.updated', properties: { part: { delta: 'World' } } }) });
        yield ({ type: 'message.updated', data: JSON.stringify({ type: 'message.updated', properties: {} }) });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect(callback).toHaveBeenCalledTimes(3);

      unsubscribe();

      expect((service as any).callbacks.size).toBe(0);
    });

    it('should handle rapid subscribe/unsubscribe cycles', async () => {
      const mockStream = async function* () {
        yield ({ type: 'test', data: '{}' });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const unsubscribe1 = service.subscribe(callback1);
      const unsubscribe2 = service.subscribe(callback2);

      await vi.runOnlyPendingTimersAsync();

      unsubscribe1();

      expect((service as any).callbacks.size).toBe(1);

      const unsubscribe3 = service.subscribe(callback1);
      unsubscribe2();
      unsubscribe3();

      expect((service as any).callbacks.size).toBe(0);
    });

    it('should handle server restart during active subscription', async () => {
      let callCount = 0;
      const mockStream = async function* () {
        callCount++;
        if (callCount === 1) {
          yield ({ type: 'message.part.updated', data: JSON.stringify({ type: 'message.part.updated', properties: {} }) });
          throw new Error('Server disconnected');
        }
        yield ({ type: 'message.updated', data: JSON.stringify({ type: 'message.updated', properties: {} }) });
      };

      mockClient.event.subscribe = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          stream: mockStream(),
        });
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      expect(callback).toHaveBeenCalledTimes(1);

      // Wait for reconnect
      await vi.advanceTimersByTimeAsync(5000);

      expect(callback).toHaveBeenCalledTimes(2);

      consoleErrorSpy.mockRestore();
    });

    it('should handle workspace directory changes', async () => {
      const mockStream = async function* () {
        yield ({ type: 'message.updated', directory: 'e:/projects/test', data: JSON.stringify({ type: 'message.updated', properties: {} }) });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      // Initially no workspace
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // All events should pass through when no workspace filter
      expect(callback).toHaveBeenCalledTimes(1);

      callback.mockClear();

      // Set workspace (would require restarting in real scenario)
      unsubscribe();
      (vscode.workspace.workspaceFolders as any) = [
        {
          uri: {
            scheme: 'file',
            fsPath: 'e:/projects/test',
          },
        },
      ];

      // Re-subscribe with workspace
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Should receive event with matching directory
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle events with missing properties', async () => {
      const mockStream = async function* () {
        yield ({ type: 'minimal', data: JSON.stringify({ type: 'minimal' }) });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Should handle events without properties
      expect(callback).toHaveBeenCalled();
    });

    it('should handle malformed event data gracefully', async () => {
      const mockStream = async function* () {
        yield ({ type: 'malformed', data: '{invalid json}' });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Should warn about malformed event
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should handle concurrent event streams from /event and /global/event', async () => {
      let eventCount = 0;
      const eventStream = async function* () {
        yield ({ type: 'message.part.updated', data: JSON.stringify({ type: 'message.part.updated', properties: { part: { delta: 'A' } } }) });
      };

      const globalStream = async function* () {
        yield ({ type: 'message.part.updated', data: JSON.stringify({ type: 'message.part.updated', properties: { part: { delta: 'B' } } }) });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: eventStream(),
      });

      mockClient.global.event = vi.fn().mockResolvedValue({
        stream: globalStream(),
      });

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Should receive events from both streams
      expect(callback).toHaveBeenCalled();
    });

    it('should handle very large event payloads', async () => {
      const largeText = 'x'.repeat(100000);
      const mockStream = async function* () {
        yield ({
          type: 'message.part.updated',
          data: JSON.stringify({
            type: 'message.part.updated',
            properties: { part: { text: largeText } },
          }),
        });
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Should handle large payloads
      expect(callback).toHaveBeenCalled();
    });

    it('should handle rapid succession of events', async () => {
      const events = [];
      for (let i = 0; i < 100; i++) {
        events.push({
          type: 'message.part.updated',
          data: JSON.stringify({
            type: 'message.part.updated',
            properties: { part: { delta: `chunk${i}` } },
          }),
        });
      }

      const mockStream = async function* () {
        for (const event of events) {
          yield event;
        }
      };

      mockClient.event.subscribe = vi.fn().mockResolvedValue({
        stream: mockStream(),
      });

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.runOnlyPendingTimersAsync();

      // Should handle rapid events
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('Logging Configuration', () => {
    it('should respect verbose stream debug setting', () => {
      const getConfigurationMock = vscode.workspace.getConfiguration as any;
      getConfigurationMock.mockImplementation((section: string) => {
        if (section === 'opencode.logging') {
          return {
            get: vi.fn((key: string, defaultValue: any) => {
              if (key === 'level') {
                return 'debug';
              }
              return defaultValue;
            }),
          };
        }
        return {
          get: vi.fn((key: string, defaultValue: any) => defaultValue),
        };
      });

      const service = new MessageStreamService(mockServerManager as any);
      expect((service as any).shouldVerboseStreamDebug()).toBe(true);

      getConfigurationMock.mockImplementation((section: string) => {
        if (section === 'opencode.logging') {
          return {
            get: vi.fn((key: string, defaultValue: any) => {
              if (key === 'level') {
                return 'info';
              }
              return defaultValue;
            }),
          };
        }
        return {
          get: vi.fn((key: string, defaultValue: any) => defaultValue),
        };
      });

      const service2 = new MessageStreamService(mockServerManager as any);
      expect((service2 as any).shouldVerboseStreamDebug()).toBe(false);
    });
  });
});
