import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import { GeminiTokenUsageTracker } from "./GeminiTokenUsageTracker";
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

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_REFRESH_INTERVAL = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "vscode-opencode-quota-monitor/1.0";
const COPILOT_VERSION = "0.35.0";
const COPILOT_EDITOR_VERSION = "vscode/1.107.0";
const COPILOT_EDITOR_PLUGIN_VERSION = `copilot-chat/${COPILOT_VERSION}`;
const COPILOT_USER_AGENT = `GitHubCopilotChat/${COPILOT_VERSION}`;

const OPENAI_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const ZHIPU_USAGE_URL = "https://bigmodel.cn/api/monitor/usage/quota/limit";
const ZAI_USAGE_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const GITHUB_API_BASE_URL = "https://api.github.com";
const GOOGLE_QUOTA_API_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
const GEMINI_CLI_QUOTA_API_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const GOOGLE_TOKEN_REFRESH_URL = "https://oauth2.googleapis.com/token";

const GOOGLE_CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";

const GEMINI_CLI_OAUTH_CLIENT_ID =
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const GEMINI_CLI_OAUTH_CLIENT_SECRET = "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";

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

// ── File paths ─────────────────────────────────────────────────────────────────

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
const geminiOAuthPath = path.join(os.homedir(), ".gemini", "oauth_creds.json");
const geminiProjectsPath = path.join(os.homedir(), ".gemini", "projects.json");
const geminiAccountsPath = path.join(
  os.homedir(),
  ".gemini",
  "google_accounts.json",
);

