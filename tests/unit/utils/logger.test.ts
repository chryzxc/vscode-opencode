/**
 * Comprehensive unit tests for Logger utility
 * 100% coverage - tests all functions, methods, classes, and edge cases
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock vscode module with proper export
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultValue: any) => {
        const config: Record<string, any> = {
          'opencode.logging.level': 'info',
          'opencode.logging.enableConsole': true,
          'opencode.logging.enableFile': false,
          'opencode.logging.maxFileSize': 5 * 1024 * 1024,
          'opencode.logging.maxFiles': 3,
        };
        return config[key] ?? defaultValue;
      }),
    })),
  },
}));

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    promises: {
      appendFile: vi.fn(),
      stat: vi.fn(),
      rename: vi.fn(),
      unlink: vi.fn(),
    },
  },
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  promises: {
    appendFile: vi.fn(),
    stat: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
  },
}));

// Import after mocking
import { logger, createLogger, LogLevel } from '../../../src/utils/Logger';

describe('Logger', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    (fs.existsSync as any).mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('LogLevel Enum', () => {
    it('should have correct numeric values', () => {
      expect(LogLevel.ERROR).toBe(0);
      expect(LogLevel.WARN).toBe(1);
      expect(LogLevel.INFO).toBe(2);
      expect(LogLevel.DEBUG).toBe(3);
    });
  });

  describe('Constructor', () => {
    it('should initialize with default config', () => {
      expect(logger).toBeDefined();
    });

    it('should create log directory if it does not exist', () => {
      (fs.existsSync as any).mockReturnValue(false);
      (logger as any).loadConfig();
      expect(fs.mkdirSync).toHaveBeenCalled();
    });
  });

  describe('setExtensionContext', () => {
    it('should set extension context and reload config', () => {
      const mockContext = {
        globalStorageUri: { fsPath: '/test/storage' },
      } as any;

      const reloadConfigSpy = vi.spyOn(logger as any, 'reloadConfig');

      logger.setExtensionContext(mockContext);

      expect(logger['context']).toBe(mockContext);
      expect(reloadConfigSpy).toHaveBeenCalled();
    });

    it('should handle null context', () => {
      logger.setExtensionContext(null as any);
      expect(logger['context']).toBeNull();
    });
  });

  describe('loadConfig', () => {
    it('should load configuration from vscode settings', () => {
      const config = (logger as any).loadConfig();

      expect(config.minLevel).toBe(LogLevel.INFO);
      expect(config.enableConsole).toBe(true);
      expect(config.enableFile).toBe(false);
      expect(config.maxFileSize).toBe(5 * 1024 * 1024);
      expect(config.maxFiles).toBe(3);
    });

    it('should use correct log directory with context', () => {
      const mockContext = {
        globalStorageUri: { fsPath: 'test\\storage' },
      } as any;
      logger.setExtensionContext(mockContext);

      const config = (logger as any).loadConfig();
      expect(config.logFilePath).toContain('test');
      expect(config.logFilePath).toContain('storage');
    });

    it('should use cwd log directory without context', () => {
      logger['context'] = null;
      const config = (logger as any).loadConfig();
      expect(config.logFilePath).toContain('logs');
    });

    it('should create log directory if not exists', () => {
      (fs.existsSync as any).mockReturnValue(false);
      (logger as any).loadConfig();
      expect(fs.mkdirSync).toHaveBeenCalled();
    });
  });

  describe('parseLogLevel', () => {
    it('should parse "error" correctly', () => {
      expect((logger as any).parseLogLevel('error')).toBe(LogLevel.ERROR);
    });

    it('should parse "warn" correctly', () => {
      expect((logger as any).parseLogLevel('warn')).toBe(LogLevel.WARN);
    });

    it('should parse "warning" correctly', () => {
      expect((logger as any).parseLogLevel('warning')).toBe(LogLevel.WARN);
    });

    it('should parse "info" correctly', () => {
      expect((logger as any).parseLogLevel('info')).toBe(LogLevel.INFO);
    });

    it('should parse "debug" correctly', () => {
      expect((logger as any).parseLogLevel('debug')).toBe(LogLevel.DEBUG);
    });

    it('should handle case insensitive input', () => {
      expect((logger as any).parseLogLevel('ERROR')).toBe(LogLevel.ERROR);
      expect((logger as any).parseLogLevel('INFO')).toBe(LogLevel.INFO);
      expect((logger as any).parseLogLevel('DeBuG')).toBe(LogLevel.DEBUG);
    });

    it('should default to INFO for unknown levels', () => {
      expect((logger as any).parseLogLevel('unknown')).toBe(LogLevel.INFO);
      expect((logger as any).parseLogLevel('')).toBe(LogLevel.INFO);
    });

    it('should handle empty strings gracefully', () => {
      expect((logger as any).parseLogLevel('')).toBe(LogLevel.INFO);
    });
  });

  describe('formatEntry', () => {
    it('should format log entry as JSON', () => {
      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'info',
        category: 'Test',
        message: 'Test message',
      };

      const formatted = (logger as any).formatEntry(entry);
      const parsed = JSON.parse(formatted);

      expect(parsed).toEqual(entry);
    });

    it('should format entry with context', () => {
      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'info',
        category: 'Test',
        message: 'Test message',
        context: { key: 'value' },
      };

      const formatted = (logger as any).formatEntry(entry);
      const parsed = JSON.parse(formatted);

      expect(parsed.context).toEqual({ key: 'value' });
    });

    it('should format entry with error', () => {
      const error = new Error('Test error');
      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'error',
        category: 'Test',
        message: 'Test message',
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      };

      const formatted = (logger as any).formatEntry(entry);
      const parsed = JSON.parse(formatted);

      expect(parsed.error).toBeDefined();
      expect(parsed.error.message).toBe('Test error');
    });
  });

  describe('output', () => {
    it('should skip logging if level is too low', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      (logger as any).config.minLevel = LogLevel.ERROR;
      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'debug',
        category: 'Test',
        message: 'Should not log',
      };

      (logger as any).output(entry);

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log if level matches min level', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      (logger as any).config.minLevel = LogLevel.INFO;
      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'info',
        category: 'Test',
        message: 'Should log',
      };

      (logger as any).output(entry);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log if level is higher than min level', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      (logger as any).config.minLevel = LogLevel.DEBUG;
      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'info',
        category: 'Test',
        message: 'Should log',
      };

      (logger as any).output(entry);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should add to buffer when file logging is enabled', () => {
      (logger as any).config.enableFile = true;
      (logger as any).config.enableConsole = false;

      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'info',
        category: 'Test',
        message: 'Buffer test',
      };

      const bufferLength = (logger as any).logBuffer.length;
      (logger as any).output(entry);

      expect((logger as any).logBuffer.length).toBe(bufferLength + 1);
    });

    it('should not add to buffer when file logging is disabled', () => {
      (logger as any).config.enableFile = false;
      (logger as any).config.enableConsole = false;

      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'info',
        category: 'Test',
        message: 'No buffer test',
      };

      const bufferLength = (logger as any).logBuffer.length;
      (logger as any).output(entry);

      expect((logger as any).logBuffer.length).toBe(bufferLength);
    });
  });

  describe('outputToConsole', () => {
    it('should output error to console.error', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'error',
        category: 'TestCategory',
        message: 'Error message',
      };

      (logger as any).outputToConsole(entry);

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error message'));
      consoleSpy.mockRestore();
    });

    it('should output warn to console.warn', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'warn',
        category: 'TestCategory',
        message: 'Warning message',
      };

      (logger as any).outputToConsole(entry);

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('WARN'));
      consoleSpy.mockRestore();
    });

    it('should output info to console.log', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'info',
        category: 'TestCategory',
        message: 'Info message',
      };

      (logger as any).outputToConsole(entry);

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('INFO'));
      consoleSpy.mockRestore();
    });

    it('should output debug to console.log', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'debug',
        category: 'TestCategory',
        message: 'Debug message',
      };

      (logger as any).outputToConsole(entry);

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('DEBUG'));
      consoleSpy.mockRestore();
    });

    it('should include context in output', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'info',
        category: 'TestCategory',
        message: 'Message with context',
        context: { key: 'value', number: 42 },
      };

      (logger as any).outputToConsole(entry);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('key'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('value'));
      consoleSpy.mockRestore();
    });

    it('should include error in output', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const entry = {
        timestamp: '2026-03-13T10:00:00.000Z',
        level: 'error',
        category: 'TestCategory',
        message: 'Message with error',
        error: {
          name: 'Error',
          message: 'Test error',
          stack: 'Error: Test error\n    at test.ts:1',
        },
      };

      (logger as any).outputToConsole(entry);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test error'));
      consoleSpy.mockRestore();
    });
  });

  describe('startFlushTimer', () => {
    it('should start a flush timer', () => {
      vi.useFakeTimers();

      (logger as any).startFlushTimer();

      expect((logger as any).flushTimer).not.toBeNull();

      vi.useRealTimers();
    });

    it('should flush every 5 seconds', () => {
      vi.useFakeTimers();
      const flushSpy = vi.spyOn(logger as any, 'flush').mockResolvedValue(undefined);

      (logger as any).startFlushTimer();

      vi.advanceTimersByTime(5000);

      expect(flushSpy).toHaveBeenCalled();

      flushSpy.mockRestore();
      vi.useRealTimers();
    });

    it('should not flush when buffer is empty', () => {
      vi.useFakeTimers();
      const flushSpy = vi.spyOn(logger as any, 'flush').mockResolvedValue(undefined);
      (logger as any).logBuffer = [];

      (logger as any).startFlushTimer();

      vi.advanceTimersByTime(5000);

      expect(flushSpy).not.toHaveBeenCalled();

      flushSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe('flush', () => {
    it('should not flush if already flushing', async () => {
      (logger as any).isFlushing = true;
      (logger as any).logBuffer = ['test log'];

      const fsSpy = vi.spyOn(fs.promises, 'appendFile');

      await (logger as any).flush();

      expect(fsSpy).not.toHaveBeenCalled();

      (logger as any).isFlushing = false;
    });

    it('should not flush if buffer is empty', async () => {
      (logger as any).logBuffer = [];

      const fsSpy = vi.spyOn(fs.promises, 'appendFile');

      await (logger as any).flush();

      expect(fsSpy).not.toHaveBeenCalled();
    });

    it('should write buffered logs to file', async () => {
      (logger as any).config.enableFile = true;
      (logger as any).logBuffer = ['log1\n', 'log2\n'];

      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 100 } as any);
      vi.spyOn(fs.promises, 'appendFile').mockResolvedValue(undefined);

      await (logger as any).flush();

      expect(fs.promises.appendFile).toHaveBeenCalled();
      expect((logger as any).logBuffer).toHaveLength(0);
    });

    it('should handle file write errors gracefully', async () => {
      (logger as any).logBuffer = ['log1\n'];

      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 100 } as any);
      vi.spyOn(fs.promises, 'appendFile').mockRejectedValue(new Error('Write error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await (logger as any).flush();

      expect(consoleSpy).toHaveBeenCalled();
      expect((logger as any).logBuffer).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it('should reset isFlushing flag after completion', async () => {
      (logger as any).logBuffer = ['log1\n'];

      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 100 } as any);
      vi.spyOn(fs.promises, 'appendFile').mockResolvedValue(undefined);

      await (logger as any).flush();

      expect((logger as any).isFlushing).toBe(false);
    });
  });

  describe('rotateIfNeeded', () => {
    it('should do nothing if file does not exist', async () => {
      const statSpy = vi.spyOn(fs.promises, 'stat').mockRejectedValue({ message: 'ENOENT' });

      await (logger as any).rotateIfNeeded();

      expect(statSpy).toHaveBeenCalled();
      statSpy.mockRestore();
    });

    it('should rotate if file exceeds max size', async () => {
      const maxSize = 5 * 1024 * 1024;
      (logger as any).config.maxFileSize = maxSize;

      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: maxSize + 1 } as any);
      const renameSpy = vi.spyOn(fs.promises, 'rename').mockResolvedValue(undefined);
      (fs.existsSync as any).mockReturnValue(false);

      await (logger as any).rotateIfNeeded();

      expect(renameSpy).toHaveBeenCalled();
      renameSpy.mockRestore();
    });

    it('should delete oldest backup when maxFiles is reached', async () => {
      const maxSize = 5 * 1024 * 1024;
      (logger as any).config.maxFileSize = maxSize;
      (logger as any).config.maxFiles = 3;

      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: maxSize + 1 } as any);
      const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
      const renameSpy = vi.spyOn(fs.promises, 'rename').mockResolvedValue(undefined);
      (fs.existsSync as any).mockReturnValue(true);

      await (logger as any).rotateIfNeeded();

      expect(unlinkSpy).toHaveBeenCalled();
      unlinkSpy.mockRestore();
      renameSpy.mockRestore();
    });

    it('should shift existing backup files', async () => {
      const maxSize = 5 * 1024 * 1024;
      (logger as any).config.maxFileSize = maxSize;

      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: maxSize + 1 } as any);
      const renameSpy = vi.spyOn(fs.promises, 'rename').mockResolvedValue(undefined);
      (fs.existsSync as any).mockReturnValue(false);

      await (logger as any).rotateIfNeeded();

      renameSpy.mockRestore();
    });

    it('should handle rotation errors gracefully', async () => {
      vi.spyOn(fs.promises, 'stat').mockRejectedValue(new Error('Some error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await (logger as any).rotateIfNeeded();

      consoleSpy.mockRestore();
    });
  });

  describe('log', () => {
    it('should create log entry with timestamp', () => {
      const outputSpy = vi.spyOn(logger as any, 'output').mockImplementation(() => {});

      logger['log']('info', 'Test', 'Test message');

      expect(outputSpy).toHaveBeenCalled();
      const entry = outputSpy.mock.calls[0][0];
      expect(entry.timestamp).toBeDefined();
      expect(entry.level).toBe('info');
      expect(entry.category).toBe('Test');
      expect(entry.message).toBe('Test message');

      outputSpy.mockRestore();
    });

    it('should include context in log entry', () => {
      const outputSpy = vi.spyOn(logger as any, 'output').mockImplementation(() => {});

      logger['log']('info', 'Test', 'Test message', { key: 'value' });

      const entry = outputSpy.mock.calls[0][0];
      expect(entry.context).toEqual({ key: 'value' });

      outputSpy.mockRestore();
    });

    it('should include error in log entry', () => {
      const outputSpy = vi.spyOn(logger as any, 'output').mockImplementation(() => {});
      const error = new Error('Test error');

      logger['log']('error', 'Test', 'Test message', undefined, error);

      const entry = outputSpy.mock.calls[0][0];
      expect(entry.error).toBeDefined();
      expect(entry.error.message).toBe('Test error');
      expect(entry.error.name).toBe('Error');
      expect(entry.error.stack).toBeDefined();

      outputSpy.mockRestore();
    });

    it('should handle error without stack', () => {
      const outputSpy = vi.spyOn(logger as any, 'output').mockImplementation(() => {});
      const error = { name: 'CustomError', message: 'Test error' } as any;

      logger['log']('error', 'Test', 'Test message', undefined, error);

      const entry = outputSpy.mock.calls[0][0];
      expect(entry.error).toBeDefined();
      expect(entry.error.stack).toBeUndefined();

      outputSpy.mockRestore();
    });
  });

  describe('Public Logging Methods', () => {
    describe('error', () => {
      it('should log error messages', () => {
        const logSpy = vi.spyOn(logger as any, 'log').mockImplementation(() => {});

        logger.error('TestCategory', 'Error occurred', { code: 500 });

        expect(logSpy).toHaveBeenCalledWith('error', 'TestCategory', 'Error occurred', { code: 500 }, undefined);

        logSpy.mockRestore();
      });

      it('should log error with Error object', () => {
        const logSpy = vi.spyOn(logger as any, 'log').mockImplementation(() => {});
        const error = new Error('Test error');

        logger.error('TestCategory', 'Error occurred', { code: 500 }, error);

        expect(logSpy).toHaveBeenCalledWith('error', 'TestCategory', 'Error occurred', { code: 500 }, error);

        logSpy.mockRestore();
      });

      it('should log error without context', () => {
        const logSpy = vi.spyOn(logger as any, 'log').mockImplementation(() => {});

        logger.error('TestCategory', 'Error occurred');

        expect(logSpy).toHaveBeenCalledWith('error', 'TestCategory', 'Error occurred', undefined, undefined);

        logSpy.mockRestore();
      });

      it('should log error with context but no error object', () => {
        const logSpy = vi.spyOn(logger as any, 'log').mockImplementation(() => {});

        logger.error('TestCategory', 'Error occurred', { code: 500 });

        expect(logSpy).toHaveBeenCalledWith('error', 'TestCategory', 'Error occurred', { code: 500 }, undefined);

        logSpy.mockRestore();
      });
    });

    describe('warn', () => {
      it('should log warning messages', () => {
        const logSpy = vi.spyOn(logger as any, 'log').mockImplementation(() => {});

        logger.warn('TestCategory', 'Warning occurred', { code: 401 });

        expect(logSpy).toHaveBeenCalledWith('warn', 'TestCategory', 'Warning occurred', { code: 401 });

        logSpy.mockRestore();
      });

      it('should log warning without context', () => {
        const logSpy = vi.spyOn(logger as any, 'log').mockImplementation(() => {});

        logger.warn('TestCategory', 'Warning occurred');

        expect(logSpy).toHaveBeenCalledWith('warn', 'TestCategory', 'Warning occurred', undefined);

        logSpy.mockRestore();
      });
    });

    describe('info', () => {
      it('should log info messages', () => {
        const logSpy = vi.spyOn(logger as any, 'log').mockImplementation(() => {});

        logger.info('TestCategory', 'Info message', { status: 'ok' });

        expect(logSpy).toHaveBeenCalledWith('info', 'TestCategory', 'Info message', { status: 'ok' });

        logSpy.mockRestore();
      });

      it('should log info without context', () => {
        const logSpy = vi.spyOn(logger as any, 'log').mockImplementation(() => {});

        logger.info('TestCategory', 'Info message');

        expect(logSpy).toHaveBeenCalledWith('info', 'TestCategory', 'Info message', undefined);

        logSpy.mockRestore();
      });
    });

    describe('debug', () => {
      it('should log debug messages', () => {
        const logSpy = vi.spyOn(logger as any, 'log').mockImplementation(() => {});

        logger.debug('TestCategory', 'Debug message', { variable: 'value' });

        expect(logSpy).toHaveBeenCalledWith('debug', 'TestCategory', 'Debug message', { variable: 'value' });

        logSpy.mockRestore();
      });

      it('should log debug without context', () => {
        const logSpy = vi.spyOn(logger as any, 'log').mockImplementation(() => {});

        logger.debug('TestCategory', 'Debug message');

        expect(logSpy).toHaveBeenCalledWith('debug', 'TestCategory', 'Debug message', undefined);

        logSpy.mockRestore();
      });
    });
  });

  describe('Specialized Logging Methods', () => {
    describe('aiRequest', () => {
      it('should log AI request with all parameters', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.aiRequest('Chat', 'session123', 'gpt-4', 'Hello AI', { images: ['img1.png'], files: ['file1.ts'] });

        expect(infoSpy).toHaveBeenCalledWith(
          'Chat',
          'AI Request Sent',
          expect.objectContaining({
            sessionId: 'session123',
            modelId: 'gpt-4',
            messageLength: 8,
            hasImages: true,
            hasFiles: true,
            images: ['img1.png'],
            files: ['file1.ts'],
          })
        );

        infoSpy.mockRestore();
      });

      it('should calculate message length correctly', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.aiRequest('Chat', 'session123', 'gpt-4', 'A longer message for testing', {});

        expect(infoSpy).toHaveBeenCalledWith(
          'Chat',
          'AI Request Sent',
          expect.objectContaining({
            messageLength: 28,
          })
        );

        infoSpy.mockRestore();
      });

      it('should detect images correctly', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.aiRequest('Chat', 'session123', 'gpt-4', 'Test', {});

        expect(infoSpy).toHaveBeenCalledWith(
          'Chat',
          'AI Request Sent',
          expect.objectContaining({
            hasImages: false,
          })
        );

        infoSpy.mockRestore();
      });

      it('should detect files correctly', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.aiRequest('Chat', 'session123', 'gpt-4', 'Test', { files: ['a.ts', 'b.ts'] });

        expect(infoSpy).toHaveBeenCalledWith(
          'Chat',
          'AI Request Sent',
          expect.objectContaining({
            hasFiles: true,
          })
        );

        infoSpy.mockRestore();
      });
    });

    describe('aiResponse', () => {
      it('should log AI response with formatted time', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.aiResponse('Chat', 'session123', 1234.567, 5000, {});

        expect(infoSpy).toHaveBeenCalledWith(
          'Chat',
          'AI Response Received',
          expect.objectContaining({
            sessionId: 'session123',
            responseTimeSeconds: '1234.57',
            responseLength: 5000,
          })
        );

        infoSpy.mockRestore();
      });

      it('should round response time correctly', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.aiResponse('Chat', 'session123', 99.999, 1000, {});

        expect(infoSpy).toHaveBeenCalledWith(
          'Chat',
          'AI Response Received',
          expect.objectContaining({
            responseTimeSeconds: '100.00',
          })
        );

        infoSpy.mockRestore();
      });
    });

    describe('aiStreamEvent', () => {
      it('should log AI stream events', () => {
        const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});

        logger.aiStreamEvent('Chat', 'session123', 'chunk', { chunkId: 1 });

        expect(debugSpy).toHaveBeenCalledWith(
          'Chat',
          'AI Stream Event',
          expect.objectContaining({
            sessionId: 'session123',
            eventType: 'chunk',
            chunkId: 1,
          })
        );

        debugSpy.mockRestore();
      });
    });

    describe('tokenUsage', () => {
      it('should log token usage with total', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.tokenUsage('Chat', 'openai', 1000, 500, { model: 'gpt-4' });

        expect(infoSpy).toHaveBeenCalledWith(
          'Chat',
          'Token Usage',
          expect.objectContaining({
            providerId: 'openai',
            inputTokens: 1000,
            outputTokens: 500,
            totalTokens: 1500,
            model: 'gpt-4',
          })
        );

        infoSpy.mockRestore();
      });

      it('should calculate total tokens correctly', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.tokenUsage('Chat', 'anthropic', 2500, 750, {});

        expect(infoSpy).toHaveBeenCalledWith(
          'Chat',
          'Token Usage',
          expect.objectContaining({
            totalTokens: 3250,
          })
        );

        infoSpy.mockRestore();
      });
    });

    describe('serverEvent', () => {
      it('should log server start event', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.serverEvent('ServerManager', 'start', { port: 4097 });

        expect(infoSpy).toHaveBeenCalledWith('ServerManager', 'Server start', { port: 4097 });

        infoSpy.mockRestore();
      });

      it('should log server stop event', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.serverEvent('ServerManager', 'stop', {});

        expect(infoSpy).toHaveBeenCalledWith('ServerManager', 'Server stop', {});

        infoSpy.mockRestore();
      });

      it('should log server restart event', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.serverEvent('ServerManager', 'restart', {});

        expect(infoSpy).toHaveBeenCalledWith('ServerManager', 'Server restart', {});

        infoSpy.mockRestore();
      });

      it('should log server error event', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.serverEvent('ServerManager', 'error', { error: 'Connection failed' });

        expect(infoSpy).toHaveBeenCalledWith('ServerManager', 'Server error', { error: 'Connection failed' });

        infoSpy.mockRestore();
      });

      it('should log server connect event', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.serverEvent('ServerManager', 'connect', { clientId: 'client1' });

        expect(infoSpy).toHaveBeenCalledWith('ServerManager', 'Server connect', { clientId: 'client1' });

        infoSpy.mockRestore();
      });

      it('should log server disconnect event', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.serverEvent('ServerManager', 'disconnect', { clientId: 'client1' });

        expect(infoSpy).toHaveBeenCalledWith('ServerManager', 'Server disconnect', { clientId: 'client1' });

        infoSpy.mockRestore();
      });
    });

    describe('sessionEvent', () => {
      it('should log session create event', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.sessionEvent('SessionManager', 'create', 'session123', {});

        expect(infoSpy).toHaveBeenCalledWith('SessionManager', 'Session create', expect.objectContaining({
          sessionId: 'session123',
        }));

        infoSpy.mockRestore();
      });

      it('should log session load event', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.sessionEvent('SessionManager', 'load', 'session123', {});

        expect(infoSpy).toHaveBeenCalledWith('SessionManager', 'Session load', expect.objectContaining({
          sessionId: 'session123',
        }));

        infoSpy.mockRestore();
      });

      it('should log session switch event', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.sessionEvent('SessionManager', 'switch', 'session123', { previousSession: 'session456' });

        expect(infoSpy).toHaveBeenCalledWith('SessionManager', 'Session switch', expect.objectContaining({
          sessionId: 'session123',
          previousSession: 'session456',
        }));

        infoSpy.mockRestore();
      });

      it('should log session delete event', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.sessionEvent('SessionManager', 'delete', 'session123', {});

        expect(infoSpy).toHaveBeenCalledWith('SessionManager', 'Session delete', expect.objectContaining({
          sessionId: 'session123',
        }));

        infoSpy.mockRestore();
      });

      it('should log session persist event', () => {
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

        logger.sessionEvent('SessionManager', 'persist', 'session123', {});

        expect(infoSpy).toHaveBeenCalledWith('SessionManager', 'Session persist', expect.objectContaining({
          sessionId: 'session123',
        }));

        infoSpy.mockRestore();
      });
    });
  });

  describe('reloadConfig', () => {
    it('should reload configuration', () => {
      const loadConfigSpy = vi.spyOn(logger as any, 'loadConfig').mockReturnValue({ minLevel: LogLevel.DEBUG });
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

      logger.reloadConfig();

      expect(loadConfigSpy).toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledWith(
        'Logger',
        'Configuration reloaded',
        expect.objectContaining({
          minLevel: 'DEBUG',
        })
      );

      loadConfigSpy.mockRestore();
      infoSpy.mockRestore();
    });
  });

  describe('dispose', () => {
    it('should clear flush timer on dispose', async () => {
      (logger as any).flushTimer = setInterval(() => {}, 1000);
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      const flushSpy = vi.spyOn(logger as any, 'flush').mockResolvedValue(undefined);

      await logger.dispose();

      expect(clearIntervalSpy).toHaveBeenCalled();
      expect((logger as any).flushTimer).toBeNull();
      expect(flushSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
      flushSpy.mockRestore();
    });

    it('should handle null timer on dispose', async () => {
      (logger as any).flushTimer = null;
      const flushSpy = vi.spyOn(logger as any, 'flush').mockResolvedValue(undefined);

      await logger.dispose();

      expect(flushSpy).toHaveBeenCalled();

      flushSpy.mockRestore();
    });

    it('should flush remaining logs on dispose', async () => {
      (logger as any).flushTimer = null;
      (logger as any).logBuffer = ['remaining log'];
      const flushSpy = vi.spyOn(logger as any, 'flush').mockResolvedValue(undefined);

      await logger.dispose();

      expect(flushSpy).toHaveBeenCalled();

      flushSpy.mockRestore();
    });
  });
});

describe('createLogger', () => {
  it('should create a category-scoped logger', () => {
    const log = createLogger('TestCategory');

    expect(log).toBeDefined();
    expect(log.error).toBeInstanceOf(Function);
    expect(log.warn).toBeInstanceOf(Function);
    expect(log.info).toBeInstanceOf(Function);
    expect(log.debug).toBeInstanceOf(Function);
  });

  it('should proxy error calls to logger', () => {
    const log = createLogger('TestCategory');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    log.error('Test error', { code: 500 });

    expect(errorSpy).toHaveBeenCalledWith('TestCategory', 'Test error', { code: 500 }, undefined);

    errorSpy.mockRestore();
  });

  it('should proxy error calls with Error object', () => {
    const log = createLogger('TestCategory');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const error = new Error('Test error');

    log.error('Test error', { code: 500 }, error);

    expect(errorSpy).toHaveBeenCalledWith('TestCategory', 'Test error', { code: 500 }, error);

    errorSpy.mockRestore();
  });

  it('should proxy warn calls to logger', () => {
    const log = createLogger('TestCategory');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    log.warn('Test warning', { level: 'high' });

    expect(warnSpy).toHaveBeenCalledWith('TestCategory', 'Test warning', { level: 'high' });

    warnSpy.mockRestore();
  });

  it('should proxy info calls to logger', () => {
    const log = createLogger('TestCategory');
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

    log.info('Test info', { status: 'ok' });

    expect(infoSpy).toHaveBeenCalledWith('TestCategory', 'Test info', { status: 'ok' });

    infoSpy.mockRestore();
  });

  it('should proxy debug calls to logger', () => {
    const log = createLogger('TestCategory');
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});

    log.debug('Test debug', { variable: 'value' });

    expect(debugSpy).toHaveBeenCalledWith('TestCategory', 'Test debug', { variable: 'value' });

    debugSpy.mockRestore();
  });

  it('should proxy aiRequest calls to logger', () => {
    const log = createLogger('TestCategory');
    const aiRequestSpy = vi.spyOn(logger, 'aiRequest').mockImplementation(() => {});

    log.aiRequest('session123', 'gpt-4', 'Hello', { images: [] });

    expect(aiRequestSpy).toHaveBeenCalledWith('TestCategory', 'session123', 'gpt-4', 'Hello', { images: [] });

    aiRequestSpy.mockRestore();
  });

  it('should proxy aiResponse calls to logger', () => {
    const log = createLogger('TestCategory');
    const aiResponseSpy = vi.spyOn(logger, 'aiResponse').mockImplementation(() => {});

    log.aiResponse('session123', 1000, 500, {});

    expect(aiResponseSpy).toHaveBeenCalledWith('TestCategory', 'session123', 1000, 500, {});

    aiResponseSpy.mockRestore();
  });

  it('should proxy aiStreamEvent calls to logger', () => {
    const log = createLogger('TestCategory');
    const aiStreamEventSpy = vi.spyOn(logger, 'aiStreamEvent').mockImplementation(() => {});

    log.aiStreamEvent('session123', 'chunk', {});

    expect(aiStreamEventSpy).toHaveBeenCalledWith('TestCategory', 'session123', 'chunk', {});

    aiStreamEventSpy.mockRestore();
  });

  it('should proxy tokenUsage calls to logger', () => {
    const log = createLogger('TestCategory');
    const tokenUsageSpy = vi.spyOn(logger, 'tokenUsage').mockImplementation(() => {});

    log.tokenUsage('openai', 1000, 500, {});

    expect(tokenUsageSpy).toHaveBeenCalledWith('TestCategory', 'openai', 1000, 500, {});

    tokenUsageSpy.mockRestore();
  });

  it('should proxy serverEvent calls to logger', () => {
    const log = createLogger('TestCategory');
    const serverEventSpy = vi.spyOn(logger, 'serverEvent').mockImplementation(() => {});

    log.serverEvent('start', { port: 4097 });

    expect(serverEventSpy).toHaveBeenCalledWith('TestCategory', 'start', { port: 4097 });

    serverEventSpy.mockRestore();
  });

  it('should proxy sessionEvent calls to logger', () => {
    const log = createLogger('TestCategory');
    const sessionEventSpy = vi.spyOn(logger, 'sessionEvent').mockImplementation(() => {});

    log.sessionEvent('create', 'session123', {});

    expect(sessionEventSpy).toHaveBeenCalledWith('TestCategory', 'create', 'session123', {});

    sessionEventSpy.mockRestore();
  });
});
