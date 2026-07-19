/**
 * Performance Tests for GeminiTokenUsageTracker
 *
 * These tests verify the performance optimizations made to prevent UI lag:
 * 1. Async file I/O (fs.promises instead of fs.sync)
 * 2. Debouncing (1 second delay to reduce write frequency)
 * 3. Fire-and-forget pattern (recordUsage doesn't block)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const trackerSource = readSource(
  [joinFromRoot('src', 'services', 'GeminiTokenUsageTracker.ts')],
  'GeminiTokenUsageTracker.ts',
);

test('GeminiTokenUsageTracker uses async file I/O to prevent blocking', () => {
  // Verify fs/promises import instead of fs
  assert.match(trackerSource, /import\s+\*\s+as\s+fs\s+from\s+["']fs\/promises["']/,
    'GeminiTokenUsageTracker should import fs/promises for async file operations');
  assert.doesNotMatch(trackerSource, /from\s+["']fs["'](?!\s*\/)/,
    'GeminiTokenUsageTracker should NOT import synchronous fs module');

  // Verify async readStorage function
  assert.match(trackerSource, /async\s+function\s+readStorage\(\):\s*Promise<DailyUsageSnapshot\s*\|\s*null>/,
    'readStorage should be async and return Promise');
  const readBody = extractFunctionBody(trackerSource, 'async function readStorage(): Promise<DailyUsageSnapshot | null>');
  assert.match(readBody, /await\s+fs\.readFile\(/,
    'readStorage should use fs.readFile (async) instead of fs.readFileSync');
  assert.doesNotMatch(readBody, /fs\.readFileSync\(/,
    'readStorage should NOT use readFileSync');

  // Verify async writeStorage function
  assert.match(trackerSource, /async\s+function\s+writeStorage\(/,
    'writeStorage should be async function');
  const writeBody = extractFunctionBody(trackerSource, 'async function writeStorage(');
  assert.match(writeBody, /await\s+fs\.writeFile\(/,
    'writeStorage should use fs.writeFile (async) instead of fs.writeFileSync');
  assert.doesNotMatch(writeBody, /fs\.writeFileSync\(/,
    'writeStorage should NOT use writeFileSync');

  // Verify async ensureStorageDir
  assert.match(trackerSource, /async\s+function\s+ensureStorageDir\(\):\s*Promise<void>/,
    'ensureStorageDir should be async and return Promise<void>');
  const ensureDirBody = extractFunctionBody(trackerSource, 'async function ensureStorageDir(): Promise<void>');
  assert.match(ensureDirBody, /await\s+fs\.mkdir\(/,
    'ensureStorageDir should use fs.mkdir (async)');
  assert.doesNotMatch(ensureDirBody, /fs\.mkdirSync\(/,
    'ensureStorageDir should NOT use mkdirSync');
});

test('GeminiTokenUsageTracker implements debouncing to reduce write frequency', () => {
  // Verify debouncing fields
  assert.match(trackerSource, /private\s+saveTimer:\s*NodeJS\.Timeout\s*\|\s*null/,
    'GeminiTokenUsageTracker should have saveTimer field for debouncing');
  assert.match(trackerSource, /private\s+pendingSave\s*=\s*false/,
    'GeminiTokenUsageTracker should have pendingSave flag to track pending writes');

  // Verify scheduleSave method exists
  assert.match(trackerSource, /private\s+scheduleSave\(\):\s*void/,
    'GeminiTokenUsageTracker should expose scheduleSave method for debounced saves');

  // Verify scheduleSave implements debouncing logic
  const scheduleBody = extractFunctionBody(trackerSource, 'private scheduleSave(): void');
  assert.match(scheduleBody, /if\s*\(this\.saveTimer\)\s*\{[\s\S]*clearTimeout\(this\.saveTimer\)/,
    'scheduleSave should clear existing timer (debounce pattern)');
  assert.match(scheduleBody, /this\.saveTimer\s*=\s*setTimeout\(/,
    'scheduleSave should set new timeout');
  assert.match(scheduleBody, /1000/,
    'scheduleSave should use 1 second (1000ms) debounce delay');
  assert.match(scheduleBody, /this\.saveToStorage\(\)\.catch\(/,
    'scheduleSave should call saveToStorage asynchronously with error handling');
  assert.match(scheduleBody, /this\.pendingSave\s*=\s*false/,
    'scheduleSave should reset pendingSave flag after scheduling');

  // Verify recordUsage calls scheduleSave instead of direct save
  const recordBody = extractFunctionBody(trackerSource, 'public recordUsage(model: string, tokens: TokenUsage): void');
  assert.match(recordBody, /this\.scheduleSave\(\)/,
    'recordUsage should call scheduleSave for debounced writes');
  assert.doesNotMatch(recordBody, /this\.saveToStorage\(\)/,
    'recordUsage should NOT directly call saveToStorage (should use debounced version)');

  // Verify dispose cleans up timer
  const disposeBody = extractFunctionBody(trackerSource, 'public dispose(): void');
  assert.match(disposeBody, /if\s*\(this\.saveTimer\)\s*\{[\s\S]*clearTimeout\(this\.saveTimer\)/,
    'dispose should clear pending save timer');
});

test('GeminiTokenUsageTracker implements fire-and-forget pattern', () => {
  // Verify recordUsage is not async (doesn't block caller)
  assert.match(trackerSource, /public\s+recordUsage\(model:\s*string,\s*tokens:\s*TokenUsage\):\s*void/,
    'recordUsage should return void (not Promise) - fire-and-forget pattern');

  // Verify recordUsage doesn't await anything
  const recordBody = extractFunctionBody(trackerSource, 'public recordUsage(model: string, tokens: TokenUsage): void');
  assert.doesNotMatch(recordBody, /await\s+this\.scheduleSave\(\)/,
    'recordUsage should NOT await scheduleSave (fire-and-forget)');
  assert.doesNotMatch(recordBody, /await\s+this\.saveToStorage\(\)/,
    'recordUsage should NOT await saveToStorage');

  // Emissions are debounced through scheduleUsageEmit so rapid token events
  // coalesce into a single usageUpdated emit. Synchronous emit on every token
  // caused per-event sort + listener fan-out.
  assert.match(recordBody, /this\.scheduleUsageEmit\(\)/,
    'recordUsage should delegate emission to scheduleUsageEmit (debounced)');

  // Verify saveToStorage is async but not awaited
  assert.match(trackerSource, /private\s+async\s+saveToStorage\(\):\s*Promise<void>/,
    'saveToStorage should be async but called without await');
});

test('GeminiTokenUsageTracker maintains data integrity with async saves', () => {
  // Verify in-memory update happens immediately
  const recordBody = extractFunctionBody(trackerSource, 'public recordUsage(model: string, tokens: TokenUsage): void');

  // Check that usage is accumulated before save is scheduled
  assert.match(recordBody, /usage\.totalInput\s*\+=\s*tokens\.input/,
    'recordUsage should accumulate input tokens in memory');
  assert.match(recordBody, /usage\.totalOutput\s*\+=\s*tokens\.output/,
    'recordUsage should accumulate output tokens in memory');
  assert.match(recordBody, /usage\.totalReasoning\s*\+=\s*tokens\.reasoning/,
    'recordUsage should accumulate reasoning tokens in memory');
  assert.match(recordBody, /usage\.grandTotal\s*=/,
    'recordUsage should calculate grandTotal in memory');
  assert.match(recordBody, /this\.currentUsage\[model\]\s*=\s*usage/,
    'recordUsage should update in-memory state before scheduling save');

  // Verify getAllUsage reads from memory (not disk)
  assert.match(trackerSource, /public\s+getAllUsage\(\):\s*ModelTokenUsage\[\]/,
    'getAllUsage should be synchronous (reads from memory)');
  const getAllBody = extractFunctionBody(trackerSource, 'public getAllUsage(): ModelTokenUsage[]');
  assert.match(getAllBody, /return\s+Object\.values\(this\.currentUsage\)/,
    'getAllUsage should return values from in-memory currentUsage');
  assert.doesNotMatch(getAllBody, /await/,
    'getAllUsage should NOT have any await operations (synchronous)');
});

test('GeminiTokenUsageTracker handles async initialization', () => {
  // Verify constructor calls async initialization
  const constructorBody = extractFunctionBody(trackerSource, 'constructor()');
  assert.match(constructorBody, /this\.initialize\(\)/,
    'constructor should call async initialize method');

  // Verify initialize method exists and is async
  assert.match(trackerSource, /private\s+async\s+initialize\(\):\s*Promise<void>/,
    'GeminiTokenUsageTracker should have async initialize method');

  // Verify initialize loads data
  const initBody = extractFunctionBody(trackerSource, 'private async initialize(): Promise<void>');
  assert.match(initBody, /await\s+this\.loadFromStorage\(\)/,
    'initialize should await loadFromStorage');
  assert.match(initBody, /this\.checkDailyReset\(\)/,
    'initialize should call checkDailyReset');

  // Verify loadFromStorage is async
  assert.match(trackerSource, /private\s+async\s+loadFromStorage\(\):\s*Promise<void>/,
    'loadFromStorage should be async method');
});

test('GeminiTokenUsageTracker uses debouncing for reset operation', () => {
  // Verify reset method uses debounced save
  const resetBody = extractFunctionBody(trackerSource, 'public reset(): void');
  assert.match(resetBody, /this\.scheduleSave\(\)/,
    'reset should use scheduleSave (debounced) instead of direct save');
  assert.doesNotMatch(resetBody, /await\s+this\.saveToStorage\(\)/,
    'reset should NOT directly await saveToStorage');
});

test('GeminiTokenUsageTracker properly handles disposal with pending saves', () => {
  const disposeBody = extractFunctionBody(trackerSource, 'public dispose(): void');

  // Verify dispose checks for pending saves
  assert.match(disposeBody, /if\s*\(this\.pendingSave\)/,
    'dispose should check if there are pending saves');

  // Verify dispose performs final save if needed (fire-and-forget)
  assert.match(disposeBody, /this\.saveToStorage\(\)\.catch\(/,
    'dispose should call saveToStorage if pending (fire-and-forget with error handling)');

  // Verify dispose doesn't await the final save
  assert.doesNotMatch(disposeBody, /await\s+this\.saveToStorage\(\)/,
    'dispose should NOT await saveToStorage (fire-and-forget)');
});

test('GeminiTokenUsageTracker performance optimization summary', () => {
  // Verify all key performance patterns are present
  assert.match(trackerSource, /from\s+["']fs\/promises["']/,
    '✓ Uses fs/promises for async I/O');
  assert.match(trackerSource, /private\s+scheduleSave\(\):\s*void/,
    '✓ Implements debouncing via scheduleSave');
  assert.match(trackerSource, /private\s+saveTimer:\s*NodeJS\.Timeout\s*\|\s*null/,
    '✓ Has timer for debouncing');
  assert.match(trackerSource, /1000/,
    '✓ Uses 1-second debounce delay');
  assert.match(trackerSource, /public\s+recordUsage\([^)]*\):\s*void/,
    '✓ recordUsage returns void (fire-and-forget)');
  assert.match(trackerSource, /private\s+async\s+saveToStorage\(\):\s*Promise<void>/,
    '✓ saveToStorage is async (non-blocking)');
});
