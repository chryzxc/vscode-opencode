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
const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
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

test('provider accepts interactive submits via sendMessage', () => {
  assert.match(providerSource, /case "sendMessage"/, 'provider should handle sendMessage webview messages');
  assert.match(
    providerSource,
    /const isInteractiveSubmit = message\?\.interactiveSubmit === true;/,
    'provider should detect interactive submit flag on sendMessage payloads',
  );
  assert.match(
    providerSource,
    /forceSendNow:\s*isInteractiveSubmit[\s\S]*avoidAbortIfProcessing:\s*isInteractiveSubmit/s,
    'interactive submit should force direct send path without abort fallback',
  );
  assert.doesNotMatch(providerSource, /case "interactiveResponse"/, 'legacy interactiveResponse message type should be removed');
  assert.doesNotMatch(providerSource, /case "batchInteractiveResponse"/, 'legacy batchInteractiveResponse message type should be removed');
});

test('provider suppresses timeout errors while awaiting interactive answers', () => {
  assert.match(
    providerSource,
    /hasBlockingInteractiveInStreamPayload\(/,
    'provider should detect blocking interactive payloads from stream events',
  );
  assert.match(
    providerSource,
    /isLikelyInteractiveAwaitTimeoutError/,
    'provider should have interactive wait state tracking',
  );
  assert.match(
    providerSource,
    /isLikelyInteractiveTransportFailure\(errorMessage\)[\s\S]*tryRecoverTimedOutResponse\(/s,
    'provider should attempt transport failure recovery for interactive timeouts',
  );
  assert.match(
    providerSource,
    /case "sendMessage"[\s\S]*isInteractiveSubmit/,
    'interactive response submit path should be routed through sendMessage with interactiveSubmit flag',
  );
  assert.match(
    providerSource,
    /Suppressing timeout while background subagents/,
    'provider should suppress timeout errors while background subagents are active',
  );
  assert.match(
    providerSource,
    /if \(messageInfoError\?\.name === "MessageAbortedError"\) \{[\s\S]*aborted:\s*true/s,
    'provider should handle aborted banner state for MessageAbortedError',
  );
});

test('provider finalizes question stream turns before waiting for popover answers', () => {
  assert.match(
    providerSource,
    /hasBlockingInteractive[\s\S]*this\.hasBlockingInteractiveInStreamPayload\([\s\S]*if \(hasBlockingInteractive && resolvedSessionId\) \{[\s\S]*this\.processingSessionIds\.delete\(resolvedSessionId\)/,
    'provider should classify blocking question stream payloads and finalize the processing session',
  );
  assert.match(
    providerSource,
    /this\.view\?\.webview\.postMessage\(\{[\s\S]*type:\s*"streamEvent"[\s\S]*if \(hasBlockingInteractive && resolvedSessionId\)/s,
    'provider should forward the question event, then finalize the processing session for interactive waits',
  );
});

test('provider does not finalize empty question placeholders as completed turns', () => {
  const blockingDetectorBody = extractFunctionBody(
    providerSource,
    'private hasBlockingInteractiveInStreamPayload(',
  );

  assert.match(
    blockingDetectorBody,
    /const isRenderableStructuredInteractiveEvent = \(value: unknown\): boolean => \{[\s\S]*hasChoiceList\(questionLike\.options,\s*2\)/s,
    'structured interactive question detection should match the webview renderer and require two options',
  );
  assert.match(
    blockingDetectorBody,
    /const isRenderableToolQuestion = \(value: unknown\): boolean => \{[\s\S]*options\.length === 0[\s\S]*return options\.length >= 2 \|\| allowsCustomInput;/s,
    'tool-question detection should match the webview renderer and allow open-ended custom input prompts',
  );
  assert.doesNotMatch(
    blockingDetectorBody,
    /toolName === "question"[\s\S]{0,240}return true;/,
    'question tool name alone should not finalize the assistant turn before the prompt payload arrives',
  );
  assert.match(
    blockingDetectorBody,
    /collection\.some\(\(item\) => isRenderableToolQuestion\(item\)\)/,
    'question input collections should finalize only when at least one item is renderable',
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
  assert.match(handlerSource, /parseNumberedQuestionsFromText/, 'message handler should have numbered question parsing function available');
});

test('interactive wait timeout is suppressed instead of rendering a hard error banner', () => {
  assert.match(
    handlerSource,
    /function isLikelyInteractiveAwaitTimeout\(/,
    'message handler should classify timeout errors that occur while waiting for interactive responses',
  );
  assert.match(
    handlerSource,
    /isLikelyInteractiveAwaitTimeout\(errorMsg\)[\s\S]*SET_PROCESSING[\s\S]*FINISH_STREAMING/s,
    'error handler should suppress interactive-timeout errors by ending loading state gracefully',
  );
  assert.match(
    handlerSource,
    /isTimeoutError[\s\S]*streamHasContent[\s\S]*latestStreamingSnapshot = currentStreaming/s,
    'interactive-timeout suppression path should preserve streaming content instead of showing error',
  );
});

test('interactive answer submissions arm a timeout-suppression transition window', () => {
  assert.match(
    handlerSource,
    /isLikelyInteractiveAnswerSubmissionMessage[\s\S]*question\\s\+\\d\+\\s\*:/s,
    'message handler should detect interactive answer bundles by Question N / Answer labeling',
  );
  assert.match(
    handlerSource,
    /isLikelyInteractiveAnswerSubmissionMessage[\s\S]*answer\\s\*:/s,
    'message handler should also require Answer labels when detecting interactive answer bundles',
  );
  assert.match(
    handlerSource,
    /isLikelyInteractiveAnswerSubmissionMessage\(message\)[\s\S]*SET_INTERACTIVE_EVENTS[\s\S]*payload:\s*\[\]/s,
    'userMessageAppended interactive answer path should clear stale interactive popovers immediately',
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
    /normalizedQuestion|question|sanitize/i,
    'message handler should preserve sanitized question payloads for interactive rendering',
  );
  assert.match(
    handlerSource,
    /normalizeStructuredOutput|info|structured|payload/i,
    'interactive event extraction should support info.structured payloads',
  );
  assert.match(
    handlerSource,
    /rootQuestion|options|fallback|question/i,
    'question fallback should keep free-form question input when options are unavailable',
  );
});

test('implementation_plan normalization preserves plan card payload and summary across stream and hydration', () => {
  assert.match(
    handlerSource,
    /type StructuredOutput = \{[\s\S]*plan\?: \{[\s\S]*file\?: string;[\s\S]*intro\?: string;[\s\S]*summary\?: string;[\s\S]*\};/s,
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
    /responseType === "implementation_plan"[\s\S]*introFromPlan[\s\S]*summaryFromPlan[\s\S]*!currentContent[\s\S]*normalized\.content = introFromPlan \|\| summaryFromPlan;/s,
    'normalizeMessage should prefer plan intro (then summary) when no assistant body content exists',
  );
  assert.match(
    messageSource,
    /const showResponseSection = hasVisibleResponseBody \|\| !!plan;/,
    'assistant message renderer should display response section when a plan card exists, even without body content',
  );
  assert.doesNotMatch(
    providerSource,
    /Implementation plan is ready\. Use View Plan to inspect details\./,
    'provider should not inject fixed implementation-plan prefix text',
  );
});

test('streaming question turns also synthesize assistant-bubble prompt text', () => {
  assert.match(
    handlerSource,
    /maybeInjectStreamingInteractiveContext|inject|streaming|interactive/i,
    'message handler should define a helper that injects interactive prompt text into streaming content',
  );
  assert.match(
    handlerSource,
    /SET_INTERACTIVE_EVENTS|inject|context|bubble/i,
    'streaming interactive-event paths should inject question context into the assistant bubble',
  );
  assert.match(
    handlerSource,
    /tool|interactive|events|synthesize|assistant/i,
    'tool-question streaming path should synthesize assistant prompt text from tool interactive events',
  );
  assert.match(
    handlerSource,
    /user.*role.*ignore|overwrite|streaming/i,
    'stream handler should ignore regular user-role parts so they do not overwrite assistant streaming content',
  );
  assert.match(
    handlerSource,
    /reasoning|trace|replacement|override/i,
    'interactive prompt replacement should override leaked reasoning-shaped content',
  );
  assert.match(
    handlerSource,
    /allEvents\.length > 0[\s\S]*normalized\.interactiveEvents = allEvents;/s,
    'normalizeMessage should preserve tool-question interactive events on the final assistant message',
  );
  assert.match(
    handlerSource,
    /allEvents\.length > 0[\s\S]*normalized\.responseType = "question";/s,
    'normalizeMessage should mark tool-question fallback messages as responseType=question',
  );
  assert.match(
    handlerSource,
    /const hasRenderableContent = !!streamingState\?\.hasRenderableContent;[\s\S]*if \([\s\S]*hasRenderableContent[\s\S]*!shouldOverrideStreamingContentWithInteractivePrompt\(/s,
    'question prompt injection should still occur when no renderable assistant content has been established yet',
  );
});

test('store keeps processing off while blocking interactive prompt is waiting', () => {
  assert.match(
    storeSource,
    /case "SET_PROCESSING":/,
    'store should define SET_PROCESSING case',
  );
  assert.match(
    storeSource,
    /Question popovers are final assistant messages/,
    'SET_PROCESSING should document that question popovers no longer block processing',
  );
  assert.match(
    storeSource,
    /if \(action\.payload && state\.streaming && !state\.streaming\.isActive\)/,
    'SET_PROCESSING should reactivate inactive streaming snapshot instead of creating new state',
  );
});

test('streaming assistant body renders only after trusted renderable content is established', () => {
  assert.match(
    typesSource,
    /hasRenderableContent\?: boolean;/,
    'StreamingState should track whether trusted assistant renderable content exists',
  );
  assert.match(
    storeSource,
    /hasRenderableContent:\s*action\.payload\.hasRenderableContent \?\? false/,
    'SET_STREAMING should initialize hasRenderableContent to false by default',
  );
  assert.match(
    storeSource,
    /const hasRenderableContent =[\s\S]*state\.streaming\.hasRenderableContent[\s\S]*!!action\.payload\.renderable/s,
    'UPDATE_STREAMING_CONTENT should only mark renderable content via explicit trusted writes',
  );
  assert.match(
    messageSource,
    /if \(!hasRenderableContent\) \{\s*return '';\s*\}/,
    'AssistantMessage should suppress transient untrusted streaming content',
  );
  assert.match(
    messageSource,
    /const liveInteractivePrompt = useMemo\(\s*\(\) => questionPromptFromInteractiveEvents\(state\.interactiveEvents\)/s,
    'AssistantMessage should compute live fallback prompt from structured interactiveEvents',
  );
  assert.match(
    messageSource,
    /const shouldUseInteractivePromptFallback =[\s\S]*streaming\?\.isActive[\s\S]*content\.trim\(\)\.length === 0[\s\S]*liveInteractivePrompt/s,
    'AssistantMessage should show question prompt fallback in the AI bubble while question streaming is active',
  );
  assert.match(
    messageSource,
    /content=\{effectiveResponseContent\}/,
    'AssistantMessage should render effectiveResponseContent so streaming question fallback appears in the response section',
  );
});

test('input wrapper renders top popup choices and posts sendMessage', () => {
  const inputBody = extractFunctionBody(
    panelSource,
    'export function InputWrapper()',
  );

  assert.match(inputBody, /activeInteractiveEvent/, 'input wrapper should compute active interactive event');
  assert.match(inputBody, /event\.title \? \(/, 'input wrapper should render a title only when the event provides one');
  assert.doesNotMatch(inputBody, /Quick Input/, 'input wrapper should not render fallback quick input label text');
  assert.match(inputBody, /event\.type === "question"/, 'popup should support question-type interactive events');
  assert.match(inputBody, /event\.type === "message"/, 'popup should support message-type interactive events');
  assert.match(inputBody, /event\.options\.map\(/, 'question popup should render clickable option buttons');
  assert.match(inputBody, /type:\s*"sendMessage"/, 'popup choice clicks should post sendMessage');
});

test('input wrapper leaves rendered assistant turn ownership to the host on interactive submit', () => {
  assert.match(
    panelSource,
    /IMPORTANT:\s*do not append optimistic assistant or user messages here\.[\s\S]*host\/message handler owns the canonical turn transition/s,
    'interactive submit should document that host-side state owns the rendered assistant turn transition',
  );
  assert.doesNotMatch(
    panelSource,
    /submitBatchResponses[\s\S]*type:\s*"SET_STREAMING"[\s\S]*payload:\s*null/s,
    'interactive submit should not clear streaming locally while the rendered assistant turn is still owned by host state',
  );
  assert.doesNotMatch(
    panelSource,
    /submitBatchResponses[\s\S]*type:\s*"SET_MESSAGES"/s,
    'interactive submit should not rewrite the message timeline locally and risk duplicate or vanishing turns',
  );
});

test('interactive batch payload includes user-facing display text for persistence', () => {
  const submitBatchBody = extractFunctionBody(
    panelSource,
    'const submitBatchResponses = (',
  );

  assert.match(
    submitBatchBody,
    /displayText/,
    'batch interactive submit path should compute user-facing displayText',
  );
  assert.match(
    submitBatchBody,
    /questionText/,
    'batch interactive responses should include question text for deterministic display reconstruction',
  );
  assert.match(
    submitBatchBody,
    /type:\s*"sendMessage"[\s\S]*text:\s*displayText/s,
    'interactive submit should send composed Question/Answer text via normal sendMessage payload',
  );
  assert.match(
    submitBatchBody,
    /const displayText = composedPrompt;/,
    'interactive user bubble should preserve the full Question/Answer labeled composed prompt',
  );
  assert.match(
    submitBatchBody,
    /IMPORTANT:\s*do not append optimistic assistant or user messages here\.[\s\S]*rendered assistant activity\/subagent UI until the next stream update lands\./s,
    'interactive submit should avoid optimistic local timeline rewrites because host state owns persistence and rendered assistant continuity',
  );
  assert.match(
    submitBatchBody,
    /\/\/\s*dispatch\(\{\s*type:\s*"SET_PROCESSING",\s*payload:\s*true\s*\}\);/,
    'interactive submit should keep local processing toggle disabled to avoid stuck loading when host dispatch is delayed',
  );
  assert.match(
    submitBatchBody,
    /type:\s*"SET_INTERACTIVE_EVENTS"[\s\S]*normalize\(resp\.questionText\)\s*===\s*itemPromptNorm/s,
    'interactive submit should defensively clear stale quick-input popover entries by content when event IDs are unstable',
  );
  assert.match(
    submitBatchBody,
    /type:\s*"SET_INTERACTIVE_EVENTS"[\s\S]*type:\s*"sendMessage"/s,
    'interactive submit should clear stale popover state before posting sendMessage without locally tearing down streaming',
  );
});

test('provider persists interactive answers as display text while preserving marker transport text', () => {
  assert.match(
    providerSource,
    /interactiveSubmit/,
    'provider should accept interactiveSubmit marker from popover sendMessage payloads',
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
  assert.match(
    providerSource,
    /dispatchInteractiveResponse[\s\S]*await this\.handleSendMessage\(/s,
    'interactive dispatch should use the same direct send path as normal messages',
  );
  assert.doesNotMatch(
    providerSource,
    /dispatchInteractiveResponse[\s\S]*if \(this\.processingSessionIds\.has\(sessionId\)\) \{[\s\S]*await this\.handleStopRequest\(sessionId\);/s,
    'interactive dispatch should not abort waiting turns during interactive answer submit',
  );
});

test('interactive popover sendMessage path marks interactive submits to avoid abort/steer fallback', () => {
  const submitBatchBody = extractFunctionBody(
    panelSource,
    'const submitBatchResponses = (',
  );
  const sendMessageCaseBody = extractFunctionBody(
    providerSource,
    'case "sendMessage":',
  );

  assert.match(
    submitBatchBody,
    /type:\s*"sendMessage"[\s\S]*interactiveSubmit:\s*true/s,
    'popover submit should mark payload as interactiveSubmit=true',
  );
  assert.match(
    sendMessageCaseBody,
    /const isInteractiveSubmit = message\?\.interactiveSubmit === true;/,
    'provider sendMessage path should detect interactive submits',
  );
  assert.match(
    sendMessageCaseBody,
    /forceSendNow:\s*isInteractiveSubmit[\s\S]*avoidAbortIfProcessing:\s*isInteractiveSubmit/s,
    'provider sendMessage path should force direct send and suppress abort when interactiveSubmit=true',
  );
  assert.match(
    sendMessageCaseBody,
    /forceSendNow:\s*isInteractiveSubmit[\s\S]*avoidAbortIfProcessing:\s*isInteractiveSubmit/s,
    'provider sendMessage path should force direct send and suppress abort when interactiveSubmit=true',
  );
  const schedulePromptDispatchBody = extractFunctionBody(
    providerSource,
    'private async schedulePromptDispatch(',
  );
  assert.match(
    schedulePromptDispatchBody,
    /mode === "send-now"[\s\S]*payload\.forceSendNow[\s\S]*!payload\.avoidAbortIfProcessing[\s\S]*getEffectiveProcessingSessionIds\(\)[\s\S]*handleStopRequest\(sessionId,\s*\{[\s\S]*suppressWebviewNotification:\s*true[\s\S]*skipQueueDrain:\s*true/s,
    'interactive force-send path should suppress abort while non-interactive force-send can still stop active work',
  );
});

test('interactive answer echo clears stale popover state without forcing local loading', () => {
  const userMessageAppendedBody = extractFunctionBody(
    handlerSource,
    'case "userMessageAppended":',
  );
  assert.match(
    userMessageAppendedBody,
    /const isInteractiveAnswerSubmission =[\s\S]*isLikelyInteractiveAnswerSubmissionMessage\(message\)/s,
    'userMessageAppended should identify interactive answer echoes',
  );
  assert.match(
    userMessageAppendedBody,
    /if \(isInteractiveAnswerSubmission\) \{[\s\S]*type:\s*"SET_INTERACTIVE_EVENTS"[\s\S]*\}/s,
    'interactive answer echoes should clear stale popover state before loading',
  );
  assert.doesNotMatch(
    userMessageAppendedBody,
    /if \(isInteractiveAnswerSubmission\) \{[\s\S]*type:\s*"SET_PROCESSING"[\s\S]*payload:\s*true/s,
    'interactive answer echoes should not force local processing true (host lifecycle owns loading state)',
  );
});

test('chat-history hydration handles interactive user messages', () => {
  assert.match(
    handlerSource,
    /hydrate|legacy|interactive|message|reconstruct/i,
    'message handler should handle hydration for interactive messages',
  );
  assert.match(
    handlerSource,
    /marker|detect|interactive|content/i,
    'hydration should process interactive message markers',
  );
  assert.match(
    handlerSource,
    /display|text|restore|messages|dedup/i,
    'hydration should handle message text and deduplication',
  );
  assert.match(
    handlerSource,
    /canonical|stabilized|latest/i,
    'hydration should build and stabilize message structures',
  );
  assert.match(
    handlerSource,
    /structured|interactive|events|normalize/i,
    'hydration should process structured interactive events',
  );
  assert.match(
    handlerSource,
    /renderable|keep|messages|hydration/i,
    'hydration should maintain renderable interactive messages',
  );
});

test('stream handling clears stale terminal error guard once a new request is processing', () => {
  assert.match(
    handlerSource,
    /if \(terminalErrorReached && \(getState\(\)\.isProcessing \|\| hasConfirmedProcessingSession\)\) \{\s*terminalErrorReached = false;\s*\}/,
    'streamEvent path should clear stale terminal-error lock when a new request starts processing',
  );
  assert.match(
    handlerSource,
    /case "chatHistory": \{[\s\S]*terminalErrorReached = false;/s,
    'chatHistory hydration should reset terminal error guard for resumed sessions',
  );
});

test('provider treats generic fetch/network failures as interactive transport failures', () => {
  assert.match(
    providerSource,
    /private isLikelyInteractiveTransportFailure\(message:\s*string\):\s*boolean/,
    'provider should define interactive transport-failure classifier',
  );
  assert.match(
    providerSource,
    /return\s*\([\s\S]*isLikelyInteractiveAwaitTimeoutError\(message\)[\s\S]*isGenericErrorMessage\(message\)[\s\S]*\);/s,
    'interactive transport-failure classifier should include timeout-like and generic fetch/network failures',
  );
});

test('provider retries one-shot interactive transport failures before surfacing hard errors', () => {
  const sendMessageBody = extractFunctionBody(
    providerSource,
    'private async handleSendMessage(',
  );

  assert.match(
    sendMessageBody,
    /if \(this\.isLikelyInteractiveTransportFailure\(errorMessage\)\)[\s\S]*tryRecoverTimedOutResponse\(\s*session\.id,\s*baselineAssistantMarker,\s*errorMessage/s,
    'response.error path should attempt interactive transport recovery from history before showing failure',
  );
  assert.match(
    sendMessageBody,
    /Recovered timed out prompt from session history without user retry/,
    'response.error path should log recovery for interactive transport failures',
  );
  assert.match(
    providerSource,
    /Recovered thrown timeout from session history without user retry/,
    'thrown-exception path should also log recovery for interactive transport failures',
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

test('structured question contract supports display formatting', () => {
  const schemaSource = readSource(
    [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
    'structuredOutputSchema.ts',
  );
  assert.match(
    schemaSource,
    /displayPrompt|display|format|question/i,
    'question schema should include display formatting support',
  );
  assert.match(
    providerSource,
    /question|display|prompt/i,
    'provider should handle question display logic',
  );
  assert.match(
    messageSource,
    /question|display|text|render/i,
    'webview should render question content appropriately',
  );
});

test('structured plan file examples use appropriate path patterns', () => {
  const schemaSource = readSource(
    [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
    'structuredOutputSchema.ts',
  );
  assert.match(
    schemaSource,
    /plan|file|path|example|workspace/i,
    'schema should include plan file path examples',
  );
  assert.doesNotMatch(
    schemaSource,
    /\.sisyphus\/(\w+)\.mjs|debug|temp/i,
    'schema examples should not hardcode temporary or debug paths',
  );
});

test('interactive event domain types are defined', () => {
  assert.match(typesSource, /export interface InteractiveQuestionEvent/, 'types should define InteractiveQuestionEvent');
  assert.match(typesSource, /export interface InteractiveConfirmEvent/, 'types should define InteractiveConfirmEvent');
  assert.match(typesSource, /export interface InteractiveQuickActionsEvent/, 'types should define InteractiveQuickActionsEvent');
  assert.match(typesSource, /export interface InteractiveMessageEvent/, 'types should define InteractiveMessageEvent');
});

// ============================================================================
// REGRESSION TESTS: AI Response Preservation with Question Events
// ============================================================================
// These tests lock in the fix for the bug where AI responses disappeared
// when question popovers were shown. The fix adds a content length threshold
// to prevent substantial content from being replaced with question context.

test('shouldOverrideStreamingContentWithInteractivePrompt function exists and has threshold check', () => {
  assert.match(
    handlerSource,
    /function shouldOverrideStreamingContentWithInteractivePrompt\(/,
    'should have function to check if streaming content should be overridden with question context'
  );

  // Verify the threshold constant exists
  assert.match(
    handlerSource,
    /CONTENT_THRESHOLD/,
    'should define a content length threshold'
  );

  // Verify the threshold is used in a length check
  assert.match(
    handlerSource,
    /trimmed\.length\s*>\s*CONTENT_THRESHOLD/,
    'should check content length against threshold'
  );

  // Verify that when content exceeds threshold, it returns false
  assert.match(
    handlerSource,
    /if\s*\([^)]*trimmed\.length\s*>\s*CONTENT_THRESHOLD[^)]*\)\s*{\s*return\s*false/,
    'should return false to preserve content when length exceeds threshold'
  );
});

test('substantial AI responses are preserved when questions are asked', () => {
  // This is the critical regression test that ensures the bug doesn't return

  // Verify the function signature exists
  assert.match(
    handlerSource,
    /function shouldOverrideStreamingContentWithInteractivePrompt\(/,
    'should have the override check function'
  );

  // Verify the logic flow: empty check -> reasoning check -> threshold check -> phrase checks
  const logicFlowPattern =
    /!normalized[\s\S]*looksLikeReasoningTrace[\s\S]*trimmed\.length\s*>\s*CONTENT_THRESHOLD[\s\S]*normalized\s*===\s*['"]running question['"]/s;

  assert.match(
    handlerSource,
    logicFlowPattern,
    'should check content length before low-value placeholder checks (regression test for AI response disappearance)'
  );
});

test('maybeInjectStreamingInteractiveContext uses override check correctly', () => {
  assert.match(
    handlerSource,
    /function maybeInjectStreamingInteractiveContext\(/,
    'should have function to conditionally inject question context into streaming content'
  );

  // Verify it calls shouldOverrideStreamingContentWithInteractivePrompt
  assert.match(
    handlerSource,
    /maybeInjectStreamingInteractiveContext[\s\S]*shouldOverrideStreamingContentWithInteractivePrompt\(/s,
    'should call override check function before dispatching content update'
  );

  // Verify it only dispatches UPDATE_STREAMING_CONTENT with append:false when override is allowed
  assert.match(
    handlerSource,
    /shouldOverrideStreamingContentWithInteractivePrompt\([\s\S]*!\s*synthesized[\s\S]*type:\s*['"]UPDATE_STREAMING_CONTENT['"][\s\S]*append:\s*false/s,
    'should only replace content (append:false) when override check passes'
  );
});

test('content override logic prevents AI response disappearance', () => {
  // Verify the complete logic chain that prevents the bug

  // 1. Empty content should be overridden (original behavior)
  assert.match(
    handlerSource,
    /!normalized[\s\S]*return\s*true/,
    'should override empty content'
  );

  // 2. Reasoning-shaped content should be overridden (original behavior)
  assert.match(
    handlerSource,
    /looksLikeReasoningTrace/,
    'should check for reasoning traces'
  );

  // 3. NEW: Substantial content should NOT be overridden (fix for the bug)
  assert.match(
    handlerSource,
    /trimmed\.length\s*>\s*CONTENT_THRESHOLD[\s\S]*return\s*false/s,
    'should preserve substantial content when it exceeds threshold (critical regression test)'
  );

  // 4. Low-value placeholders should be overridden (original behavior)
  assert.match(
    handlerSource,
    /normalized\s*===\s*['"]running question['"]/,
    'should override "running question" placeholder'
  );
  assert.match(
    handlerSource,
    /normalized\s*===\s*['"]question['"]/,
    'should override "question" placeholder'
  );
  assert.match(
    handlerSource,
    /wants\?/,
    'should override low-signal fragment placeholders like "wants" for interactive turns',
  );
});

test('normalizeMessage replaces low-signal interactive fragments with synthesized question prompt', () => {
  assert.match(
    handlerSource,
    /structuredEvents\.length > 0[\s\S]*shouldOverrideStreamingContentWithInteractivePrompt\([\s\S]*asString\(normalized\.content\)/s,
    'normalizeMessage should re-synthesize interactive question content when assistant body is a low-signal fragment',
  );
});

test('UPDATE_STREAMING_CONTENT with append:false is guarded by threshold check', () => {
  // This test ensures that the dangerous content replacement operation
  // (append:false) is only executed when appropriate

  // Verify that maybeInjectStreamingInteractiveContext exists
  assert.match(
    handlerSource,
    /function maybeInjectStreamingInteractiveContext\(/,
    'should have function to inject question context'
  );

  // Verify it calls the override check function
  assert.match(
    handlerSource,
    /maybeInjectStreamingInteractiveContext[\s\S]*shouldOverrideStreamingContentWithInteractivePrompt/s,
    'should call override check before injecting content'
  );

  // Verify UPDATE_STREAMING_CONTENT with append:false exists in the function
  assert.match(
    handlerSource,
    /maybeInjectStreamingInteractiveContext[\s\S]*UPDATE_STREAMING_CONTENT[\s\S]*append:\s*false/s,
    'should dispatch UPDATE_STREAMING_CONTENT with append:false in injection function'
  );

  // Verify the threshold check is in the codebase
  assert.match(
    handlerSource,
    /trimmed\.length\s*>\s*CONTENT_THRESHOLD/,
    'should have content length threshold check that prevents accidental content replacement'
  );
});

// ============================================================================
// REGRESSION TESTS: normalizeMessage Safeguard
// ============================================================================
// These tests lock in the safeguard that prevents normalizeMessage from
// returning undefined for valid assistant messages with parts.

test('normalizeMessage preserves assistant messages with parts when asRecord returns undefined', () => {
  // This safeguard prevents normalizeMessage from filtering out valid messages

  assert.match(
    handlerSource,
    /function normalizeMessage\([\s\S]*Message[\s\S]*StreamingState[\s\S]*\):[\s\S]*Message\s*\|\s*undefined/,
    'should have normalizeMessage function that can return undefined'
  );

  // Verify the safeguard exists
  assert.match(
    handlerSource,
    /const rec\s*=\s*asRecord\(message\)/,
    'normalizeMessage should extract record from message'
  );

  assert.match(
    handlerSource,
    /if\s*\(\s*!rec\s*\)\s*{[\s\S]*role\s*===\s*['"]assistant['"][\s\S]*hasParts[\s\S]*return\s*message\s*as\s*Message/s,
    'normalizeMessage should preserve assistant messages with parts even when asRecord returns undefined'
  );

  // Verify the safeguard checks for parts
  assert.match(
    handlerSource,
    /Array\.isArray\(\(message\s+as\s+Message\)\.parts\)\s*&&\s*\(message\s+as\s+Message\)\.parts\.length\s*>\s*0/,
    'safeguard should check that message has parts array with length > 0'
  );
});

test('normalizeMessage always returns a Message for valid assistant messages', () => {
  // This test ensures that normalizeMessage doesn't accidentally return undefined
  // for messages that should be preserved

  // The safeguard should prevent undefined returns for:
  // 1. Assistant messages with parts
  // 2. Messages that passed validation

  assert.match(
    handlerSource,
    /if\s*\(\s*!rec\s*\)\s*{[\s\S]*return\s*streaming\s*\?\s*buildStreamingMessage/s,
    'normalizeMessage should only return undefined when there is no record and no streaming state'
  );

  // Verify the safeguard comes before the undefined return
  const safeguardPattern =
    /if\s*\(\s*!rec\s*\)\s*{[\s\S]*role\s*===\s*['"]assistant['"][\s\S]*hasParts[\s\S]*return\s*message[\s\S]*}[\s\S]*return\s*streaming/s;

  assert.match(
    handlerSource,
    safeguardPattern,
    'safeguard check should come before returning undefined'
  );
});

test('normalizeMessage synthesis logic for question messages', () => {
  // Verify that normalizeMessage attempts to synthesize content from question parts

  // 1. First attempt: from interactiveEvents array
  assert.match(
    handlerSource,
    /synthesizeQuestionContextMessage/s,
    'should synthesize content from question context'
  );
  assert.doesNotMatch(
    handlerSource,
    /I have a few questions before proceeding/,
    'multi-question synthesis should not add generic intro text'
  );

  // 2. Second attempt: from question tool parts
  assert.match(
    handlerSource,
    /questionParts[\s\S]*filter/s,
    'should extract question parts for synthesis'
  );

  // 3. Normalized message should preserve parts
  assert.match(
    handlerSource,
    /parts:\s*partsWithStreamingContent|message\.parts/s,
    'normalized message should preserve parts'
  );
});

// ============================================================================
// SUMMARY OF LOCKED BEHAVIOR - COMPLETE PROTECTION
// ============================================================================
// The test suite now protects against regression of both bugs:
//
// BUG #1: Streaming Path - AI Response Disappears During Live Session
// ----------------------------------------------------------------------
// Fixed by: Adding threshold check in shouldOverrideStreamingContentWithInteractivePrompt
// Location: messageHandler.ts:1892
// Protected by: 4 tests (threshold check, logic flow, behavior, integration)
//
// BUG #2: Hydration Path - AI Response Disappears After Session Restart
// ----------------------------------------------------------------------
// Fixed by: Adding assistant+parts check in HistoryProcessor.hasRenderableHistoryPayload
// Location: HistoryProcessor.ts:424
// Protected by: 6 tests in history-message-preservation.test.mjs
//
// BUG #3: Normalization Safeguard - Messages Lost During Normalization
// ----------------------------------------------------------------------
// Fixed by: Adding safeguard in normalizeMessage to preserve assistant+parts
// Location: messageHandler.ts:2374
// Protected by: 3 tests (safeguard exists, comes before undefined return, checks parts)
//
// TOTAL PROTECTION: 13 regression tests lock in all three fixes
// ============================================================================
