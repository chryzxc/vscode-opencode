/**
 * Budget Indicator Component
 *
 * Displays daily budget status, warnings, and advice for managing request quota.
 */

import { useAppState } from './lib/store';

export function BudgetIndicator() {
  const state = useAppState();
  const budget = state.budgetInfo;

  if (!budget || !budget.enabled) {
    return null;
  }

  const usagePercent =
    budget.dailyAllowance > 0
      ? (budget.usedToday / budget.dailyAllowance) * 100
      : 0;

  const barColor =
    budget.warningLevel === 'critical'
      ? 'bg-red-500'
      : budget.warningLevel === 'warning'
        ? 'bg-yellow-500'
        : 'bg-green-500';

  const textColor =
    budget.warningLevel === 'critical'
      ? 'text-red-500'
      : budget.warningLevel === 'warning'
        ? 'text-yellow-500'
        : 'text-green-500';

  return (
    <div className="mb-2 rounded-md border border-[var(--oc-border)] bg-[var(--oc-panel)] p-2 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 font-medium text-[var(--oc-text)]">
          <span>📊 {budget.planName} Plan</span>
          <span className="text-[var(--oc-text-muted)]">
            {budget.usedToday} / {budget.dailyAllowance} today
          </span>
        </div>
        {budget.warningLevel !== 'ok' && (
          <span className={`${textColor} font-semibold`}>
            {budget.warningLevel === 'critical' ? '⚠️' : '⚡'}
          </span>
        )}
      </div>

      {/* Progress Bar */}
      <div className="mb-1.5">
        <div className="h-1.5 w-full bg-[var(--oc-border)] rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} transition-all duration-300`}
            style={{ width: `${Math.min(100, usagePercent)}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-[var(--oc-text-muted)]">
          <span>{budget.remainingToday} remaining today</span>
          <span>{Math.round(usagePercent)}% used</span>
        </div>
      </div>

      {/* Monthly Stats */}
      <div className="grid grid-cols-2 gap-2 mb-1.5 text-[10px]">
        <div className="text-center">
          <div className="text-[var(--oc-text-muted)]">This Month</div>
          <div className="font-medium text-[var(--oc-text)]">
            {budget.usedToday} used
          </div>
        </div>
        <div className="text-center">
          <div className="text-[var(--oc-text-muted)]">
            {budget.daysRemaining} days left
          </div>
          <div className="font-medium text-[var(--oc-text)]">
            ~{Math.round(budget.projectedMonthlyUsage)} projected
          </div>
        </div>
      </div>

      {/* Advice */}
      {budget.advice.length > 0 && (
        <div className="space-y-1">
          {budget.advice.map((advice, index) => (
            <div
              key={index}
              className="text-[10px] text-[var(--oc-text-muted)] bg-[var(--oc-bg)] px-1.5 py-1 rounded"
            >
              {advice}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CompactBudgetIndicatorProps {
  usedToday: number;
  dailyAllowance: number;
  warningLevel: 'ok' | 'warning' | 'critical';
}

export function CompactBudgetIndicator({
  usedToday,
  dailyAllowance,
  warningLevel,
}: CompactBudgetIndicatorProps) {
  const usagePercent =
    dailyAllowance > 0 ? (usedToday / dailyAllowance) * 100 : 0;

  const barColor =
    warningLevel === 'critical'
      ? 'bg-red-500'
      : warningLevel === 'warning'
        ? 'bg-yellow-500'
        : 'bg-green-500';

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--oc-panel)] border border-[var(--oc-border)] text-[10px]"
      title={`${usedToday} / ${dailyAllowance} requests used today`}
    >
      <span className="text-[var(--oc-text-muted)]">Today:</span>
      <span className="font-medium text-[var(--oc-text)]">{usedToday}</span>
      <span className="text-[var(--oc-text-muted)]">/</span>
      <span className="text-[var(--oc-text-muted)]">{dailyAllowance}</span>
      <div className="h-1 w-12 bg-[var(--oc-border)] rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${Math.min(100, usagePercent)}%` }}
        />
      </div>
    </div>
  );
}
