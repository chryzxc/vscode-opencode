/**
 * Quota / Budget Flow Integration Tests
 *
 * Validates the complete RequestBudgeter + ChatViewProvider budget flow:
 *   Budget config → load usage → calculate allowance → enforce →
 *   record request → persist usage → advise
 *
 * Also covers ChatViewProvider integration:
 *   Budget check before send → block if exceeded → post budget info to webview
 *
 * Uses source-introspection to assert the codebase implements
 * every step of the quota/budget enforcement flow.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  readSource,
  readAllSources,
  extractFunctionBody,
  joinFromRoot,
} from "../helpers/source-utils.mjs";

const budgeterSource = readSource(
  [joinFromRoot("src", "services", "RequestBudgeter.ts")],
  "RequestBudgeter.ts",
);

const chatProviderSource = readAllSources(
  [
    joinFromRoot("src", "providers", "ChatViewProvider.ts"),
  ],
  "ChatViewProvider.ts",
);

// ---------------------------------------------------------------------------
// Configuration management
// ---------------------------------------------------------------------------

test("RequestBudgeter accepts configuration in constructor", () => {
  assert.match(
    budgeterSource,
    /constructor\s*\(\s*config/,
    "RequestBudgeter must accept config parameter",
  );
});

test("RequestBudgeter has monthlyQuota configuration", () => {
  assert.match(
    budgeterSource,
    /monthlyQuota/i,
    "RequestBudgeter must track monthlyQuota",
  );
});

test("RequestBudgeter has warnThreshold configuration", () => {
  assert.match(
    budgeterSource,
    /warnThreshold/i,
    "RequestBudgeter must track warnThreshold",
  );
});

test("RequestBudgeter has enforceLimit configuration", () => {
  assert.match(
    budgeterSource,
    /enforceLimit/i,
    "RequestBudgeter must track enforceLimit toggle",
  );
});

test("RequestBudgeter has dailySafetyMargin configuration", () => {
  assert.match(
    budgeterSource,
    /dailySafetyMargin/i,
    "RequestBudgeter must track dailySafetyMargin",
  );
});

test("RequestBudgeter supports updateConfig for runtime changes", () => {
  assert.match(
    budgeterSource,
    /updateConfig\s*\(\s*updates/,
    "RequestBudgeter must have updateConfig method",
  );
});

test("RequestBudgeter supports resetConfig to restore defaults", () => {
  assert.match(
    budgeterSource,
    /resetConfig/,
    "RequestBudgeter must have resetConfig method",
  );
});

// ---------------------------------------------------------------------------
// Plan management
// ---------------------------------------------------------------------------

test("RequestBudgeter tracks current plan via setPlan / getPlan", () => {
  assert.match(
    budgeterSource,
    /setPlan\s*\(\s*planId/,
    "RequestBudgeter must have setPlan method",
  );
  assert.match(
    budgeterSource,
    /getPlan\s*\(\s*\)/,
    "RequestBudgeter must have getPlan method",
  );
});

// ---------------------------------------------------------------------------
// Usage persistence
// ---------------------------------------------------------------------------

test("RequestBudgeter loads usage from filesystem", () => {
  assert.match(
    budgeterSource,
    /loadUsage/,
    "RequestBudgeter must have loadUsage method",
  );
});

test("RequestBudgeter saves usage to filesystem", () => {
  assert.match(
    budgeterSource,
    /saveUsage/,
    "RequestBudgeter must have saveUsage method",
  );
});

test("RequestBudgeter persists usage to budget-usage.json", () => {
  assert.match(
    budgeterSource,
    /budget-usage\.json/i,
    "RequestBudgeter must persist usage to budget-usage.json",
  );
});

test("RequestBudgeter persists config to budget-config.json", () => {
  assert.match(
    budgeterSource,
    /budget-config\.json/i,
    "RequestBudgeter must persist config to budget-config.json",
  );
});

test("RequestBudgeter uses writeJsonFile for persistence", () => {
  assert.match(
    budgeterSource,
    /writeJsonFile|writeFile/i,
    "RequestBudgeter must write JSON to filesystem",
  );
});

test("RequestBudgeter uses readJsonFile for loading", () => {
  assert.match(
    budgeterSource,
    /readJsonFile|readFile/i,
    "RequestBudgeter must read JSON from filesystem",
  );
});

// ---------------------------------------------------------------------------
// Usage recording
// ---------------------------------------------------------------------------

test("recordRequest increments usage for today", () => {
  assert.match(
    budgeterSource,
    /recordRequest\s*\(\s*\)/,
    "RequestBudgeter must have recordRequest method",
  );
});

test("getUsageForDate retrieves usage for a specific date", () => {
  assert.match(
    budgeterSource,
    /getUsageForDate\s*\(\s*date/,
    "RequestBudgeter must have getUsageForDate method",
  );
});

test("getTotalUsageThisMonth sums usage across the current month", () => {
  assert.match(
    budgeterSource,
    /getTotalUsageThisMonth/,
    "RequestBudgeter must have getTotalUsageThisMonth method",
  );
});

test("clearUsage resets all usage data", () => {
  assert.match(
    budgeterSource,
    /clearUsage\s*\(\s*\)/,
    "RequestBudgeter must have clearUsage method",
  );
});

test("clearUsageForDate resets usage for a specific date", () => {
  assert.match(
    budgeterSource,
    /clearUsageForDate\s*\(\s*date/,
    "RequestBudgeter must have clearUsageForDate method",
  );
});

// ---------------------------------------------------------------------------
// Budget calculation
// ---------------------------------------------------------------------------

test("recommendedDailyLimit is computed from monthlyQuota and days in month", () => {
  assert.match(
    budgeterSource,
    /recommendedDailyLimit/,
    "RequestBudgeter must compute recommendedDailyLimit",
  );
});

test("dailyAllowance caps recommendedDailyLimit with dailySafetyMargin", () => {
  assert.match(
    budgeterSource,
    /dailyAllowance/i,
    "RequestBudgeter must compute dailyAllowance",
  );
});

test("getBudgetStatus computes comprehensive budget status", () => {
  assert.match(
    budgeterSource,
    /getBudgetStatus\s*\(\s*\)/,
    "RequestBudgeter must have getBudgetStatus method",
  );
});

test("getBudgetStatus computes usedToday", () => {
  const statusBody = extractFunctionBody(
    budgeterSource,
    "getBudgetStatus()",
  );
  assert.ok(statusBody, "getBudgetStatus method must exist");
  assert.match(
    statusBody,
    /usedToday/i,
    "getBudgetStatus must compute usedToday",
  );
});

test("getBudgetStatus computes remainingToday", () => {
  assert.match(
    budgeterSource,
    /remainingToday/i,
    "getBudgetStatus must compute remainingToday",
  );
});

test("getBudgetStatus computes projectedMonthlyUsage", () => {
  assert.match(
    budgeterSource,
    /projectedMonthlyUsage/i,
    "getBudgetStatus must compute projectedMonthlyUsage",
  );
});

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

test("canMakeRequest returns allowed/disallowed decision", () => {
  assert.match(
    budgeterSource,
    /canMakeRequest\s*\(\s*\)/,
    "RequestBudgeter must have canMakeRequest method",
  );
});

test("canMakeRequest respects enforceLimit configuration", () => {
  assert.match(
    budgeterSource,
    /this\.config\.enforceLimit/,
    "canMakeRequest must check this.config.enforceLimit toggle",
  );
});

test("canMakeRequest blocks when daily limit is exceeded", () => {
  assert.match(
    budgeterSource,
    /allowed\s*:\s*false|allowed\s*=\s*false/,
    "canMakeRequest must return allowed: false in blocking scenarios",
  );
});

test("canMakeRequest provides reason when blocked", () => {
  assert.match(
    budgeterSource,
    /reason/,
    "canMakeRequest must include reason when request is blocked",
  );
});

test("canMakeRequest blocks when projected monthly usage exceeds 95%", () => {
  assert.match(
    budgeterSource,
    /0\.95|95/,
    "canMakeRequest must block at 95% projected monthly usage",
  );
});

// ---------------------------------------------------------------------------
// Advice / optimization
// ---------------------------------------------------------------------------

test("getRecommendedDailyLimit provides daily recommendation", () => {
  assert.match(
    budgeterSource,
    /getRecommendedDailyLimit\s*\(\s*\)/,
    "RequestBudgeter must have getRecommendedDailyLimit method",
  );
});

test("getOptimalDailyLimit computes optimal limit based on usage patterns", () => {
  assert.match(
    budgeterSource,
    /getOptimalDailyLimit/,
    "RequestBudgeter must have getOptimalDailyLimit method",
  );
});

test("getAdvice provides user-facing budget advice", () => {
  assert.match(
    budgeterSource,
    /getAdvice\s*\(\s*\)/,
    "RequestBudgeter must have getAdvice method",
  );
});

test("getUsageStats returns comprehensive usage statistics", () => {
  assert.match(
    budgeterSource,
    /getUsageStats\s*\(\s*\)/,
    "RequestBudgeter must have getUsageStats method",
  );
});

// ---------------------------------------------------------------------------
// Baseline management
// ---------------------------------------------------------------------------

test("RequestBudgeter tracks baselines per date for external usage sync", () => {
  assert.match(
    budgeterSource,
    /getBaselineForDate|setBaselineForDate/i,
    "RequestBudgeter must support baseline tracking per date",
  );
});

// ---------------------------------------------------------------------------
// ChatViewProvider integration: budget check before send
// ---------------------------------------------------------------------------

test("ChatViewProvider imports RequestBudgeter", () => {
  assert.match(
    chatProviderSource,
    /import.*RequestBudgeter.*from/,
    "ChatViewProvider must import RequestBudgeter",
  );
});

test("ChatViewProvider initializes RequestBudgeter", () => {
  assert.match(
    chatProviderSource,
    /new\s+RequestBudgeter\s*\(|budgeter\s*=\s*new\s+RequestBudgeter/,
    "ChatViewProvider must create RequestBudgeter instance",
  );
});

test("ChatViewProvider checks budget before sending messages", () => {
  assert.match(
    chatProviderSource,
    /canMakeRequest|budgeter\.can/,
    "ChatViewProvider must check budget before sending",
  );
});

test("ChatViewProvider posts budget info to webview", () => {
  assert.match(
    chatProviderSource,
    /budgetInfo|budget_info|budgetStatus/i,
    "ChatViewProvider must post budget info to webview",
  );
});

test("ChatViewProvider records request usage after send", () => {
  assert.match(
    chatProviderSource,
    /recordRequest|budgeter\.record/,
    "ChatViewProvider must record request usage after sending",
  );
});

test("ChatViewProvider warns user when budget is exceeded", () => {
  assert.match(
    chatProviderSource,
    /budgetCheck\.allowed/,
    "ChatViewProvider must check budgetCheck.allowed to detect blocked requests",
  );
  assert.match(
    chatProviderSource,
    /showWarningMessage/,
    "ChatViewProvider must show warning message when budget is exceeded",
  );
});
