import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts')],
  'CompactionManager.ts',
);

test('CompactionManager derives storage keys and normalizes numeric baseline stats', () => {
  const keyBody = extractFunctionBody(
    source,
    'getCompactionViewStateStorageKey(sessionId: string): string {',
  );
  const baselineBody = extractFunctionBody(
    source,
    'normalizeCompactionBaselineStats(',
  );

  assert.match(
    source,
    /private static readonly COMPACTION_VIEW_STATE_PREFIX\s*=\s*"opencode\.session\.compaction-view\.";/,
    'CompactionManager should define a dedicated prefix for persisted compaction view state',
  );
  assert.match(
    keyBody,
    /return `\$\{CompactionManager\.COMPACTION_VIEW_STATE_PREFIX\}\$\{sessionId\}`;/,
    'getCompactionViewStateStorageKey should append the session id to the compaction prefix',
  );
  assert.match(
    baselineBody,
    /const normalize = \(raw: unknown\): number \| undefined =>[\s\S]*typeof raw === "number" && Number\.isFinite\(raw\) && raw >= 0[\s\S]*Math\.floor\(raw\)/,
    'normalizeCompactionBaselineStats should accept only finite non-negative numbers and floor them',
  );
  assert.match(
    baselineBody,
    /const input = normalize\(rec\.input\);[\s\S]*const output = normalize\(rec\.output\);[\s\S]*const read = normalize\(rec\.read\);[\s\S]*const write = normalize\(rec\.write\);[\s\S]*const duration = normalize\(rec\.duration\);/,
    'normalizeCompactionBaselineStats should normalize all baseline stat fields individually',
  );
  assert.match(
    baselineBody,
    /if \([\s\S]*input === undefined[\s\S]*output === undefined[\s\S]*read === undefined[\s\S]*write === undefined[\s\S]*duration === undefined[\s\S]*\) \{[\s\S]*return undefined;/,
    'normalizeCompactionBaselineStats should return undefined when no valid baseline stats remain',
  );
  assert.match(
    baselineBody,
    /return \{[\s\S]*input: input \?\? 0,[\s\S]*output: output \?\? 0,[\s\S]*read: read \?\? 0,[\s\S]*write: write \?\? 0,[\s\S]*duration: duration \?\? 0,[\s\S]*\};/,
    'normalizeCompactionBaselineStats should default omitted normalized values to zero in the returned stats object',
  );
});

test('CompactionManager normalizes persisted view state and persists it through workspaceState', () => {
  const normalizeStateBody = extractFunctionBody(
    source,
    'normalizeCompactionViewState(',
  );
  const loadBody = extractFunctionBody(
    source,
    'async loadPersistedCompactionViewState(',
  );
  const saveBody = extractFunctionBody(
    source,
    'async savePersistedCompactionViewState(',
  );
  const clearBody = extractFunctionBody(
    source,
    'async clearPersistedCompactionViewState(',
  );

  assert.match(
    normalizeStateBody,
    /const rec = this\.asRecord\(value\);[\s\S]*if \(!rec\) \{[\s\S]*return null;/,
    'normalizeCompactionViewState should reject non-record persisted state values',
  );
  assert.match(
    normalizeStateBody,
    /if \([\s\S]*typeof rec\.lastCompactedAt === "number"[\s\S]*rec\.lastCompactedAt > 0[\s\S]*\) \{[\s\S]*next\.lastCompactedAt = Math\.floor\(rec\.lastCompactedAt\);/,
    'normalizeCompactionViewState should preserve only positive numeric lastCompactedAt values',
  );
  assert.match(
    normalizeStateBody,
    /const baselineStats = this\.normalizeCompactionBaselineStats\([\s\S]*rec\.baselineStats,[\s\S]*\);[\s\S]*if \(baselineStats\) \{[\s\S]*next\.baselineStats = baselineStats;/,
    'normalizeCompactionViewState should reuse baseline stat normalization for persisted baseline data',
  );
  assert.match(
    normalizeStateBody,
    /const dividerBeforeMessageId = this\.firstNonEmptyString\([\s\S]*rec\.compactionDividerBeforeMessageId,[\s\S]*\);[\s\S]*const dividerAfterMessageId = this\.firstNonEmptyString\([\s\S]*rec\.compactionDividerAfterMessageId,[\s\S]*\);/,
    'normalizeCompactionViewState should normalize divider message ids through firstNonEmptyString',
  );
  assert.match(
    normalizeStateBody,
    /if \(typeof rec\.collapsed === "boolean"\) \{[\s\S]*next\.collapsed = rec\.collapsed;/,
    'normalizeCompactionViewState should preserve an explicit collapsed boolean',
  );
  assert.match(
    normalizeStateBody,
    /return Object\.keys\(next\)\.length > 0 \? next : null;/,
    'normalizeCompactionViewState should return null for empty normalized state objects',
  );
  assert.match(
    loadBody,
    /const raw = this\.workspaceState\.get<unknown>\([\s\S]*this\.getCompactionViewStateStorageKey\(sessionId\)/,
    'loadPersistedCompactionViewState should read persisted state by the session-specific storage key',
  );
  assert.match(
    saveBody,
    /await this\.workspaceState\.update\([\s\S]*this\.getCompactionViewStateStorageKey\(sessionId\),[\s\S]*state,[\s\S]*\);/,
    'savePersistedCompactionViewState should persist normalized state via workspaceState.update',
  );
  assert.match(
    clearBody,
    /await this\.workspaceState\.update\([\s\S]*this\.getCompactionViewStateStorageKey\(sessionId\),[\s\S]*undefined,[\s\S]*\);/,
    'clearPersistedCompactionViewState should clear persisted view state with undefined',
  );
});

test('CompactionManager posts and republishes persisted compaction view state to the webview', () => {
  const postViewStateBody = extractFunctionBody(
    source,
    'postCompactionViewState(',
  );
  const sendPersistedBody = extractFunctionBody(
    source,
    'async sendPersistedCompactionViewState(',
  );
  const persistPublishBody = extractFunctionBody(
    source,
    'async persistAndPublishCompactionViewState(',
  );
  const postStatusBody = extractFunctionBody(
    source,
    'postCompactionStatus(payload: {\n    sessionId: string;\n    status: string;\n    error?: string;\n    compacted?: boolean;\n    baselineStats?: CompactionBaselineStats;\n    compactionDividerBeforeMessageId?: string;\n    compactionDividerAfterMessageId?: string;\n  }): void {',
  );

  assert.match(
    postViewStateBody,
    /this\.postMessage\(\{[\s\S]*type: "compactionViewState",[\s\S]*sessionId,[\s\S]*\.\.\.state,[\s\S]*\}\);/,
    'postCompactionViewState should forward the current session state payload to the webview',
  );
  assert.match(
    sendPersistedBody,
    /const state = await this\.loadPersistedCompactionViewState\(sessionId\);[\s\S]*if \(!state\) \{[\s\S]*return;[\s\S]*this\.postCompactionViewState\(sessionId, state\);/,
    'sendPersistedCompactionViewState should only post state when persisted data exists',
  );
  assert.match(
    persistPublishBody,
    /await this\.savePersistedCompactionViewState\(sessionId, state\);[\s\S]*this\.postCompactionViewState\(sessionId, state\);/,
    'persistAndPublishCompactionViewState should save state before posting it back to the webview',
  );
  assert.match(
    postStatusBody,
    /this\.postMessage\(\{[\s\S]*type: "compactionStatus",[\s\S]*\.\.\.payload,[\s\S]*\}\);/,
    'postCompactionStatus should wrap compaction status updates in a compactionStatus webview message',
  );
});

test('CompactionManager updates persisted view state and stream-forwarded status payloads', () => {
  const handleSetBody = extractFunctionBody(
    source,
    'async handleSetCompactionViewState(message: {\n    sessionId: string;\n    collapsed?: boolean;\n    compactionDividerIndex?: number;\n    compactionDividerBeforeMessageId?: string;\n    compactionDividerAfterMessageId?: string;\n  }): Promise<void> {',
  );
  const forwardBody = extractFunctionBody(
    source,
    'forwardCompactionStatusFromStreamEvent(event: unknown): void {',
  );

  assert.match(
    handleSetBody,
    /const state = await this\.loadPersistedCompactionViewState\(sessionId\);[\s\S]*if \(!state\) \{[\s\S]*return;/,
    'handleSetCompactionViewState should no-op when there is no persisted compaction state yet',
  );
  assert.match(
    handleSetBody,
    /state\.collapsed = collapsed;/,
    'handleSetCompactionViewState should update the collapsed state directly from the message payload',
  );
  assert.match(
    handleSetBody,
    /if \([\s\S]*typeof message\.compactionDividerIndex === "number"[\s\S]*message\.compactionDividerIndex >= 0[\s\S]*\) \{[\s\S]*state\.compactionDividerIndex = Math\.floor\(message\.compactionDividerIndex\);/,
    'handleSetCompactionViewState should normalize and persist non-negative divider indexes',
  );
  assert.match(
    handleSetBody,
    /const dividerBefore = this\.firstNonEmptyString\([\s\S]*message\.compactionDividerBeforeMessageId,[\s\S]*\);[\s\S]*const dividerAfter = this\.firstNonEmptyString\([\s\S]*message\.compactionDividerAfterMessageId,[\s\S]*\);/,
    'handleSetCompactionViewState should normalize before/after divider message ids from incoming messages',
  );
  assert.match(
    handleSetBody,
    /await this\.persistAndPublishCompactionViewState\(sessionId, state\);/,
    'handleSetCompactionViewState should persist and immediately republish the updated view state',
  );
  assert.match(
    forwardBody,
    /const sessionId = this\.firstNonEmptyString\([\s\S]*rec\.sessionId,[\s\S]*rec\.sessionID,[\s\S]*\);[\s\S]*if \(!sessionId\) return;/,
    'forwardCompactionStatusFromStreamEvent should resolve session ids from either sessionId or sessionID fields',
  );
  assert.match(
    forwardBody,
    /const normalizedStatus = status === "completed" \? "done" : status;/,
    'forwardCompactionStatusFromStreamEvent should normalize completed stream statuses to done',
  );
  assert.match(
    forwardBody,
    /if \([\s\S]*!normalizedStatus[\s\S]*!compacted[\s\S]*!error[\s\S]*!baselineStats[\s\S]*!compactionDividerBeforeMessageId[\s\S]*!compactionDividerAfterMessageId[\s\S]*\) \{[\s\S]*return;/,
    'forwardCompactionStatusFromStreamEvent should ignore empty stream events that contain no compaction signal',
  );
  assert.match(
    forwardBody,
    /this\.postCompactionStatus\(\{[\s\S]*sessionId,[\s\S]*status: normalizedStatus \|\| "unknown",[\s\S]*compacted,[\s\S]*error,[\s\S]*baselineStats,[\s\S]*compactionDividerBeforeMessageId,[\s\S]*compactionDividerAfterMessageId,[\s\S]*\}\);/,
    'forwardCompactionStatusFromStreamEvent should forward normalized compaction status payloads to the webview',
  );
});

test('CompactionManager auto-compacts above threshold and guards the compaction flow lifecycle', () => {
  const autoBody = extractFunctionBody(
    source,
    'async maybeAutoCompact(',
  );
  const handleCompactBody = extractFunctionBody(
    source,
    'async handleCompactSession(',
  );

  assert.match(
    autoBody,
    /const inputTokens = this\.extractSdkContextInputTokens\(responseData\);[\s\S]*if \(inputTokens === undefined\) \{[\s\S]*return;/,
    'maybeAutoCompact should use SDK assistant input token snapshots',
  );
  assert.match(
    autoBody,
    /const contextLimit = this\.getSelectedModelContextLimit\(\);[\s\S]*if \(!contextLimit\) \{[\s\S]*return;/,
    'maybeAutoCompact should require a selected model context limit before compacting',
  );
  assert.match(
    autoBody,
    /const thresholdRatioRaw = config\.get<number>\("autoCompactThreshold", 0\.9\);[\s\S]*const thresholdRatio =[\s\S]*: 0\.9;/,
    'maybeAutoCompact should use the configured SDK-token threshold ratio',
  );
  assert.match(
    autoBody,
    /const threshold = Math\.floor\(contextLimit \* thresholdRatio\);[\s\S]*if \(inputTokens < threshold\) \{[\s\S]*return;/,
    'maybeAutoCompact should auto-compact only after SDK input tokens reach the context threshold',
  );
  assert.match(
    autoBody,
    /if \(this\.compactingSessions\.has\(sessionId\)\) \{[\s\S]*return;/,
    'maybeAutoCompact should not schedule a second compaction while one is already running',
  );
  assert.match(
    autoBody,
    /await this\.handleCompactSession\([\s\S]*\{ auto: true, threshold: inputTokens \},[\s\S]*sessionService,[\s\S]*\);/,
    'maybeAutoCompact should delegate qualifying auto compactions to handleCompactSession with auto metadata',
  );
  assert.match(
    handleCompactBody,
    /if \(this\.compactingSessions\.has\(sessionId\)\) \{[\s\S]*this\.logger\.warn\("Compaction already in progress", \{ sessionId \}\);[\s\S]*return;/,
    'handleCompactSession should guard against duplicate compactions for the same session',
  );
  assert.match(
    handleCompactBody,
    /this\.compactingSessions\.add\(sessionId\);[\s\S]*finally \{[\s\S]*this\.compactingSessions\.delete\(sessionId\);[\s\S]*\}/,
    'handleCompactSession should always clear the in-progress lock in a finally block',
  );
  assert.match(
    handleCompactBody,
    /this\.postCompactionStatus\(\{[\s\S]*sessionId,[\s\S]*status: "running",[\s\S]*\}\);[\s\S]*const selectedModel = this\.getSelectedModel\(\);[\s\S]*const response = await this\.serverManager\.compactSession\(sessionId,/,
    'handleCompactSession should emit running status before invoking SDK-backed compaction with the selected model',
  );
  assert.match(
    handleCompactBody,
    /if \(response\?\.data !== true\) \{[\s\S]*throw new Error\("OpenCode did not confirm session compaction"\);/,
    'handleCompactSession should require the OpenCode SDK summarize confirmation',
  );
  assert.match(
    handleCompactBody,
    /await this\.persistAndPublishCompactionViewState\(sessionId, state\);[\s\S]*const refreshedRawMessages = await sessionService\.getMessages\(sessionId\);[\s\S]*type: "chatHistory",[\s\S]*messages: refreshedMessages,/,
    'handleCompactSession should reload SDK-owned messages and publish fresh chat history after compaction',
  );
  assert.match(
    handleCompactBody,
    /this\.postCompactionStatus\(\{[\s\S]*status: "done",[\s\S]*compacted: true,[\s\S]*baselineStats,[\s\S]*\}\);/,
    'handleCompactSession should emit a done status when compaction succeeds',
  );
  assert.match(
    handleCompactBody,
    /catch \(error\) \{[\s\S]*const errorMessage = error instanceof Error \? error\.message : String\(error\);[\s\S]*this\.postCompactionStatus\(\{[\s\S]*status: "error",[\s\S]*error: errorMessage,[\s\S]*\}\);/,
    'handleCompactSession should convert failures into error status payloads with readable error messages',
  );
  assert.doesNotMatch(
    handleCompactBody,
    /setTimeout\(|setInterval\(/,
    'handleCompactSession should not rely on timer-based polling to complete the compaction lifecycle',
  );
});
