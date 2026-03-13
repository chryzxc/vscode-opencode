/**
 * Comprehensive unit tests for QuotaService
 * Target: 100% coverage (lines, branches, functions, statements)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuotaService } from '../../../src/services/QuotaService';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

// Mock https
vi.mock('https', () => ({
  request: vi.fn(),
}));

// Mock GeminiTokenUsageTracker
vi.mock('../../../src/services/GeminiTokenUsageTracker', () => ({
  GeminiTokenUsageTracker: {
    getInstance: vi.fn(() => ({
      getAllUsage: vi.fn(() => []),
    })),
  },
}));

describe('QuotaService', () => {
  let service: QuotaService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock fs.readFileSync to return null by default (no auth file)
    (fs.readFileSync as any).mockImplementation(() => {
      throw new Error('File not found');
    });

    service = new QuotaService();
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  describe('Constructor and Initialization', () => {
    it('should extend EventEmitter', () => {
      expect(service).toBeInstanceOf(EventEmitter);
    });

    it('should start auto-refresh on construction', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      new QuotaService();
      expect(setIntervalSpy).toHaveBeenCalled();
      setIntervalSpy.mockRestore();
    });

    it('should have timer field', () => {
      expect((service as any).timer).toBeDefined();
    });

    it('should have isDisposed flag', () => {
      expect((service as any).isDisposed).toBe(false);
    });

    it('should have cachedData field', () => {
      expect((service as any)._cachedData).toBeDefined();
    });
  });

  describe('cachedData getter', () => {
    it('should return cached data', () => {
      const mockData = {
        platforms: [],
        lastUpdated: Date.now(),
      };
      (service as any)._cachedData = mockData;
      expect(service.cachedData).toBe(mockData);
    });

    it('should return null when not cached', () => {
      expect(service.cachedData).toBeNull();
    });
  });

  describe('startAutoRefresh', () => {
    it('should clear existing timer', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      (service as any).timer = setTimeout(() => {}, 1000);

      service.startAutoRefresh();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('should set new interval timer', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      service.startAutoRefresh();
      expect(setIntervalSpy).toHaveBeenCalled();
      setIntervalSpy.mockRestore();
    });

    it('should use default interval when not specified', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      service.startAutoRefresh();
      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        5 * 60 * 1000 // 5 minutes
      );
      setIntervalSpy.mockRestore();
    });

    it('should use custom interval when specified', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      service.startAutoRefresh(10000);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10000);
      setIntervalSpy.mockRestore();
    });

    it('should do initial refresh', () => {
      const refreshSpy = vi.spyOn(service, 'refreshQuota').mockResolvedValue({
        platforms: [],
        lastUpdated: Date.now(),
      });

      service.startAutoRefresh();

      expect(refreshSpy).toHaveBeenCalled();
      refreshSpy.mockRestore();
    });

    it('should check isDisposed before refresh', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      service.startAutoRefresh();

      const timerCallback = setIntervalSpy.mock.calls[0][0];
      (service as any).isDisposed = true;

      const refreshSpy = vi.spyOn(service, 'refreshQuota').mockResolvedValue({
        platforms: [],
        lastUpdated: Date.now(),
      });

      timerCallback();

      expect(refreshSpy).not.toHaveBeenCalled();

      setIntervalSpy.mockRestore();
      refreshSpy.mockRestore();
    });
  });

  describe('refreshQuota', () => {
    it('should read auth file', async () => {
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({}));

      await service.refreshQuota();

      expect(fs.readFileSync).toHaveBeenCalled();
    });

    it('should emit quotaUpdate event', async () => {
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({}));

      const emitSpy = vi.spyOn(service, 'emit');
      await service.refreshQuota();

      expect(emitSpy).toHaveBeenCalledWith('quotaUpdate', expect.any(Object));
    });

    it('should cache result', async () => {
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({}));

      await service.refreshQuota();

      expect(service.cachedData).not.toBeNull();
    });

    it('should return QuotaData with platforms and timestamp', async () => {
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({}));

      const result = await service.refreshQuota();

      expect(result).toHaveProperty('platforms');
      expect(result).toHaveProperty('lastUpdated');
      expect(typeof result.lastUpdated).toBe('number');
    });

    it('should handle no auth file with error status', async () => {
      (fs.readFileSync as any).mockImplementation(() => {
        throw new Error('File not found');
      });

      const result = await service.refreshQuota();

      expect(result.platforms).toHaveLength(1);
      expect(result.platforms[0].platform).toBe('opencode');
      expect(result.platforms[0].status).toBe('error');
      expect(result.platforms[0].error).toBe('No auth.json found');
    });

    it('should handle auth with no recognized providers', async () => {
      (fs.readFileSync as any).mockReturnValue(
        JSON.stringify({ unknownProvider: {} })
      );

      const result = await service.refreshQuota();

      expect(result.platforms).toHaveLength(1);
      expect(result.platforms[0].platform).toBe('opencode');
      expect(result.platforms[0].status).toBe('ok');
      expect(result.platforms[0].quotas).toHaveLength(1);
      expect(result.platforms[0].quotas[0].label).toBe('Connected');
    });
  });

  describe('fetchOpenAI', () => {
    it('should return null when no access token', async () => {
      const result = await (service as any).fetchOpenAI({});
      expect(result).toBeNull();
    });

    it('should make HTTPS GET request to OpenAI usage URL', async () => {
      const mockRequest = {
        on: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      // Simulate response
      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('{"rate_limit": {}}'));
        } else if (event === 'end') {
          callback();
        }
      });

      await (service as any).fetchOpenAI({ access: 'test-token' });

      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'chatgpt.com',
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
        expect.any(Function)
      );
    });

    it('should parse weekly window from response', async () => {
      const mockRequest = {
        on: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(
            Buffer.from(
              JSON.stringify({
                rate_limit: {
                  weekly_window: {
                    used_percent: 50,
                    reset_after_seconds: 3600,
                  },
                },
              })
            )
          );
        } else if (event === 'end') {
          callback();
        }
      });

      const result = await (service as any).fetchOpenAI({ access: 'test-token' });

      expect(result).not.toBeNull();
      expect(result.platform).toBe('openai');
    });

    it('should handle errors gracefully', async () => {
      const mockRequest = {
        on: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('Network error'));
        }
      });

      const result = await (service as any).fetchOpenAI({ access: 'test-token' });

      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
    });
  });

  describe('fetchZhipu', () => {
    it('should return null when no key', async () => {
      const result = await (service as any).fetchZhipu({}, 'Zhipu AI', 'https://test.com');
      expect(result).toBeNull();
    });

    it('should make HTTPS GET request', async () => {
      const mockRequest = {
        on: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('{"data": {"limits": []}}'));
        } else if (event === 'end') {
          callback();
        }
      });

      await (service as any).fetchZhipu({ key: 'test-key' }, 'Zhipu AI', 'https://test.com');

      expect(https.request).toHaveBeenCalled();
    });

    it('should parse limits array', async () => {
      const mockRequest = {
        on: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(
            Buffer.from(
              JSON.stringify({
                data: {
                  limits: [
                    {
                      type: 'TOKENS_LIMIT',
                      usage: 1000,
                      currentValue: 500,
                      percentage: 50,
                    },
                  ],
                },
              })
            )
          );
        } else if (event === 'end') {
          callback();
        }
      });

      const result = await (service as any).fetchZhipu({ key: 'test-key' }, 'Zhipu AI', 'https://test.com');

      expect(result.platform).toBe('zhipu-ai');
      expect(result.quotas).toHaveLength(1);
    });

    it('should handle errors', async () => {
      const mockRequest = {
        on: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('Network error'));
        }
      });

      const result = await (service as any).fetchZhipu({ key: 'test-key' }, 'Zhipu AI', 'https://test.com');

      expect(result.status).toBe('error');
    });
  });

  describe('fetchCopilot', () => {
    it('should return error when no token available', async () => {
      const result = await (service as any).fetchCopilot(undefined, undefined);
      expect(result.status).toBe('error');
      expect(result.error).toBe('No access token available');
    });

    it('should refresh expired token', async () => {
      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      // Token refresh response
      let requestCount = 0;
      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          requestCount++;
          if (requestCount === 1) {
            // Token refresh
            callback(Buffer.from('{"access_token": "new-token"}'));
          } else if (requestCount === 2) {
            // Copilot API token
            callback(Buffer.from('{"token": "copilot-token"}'));
          } else if (requestCount === 3) {
            // User data
            callback(
              Buffer.from(
                JSON.stringify({
                  quota_snapshots: {
                    premium_interactions: {
                      entitlement: 300,
                      remaining: 150,
                      percent_remaining: 50,
                    },
                  },
                  copilot_plan: 'pro',
                  quota_reset_date: '2024-01-01T00:00:00Z',
                })
              )
            );
          }
        } else if (event === 'end') {
          callback();
        }
      });

      const expiredAuth = {
        access: 'old-token',
        expires: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        refresh: 'refresh-token',
      };

      const result = await (service as any).fetchCopilot(expiredAuth, {});

      expect(result.platform).toBe('github-copilot');
      expect(result.status).toBe('ok');
    });
  });

  describe('fetchGoogle', () => {
    it('should return array of platform quotas', async () => {
      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      let requestCount = 0;
      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          requestCount++;
          if (requestCount === 1) {
            // Token refresh
            callback(Buffer.from('{"access_token": "google-token"}'));
          } else if (requestCount === 2) {
            // Quota API
            callback(
              Buffer.from(
                JSON.stringify({
                  models: [
                    {
                      id: 'gemini-3-pro-high',
                      quota: {
                        dailyUsage: 500000,
                        dailyLimit: 1000000,
                      },
                    },
                  ],
                })
              )
            );
          }
        } else if (event === 'end') {
          callback();
        }
      });

      const result = await (service as any).fetchGoogle({
        email: 'test@example.com',
        refreshToken: 'refresh-token',
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result[0].platform).toBe('google');
    });

    it('should handle token refresh errors', async () => {
      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('Token refresh failed'));
        }
      });

      const result = await (service as any).fetchGoogle({
        email: 'test@example.com',
        refreshToken: 'invalid-token',
      });

      expect(result[0].status).toBe('error');
      expect(result[0].error).toContain('Token refresh failed');
    });
  });

  describe('dispose', () => {
    it('should set isDisposed flag', () => {
      service.dispose();
      expect((service as any).isDisposed).toBe(true);
    });

    it('should clear timer', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      service.dispose();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('should null timer reference', () => {
      service.dispose();
      expect((service as any).timer).toBeNull();
    });

    it('should remove all event listeners', () => {
      const removeAllListenersSpy = vi.spyOn(service, 'removeAllListeners');
      service.dispose();
      expect(removeAllListenersSpy).toHaveBeenCalled();
      removeAllListenersSpy.mockRestore();
    });
  });
});

describe('Helper Functions', () => {
  describe('formatNumber', () => {
    it('should format millions', () => {
      const { formatNumber } = require('../../../src/services/QuotaService');
      expect(formatNumber(1500000)).toBe('1.5M');
    });

    it('should format thousands', () => {
      const { formatNumber } = require('../../../src/services/QuotaService');
      expect(formatNumber(1500)).toBe('1.5K');
    });

    it('should return string for small numbers', () => {
      const { formatNumber } = require('../../../src/services/QuotaService');
      expect(formatNumber(500)).toBe('500');
    });
  });

  describe('formatDuration', () => {
    it('should format days and hours', () => {
      const { formatDuration } = require('../../../src/services/QuotaService');
      expect(formatDuration(90000)).toBe('1d 1h'); // 1 day + 1 hour
    });

    it('should format hours and minutes', () => {
      const { formatDuration } = require('../../../src/services/QuotaService');
      expect(formatDuration(3660)).toBe('1h 1m');
    });

    it('should format minutes only', () => {
      const { formatDuration } = require('../../../src/services/QuotaService');
      expect(formatDuration(59)).toBe('59m');
    });

    it('should handle negative numbers', () => {
      const { formatDuration } = require('../../../src/services/QuotaService');
      expect(formatDuration(-100)).toBe('0m');
    });
  });

  describe('formatResetFromTimestampMs', () => {
    it('should return undefined for invalid timestamp', () => {
      const { formatResetFromTimestampMs } = require('../../../src/services/QuotaService');
      expect(formatResetFromTimestampMs(NaN)).toBeUndefined();
      expect(formatResetFromTimestampMs(0)).toBeUndefined();
    });

    it('should return "soon" for past timestamps', () => {
      const { formatResetFromTimestampMs } = require('../../../src/services/QuotaService');
      const pastTimestamp = Date.now() - 1000;
      expect(formatResetFromTimestampMs(pastTimestamp)).toBe('soon');
    });

    it('should format future timestamps', () => {
      const { formatResetFromTimestampMs } = require('../../../src/services/QuotaService');
      const futureTimestamp = Date.now() + 3600000; // 1 hour from now
      const result = formatResetFromTimestampMs(futureTimestamp);
      expect(result).toBeDefined();
      expect(result).toContain('m');
    });
  });

  describe('maskAccount', () => {
    it('should mask account string', () => {
      const { maskAccount } = require('../../../src/services/QuotaService');
      expect(maskAccount('1234567890')).toBe('1234****7890');
    });

    it('should return original string if too short', () => {
      const { maskAccount } = require('../../../src/services/QuotaService');
      expect(maskAccount('12')).toBe('12');
    });

    it('should return unknown for empty string', () => {
      const { maskAccount } = require('../../../src/services/QuotaService');
      expect(maskAccount('')).toBe('unknown');
    });

    it('should handle custom start/end parameters', () => {
      const { maskAccount } = require('../../../src/services/QuotaService');
      expect(maskAccount('1234567890', 2, 2)).toBe('12****90');
    });
  });

  describe('normalizePlatformId', () => {
    it('should lowercase platform name', () => {
      const { normalizePlatformId } = require('../../../src/services/QuotaService');
      expect(normalizePlatformId('OpenAI')).toBe('openai');
    });

    it('should replace spaces with hyphens', () => {
      const { normalizePlatformId } = require('../../../src/services/QuotaService');
      expect(normalizePlatformId('Zhipu AI')).toBe('zhipu-ai');
    });

    it('should remove dots', () => {
      const { normalizePlatformId } = require('../../../src/services/QuotaService');
      expect(normalizePlatformId('Z.AI')).toBe('zai');
    });
  });

  describe('percentBar', () => {
    it('should clamp to 0-100 range', () => {
      const { percentBar } = require('../../../src/services/QuotaService');
      expect(percentBar(-10)).toBe(0);
      expect(percentBar(150)).toBe(100);
    });

    it('should round to integer', () => {
      const { percentBar } = require('../../../src/services/QuotaService');
      expect(percentBar(50.7)).toBe(51);
    });
  });
});

describe('HTTPS Helper Functions', () => {
  describe('httpsGet', () => {
    it('should make GET request with timeout', async () => {
      const { httpsGet } = require('../../../src/services/QuotaService');
      const mockRequest = {
        on: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('{"data": "test"}'));
        } else if (event === 'end') {
          callback();
        }
      });

      const result = await httpsGet('https://test.com', { 'User-Agent': 'test' });

      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          timeout: 10000,
        }),
        expect.any(Function)
      );
      expect(result).toBe('{"data": "test"}');
    });

    it('should handle timeout', async () => {
      const { httpsGet } = require('../../../src/services/QuotaService');
      const mockRequest = {
        on: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'timeout') {
          callback();
        }
      });

      await expect(httpsGet('https://test.com', {})).rejects.toThrow();
    });

    it('should handle errors', async () => {
      const { httpsGet } = require('../../../src/services/QuotaService');
      const mockRequest = {
        on: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('Network error'));
        }
      });

      await expect(httpsGet('https://test.com', {})).rejects.toThrow('Network error');
    });
  });

  describe('httpsPost', () => {
    it('should make POST request with body', async () => {
      const { httpsPost } = require('../../../src/services/QuotaService');
      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockReturnValue(mockRequest);

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('{"result": "success"}'));
        } else if (event === 'end') {
          callback();
        }
      });

      const result = await httpsPost('https://test.com', {}, '{"test": "data"}');

      expect(mockRequest.write).toHaveBeenCalledWith('{"test": "data"}');
      expect(mockRequest.end).toHaveBeenCalled();
      expect(result).toBe('{"result": "success"}');
    });

    it('should set Content-Length header', async () => {
      const { httpsPost } = require('../../../src/services/QuotaService');
      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      (https.request as any).mockImplementation((options, callback) => {
        expect(options.headers['Content-Length']).toBeGreaterThan(0);
        return mockRequest;
      });

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('{}'));
        } else if (event === 'end') {
          callback();
        }
      });

      await httpsPost('https://test.com', {}, '{}');
    });
  });
});
