import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import { GeminiTokenUsageTracker } from "./GeminiTokenUsageTracker";
import { createLogger } from "../utils/Logger";
import { LoggingCategories } from "../utils/LoggingSchema";
import type {
  QuotaData,
  QuotaItem,
  PlatformQuota,
  AuthData,
  OpenAIAuthData,
  ZhipuAuthData,
  CopilotAuthData,
  CopilotQuotaConfig,
  AntigravityAccountsFile,
  CopilotTier,
} from "../types/QuotaTypes";

// â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DEFAULT_REFRESH_INTERVAL = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "vscode-opencode-quota-monitor/1.0";
const COPILOT_VERSION = "0.35.0";
const COPILOT_EDITOR_VERSION = "vscode/1.107.0";
const COPILOT_EDITOR_PLUGIN_VERSION = `copilot-chat/${COPILOT_VERSION}`;
const COPILOT_USER_AGENT = `GitHubCopilotChat/${COPILOT_VERSION}`;

const OPENAI_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ZHIPU_USAGE_URL = "https://bigmodel.cn/api/monitor/usage/quota/limit";
const ZAI_USAGE_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const GITHUB_API_BASE_URL = "https://api.github.com";
const GOOGLE_QUOTA_API_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
const GOOGLE_TOKEN_REFRESH_URL = "https://oauth2.googleapis.com/token";

const GOOGLE_CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";

const GOOGLE_MODELS = [
  { key: "gemini-3-pro-high", altKey: "gemini-3-pro-low", display: "G3 Pro" },
  { key: "gemini-3-pro-image", display: "G3 Image" },
  { key: "gemini-3-flash", display: "G3 Flash" },
  {
    key: "claude-opus-4-5-thinking",
    altKey: "claude-opus-4-5",
    display: "Claude",
  },
] as const;

const COPILOT_PLAN_LIMITS: Record<string, number> = {
  free: 50,
  pro: 300,
  "pro+": 1500,
  business: 300,
  enterprise: 1000,
};

// â”€â”€ File paths â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const authPath = path.join(
  os.homedir(),
  ".local",
  "share",
  "opencode",
  "auth.json",
);
const antigravityPath = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "antigravity-accounts.json",
);
const copilotConfigPath = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "copilot-quota-token.json",
);

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function readJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return safeJsonParse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Safely parse JSON, handling common issues like BOMs and trailing content
 */
function safeJsonParse(raw: string): any {
  // Remove BOM if present
  let cleaned = raw.replace(/^﻿/, '');

  // Try parsing as-is first
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // If that fails, try to extract JSON from the response
    // Look for object start and end
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    const startIndex = firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)
      ? firstBrace
      : firstBracket;

    if (startIndex >= 0) {
      // Find matching end bracket
      let depth = 0;
      let inString = false;
      let escape = false;
      const startChar = cleaned[startIndex];
      const endChar = startChar === '{' ? '}' : ']';

      for (let i = startIndex; i < cleaned.length; i++) {
        const char = cleaned[i];

        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\\') {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;

        if (char === startChar) {
          depth++;
        } else if (char === endChar) {
          depth--;
          if (depth === 0) {
            const extracted = cleaned.substring(startIndex, i + 1);
            return JSON.parse(extracted);
          }
        }
      }
    }
    throw e;
  }
}

