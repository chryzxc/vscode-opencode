import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);

const initialStateBody = extractFunctionBody(
  source,
  'export const initialState: AppState = {',
);
const appReducerBody = extractFunctionBody(
  source,
  'export function appReducer(state: AppState, action: AppAction): AppState {',
);
const mergeStatsBody = extractFunctionBody(
  source,
  'function mergeStats(current: SessionStats, next: SessionStats): SessionStats {',
);
const mergeStreamingReasoningBody = extractFunctionBody(
  source,
  'export function mergeStreamingReasoning(',
);
const appendWithCapBody = extractFunctionBody(
  source,
  'function appendWithCap<T>(items: T[], next: T, maxItems: number): T[] {',
);
const resolveCompactionDividerAnchorsBody = extractFunctionBody(
  source,
  'function resolveCompactionDividerAnchors(',
);
const resolveCompactionDividerIndexBody = extractFunctionBody(
  source,
  'function resolveCompactionDividerIndex(',
);
const resolveCompactionDividerAnchorsSlice = source.slice(
  source.indexOf('function resolveCompactionDividerAnchors('),
  source.indexOf('function resolveCompactionDividerIndex('),
);
const resolveCompactionDividerIndexSlice = source.slice(
  source.indexOf('function resolveCompactionDividerIndex('),
  source.indexOf('export function appReducer('),
);
const appProviderBody = extractFunctionBody(
  source,
  'export function AppProvider({ children }: { children: React.ReactNode }) {',
);
const useAppStateBody = extractFunctionBody(source, 'export function useAppState() {');
const useAppDispatchBody = extractFunctionBody(source, 'export function useAppDispatch() {');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCaseBlock(type, span = 2200) {
  const start = appReducerBody.indexOf(`case "${type}"`);
  assert.notEqual(start, -1, `${type} case should exist in appReducer`);
  return appReducerBody.slice(start, start + span);
}

