/**
 * Gemini Token Usage Tracker
 *
 * Tracks token usage from Gemini API responses via the usageMetadata
 * that comes in message.updated stream events.
 *
 * **Token Types Tracked:**
 * - input: Input/prompt tokens (promptTokenCount)
 * - output: Output/candidates tokens (candidatesTokenCount)
 * - reasoning: Thought/reasoning tokens (thoughtsTokenCount)
 * - cacheRead: Cache read tokens
 * - cacheWrite: Cache write tokens
 *
 * **Data Flow:**
 * 1. OpenCode server sends message.updated event with info.tokens
 * 2. ChatViewProvider extracts tokens and forwards to tracker
 * 3. Tracker accumulates usage by model
 * 4. QuotaService reads tracked usage for display
 *
 * **Daily Reset:**
 * Token counts reset automatically at midnight UTC.
 */

import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createLogger } from "../utils/Logger";
import { LoggingCategories } from "../utils/LoggingSchema";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Token usage for a single request/response
 */
export interface TokenUsage {
  /** Input/prompt tokens */
  input: number;
  /** Output/response tokens */
  output: number;
  /** Thought/reasoning tokens */
  reasoning: number;
  /** Cache read tokens */
  cacheRead?: number;
  /** Cache write tokens */
  cacheWrite?: number;
}

/**
 * Accumulated token usage for a model
 */
export interface ModelTokenUsage {
  /** Model identifier (e.g., "gemini-2.5-flash", "gemini-2.5-pro") */
  model: string;
  /** Total input tokens used */
  totalInput: number;
  /** Total output tokens used */
  totalOutput: number;
  /** Total reasoning tokens used */
  totalReasoning: number;
  /** Total cache read tokens */
  totalCacheRead: number;
  /** Total cache write tokens */
  totalCacheWrite: number;
  /** Grand total (all token types) */
  grandTotal: number;
  /** Number of requests tracked */
  requestCount: number;
  /** Last updated timestamp */
  lastUpdated: number;
}

/**
 * Daily token usage snapshot for persistence
 */
interface DailyUsageSnapshot {
  /** Date in YYYY-MM-DD format (UTC) */
  date: string;
  /** Usage by model */
  models: Record<string, {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    requestCount: number;
  }>;
}

// ── Constants ───────────────────────────────────────────────────────────────────

const STORAGE_PATH = path.join(
  os.homedir(),
  ".local",
  "share",
  "opencode",
  "gemini-token-usage.json",
);

const FREE_TIER_DAILY_LIMIT = 1_000_000; // 1M tokens per day for free tier

// ── Helpers ────────────────────────────────────────────────────────────────────

function getTodayUTC(): string {
  const now = new Date();
  return now.toISOString().split("T")[0]; // YYYY-MM-DD in UTC
}

