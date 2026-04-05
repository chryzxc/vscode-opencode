/**
 * Log query and analysis utilities
 *
 * Provides tools for parsing, filtering, and analyzing structured logs
 * for debugging and performance analysis.
 */

import * as fs from 'fs/promises';

export interface LogEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export class LogQuery {
  /**
   * Parse a single log line from JSON format
   */
  static parseLine(line: string): LogEntry | null {
    try {
      const trimmed = line.trim();
      if (!trimmed) return null;

      return JSON.parse(trimmed) as LogEntry;
    } catch {
      return null;
    }
  }

  /**
   * Load and parse log file
   */
  static async loadLogFile(filePath: string): Promise<LogEntry[]> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    return lines
      .map(line => this.parseLine(line))
      .filter((entry): entry is LogEntry => entry !== null);
  }

  /**
   * Filter logs by category
   */
  static filterByCategory(logs: LogEntry[], category: string): LogEntry[] {
    return logs.filter(log => log.category === category);
  }

  /**
   * Filter logs by level
   */
  static filterByLevel(logs: LogEntry[], level: string): LogEntry[] {
    return logs.filter(log => log.level === level);
  }

  /**
   * Filter logs by correlation ID
   */
  static filterByCorrelationId(logs: LogEntry[], correlationId: string): LogEntry[] {
    return logs.filter(log => log.context?.correlationId === correlationId);
  }

  /**
   * Extract feature flows from logs
   */
  static extractFeatureFlows(logs: LogEntry[]): Array<{
    correlationId: string;
    featureName: string;
    startTime: string;
    endTime?: string;
    duration?: number;
    steps: LogEntry[];
  }> {
    const flows = new Map<string, {
      featureName: string;
      startTime: string;
      endTime?: string;
      duration?: number;
      steps: LogEntry[];
    }>();

    logs.forEach(log => {
      const correlationId = log.context?.correlationId as string | undefined;
      if (!correlationId) return;

      if (log.message.includes('Feature started:')) {
        const featureName = log.message.replace('Feature started: ', '');
        flows.set(correlationId, {
          featureName,
          startTime: log.timestamp,
          steps: [],
        });
      }

      if (log.message.includes('Feature step:')) {
        const flow = flows.get(correlationId);
        if (flow) {
          flow.steps.push(log);
        }
      }

      if (log.message.includes('Feature ended:')) {
        const flow = flows.get(correlationId);
        if (flow) {
          const endTime = log.timestamp;
          const duration = new Date(endTime).getTime() - new Date(flow.startTime).getTime();
          flows.set(correlationId, { ...flow, endTime, duration: duration as unknown as number });
        }
      }
    });

    return Array.from(flows.entries()).map(([correlationId, flow]) => ({
      correlationId,
      ...flow,
    }));
  }

  /**
   * Extract state changes from logs
   */
  static extractStateChanges(logs: LogEntry[]): Array<{
    stateKey: string;
    oldValue: unknown;
    newValue: unknown;
    changedBy: string;
    timestamp: string;
  }> {
    return logs
      .filter(log => log.message.includes('State changed:'))
      .map(log => ({
        stateKey: log.context?.stateKey as string,
        oldValue: log.context?.oldValue,
        newValue: log.context?.newValue,
        changedBy: log.context?.changedBy as string,
        timestamp: log.timestamp,
      }));
  }

  /**
   * Extract UI interactions from logs
   */
  static extractUIInteractions(logs: LogEntry[]): Array<{
    component: string;
    action: string;
    element?: string;
    timestamp: string;
  }> {
    return logs
      .filter(log => log.message.includes('UI interaction:'))
      .map(log => ({
        component: log.context?.component as string,
        action: log.context?.action as string,
        element: log.context?.element as string,
        timestamp: log.timestamp,
      }));
  }

  /**
   * Calculate performance statistics
   */
  static calculatePerformanceStats(logs: LogEntry[]): {
    slowOperations: Array<{
      operation: string;
      duration: number;
      timestamp: string;
    }>;
    averageDurations: Map<string, number>;
  } {
    const perfLogs = logs.filter(log => log.message.includes('Performance:'));

    const slowOperations: Array<{
      operation: string;
      duration: number;
      timestamp: string;
    }> = [];

    const durationsByOperation = new Map<string, number[]>();

    perfLogs.forEach(log => {
      const operation = log.context?.operation as string;
      const duration = log.context?.duration as number;
      const timestamp = log.timestamp;

      if (operation && typeof duration === 'number') {
        if (duration > 3000) {
          slowOperations.push({ operation, duration, timestamp });
        }

        if (!durationsByOperation.has(operation)) {
          durationsByOperation.set(operation, []);
        }
        durationsByOperation.get(operation)!.push(duration);
      }
    });

    const averageDurations = new Map<string, number>();
    durationsByOperation.forEach((durations, operation) => {
      const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      averageDurations.set(operation, avg);
    });

    return { slowOperations, averageDurations };
  }

  /**
   * Generate debug summary
   */
  static generateDebugSummary(logs: LogEntry[]): {
    totalLogs: number;
    logsByLevel: Record<string, number>;
    logsByCategory: Record<string, number>;
    errorCount: number;
    featureFlowCount: number;
    stateChangeCount: number;
    uiInteractionCount: number;
    performanceIssues: number;
  } {
    const logsByLevel: Record<string, number> = {};
    const logsByCategory: Record<string, number> = {};

    logs.forEach(log => {
      logsByLevel[log.level] = (logsByLevel[log.level] || 0) + 1;
      logsByCategory[log.category] = (logsByCategory[log.category] || 0) + 1;
    });

    const errorCount = logs.filter(log => log.level === 'error').length;
    const featureFlows = this.extractFeatureFlows(logs);
    const stateChanges = this.extractStateChanges(logs);
    const uiInteractions = this.extractUIInteractions(logs);
    const { slowOperations } = this.calculatePerformanceStats(logs);

    return {
      totalLogs: logs.length,
      logsByLevel,
      logsByCategory,
      errorCount,
      featureFlowCount: featureFlows.length,
      stateChangeCount: stateChanges.length,
      uiInteractionCount: uiInteractions.length,
      performanceIssues: slowOperations.length,
    };
  }
}
