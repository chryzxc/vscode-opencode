import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const messageHandler = readSource([
  joinFromRoot('webview/shared/src/chat/lib/messageHandler.ts'),
], 'messageHandler');

const messageComponents = readSource([
  joinFromRoot('webview/shared/src/chat/MessageComponents.tsx'),
], 'MessageComponents');

const panelComponents = readSource([
  joinFromRoot('webview/shared/src/chat/PanelComponents.tsx'),
], 'PanelComponents');

const centralizedDebugPayloadFilter = readSource([
  joinFromRoot('webview/shared/src/chat/lib/generated/centralizedDebugPayloadFilter.ts'),
], 'centralizedDebugPayloadFilter');

const schemaSource = readSource([
  joinFromRoot('src/shared/structuredOutputSchema.ts'),
], 'structuredOutputSchema');

test('implementation plans route into the plan card renderer', () => {
  assert.match(messageComponents, /const plan = message\?\.plan;/, 'plan extraction should use canonical message.plan only');
  assert.doesNotMatch(messageComponents, /structuredOutputForPlanRendering|planAttachmentFromStructuredCandidate|structuredOutputCandidatesForMessage/, 'plan renderer should not rely on plan-specific fallback helpers');
  assert.match(messageComponents, /responseType !== "implementation_plan"\s*\|\|\s*!plan/, 'plan card rendering should be gated by implementation_plan responseType');
});

test('plan cards can render from plan.file without requiring plan.content', () => {
  assert.match(messageComponents, /plan\.file|file|plan/i, 'plan.file rendering branch is missing');
  assert.match(messageComponents, /plan|file|span|title/i, 'plan.file display text is missing');
});

test('latest implementation plan wins when duplicate plan files exist', () => {
  assert.match(
    messageComponents,
    /const matchingPlanIndexes = messages[\s\S]*Math\.max\(\.\.\.matchingPlanIndexes\)[\s\S]*return ownIndex === lastMatchingPlanIndex;/s,
    'plan-card duplicate suppression should prefer the latest matching plan message',
  );
  assert.match(
    messageComponents,
    /asRecord\(infoRec\?\.structuredOutput\)[\s\S]*asRecord\(infoRec\?\.structured\)/s,
    'plan-file comparison should inspect structured output from message.info as well as top-level fields',
  );
});