function ensureStorageDir(): void {
  const dir = path.dirname(STORAGE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readStorage(): DailyUsageSnapshot | null {
  try {
    const raw = fs.readFileSync(STORAGE_PATH, "utf8");
    const parsed = JSON.parse(raw) as DailyUsageSnapshot;
    // Validate structure
    if (parsed && typeof parsed.date === "string" && typeof parsed.models === "object") {
      return parsed;
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return null;
}

function writeStorage(snapshot: DailyUsageSnapshot): void {
  try {
    ensureStorageDir();
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
  } catch (error) {
    const logger = createLogger(LoggingCategories.EXTENSION);
    logger.error("Failed to write storage", { snapshot }, error as Error);
  }
}

// ── GeminiTokenUsageTracker ─────────────────────────────────────────────────────

/**
 * Singleton instance of the token tracker
 */
let trackerInstance: GeminiTokenUsageTracker | null = null;

export class GeminiTokenUsageTracker extends EventEmitter {
  private currentUsage: Record<string, ModelTokenUsage> = {};
  private currentDate: string;
  private isDisposed = false;
  private logger = createLogger(LoggingCategories.EXTENSION);

  constructor() {
    super();
    this.currentDate = getTodayUTC();
    this.loadFromStorage();
    this.checkDailyReset();
  }

  /**
   * Records token usage from a message.updated event
   *
   * @param model - Model identifier (e.g., "gemini-2.5-flash")
   * @param tokens - Token usage data from info.tokens
   */
  public recordUsage(model: string, tokens: TokenUsage): void {
    if (this.isDisposed) {
      return;
    }

    this.checkDailyReset();

    const usage = this.currentUsage[model] || {
      model,
      totalInput: 0,
      totalOutput: 0,
      totalReasoning: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      grandTotal: 0,
      requestCount: 0,
      lastUpdated: Date.now(),
    };

    usage.totalInput += tokens.input || 0;
    usage.totalOutput += tokens.output || 0;
    usage.totalReasoning += tokens.reasoning || 0;
    usage.totalCacheRead += tokens.cacheRead || 0;
    usage.totalCacheWrite += tokens.cacheWrite || 0;
    usage.grandTotal =
      usage.totalInput +
      usage.totalOutput +
      usage.totalReasoning +
      usage.totalCacheRead +
      usage.totalCacheWrite;
    usage.requestCount += 1;
    usage.lastUpdated = Date.now();

    this.currentUsage[model] = usage;
    this.saveToStorage();
    this.emit("usageUpdated", this.getAllUsage());
  }

  /**
   * Gets usage for a specific model
   *
   * @param model - Model identifier
   * @returns Model usage or undefined if not tracked
   */
  public getModelUsage(model: string): ModelTokenUsage | undefined {
    this.checkDailyReset();
    return this.currentUsage[model];
  }

  /**
   * Gets all tracked model usage
   *
   * @returns Array of model usage, sorted by grand total (descending)
   */
  public getAllUsage(): ModelTokenUsage[] {
    this.checkDailyReset();
    return Object.values(this.currentUsage).sort(
      (a, b) => b.grandTotal - a.grandTotal,
    );
  }

  /**
   * Gets grand total across all models
   *
   * @returns Total tokens used across all models today
   */
  public getGrandTotal(): number {
    this.checkDailyReset();
    return Object.values(this.currentUsage).reduce(
      (sum, usage) => sum + usage.grandTotal,
      0,
    );
  }

  /**
   * Gets remaining tokens for the day (free tier limit)
   *
   * @param dailyLimit - Daily token limit (default: 1M for free tier)
   * @returns Remaining tokens, or 0 if exceeded
   */
  public getRemainingTokens(dailyLimit = FREE_TIER_DAILY_LIMIT): number {
    this.checkDailyReset();
    const used = this.getGrandTotal();
    return Math.max(0, dailyLimit - used);
  }

  /**
   * Gets usage percentage for the day
   *
   * @param dailyLimit - Daily token limit (default: 1M for free tier)
   * @returns Usage percentage (0-100)
   */
  public getUsagePercent(dailyLimit = FREE_TIER_DAILY_LIMIT): number {
    this.checkDailyReset();
    const used = this.getGrandTotal();
    return Math.min(100, (used / dailyLimit) * 100);
  }

  /**
   * Resets all tracking data
   */
  public reset(): void {
    this.currentUsage = {};
    this.currentDate = getTodayUTC();
    this.saveToStorage();
    this.emit("usageUpdated", []);
  }

  /**
   * Cleans up resources
   */
  public dispose(): void {
    this.isDisposed = true;
    this.saveToStorage();
    this.removeAllListeners();
  }

  /**
   * Gets the singleton instance of the token tracker
   *
   * @returns The shared token tracker instance
   */
  public static getInstance(): GeminiTokenUsageTracker {
    if (!trackerInstance) {
      trackerInstance = new GeminiTokenUsageTracker();
    }
    return trackerInstance;
  }

  /**
   * Resets the singleton instance (mainly for testing)
   */
  public static resetInstance(): void {
    if (trackerInstance) {
      trackerInstance.dispose();
      trackerInstance = null;
    }
  }

  // ── Private Methods ───────────────────────────────────────────────────────────

  /**
   * Checks if we've crossed into a new day and resets if needed
   */
  private checkDailyReset(): void {
    const today = getTodayUTC();
    if (today !== this.currentDate) {
      // New day - reset tracking
      this.currentDate = today;
      this.currentUsage = {};
      this.saveToStorage();
      this.emit("dailyReset", today);
    }
  }

  /**
   * Loads usage data from persistent storage
   */
  private loadFromStorage(): void {
    const snapshot = readStorage();
    if (snapshot && snapshot.date === this.currentDate) {
      // Load today's data
      for (const [model, data] of Object.entries(snapshot.models)) {
        this.currentUsage[model] = {
          model,
          totalInput: data.input,
          totalOutput: data.output,
          totalReasoning: data.reasoning,
          totalCacheRead: data.cacheRead,
          totalCacheWrite: data.cacheWrite,
          grandTotal:
            data.input +
            data.output +
            data.reasoning +
            data.cacheRead +
            data.cacheWrite,
          requestCount: data.requestCount,
          lastUpdated: Date.now(),
        };
      }
    }
  }

  /**
   * Saves current usage data to persistent storage
   */
  private saveToStorage(): void {
    const snapshot: DailyUsageSnapshot = {
      date: this.currentDate,
      models: {},
    };

    for (const [model, usage] of Object.entries(this.currentUsage)) {
      snapshot.models[model] = {
        input: usage.totalInput,
        output: usage.totalOutput,
        reasoning: usage.totalReasoning,
        cacheRead: usage.totalCacheRead,
        cacheWrite: usage.totalCacheWrite,
        requestCount: usage.requestCount,
      };
    }

    writeStorage(snapshot);
  }
}