function writeJsonFile<T>(filePath: string, data: T): boolean {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

interface HttpResponse {
  body: string;
  statusCode: number;
}

function httpsGet(
  url: string,
  headers: Record<string, string>,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers,
      timeout: REQUEST_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ body: data, statusCode: res.statusCode || 200 }));
    });

    req.on("timeout", () => {
      req.destroy(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

function httpsPost(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: REQUEST_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ body: data, statusCode: res.statusCode || 200 }));
    });

    req.on("timeout", () => {
      req.destroy(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safeSeconds / 86_400);
  const hours = Math.floor((safeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatResetFromTimestampMs(resetAtMs?: number): string | undefined {
  if (!resetAtMs || Number.isNaN(resetAtMs)) {
    return undefined;
  }
  const diffSec = Math.floor((resetAtMs - Date.now()) / 1000);
  if (diffSec <= 0) {
    return "soon";
  }
  const dateStr = new Date(resetAtMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatDuration(diffSec)} (${dateStr})`;
}

function maskAccount(value: string, start = 4, end = 4): string {
  if (!value) {
    return "unknown";
  }
  if (value.length <= start + end) {
    return value;
  }
  return `${value.slice(0, start)}****${value.slice(-end)}`;
}

function normalizePlatformId(platformName: string): string {
  return platformName.toLowerCase().replace(/\s+/g, "-").replace(/\.+/g, "");
}

function percentBar(pct: number): number {
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// â”€â”€ QuotaService â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class QuotaService extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private isDisposed = false;
  private _cachedData: QuotaData | null = null;
  private logger = createLogger(LoggingCategories.EXTENSION);

  constructor() {
    super();
    this.startAutoRefresh();
  }

  public get cachedData(): QuotaData | null {
    return this._cachedData;
  }

  public startAutoRefresh(intervalMs = DEFAULT_REFRESH_INTERVAL): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    // Initial fetch
    this.refreshQuota().catch(() => { });
    this.timer = setInterval(() => {
      if (!this.isDisposed) {
        this.refreshQuota().catch(() => { });
      }
    }, intervalMs);
  }

  public async refreshQuota(): Promise<QuotaData> {
    const auth = readJsonFile<AuthData>(authPath);
    const platforms: PlatformQuota[] = [];

    const tasks: Promise<void>[] = [];

    // OpenAI
    if (auth?.openai?.access) {
      tasks.push(
        this.fetchOpenAI(auth.openai)
          .then((p) => {
            if (p) platforms.push(p);
          })
          .catch(() => { }),
      );
    }

    // Zhipu
    if (auth?.["zhipuai-coding-plan"]?.key) {
      tasks.push(
        this.fetchZhipu(
          auth["zhipuai-coding-plan"],
          "Zhipu AI",
          ZHIPU_USAGE_URL,
        )
          .then((p) => {
            if (p) platforms.push(p);
          })
          .catch(() => { }),
      );
    }

    // ZAI
    if (auth?.["zai-coding-plan"]?.key) {
      tasks.push(
        this.fetchZhipu(auth["zai-coding-plan"], "Z.ai Coding Plan", ZAI_USAGE_URL)
          .then((p) => {
            if (p) platforms.push(p);
          })
          .catch(() => { }),
      );
    }

    // GitHub Copilot
    const copilotConfig = readJsonFile<CopilotQuotaConfig>(copilotConfigPath);
    if (auth?.["github-copilot"]?.access || auth?.["github-copilot"]?.refresh) {
      tasks.push(
        this.fetchCopilot(
          auth["github-copilot"],
          copilotConfig as CopilotQuotaConfig,
        )
          .then((p) => {
            if (p) platforms.push(p);
          })
          .catch(() => { }),
      );
    }

    // Google / Antigravity
    const antigravityFile =
      readJsonFile<AntigravityAccountsFile>(antigravityPath);
    if (antigravityFile?.accounts?.length) {
      for (const account of antigravityFile.accounts) {
        tasks.push(
          this.fetchGoogle(account)
            .then((ps) => {
              if (ps) platforms.push(...ps);
            })
            .catch(() => { }),
        );
      }
    }

    await Promise.allSettled(tasks);

    // If no auth file, surface an OpenCode card in error state so UI still shows a provider
    const hasRecognizedProviders = Boolean(
      auth?.openai ||
      auth?.["zhipuai-coding-plan"] ||
      auth?.["zai-coding-plan"] ||
      auth?.["github-copilot"] ||
      (antigravityFile &&
        antigravityFile.accounts &&
        antigravityFile.accounts.length > 0),
    );

    if (!auth) {
      platforms.push({
        platform: "opencode",
        account: "OpenCode",
        title: "OpenCode AI",
        status: "error",
        error: "No auth.json found",
        quotas: [],
      });
    } else if (!hasRecognizedProviders) {
      platforms.push({
        platform: "opencode",
        account: "OpenCode",
        title: "OpenCode AI",
        status: "ok",
        quotas: [{ label: "Connected", remainPercent: 100 }],
      });
    }

    const data: QuotaData = {
      platforms,
      lastUpdated: Date.now(),
    };

    this._cachedData = data;
    this.emit("quotaUpdate", data);
    return data;
  }

  // â”€â”€ Platform fetchers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async fetchOpenAI(auth: OpenAIAuthData): Promise<PlatformQuota | null> {
    if (!auth?.access) {
      return null;
    }

    // Check if token is expired and refresh if needed
    let token = auth.access;
    const expired = auth?.expires
      ? auth.expires < Date.now() - 60000  // 60s buffer
      : true;

    if (expired && auth?.refresh) {
      try {
        const refreshResponse = await httpsPost(
          OPENAI_OAUTH_TOKEN_URL,
          {
            "Content-Type": "application/json",
          },
          JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: auth.refresh,
            client_id: OPENAI_CLIENT_ID,
          }),
        );
        const refreshed = safeJsonParse(refreshResponse.body);
        if (refreshed.access_token) {
          token = refreshed.access_token;

          // Update auth.json with new tokens
          const authData = readJsonFile<AuthData>(authPath);
          if (authData?.openai) {
            authData.openai.access = refreshed.access_token;
            if (refreshed.refresh_token) {
              authData.openai.refresh = refreshed.refresh_token;
            }
            if (refreshed.expires_in) {
              authData.openai.expires = Date.now() + (refreshed.expires_in * 1000);
            }
            writeJsonFile(authPath, authData);
          }
        }
      } catch (refreshError) {
        // If refresh fails, continue with expired token (will fail with 401)
        this.logger.error('OpenAI token refresh failed', {}, refreshError as Error);
      }
    }

    try {
      const response = await httpsGet(OPENAI_USAGE_URL, {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      });

      // Handle 401 Unauthorized errors specifically
      if (response.statusCode === 401) {
        const errorMsg = auth?.refresh
          ? "Token refresh failed. Please re-authenticate."
          : "Access token expired and no refresh token available. Please re-authenticate with OpenAI.";
        this.logger.error('OpenAI API returned 401 Unauthorized', { hasRefreshToken: Boolean(auth?.refresh) }, new Error(errorMsg));
        return {
          platform: "openai",
          account: "ChatGPT",
          title: "OpenAI Account Quota",
          status: "error",
          error: errorMsg,
          quotas: [
            {
              label: "Authentication Error",
              remainPercent: 0,
              percentLabel: "—",
              note: auth?.refresh ? "Token refresh failed" : "No refresh token - re-authenticate required",
            },
          ],
        };
      }

      // Handle other non-200 status codes
      if (response.statusCode !== 200) {
        throw new Error(`HTTP ${response.statusCode}: ${response.body.substring(0, 200)}`);
      }

      const json = safeJsonParse(response.body);

      const quotas: QuotaItem[] = [];

      const weeklyWindow =
        json?.rate_limit?.weekly_window ?? json?.rate_limit?.secondary_window;
      if (weeklyWindow && typeof weeklyWindow === "object") {
        const usedPercent = Number(weeklyWindow.used_percent ?? 0);
        const remain = percentBar(100 - usedPercent);
        const remainRaw = 100 - usedPercent;
        const resetAfterSeconds = Number(weeklyWindow.reset_after_seconds ?? 0);

        quotas.push({
          label: `Weekly limit`,
          remainPercent: remain,
          percentLabel: `${remainRaw.toFixed(1)}% remaining`,
          resetLabel:
            resetAfterSeconds > 0
              ? formatResetFromTimestampMs(
                Date.now() + resetAfterSeconds * 1000,
              )
              : undefined,
        });
      }

      const primaryWindow = json?.rate_limit?.primary_window;
      if (primaryWindow && typeof primaryWindow === "object") {
        const usedPercent = Number(primaryWindow.used_percent ?? 0);
        const remain = percentBar(100 - usedPercent);
        const windowSeconds = Number(primaryWindow.limit_window_seconds ?? 0);
        const windowHours = Math.max(1, Math.round(windowSeconds / 3600));
        const resetAfterSeconds = Number(
          primaryWindow.reset_after_seconds ?? 0,
        );

        quotas.push({
          label: `${windowHours}-hour limit`,
          remainPercent: remain,
          percentLabel: `${remain}% remaining`,
          resetLabel:
            resetAfterSeconds > 0
              ? formatResetFromTimestampMs(
                Date.now() + resetAfterSeconds * 1000,
              )
              : undefined,
        });
      }

      const additionalDetails = json?.rate_limit?.additional_details;
      if (additionalDetails && typeof additionalDetails === "object") {
        for (const [key, value] of Object.entries(additionalDetails)) {
          quotas.push({
            label: key,
            remainPercent: 100,
            percentLabel: String(value),
            note: "Additional Detail",
          });
        }
      }

      const allotments: any[] = json?.allotments ?? [];
      for (const allotment of allotments) {
        const label =
          allotment.model_group_display ?? allotment.model_group ?? "Model";
        const used = Number(allotment.usage ?? 0);
        const total = Number(allotment.limit ?? 0);
        if (total <= 0) {
          continue;
        }
        const remain = percentBar(((total - used) / total) * 100);
        const resetAt =
          typeof allotment.reset_at === "number"
            ? formatResetFromTimestampMs(allotment.reset_at * 1000)
            : undefined;
        quotas.push({
          label,
          remainPercent: remain,
          usedTotalDisplay: `${formatNumber(used)} / ${formatNumber(total)}`,
          percentLabel: `${remain}% remaining`,
          resetLabel: resetAt,
        });
      }

      if (quotas.length === 0) {
        quotas.push({ label: "No quota data", remainPercent: 0 });
      }

      const planType =
        typeof json?.plan_type === "string" ? json.plan_type : "unknown";

      return {
        platform: "openai",
        account: "ChatGPT",
        accountLabel: `(${planType})`,
        title: "OpenAI Account Quota",
        status: "ok",
        quotas,
      };
    } catch (e) {
      const errorMessage = String(e);
      this.logger.error('OpenAI quota fetch failed', { error: errorMessage }, e as Error);
      return {
        platform: "openai",
        account: "ChatGPT",
        title: "OpenAI Account Quota",
        status: "error",
        error: errorMessage,
        quotas: [
          {
            label: "Error",
            remainPercent: 0,
            percentLabel: "—",
            note: errorMessage.includes("401") || errorMessage.includes("authenticate")
              ? "Authentication failed. Check auth.json credentials."
              : "Check auth.json token or rate limits.",
          },
        ],
      };
    }
  }

  private async fetchZhipu(auth: ZhipuAuthData, platformName: string, url: string): Promise<PlatformQuota | null> {
    if (!auth?.key) {
      return null;
    }
    try {
      const response = await httpsGet(url, {
        Authorization: `Bearer ${auth.key}`,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      });
      const json = safeJsonParse(response.body);
      const quotas: QuotaItem[] = [];

      const limits: any[] = Array.isArray(json?.data?.limits)
        ? json.data.limits
        : Array.isArray(json?.limits)
          ? json.limits
          : [];

      const isZai = platformName.toLowerCase().includes("z.ai");

      for (const limit of limits) {
        const type =
          typeof limit?.type === "string" ? limit.type : "TOKENS_LIMIT";
        const total = Number(limit?.usage ?? 0);
        const used = Number(limit?.currentValue ?? 0);
        const usedPercent = Number(limit?.percentage ?? 0);
        const remainPercent = percentBar(100 - usedPercent);
        const resetLabel = formatResetFromTimestampMs(
          typeof limit?.nextResetTime === "number"
            ? limit.nextResetTime
            : undefined,
        );
        const isTokenLimit = type === "TOKENS_LIMIT";

        // Z.ai exposes a 5-hour token bucket plus a separate monthly web search limit.
        const label = isTokenLimit
          ? "5 hrs token limit"
          : isZai
            ? "Monthly web search limit"
            : "Monthly limit";

        quotas.push({
          label,
          remainPercent,
          usedTotalDisplay:
            total > 0
              ? `${formatNumber(used)} / ${formatNumber(total)}`
              : undefined,
          percentLabel: `${remainPercent}% remaining`,
          resetLabel,
        });
      }

      if (quotas.length === 0) {
        quotas.push({ label: "No quota data", remainPercent: 0 });
      }

      const account = auth.key ? maskAccount(auth.key) : platformName;
      const accountLabel = isZai ? "(Z.ai)" : "(Coding Plan)";

      return {
        platform: normalizePlatformId(platformName),
        account,
        accountLabel,
        title: `${platformName} Account Quota`,
        status: "ok",
        quotas,
      };
    } catch (e) {
      return {
        platform: normalizePlatformId(platformName),
        account: platformName,
        title: `${platformName} Account Quota`,
        status: "error",
        error: String(e),
        quotas: [],
      };
    }
  }

  private async fetchCopilot(auth: CopilotAuthData | undefined, config: CopilotQuotaConfig | undefined): Promise<PlatformQuota | null> {
    // Refresh token if expired
    let token = auth?.access;
    const expired = auth?.expires
      ? auth.expires < Date.now() / 1000 - 60
      : true;

    if (expired && auth?.refresh) {
      try {
        const refreshResponse = await httpsPost(
          "https://github.com/login/oauth/access_token",
          {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": COPILOT_USER_AGENT,
          },
          JSON.stringify({
            client_id: "Iv1.b507a08c87ecfe98",
            device_code: auth.refresh,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        );
        const refreshed = safeJsonParse(refreshResponse.body);
        if (refreshed.access_token) {
          token = refreshed.access_token;
        }
      } catch {
        // use existing token if refresh fails
      }
    }

    if (!token) {
      return {
        platform: "github-copilot",
        account: config?.username ?? "GitHub Copilot",
        title: "GitHub Copilot Account Quota",
        status: "error",
        error: "No access token available",
        quotas: [],
      };
    }

    try {
      // Get Copilot API token
      const copilotTokenResponse = await httpsGet(
        `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
        {
          Authorization: `Bearer ${token}`,
          "User-Agent": COPILOT_USER_AGENT,
          "Editor-Version": COPILOT_EDITOR_VERSION,
          "Editor-Plugin-Version": COPILOT_EDITOR_PLUGIN_VERSION,
          "Copilot-Language-Server-Version": COPILOT_VERSION,
        },
      );
      const copilotToken = safeJsonParse(copilotTokenResponse.body);
      const apiToken: string = copilotToken.token ?? token;

      const userResponse = await httpsGet(
        `${GITHUB_API_BASE_URL}/copilot_internal/user`,
        {
          Authorization: `Bearer ${apiToken}`,
          "User-Agent": COPILOT_USER_AGENT,
          "Editor-Version": COPILOT_EDITOR_VERSION,
          "Editor-Plugin-Version": COPILOT_EDITOR_PLUGIN_VERSION,
        },
      );
      const userJson = safeJsonParse(userResponse.body);

      const premiumSnapshot = userJson?.quota_snapshots?.premium_interactions;

      const snapshotEntitlement = Number(premiumSnapshot?.entitlement ?? 0);
      const snapshotRemain = Number(premiumSnapshot?.remaining ?? 0);
      const snapshotPct = Number(premiumSnapshot?.percent_remaining ?? 0);

      // Priority: use API provided entitlement as limit, fallback to hardcoded if not found
      const tier: CopilotTier = config?.tier ?? "free";
      const limitFallback = COPILOT_PLAN_LIMITS[tier] ?? 50;
      const effectiveLimit =
        snapshotEntitlement > 0 ? snapshotEntitlement : limitFallback;

      let used = snapshotEntitlement - snapshotRemain;
      let remaining = snapshotRemain;
      let rawRemainPct =
        Number.isFinite(snapshotPct) && snapshotPct > 0
          ? snapshotPct
          : effectiveLimit > 0
            ? (remaining / effectiveLimit) * 100
            : 0;

      if (!premiumSnapshot) {
        const usageResponse = await httpsGet(`https://api.githubcopilot.com/usage`, {
          Authorization: `Bearer ${apiToken}`,
          "User-Agent": COPILOT_USER_AGENT,
          "Editor-Version": COPILOT_EDITOR_VERSION,
          "Editor-Plugin-Version": COPILOT_EDITOR_PLUGIN_VERSION,
        });
        const usageJson = safeJsonParse(usageResponse.body);
        used = Number(usageJson?.premium_requests_used ?? 0);
        remaining = Math.max(0, effectiveLimit - used);
        rawRemainPct =
          effectiveLimit > 0 ? (remaining / effectiveLimit) * 100 : 0;
      }

      const remainPct = percentBar(rawRemainPct);
      const quotaResetDate =
        typeof userJson?.quota_reset_date === "string"
          ? userJson.quota_reset_date
          : undefined;
      const planType =
        typeof userJson?.copilot_plan === "string"
          ? userJson.copilot_plan
          : "individual";

      return {
        platform: "github-copilot",
        account: "GitHub Copilot",
        accountLabel: `(${planType})`,
        title: "GitHub Copilot Account Quota",
        status: remainPct < 10 ? "warning" : "ok",
        quotas: [
          {
            label: "Premium",
            remainPercent: remainPct,
            usedTotalDisplay: `${used} / ${effectiveLimit}`,
            percentLabel: `${rawRemainPct.toFixed(1)}%`,
            resetLabel: quotaResetDate
              ? formatResetFromTimestampMs(new Date(quotaResetDate).getTime())
              : undefined,
          },
        ],
      };
    } catch (e) {
      const errorMessage = String(e);
      // Include more context for JSON parsing errors
      const enhancedError = errorMessage.includes('JSON')
        ? `${errorMessage}. Check if Copilot API response format has changed.`
        : errorMessage;

      return {
        platform: "github-copilot",
        account: config?.username ?? "GitHub Copilot",
        title: "GitHub Copilot Account Quota",
        status: "error",
        error: enhancedError,
        quotas: [],
      };
    }
  }

  private async fetchGoogle(account: { email?: string; refreshToken: string }): Promise<PlatformQuota[]> {
    // Refresh access token
    let accessToken: string;
    try {
      const refreshResponse = await httpsPost(
        GOOGLE_TOKEN_REFRESH_URL,
        { "Content-Type": "application/x-www-form-urlencoded" },
        new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: account.refreshToken,
          grant_type: "refresh_token",
        }).toString(),
      );
      const refreshed = JSON.parse(refreshResponse.body);
      if (!refreshed.access_token) {
        throw new Error("No access token in refresh response");
      }
      accessToken = refreshed.access_token;
    } catch (e) {
      return [
        {
          platform: "google",
          account: account.email ?? "Google Account",
          title: "Google / Gemini",
          status: "error",
          error: `Token refresh failed: ${String(e)}`,
          quotas: [],
        },
      ];
    }

    try {
      const response = await httpsPost(
        GOOGLE_QUOTA_API_URL,
        {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        JSON.stringify({}),
      );
      const json = safeJsonParse(response.body);
      const modelsInfo: any[] = json?.models ?? [];

      const quotas: QuotaItem[] = [];

      for (const gm of GOOGLE_MODELS) {
        const modelData =
          modelsInfo.find((m: any) => m.id === gm.key) ??
          modelsInfo.find((m: any) => "altKey" in gm && m.id === gm.altKey);

        if (!modelData) continue;

        const quota = modelData.quota;
        if (!quota) continue;

        const used: number = quota.dailyUsage ?? 0;
        const total: number = quota.dailyLimit ?? quota.limit ?? 0;
        const remaining = Math.max(0, total - used);
        const remainPct = total > 0 ? (remaining / total) * 100 : 0;

        quotas.push({
          label: gm.display,
          remainPercent: percentBar(remainPct),
          usedTotalDisplay: `${used} / ${total}`,
          percentLabel: `${percentBar(remainPct)}% remaining`,
          resetLabel: "Resets daily",
        });
      }

      if (quotas.length === 0) {
        quotas.push({ label: "No quota data", remainPercent: 0 });
      }

      // Add tracked token usage for Gemini models only
      const tracker = GeminiTokenUsageTracker.getInstance();
      const allTrackedUsage = tracker.getAllUsage();

      // Filter to only Google/Gemini models
      const geminiModels = allTrackedUsage.filter(
        (usage) =>
          usage.model.startsWith("gemini-") || usage.model.includes("claude-"), // Google also hosts Claude
      );

      if (geminiModels.length > 0) {
        const totalTracked = geminiModels.reduce(
          (sum, usage) => sum + usage.grandTotal,
          0,
        );
        const dailyLimit = 1_000_000; // 1M tokens per day for free tier
        const trackedPercent = Math.min(100, (totalTracked / dailyLimit) * 100);

        // Add separator
        quotas.push({
          label: "â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€",
          remainPercent: 0,
        });

        // Add tracked usage summary
        quotas.push({
          label: "Tracked Today (usageMetadata)",
          remainPercent: percentBar(100 - trackedPercent),
          usedTotalDisplay: `${totalTracked.toLocaleString()} / ${dailyLimit.toLocaleString()}`,
          percentLabel: `${trackedPercent.toFixed(1)}% used`,
          resetLabel: "Resets at midnight UTC",
        });

        // Add per-model tracked usage
        for (const usage of geminiModels) {
          const modelPercent = (usage.grandTotal / dailyLimit) * 100;
          quotas.push({
            label: `  ${usage.model}`,
            remainPercent: percentBar(100 - modelPercent),
            usedTotalDisplay: `${usage.grandTotal.toLocaleString()} tokens`,
            percentLabel: `${usage.requestCount} requests`,
          });
        }
      }

      return [
        {
          platform: "google",
          account: account.email ?? "Google Account",
          accountLabel: account.email,
          title: "Google / Gemini",
          status: "ok",
          quotas,
        },
      ];
    } catch (e) {
      return [
        {
          platform: "google",
          account: account.email ?? "Google Account",
          title: "Google / Gemini",
          status: "error",
          error: String(e),
          quotas: [],
        },
      ];
    }
  }

  // â”€â”€ Dispose â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  public dispose(): void {
    this.isDisposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.removeAllListeners();
  }
}