test('question responses render interactive options', () => {
  assert.match(messageHandler, /responseType === 'question'/, 'question response normalization is missing');
  assert.match(panelComponents, /event\.type === "question" \? \(/, 'question option rendering is missing');
  assert.match(panelComponents, /event\.options\.map/, 'question option map rendering is missing');
});

test('progress updates flow through the structured-output pipeline', () => {
  assert.match(schemaSource, /progressUpdate[s]?: \{?/i, 'progress update schema field is missing');
  assert.match(messageHandler, /progressUpdates: progressUpdates\.length > 0 \? progressUpdates : undefined/, 'progress update normalization is missing');
});

test('todo updates are surfaced through the inline todo summary path', () => {
  assert.match(messageComponents, /scopedTodoItems\.length > 0/, 'todo summary gate is missing');
  assert.match(messageComponents, /TodoInlineSummary/, 'todo inline summary renderer is missing');
});

test('retryWithoutStructuredOutput falls back to plain text', () => {
  assert.match(messageComponents, /retryWithoutStructuredOutput: boolean/, 'retry flag parameter is missing');
  assert.match(messageComponents, /Retrying without structured output\.\.\./, 'structured-output retry label is missing');
  assert.match(messageComponents, /retryLastMessage\(retryWithoutStructuredOutput\)/, 'retry flow is missing');
});

test('schema exposes responseType enum values', () => {
  assert.match(schemaSource, /enum: \["message", "implementation_plan", "question", "progress_update"\]/, 'responseType enum is missing');
  assert.match(schemaSource, /required: \["responseType"\]/, 'responseType requirement is missing');
});

test('plan status states include draft executing and revision requested', () => {
  assert.match(messageComponents, /let status: "Draft" \| "Executing" \| "Revision Requested" \| undefined;/, 'plan status union is missing');
  assert.match(messageComponents, /planStatus === "Executing"/, 'executing plan badge is missing');
  assert.match(messageComponents, /planStatus === "Revision Requested"/, 'revision requested badge is missing');
  assert.match(messageComponents, /planStatus === "Draft"/, 'draft plan badge is missing');
});

test('structured output is normalized before rendering', () => {
  assert.match(messageHandler, /function normalizeStructuredOutput\(value: unknown\): StructuredOutput \| undefined/, 'structured output normalizer is missing');
  assert.match(messageHandler, /const sanitizedRec = sanitizeStructuredOutput\(rec\);/, 'structured output sanitization is missing');
  assert.match(messageHandler, /const validation = validateStructuredOutput\(sanitizedRec\);/, 'structured output validation is missing');
});

test('assistant response card branches on structured responseType without raw fallback', () => {
  const responseBodyHelper = extractFunctionBody(
    messageComponents,
    'function assistantResponseContentFromStructuredOutput({',
  );
  assert.match(
    messageComponents,
    /function assistantResponseContentFromStructuredOutput\([\s\S]*switch \(normalizedResponseType\)[\s\S]*case "question":[\s\S]*case "progress_update":[\s\S]*case "implementation_plan":[\s\S]*case "message":/s,
    'response card should branch by centralized structured responseType',
  );
  assert.match(
    messageComponents,
    /const effectiveResponseContent = structuredResponseContent;/,
    'response card should prefer centralized structured content directly',
  );
  assert.doesNotMatch(
    responseBodyHelper,
    /getFinalAssistantResponseTextFromRawSdkEventPayloads\(/,
    'response card helper should not read raw payload text as a visible response fallback',
  );
});

test('question and progress structured cards render from centralized message data', () => {
  assert.match(
    messageComponents,
    /responseType === "question"/,
    'question response card should be rendered directly from centralized structured output',
  );
  assert.match(
    messageComponents,
    /responseType === "progress_update"/,
    'progress update response card should be rendered directly from centralized structured output',
  );
  assert.match(
    messageComponents,
    /structuredQuestionActionOptions\.map/,
    'question response card should render centralized choices',
  );
  assert.match(
    messageComponents,
    /structuredProgressUpdatesList\.map/,
    'progress response card should render centralized progress steps',
  );
});

test('centralized debug data filters excluded payload types through an array gate', () => {
  assert.match(
    centralizedDebugPayloadFilter,
    /const CENTRALIZED_DEBUG_EXCLUDED_PATH_RULES = \[/,
    'centralized debug exclusion list should be array-driven',
  );
  assert.match(
    centralizedDebugPayloadFilter,
    /"server\.heartbeat"/,
    'centralized debug exclusion list should include server heartbeats',
  );
  assert.match(
    centralizedDebugPayloadFilter,
    /"source"/,
    'centralized debug exclusion list should include source-based filtering',
  );
  assert.match(
    centralizedDebugPayloadFilter,
    /"\/global\/event"/,
    'centralized debug exclusion list should exclude global events',
  );
  assert.match(
    centralizedDebugPayloadFilter,
    /"properties\.info\.format\.type"/,
    'centralized debug exclusion list should include nested format matching',
  );
  assert.match(
    centralizedDebugPayloadFilter,
    /"syncEvent\.data\.info\.format\.type"/,
    'centralized debug exclusion list should include sync event format matching',
  );
  assert.match(
    centralizedDebugPayloadFilter,
    /"json_schema"/,
    'centralized debug exclusion list should include json_schema values',
  );
  assert.match(
    centralizedDebugPayloadFilter,
    /shouldIncludeCentralizedDebugPayload\(payload: unknown\): boolean/,
    'centralized debug payloads should be filtered before being exposed',
  );
});

test('raw structured payloads are preserved alongside canonical fields', () => {
  assert.match(
    messageHandler,
    /const rawStructuredOutputs = collectRawStructuredOutputCandidates\(rec\);/,
    'raw structured candidates should be preserved on the normalized message',
  );
  assert.match(
    messageHandler,
    /const rawPlan = extractRawPlanFromMessageRecord\(rec\);[\s\S]*normalized\.plan = rawPlan(?: as Message\["plan"\])?;/,
    'raw plan objects should be copied through without being normalized',
  );
});

test('implementation plan messages suppress the aggregated diff section on the same turn', () => {
  assert.match(
    messageComponents,
    /if \(plan\?\.file\) \{[\s\S]*return false;[\s\S]*\}/,
    'implementation plan turns should skip the aggregated file changes section',
  );
});

test('non-plan assistant turns do not render the implementation plan section', () => {
  assert.match(
    messageComponents,
    /const showResponseSection =[\s\S]*timelineDisplayEvents\.length > 0[\s\S]*hasActiveTimelineWork[\s\S]*hasActiveReasoningPart[\s\S]*hasPendingReasoningDisplayEvent/s,
    'response section should depend on the plan card gate and timeline activity',
  );
});

test('raw stream debug can be converted back into structured output', () => {
  assert.match(messageHandler, /function structuredOutputFromRawDebug\(parsedRawDebug: ParsedRawDebug\): StructuredOutput \| undefined/, 'raw-debug structured output helper is missing');
  const body = extractFunctionBody(messageHandler, 'function structuredOutputFromRawDebug(parsedRawDebug: ParsedRawDebug): StructuredOutput | undefined {');
  assert.match(body, /infoRec\?\.structuredOutput/, 'raw debug structured output extraction is missing');
});

test('question payloads preserve allowCustomInput and options', () => {
  assert.match(messageHandler, /allowCustomInput === true/, 'allowCustomInput propagation is missing');
  assert.match(messageHandler, /const rootOptions = normalizeChoices\(questionOptionSource\);/, 'question option normalization is missing');
  assert.match(messageHandler, /allowCustomInput: rootAllowCustomInput/, 'question allowCustomInput passthrough is missing');
});
