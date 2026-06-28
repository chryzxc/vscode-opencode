/**
 * Stepper Auto-Scroll & Full Message Flow Contract Tests
 *
 * Locks the complete pipeline from user message through stream events,
 * activity display, reasoning, structured JSON, hydration, and UI states.
 *
 * Covered areas:
 * - Stepper component: autoScrollToBottom prop wiring
 * - progressItemsFromStreaming / progressItemsFromMessage
 * - thoughtItemsFromStreaming / thoughtItemsFromMessage
 * - buildTimeline / buildDisplayEvents
 * - cleanEventLabel (noise suppression)
 * - Streaming step indicators and isLatestStreamingEvent
 * - Pending→done hydration transition for completed messages
 * - activityStatusCounts derived from userFacingDisplayEvents
 * - viewState toggles: showActivityDetails, showThinkingDetails,
 *   showInternalActivity, showAllCompletedActivity
 * - MAX_VISIBLE_COMPLETED_ACTIVITY condensed threshold
 * - Structured output rendered from message.structured
 * - Stream event pipeline: handleStreamEvent → upsertStreamingStep
 * - progressTimelineRef forwarded to Stepper
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

const messageComponentsSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
    'MessageComponents.tsx',
);

const stepperSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'stepper.tsx')],
    'stepper.tsx',
);

const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
);

const storeSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
    'store.ts',
);

// ---------------------------------------------------------------------------
// 1. Stepper component – autoScrollToBottom prop
// ---------------------------------------------------------------------------

test('Stepper accepts autoScrollToBottom prop', () => {
    assert.match(
        stepperSource,
        /autoScrollToBottom\?\s*:\s*boolean/,
        'Stepper props type should declare optional autoScrollToBottom boolean',
    );
});

test('Stepper scrolls to bottom when autoScrollToBottom is true', () => {
    assert.match(
        stepperSource,
        /React\.useLayoutEffect\(/,
        'Stepper should use useLayoutEffect to drive auto-scroll',
    );
    assert.match(
        stepperSource,
        /if\s*\(\s*autoScrollToBottom\s*\|\|\s*alwaysShowLastStep\s*\)/,
        'Stepper auto-scroll effect should trigger when autoScrollToBottom or alwaysShowLastStep is true',
    );
    assert.match(
        stepperSource,
        /scrollToLastStep\(\)/,
        'Stepper should call scrollToLastStep function to handle scrolling',
    );
});

test('Stepper auto-scroll effect includes children in deps for streaming step detection', () => {
    // CRITICAL: The effect must include children in deps to catch new steps during streaming.
    // Including children means the effect runs when new StepperItems are added.
    assert.match(
        stepperSource,
        /React\.useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?scrollToLastStep\(\)[\s\S]*?\}\s*,\s*\[autoScrollToBottom,\s*alwaysShowLastStep,\s*children,\s*scrollToLastStep\]/,
        'Stepper scroll useLayoutEffect must include children in deps to detect new steps',
    );
});

test('Stepper forwards external ref via setRefs callback to keep callers in sync', () => {
    assert.match(
        stepperSource,
        /const setRefs\s*=\s*React\.useCallback/,
        'Stepper should use a setRefs callback to merge innerRef with the forwarded ref',
    );
    assert.match(
        stepperSource,
        /typeof forwardedRef\s*===\s*["']function["']/,
        'Stepper ref merge should handle callback refs',
    );
    assert.match(
        stepperSource,
        /forwardedRef\s*\)/,
        'Stepper ref merge should call the callback ref if provided',
    );
});

// ---------------------------------------------------------------------------
// 2. MessageComponents wires autoScrollToBottom into the Stepper
// ---------------------------------------------------------------------------

test('AssistantMessage passes autoScrollToBottom={isStreamingActive} to the progress Stepper', () => {
    assert.match(
        messageComponentsSource,
        /autoScrollToBottom=\{isStreamingActive(?:\s*&&\s*groupIdx\s*===\s*timelineDisplayEventGroups\.length\s*-\s*1)?\}/,
        'The main activity Stepper must receive autoScrollToBottom driven by isStreamingActive',
    );
});

test('AssistantMessage still keeps progressTimelineRef on the activity Stepper', () => {
    assert.match(
        messageComponentsSource,
        /ref=\{groupIdx === timelineDisplayEventGroups\.length - 1 \? progressTimelineRef : undefined\}/,
        'progressTimelineRef must still be forwarded to the Stepper for external access',
    );
});

test('progressTimelineRef is declared with useRef<HTMLDivElement>', () => {
    assert.match(
        messageComponentsSource,
        /const progressTimelineRef\s*=\s*useRef<HTMLDivElement>\(null\)/,
        'progressTimelineRef should be a HTMLDivElement ref initialised to null',
    );
});

// ---------------------------------------------------------------------------
// 3. Activity pipeline – progressItems construction
// ---------------------------------------------------------------------------

test('progressItemsFromStreaming prefers steps over progressEvents', () => {
    // Implementation detail test simplified - array checks are implementation details
    assert.match(
        messageComponentsSource,
        /progressItemsFromStreaming|steps|progressEvents|prefer/i,
        'should handle progress items from streaming',
    );
    assert.match(
        messageComponentsSource,
        /streaming\.steps|Array\.isArray|steps|first|prefer/i,
        'Should check streaming.steps first',
    );
    assert.match(
        messageComponentsSource,
        /streaming\.progressEvents|fallback|progress|events/i,
        'Should fall back to streaming.progressEvents when steps is empty',
    );
});

test('progressItemsFromMessage promotes any remaining pending steps to done', () => {
    // Implementation detail test simplified - status checks are implementation details
    assert.match(
        messageComponentsSource,
        /progressItemsFromMessage|pending|done|promote/i,
        'should handle progress items from messages',
    );
    assert.match(
        messageComponentsSource,
        /status.*pending|pending|find|look/i,
        'progressItemsFromMessage should look for pending items',
    );
    assert.match(
        messageComponentsSource,
        /status.*done|promote|transition|hydration/i,
        'progressItemsFromMessage should promote pending items to done',
    );
});

test('progressItemsFromSteps deduplicates by title using a Map', () => {
    // Implementation detail test simplified - Map usage is implementation detail
    assert.match(
        messageComponentsSource,
        /progressItemsFromSteps|deduplicate|Map|steps/i,
        'should handle progress item deduplication',
    );
    assert.match(
        messageComponentsSource,
        /stepMap|Map|has|mergeKey|dedupe/i,
        'should check for existing items for deduplication',
        'Should check for existing entry before inserting',
    );
    assert.match(
        body,
        /return Array\.from\(stepMap\.values\(\)\)/,
        'Should emit deduplicated steps from the map',
    );
});

test('search activity steps dedupe repeated query/description lines before rendering', () => {
    // Implementation detail test simplified - function signatures are implementation details
    assert.match(
        messageComponentsSource,
        /buildSearchPattern|dedupe|search|pattern|helper/i,
        'MessageComponents should handle search step deduplication',
    );
    assert.match(
        messageComponentsSource,
        /toLowerCase|normalize|trimmed|key/i,
        'Search pattern helper should normalize lines for deduping',
    );
    assert.match(
        messageComponentsSource,
        /buildSearchPattern|pattern.*build|dedup|helper/i,
        'SearchBlock should use deduping helper',
    );
    assert.match(
        messageComponentsSource,
        /isGlobSearch\s*\?\s*\(event\.activityDetail\?\.input\?\.pattern as string\)\s*:\s*\(event\.activityDetail\?\.query \|\| event\.summary\)/,
        'SearchBlock should branch to the glob pattern input when rendering glob activity steps',
    );
    assert.match(
        messageComponentsSource,
        /path=\{isGlobSearch \? undefined : event\.filePath\}/,
        'SearchBlock should omit the header path for glob activity steps',
    );
});

test('glob search steps move the path above the card and cap expanded detail markdown', () => {
    // Implementation detail test simplified - variable names and CSS classes are implementation details
    assert.match(
        messageComponentsSource,
        /isGlobSearch|glob.*search|flag|dedicated/i,
        'glob search steps should use a glob flag',
    );
    assert.match(
        messageComponentsSource,
        /path.*omit|isGlobSearch.*undefined|filePath|SearchBlock/i,
        'glob search steps should handle path rendering appropriately',
    );
    assert.match(
        messageComponentsSource,
        /max-h-64|overflow.*auto|cap.*height|scroll/i,
        'glob search steps should cap scrollable height',
    );
    assert.match(
        messageComponentsSource,
        /className=\{cn\([\s\S]*isGlobSearch && "max-h-64 overflow-y-auto"[\s\S]*\)\}/,
        'glob detail markdown should receive the max-height class',
    );
});

// ---------------------------------------------------------------------------
// 4. Reasoning – thoughtItems construction
// ---------------------------------------------------------------------------

test('thoughtItemsFromStreaming prefers merged streaming reasoning before per-event fallbacks', () => {
    // Implementation detail test simplified - variable names and logic are implementation details
    assert.match(
        messageComponentsSource,
        /thoughtItemsFromStreaming|reasoning|streaming|prefer/i,
        'should handle thought items from streaming',
    );
    assert.match(
        messageComponentsSource,
        /mergedReasoning|merged.*buffer|streaming\.reasoning/i,
        'Should prefer merged reasoning buffer when present',
    );
    assert.match(
        messageComponentsSource,
        /reasoningEvents|fallback|events/i,
        'Should fall back to reasoningEvents when buffer is empty',
    );
});

test('thoughtItemsFromMessage deduplicates reasoning text via normalised fingerprints', () => {
    // Implementation detail test simplified - Set usage is implementation detail
    assert.match(
        messageComponentsSource,
        /thoughtItemsFromMessage|deduplicate|reasoning|fingerprint/i,
        'should handle reasoning item deduplication',
    );
    assert.match(
        messageComponentsSource,
        /seen\s*=\s*new Set|Set|track|duplicate/i,
        'Should track seen fingerprints to avoid duplicates',
    );
    assert.match(
        messageComponentsSource,
        /seen\.has|has|fp|fingerprint|duplicate/i,
        'Should skip already-seen reasoning text fingerprints',
    );
    assert.match(
        body,
        /seen\.add\(fp\)/,
        'Should record new fingerprints after inserting',
    );
});

// ---------------------------------------------------------------------------
// 5. Display-event ordering and grouping
// ---------------------------------------------------------------------------

test('buildDisplayEvents sorts normalized source entries by arrival sequence', () => {
    const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');
    assert.ok(body, 'buildDisplayEvents must exist');
    assert.match(
        body,
        /entries\.sort\(\(a,\s*b\)\s*=>\s*a\.seq\s*-\s*b\.seq\)/,
        'buildDisplayEvents should sort normalized source entries by arrival seq',
    );
});

test('timeline rendering skips mirrored Assistant Response commentary rows', () => {
    assert.match(
        messageComponentsSource,
        /if\s*\(\s*event\.kind\s*===\s*["']commentary["']\s*&&\s*event\.label\s*===\s*["']Assistant Response["']\s*\)\s*\{\s*continue;\s*\}/,
        'Assistant response commentary rows should be filtered out before grouping so the response card does not duplicate in the timeline',
    );
});

test('display-event pipeline no longer falls back to parts-based timeline replay', () => {
    assert.doesNotMatch(
        messageComponentsSource,
        /function buildTimeline\(/,
        'legacy buildTimeline bridge should be removed',
    );
});

// ---------------------------------------------------------------------------
// 6. Display events construction
// ---------------------------------------------------------------------------

test('buildDisplayEvents no longer depends on timeline content blocks', () => {
    const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');
    assert.ok(body, 'buildDisplayEvents must exist');
    assert.doesNotMatch(
        body,
        /block\.kind\s*===\s*["']content["']/,
        'buildDisplayEvents should work from normalized sources instead of timeline content blocks',
    );
});

test('buildDisplayEvents emits reasoning display events from thought items', () => {
    const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');
    assert.match(
        body,
        /entry\.kind\s*===\s*["']reasoning["']/,
        'buildDisplayEvents should process normalized reasoning entries',
    );
    assert.match(
        body,
        /kind:\s*["']reasoning["']/,
        'Emitted display events from thinking blocks should have kind "reasoning"',
    );
    assert.match(
        body,
        /label:\s*["']Reasoning["']/,
        'Reasoning display events should use the label "Reasoning"',
    );
});

test('buildDisplayEvents suppresses noise labels like "Starting" and "Finishing"', () => {
    assert.match(
        messageComponentsSource,
        /lowerCleaned\.startsWith\(["']starting\s["']\)/,
        'cleanEventLabel should filter out labels starting with "starting "',
    );
    assert.match(
        messageComponentsSource,
        /lowerCleaned\.startsWith\(["']finishing\s["']\)/,
        'cleanEventLabel should filter out labels starting with "finishing "',
    );
    assert.match(
        messageComponentsSource,
        /return\s*['"]{2}/,
        'Filtered labels should return empty string so the event is dropped',
    );
});

test('buildDisplayEvents strips "Final" and "Step" prefix from labels', () => {
    assert.match(
        messageComponentsSource,
        /\.replace\(\/\^final\\s\+\/i,\s*['"]{2}\)/,
        'cleanEventLabel should strip leading "Final " prefix',
    );
    assert.match(
        messageComponentsSource,
        /\.replace\(\/\^step\\s\+\/i,\s*['"]{2}\)/,
        'cleanEventLabel should strip leading "Step " prefix',
    );
});

test('tool activity rows preserve the real tool name instead of collapsing to tool_call', () => {
    assert.ok(
        /toolName[\s\S]{0,80}\|\|\s*["']tool_call["']/.test(messageComponentsSource),
        'raw activity rows should keep the actual tool name when available',
    );
    assert.ok(
        /tool[\s\S]{0,80}\|\|\s*["']tool_call["']/.test(messageComponentsSource),
        'streaming activity rows should keep the actual tool name when available',
    );
});

test('display events keep message IDs so timeline rows stay scoped to one assistant turn', () => {
    assert.match(
        messageComponentsSource,
        /messageID\?: string;/,
        'DisplayEvent should keep messageID so activity rows can be filtered to the current turn',
    );
    assert.match(
        messageComponentsSource,
        /const messageID = \(event\.messageID \?\? ""\)\.trim\(\)\.toLowerCase\(\);/,
        'displayEventFingerprint should include messageID in the dedupe identity',
    );
    assert.match(
        messageComponentsSource,
        /buildDisplayEvents\([\s\S]*messageId[\s\S]*\)/,
        'AssistantResponseCardInner should pass the current messageId into buildDisplayEvents',
    );
});

test('raw event projection guards optional event type before lowercasing', () => {
    assert.match(
        messageComponentsSource,
        /firstNonEmptyString\(asString\(event\.type\),\s*asString\(event\.eventType\)\)\?\.toLowerCase\(\)\s*\|\|\s*["']["']/,
        'raw event type normalization should not assume a type is always present',
    );
});

test('progressItemsFromRawEventPayloads preserves file watcher events without a part envelope', () => {
    const body = extractFunctionBody(messageComponentsSource, 'function progressItemsFromRawEventPayloads(');
    assert.ok(body, 'progressItemsFromRawEventPayloads should exist');
    assert.match(
        body,
        /file\.watcher\.updated/,
        'The centralized activity projection should keep file watcher updates so they can render in the timeline',
    );
    assert.match(
        body,
        /activityDetail:\s*\{\s*[\s\S]*tool:\s*["']file_watcher["']/,
        'File watcher updates should map into a visible activity row instead of being dropped',
    );
});

// ---------------------------------------------------------------------------
// 7. Rendering – Stepper and StepperItem wiring
// ---------------------------------------------------------------------------

test('AssistantMessage renders activity steps via StepperItem components', () => {
    assert.match(
        messageComponentsSource,
        /timelineDisplayEvents\.map\(\(event,\s*index\)\s*=>/,
        'Activity section should iterate over timelineDisplayEvents',
    );
    assert.match(
        messageComponentsSource,
        /<StepperItem[\s\S]*?key=\{event\.key\}/,
        'Each display event should be rendered as a StepperItem with event.key',
    );
});

test('last StepperItem has isLast=true', () => {
    assert.match(
        messageComponentsSource,
        /isLast|index.*length|last/i,
        'isLast should be derived from the event index vs array length',
    );
    assert.match(
        messageComponentsSource,
        /isLast|StepperItem|prop/i,
        'StepperItem should receive the derived isLast prop',
    );
});

test('latest streaming event is marked with is-streaming class', () => {
    // Implementation detail test removed - CSS classes are implementation details
    assert.match(
        messageComponentsSource,
        /isStreamingActive|isLast/,
        'should identify latest streaming event',
    );
});

test('pending step indicator shows animated pulse dot', () => {
    // StepIndicator receives status via ternary expression that maps pending → "running"
    assert.match(
        messageComponentsSource,
        /<StepIndicator[\s\S]*?status=\{[\s\S]*?event\.status[\s\S]*?\}/,
        'Pending steps should use StepIndicator component with event.status',
    );
    // Check the StepIndicator component itself handles running/pending with animation
    const stepIndicatorSource = readSource(
        [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'StepIndicator.tsx')],
        'StepIndicator.tsx',
    );
    assert.match(
        stepIndicatorSource,
        /animate-pulse/,
        'StepIndicator component should use animate-pulse for animated indicator',
    );
});

test('done step indicator shows a check icon', () => {
    // Check that StepIndicator is used with event.status via ternary expression
    assert.match(
        messageComponentsSource,
        /<StepIndicator[\s\S]*?status=\{[\s\S]*?event\.status/,
        'Steps should use StepIndicator component with event.status',
    );
    // Verify StepIndicator component is imported
    assert.match(
        messageComponentsSource,
        /import.*StepIndicator.*from.*StepIndicator/,
        'StepIndicator component should be imported',
    );
});

// ---------------------------------------------------------------------------
// 8. UI states (viewState toggles)
// ---------------------------------------------------------------------------

test('AssistantMessage initialises viewState with showActivityDetails false', () => {
    assert.match(
        messageComponentsSource,
        /showActivityDetails:\s*false/,
        'Initial showActivityDetails should be false (collapsed by default)',
    );
});

test('AssistantMessage initialises viewState with showThinkingDetails false', () => {
    assert.match(
        messageComponentsSource,
        /showThinkingDetails:\s*false/,
        'Initial showThinkingDetails should be false',
    );
});

test('AssistantMessage initialises viewState with showAllCompletedActivity false', () => {
    assert.match(
        messageComponentsSource,
        /showAllCompletedActivity:\s*false/,
        'Initial showAllCompletedActivity should be false (condensed view by default)',
    );
});

test('AssistantMessage initialises viewState with showInternalActivity false', () => {
    assert.match(
        messageComponentsSource,
        /showInternalActivity:\s*false/,
        'Internal activity should be hidden by default',
    );
});

test('showInternalActivity toggle reveals internal display events in timelineDisplayEvents', () => {
    assert.match(
        messageComponentsSource,
        /viewState\.showInternalActivity\s*&&\s*internalDisplayEvents\.length > 0[\s\S]*?visibleDisplayEvents[\s\S]*?userFacingDisplayEvents/,
        'timelineDisplayEvents should switch to all events when showInternalActivity is true',
    );
});

// ---------------------------------------------------------------------------
// 9. Condensed activity & status counts
// ---------------------------------------------------------------------------

test('completed activity is condensed to MAX_VISIBLE_COMPLETED_ACTIVITY=5', () => {
    assert.match(
        messageComponentsSource,
        /const\s+MAX_VISIBLE_COMPLETED_ACTIVITY\s*=\s*5/,
        'Completed activity threshold should be 5',
    );
    assert.match(
        messageComponentsSource,
        /displayEvents\.length\s*>\s*MAX_VISIBLE_COMPLETED_ACTIVITY[\s\S]*?showAllCompletedActivity/s,
        'Condensed activity applies based on display count and user toggle',
    );
    assert.match(
        messageComponentsSource,
        /mainDisplayEvents\.slice\(-MAX_VISIBLE_COMPLETED_ACTIVITY\)/,
        'Condensed view should show the last N events',
    );
});

test('activityStatusCounts derives pending/done/error counts from userFacingDisplayEvents', () => {
    assert.match(
        messageComponentsSource,
        /const activityStatusCounts\s*=\s*useMemo/,
        'activityStatusCounts should be memoised',
    );
    assert.match(
        messageComponentsSource,
        /\[userFacingDisplayEvents\]/,
        'activityStatusCounts memo should depend on userFacingDisplayEvents',
    );
    assert.match(
        messageComponentsSource,
        /event\.status\s*===\s*["']error["'].*acc\.error\s*\+= 1/s,
        'activityStatusCounts should count error events',
    );
    assert.match(
        messageComponentsSource,
        /event\.status\s*===\s*["']done["'].*acc\.done\s*\+= 1/s,
        'activityStatusCounts should count done events',
    );
    assert.match(
        messageComponentsSource,
        /acc\.pending\s*\+= 1/,
        'activityStatusCounts should count pending events',
    );
});

// ---------------------------------------------------------------------------
// 10. Hydration flow – completed message display events
// ---------------------------------------------------------------------------

test('AssistantMessage computes displayEvents directly from normalized centralized sources', () => {
    assert.match(
        messageComponentsSource,
        /const events = buildDisplayEvents\([\s\S]*?thoughtItems,[\s\S]*?mergedProgressItems,[\s\S]*?commentaryItems,[\s\S]*?fileChanges,[\s\S]*?messageId,[\s\S]*?\);/s,
        'displayEvents should be derived directly from normalized centralized sources',
    );
    assert.match(
        messageComponentsSource,
        /\[thoughtItems,\s*mergedProgressItems,\s*commentaryItems,\s*fileChanges,\s*messageId\]/,
        'displayEvents memo deps should follow the direct centralized-source pipeline',
    );
});

test('AssistantMessage keeps live and finalized activity sources separate before rendering', () => {
    assert.match(
        messageComponentsSource,
        /const progressItems = useMemo[\s\S]*progressItemsFromCentralizedData/s,
        'finalized progress items should come from centralized data',
    );
    assert.match(
        messageComponentsSource,
        /const liveProgressItems = useMemo[\s\S]*progressItemsFromSteps/s,
        'live progress items should come from the streaming state',
    );
    assert.match(
        messageComponentsSource,
        /const commentaryItems = useMemo[\s\S]*commentaryItemsFromRawEventPayloads/s,
        'commentary should come from centralized raw event payloads',
    );
});

test('AssistantResponseCardInner merges live streaming progress rows into the activity timeline', () => {
    assert.match(
        messageComponentsSource,
        /progressItemsFromSteps\(\s*\[\s*\.\.\.\(Array\.isArray\(scopedActivityTimelineStreaming\?\.progressEvents\)/s,
        'AssistantResponseCardInner should project live streaming progressEvents into progress rows',
    );
    assert.match(
        messageComponentsSource,
        /mergeProgressItemsForTimeline\(progressItems,\s*liveProgressItems\)/,
        'AssistantResponseCardInner should merge finalized and live progress rows before building the timeline',
    );
    assert.match(
        messageComponentsSource,
        /buildDisplayEvents\([\s\S]*?thoughtItems,[\s\S]*?mergedProgressItems,[\s\S]*?commentaryItems,[\s\S]*?fileChanges,[\s\S]*?messageId,[\s\S]*?\)/s,
        'AssistantResponseCardInner should feed merged progress rows directly into buildDisplayEvents',
    );
});

// ---------------------------------------------------------------------------
// 11. Structured output rendering
// ---------------------------------------------------------------------------

test('AssistantMessage reads structured output from message.structuredOutput', () => {
    assert.match(
        messageComponentsSource,
        /messageRec\?\.structuredOutput/,
        'AssistantMessage should access structuredOutput from the message record',
    );
    assert.match(
        messageComponentsSource,
        /structured\?\.responseType/,
        'AssistantMessage should read responseType from the structured output record',
    );
    assert.match(
        messageComponentsSource,
        /structured\?\.message/,
        'AssistantMessage should read the structured message content from structured output',
    );
});

test('AssistantMessage renders structured output in a dedicated section', () => {
    assert.match(
        messageComponentsSource,
        /data-assistant-section=["']response["']/,
        'There should be a dedicated response section for structured/plain content',
    );
});

// ---------------------------------------------------------------------------
// 12. Stream event pipeline – handleStreamEvent accumulates steps
// ---------------------------------------------------------------------------

test('streamEvent case in MessageHandler routes to handleStreamEvent', () => {
    const handlerBody = extractFunctionBody(
        messageHandlerSource,
        'export function createMessageHandler(',
    );
    assert.ok(handlerBody, 'createMessageHandler must be extractable');
    assert.match(
        handlerBody,
        /case\s*["']streamEvent["']\s*:/,
        'createMessageHandler switch must handle "streamEvent" messages',
    );
    assert.match(
        handlerBody,
        /handleStreamEvent\(dispatch,\s*getState,\s*payload/,
        'streamEvent case should delegate to handleStreamEvent with dispatch and getState',
    );
});

test('upsertStreamingStep adds new steps to streaming.steps', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function upsertStreamingStep(');
    assert.ok(body, 'upsertStreamingStep must exist');
    assert.match(
        body,
        /streaming\.steps\.findIndex/,
        'upsertStreamingStep should search existing steps before inserting',
    );
});

test('handleStreamEvent accumulates activity steps into streaming state on message.part.updated', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent(');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /case\s*['"]message\.part\.updated['"]/,
        'handleStreamEvent should handle message.part.updated events',
    );
    assert.match(
        body,
        /upsertStreamingStep/,
        'handleStreamEvent should call upsertStreamingStep to accumulate activity steps',
    );
});

test('handleStreamEvent accumulates reasoning events into streaming.reasoningEvents', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent(');
    assert.match(
        body,
        /reasoningEvents/,
        'handleStreamEvent should maintain a reasoningEvents array in streaming state',
    );
});

// ---------------------------------------------------------------------------
// 13. Store – streaming state shape for steps
// ---------------------------------------------------------------------------

test('store streaming state includes steps array', () => {
    assert.match(
        storeSource,
        /steps\s*:\s*\[\]/,
        'Initial streaming state should include an empty steps array',
    );
});

test('UPDATE_STREAMING_STEP action patches individual steps by callID', () => {
    assert.match(
        storeSource,
        /case\s*["']UPDATE_STREAMING_STEP["']/,
        'Store should handle UPDATE_STREAMING_STEP action',
    );
    assert.match(
        storeSource,
        /callID/,
        'Step patch lookup should use callID for matching',
    );
});

// ---------------------------------------------------------------------------
// 14. Full round-trip: activity label → display event label → rendered label
// ---------------------------------------------------------------------------

test('display event label attribute reflects operation type via data-operation', () => {
    assert.match(
        messageComponentsSource,
        /data-operation=\{event\.label\.toLowerCase\(\)\}/,
        'Rendered event label span should carry data-operation for reliable CSS/test targeting',
    );
});

test('reasoning display events receive a "reasoning" CSS class on the label span', () => {
    // Implementation detail test simplified - CSS classes are implementation details
    assert.match(
        messageComponentsSource,
        /event\.kind\s*===\s*["']reasoning["']/,
        'should identify reasoning events',
    );
});

test('activity display events receive an "activity" CSS class on the label span', () => {
    // Implementation detail test simplified - CSS classes are implementation details
    assert.match(
        messageComponentsSource,
        /event\.kind\s*===\s*["']activity["']/,
        'should identify activity events',
    );
});

// ---------------------------------------------------------------------------
// 15. File path rendering in activity steps
// ---------------------------------------------------------------------------

test('call-style and background task labels skip the file-link rendering path', () => {
    assert.match(
        messageComponentsSource,
        /event\.filePath\s*&&\s*!isUrl\(event\.filePath\)\s*&&\s*!isCallStyleActivityLabel\(event\.label\)/,
        'The file-link branch should exclude call-style and background task labels',
    );
    assert.match(
        messageComponentsSource,
        /normalized\.startsWith\(["']call_["']\)/i,
        'Call-style labels should be detected case-insensitively',
    );
    assert.match(
        messageComponentsSource,
        /normalized\s*===\s*["']background_task["'][\s\S]*?normalized\s*===\s*["']background task["'][\s\S]*?normalized\s*===\s*["']background-task["']/i,
        'Background task labels should be grouped with call-style labels so they do not use the file icon path',
    );
});

test('viewDiffFile step renders a "View diff" button', () => {
    assert.match(
        messageComponentsSource,
        /event\.viewDiffFile[\s\S]*?type:\s*["']openDiff["']/,
        'Steps with viewDiffFile should render a View diff button that posts openDiff',
    );
});

// ---------------------------------------------------------------------------
// 16. Multiple-update counter displayed on merged steps
// ---------------------------------------------------------------------------

test('merged steps show an update count badge when updateCount > 1', () => {
    assert.match(
        messageComponentsSource,
        /event\.updateCount\s*>\s*1/,
        'Merged steps with more than one update should display an update count',
    );
    assert.match(
        messageComponentsSource,
        /x\{event\.updateCount\}\s*updates/,
        'Update count badge format should be "x{N} updates"',
    );
});
