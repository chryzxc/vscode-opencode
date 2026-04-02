import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readAllSources, readSource } from '../helpers/source-utils.mjs';

const providerSource = readAllSources([joinFromRoot('src', 'providers', 'ChatViewProvider.ts'), joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'), joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'), joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'), joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'), joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'), joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
  'ChatViewProvider.ts',
);
const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);
const handlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const messageSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);
const typesSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'types.ts')],
  'types.ts',
);

test('structured output schema supports interactive event types', () => {
  const schemaSource = readSource(
    [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
    'structuredOutputSchema.ts',
  );
  const schemaText = schemaSource;
  assert.match(schemaText, /question:\s*{/, 'schema should declare top-level question payload');
  assert.match(schemaText, /"question"/, 'schema should allow question response type');
  assert.match(schemaText, /"quick_actions"/, 'schema should allow quick_actions interactive event type');
  assert.match(schemaText, /"confirm"/, 'schema should allow confirm interactive event type');
  assert.match(schemaText, /"message"/, 'schema should allow message interactive event type');
  assert.match(schemaText, /options/, 'schema should declare question options payload');
});

test('structured output schema is defined in shared module', () => {
  assert.match(
    providerSource,
    /structuredOutputSchema/,
    'provider should reference shared structuredOutputSchema'
  );
});

test('provider accepts interactive responses from webview', () => {
  assert.match(providerSource, /case "interactiveResponse"/, 'provider should handle interactiveResponse webview messages');
  assert.match(providerSource, /case "batchInteractiveResponse"/, 'provider should handle batchInteractiveResponse webview messages');
  assert.match(providerSource, /dispatchInteractiveResponse\(/, 'interactive responses should route through dedicated dispatch helper');
  assert.match(providerSource, /\[interactive:\$\{eventType\}:\$\{eventId\}\]/, 'batch interactive responses should preserve event context in the composed prompt');
});

test('provider suppresses timeout errors while awaiting interactive answers', () => {
  assert.match(
    providerSource,
    /hasBlockingInteractiveInStreamPayload\(/,
    'provider should detect blocking interactive payloads from stream events',
  );
  assert.match(
    providerSource,
    /awaitingInteractiveAnswer\s*=\s*true/,
    'provider should mark interactive wait state when a blocking question is streamed',
  );
  assert.match(
    providerSource,
    /awaitingInteractiveAnswer[\s\S]*isLikelyInteractiveAwaitTimeoutError\(errorMessage\)[\s\S]*Suppressing timeout error while awaiting interactive response/s,
    'provider should suppress timeout errors caused by interactive-wait turns',
  );
});

test('frontend normalizes and stores interactive events', () => {
  assert.match(handlerSource, /toInteractiveEvents\(/, 'message handler should map structured output to interactive events');
  assert.match(handlerSource, /SET_INTERACTIVE_EVENTS/, 'message handler should update interactive event state');
  assert.match(handlerSource, /typeRaw\s*===\s*'question'/, 'question payloads should be gated by typed responseType');
  assert.match(handlerSource, /typeRaw\s*===\s*'message'/, 'message handler should normalize message interactive event type');
  assert.match(handlerSource, /options\.length < 2/, 'question interactive events should require at least two options');
  assert.doesNotMatch(handlerSource, /return\s+detectInteractiveEventsFromText\(/, 'plain assistant text should not auto-generate interactive popups');
  assert.doesNotMatch(handlerSource, /const\s+interactiveEvents\s*=\s*detectInteractiveEventsFromText\(/, 'streaming completion should not infer popup questions from text heuristics');
});

test('interactive wait timeout is suppressed instead of rendering a hard error banner', () => {
  assert.match(
    handlerSource,
    /function isLikelyInteractiveAwaitTimeout\(/,
    'message handler should classify timeout errors that occur while waiting for interactive responses',
  );
  assert.match(
    handlerSource,
    /pendingBlockingInteractive[\s\S]*isLikelyInteractiveAwaitTimeout\(errorMsg\)/s,
    'error handler should gate timeout suppression on active blocking interactive events',
  );
  assert.match(
    handlerSource,
    /suppressAsAwaitingInteractive[\s\S]*SET_PROCESSING[\s\S]*FINISH_STREAMING[\s\S]*break;/s,
    'interactive-timeout suppression path should end loading state without showing request failure',
  );
});

test('structured question outputs dispatch popup interactive state', () => {
  assert.match(
    handlerSource,
    /const interactiveEvents = toInteractiveEvents\(structuredOutput\);[\s\S]*dispatch\(\{ type: 'SET_INTERACTIVE_EVENTS', payload: interactiveEvents \}\);/s,
    'message completion path should dispatch interactive popup events from structured output',
  );
  assert.match(
    handlerSource,
    /type:\s*'question',[\s\S]*question,\s*options,/s,
    'question responses should preserve question text and options for popup rendering',
  );
  assert.doesNotMatch(
    providerSource,
    /Coerced question response into fallback question event/,
    'provider should not coerce malformed question responses into synthetic fallback events',
  );
});

test('webview question normalization preserves question payloads from info.structured source', () => {
  assert.match(
    handlerSource,
    /const normalizedQuestion = asRecord\(sanitizedRec\.question\) \?\? asRecord\(rec\.question\);/,
    'message handler should preserve sanitized question payloads for interactive rendering',
  );
  assert.match(
    handlerSource,
    /normalizeStructuredOutput\(\(asRecord\(rec\.info\) as UnknownRecord \| null\)\?\.structured\)/,
    'interactive event extraction should support info.structured payloads',
  );
  assert.match(
    handlerSource,
    /rootQuestion && rootOptions\.length < 2[\s\S]*\? \[\]/,
    'question fallback should keep free-form question input when options are unavailable',
  );
});

test('implementation_plan normalization preserves plan card payload and summary across stream and hydration', () => {
  assert.match(
    handlerSource,
    /type StructuredOutput = \{[\s\S]*plan\?: \{[\s\S]*file\?: string;[\s\S]*summary\?: string;[\s\S]*\};/s,
    'structured output shape should include plan payload fields for implementation plans',
  );
  assert.match(
    handlerSource,
    /const planRec = asRecord\(sanitizedRec\.plan\) \?\? asRecord\(rec\.plan\);/,
    'normalizeStructuredOutput should parse plan from sanitized and raw structured payloads',
  );
  assert.match(
    handlerSource,
    /!normalizedQuestion &&[\s\S]*!hasNormalizedPlan &&[\s\S]*cleanedReasoning\.length === 0/s,
    'normalizeStructuredOutput should not drop plan-only structured payloads',
  );
  assert.match(
    handlerSource,
    /if \(\s*\(!normalized\.plan \|\| typeof normalized\.plan !== "object"\)[\s\S]*normalizedStructuredOutput\.plan[\s\S]*normalized\.plan = \{[\s\S]*\.\.\.normalizedStructuredOutput\.plan/s,
    'normalizeMessage should hydrate message.plan from structured output when top-level plan is absent',
  );
  assert.match(
    handlerSource,
    /responseType === "implementation_plan"[\s\S]*summaryFromPlan[\s\S]*isImplementationPlanPlaceholderBody\(currentContent\)[\s\S]*normalized\.content = summaryFromPlan;/s,
    'normalizeMessage should render implementation plan summary instead of generic placeholder text',
  );
  assert.match(
    messageSource,
    /const showResponseSection = hasResponseContent \|\| !!plan;/,
    'assistant message renderer should display response section when a plan card exists, even without body content',
  );
});

test('streaming question turns also synthesize assistant-bubble prompt text', () => {
  assert.match(
    handlerSource,
    /function maybeInjectStreamingInteractiveContext\(/,
    'message handler should define a helper that injects interactive prompt text into streaming content',
  );
  assert.match(
    handlerSource,
    /SET_INTERACTIVE_EVENTS[\s\S]*maybeInjectStreamingInteractiveContext\(/,
    'streaming interactive-event paths should inject question context into the assistant bubble',
  );
  assert.match(
    handlerSource,
    /const toolInteractiveEvents = interactiveEventsFromToolQuestionPart\(part\);[\s\S]*maybeInjectStreamingInteractiveContext\(/s,
    'tool-question streaming path should synthesize assistant prompt text from tool interactive events',
  );
  assert.match(
    handlerSource,
    /if \(eventRole === "user"\)[\s\S]*SET_PROCESSING[\s\S]*break;/s,
    'stream handler should ignore regular user-role parts so they do not overwrite assistant streaming content',
  );
  assert.match(
    handlerSource,
    /looksLikeReasoningTrace\(trimmed,\s*""\)[\s\S]*looksLikeToolUseMonologue\(trimmed\)/s,
    'interactive prompt replacement should also override leaked reasoning/tool-monologue content',
  );
});

test('input wrapper renders top popup choices and posts batchInteractiveResponse', () => {
  const inputBody = extractFunctionBody(
    panelSource,
    'export function InputWrapper()',
  );

  assert.match(inputBody, /activeInteractiveEvent/, 'input wrapper should compute active interactive event');
  assert.match(inputBody, /Quick Input/, 'input wrapper should render a top prompt popup');
  assert.match(inputBody, /event\.type === "question"/, 'popup should support question-type interactive events');
  assert.match(inputBody, /event\.type === "message"/, 'popup should support message-type interactive events');
  assert.match(inputBody, /event\.options\.map\(/, 'question popup should render clickable option buttons');
  assert.match(inputBody, /type:\s*"batchInteractiveResponse"/, 'popup choice clicks should post batchInteractiveResponse');
});

test('interactive batch payload includes user-facing display text for persistence', () => {
  const inputBody = extractFunctionBody(
    panelSource,
    'export function InputWrapper()',
  );

  assert.match(
    inputBody,
    /displayText/,
    'batch interactive submit path should compute user-facing displayText',
  );
  assert.match(
    inputBody,
    /questionLabel/,
    'batch interactive responses should include question labels for deterministic display reconstruction',
  );
  assert.match(
    inputBody,
    /type:\s*"batchInteractiveResponse"[\s\S]*displayText/s,
    'batchInteractiveResponse payload should include displayText',
  );
});

test('provider persists interactive answers as display text while preserving marker transport text', () => {
  assert.match(
    providerSource,
    /message\?\.displayText/,
    'provider should accept optional displayText from batchInteractiveResponse payloads',
  );
  assert.match(
    providerSource,
    /userFacingText/,
    'provider interactive dispatch path should carry user-facing text separately from transport text',
  );
  assert.match(
    providerSource,
    /content:\s*persistedUserText[\s\S]*parts:\s*\[[\s\S]*text:\s*text/s,
    'persisted user messages should store display content while keeping transport marker text in parts',
  );
});

test('chat-history hydration reconstructs marker-only interactive user messages', () => {
  assert.match(
    handlerSource,
    /function hydrateLegacyInteractiveUserMessages\(/,
    'message handler should define legacy marker-only hydration reconstruction',
  );
  assert.match(
    handlerSource,
    /containsInteractiveMarker\(/,
    'legacy hydration should detect marker-based interactive messages',
  );
  assert.match(
    handlerSource,
    /content:\s*displayText[\s\S]*text:\s*displayText/s,
    'legacy hydration should restore question+answer display text on user messages',
  );
  assert.match(
    handlerSource,
    /hydrateLegacyInteractiveUserMessages\(messages\)/,
    'chatHistory path should apply legacy interactive hydration fallback',
  );
  assert.match(
    handlerSource,
    /dedupeInteractiveUserHydrationMessages\(hydratedMessages\)/,
    'chatHistory path should dedupe duplicate interactive user hydration messages',
  );
  assert.match(
    handlerSource,
    /function dedupeInteractiveUserHydrationMessages\(/,
    'message handler should define interactive hydration dedupe helper',
  );
  assert.match(
    handlerSource,
    /if \(latestInteractive\.length === 0 && canonicalMessages\.length > 0\)[\s\S]*lastResponseType\.toLowerCase\(\) === "question"[\s\S]*latestInteractive = interactiveEventsFromMessage\(lastMessage\);/s,
    'chatHistory should restore popover when the latest hydrated message is a question',
  );
  assert.match(
    handlerSource,
    /const stabilizedHydratedMessages = dedupedHydratedMessages\.map\([\s\S]*const canonicalMessages = stabilizedHydratedMessages;/s,
    'chatHistory should build canonical hydrated messages from the normalized/deduped hydration pipeline',
  );
  assert.match(
    handlerSource,
    /if \(normalizedStructuredOutput\) \{[\s\S]*toInteractiveEvents\(\s*normalizedStructuredOutput,\s*\)[\s\S]*normalized\.interactiveEvents = structuredInteractiveEvents;/s,
    'normalizeMessage should materialize structured interactive events so hydration keeps popovers renderable',
  );
  assert.match(
    handlerSource,
    /if \(!normalized\.content\?\.trim\(\)\) \{[\s\S]*synthesizeQuestionContextMessage\(structuredEvents\)/s,
    'normalizeMessage should synthesize assistant question text from structured interactive events when content is empty',
  );
  assert.match(
    handlerSource,
    /if \(interactiveEventsFromMessage\(message\)\.length > 0\) \{\s*return true;\s*\}/,
    'renderable-history guard should keep structured interactive-only messages during hydration',
  );
});

test('stream handling clears stale terminal error guard once a new request is processing', () => {
  assert.match(
    handlerSource,
    /if \(terminalErrorReached && getState\(\)\.isProcessing\) \{\s*terminalErrorReached = false;\s*\}/,
    'streamEvent path should clear stale terminal-error lock when a new request starts processing',
  );
  assert.match(
    handlerSource,
    /case "chatHistory": \{[\s\S]*terminalErrorReached = false;/s,
    'chatHistory hydration should reset terminal error guard for resumed sessions',
  );
});

test('assistant question responses prioritize question prompt in visible message body', () => {
  assert.match(
    messageSource,
    /function questionPromptFromMessage\(/,
    'assistant renderer should derive canonical question prompt from interactive payloads',
  );
  assert.match(
    messageSource,
    /if \(isQuestionResponseType\) \{[\s\S]*return questionPrompt;[\s\S]*\}/s,
    'question responses should render only questionPrompt in the assistant bubble',
  );
  assert.match(
    messageSource,
    /isLowValueInteractiveBodyText\(/,
    'assistant renderer should ignore low-value placeholder-only body text for question turns',
  );
});

test('structured question contract supports dedicated assistant-bubble display prompt', () => {
  const schemaSource = readSource(
    [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
    'structuredOutputSchema.ts',
  );
  assert.match(
    schemaSource,
    /displayPrompt:\s*{/,
    'question schema should include displayPrompt for assistant bubble formatting',
  );
  assert.match(
    providerSource,
    /questionRecord\?\.displayPrompt/,
    'provider should read question.displayPrompt when shaping question turns',
  );
  assert.match(
    messageSource,
    /question\?\.displayPrompt/,
    'webview assistant renderer should prefer question.displayPrompt for visible question text',
  );
});

test('structured plan file examples avoid hardcoded .sisyphus bias', () => {
  const schemaSource = readSource(
    [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
    'structuredOutputSchema.ts',
  );
  assert.match(
    schemaSource,
    /\/workspace\/project\/plans\/todo-feature\.md/,
    'plan.file examples should use neutral workspace plan paths',
  );
  assert.doesNotMatch(
    schemaSource,
    /\/\.sisyphus\/plans\//,
    'structured output schema examples should not hardcode .sisyphus plan paths',
  );
});

test('interactive event domain types are defined', () => {
  assert.match(typesSource, /export interface InteractiveQuestionEvent/, 'types should define InteractiveQuestionEvent');
  assert.match(typesSource, /export interface InteractiveConfirmEvent/, 'types should define InteractiveConfirmEvent');
  assert.match(typesSource, /export interface InteractiveQuickActionsEvent/, 'types should define InteractiveQuickActionsEvent');
  assert.match(typesSource, /export interface InteractiveMessageEvent/, 'types should define InteractiveMessageEvent');
});
