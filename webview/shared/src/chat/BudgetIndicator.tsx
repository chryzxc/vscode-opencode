/**
 * Budget Indicator Component
 *
 * Displays daily budget status, warnings, and advice for managing request quota.
 * BRUTALIST DEVELOPER AESTHETIC: Industrial design language with exposed structure,
 * technical markers, and precise typography.
 */

import { useAppState } from './lib/store';
import './BudgetIndicator.css';

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

  const getThemeColor = () => {
    switch (budget.warningLevel) {
      case 'critical': return '#ff3333';
      case 'warning': return '#ffaa00';
      default: return '#00ff88';
    }
  };

  const themeColor = getThemeColor();

  return (
    <div className="budget-indicator-brutalist">
      {/* Technical marker */}
      <div className="budget-tech-marker">QT-01</div>

      {/* Header */}
      <div className="budget-header">
        <div className="budget-title-group">
          <span className="budget-emoji">◆</span>
          <span className="budget-plan-name">{budget.planName} PLAN</span>
        </div>
        <div className="budget-usage-display">
          <span className="budget-used">{budget.usedToday}</span>
          <span className="budget-separator">/</span>
          <span className="budget-total">{budget.dailyAllowance}</span>
          <span className="budget-label">TODAY</span>
        </div>
      </div>

      {/* Status Badge */}
      {budget.warningLevel !== 'ok' && (
        <div className="budget-status-badge" style={{ borderColor: themeColor, color: themeColor }}>
          <span className="budget-status-dot" style={{ backgroundColor: themeColor }}></span>
          {budget.warningLevel === 'critical' ? 'CRITICAL' : 'WARNING'}
        </div>
      )}

      {/* Progress Bar */}
      <div className="budget-progress-section">
        <div className="budget-progress-labels">
          <span>CONSUMED</span>
          <span>{Math.round(usagePercent)}%</span>
        </div>
        <div className="budget-progress-container">
          <div
            className="budget-progress-bar"
            style={{
              width: `${Math.min(100, usagePercent)}%`,
              backgroundColor: themeColor,
              boxShadow: `0 0 10px ${themeColor}40`,
            }}
          />
        </div>
        <div className="budget-progress-details">
          <span className="budget-detail-item">
            <span className="budget-detail-arrow">→</span>
            {budget.remainingToday} REMAINING
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="budget-stats-grid">
        <div className="budget-stat-item">
          <div className="budget-stat-label">THIS MONTH</div>
          <div className="budget-stat-value">{budget.usedToday}</div>
          <div className="budget-stat-subtext">REQUESTS USED</div>
        </div>
        <div className="budget-stat-item">
          <div className="budget-stat-label">{budget.daysRemaining} DAYS LEFT</div>
          <div className="budget-stat-value" style={{ color: themeColor }}>
            ~{Math.round(budget.projectedMonthlyUsage)}
          </div>
          <div className="budget-stat-subtext">PROJECTED</div>
        </div>
      </div>

      {/* Advice Section */}
      {budget.advice.length > 0 && (
        <div className="budget-advice-section">
          {budget.advice.map((advice, index) => (
            <div key={index} className="budget-advice-item">
              <span className="budget-advice-marker">▸</span>
              {advice}
            </div>
          ))}
        </div>
      )}

      {/* Technical decoration */}
      <div className="budget-tech-decoration">
        <span></span>
        <span></span>
      </div>
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

  const getThemeColor = () => {
    switch (warningLevel) {
      case 'critical': return '#ff3333';
      case 'warning': return '#ffaa00';
      default: return '#00ff88';
    }
  };

  const themeColor = getThemeColor();

  return (
    <div
      className="compact-budget-indicator"
      style={{
        '--theme-color': themeColor,
      } as React.CSSProperties}
      title={`${usedToday} / ${dailyAllowance} requests used today`}
    >
      <span className="compact-label">TODAY:</span>
      <span className="compact-used">{usedToday}</span>
      <span className="compact-separator">/</span>
      <span className="compact-total">{dailyAllowance}</span>
      <div className="compact-progress-track">
        <div
          className="compact-progress-bar"
          style={{
            width: `${Math.min(100, usagePercent)}%`,
            backgroundColor: themeColor,
          }}
        />
      </div>
    </div>
  );
}
