/**
 * Subagent Integration Tests
 *
 * Comprehensive tests for subagent spawning, lifecycle management,
 * user interaction, and conversation flow integration.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);

const subagentModalSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'SubagentDetailModal.tsx')],
  'SubagentDetailModal.tsx',
);

// ===========================================================================
// SUBAGENT SPAWNING AND LIFECYCLE
// ===========================================================================

test('subagent lifecycle: spawn -> update -> complete -> cleanup', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // 1. Subagent spawning
  assert.match(handlerBody, /case\s+["']spawnedSubagent["']:\s*\{/, 'spawnedSubagent events are handled');
  assert.match(handlerBody, /const\s+subagent\s*=\s*normalizeSubagent\(\s*payload,\s*sessionId\s*\)/, 'subagent data is normalized');
  assert.match(handlerBody, /if\s*\(\s*existingSubagent\s*\)\s*\{[\s\S]*UPDATE_SUBAGENT[\s\S]*\}\s*else\s*\{[\s\S]*ADD_SUBAGENT/, 'existing subagents updated, new ones added');

  // 2. Subagent state updates
  assert.match(handlerBody, /case\s+["']subagentThinking["']:\s*\{[\s\S]*type:\s*["']UPDATE_SUBAGENT_THINKING["']/, 'thinking events update subagent thinking');
  assert.match(handlerBody, /case\s+["']subagentProgress["']:\s*\{[\s\S]*type:\s*["']UPDATE_SUBAGENT_PROGRESS["']/, 'progress events update subagent progress');
  assert.match(handlerBody, /case\s+["']subagentConversation["']:\s*\{[\s\S]*type:\s*["']UPDATE_SUBAGENT_CONVERSATION["']/, 'conversation events update subagent conversation');

  // 3. Subagent completion
  assert.match(handlerBody, /status:\s*["']completed["']|["']done["']|["']finished["'][\s\S]*type:\s*["']UPDATE_SUBAGENT["']/, 'completion status updates subagent');

  // 4. Subagent cleanup
  assert.match(reducerBody, /case\s+["']ADD_SUBAGENT["']:\s*\{[\s\S]*subagents:\s*\[\.\.\.state\.subagents,\s*action\.payload\]/, 'subagents are added to state array');
  assert.match(reducerBody, /case\s+["']UPDATE_SUBAGENT["']:\s*\{[\s\S]*subagents\.map\(\s*s\s*=>\s*s\.id\s*===\s*action\.payload\.id\s*\?\s*\{\s*\.\.\.s,\s*\.\.\.action\.payload\s*\}\s*:\s*s\s*\)/, 'subagents are updated by ID');
});

test('subagent spawning handles concurrent subagents with proper deduplication', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Deduplication logic
  assert.match(handlerBody, /const\s+existingSubagent\s*=\s*state\.subagents\.find\(\s*s\s*=>\s*s\.id\s*===\s*subagent\.id\s*\)/, 'existing subagents are found by ID');
  assert.match(handlerBody, /if\s*\(\s*existingSubagent\s*\)\s*\{[\s\S]*return\s*\{\s*\.\.\.existingSubagent,\s*\.\.\.subagent\s*\}\s*\}/, 'existing subagents are merged with new data');

  // Multiple concurrent subagents
  assert.match(handlerBody, /subagents\.length\s*>\s*0/, 'multiple subagents can be active simultaneously');
  assert.match(handlerBody, /forEach\(\s*subagent\s*=>\s*\{[\s\S]*UPDATE_SUBAGENT/, 'batch subagent updates are supported');
});

test('subagent lifecycle includes thinking, progress, and conversation phases', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');

  // Thinking phase
  assert.match(handlerBody, /case\s+["']subagentThinking["']:\s*\{[\s\S]*type:\s*["']UPDATE_SUBAGENT_THINKING["']\s*,\s*payload:\s*\{[\s\S]*thinkingEvents?:\s*payload\.thinkingEvents/, 'thinking events are captured');
  assert.match(messageComponentsBody, /subagent\.thinkingEvents\s*\|\|\s*\[\]/, 'thinking events are displayed in subagent row');

  // Progress phase
  assert.match(handlerBody, /case\s+["']subagentProgress["']:\s*\{[\s\S]*type:\s*["']UPDATE_SUBAGENT_PROGRESS"\s*,\s*payload:\s*\{[\s\S]*progressUpdates?:\s*payload\.progressUpdates/, 'progress updates are captured');
  assert.match(messageComponentsBody, /subagent\.progressUpdates\s*\|\|\s*\[\]/, 'progress updates are displayed in subagent row');

  // Conversation phase
  assert.match(handlerBody, /case\s+["']subagentConversation["']:\s*\{[\s\S]*type:\s*["']UPDATE_SUBAGENT_CONVERSATION["']\s*,\s*payload:\s*\{[\s\S]*conversationEvents?:\s*payload\.conversationEvents/, 'conversation events are captured');
  assert.match(messageComponentsBody, /subagent\.conversationEvents\s*\|\|\s*\[\]/, 'conversation events are tracked');
});

// ===========================================================================
// SUBAGENT UI INTEGRATION
// ===========================================================================

test('subagent UI: inline display -> modal detail -> conversation view', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // 1. Inline subagent display
  assert.match(messageComponentsBody, /const\s+visibleSubagents\s*=\s*subagents\.filter\(\s*s\s*=>\s*s\.status\s*!==\s*["']hidden["']\s*\)/, 'subagents are filtered for visibility');
  assert.match(messageComponentsBody, /visibleSubagents\.map\(\s*\(\s*subagent:\s*SubagentSummary\s*\)\s*=>\s*\{/, 'visible subagents are rendered as rows');
  assert.match(messageComponentsBody, /statusText\s*\|\|\s*["']Initializing\.\.\.["']/, 'status is displayed with fallback');
  assert.match(messageComponentsBody, /formatDuration\(\s*subagent\.durationMs\s*\?\?\s*0\s*\)/, 'duration is formatted and displayed');

  // 2. Click to open modal
  assert.match(messageComponentsBody, /onClick=\{\(\)\s*=>\s*openSubagentModal\(subagent\.id\)\}/, 'clicking subagent row opens modal');
  assert.match(messageComponentsBody, /const\s+openSubagentModal\s*=\s*\(\s*subagentId:\s*string\s*\)\s*=>\s*\{[\s\S]*setSelectedSubagentId\(subagentId\)/, 'openSubagentModal sets selected subagent ID');

  // 3. Modal detail view
  assert.match(messageComponentsBody, /<SubagentDetailModal[\s\S]*isOpen=\{selectedSubagentId\s*!==\s*null\}/, 'modal is controlled by selected subagent ID');
  assert.match(modalBody, /isOpen:\s*false[\s\S]*return\s*null/, 'modal returns null when closed');
  assert.match(modalBody, /createPortal\(\s*modalContent,\s*document\.body\s*\)/, 'modal is rendered in portal');

  // 4. Conversation view in modal
  assert.match(messageComponentsBody, /type:\s*["']getSubagentConversation["'][\s\S]*subagentId:\s*selected\.id/, 'conversation is requested when modal opens');
  assert.match(modalBody, /detail\.conversationEvents\s*\|\|\s*\[\]/, 'conversation events are displayed in modal');
});

test('subagent UI handles loading states and error states gracefully', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // Loading states
  assert.match(messageComponentsBody, /subagent\.status\s*===\s*["']running["'][\s\S]*statusText\s*\|\|\s*["']Initializing\.\.\.["']/, 'running status shows initializing text');
  assert.match(messageComponentsBody, /statusText\s*\|\|\s*["']Initializing\.\.\.["'][\s\S]*loading\s*|\|\s*spinner/, 'loading indicators are shown for running subagents');

  // Error states
  assert.match(messageComponentsBody, /subagent\.status\s*===\s*["']error["']|["']failed"'][\s\S]*error/i, 'error status is displayed');
  assert.match(messageComponentsBody, /subagent\.error\s*\|\|\s*subagent\.lastError/, 'error messages are extracted from subagent data');

  // Retry functionality
  assert.match(modalBody, /onRetry\s*\|\|\s*undefined/, 'retry functionality exists in modal');
  assert.match(messageComponentsBody, /retryLastMessage\s*\|\|\s*retrySubagent/, 'retry can be triggered for failed subagents');

  // Terminal states
  assert.match(messageComponentsBody, /subagent\.status\s*===\s*["']completed"'][\s\S]*check|circle/, 'completed status shows success indicator');
  assert.match(messageComponentsBody, /subagent\.status\s*===\s*["']cancelled"'][\s\S]*x|times/, 'cancelled status shows cancel indicator');
});

// ===========================================================================
// SUBAGENT CONVERSATION HYDRATION
// ===========================================================================

test('subagent conversation flow: request -> receive -> display -> interact', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // 1. Conversation request
  assert.match(messageComponentsBody, /requestedSubagentConversationRef\s*=\s*new\s*Set\(\)/, 'conversation requests are tracked to avoid duplicates');
  assert.match(messageComponentsBody, /if\s*\(\s*!selected\.conversationEvents\s*\|\|\s*selected\.conversationEvents\.length\s*===\s*0\s*\)\s*\{[\s\S]*!requestedSubagentConversationRef\.has\(selected\.id\)\)/, 'conversation is requested only if not already loaded');

  // 2. Request payload construction
  assert.match(messageComponentsBody, /type:\s*["']getSubagentConversation["'][\s\S]*subagentId:\s*selected\.id[\s\S]*childSessionId[\s\S]*parentSessionId[\s\S]*parentMessageId/, 'conversation request includes all necessary identifiers');

  // 3. Conversation response handling
  assert.match(messageComponentsSource, /case\s+["']subagentConversationResponse["']:\s*\{[\s\S]*type:\s*["']SET_SUBAGENT_CONVERSATION["']/, 'conversation responses update subagent data');
  assert.match(messageComponentsSource, /requestedSubagentConversationRef\.delete\(\s*subagentId\s*\)/, 'conversation request tracking is cleared after response');

  // 4. Conversation display in modal
  assert.match(modalBody, /detail\.conversationEvents\s*\|\|\s*\[\]/, 'conversation events are available in modal');
  assert.match(modalBody, /conversationEvents\.map\(\s*event\s*=>\s*\{[\s\S]*event\.role\s*===\s*["']user"'][\s\S]*event\.role\s*===\s*["']assistant"']/, 'conversation events are rendered by role');

  // 5. Conversation interaction
  assert.match(modalBody, /onCopyRefs\s*\|\|\s*undefined/, 'conversation references can be copied');
  assert.match(modalBody, /onJumpToParent\s*\|\|\s*undefined/, 'user can jump to parent message');
});

test('subagent conversation handles empty and partial conversations gracefully', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // Empty conversation handling
  assert.match(messageComponentsBody, /if\s*\(\s*!detail\.conversationEvents\s*\|\|\s*detail\.conversationEvents\.length\s*===\s*0\s*\)\s*\{[\s\S]*No\s+conversation\s+available/i, 'empty conversations show placeholder');
  assert.match(modalBody, /conversationEvents\.length\s*===\s*0[\s\S]*No\s+conversation\s+available/i, 'modal handles empty conversations');

  // Partial conversation handling
  assert.match(messageComponentsBody, /conversationEvents\.slice\(\s*-5\s*\)/, 'recent conversation events are prioritized');
  assert.match(modalBody, /Show\s+(all\s+|\d+\s+)?messages/i, 'conversation view can show all or recent messages');

  // Loading state for conversation
  assert.match(messageComponentsBody, /isLoadingConversation\s*=\s*requestedSubagentConversationRef\.has\(selected\.id\)/, 'loading state is tracked during conversation fetch');
  assert.match(modalBody, /isLoadingConversation\s*\?\s*<Loading\s*\/>/i, 'modal shows loading state during conversation fetch');
});

// ===========================================================================
// SUBAGENT COLOR CODING AND VISUAL DISTINCTION
// ===========================================================================

test('subagent visual distinction: deterministic color assignment and styling', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // Deterministic color assignment
  assert.match(messageComponentsBody, /function\s+getSubagentColor\(\s*id:\s*string\s*\)\s*:\s*string/, 'color assignment function exists');
  assert.match(messageComponentsBody, /const\s+colors\s*=\s*\[["']blue["'],\s*["']purple["'],\s*["']green["'],\s*["']orange["'][\s\S]*\]/, 'color palette is defined');
  assert.match(messageComponentsBody, /id\.split\(\s*""\s*\)\.reduce\(\s*\(sum,\s*char\)\s*=>\s*sum\s*\+\s*char\.charCodeAt\(0\)/, 'deterministic hash from subagent ID');

  // Color application to UI elements
  assert.match(messageComponentsBody, /const\s+cardStyle\s*=\s*getSubagentCardStyle\(subagent\.id\)/, 'card style is derived from subagent ID');
  assert.match(messageComponentsBody, /const\s+accentTextStyle\s*=\s*getSubagentAccentTextStyle\(subagent\.id\)/, 'accent text style is derived from subagent ID');
  assert.match(messageComponentsBody, /className=\{.*?cardStyle.*?\}/, 'card style is applied to subagent row');

  // Modal color integration
  assert.match(messageComponentsBody, /<SubagentDetailModal[\s\S]*colorClass=\{getSubagentColor\(selected\.id\)\}/, 'modal receives color class');
  assert.match(modalBody, /colorClass\?:\s*string/, 'modal accepts colorClass prop');
  assert.match(modalBody, /className=\{.*?colorClass.*?\}/, 'color class is applied to modal elements');

  // Visual consistency
  assert.match(messageComponentsBody, /getSubagentColor\(subagent\.id\)\s*===\s*getSubagentColor\(selected\.id\)/, 'same subagent has same color across UI');
});

// ===========================================================================
// SUBAGENT PARENT-HIERARCHY NAVIGATION
// ===========================================================================

test('subagent hierarchy: parent tracking and navigation', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // Parent session tracking
  assert.match(messageComponentsBody, /subagent\.parentSessionId\s*\|\|\s*subagent\.parent_session_id/, 'parent session ID is tracked');
  assert.match(messageComponentsBody, /subagent\.parentMessageId\s*\|\|\s*subagent\.parent_message_id/, 'parent message ID is tracked');

  // Jump to parent functionality
  assert.match(modalBody, /onJumpToParent\s*\|\|\s*undefined/, 'jump to parent callback exists');
  assert.match(messageComponentsBody, /onJumpToParent:\s*\(\)\s*=>\s*\{[\s\S]*closeSubagentModal\(\)[\s\S]*jumpToMessage\(/, 'jump to parent closes modal then navigates');

  // Parent info display
  assert.match(modalBody, /Parent:\s*.*?subagent\.parentSessionId/i, 'parent session info is displayed');
  assert.match(modalBody, /jumpToParent\s*&&\s*<button/i, 'jump to parent button is shown when callback exists');

  // Hierarchical subagent support
  assert.match(messageComponentsBody, /subagents\.filter\(\s*s\s*=>\s*s\.parentSessionId\s*===\s*currentSessionId\s*\)/, 'subagents can be filtered by parent session');
  assert.match(messageComponentsBody, /const\s+childSubagents\s*=\s*subagents\.filter\(\s*s\s*=>\s*s\.parentSessionId\s*===\s*subagent\.id\s*\)/, 'subagents can have their own child subagents');
});

// ===========================================================================
// SUBAGENT PERFORMANCE AND DURATION TRACKING
// ===========================================================================

test('subagent performance: duration calculation and display', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // Duration calculation
  assert.match(messageComponentsBody, /formatDuration\(\s*subagent\.durationMs\s*\?\?\s*0\s*\)/, 'duration is formatted for display');
  assert.match(messageComponentsSource, /function\s+formatDuration\(\s*ms:\s*number\s*\)\s*:\s*string/, 'formatDuration function exists');
  assert.match(messageComponentsSource, /ms\s*<\s*1000[\s\S]*\$\{ms\}ms/, 'milliseconds are shown for short durations');
  assert.match(messageComponentsSource, /ms\s*<\s*60000[\s\S]*\$\{Math\.floor\(ms\s*/\s*1000\)\}s/, 'seconds are shown for medium durations');
  assert.match(messageComponentsSource, /\$\{Math\.floor\(ms\s*/\s*60000\)\}m/, 'minutes are shown for long durations');

  // Duration display in inline rows
  assert.match(messageComponentsBody, /formatDuration\(\s*subagent\.durationMs\s*\?\?\s*0\s*\)[\s\S]*<span/i, 'formatted duration is shown in subagent row');

  // Duration display in modal
  assert.match(modalBody, /Duration:\s*.*?formatDuration\(/, 'duration is shown in modal detail view');
  assert.match(modalBody, /Started:\s*.*?subagent\.startedAt/i, 'start time is shown in modal');
  assert.match(modalBody, /Completed:\s*.*?subagent\.completedAt/i, 'completion time is shown in modal');

  // Real-time duration updates
  assert.match(messageComponentsBody, /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*subagent\.status\s*===\s*["']running["'][\s\S]*setInterval/, 'duration updates periodically for running subagents');
});

// ===========================================================================
// SUBAGENT ERROR HANDLING AND RECOVERY
// ===========================================================================

test('subagent error handling: error detection -> display -> retry options', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // Error detection
  assert.match(messageComponentsBody, /subagent\.status\s*===\s*["']error"']|["']failed"'][\s\S]*error/i, 'error status is detected');
  assert.match(messageComponentsBody, /subagent\.error\s*\|\|\s*subagent\.lastError\s*\|\|\s*subagent\.errorMessage/, 'error message is extracted from multiple fields');

  // Error display
  assert.match(messageComponentsBody, /error\s*&&\s*<.*?error.*?>/i, 'error messages are displayed in UI');
  assert.match(modalBody, /Error:\s*.*?subagent\.error/i, 'errors are shown prominently in modal');

  // Retry functionality
  assert.match(modalBody, /onRetry\s*\|\|\s*undefined/, 'retry callback exists');
  assert.match(messageComponentsBody, /onRetry:\s*\(\)\s*=>\s*retrySubagent\(subagent\.id\)/, 'retry can be triggered for failed subagents');
  assert.match(messageComponentsBody, /type:\s*["']retrySubagent"'][\s\S]*subagentId:/, 'retry messages include subagent ID');

  // Error recovery
  assert.match(messageComponentsBody, /status\s*===\s*["']error"'].*?retry.*?available/i, 'retry options are shown for errors');
  assert.match(messageComponentsBody, /status\s*===\s*["']cancelled"'].*?cancelled/i, 'cancellation status is distinguished from errors');

  // Terminal state handling
  assert.match(messageComponentsBody, /subagent\.terminal\s*=\s*subagent\.status\s*===\s*["']completed"']\s*\|\|\s*subagent\.status\s*===\s*["']error"']\s*\|\|\s*subagent\.status\s*===\s*["']cancelled"']/i, 'terminal states are identified');
  assert.match(messageComponentsBody, /subagent\.terminal\s*\|\|\s*false/, 'terminal state affects UI behavior');
});