test('store source exports initialState and appReducer switch', () => {
  assert.match(source, /export const initialState: AppState = \{/, 'initialState should be exported');
  assert.match(
    source,
    /export function appReducer\(state: AppState, action: AppAction\): AppState \{[\s\S]*switch \(action\.type\)/,
    'appReducer should be exported and implemented as a switch over action.type',
  );
});

test('initialState defines the core webview state fields', () => {
  assert.match(initialStateBody, /messages:\s*\[\]/, 'initialState should include messages');
  assert.match(initialStateBody, /streaming:\s*null/, 'initialState should include streaming');
  assert.match(initialStateBody, /isProcessing:\s*false/, 'initialState should include isProcessing');
  assert.match(initialStateBody, /currentSessionId:\s*null/, 'initialState should include currentSessionId');
  assert.match(initialStateBody, /sessionsList:\s*\[\]/, 'initialState should include sessionsList');
  assert.match(initialStateBody, /sessionStats:\s*\{[\s\S]*input:\s*0[\s\S]*output:\s*0[\s\S]*duration:\s*0/, 'initialState should include zeroed sessionStats');
  assert.match(initialStateBody, /interactiveEvents:\s*\[\]/, 'initialState should include interactiveEvents');
  assert.match(initialStateBody, /subagentsByParentMessageId:\s*\{\}/, 'initialState should include subagentsByParentMessageId');
  assert.match(initialStateBody, /todoItems:\s*\[\]/, 'initialState should include todoItems');
  assert.match(initialStateBody, /mcpServers:\s*\[\]/, 'initialState should include mcpServers');
  assert.match(initialStateBody, /lspServers:\s*\[\]/, 'initialState should include lspServers');
});

const actionContracts = [
  { type: 'SET_RECEIVED_INIT_STATE', patterns: [/receivedInitState:\s*action\.payload/] },
  { type: 'SET_SESSION_ID', span: 2600, patterns: [/currentSessionId:\s*action\.payload/, /sessionStats:\s*statsForNew/, /promptQueue:\s*queueForNew/] },
  { type: 'SET_SERVER_STATUS', patterns: [/serverStatus:\s*action\.payload/] },
  { type: 'SET_SELECTED_MODEL', patterns: [/selectedModel:\s*action\.payload/] },
  { type: 'SET_MODELS_LIST', patterns: [/availableModels:\s*action\.payload/] },
  { type: 'SET_SELECTED_AGENT', patterns: [/selectedAgent:\s*action\.payload/] },
  { type: 'SET_AGENTS_LIST', patterns: [/availableAgents:\s*action\.payload/] },
  { type: 'SET_MESSAGES', patterns: [/messages:\s*canonicalMessages/, /resolveCompactionDividerIndex\(canonicalMessages/ ] },
  { type: 'CLEAR_MESSAGES', patterns: [/messages:\s*\[\]/] },
  { type: 'SET_PROCESSING', span: 3600, patterns: [/isProcessing:\s*true/, /streaming:\s*streamingState/, /isProcessing:\s*action\.payload|isProcessing:\s*false/] },
  { type: 'SET_STEERING', patterns: [/isSteering:\s*action\.payload/] },
  { type: 'SET_SESSIONS_LIST', patterns: [/sessionsList:\s*action\.payload/] },
  { type: 'SET_PROCESSING_SESSIONS', patterns: [/processingSessionIds:\s*action\.payload/] },
  { type: 'START_SESSION_LOADING', patterns: [/isLoadingSession:\s*true/, /loadingSessionId:\s*action\.payload\.sessionId/, /loadingSessionTitle:\s*action\.payload\.title/] },
  { type: 'END_SESSION_LOADING', patterns: [/isLoadingSession:\s*false/, /loadingSessionId:\s*null/, /loadingSessionTitle:\s*null/] },
  { type: 'SET_STREAMING', patterns: [/streaming:\s*\{[\s\S]*\.\.\.action\.payload/, /hasRenderableContent:\s*action\.payload\.hasRenderableContent \?\? false/, /reasoningEvents:\s*action\.payload\.reasoningEvents \?\? \[\]/] },
  { type: 'UPDATE_STREAMING_CONTENT', patterns: [/const content = action\.payload\.append/, /contentStartSeq/, /hasRenderableContent/, /content,/] },
  { type: 'UPDATE_STREAMING_REASONING', span: 2600, patterns: [/mergeStreamingReasoning\(/, /reasoningEvents = appendWithCap\(/, /inThoughtBlock/, /inReasoningPart/] },
  { type: 'ADD_STREAMING_STEP', patterns: [/const stampedStep = \{ \.\.\.action\.payload, streamSeq: Date\.now\(\) \}/, /steps: appendWithCap\(/, /progressEvents: appendWithCap\(/] },
  { type: 'UPDATE_STREAMING_STEP', patterns: [/steps\[idx\] = \{ \.\.\.steps\[idx\], \.\.\.action\.payload\.patch \}/, /progressEvents: appendWithCap\(/] },
  { type: 'ADD_STREAMING_EDIT', patterns: [/state\.streaming\.edits\.includes\(action\.payload\)/, /edits: appendWithCap\(/] },
  { type: 'FINISH_STREAMING', patterns: [/isActive:\s*false/, /usage:\s*action\.payload\?\.usage \?\? state\.streaming\.usage/] },
  { type: 'SET_INPUT_VALUE', patterns: [/inputValue:\s*action\.payload/] },
  { type: 'SET_FILE_SUGGESTIONS', patterns: [/fileSuggestions:\s*action\.payload/] },
  { type: 'SET_MENTION_SUGGESTIONS', patterns: [/mentionSuggestions:\s*action\.payload/] },
  { type: 'SET_COMMANDS_LIST', patterns: [/availableCommands:\s*action\.payload/, /commandsLoaded:\s*true/] },
  { type: 'SET_SELECTED_FILES', patterns: [/selectedFiles:\s*action\.payload/] },
  { type: 'SET_SELECTED_CONTEXTS', patterns: [/selectedContexts:\s*action\.payload/] },
  { type: 'SET_QUEUE', patterns: [/queueBySessionId:\s*nextBySession/, /promptQueue:[\s\S]*sessionQueue/] },
  { type: 'SET_EXECUTING_QUEUE', patterns: [/executingQueueSessionIds:\s*next/] },
  { type: 'ADD_TO_LOCAL_QUEUE', patterns: [/queueBySessionId:\s*nextBySession/, /promptQueue:\s*updatedQueue/, /isQueueOpen:\s*true/] },
  { type: 'SET_SIDEBAR_OPEN', patterns: [/isSidebarOpen:\s*action\.payload/] },
  { type: 'SET_SESSION_MODAL_OPEN', patterns: [/isSessionModalOpen:\s*action\.payload/] },
  { type: 'SET_COMPACTION_STATUS', span: 3200, patterns: [/isCompacting:\s*action\.payload\.status === "running"/, /compactionError:/, /lastCompactedAt:/, /compactionBaselineStats:/, /compactionDividerIndex:/, /compactedMessagesCollapsed:/] },
  { type: 'SET_COMPACTION_VIEW_STATE', span: 2600, patterns: [/lastCompactedAt:/, /compactionBaselineStats:/, /compactionDividerIndex:/, /compactedMessagesCollapsed:/] },
  { type: 'SET_COMPACTED_MESSAGES_COLLAPSED', patterns: [/compactedMessagesCollapsed:\s*action\.payload/] },
  { type: 'SET_QUOTA_DATA', patterns: [/quotaData:\s*action\.payload/, /quotaIsRefreshing:\s*false/] },
  { type: 'SET_QUOTA_REFRESHING', patterns: [/quotaIsRefreshing:\s*action\.payload/] },
  { type: 'ADD_ATTACHMENT', patterns: [/attachments:\s*\[\.\.\.\(state\.attachments \|\| \[\]\), action\.payload\]/] },
  { type: 'REMOVE_ATTACHMENT', patterns: [/attachments:[\s\S]*filter\([\s\S]*a\.id !== action\.payload/] },
  { type: 'CLEAR_ATTACHMENTS', patterns: [/attachments:\s*\[\]/] },
  { type: 'SET_THINKING_LEVEL', patterns: [/thinkingLevel:\s*action\.payload/] },
  { type: 'SET_MODEL_CAPABILITY', patterns: [/modelCapability:\s*action\.payload/] },
  { type: 'SET_TODO_ITEMS', patterns: [/todoItems:\s*action\.payload/] },
  { type: 'UPDATE_TODO_ITEM', span: 3000, patterns: [/todoItems: items/, /LIFECYCLE_RANK/, /hasTodoPatchChanges\(/] },
  { type: 'ADD_TODO_ITEM', span: 2200, patterns: [/todoItems:\s*\[\.\.\.\(state\.todoItems \|\| \[\]\), action\.payload\]/, /LIFECYCLE_RANK/] },
  { type: 'UPSERT_SUBAGENT_SUMMARIES', patterns: [/subagentsByParentMessageId:\s*\{[\s\S]*\.\.\.state\.subagentsByParentMessageId[\s\S]*\.\.\.action\.payload/] },
  { type: 'UPSERT_SUBAGENT_DETAIL', patterns: [/subagentDetailsById:\s*\{[\s\S]*\.\.\.state\.subagentDetailsById[\s\S]*\.\.\.action\.payload/] },
  { type: 'SELECT_SUBAGENT', patterns: [/selectedSubagentId:\s*action\.payload/] },
  { type: 'SET_INTERACTIVE_EVENTS', patterns: [/interactiveEvents:\s*action\.payload/] },
  { type: 'DISMISS_INTERACTIVE_EVENT', patterns: [/interactiveEvents:[\s\S]*filter\([\s\S]*event\.id !== action\.payload/] },
  { type: 'SET_MCP_SERVERS', patterns: [/mcpServers:\s*action\.payload/] },
  { type: 'SET_LSP_SERVERS', patterns: [/lspServers:\s*action\.payload/] },
  { type: 'SET_OPENCODE_CONFIG', patterns: [/opencodeConfig:\s*\{[\s\S]*\.\.\.action\.payload[\s\S]*files: action\.payload\.files \|\| \[\]/] },
  { type: 'SET_CONFIG_FILES_LIST', patterns: [/const configFilesState: ConfigFilesState = \{[\s\S]*files: action\.payload\.files[\s\S]*globalError: action\.payload\.error \|\| ""/, /configFiles:\s*configFilesState/] },
];

for (const contract of actionContracts) {
  test(`appReducer handles ${contract.type}`, () => {
    const block = getCaseBlock(contract.type, contract.span);
    assert.match(
      appReducerBody,
      new RegExp(`case\\s+"${escapeRegex(contract.type)}"`),
      `${contract.type} should have a case branch`,
    );
    for (const pattern of contract.patterns) {
      assert.match(block, pattern, `${contract.type} should include its expected state mutation`);
    }
  });
}

test('mergeStats sums session token and duration fields', () => {
  assert.match(mergeStatsBody, /input:\s*current\.input \+ next\.input/, 'mergeStats should sum input');
  assert.match(mergeStatsBody, /output:\s*current\.output \+ next\.output/, 'mergeStats should sum output');
  assert.match(mergeStatsBody, /read:\s*current\.read \+ next\.read/, 'mergeStats should sum read');
  assert.match(mergeStatsBody, /write:\s*current\.write \+ next\.write/, 'mergeStats should sum write');
  assert.match(mergeStatsBody, /duration:\s*current\.duration \+ next\.duration/, 'mergeStats should sum duration');
  assert.doesNotMatch(mergeStatsBody, /Math\.max\(/, 'mergeStats should merge by addition rather than clamping');
});

test('mergeStreamingReasoning handles chunk dedupe, replacement, and append semantics', () => {
  assert.match(mergeStreamingReasoningBody, /if \(!append\)[\s\S]*reasoning:\s*incoming/, 'mergeStreamingReasoning should replace reasoning when append is false');
  assert.match(mergeStreamingReasoningBody, /currentNorm\.includes\(incomingNorm\)/, 'mergeStreamingReasoning should ignore redundant incoming chunks');
  assert.match(mergeStreamingReasoningBody, /incomingNorm\.includes\(currentNorm\)/, 'mergeStreamingReasoning should replace with richer incoming snapshots');
  assert.match(mergeStreamingReasoningBody, /isDuplicateReasoningChunk\(incomingNorm, currentNorm\)/, 'mergeStreamingReasoning should detect duplicate reasoning chunks');
  assert.match(mergeStreamingReasoningBody, /appendStreamingReasoning\(current, incoming\)/, 'mergeStreamingReasoning should append novel chunks with boundary handling');
});

test('appendWithCap keeps immutable bounded arrays', () => {
  assert.match(appendWithCapBody, /items\.length >= maxItems/, 'appendWithCap should branch on the maximum size');
  assert.match(appendWithCapBody, /return \[\.\.\.items\.slice\(items\.length - maxItems \+ 1\), next\]/, 'appendWithCap should drop the oldest item when capped');
  assert.match(appendWithCapBody, /return \[\.\.\.items, next\]/, 'appendWithCap should append immutably when under the cap');
  assert.doesNotMatch(appendWithCapBody, /items\.push\(/, 'appendWithCap should avoid mutating the original array');
});

test('compaction helpers resolve anchors and divider positions from message ids and timestamps', () => {
  assert.match(resolveCompactionDividerAnchorsSlice, /compactionDividerBeforeMessageId:/, 'resolveCompactionDividerAnchors should compute the before anchor');
  assert.match(resolveCompactionDividerAnchorsSlice, /compactionDividerAfterMessageId:/, 'resolveCompactionDividerAnchors should compute the after anchor');
  assert.match(resolveCompactionDividerIndexSlice, /compactionDividerAfterMessageId/, 'resolveCompactionDividerIndex should prefer after-message anchor lookups');
  assert.match(resolveCompactionDividerIndexSlice, /compactionDividerBeforeMessageId/, 'resolveCompactionDividerIndex should fall back to before-message anchor lookups');
  assert.match(resolveCompactionDividerIndexSlice, /lastCompactedAt/, 'resolveCompactionDividerIndex should support timestamp-based resolution');
  assert.match(resolveCompactionDividerIndexSlice, /clampDividerIndex\(/, 'resolveCompactionDividerIndex should clamp explicit divider indices');
  assert.ok(resolveCompactionDividerAnchorsBody !== '', 'resolveCompactionDividerAnchors should still be extractable');
  assert.ok(resolveCompactionDividerIndexBody !== '', 'resolveCompactionDividerIndex should still be extractable');
});

test('FINISH_STREAMING preserves the final snapshot instead of clearing streaming immediately', () => {
  const finishBlock = getCaseBlock('FINISH_STREAMING', 600);
  assert.match(finishBlock, /streaming:\s*\{[\s\S]*\.\.\.state\.streaming/, 'FINISH_STREAMING should preserve the existing snapshot');
  assert.match(finishBlock, /isActive:\s*false/, 'FINISH_STREAMING should only mark streaming inactive');
  assert.doesNotMatch(finishBlock, /streaming:\s*null/, 'FINISH_STREAMING should not clear streaming to null inside the reducer');
});

test('AppProvider and state hooks are exported', () => {
  assert.match(source, /export function AppProvider\(/, 'AppProvider should be exported');
  assert.match(appProviderBody, /useReducer\(appReducer, initialState\)/, 'AppProvider should wire appReducer with initialState');
  assert.match(appProviderBody, /AppStateContext\.Provider/, 'AppProvider should provide AppStateContext');
  assert.match(appProviderBody, /AppDispatchContext\.Provider/, 'AppProvider should provide AppDispatchContext');
  assert.match(source, /export function useAppState\(\)/, 'useAppState should be exported');
  assert.match(useAppStateBody, /useContext\(AppStateContext\)/, 'useAppState should read AppStateContext');
  assert.match(useAppStateBody, /throw new Error\('useAppState must be used within AppProvider'\)/, 'useAppState should guard missing provider usage');
  assert.match(source, /export function useAppDispatch\(\)/, 'useAppDispatch should be exported');
  assert.match(useAppDispatchBody, /useContext\(AppDispatchContext\)/, 'useAppDispatch should read AppDispatchContext');
  assert.match(useAppDispatchBody, /throw new Error\('useAppDispatch must be used within AppProvider'\)/, 'useAppDispatch should guard missing provider usage');
});
