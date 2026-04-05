/**
 * Request Budgeter Service
 *
 * Manages daily request budgets to ensure monthly quota lasts the entire month.
 * Features:
 * - Calculates daily budget based on monthly quota and days remaining
 * - Tracks daily usage
 * - Configurable safety margin (use less than full daily allowance)
 * - Provides warnings and enforcement
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../utils/Logger';
import { LoggingCategories } from '../utils/LoggingSchema';

export interface SubscriptionPlan {
  id: string;
  name: string;
  monthlyQuota: number;
  dailySafetyMargin?: number; // Optional: use only X requests per day (default: calculated)
}

export interface DailyBudget {
  date: string; // YYYY-MM-DD
  monthlyQuota: number;
  dailyAllowance: number;
  dailySafetyMargin: number | null; // If set, use this instead of calculated allowance
  used: number;
  remaining: number;
  isExceeded: boolean;
}

export interface BudgetStatus {
  currentDailyBudget: DailyBudget | null;
  daysInMonth: number;
  dayOfMonth: number;
  daysRemaining: number;
  recommendedDailyLimit: number;
  projectedMonthlyUsage: number;
  onTrack: boolean;
  warningLevel: 'ok' | 'warning' | 'critical';
}

export interface BudgetConfig {
  enabled: boolean;
  planId: string;
  dailySafetyMargin: number | null; // Override calculated daily limit
  enforceLimit: boolean; // Block requests when exceeded
  warnThreshold: number; // Warn when using X% of daily budget
}

// Default subscription plans
export const DEFAULT_PLANS: Record<string, SubscriptionPlan> = {
  free: { id: 'free', name: 'Free', monthlyQuota: 50 },
  pro: { id: 'pro', name: 'Pro', monthlyQuota: 300 },
  'pro+': { id: 'pro+', name: 'Pro+', monthlyQuota: 1500 },
  business: { id: 'business', name: 'Business', monthlyQuota: 300 },
  enterprise: { id: 'enterprise', name: 'Enterprise', monthlyQuota: 1000 },
};

const CONFIG_PATH = path.join(
  os.homedir(),
  '.config',
  'opencode',
  'budget-config.json'
);

const USAGE_PATH = path.join(
  os.homedir(),
  '.config',
  'opencode',
  'budget-usage.json'
);

// ── Helper Functions ───────────────────────────────────────────────────────────

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJsonFile<T>(filePath: string, data: T): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    const logger = createLogger(LoggingCategories.EXTENSION);
    logger.error('Failed to write file', { filePath }, error as Error);
  }
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function getDaysInMonth(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // JavaScript months are 0-indexed
  return new Date(year, month, 0).getDate();
}

function getDayOfMonth(date: Date): number {
  return date.getDate();
}

// ── Request Budgeter Service ─────────────────────────────────────────────────────

export class RequestBudgeter {
  private config: BudgetConfig;
  private usage: Record<string, number>; // Key: date, Value: request count
  private baselines: Record<string, number>; // Key: date, Value: baseline totalUsed
  private logger = createLogger(LoggingCategories.EXTENSION);

  constructor(config?: Partial<BudgetConfig>) {
    this.config = {
      enabled: true,
      planId: "pro",
      dailySafetyMargin: null,
      enforceLimit: false,
      warnThreshold: 0.8, // Warn at 80% of daily budget
      ...config,
    };

    this.usage = {};
    this.baselines = {};

    this.loadConfig();
    this.loadUsage();
  }

  // ── Configuration ─────────────────────────────────────────────────────────────

  public loadConfig(): void {
    const saved = readJsonFile<BudgetConfig>(CONFIG_PATH);
    if (saved) {
      this.config = { ...this.config, ...saved };
    }
  }

  public saveConfig(): void {
    writeJsonFile(CONFIG_PATH, this.config);
  }

  public getConfig(): BudgetConfig {
    return { ...this.config };
  }

  public updateConfig(updates: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig();
  }

  public setPlan(planId: string): void {
    if (!DEFAULT_PLANS[planId]) {
      throw new Error(
        `Unknown plan: ${planId}. Available: ${Object.keys(DEFAULT_PLANS).join(", ")}`,
      );
    }
    this.config.planId = planId;
    this.saveConfig();
  }

  public getPlan(): SubscriptionPlan {
    return DEFAULT_PLANS[this.config.planId] || DEFAULT_PLANS.pro;
  }

  // ── Usage Tracking ────────────────────────────────────────────────────────────

  public loadUsage(): void {
    const saved = readJsonFile<any>(USAGE_PATH);
    if (saved) {
      if (saved.usage && typeof saved.usage === "object") {
        this.usage = saved.usage;
        this.baselines = saved.baselines || {};
      } else {
        // Migrate from old format (just the usage record)
        this.usage = saved;
        this.baselines = {};
      }
    }
  }

  public saveUsage(): void {
    writeJsonFile(USAGE_PATH, {
      usage: this.usage,
      baselines: this.baselines,
    });
  }

  public recordRequest(): void {
    if (!this.config.enabled) {
      return;
    }

    const today = getTodayDate();
    this.usage[today] = (this.usage[today] || 0) + 1;
    this.saveUsage();
  }

  public getUsageForDate(date: string): number {
    return this.usage[date] || 0;
  }

  public getBaselineForDate(date: string): number | null {
    return this.baselines[date] !== undefined ? this.baselines[date] : null;
  }

  public setBaselineForDate(date: string, totalUsed: number): void {
    // Only set if not already set for today (unless it's a reset/explicit update)
    this.baselines[date] = totalUsed;
    this.saveUsage();
  }

  public getTotalUsageThisMonth(): number {
    const today = new Date();
    const daysInMonth = getDaysInMonth(today);

    let total = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      total += this.usage[dateStr] || 0;
    }
    return total;
  }

  // ── Budget Calculations ────────────────────────────────────────────────────────

  public getBudgetStatus(): BudgetStatus {
    if (!this.config.enabled) {
      throw new Error("Budgeter is disabled");
    }

    const today = new Date();
    const dayOfMonth = getDayOfMonth(today);
    const daysInMonth = getDaysInMonth(today);
    const daysRemaining = daysInMonth - dayOfMonth + 1; // Including today

    const plan = this.getPlan();
    const monthlyQuota = plan.monthlyQuota;
    const totalUsedSoFar = this.getTotalUsageThisMonth();

    // Calculate recommended daily limit to spread quota evenly
    const recommendedDailyLimit = Math.ceil(monthlyQuota / daysInMonth);

    // Daily allowance is the minimum of:
    // 1. Recommended daily limit (even spread)
    // 2. Configured safety margin (if user wants to be more conservative)
    const dailyAllowance =
      this.config.dailySafetyMargin !== null
        ? Math.min(recommendedDailyLimit, this.config.dailySafetyMargin)
        : recommendedDailyLimit;

    const todayStr = getTodayDate();
    const usedToday = this.usage[todayStr] || 0;
    const remainingToday = Math.max(0, dailyAllowance - usedToday);
    const remainingMonthly = Math.max(0, monthlyQuota - totalUsedSoFar);

    // Project monthly usage based on current daily rate
    const projectedMonthlyUsage = totalUsedSoFar + usedToday * daysRemaining;

    // Check if we're on track
    const expectedUsageByNow = Math.ceil(
      (monthlyQuota / daysInMonth) * dayOfMonth,
    );
    const onTrack = totalUsedSoFar <= expectedUsageByNow;

    // Determine warning level
    const usagePercent = dailyAllowance > 0 ? usedToday / dailyAllowance : 1;
    let warningLevel: "ok" | "warning" | "critical" = "ok";
    if (usagePercent >= 1) {
      warningLevel = "critical";
    } else if (usagePercent >= this.config.warnThreshold) {
      warningLevel = "warning";
    }

    return {
      currentDailyBudget: {
        date: todayStr,
        monthlyQuota,
        dailyAllowance,
        dailySafetyMargin: this.config.dailySafetyMargin,
        used: usedToday,
        remaining: remainingToday,
        isExceeded: usedToday > dailyAllowance,
      },
      daysInMonth,
      dayOfMonth,
      daysRemaining,
      recommendedDailyLimit,
      projectedMonthlyUsage,
      onTrack,
      warningLevel,
    };
  }

  public canMakeRequest(): { allowed: boolean; reason?: string } {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    if (!this.config.enforceLimit) {
      return { allowed: true };
    }

    const status = this.getBudgetStatus();
    const daily = status.currentDailyBudget;

    if (!daily) {
      return { allowed: false, reason: "Could not calculate daily budget" };
    }

    if (daily.isExceeded) {
      return {
        allowed: false,
        reason: `Daily budget exceeded (${daily.used} / ${daily.dailyAllowance}). Try again tomorrow.`,
      };
    }

    // Check if we're dangerously close to monthly quota
    const plan = this.getPlan();
    if (status.projectedMonthlyUsage >= plan.monthlyQuota * 0.95) {
      return {
        allowed: false,
        reason: `Monthly quota nearly exhausted. Only ${plan.monthlyQuota - status.projectedMonthlyUsage} requests projected to remain.`,
      };
    }

    return { allowed: true };
  }

  // ── Recommendations ────────────────────────────────────────────────────────────

  /**
   * Get recommended daily limit to ensure quota lasts the month
   */
  public getRecommendedDailyLimit(): number {
    const status = this.getBudgetStatus();
    return status.recommendedDailyLimit;
  }

  /**
   * Get usage statistics for display
   */
  public getUsageStats(): {
    totalUsed: number;
    totalRemaining: number;
    usedToday: number;
    dailyAllowance: number;
    remainingToday: number;
    daysRemaining: number;
    projectedMonthlyUsage: number;
    monthlyQuota: number;
  } {
    const status = this.getBudgetStatus();
    const plan = this.getPlan();
    const totalUsed = this.getTotalUsageThisMonth();

    return {
      totalUsed: totalUsed,
      totalRemaining: Math.max(0, plan.monthlyQuota - totalUsed),
      usedToday: status.currentDailyBudget?.used ?? 0,
      dailyAllowance: status.currentDailyBudget?.dailyAllowance ?? 0,
      remainingToday: status.currentDailyBudget?.remaining ?? 0,
      daysRemaining: status.daysRemaining,
      projectedMonthlyUsage: status.projectedMonthlyUsage,
      monthlyQuota: plan.monthlyQuota,
    };
  }

  /**
   * Calculate optimal daily limit based on current usage patterns
   */
  public getOptimalDailyLimit(): number {
    const status = this.getBudgetStatus();
    const daysRemaining = status.daysRemaining;
    const plan = this.getPlan();
    const remainingQuota = Math.max(
      0,
      plan.monthlyQuota - this.getTotalUsageThisMonth(),
    );

    if (daysRemaining <= 0) {
      return 0;
    }

    return Math.ceil(remainingQuota / daysRemaining);
  }

  /**
   * Get advice for the user based on current usage
   */
  public getAdvice(): string[] {
    const status = this.getBudgetStatus();
    const advice: string[] = [];

    if (!status.onTrack) {
      advice.push(
        "⚠️  You're using requests faster than planned. Consider reducing usage to avoid running out.",
      );
    }

    const plan = this.getPlan();
    if (status.projectedMonthlyUsage > plan.monthlyQuota) {
      advice.push(
        `🚨 At your current rate, you'll run out ${status.daysRemaining} days early! Reduce to ${status.recommendedDailyLimit} requests/day.`,
      );
    }

    const optimalDaily = this.getOptimalDailyLimit();
    const currentDaily = status.currentDailyBudget?.dailyAllowance ?? 0;

    if (optimalDaily < currentDaily && optimalDaily > 0) {
      advice.push(
        `💡 Consider reducing to ${optimalDaily} requests/day to last the month.`,
      );
    }

    if (
      status.daysRemaining <= 5 &&
      status.currentDailyBudget?.remaining === 0
    ) {
      advice.push("📅 Month is almost over. Your quota will reset soon!");
    }

    if (advice.length === 0) {
      advice.push(
        "✅ You're on track! Keep using requests at your current pace.",
      );
    }

    return advice;
  }

  // ── Reset & Clear ───────────────────────────────────────────────────────────────

  /**
   * Clear usage data (for testing or manual reset)
   */
  public clearUsage(): void {
    this.usage = {};
    this.saveUsage();
  }

  /**
   * Clear usage for a specific date
   */
  public clearUsageForDate(date: string): void {
    delete this.usage[date];
    this.saveUsage();
  }

  /**
   * Reset to default configuration
   */
  public resetConfig(): void {
    this.config = {
      enabled: true,
      planId: "pro",
      dailySafetyMargin: null,
      enforceLimit: false,
      warnThreshold: 0.8,
    };
    this.saveConfig();
  }
}

// ── Export singleton instance ─────────────────────────────────────────────────────

export const budgeter = new RequestBudgeter();
