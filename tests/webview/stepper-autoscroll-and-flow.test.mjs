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
    /React\.useEffect\(/,
    'Stepper should use useEffect to drive auto-scroll',
  );
  assert.match(
    stepperSource,
    /if\s*\(\s*!autoScrollToBottom\s*\)\s*return/,
    'Stepper auto-scroll effect should bail out when autoScrollToBottom is false',
  );
  assert.match(
    stepperSource,
    /el\.scrollTop\s*=\s*el\.scrollHeight/,
    'Stepper should set scrollTop = scrollHeight to reach the bottom',
  );
});

test('Stepper auto-scroll effect runs after every render (no dependency array)', () => {
  // A useEffect with no dep-array fires on every render so each new step triggers it.
  // Verify the effect is not locked to a specific dep array that would miss step additions.
  assert.match(
    stepperSource,
    /React\.useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?el\.scrollTop\s*=\s*el\.scrollHeight[\s\S]*?\}\s*\)/,
    'Stepper scroll useEffect should have no dependency array so it fires on every render',
  );
  assert.doesNotMatch(
    stepperSource,
    /el\.scrollTop\s*=\s*el\.scrollHeight[\s\S]{0,60}\},\s*\[.+\]\s*\)/,
    'Stepper scroll useEffect must not have a narrow dependency array that would miss new steps',
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
    /autoScrollToBottom=\{isStreamingActive\}/,
    'The main activity Stepper must receive autoScrollToBottom driven by isStreamingActive',
  );
});

