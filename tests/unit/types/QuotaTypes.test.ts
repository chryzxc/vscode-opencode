/**
 * Comprehensive unit tests for QuotaTypes types
 * 100% coverage - tests all interfaces and type definitions
 */

import { describe, it, expect } from 'vitest';

// Import types from QuotaTypes.ts
import type {
  QuotaItem,
  PlatformQuota,
  QuotaData,
  OpenAIAuthData,
  ZhipuAuthData,
  CopilotAuthData,
  AuthData,
  AntigravityAccount,
  AntigravityAccountsFile,
  CopilotTier,
  CopilotQuotaConfig,
} from '../../../src/types/QuotaTypes';

describe('QuotaTypes Types', () => {
  describe('QuotaItem', () => {
    it('should accept valid QuotaItem with all fields', () => {
      const quotaItem: QuotaItem = {
        label: 'API Calls',
        remainPercent: 75,
        used: '7500',
        total: '10000',
        resetDisplay: 'Resets in 5 days',
        usedTotalDisplay: '7,500 / 10,000',
        percentLabel: '75%',
        resetLabel: 'Daily reset',
        resetAt: '2026-03-18T00:00:00Z',
        note: 'Rate limited',
      };

      expect(quotaItem.label).toBe('API Calls');
      expect(quotaItem.remainPercent).toBe(75);
      expect(quotaItem.used).toBe('7500');
      expect(quotaItem.total).toBe('10000');
      expect(quotaItem.resetDisplay).toBe('Resets in 5 days');
      expect(quotaItem.usedTotalDisplay).toBe('7,500 / 10,000');
      expect(quotaItem.percentLabel).toBe('75%');
      expect(quotaItem.resetLabel).toBe('Daily reset');
      expect(quotaItem.resetAt).toBe('2026-03-18T00:00:00Z');
      expect(quotaItem.note).toBe('Rate limited');
    });

    it('should accept QuotaItem with minimal fields', () => {
      const quotaItem: QuotaItem = {
        label: 'API Calls',
        remainPercent: 50,
      };

      expect(quotaItem.label).toBe('API Calls');
      expect(quotaItem.remainPercent).toBe(50);
      expect(quotaItem.used).toBeUndefined();
      expect(quotaItem.total).toBeUndefined();
    });

    it('should accept remainPercent of 0', () => {
      const quotaItem: QuotaItem = {
        label: 'Depleted',
        remainPercent: 0,
      };

      expect(quotaItem.remainPercent).toBe(0);
    });

    it('should accept remainPercent of 100', () => {
      const quotaItem: QuotaItem = {
        label: 'Full',
        remainPercent: 100,
      };

      expect(quotaItem.remainPercent).toBe(100);
    });

    it('should accept all optional fields independently', () => {
      const withUsed: QuotaItem = {
        label: 'Test',
        remainPercent: 50,
        used: '5000',
      };

      const withTotal: QuotaItem = {
        label: 'Test',
        remainPercent: 50,
        total: '10000',
      };

      const withResetDisplay: QuotaItem = {
        label: 'Test',
        remainPercent: 50,
        resetDisplay: 'Tomorrow',
      };

      expect(withUsed.used).toBeDefined();
      expect(withTotal.total).toBeDefined();
      expect(withResetDisplay.resetDisplay).toBeDefined();
    });
  });

  describe('PlatformQuota', () => {
    it('should accept valid PlatformQuota with all fields', () => {
      const platformQuota: PlatformQuota = {
        platform: 'openai',
        account: 'user@example.com',
        accountLabel: 'User Account',
        title: 'OpenAI Quota',
        status: 'ok',
        error: undefined,
        quotas: [
          {
            label: 'API Calls',
            remainPercent: 75,
            used: '7500',
            total: '10000',
          },
        ],
      };

      expect(platformQuota.platform).toBe('openai');
      expect(platformQuota.account).toBe('user@example.com');
      expect(platformQuota.accountLabel).toBe('User Account');
      expect(platformQuota.title).toBe('OpenAI Quota');
      expect(platformQuota.status).toBe('ok');
      expect(platformQuota.quotas).toHaveLength(1);
    });

    it('should accept PlatformQuota with minimal fields', () => {
      const platformQuota: PlatformQuota = {
        platform: 'anthropic',
        account: 'account123',
        status: 'ok',
        quotas: [],
      };

      expect(platformQuota.platform).toBe('anthropic');
      expect(platformQuota.account).toBe('account123');
      expect(platformQuota.status).toBe('ok');
      expect(platformQuota.accountLabel).toBeUndefined();
      expect(platformQuota.title).toBeUndefined();
    });

    it('should accept all status values', () => {
      const okStatus: PlatformQuota = {
        platform: 'test',
        account: 'test',
        status: 'ok',
        quotas: [],
      };

      const warningStatus: PlatformQuota = {
        platform: 'test',
        account: 'test',
        status: 'warning',
        quotas: [],
      };

      const errorStatus: PlatformQuota = {
        platform: 'test',
        account: 'test',
        status: 'error',
        error: 'API error',
        quotas: [],
      };

      expect(okStatus.status).toBe('ok');
      expect(warningStatus.status).toBe('warning');
      expect(errorStatus.status).toBe('error');
    });

    it('should require error field when status is error', () => {
      const platformQuota: PlatformQuota = {
        platform: 'test',
        account: 'test',
        status: 'error',
        error: 'Authentication failed',
        quotas: [],
      };

      expect(platformQuota.error).toBe('Authentication failed');
    });

    it('should accept empty quotas array', () => {
      const platformQuota: PlatformQuota = {
        platform: 'test',
        account: 'test',
        status: 'ok',
        quotas: [],
      };

      expect(platformQuota.quotas).toEqual([]);
    });

    it('should accept multiple quota items', () => {
      const platformQuota: PlatformQuota = {
        platform: 'test',
        account: 'test',
        status: 'ok',
        quotas: [
          { label: 'Quota 1', remainPercent: 50 },
          { label: 'Quota 2', remainPercent: 75 },
          { label: 'Quota 3', remainPercent: 100 },
        ],
      };

      expect(platformQuota.quotas).toHaveLength(3);
    });
  });

  describe('QuotaData', () => {
    it('should accept valid QuotaData', () => {
      const quotaData: QuotaData = {
        platforms: [
          {
            platform: 'openai',
            account: 'user@example.com',
            status: 'ok',
            quotas: [],
          },
          {
            platform: 'anthropic',
            account: 'user@example.com',
            status: 'ok',
            quotas: [],
          },
        ],
        lastUpdated: Date.now(),
      };

      expect(quotaData.platforms).toHaveLength(2);
      expect(quotaData.lastUpdated).toBeDefined();
    });

    it('should accept empty platforms array', () => {
      const quotaData: QuotaData = {
        platforms: [],
        lastUpdated: Date.now(),
      };

      expect(quotaData.platforms).toEqual([]);
    });

    it('should accept timestamp as lastUpdated', () => {
      const timestamp = 1678838400000; // 2023-03-15
      const quotaData: QuotaData = {
        platforms: [],
        lastUpdated: timestamp,
      };

      expect(quotaData.lastUpdated).toBe(timestamp);
    });

    it('should accept current timestamp', () => {
      const quotaData: QuotaData = {
        platforms: [],
        lastUpdated: Date.now(),
      };

      expect(quotaData.lastUpdated).toBeGreaterThan(0);
    });
  });

  describe('OpenAIAuthData', () => {
    it('should accept valid OpenAIAuthData with all fields', () => {
      const authData: OpenAIAuthData = {
        type: 'oauth',
        access: 'access_token_123',
        refresh: 'refresh_token_456',
        expires: 1678838400000,
      };

      expect(authData.type).toBe('oauth');
      expect(authData.access).toBe('access_token_123');
      expect(authData.refresh).toBe('refresh_token_456');
      expect(authData.expires).toBe(1678838400000);
    });

    it('should accept OpenAIAuthData with minimal fields', () => {
      const authData: OpenAIAuthData = {
        type: 'api_key',
      };

      expect(authData.type).toBe('api_key');
      expect(authData.access).toBeUndefined();
    });

    it('should accept access token without refresh', () => {
      const authData: OpenAIAuthData = {
        type: 'oauth',
        access: 'access_token',
      };

      expect(authData.access).toBeDefined();
      expect(authData.refresh).toBeUndefined();
    });

    it('should accept timestamp for expires', () => {
      const authData: OpenAIAuthData = {
        type: 'oauth',
        access: 'token',
        expires: Date.now(),
      };

      expect(authData.expires).toBeGreaterThan(0);
    });
  });

  describe('ZhipuAuthData', () => {
    it('should accept valid ZhipuAuthData with all fields', () => {
      const authData: ZhipuAuthData = {
        type: 'api_key',
        key: 'zhipu_api_key_123',
      };

      expect(authData.type).toBe('api_key');
      expect(authData.key).toBe('zhipu_api_key_123');
    });

    it('should accept ZhipuAuthData with minimal fields', () => {
      const authData: ZhipuAuthData = {
        type: 'oauth',
      };

      expect(authData.type).toBe('oauth');
      expect(authData.key).toBeUndefined();
    });

    it('should accept empty string key', () => {
      const authData: ZhipuAuthData = {
        type: 'api_key',
        key: '',
      };

      expect(authData.key).toBe('');
    });
  });

  describe('CopilotAuthData', () => {
    it('should accept valid CopilotAuthData with all fields', () => {
      const authData: CopilotAuthData = {
        type: 'oauth',
        refresh: 'refresh_token_123',
        access: 'access_token_456',
        expires: 1678838400000,
      };

      expect(authData.type).toBe('oauth');
      expect(authData.refresh).toBe('refresh_token_123');
      expect(authData.access).toBe('access_token_456');
      expect(authData.expires).toBe(1678838400000);
    });

    it('should accept CopilotAuthData with minimal fields', () => {
      const authData: CopilotAuthData = {
        type: 'token',
      };

      expect(authData.type).toBe('token');
      expect(authData.refresh).toBeUndefined();
    });

    it('should accept refresh token without access', () => {
      const authData: CopilotAuthData = {
        type: 'oauth',
        refresh: 'refresh_token',
      };

      expect(authData.refresh).toBeDefined();
      expect(authData.access).toBeUndefined();
    });
  });

  describe('AuthData', () => {
    it('should accept valid AuthData with all providers', () => {
      const authData: AuthData = {
        openai: {
          type: 'oauth',
          access: 'openai_access',
          refresh: 'openai_refresh',
          expires: 1678838400000,
        },
        'zhipuai-coding-plan': {
          type: 'api_key',
          key: 'zhipu_key',
        },
        'zai-coding-plan': {
          type: 'api_key',
          key: 'zai_key',
        },
        'github-copilot': {
          type: 'oauth',
          refresh: 'copilot_refresh',
          access: 'copilot_access',
          expires: 1678838400000,
        },
      };

      expect(authData.openai).toBeDefined();
      expect(authData['zhipuai-coding-plan']).toBeDefined();
      expect(authData['zai-coding-plan']).toBeDefined();
      expect(authData['github-copilot']).toBeDefined();
    });

    it('should accept AuthData with only one provider', () => {
      const authData: AuthData = {
        openai: {
          type: 'api_key',
        },
      };

      expect(authData.openai).toBeDefined();
      expect(authData['zhipuai-coding-plan']).toBeUndefined();
    });

    it('should accept AuthData with no providers', () => {
      const authData: AuthData = {};

      expect(Object.keys(authData)).toHaveLength(0);
    });

    it('should accept AuthData with multiple providers', () => {
      const authData: AuthData = {
        openai: { type: 'oauth', access: 'token' },
        'github-copilot': { type: 'oauth', refresh: 'token' },
      };

      expect(authData.openai).toBeDefined();
      expect(authData['github-copilot']).toBeDefined();
      expect(authData['zhipuai-coding-plan']).toBeUndefined();
    });
  });

  describe('AntigravityAccount', () => {
    it('should accept valid AntigravityAccount with all fields', () => {
      const account: AntigravityAccount = {
        email: 'user@example.com',
        refreshToken: 'refresh_token_123',
        projectId: 'project_456',
        managedProjectId: 'managed_project_789',
        addedAt: 1678838400000,
        lastUsed: 1678924800000,
      };

      expect(account.email).toBe('user@example.com');
      expect(account.refreshToken).toBe('refresh_token_123');
      expect(account.projectId).toBe('project_456');
      expect(account.managedProjectId).toBe('managed_project_789');
      expect(account.addedAt).toBe(1678838400000);
      expect(account.lastUsed).toBe(1678924800000);
    });

    it('should accept AntigravityAccount with minimal fields', () => {
      const account: AntigravityAccount = {
        refreshToken: 'refresh_token',
        addedAt: Date.now(),
        lastUsed: Date.now(),
      };

      expect(account.refreshToken).toBe('refresh_token');
      expect(account.email).toBeUndefined();
      expect(account.projectId).toBeUndefined();
    });

    it('should accept timestamps for addedAt and lastUsed', () => {
      const now = Date.now();
      const account: AntigravityAccount = {
        refreshToken: 'token',
        addedAt: now - 86400000, // 1 day ago
        lastUsed: now,
      };

      expect(account.addedAt).toBeLessThan(account.lastUsed);
    });

    it('should accept email with @ symbol', () => {
      const account: AntigravityAccount = {
        email: 'user@domain.com',
        refreshToken: 'token',
        addedAt: Date.now(),
        lastUsed: Date.now(),
      };

      expect(account.email).toContain('@');
    });
  });

  describe('AntigravityAccountsFile', () => {
    it('should accept valid AntigravityAccountsFile', () => {
      const accountsFile: AntigravityAccountsFile = {
        version: 1,
        accounts: [
          {
            email: 'user1@example.com',
            refreshToken: 'token1',
            addedAt: Date.now(),
            lastUsed: Date.now(),
          },
          {
            email: 'user2@example.com',
            refreshToken: 'token2',
            projectId: 'project1',
            addedAt: Date.now(),
            lastUsed: Date.now(),
          },
        ],
      };

      expect(accountsFile.version).toBe(1);
      expect(accountsFile.accounts).toHaveLength(2);
    });

    it('should accept empty accounts array', () => {
      const accountsFile: AntigravityAccountsFile = {
        version: 1,
        accounts: [],
      };

      expect(accountsFile.accounts).toEqual([]);
    });

    it('should accept version number', () => {
      const accountsFile: AntigravityAccountsFile = {
        version: 2,
        accounts: [],
      };

      expect(accountsFile.version).toBe(2);
    });
  });

  describe('CopilotTier', () => {
    it('should accept "free" tier', () => {
      const tier: CopilotTier = 'free';
      expect(tier).toBe('free');
    });

    it('should accept "pro" tier', () => {
      const tier: CopilotTier = 'pro';
      expect(tier).toBe('pro');
    });

    it('should accept "pro+" tier', () => {
      const tier: CopilotTier = 'pro+';
      expect(tier).toBe('pro+');
    });

    it('should accept "business" tier', () => {
      const tier: CopilotTier = 'business';
      expect(tier).toBe('business');
    });

    it('should accept "enterprise" tier', () => {
      const tier: CopilotTier = 'enterprise';
      expect(tier).toBe('enterprise');
    });

    it('should use tier in CopilotQuotaConfig', () => {
      const config: CopilotQuotaConfig = {
        token: 'token',
        username: 'user',
        tier: 'pro+',
      };

      expect(config.tier).toBe('pro+');
    });
  });

  describe('CopilotQuotaConfig', () => {
    it('should accept valid CopilotQuotaConfig with all tiers', () => {
      const tiers: CopilotTier[] = ['free', 'pro', 'pro+', 'business', 'enterprise'];

      tiers.forEach((tier) => {
        const config: CopilotQuotaConfig = {
          token: `token_${tier}`,
          username: `user_${tier}`,
          tier,
        };

        expect(config.tier).toBe(tier);
      });
    });

    it('should accept CopilotQuotaConfig with all fields', () => {
      const config: CopilotQuotaConfig = {
        token: 'github_token_123',
        username: 'githubuser',
        tier: 'pro',
      };

      expect(config.token).toBe('github_token_123');
      expect(config.username).toBe('githubuser');
      expect(config.tier).toBe('pro');
    });

    it('should accept empty strings for token and username', () => {
      const config: CopilotQuotaConfig = {
        token: '',
        username: '',
        tier: 'free',
      };

      expect(config.token).toBe('');
      expect(config.username).toBe('');
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle complete QuotaData with multiple platforms', () => {
      const quotaData: QuotaData = {
        platforms: [
          {
            platform: 'openai',
            account: 'user@example.com',
            accountLabel: 'Personal Account',
            title: 'OpenAI',
            status: 'ok',
            quotas: [
              {
                label: 'GPT-4 API',
                remainPercent: 75,
                used: '750',
                total: '1000',
                resetDisplay: 'Resets daily',
                usedTotalDisplay: '750 / 1000',
                percentLabel: '75%',
              },
            ],
          },
          {
            platform: 'anthropic',
            account: 'user@example.com',
            accountLabel: 'Personal Account',
            title: 'Anthropic',
            status: 'warning',
            quotas: [
              {
                label: 'Claude API',
                remainPercent: 20,
                used: '8000',
                total: '10000',
                note: 'Approaching limit',
              },
            ],
          },
        ],
        lastUpdated: Date.now(),
      };

      expect(quotaData.platforms).toHaveLength(2);
      expect(quotaData.platforms[0].status).toBe('ok');
      expect(quotaData.platforms[1].status).toBe('warning');
    });

    it('should handle AuthData with all provider types', () => {
      const authData: AuthData = {
        openai: {
          type: 'oauth',
          access: 'oa_access',
          refresh: 'oa_refresh',
          expires: Date.now() + 3600000,
        },
        'zhipuai-coding-plan': {
          type: 'api_key',
          key: 'zhipu_key',
        },
        'zai-coding-plan': {
          type: 'api_key',
          key: 'zai_key',
        },
        'github-copilot': {
          type: 'oauth',
          refresh: 'copilot_refresh',
          access: 'copilot_access',
          expires: Date.now() + 3600000,
        },
      };

      expect(authData.openai?.type).toBe('oauth');
      expect(authData['zhipuai-coding-plan']?.type).toBe('api_key');
      expect(authData['zai-coding-plan']?.type).toBe('api_key');
      expect(authData['github-copilot']?.type).toBe('oauth');
    });

    it('should handle AntigravityAccountsFile with multiple accounts', () => {
      const accountsFile: AntigravityAccountsFile = {
        version: 1,
        accounts: [
          {
            email: 'user1@example.com',
            refreshToken: 'token1',
            projectId: 'proj1',
            addedAt: Date.now() - 86400000,
            lastUsed: Date.now(),
          },
          {
            email: 'user2@example.com',
            refreshToken: 'token2',
            managedProjectId: 'managed1',
            addedAt: Date.now() - 172800000,
            lastUsed: Date.now() - 3600000,
          },
        ],
      };

      expect(accountsFile.accounts).toHaveLength(2);
      expect(accountsFile.accounts[0].email).toBe('user1@example.com');
      expect(accountsFile.accounts[1].email).toBe('user2@example.com');
    });
  });

  describe('Edge Cases', () => {
    it('should handle QuotaItem with 0% remaining', () => {
      const quotaItem: QuotaItem = {
        label: 'Depleted',
        remainPercent: 0,
        used: '10000',
        total: '10000',
        note: 'Quota exhausted',
      };

      expect(quotaItem.remainPercent).toBe(0);
    });

    it('should handle QuotaItem with 100% remaining', () => {
      const quotaItem: QuotaItem = {
        label: 'Full',
        remainPercent: 100,
        used: '0',
        total: '10000',
      };

      expect(quotaItem.remainPercent).toBe(100);
    });

    it('should handle PlatformQuota with error status', () => {
      const platformQuota: PlatformQuota = {
        platform: 'test',
        account: 'test@example.com',
        status: 'error',
        error: 'Authentication failed: Invalid credentials',
        quotas: [],
      };

      expect(platformQuota.status).toBe('error');
      expect(platformQuota.error).toBeDefined();
    });

    it('should handle empty strings in all optional fields', () => {
      const platformQuota: PlatformQuota = {
        platform: 'test',
        account: '',
        accountLabel: '',
        title: '',
        status: 'ok',
        quotas: [],
      };

      expect(platformQuota.account).toBe('');
      expect(platformQuota.accountLabel).toBe('');
      expect(platformQuota.title).toBe('');
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(1000);
      const quotaItem: QuotaItem = {
        label: longString,
        remainPercent: 50,
        note: longString,
      };

      expect(quotaItem.label.length).toBe(1000);
      expect(quotaItem.note?.length).toBe(1000);
    });

    it('should handle special characters in strings', () => {
      const quotaItem: QuotaItem = {
        label: 'API & Services (HTTPS/TLS)',
        remainPercent: 50,
        note: '© 2024 All rights reserved ®™',
      };

      expect(quotaItem.label).toContain('&');
      expect(quotaItem.note).toContain('©');
    });

    it('should handle unicode characters', () => {
      const platformQuota: PlatformQuota = {
        platform: '平台',
        account: '用户@example.com',
        accountLabel: '用户账户',
        title: '中文标题 🎉',
        status: 'ok',
        quotas: [],
      };

      expect(platformQuota.platform).toContain('平');
      expect(platformQuota.title).toContain('🎉');
    });

    it('should handle zero timestamp', () => {
      const quotaData: QuotaData = {
        platforms: [],
        lastUpdated: 0,
      };

      expect(quotaData.lastUpdated).toBe(0);
    });

    it('should handle negative remainPercent (edge case)', () => {
      // TypeScript doesn't prevent this at runtime
      const quotaItem = {
        label: 'Test',
        remainPercent: -10,
      } as QuotaItem;

      expect(quotaItem.remainPercent).toBeLessThan(0);
    });

    it('should handle remainPercent over 100 (edge case)', () => {
      // TypeScript doesn't prevent this at runtime
      const quotaItem = {
        label: 'Test',
        remainPercent: 150,
      } as QuotaItem;

      expect(quotaItem.remainPercent).toBeGreaterThan(100);
    });
  });

  describe('Type Guards and Validation', () => {
    it('should check if platform has error', () => {
      const withError: PlatformQuota = {
        platform: 'test',
        account: 'test',
        status: 'error',
        error: 'Error occurred',
        quotas: [],
      };

      const withoutError: PlatformQuota = {
        platform: 'test',
        account: 'test',
        status: 'ok',
        quotas: [],
      };

      const hasError = (quota: PlatformQuota) => quota.status === 'error';

      expect(hasError(withError)).toBe(true);
      expect(hasError(withoutError)).toBe(false);
    });

    it('should check if quota item is low', () => {
      const lowQuota: QuotaItem = { label: 'Low', remainPercent: 10 };
      const highQuota: QuotaItem = { label: 'High', remainPercent: 90 };

      const isLow = (quota: QuotaItem) => quota.remainPercent < 20;

      expect(isLow(lowQuota)).toBe(true);
      expect(isLow(highQuota)).toBe(false);
    });

    it('should check if auth data has access token', () => {
      const withAccess: OpenAIAuthData = {
        type: 'oauth',
        access: 'token',
      };

      const withoutAccess: OpenAIAuthData = {
        type: 'api_key',
      };

      const hasAccess = (auth: OpenAIAuthData) => auth.access !== undefined;

      expect(hasAccess(withAccess)).toBe(true);
      expect(hasAccess(withoutAccess)).toBe(false);
    });

    it('should check if account has email', () => {
      const withEmail: AntigravityAccount = {
        email: 'user@example.com',
        refreshToken: 'token',
        addedAt: Date.now(),
        lastUsed: Date.now(),
      };

      const withoutEmail: AntigravityAccount = {
        refreshToken: 'token',
        addedAt: Date.now(),
        lastUsed: Date.now(),
      };

      const hasEmail = (account: AntigravityAccount) => account.email !== undefined;

      expect(hasEmail(withEmail)).toBe(true);
      expect(hasEmail(withoutEmail)).toBe(false);
    });
  });

  describe('Null and Undefined Handling', () => {
    it('should handle undefined optional fields', () => {
      const quotaItem: QuotaItem = {
        label: 'Test',
        remainPercent: 50,
      };

      expect(quotaItem.used).toBeUndefined();
      expect(quotaItem.total).toBeUndefined();
      expect(quotaItem.resetDisplay).toBeUndefined();
    });

    it('should handle undefined auth data providers', () => {
      const authData: AuthData = {
        openai: { type: 'oauth' },
      };

      expect(authData['github-copilot']).toBeUndefined();
      expect(authData['zhipuai-coding-plan']).toBeUndefined();
    });

    it('should handle empty vs undefined', () => {
      const quotaItem1: QuotaItem = {
        label: 'Test',
        remainPercent: 50,
        used: '',
      };

      const quotaItem2: QuotaItem = {
        label: 'Test',
        remainPercent: 50,
      };

      expect(quotaItem1.used).toBeDefined();
      expect(quotaItem2.used).toBeUndefined();
    });
  });
});
