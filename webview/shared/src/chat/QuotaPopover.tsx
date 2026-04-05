/**
 * Quota Popover Component
 *
 * Displays a comprehensive preview of quota monitoring data matching QuotaMonitor's exact design.
 */

import { useEffect, useRef } from 'react';
import { X, Calendar, CalendarRange, Clock, Zap, Award, RefreshCw } from 'lucide-react';
import { useAppDispatch, useAppState } from './lib/store';
import vscode from './lib/vscode';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import './QuotaPopover.css';

export function QuotaPopover() {
  const { quotaData, budgetInfo, isQuotaPopoverOpen, quotaIsRefreshing } = useAppState();
  const dispatch = useAppDispatch();
  const popoverRef = useRef<HTMLDivElement>(null);

  const handleRefresh = () => {
    dispatch({ type: 'SET_QUOTA_REFRESHING', payload: true });
    vscode.postMessage({ type: 'refreshQuota' });
  };

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest('.oc-quota-btn')
      ) {
        dispatch({ type: 'SET_QUOTA_POPOVER_OPEN', payload: false });
      }
    };

    // Close on Escape key
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dispatch({ type: 'SET_QUOTA_POPOVER_OPEN', payload: false });
      }
    };

    if (isQuotaPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isQuotaPopoverOpen, dispatch]);

  if (!isQuotaPopoverOpen) {
    return null;
  }

  // Match QuotaMonitor's barColor function
  const barColor = (pct: number) => {
    if (pct >= 50) return 'linear-gradient(90deg, #2ea043, #3fb950)';
    if (pct >= 20) return 'linear-gradient(90deg, #bf8700, #d29922)';
    return 'linear-gradient(90deg, #da3633, #f85149)';
  };

  // Helper to normalize platform name (matches toProviderName from QuotaMonitor)
  const toProviderName = (platform: string, title?: string) => {
    if (title) {
      return title.replace(' Account Quota', '').replace(' account quota', '').trim();
    }
    const key = platform.toLowerCase();
    if (key.includes('openai')) return 'OpenAI';
    if (key.includes('zai')) return 'Z.ai';
    if (key.includes('zhipu')) return 'Zhipu AI';
    if (key.includes('copilot')) return 'GitHub Copilot';
    return platform;
  };

  // Format last updated time
  const formatLastUpdated = () => {
    if (!quotaData?.lastUpdated) return 'Unknown';
    const diff = Date.now() - quotaData.lastUpdated;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Helper to get icon for quota type
  const getQuotaIcon = (label: string) => {
    const lower = label.toLowerCase();
    if (lower.includes('weekly')) return <Calendar className="h-3 w-3" />;
    if (lower.includes('month')) return <CalendarRange className="h-3 w-3" />;
    if (lower.includes('daily') || lower.includes('hour')) return <Clock className="h-3 w-3" />;
    if (lower.includes('premium')) return <Award className="h-3 w-3" />;
    return null;
  };

  // Calculate budget percentage
  const budgetPercent = budgetInfo && budgetInfo.enabled && budgetInfo.dailyAllowance > 0
    ? (budgetInfo.usedToday / budgetInfo.dailyAllowance) * 100
    : 0;

  return (
    <div className="quota-popover-overlay">
      <div ref={popoverRef} className="quota-popover">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-oc-border">
          <div className="flex items-center gap-2">
            <div className="text-oc-sm font-semibold tracking-tight text-[var(--oc-text-soft)]">
              Quota Status
            </div>
            <div className="text-[10px] text-[var(--oc-text-soft)] opacity-70 font-mono">
              {quotaIsRefreshing ? 'Refreshing...' : `Updated ${formatLastUpdated()}`}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost-accent"
              size="sm"
              className="h-6 px-2 text-xs font-mono"
              title="Refresh quota"
              aria-label="Refresh quota"
              disabled={quotaIsRefreshing}
              onClick={handleRefresh}
            >
              <RefreshCw
                className={`h-3 w-3 ${quotaIsRefreshing ? 'animate-spin' : ''}`}
              />
            </Button>
            <button
              className="text-[var(--oc-text-soft)] opacity-80 hover:text-oc-accent transition-colors p-1"
              onClick={() => dispatch({ type: 'SET_QUOTA_POPOVER_OPEN', payload: false })}
              aria-label="Close popover"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-3 space-y-3">
          {/* Loading state */}
          {quotaIsRefreshing && !quotaData && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-md bg-oc-border opacity-40"
                />
              ))}
            </div>
          )}

          {/* GitHub Copilot Budget Info */}
          {budgetInfo && budgetInfo.enabled && !quotaIsRefreshing && (
            <div className="overflow-hidden rounded-xl border border-oc-border bg-[var(--oc-panel-soft)]/40 shadow-sm">
              {/* Header */}
              <div className="border-b border-oc-border/50 px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-oc-accent/10 text-oc-accent">
                    <Zap className="h-3 w-3 fill-current" />
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--oc-text-soft)]">
                    Daily Budget
                  </span>
                </div>
                {budgetInfo.warningLevel !== 'ok' && (
                  <Badge
                    variant={budgetInfo.warningLevel === 'critical' ? 'destructive' : 'warning'}
                    className={`font-mono text-[10px] uppercase h-5 px-1.5 border-none ${
                      budgetInfo.warningLevel === 'critical'
                        ? 'bg-oc-red/10 text-oc-red'
                        : 'bg-oc-yellow/10 text-oc-yellow'
                    }`}
                  >
                    {budgetInfo.warningLevel === 'critical' ? 'Critical' : 'Warning'}
                  </Badge>
                )}
              </div>

              {/* Budget Content */}
              <div className="px-3 py-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--oc-text-soft)]">
                    Used Today
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[var(--oc-text-soft)]">
                      {budgetInfo.usedToday} / {budgetInfo.dailyAllowance}
                    </span>
                    <span className="font-mono text-xs text-[var(--oc-text-soft)]">
                      {Math.round(budgetPercent)}%
                    </span>
                  </div>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-oc-border">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, budgetPercent)}%`,
                      background: barColor(budgetPercent),
                    }}
                  />
                </div>
                <div className="mt-1.5 space-y-0.5 text-xs text-[var(--oc-text-soft)] opacity-70">
                  <div className="flex items-center justify-between gap-2">
                    <span>Remaining today</span>
                    <span className="font-mono text-[var(--oc-text-soft)]">
                      {budgetInfo.remainingToday}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Platform Cards */}
          {!quotaIsRefreshing && quotaData?.platforms?.map((platform) => (
            <div
              key={`${platform.platform}-${platform.account}`}
              className="overflow-hidden rounded-xl border border-oc-border bg-[linear-gradient(180deg,var(--oc-panel)_0%,var(--oc-panel-soft)_100%)] shadow-[0_6px_20px_rgba(0,0,0,0.2)]"
            >
              {/* Platform Header */}
              <div className="border-b border-oc-border px-3 py-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-oc-sm font-semibold tracking-tight text-[var(--oc-text-soft)]">
                    {toProviderName(platform.platform, platform.title)}
                  </span>
                  {platform.status === 'error' ? (
                    <Badge variant="destructive" className="text-xs uppercase">
                      error
                    </Badge>
                  ) : platform.status === 'warning' ? (
                    <Badge variant="warning" className="text-[#d29922] text-xs uppercase">
                      warning
                    </Badge>
                  ) : null}
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                  <span className="font-mono uppercase tracking-wider text-[var(--oc-text-soft)] opacity-80">
                    Account:
                  </span>
                  <span className="truncate font-mono text-[var(--oc-text-soft)]">
                    {platform.account} {platform.accountLabel ?? ''}
                  </span>
                </div>
              </div>

              {/* Quota Items */}
              <div className="space-y-2.5 px-3 py-2.5">
                {platform.error ? (
                  <div className="rounded-md border border-oc-red/40 bg-oc-red/10 px-2.5 py-2 text-oc-red">
                    {platform.error.length > 130
                      ? `${platform.error.slice(0, 127)}...`
                      : platform.error}
                  </div>
                ) : (
                  platform.quotas.map((quota) => {
                    const pct = Math.max(0, Math.min(100, quota.remainPercent));

                    return (
                      <div
                        key={quota.label}
                        className="rounded-lg border border-oc-border bg-[rgba(0,0,0,0.16)] p-2"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {getQuotaIcon(quota.label)}
                            <span className="text-xs font-medium text-[var(--oc-text-soft)]">
                              {quota.label}
                            </span>
                          </div>
                          <span className="font-mono text-xs text-[var(--oc-text-soft)]">
                            {quota.percentLabel ?? `${Math.round(pct)}% remaining`}
                          </span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-oc-border">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${pct}%`,
                              background: barColor(pct),
                            }}
                          />
                        </div>

                        <div className="mt-2 space-y-0.5 text-xs text-[var(--oc-text-soft)] opacity-70">
                          {quota.usedTotalDisplay ? (
                            <div className="flex items-center justify-between gap-2">
                              <span>Used</span>
                              <span className="font-mono text-[var(--oc-text-soft)]">
                                {quota.usedTotalDisplay}
                              </span>
                            </div>
                          ) : null}
                          {quota.resetLabel ? (
                            <div className="flex items-center justify-between gap-2">
                              <span>Resets in</span>
                              <span className="font-mono text-[var(--oc-text-soft)]">
                                {quota.resetLabel}
                              </span>
                            </div>
                          ) : null}
                          {quota.note ? (
                            <div className="flex gap-2 mt-1.5 pt-1.5 border-t border-oc-border opacity-80">
                              <span className="text-[var(--oc-text-soft)] italic">
                                {quota.note}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}

          {/* Empty state */}
          {!quotaIsRefreshing && (!budgetInfo || !budgetInfo.enabled) && (!quotaData?.platforms || quotaData.platforms.length === 0) && (
            <div className="py-4 text-center text-[var(--oc-text-soft)] opacity-60 text-xs">
              No quota data available.
              <br />
              Configure providers in settings.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-oc-border text-[10px] text-center text-[var(--oc-text-soft)] opacity-70 font-mono">
          <span>◆</span>
        </div>
      </div>
    </div>
  );
}