test('AssistantMessage still keeps progressTimelineRef on the activity Stepper', () => {
  assert.match(
    messageComponentsSource,
    /ref=\{progressTimelineRef\}/,
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
  const body = extractFunctionBody(messageComponentsSource, 'function progressItemsFromStreaming(');
  assert.ok(body, 'progressItemsFromStreaming must exist');
  assert.match(
    body,
    /Array\.isArray\(streaming\.steps\)\s*&&\s*streaming\.steps\.length > 0/,
    'Should check streaming.steps first',
  );
  assert.match(
    body,
    /Array\.isArray\(streaming\.progressEvents\)\s*&&\s*streaming\.progressEvents\.length > 0/,
    'Should fall back to streaming.progressEvents when steps is empty',
  );
});

test('progressItemsFromMessage promotes any remaining pending steps to done', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function progressItemsFromMessage(');
  assert.ok(body, 'progressItemsFromMessage must exist');
  assert.match(
    body,
    /item\.status\s*===\s*["']pending["']/,
    'progressItemsFromMessage should look for pending items',
  );
  assert.match(
    body,
    /item\.status\s*=\s*["']done["']/,
    'progressItemsFromMessage should promote pending items to done (hydration transition)',
  );
});

test('progressItemsFromSteps deduplicates by title using a Map', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function progressItemsFromSteps(');
  assert.ok(body, 'progressItemsFromSteps must exist');
  assert.match(
    body,
    /stepMap\s*=\s*new Map/,
    'progressItemsFromSteps should use a Map for deduplication',
  );
  assert.match(
    body,
    /stepMap\.has\(mergeKey\)/,
    'Should check for existing entry before inserting',
  );
  assert.match(
    body,
    /return Array\.from\(stepMap\.values\(\)\)/,
    'Should emit deduplicated steps from the map',
  );
});

// ---------------------------------------------------------------------------
// 4. Reasoning – thoughtItems construction
// ---------------------------------------------------------------------------

test('thoughtItemsFromStreaming derives thought items from reasoningEvents first', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function thoughtItemsFromStreaming(');
  assert.ok(body, 'thoughtItemsFromStreaming must exist');
  assert.match(
    body,
    /streaming\.reasoningEvents\s*&&\s*streaming\.reasoningEvents\.length > 0/,
    'Should prefer reasoningEvents when present',
  );
  assert.match(
    body,
    /event\.text\.trim\(\)/,
    'Should trim reasoning event text before including it',
  );
});

test('thoughtItemsFromMessage deduplicates reasoning text via normalised fingerprints', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function thoughtItemsFromMessage(');
  assert.ok(body, 'thoughtItemsFromMessage must exist');
  assert.match(
    body,
    /seen\s*=\s*new Set/,
    'Should track seen fingerprints in a Set to avoid duplicate reasoning blocks',
  );
  assert.match(
    body,
    /seen\.has\(fp\)/,
    'Should skip already-seen reasoning text fingerprints',
  );
  assert.match(
    body,
    /seen\.add\(fp\)/,
    'Should record new fingerprints after inserting',
  );
});

// ---------------------------------------------------------------------------
// 5. Timeline construction
// ---------------------------------------------------------------------------

test('buildTimeline sorts thinking and step entries by arrival sequence', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildTimeline(');
  assert.ok(body, 'buildTimeline must exist');
  assert.match(
    body,
    /entries\.sort\(\(a,\s*b\)\s*=>\s*a\.seq\s*-\s*b\.seq\)/,
    'buildTimeline should sort all timeline entries by their arrival seq',
  );
});

test('buildTimeline groups consecutive same-kind entries into blocks', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildTimeline(');
  assert.match(
    body,
    /last\?\.kind\s*===\s*["']thinking["']/,
    'Consecutive thinking entries should merge into the same ThinkingBlock',
  );
  assert.match(
    body,
    /last\?\.kind\s*===\s*["']steps["']/,
    'Consecutive step entries should merge into the same StepsBlock',
  );
});

test('buildTimeline falls back to parts-based layout for persisted messages without timing', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildTimeline(');
  assert.match(
    body,
    /Array\.isArray\(parts\)\s*&&\s*parts\.length > 0/,
    'Should use message.parts as layout source when timing data is absent',
  );
});

// ---------------------------------------------------------------------------
// 6. Display events construction
// ---------------------------------------------------------------------------

test('buildDisplayEvents skips content blocks', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');
  assert.ok(body, 'buildDisplayEvents must exist');
  assert.match(
    body,
    /block\.kind\s*===\s*["']content["'][\s\S]*?continue/,
    'buildDisplayEvents should skip timeline blocks of kind "content"',
  );
});

test('buildDisplayEvents emits reasoning display events from thinking blocks', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');
  assert.match(
    body,
    /block\.kind\s*===\s*["']thinking["']/,
    'buildDisplayEvents should process thinking blocks',
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
    /const isLast\s*=\s*index\s*===\s*timelineDisplayEvents\.length\s*-\s*1/,
    'isLast should be derived from the event index vs array length',
  );
  assert.match(
    messageComponentsSource,
    /isLast=\{isLast\}/,
    'StepperItem should receive the derived isLast prop',
  );
});

test('latest streaming event is marked with is-streaming class', () => {
  assert.match(
    messageComponentsSource,
    /const isLatestStreamingEvent\s*=\s*isStreamingActive\s*&&\s*isLast/,
    'isLatestStreamingEvent should be true only for the last event during active streaming',
  );
  assert.match(
    messageComponentsSource,
    /isLatestStreamingEvent[\s\S]*?["']is-streaming["']/,
    'Latest streaming event StepperItem should receive the "is-streaming" CSS class',
  );
});

test('pending step indicator shows animated pulse dot', () => {
  assert.match(
    messageComponentsSource,
    /event\.status\s*===\s*["']pending["'][\s\S]*?animate-pulse/,
    'Pending steps should display an animated pulse indicator dot',
  );
});

test('done step indicator shows a check icon', () => {
  // Pattern: pending ? <pulse> : event.status === "error" ? <X/> : <Check/>
  assert.match(
    messageComponentsSource,
    /event\.status\s*===\s*["']error["'][\s\S]{1,200}<X\b[\s\S]{1,300}<Check\b/,
    'Non-error completed steps should show a Check icon as indicator',
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
    /!isStreamingActive[\s\S]*?!isLatestAssistantMessage[\s\S]*?displayEvents\.length > MAX_VISIBLE_COMPLETED_ACTIVITY/s,
    'Condensed activity should only apply to non-streaming, non-latest messages',
  );
  assert.match(
    messageComponentsSource,
    /displayEvents\.slice\(-MAX_VISIBLE_COMPLETED_ACTIVITY\)/,
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

test('AssistantMessage computes displayEvents from timelineBlocks via buildDisplayEvents', () => {
  assert.match(
    messageComponentsSource,
    /const displayEvents\s*=\s*useMemo\(\s*\(\)\s*=>\s*buildDisplayEvents\(timelineBlocks,\s*message,\s*isStreamingActive\)/,
    'displayEvents should be derived from buildDisplayEvents(timelineBlocks, message, isStreamingActive)',
  );
  assert.match(
    messageComponentsSource,
    /\[timelineBlocks,\s*message,\s*isStreamingActive\]/,
    'displayEvents memo deps should include timelineBlocks, message and isStreamingActive',
  );
});

test('AssistantMessage builds timelineBlocks from both streaming and message data', () => {
  assert.match(
    messageComponentsSource,
    /streaming\s*\?\s*progressItemsFromStreaming\(streaming\)\s*:\s*progressItemsFromMessage\(message\)/,
    'progressItems should come from streaming when active, message otherwise',
  );
  assert.match(
    messageComponentsSource,
    /streaming\s*\?\s*thoughtItemsFromStreaming\(streaming\)\s*:\s*thoughtItemsFromMessage\(message\)/,
    'thoughtItems should come from streaming when active, message otherwise',
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
  assert.match(
    messageComponentsSource,
    /event\.kind\s*===\s*["']reasoning["']\s*&&\s*["']reasoning["']/,
    'Label span should get a "reasoning" class when the event kind is reasoning',
  );
});

test('activity display events receive an "activity" CSS class on the label span', () => {
  assert.match(
    messageComponentsSource,
    /event\.kind\s*===\s*["']activity["']\s*&&\s*["']activity["']/,
    'Label span should get an "activity" class when the event kind is activity',
  );
});

// ---------------------------------------------------------------------------
// 15. File path rendering in activity steps
// ---------------------------------------------------------------------------

test('step with a filePath renders an openFile button instead of plain summary', () => {
  assert.match(
    messageComponentsSource,
    /event\.filePath\s*\?[\s\S]*type:\s*["']openFile["']/,
    'When a step has a filePath, clicking should post an openFile message',
  );
  assert.match(
    messageComponentsSource,
    /title=\{event\.filePath\}/,
    'File button should expose the full path via title for accessibility',
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
