import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
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
const GOOGLE_TOKEN_REFRESH_URL = "https://oauth2.googleapis.com/token";

const GOOGLE_CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";

const GOOGLE_MODELS = [
  { key: "gemini-3-pro-high", altKey: "gemini-3-pro-low", display: "G3 Pro" },
  { key: "gemini-3-pro-image", display: "G3 Image" },
  { key: "gemini-3-flash", display: "G3 Flash" },
  { key: "claude-opus-4-5-thinking", altKey: "claude-opus-4-5", display: "Claude" },
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

function percentBar(pct: number): number {
  return Math.max(0, Math.min(100, Math.round(pct)));
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
    const platforms: PlatformQuota[] = [];

    const tasks: Promise<void>[] = [];

    // OpenAI
    if (auth?.openai) {
      tasks.push(
        this.fetchOpenAI(auth.openai)
          .then((p) => { if (p) platforms.push(p); })
          .catch(() => {}),
      );
    }

    // Zhipu
    const zhipuAuth = auth?.["zhipuai-coding-plan"];
    if (zhipuAuth) {
      tasks.push(
        this.fetchZhipu(zhipuAuth, "Zhipu AI", ZHIPU_USAGE_URL)
          .then((p) => { if (p) platforms.push(p); })
          .catch(() => {}),
      );
    }

    // ZAI
    const zaiAuth = auth?.["zai-coding-plan"];
    if (zaiAuth) {
      tasks.push(
        this.fetchZhipu(zaiAuth, "Z.AI", ZAI_USAGE_URL)
          .then((p) => { if (p) platforms.push(p); })
          .catch(() => {}),
      );
    }

    // GitHub Copilot
    const copilotAuth = auth?.["github-copilot"];
    const copilotConfig = readJsonFile<CopilotQuotaConfig>(copilotConfigPath);
    if (copilotAuth && copilotConfig) {
      tasks.push(
        this.fetchCopilot(copilotAuth, copilotConfig)
          .then((p) => { if (p) platforms.push(p); })
          .catch(() => {}),
      );
    }

    // Google / Antigravity
    const antigravityFile = readJsonFile<AntigravityAccountsFile>(antigravityPath);
    if (antigravityFile?.accounts?.length) {
      for (const account of antigravityFile.accounts) {
        tasks.push(
          this.fetchGoogle(account)
            .then((ps) => platforms.push(...ps))
            .catch(() => {}),
        );
      }
    }

    await Promise.allSettled(tasks);

    const data: QuotaData = {
      platforms,
      lastUpdated: Date.now(),
    };

    this._cachedData = data;
    this.emit("quotaUpdate", data);
    return data;
  }

  // ── Platform fetchers ────────────────────────────────────────────────────────

  private async fetchOpenAI(auth: OpenAIAuthData): Promise<PlatformQuota | null> {
    if (!auth.access) return null;
    try {
      const raw = await httpsGet(OPENAI_USAGE_URL, {
        Authorization: `Bearer ${auth.access}`,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      });
      const json = JSON.parse(raw);

      const quotas: QuotaItem[] = [];

      // Parse o-series / GPT usage segments
      const allotments: any[] = json?.allotments ?? [];
      for (const a of allotments) {
        const label = a.model_group_display ?? a.model_group ?? "Unknown";
        const used = a.usage ?? 0;
        const total = a.limit ?? 0;
        const remain = total > 0 ? ((total - used) / total) * 100 : 0;
        const resetAt = a.reset_at
          ? new Date(a.reset_at * 1000).toLocaleDateString()
          : undefined;
        quotas.push({
          label,
          remainPercent: percentBar(remain),
          usedTotalDisplay: `${formatNumber(used)} / ${formatNumber(total)}`,
          percentLabel: `${percentBar(remain)}% remaining`,
          resetLabel: resetAt ? `Resets ${resetAt}` : undefined,
        });
      }

      if (quotas.length === 0) {
        quotas.push({ label: "No quota data", remainPercent: 0 });
      }

      return {
        platform: "openai",
        account: "ChatGPT",
        title: "OpenAI / ChatGPT",
        status: "ok",
        quotas,
      };
    } catch (e) {
      return {
        platform: "openai",
        account: "ChatGPT",
        title: "OpenAI / ChatGPT",
        status: "error",
        error: String(e),
        quotas: [],
      };
    }
  }

  private async fetchZhipu(
    auth: ZhipuAuthData,
    platformName: string,
    url: string,
  ): Promise<PlatformQuota | null> {
    if (!auth.key) return null;
    try {
      const raw = await httpsGet(url, {
        Authorization: `Bearer ${auth.key}`,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      });
      const json = JSON.parse(raw);
      const data = json?.data ?? json;

      const quotas: QuotaItem[] = [];
      const items: any[] = Array.isArray(data) ? data : data?.items ?? [];

      for (const item of items) {
        const label = item.model ?? item.name ?? "Unknown";
        const total = item.total ?? item.quota ?? 0;
        const used = item.used ?? 0;
        const remaining = item.remaining ?? total - used;
        const remainPct = total > 0 ? (remaining / total) * 100 : 0;
        quotas.push({
          label,
          remainPercent: percentBar(remainPct),
          usedTotalDisplay: `${formatNumber(used)} / ${formatNumber(total)}`,
          percentLabel: `${percentBar(remainPct)}% remaining`,
        });
      }

      if (quotas.length === 0) {
        quotas.push({ label: "No quota data", remainPercent: 0 });
      }

      return {
        platform: platformName.toLowerCase().replace(/\s/g, "-"),
        account: platformName,
        title: platformName,
        status: "ok",
        quotas,
      };
    } catch (e) {
      return {
        platform: platformName.toLowerCase().replace(/\s/g, "-"),
        account: platformName,
        title: platformName,
        status: "error",
        error: String(e),
        quotas: [],
      };
    }
  }

  private async fetchCopilot(
    auth: CopilotAuthData,
    config: CopilotQuotaConfig,
  ): Promise<PlatformQuota | null> {
    // Refresh token if expired
    let token = auth.access;
    const expired = auth.expires ? auth.expires < Date.now() / 1000 - 60 : true;

    if (expired && auth.refresh) {
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

    if (!token) return null;

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

      // Fetch usage
      const usageRaw = await httpsGet(
        `https://api.githubcopilot.com/usage`,
        {
          Authorization: `Bearer ${apiToken}`,
          "User-Agent": COPILOT_USER_AGENT,
          "Editor-Version": COPILOT_EDITOR_VERSION,
          "Editor-Plugin-Version": COPILOT_EDITOR_PLUGIN_VERSION,
        },
      );
      const usageJson = JSON.parse(usageRaw);

      const tier: CopilotTier = config.tier ?? "free";
      const limit = COPILOT_PLAN_LIMITS[tier] ?? 50;
      const used: number = usageJson?.premium_requests_used ?? 0;
      const remaining = Math.max(0, limit - used);
      const remainPct = limit > 0 ? (remaining / limit) * 100 : 0;

      return {
        platform: "github-copilot",
        account: config.username,
        accountLabel: `@${config.username}`,
        title: "GitHub Copilot",
        status: remainPct < 10 ? "warning" : "ok",
        quotas: [
          {
            label: `Premium Requests (${tier})`,
            remainPercent: percentBar(remainPct),
            usedTotalDisplay: `${used} / ${limit}`,
            percentLabel: `${percentBar(remainPct)}% remaining`,
          },
        ],
      };
    } catch (e) {
      return {
        platform: "github-copilot",
        account: config.username,
        title: "GitHub Copilot",
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