interface GeminiCliOAuthCredentials {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

interface GeminiCliProjectsFile {
  projects?: Record<string, string>;
}

interface GeminiCliAccountsFile {
  active?: string;
  old?: string[];
}

interface GeminiQuotaBucket {
  modelId?: string;
  tokenType?: string;
  remainingAmount?: string;
  remainingFraction?: number;
  resetTime?: string;
}

interface GeminiQuotaResponse {
  buckets?: GeminiQuotaBucket[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function readJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function httpsGet(
  url: string,
  headers: Record<string, string>,
): Promise<string> {
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
      res.on("end", () => resolve(data));
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
): Promise<string> {
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
      res.on("end", () => resolve(data));
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

function normalizePathForLookup(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

// ── QuotaService ───────────────────────────────────────────────────────────────

export class QuotaService extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private isDisposed = false;
  private _cachedData: QuotaData | null = null;

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
    this.refreshQuota().catch(() => {});
    this.timer = setInterval(() => {
      if (!this.isDisposed) {
        this.refreshQuota().catch(() => {});
      }
    }, intervalMs);
  }

  public async refreshQuota(): Promise<QuotaData> {
    const auth = readJsonFile<AuthData>(authPath);
    const geminiOauth =
      readJsonFile<GeminiCliOAuthCredentials>(geminiOAuthPath);
    const geminiProjects =
      readJsonFile<GeminiCliProjectsFile>(geminiProjectsPath);
    const geminiAccounts =
      readJsonFile<GeminiCliAccountsFile>(geminiAccountsPath);
    const platforms: PlatformQuota[] = [];

    const tasks: Promise<void>[] = [];

    // OpenAI
    if (auth?.openai?.access) {
      tasks.push(
        this.fetchOpenAI(auth.openai)
          .then((p) => {
            if (p) platforms.push(p);
          })
          .catch(() => {}),
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
          .catch(() => {}),
      );
    }

    // ZAI
    if (auth?.["zai-coding-plan"]?.key) {
      tasks.push(
        this.fetchZhipu(auth["zai-coding-plan"], "Z.AI", ZAI_USAGE_URL)
          .then((p) => {
            if (p) platforms.push(p);
          })
          .catch(() => {}),
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
          .catch(() => {}),
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
            .catch(() => {}),
        );
      }
    }

    if (geminiOauth?.access_token || geminiOauth?.refresh_token) {
      tasks.push(
        this.fetchGeminiCliQuota(
          geminiOauth,
          geminiProjects ?? undefined,
          geminiAccounts ?? undefined,
        )
          .then((p) => {
            if (p) platforms.push(p);
          })
          .catch(() => {}),
      );
    }

    await Promise.allSettled(tasks);

    // If no auth file, surface an OpenCode card in error state so UI still shows a provider
    const hasRecognizedProviders = Boolean(
      auth?.openai ||
      auth?.["zhipuai-coding-plan"] ||
      auth?.["zai-coding-plan"] ||
      auth?.["github-copilot"] ||
      geminiOauth?.access_token ||
      geminiOauth?.refresh_token ||
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

  // ── Platform fetchers ────────────────────────────────────────────────────────

  private async fetchOpenAI(
    auth: OpenAIAuthData,
  ): Promise<PlatformQuota | null> {
    if (!auth?.access) {
      return null;
    }
    try {
      const raw = await httpsGet(OPENAI_USAGE_URL, {
        Authorization: `Bearer ${auth.access}`,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      });
      const json = JSON.parse(raw);

      const quotas: QuotaItem[] = [];

      const weeklyWindow =
        json?.rate_limit?.weekly_window ?? json?.rate_limit?.secondary_window;
      if (weeklyWindow && typeof weeklyWindow === "object") {
        const usedPercent = Number(weeklyWindow.used_percent ?? 0);
        const remainRaw = 100 - usedPercent;
        const remain = percentBar(remainRaw);
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
      return {
        platform: "openai",
        account: "ChatGPT",
        title: "OpenAI Account Quota",
        status: "error",
        error: String(e),
        quotas: [
          {
            label: "Error",
            remainPercent: 0,
            percentLabel: "—",
            note: "Check auth.json token or rate limits.",
          },
        ],
      };
    }
  }

  private async fetchZhipu(
    auth: ZhipuAuthData,
    platformName: string,
    url: string,
  ): Promise<PlatformQuota | null> {
    if (!auth?.key) {
      return null;
    }
    try {
      const raw = await httpsGet(url, {
        Authorization: `Bearer ${auth.key}`,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      });
      const json = JSON.parse(raw);
      const quotas: QuotaItem[] = [];

      const limits: any[] = Array.isArray(json?.data?.limits)
        ? json.data.limits
        : Array.isArray(json?.limits)
          ? json.limits
          : [];

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

        // Token limits are 5-hour limits, other limits are monthly limits
        const label = isTokenLimit ? "5 hrs token limit" : "Monthly limit";

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

      const isZai = platformName.toLowerCase().includes("z.ai");
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

  private async fetchCopilot(
    auth: CopilotAuthData | undefined,
    config: CopilotQuotaConfig | undefined,
  ): Promise<PlatformQuota | null> {
    // Refresh token if expired
    let token = auth?.access;
    const expired = auth?.expires
      ? auth.expires < Date.now() / 1000 - 60
      : true;

    if (expired && auth?.refresh) {
      try {
        const refreshRaw = await httpsPost(
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
        const refreshed = JSON.parse(refreshRaw);
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
      const copilotTokenRaw = await httpsGet(
        `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
        {
          Authorization: `Bearer ${token}`,
          "User-Agent": COPILOT_USER_AGENT,
          "Editor-Version": COPILOT_EDITOR_VERSION,
          "Editor-Plugin-Version": COPILOT_EDITOR_PLUGIN_VERSION,
          "Copilot-Language-Server-Version": COPILOT_VERSION,
        },
      );
      const copilotToken = JSON.parse(copilotTokenRaw);
      const apiToken: string = copilotToken.token ?? token;

      const userRaw = await httpsGet(
        `${GITHUB_API_BASE_URL}/copilot_internal/user`,
        {
          Authorization: `Bearer ${apiToken}`,
          "User-Agent": COPILOT_USER_AGENT,
          "Editor-Version": COPILOT_EDITOR_VERSION,
          "Editor-Plugin-Version": COPILOT_EDITOR_PLUGIN_VERSION,
        },
      );
      const userJson = JSON.parse(userRaw);

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
        const usageRaw = await httpsGet(`https://api.githubcopilot.com/usage`, {
          Authorization: `Bearer ${apiToken}`,
          "User-Agent": COPILOT_USER_AGENT,
          "Editor-Version": COPILOT_EDITOR_VERSION,
          "Editor-Plugin-Version": COPILOT_EDITOR_PLUGIN_VERSION,
        });
        const usageJson = JSON.parse(usageRaw);
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
      return {
        platform: "github-copilot",
        account: config?.username ?? "GitHub Copilot",
        title: "GitHub Copilot Account Quota",
        status: "error",
        error: String(e),
        quotas: [],
      };
    }
  }

  private async fetchGoogle(account: {
    email?: string;
    refreshToken: string;
  }): Promise<PlatformQuota[]> {
    // Refresh access token
    let accessToken: string;
    try {
      const refreshRaw = await httpsPost(
        GOOGLE_TOKEN_REFRESH_URL,
        { "Content-Type": "application/x-www-form-urlencoded" },
        new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: account.refreshToken,
          grant_type: "refresh_token",
        }).toString(),
      );
      const refreshed = JSON.parse(refreshRaw);
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
      const raw = await httpsPost(
        GOOGLE_QUOTA_API_URL,
        {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        JSON.stringify({}),
      );
      const json = JSON.parse(raw);
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
          label: "─────────────────────────",
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

  private resolveGeminiCliProjectId(
    projectsFile?: GeminiCliProjectsFile,
  ): string | undefined {
    const envProject =
      process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
    if (envProject) {
      return envProject;
    }

    const projects = projectsFile?.projects;
    if (!projects || typeof projects !== "object") {
      return undefined;
    }

    const entries = Object.entries(projects).filter(
      ([key, value]) => typeof key === "string" && typeof value === "string",
    );

    if (entries.length === 0) {
      return undefined;
    }

    const cwd = normalizePathForLookup(process.cwd());
    const exactMatch = entries.find(
      ([projectPath]) => normalizePathForLookup(projectPath) === cwd,
    );
    if (exactMatch) {
      return exactMatch[1];
    }

    const cwdBase = path.basename(cwd);
    const suffixMatch = entries.find(([projectPath]) =>
      normalizePathForLookup(projectPath).endsWith(`/${cwdBase}`),
    );
    if (suffixMatch) {
      return suffixMatch[1];
    }

    if (entries.length === 1) {
      return entries[0][1];
    }

    return undefined;
  }

  private async refreshGeminiCliAccessToken(
    creds: GeminiCliOAuthCredentials,
  ): Promise<GeminiCliOAuthCredentials | null> {
    if (!creds.refresh_token) {
      return null;
    }

    try {
      const refreshRaw = await httpsPost(
        GOOGLE_TOKEN_REFRESH_URL,
        { "Content-Type": "application/x-www-form-urlencoded" },
        new URLSearchParams({
          client_id: GEMINI_CLI_OAUTH_CLIENT_ID,
          client_secret: GEMINI_CLI_OAUTH_CLIENT_SECRET,
          refresh_token: creds.refresh_token,
          grant_type: "refresh_token",
        }).toString(),
      );

      const refreshed = JSON.parse(refreshRaw);
      if (!refreshed?.access_token) {
        return null;
      }

      const next: GeminiCliOAuthCredentials = {
        ...creds,
        access_token: refreshed.access_token,
        token_type: refreshed.token_type ?? creds.token_type,
        scope: refreshed.scope ?? creds.scope,
        expiry_date:
          typeof refreshed.expires_in === "number"
            ? Date.now() + refreshed.expires_in * 1000
            : creds.expiry_date,
      };

      try {
        fs.writeFileSync(
          geminiOAuthPath,
          JSON.stringify(next, null, 2),
          "utf8",
        );
      } catch {}

      return next;
    } catch {
      return null;
    }
  }

  private async requestGeminiCliQuota(
    accessToken: string,
    projectId: string,
  ): Promise<GeminiQuotaResponse> {
    const raw = await httpsPost(
      GEMINI_CLI_QUOTA_API_URL,
      {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      JSON.stringify({ project: projectId }),
    );

    return JSON.parse(raw) as GeminiQuotaResponse;
  }

  private async fetchGeminiCliQuota(
    creds: GeminiCliOAuthCredentials,
    projectsFile?: GeminiCliProjectsFile,
    accountsFile?: GeminiCliAccountsFile,
  ): Promise<PlatformQuota | null> {
    let activeCreds = creds;

    if (
      (!activeCreds.access_token ||
        (typeof activeCreds.expiry_date === "number" &&
          activeCreds.expiry_date <= Date.now() + 60_000)) &&
      activeCreds.refresh_token
    ) {
      const refreshed = await this.refreshGeminiCliAccessToken(activeCreds);
      if (refreshed) {
        activeCreds = refreshed;
      }
    }

    if (!activeCreds.access_token) {
      return {
        platform: "google-gemini-cli",
        account: accountsFile?.active ?? "Gemini CLI",
        title: "Google / Gemini CLI",
        status: "error",
        error: "No Gemini CLI access token available",
        quotas: [],
      };
    }

    const initialAccessToken = activeCreds.access_token;

    const projectId = this.resolveGeminiCliProjectId(projectsFile);
    if (!projectId) {
      return {
        platform: "google-gemini-cli",
        account: accountsFile?.active ?? "Gemini CLI",
        title: "Google / Gemini CLI",
        status: "warning",
        error:
          "No Gemini CLI project mapping found. Set GOOGLE_CLOUD_PROJECT or open from a mapped workspace.",
        quotas: [{ label: "No quota data", remainPercent: 0 }],
      };
    }

    let quotaResponse: GeminiQuotaResponse | null = null;

    try {
      quotaResponse = await this.requestGeminiCliQuota(
        initialAccessToken,
        projectId,
      );
    } catch {
      if (activeCreds.refresh_token) {
        const refreshed = await this.refreshGeminiCliAccessToken(activeCreds);
        const refreshedToken = refreshed?.access_token;
        if (refreshedToken) {
          activeCreds = refreshed;
          try {
            quotaResponse = await this.requestGeminiCliQuota(
              refreshedToken,
              projectId,
            );
          } catch {
            quotaResponse = null;
          }
        }
      }
    }

    if (!quotaResponse) {
      return {
        platform: "google-gemini-cli",
        account: accountsFile?.active ?? "Gemini CLI",
        title: "Google / Gemini CLI",
        status: "error",
        error: "Failed to retrieve Gemini CLI quota",
        quotas: [],
      };
    }

    const buckets = Array.isArray(quotaResponse.buckets)
      ? quotaResponse.buckets
      : [];
    const quotas: QuotaItem[] = [];

    for (const bucket of buckets) {
      if (!bucket?.modelId) {
        continue;
      }

      const fraction = Number(bucket.remainingFraction ?? 0);
      if (!Number.isFinite(fraction)) {
        continue;
      }

      const remainPercentRaw = Math.max(0, Math.min(100, fraction * 100));
      const remaining = Number(bucket.remainingAmount ?? 0);
      let usedTotalDisplay: string | undefined;

      if (remaining > 0 && fraction > 0) {
        const limit = Math.round(remaining / fraction);
        if (limit > 0 && Number.isFinite(limit)) {
          const used = Math.max(0, limit - remaining);
          usedTotalDisplay = `${formatNumber(used)} / ${formatNumber(limit)}`;
        }
      }

      const resetAtMs = bucket.resetTime ? Date.parse(bucket.resetTime) : NaN;

      quotas.push({
        label: bucket.tokenType
          ? `${bucket.modelId} (${bucket.tokenType.toLowerCase()})`
          : bucket.modelId,
        remainPercent: percentBar(remainPercentRaw),
        usedTotalDisplay,
        percentLabel: `${remainPercentRaw.toFixed(1)}% remaining`,
        resetLabel: Number.isFinite(resetAtMs)
          ? formatResetFromTimestampMs(resetAtMs)
          : undefined,
      });
    }

    if (quotas.length === 0) {
      quotas.push({ label: "No quota data", remainPercent: 0 });
    }

    const hasLowQuota = quotas.some((q) => q.remainPercent <= 10);

    return {
      platform: "google-gemini-cli",
      account: accountsFile?.active ?? "Gemini CLI",
      accountLabel: projectId,
      title: "Google / Gemini CLI",
      status: hasLowQuota ? "warning" : "ok",
      quotas,
    };
  }

  // ── Dispose ──────────────────────────────────────────────────────────────────

  public dispose(): void {
    this.isDisposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.removeAllListeners();
  }
}
