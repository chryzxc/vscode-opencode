export interface QuotaItem {
  label: string;
  remainPercent: number;
  used?: string;
  total?: string;
  resetDisplay?: string;
  usedTotalDisplay?: string;
  percentLabel?: string;
  resetLabel?: string;
  resetAt?: string;
  note?: string;
}

export interface PlatformQuota {
  platform: string;
  account: string;
  accountLabel?: string;
  title?: string;
  status: "ok" | "warning" | "error";
  error?: string;
  quotas: QuotaItem[];
}

export interface QuotaData {
  platforms: PlatformQuota[];
  lastUpdated: number;
}

export interface OpenAIAuthData {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
}

export interface ZhipuAuthData {
  type: string;
  key?: string;
}

export interface CopilotAuthData {
  type: string;
  refresh?: string;
  access?: string;
  expires?: number;
}

export interface AuthData {
  openai?: OpenAIAuthData;
  "zhipuai-coding-plan"?: ZhipuAuthData;
  "zai-coding-plan"?: ZhipuAuthData;
  "github-copilot"?: CopilotAuthData;
}

export interface AntigravityAccount {
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
}

export interface AntigravityAccountsFile {
  version: number;
  accounts: AntigravityAccount[];
}

export type CopilotTier = "free" | "pro" | "pro+" | "business" | "enterprise";

export interface CopilotQuotaConfig {
  token: string;
  username: string;
  tier: CopilotTier;
}
