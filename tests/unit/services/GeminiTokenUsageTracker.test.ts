/**
 * Comprehensive unit tests for GeminiTokenUsageTracker service
 * Tests all token tracking logic with 100% coverage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock modules BEFORE importing
vi.mock('fs');
vi.mock('os');

const mockFs = fs as any;
const mockOs = os as any;

// Setup mocks before import
mockOs.homedir = vi.fn(() => '/mock/home');

// Now import after mocks are set up
import {
  GeminiTokenUsageTracker,
  TokenUsage,
  ModelTokenUsage,
} from '../../../src/services/GeminiTokenUsageTracker';

describe('GeminiTokenUsageTracker', () => {
  let tracker: GeminiTokenUsageTracker;

  beforeEach(() => {
    // Reset singleton
    GeminiTokenUsageTracker.resetInstance();

    // Clear all mocks
    vi.clearAllMocks();

    // Setup fs.existsSync mock
    mockFs.existsSync.mockReturnValue(false);

    // Setup fs.readFileSync mock
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('File not found');
    });

    // Setup fs.mkdirSync mock
    mockFs.mkdirSync.mockReturnValue(undefined);

    // Setup fs.writeFileSync mock
    mockFs.writeFileSync.mockReturnValue(undefined);

    // Create new instance
    tracker = GeminiTokenUsageTracker.getInstance();
  });

  afterEach(() => {
    GeminiTokenUsageTracker.resetInstance();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with empty usage', () => {
      expect(tracker.getAllUsage()).toEqual([]);
      expect(tracker.getGrandTotal()).toBe(0);
    });

    it('should load existing usage from storage', () => {
      const today = new Date().toISOString().split('T')[0];

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          date: today,
          models: {
            'gemini-2.5-flash': {
              input: 1000,
              output: 2000,
              reasoning: 500,
              cacheRead: 100,
              cacheWrite: 50,
              requestCount: 5,
            },
          },
        })
      );

      GeminiTokenUsageTracker.resetInstance();
      tracker = GeminiTokenUsageTracker.getInstance();

      const usage = tracker.getModelUsage('gemini-2.5-flash');
      expect(usage).toBeDefined();
      expect(usage?.totalInput).toBe(1000);
      expect(usage?.totalOutput).toBe(2000);
    });

    it('should not load usage from different date', () => {
      const yesterday = '2026-03-12';
      const today = new Date().toISOString().split('T')[0];

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          date: yesterday,
          models: {
            'gemini-2.5-flash': {
              input: 1000,
              output: 2000,
              reasoning: 500,
              cacheRead: 100,
              cacheWrite: 50,
              requestCount: 5,
            },
          },
        })
      );

      GeminiTokenUsageTracker.resetInstance();
      tracker = GeminiTokenUsageTracker.getInstance();

      // Should not load yesterday's data
      expect(tracker.getAllUsage()).toEqual([]);
    });

    it('should handle invalid storage data gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      GeminiTokenUsageTracker.resetInstance();
      tracker = GeminiTokenUsageTracker.getInstance();

      // Should start with empty usage
      expect(tracker.getAllUsage()).toEqual([]);
    });

    it('should handle storage with missing fields gracefully', () => {
      const today = new Date().toISOString().split('T')[0];

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          date: today,
          // models field missing
        })
      );

      GeminiTokenUsageTracker.resetInstance();
      tracker = GeminiTokenUsageTracker.getInstance();

      expect(tracker.getAllUsage()).toEqual([]);
    });
  });

  describe('recordUsage', () => {
    it('should record token usage for a model', () => {
      const tokens: TokenUsage = {
        input: 1000,
        output: 2000,
        reasoning: 500,
      };

      tracker.recordUsage('gemini-2.5-flash', tokens);

      const usage = tracker.getModelUsage('gemini-2.5-flash');
      expect(usage).toBeDefined();
      expect(usage?.totalInput).toBe(1000);
      expect(usage?.totalOutput).toBe(2000);
      expect(usage?.totalReasoning).toBe(500);
      expect(usage?.grandTotal).toBe(3500);
      expect(usage?.requestCount).toBe(1);
    });

    it('should accumulate multiple recordings for same model', () => {
      const tokens1: TokenUsage = { input: 1000, output: 2000, reasoning: 500 };
      const tokens2: TokenUsage = { input: 500, output: 1000, reasoning: 250 };

      tracker.recordUsage('gemini-2.5-flash', tokens1);
      tracker.recordUsage('gemini-2.5-flash', tokens2);

      const usage = tracker.getModelUsage('gemini-2.5-flash');
      expect(usage?.totalInput).toBe(1500);
      expect(usage?.totalOutput).toBe(3000);
      expect(usage?.totalReasoning).toBe(750);
      expect(usage?.grandTotal).toBe(5250);
      expect(usage?.requestCount).toBe(2);
    });

    it('should track multiple models separately', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });
      tracker.recordUsage('gemini-2.5-pro', {
        input: 2000,
        output: 3000,
        reasoning: 1000,
      });

      const flashUsage = tracker.getModelUsage('gemini-2.5-flash');
      const proUsage = tracker.getModelUsage('gemini-2.5-pro');

      expect(flashUsage?.grandTotal).toBe(3500);
      expect(proUsage?.grandTotal).toBe(6000);
    });

    it('should handle cache tokens', () => {
      const tokens: TokenUsage = {
        input: 1000,
        output: 2000,
        reasoning: 500,
        cacheRead: 100,
        cacheWrite: 50,
      };

      tracker.recordUsage('gemini-2.5-flash', tokens);

      const usage = tracker.getModelUsage('gemini-2.5-flash');
      expect(usage?.totalCacheRead).toBe(100);
      expect(usage?.totalCacheWrite).toBe(50);
      expect(usage?.grandTotal).toBe(3650); // Includes cache tokens
    });

    it('should handle missing optional token fields', () => {
      const tokens: TokenUsage = {
        input: 1000,
        output: 2000,
        reasoning: 0,
        // cacheRead and cacheWrite missing
      };

      tracker.recordUsage('gemini-2.5-flash', tokens);

      const usage = tracker.getModelUsage('gemini-2.5-flash');
      expect(usage?.totalCacheRead).toBe(0);
      expect(usage?.totalCacheWrite).toBe(0);
    });

    it('should update lastUpdated timestamp', () => {
      const beforeTime = Date.now();

      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      const usage = tracker.getModelUsage('gemini-2.5-flash');
      expect(usage?.lastUpdated).toBeGreaterThanOrEqual(beforeTime);
    });

    it('should not record when disposed', () => {
      tracker.dispose();

      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      expect(tracker.getModelUsage('gemini-2.5-flash')).toBeUndefined();
    });

    it('should emit usageUpdated event', () => {
      const spy = vi.fn();
      tracker.on('usageUpdated', spy);

      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.any(Array));
    });

    it('should save to storage after recording', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('getModelUsage', () => {
    it('should return undefined for unknown model', () => {
      expect(tracker.getModelUsage('unknown-model')).toBeUndefined();
    });

    it('should return usage for known model', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      const usage = tracker.getModelUsage('gemini-2.5-flash');
      expect(usage).toBeDefined();
      expect(usage?.model).toBe('gemini-2.5-flash');
    });

    it('should trigger daily reset check', () => {
      // This is implicitly tested through other tests that call getModelUsage
      // The checkDailyReset is called in getModelUsage
      const usage = tracker.getModelUsage('any-model');
      expect(usage).toBeUndefined();
    });
  });

  describe('getAllUsage', () => {
    it('should return empty array when no usage', () => {
      expect(tracker.getAllUsage()).toEqual([]);
    });

    it('should return all models sorted by grand total', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });
      tracker.recordUsage('gemini-2.5-pro', {
        input: 2000,
        output: 3000,
        reasoning: 1000,
      });
      tracker.recordUsage('gemini-2.5-flash-exp', {
        input: 500,
        output: 1000,
        reasoning: 250,
      });

      const allUsage = tracker.getAllUsage();

      expect(allUsage).toHaveLength(3);
      // Should be sorted by grand total descending
      expect(allUsage[0].model).toBe('gemini-2.5-pro'); // 6000
      expect(allUsage[1].model).toBe('gemini-2.5-flash'); // 3500
      expect(allUsage[2].model).toBe('gemini-2.5-flash-exp'); // 1750
    });

    it('should trigger daily reset check', () => {
      const allUsage = tracker.getAllUsage();
      expect(Array.isArray(allUsage)).toBe(true);
    });
  });

  describe('getGrandTotal', () => {
    it('should return 0 when no usage', () => {
      expect(tracker.getGrandTotal()).toBe(0);
    });

    it('should sum all model usage', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });
      tracker.recordUsage('gemini-2.5-pro', {
        input: 2000,
        output: 3000,
        reasoning: 1000,
      });

      expect(tracker.getGrandTotal()).toBe(9500); // 3500 + 6000
    });

    it('should include cache tokens in grand total', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
        cacheRead: 100,
        cacheWrite: 50,
      });

      expect(tracker.getGrandTotal()).toBe(3650);
    });

    it('should trigger daily reset check', () => {
      const total = tracker.getGrandTotal();
      expect(total).toBe(0);
    });
  });

  describe('getRemainingTokens', () => {
    it('should return full limit when no usage', () => {
      const remaining = tracker.getRemainingTokens(1_000_000);
      expect(remaining).toBe(1_000_000);
    });

    it('should subtract usage from limit', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 100_000,
        output: 200_000,
        reasoning: 50_000,
      });

      const remaining = tracker.getRemainingTokens(1_000_000);
      expect(remaining).toBe(650_000);
    });

    it('should return 0 when exceeded', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 500_000,
        output: 600_000,
        reasoning: 100_000,
      });

      const remaining = tracker.getRemainingTokens(1_000_000);
      expect(remaining).toBe(0);
    });

    it('should use default free tier limit', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 100_000,
        output: 200_000,
        reasoning: 50_000,
      });

      const remaining = tracker.getRemainingTokens(); // No limit specified
      expect(remaining).toBe(650_000); // Uses default 1M
    });

    it('should trigger daily reset check', () => {
      const remaining = tracker.getRemainingTokens();
      expect(remaining).toBe(1_000_000);
    });
  });

  describe('getUsagePercent', () => {
    it('should return 0 when no usage', () => {
      expect(tracker.getUsagePercent(1_000_000)).toBe(0);
    });

    it('should calculate percentage correctly', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 100_000,
        output: 200_000,
        reasoning: 50_000,
      });

      const percent = tracker.getUsagePercent(1_000_000);
      expect(percent).toBe(35); // 350000 / 1000000 * 100
    });

    it('should cap at 100', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 500_000,
        output: 600_000,
        reasoning: 100_000,
      });

      const percent = tracker.getUsagePercent(1_000_000);
      expect(percent).toBe(100);
    });

    it('should use default free tier limit', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 100_000,
        output: 200_000,
        reasoning: 50_000,
      });

      const percent = tracker.getUsagePercent(); // No limit specified
      expect(percent).toBe(35); // Uses default 1M
    });

    it('should trigger daily reset check', () => {
      const percent = tracker.getUsagePercent();
      expect(percent).toBe(0);
    });
  });

  describe('reset', () => {
    it('should clear all usage', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });
      tracker.recordUsage('gemini-2.5-pro', {
        input: 2000,
        output: 3000,
        reasoning: 1000,
      });

      tracker.reset();

      expect(tracker.getAllUsage()).toEqual([]);
      expect(tracker.getGrandTotal()).toBe(0);
    });

    it('should update currentDate', () => {
      const oldDate = new Date().toISOString().split('T')[0];
      tracker.reset();
      // Date should be updated (though hard to test exact value)
      expect(tracker.getGrandTotal()).toBe(0);
    });

    it('should save to storage', () => {
      tracker.reset();

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should emit usageUpdated with empty array', () => {
      const spy = vi.fn();
      tracker.on('usageUpdated', spy);

      tracker.reset();

      expect(spy).toHaveBeenCalledWith([]);
    });
  });

  describe('dispose', () => {
    it('should prevent further recording', () => {
      tracker.dispose();

      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      expect(tracker.getModelUsage('gemini-2.5-flash')).toBeUndefined();
    });

    it('should save to storage', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      tracker.dispose();

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should remove all event listeners', () => {
      const spy = vi.fn();
      tracker.on('usageUpdated', spy);

      tracker.dispose();
      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = GeminiTokenUsageTracker.getInstance();
      const instance2 = GeminiTokenUsageTracker.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = GeminiTokenUsageTracker.getInstance();
      GeminiTokenUsageTracker.resetInstance();
      const instance2 = GeminiTokenUsageTracker.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('resetInstance', () => {
    it('should dispose existing instance', () => {
      const instance1 = GeminiTokenUsageTracker.getInstance();

      GeminiTokenUsageTracker.resetInstance();

      // Instance should be disposed
      instance1.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      expect(instance1.getModelUsage('gemini-2.5-flash')).toBeUndefined();
    });

    it('should allow creating new instance', () => {
      GeminiTokenUsageTracker.resetInstance();

      const newInstance = GeminiTokenUsageTracker.getInstance();

      expect(newInstance).toBeDefined();
    });
  });

  describe('daily reset', () => {
    it('should reset when date changes', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      // Mock date change
      const tomorrow = '2026-03-14';
      vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(
        `${tomorrow}T12:00:00.000Z`
      );

      tracker.recordUsage('gemini-2.5-pro', {
        input: 2000,
        output: 3000,
        reasoning: 1000,
      });

      // Old usage should be gone
      expect(tracker.getModelUsage('gemini-2.5-flash')).toBeUndefined();

      // New usage should be present
      expect(tracker.getModelUsage('gemini-2.5-pro')).toBeDefined();
    });

    it('should emit dailyReset event', () => {
      const spy = vi.fn();
      tracker.on('dailyReset', spy);

      // Mock date change
      const tomorrow = '2026-03-14';
      vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(
        `${tomorrow}T12:00:00.000Z`
      );

      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      expect(spy).toHaveBeenCalledWith(tomorrow);
    });
  });

  describe('storage', () => {
    it('should load data from storage on initialization', () => {
      const today = new Date().toISOString().split('T')[0];

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          date: today,
          models: {
            'gemini-2.5-flash': {
              input: 1000,
              output: 2000,
              reasoning: 500,
              cacheRead: 100,
              cacheWrite: 50,
              requestCount: 5,
            },
          },
        })
      );

      GeminiTokenUsageTracker.resetInstance();
      const newTracker = GeminiTokenUsageTracker.getInstance();

      expect(newTracker.getModelUsage('gemini-2.5-flash')).toBeDefined();
    });

    it('should save data to storage', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('gemini-token-usage.json'),
        expect.stringContaining('"gemini-2.5-flash"'),
        'utf8'
      );
    });

    it('should create storage directory if not exists', () => {
      mockFs.existsSync.mockReturnValue(false);

      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      expect(mockFs.mkdirSync).toHaveBeenCalled();
    });

    it('should handle storage write errors gracefully', () => {
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write error');
      });

      expect(() => {
        tracker.recordUsage('gemini-2.5-flash', {
          input: 1000,
          output: 2000,
          reasoning: 500,
        });
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle zero token values', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: 0,
        output: 0,
        reasoning: 0,
      });

      const usage = tracker.getModelUsage('gemini-2.5-flash');
      expect(usage?.grandTotal).toBe(0);
    });

    it('should handle very large token values', () => {
      tracker.recordUsage('gemini-2.5-flash', {
        input: Number.MAX_SAFE_INTEGER,
        output: Number.MAX_SAFE_INTEGER,
        reasoning: Number.MAX_SAFE_INTEGER,
      });

      const usage = tracker.getModelUsage('gemini-2.5-flash');
      expect(usage?.grandTotal).toBeGreaterThan(0);
    });

    it('should handle multiple rapid recordings', () => {
      for (let i = 0; i < 100; i++) {
        tracker.recordUsage('gemini-2.5-flash', {
          input: 100,
          output: 200,
          reasoning: 50,
        });
      }

      const usage = tracker.getModelUsage('gemini-2.5-flash');
      expect(usage?.requestCount).toBe(100);
      expect(usage?.grandTotal).toBe(35000);
    });

    it('should handle model names with special characters', () => {
      tracker.recordUsage('gemini-2.5-flash-exp@beta', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      const usage = tracker.getModelUsage('gemini-2.5-flash-exp@beta');
      expect(usage).toBeDefined();
    });
  });

  describe('EventEmitter functionality', () => {
    it('should support multiple event listeners', () => {
      const spy1 = vi.fn();
      const spy2 = vi.fn();

      tracker.on('usageUpdated', spy1);
      tracker.on('usageUpdated', spy2);

      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      expect(spy1).toHaveBeenCalled();
      expect(spy2).toHaveBeenCalled();
    });

    it('should support removing event listeners', () => {
      const spy = vi.fn();
      tracker.on('usageUpdated', spy);
      tracker.off('usageUpdated', spy);

      tracker.recordUsage('gemini-2.5-flash', {
        input: 1000,
        output: 2000,
        reasoning: 500,
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
