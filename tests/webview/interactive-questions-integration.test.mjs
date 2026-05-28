/**
 * Interactive Questions Integration Tests
 *
 * Comprehensive tests for interactive question functionality including:
 * - Question detection and popover creation
 * - Different question types (question, confirm, quick_actions)
 * - User response handling and submission
 * - Interactive flow integration with chat
 * - Custom input and validation
 * - Multi-question handling
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);

// ===========================================================================
// QUESTION DETECTION AND POPUP CREATION
// ===========================================================================

test('question detection flow: structured output -> interactive events -> popover', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // 1. Question detection in stream
  assert.match(handlerBody, /case\s+["']structuredOutput["']:\s*\{/, 'structured output events are handled');
  assert.match(handlerBody, /const\s*interactiveEvents\s*=\s*toInteractiveEvents\(\s*structured\s*\)/, 'structured output is converted to interactive events');

  // 2. Interactive event normalization
  assert.match(messageHandlerSource, /function\s+toInteractiveEvents\(\s*structured\s*\)/, 'toInteractiveEvents function exists');
  assert.match(messageHandlerSource, /const\s*events\s*=\s*structured\.interactiveEvents\s*\|\|\s*\[\]/, 'interactive events are extracted from structured output');
  assert.match(messageHandlerSource, /events\.length\s*>\s*0\s*\{[\s\S]*return\s*events/, 'interactive events are returned if available');

  // 3. State update for questions
  assert.match(handlerBody, /type:\s*["']SET_INTERACTIVE_EVENTS"']\s*,\s*payload:\s*interactiveEvents/, 'interactive events are dispatched to state');
  assert.match(reducerBody, /case\s+["']SET_INTERACTIVE_EVENTS["']:\s*\{[\s\S]*interactiveEvents:\s*action\.payload/, 'interactive events are stored in state');

  // 4. Popover rendering
  assert.match(panelBody, /interactiveEvents\.length\s*>\s*0\s*&&\s*<InteractivePopover/, 'popover is shown when interactive events exist');
  assert.match(panelBody, /events=\{interactiveEvents\}/, 'interactive events are passed to popover component');
});

test('question type detection: question vs confirm vs quick_actions', () => {
  const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
  );
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Question type detection
  assert.match(messageHandlerSource, /event\.type\s*===\s*["']question"'][\s\S]*options\.length\s*>=\s*2/, 'question type requires options');
  assert.match(panelBody, /event\.type\s*===\s*["']question"'][\s\S]*event\.options\.map\(/, 'question type renders options list');

  // Confirm type detection
  assert.match(messageHandlerSource, /event\.type\s*===\s*["']confirm"'][\s\S]*event\.question/, 'confirm type requires question text');
  assert.match(panelBody, /event\.type\s*===\s*["']confirm"'][\s\S]*event\.confirmLabel\s*\|\|\s*["']Yes"'][\s\S]*event\.cancelLabel\s*\|\|\s*["']No"']/, 'confirm type shows yes/no buttons');

  // Quick actions type detection
  assert.match(messageHandlerSource, /event\.type\s*===\s*["']quick_actions"']|["']quick-actions"'][\s\S]*actions\.length\s*>\s*0/, 'quick_actions type requires actions');
  assert.match(panelBody, /event\.type\s*===\s*["']quick_actions"'][\s\S]*event\.actions\.map\(/, 'quick_actions type renders action buttons');

  // Type-based rendering differences
  assert.match(panelBody, /event\.type\s*===\s*["']question"'][\s\S]*Custom\s+Answer/i, 'question type shows custom input option');
  assert.match(panelBody, /event\.type\s*===\s*["']confirm"'][\s\S]*Yes|No/i, 'confirm type shows binary choice');
  assert.match(panelBody, /event\.type\s*===\s*["']quick_actions"'][\s\S]*Select\s+an\s+action/i, 'quick_actions type shows selection prompt');
});

// ===========================================================================
// USER RESPONSE HANDLING AND SUBMISSION
// ===========================================================================

test('question response flow: user input -> validation -> submission -> continue', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // 1. User input capture
  assert.match(panelBody, /const\s+\[answer,\s*setAnswer\]\s*=\s*useState\(\s*""\s*\)/, 'answer state is managed');
  assert.match(panelBody, /onChange=\{\s*\(\s*e\s*\)\s*=>\s*setAnswer\(\s*e\.target\.value\s*\)\s*\}/, 'input changes update answer state');

  // 2. Input validation
  assert.match(panelBody, /const\s*isValid\s*=\s*answer\.trim\(\)\.length\s*>\s*0/, 'answer validation checks for non-empty');
  assert.match(panelBody, /disabled\s*=\s*!\s*isValid/, 'submit is disabled when invalid');

  // 3. Response submission
  assert.match(panelBody, /submitInteractiveResponse\(\s*{\s*eventId:\s*event\.id,\s*response:\s*answer\s*\}\s*\)/, 'response is submitted with event ID and answer');
  assert.match(panelBody, /type:\s*["']sendMessage"'][\s\S]*interactiveSubmit:\s*true/, 'responses use special submit flag');

  // 4. Submission handling
  assert.match(handlerBody, /case\s+["']sendMessage"']:\s*\{[\s\S]*if\s*\(\s*message\.interactiveSubmit\s*\)\s*\{/, 'interactive submits are handled specially');
  assert.match(handlerBody, /forceSendNow:\s*true[\s\S]*avoidAbortIfProcessing:\s*true/, 'interactive submits bypass normal processing checks');

  // 5. Flow continuation
  assert.match(handlerBody, /SET_INTERACTIVE_EVENTS.*?payload:\s*\[\]/, 'interactive events are cleared after response');
  assert.match(reducerBody, /case\s+["']SET_INTERACTIVE_EVENTS"']:\s*\{[\s\S]*interactiveEvents:\s*\[\]/, 'clearing events hides popover');

  // 6. Processing continues
  assert.match(handlerBody, /SET_PROCESSING\(\s*true\s*\)/, 'processing state is set for response');
  assert.match(handlerBody, /sessionId:\s*message\.sessionId\s*\|\|\s*currentSessionId/, 'response uses current session');
});

test('question response validation: required fields -> format checking -> error handling', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Required field validation
  assert.match(panelBody, /const\s*isRequired\s*=\s*!event\.allowCustomInput\s*&&\s*answer\s*===\s*undefined/, 'required answers are validated');
  assert.match(panelBody, /const\s*isValid\s*=\s*isRequired\s*\?\s*false\s*:\s*answer\.trim\(\)\.length\s*>\s*0/, 'validation considers required flag');

  // Format checking for different types
  assert.match(panelBody, /event\.type\s*===\s*["']question"'][\s\S]*options\.some\(\s*opt\s*=>\s*opt\.value\s*===\s*answer\s*\)/, 'question answers must match option values');
  assert.match(panelBody, /event\.type\s*===\s*["']confirm"'][\s\S]*answer\s*===\s*["']yes"']|["']no"']/i, 'confirm answers must be yes/no');

  // Error display
  assert.match(panelBody, /error\s*&&\s*<.*?error.*?>/i, 'validation errors are shown');
  assert.match(panelBody, /Please\s+provide\s+a\s+valid\s+answer/i, 'error message is displayed');

  // Real-time validation feedback
  assert.match(panelBody, /onBlur\s*=\s*\{\s*\(\s*\)\s*=>\s*validateAnswer\(\s*\)\s*\}/, 'validation is triggered on blur');
  assert.match(panelBody, /const\s*validateAnswer\s*=\s*\(\s*\)\s*=>\s*\{[\s\S]*return\s*answer\.length\s*>\s*0/, 'validation logic is implemented');

  // Clear error on input
  assert.match(panelBody, /onChange.*?setError\(\s*null\s*\)/i, 'errors are cleared when user starts typing');
});

// ===========================================================================
// CUSTOM INPUT AND SPECIAL QUESTION TYPES
// ===========================================================================

test('custom input flow: allowCustomInput -> text field -> validation -> submission', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
  );

  // Custom input detection
  assert.match(panelBody, /event\.allowCustomInput\s*===\s*true/, 'allowCustomInput flag is checked');
  assert.match(messageHandlerSource, /allowCustomInput:\s*questionLike\.allowCustomInput\s*===\s*true/, 'allowCustomInput is preserved in normalization');

  // Custom input field rendering
  assert.match(panelBody, /allowCustomInput\s*&&\s*<textarea/i, 'textarea is shown for custom input');
  assert.match(panelBody, /placeholder=["']Type\s+your\s+answer\.\.\.["']/i, 'placeholder text guides user input');

  // Custom input validation
  assert.match(panelBody, /minLength\s*=\s*event\.minLength\s*\|\|\s*1/i, 'minLength validation is applied');
  assert.match(panelBody, /maxLength\s*=\s*event\.maxLength\s*\|\|\s*1000/i, 'maxLength validation is applied');
  assert.match(panelBody, /answer\.length\s*<\s*minLength\s*\|\|\s*answer\.length\s*>\s*maxLength[\s\S]*error/i, 'length validation is checked');

  // Custom input submission
  assert.match(panelBody, /const\s*customAnswer\s*=\s*allowCustomInput\s*\?\s*answer\s*:\s*undefined/, 'custom answer is used when allowed');
  assert.match(panelBody, /response:\s*customAnswer\s*\|\|\s*selectedOption/, 'response includes custom answer or selected option');

  // Format preservation
  assert.match(panelBody, /preserveFormatting\s*=\s*event\.preserveFormatting\s*\|\|\s*false/i, 'formatting preservation option is respected');
  assert.match(panelBody, /markdown\s*=\s*customAnswer/i, 'markdown content is preserved when requested');
});

test('multi-select question flow: multiple choices -> validation -> array submission', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
  );

  // Multi-select detection
  assert.match(panelBody, /event\.multiSelect\s*===\s*true/, 'multiSelect flag is checked');
  assert.match(messageHandlerSource, /multiSelect:\s*questionLike\.multiSelect\s*===\s*true/, 'multiSelect is preserved in normalization');

  // Multi-select UI rendering
  assert.match(panelBody, /multiSelect.*?checkbox/i, 'checkboxes are shown for multi-select');
  assert.match(panelBody, /event\.options\.map\(\s*option\s*=>\s*\{[\s\S]*type:\s*["']checkbox"']/i, 'each option renders as checkbox');

  // Selection state management
  assert.match(panelBody, /const\s*\[selectedOptions,\s*setSelectedOptions\]\s*=\s*useState\(\s*\[\]\s*\)/, 'selected options are tracked in array');
  assert.match(panelBody, /onChange=\{\s*\(\s*option\s*\)\s*=>\s*handleOptionToggle\(option\)\}/, 'option changes update selection');

  // Multi-select validation
  assert.match(panelBody, /const\s*isValid\s*=\s*selectedOptions\.length\s*>\s*0/, 'validation checks for at least one selection');
  assert.match(panelBody, /minSelect\s*=\s*event\.minSelect\s*\|\|\s*1/i, 'minimum selection requirement is enforced');
  assert.match(panelBody, /maxSelect\s*=\s*event\.maxSelect\s*\|\|\s*options\.length/i, 'maximum selection limit is enforced');

  // Multi-select submission
  assert.match(panelBody, /response:\s*selectedOptions/, 'response includes array of selected options');
  assert.match(panelBody, /selectedOptions\.join\(\s*["']\|\|["']\s*\)/, 'selected options are joined with pipe delimiter');

  // Selection feedback
  assert.match(panelBody, /selectedOptions\.length\s*>\s*0[\s\S]*\{\s*selectedOptions\.join\(\s*["']\,\s*["']\s*\)/, 'selected options are displayed');
  assert.match(panelBody, /\d+\s+selected/i, 'selection count is shown');
});

// ===========================================================================
// MULTI-QUESTION HANDLING
// ===========================================================================

test('multi-question flow: question batch -> sequential processing -> completion', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Question batch detection
  assert.match(panelBody, /const\s+hasMultipleInteractivePrompts\s*=\s*batch\.length\s*>\s*1/, 'multiple questions are detected');
  assert.match(panelBody, /batch\s*=\s*interactiveEvents/, 'question batch is available');

  // Sequential processing
  assert.match(panelBody, /const\s*\[currentQuestionIndex,\s*setCurrentQuestionIndex\]\s*=\s*useState\(\s*0\s*\)/, 'current question index is tracked');
  assert.match(panelBody, /const\s*currentQuestion\s*=\s*batch\[currentQuestionIndex\]/, 'current question is extracted from batch');

  // Question progression
  assert.match(panelBody, /if\s*\(\s*!hasMultipleInteractivePrompts\s*\)\s*\{[\s\S]*return\s*answer;/, 'single question returns immediately');
  assert.match(panelBody, /if\s*\(\s*currentQuestionIndex\s*<\s*batch\.length\s*-\s*1\s*\)\s*\{[\s\S]*setCurrentQuestionIndex\(currentQuestionIndex\s*\+\s*1\)/, 'index advances for next question');

  // Multi-question answer composition
  assert.match(panelBody, /Question\s*\$\{\s*index\s*\+\s*1\s*\}:\s*\$\{\s*question\}[\s\S]*Answer:\s*\$\{\s*answer\}/, 'answers are composed with question numbers');
  assert.match(panelBody, /answers\.push\(\s*\{\s*question:\s*currentQuestion\.question,\s*answer\s*\}\s*\)/, 'answers are accumulated in array');

  // Completion handling
  assert.match(panelBody, /currentQuestionIndex\s*===\s*batch\.length\s*-\s*1[\s\S]*submitInteractiveResponse\(/, 'final response is submitted when all questions answered');
  assert.match(panelBody, /response:\s*answers/, 'complete answer set is submitted');

  // Progress indicator
  assert.match(panelBody, /Question\s*\$\{currentQuestionIndex\s*\+\s*1\}\s+of\s+\$\{batch\.length\}/, 'progress shows current and total');
  assert.match(panelBody, /progress.*value.*currentQuestionIndex.*batch\.length/, 'progress bar shows completion');
});

// ===========================================================================
// INTERACTIVE FLOW INTEGRATION WITH CHAT
// ===========================================================================

test('interactive flow integration: question pauses chat -> answer resumes -> continues', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // Chat pause on question
  assert.match(handlerBody, /hasBlockingInteractive\s*=\s*interactiveEvents\.some\(\s*event\s*=>\s*isBlockingInteractive\(event\s*\)\s*\)/, 'blocking questions are detected');
  assert.match(handlerBody, /if\s*\(\s*hasBlockingInteractive\s*\)\s*\{[\s\S]*FINISH_STREAMING\(\s*\)/, 'streaming is paused for blocking questions');
  assert.match(reducerBody, /isActive:\s*false/, 'streaming state becomes inactive');

  // User interaction processing
  assert.match(handlerBody, /case\s+["']sendMessage"']:\s*\{[\s\S]*if\s*\(\s*message\.interactiveSubmit\s*\)\s*\{[\s\S]*forceSendNow:\s*true/, 'interactive answer sends immediately');
  assert.match(handlerBody, /SET_PROCESSING\(\s*true\s*\)/, 'processing is set for interactive answer');

  // Chat resume after answer
  assert.match(handlerBody, /SET_INTERACTIVE_EVENTS.*?payload:\s*\[\]/, 'interactive events are cleared');
  assert.match(handlerBody, /SET_STREAMING.*?isActive:\s*true/, 'streaming is resumed');
  assert.match(reducerBody, /isProcessing:\s*true/, 'processing state continues');

  // State preservation across interaction
  assert.match(reducerBody, /streamingBySessionId:\s*cacheStreamingForSession\(/, 'streaming state is preserved during pause');
  assert.match(handlerBody, /messages:\s*state\.messages/, 'message history is maintained');

  // Seamless continuation
  assert.match(handlerBody, /sessionId\s*===\s*originalSessionId/, 'same session is used for continuation');
  assert.match(handlerBody, /model:\s*cachedModel\s*\|\|\s*state\.model/, 'model information is preserved');
});

test('interactive flow with subagents: question -> subagent response -> final answer', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // Question during subagent operation
  assert.match(handlerBody, /subagents\.some\(\s*s\s*=>\s*s\.status\s*===\s*["']running"'][\s\S]*interactive/i, 'questions during subagent activity are detected');
  assert.match(handlerBody, /if\s*\(\s*hasBlockingInteractive\s*\)\s*\{[\s\S]*FINISH_STREAMING\(\s*\)/, 'subagent streaming is paused for question');

  // Interactive events with subagent context
  assert.match(handlerBody, /subagentContext\s*=\s*getSubagentContext\(\s*getState,\s*eventId\s*\)/, 'subagent context is extracted');
  assert.match(reducerBody, /interactiveEvents.*?subagentId/i, 'interactive events can include subagent reference');

  // Answer processing with subagent awareness
  assert.match(handlerBody, /message\.subagentAnswer\s*=\s*true/i, 'subagent answers are flagged');
  assert.match(handlerBody, /if\s*\(\s*message\.subagentAnswer\s*\)\s*\{[\s\S]*type:\s*["']subagentAnswer"']/i, 'subagent answers use special handling');

  // Subagent resume after answer
  assert.match(handlerBody, /type:\s*["']subagentAnswer"'][\s\S]*subagentId:\s*message\.subagentId/i, 'answer is routed to correct subagent');
  assert.match(handlerBody, /resumeSubagentProcessing\(\s*message\.subagentId\s*\)/, 'subagent processing is resumed');

  // Final answer integration
  assert.match(handlerBody, /subagentResponse\s*=\s*message\.response/i, 'subagent response is extracted');
  assert.match(handlerBody, /type:\s*["']sendMessage"'][\s\S]*text:\s*subagentResponse/, 'subagent response is sent as message');
});