#!/usr/bin/env node

/**
 * Log analysis CLI tool
 */

import { LogQuery } from '../src/utils/LogQuery.ts';
import { parseArgs } from 'node:util';

const args = parseArgs({
  options: {
    category: { type: 'string' },
    session: { type: 'string' },
    correlation: { type: 'string' },
    summary: { type: 'boolean', default: false },
    flows: { type: 'boolean', default: false },
    errors: { type: 'boolean', default: false },
    performance: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const logFilePath = args.positionals[0];
if (!logFilePath) {
  console.error('Usage: node scripts/analyze-logs.ts <log-file-path> [options]');
  process.exit(1);
}

async function main() {
  const logs = await LogQuery.loadLogFile(logFilePath);

  // Apply filters
  let filteredLogs = logs;
  if (args.values.category) {
    filteredLogs = LogQuery.filterByCategory(filteredLogs, args.values.category);
  }
  if (args.values.session) {
    // Session filtering would be implemented based on session ID context
    filteredLogs = filteredLogs.filter(log => log.context?.sessionId === args.values.session);
  }
  if (args.values.correlation) {
    filteredLogs = LogQuery.filterByCorrelationId(filteredLogs, args.values.correlation);
  }
  if (args.values.errors) {
    filteredLogs = LogQuery.filterByLevel(filteredLogs, 'error');
  }

  // Show summary
  if (args.values.summary || !args.values.flows && !args.values.performance) {
    const summary = LogQuery.generateDebugSummary(filteredLogs);
    console.log('\n=== LOG SUMMARY ===');
    console.log(`Total logs: ${summary.totalLogs}`);
    console.log(`Errors: ${summary.errorCount}`);
    console.log(`Feature flows: ${summary.featureFlowCount}`);
    console.log(`State changes: ${summary.stateChangeCount}`);
    console.log(`UI interactions: ${summary.uiInteractionCount}`);
    console.log(`Performance issues: ${summary.performanceIssues}`);
    console.log('\nLogs by level:');
    Object.entries(summary.logsByLevel).forEach(([level, count]) => {
      console.log(`  ${level}: ${count}`);
    });
    console.log('\nLogs by category:');
    Object.entries(summary.logsByCategory).forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });
  }

  // Show feature flows
  if (args.values.flows) {
    const flows = LogQuery.extractFeatureFlows(filteredLogs);
    console.log('\n=== FEATURE FLOWS ===');
    flows.forEach(flow => {
      console.log(`\n${flow.featureName} (${flow.correlationId})`);
      console.log(`  Started: ${flow.startTime}`);
      if (flow.endTime) {
        console.log(`  Ended: ${flow.endTime}`);
        console.log(`  Duration: ${flow.duration}ms`);
      }
      console.log(`  Steps: ${flow.steps.length}`);
    });
  }

  // Show performance
  if (args.values.performance) {
    const stats = LogQuery.calculatePerformanceStats(filteredLogs);
    console.log('\n=== PERFORMANCE ===');
    console.log(`\nSlow operations (>3s): ${stats.slowOperations.length}`);
    stats.slowOperations.slice(0, 10).forEach(op => {
      console.log(`  ${op.operation}: ${op.duration}ms at ${op.timestamp}`);
    });
    console.log('\nAverage durations:');
    stats.averageDurations.forEach((avg, operation) => {
      console.log(`  ${operation}: ${avg.toFixed(2)}ms`);
    });
  }
}

main().catch(console.error);
