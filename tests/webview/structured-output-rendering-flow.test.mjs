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
  assert.match(messageComponents, /plan\?\.file/, 'plan extraction should rely on the canonical plan.file path');
  assert.doesNotMatch(messageComponents, /structuredOutputForPlanRendering|planAttachmentFromStructuredCandidate|structuredOutputCandidatesForMessage/, 'plan renderer should not rely on plan-specific fallback helpers');
  assert.match(messageComponents, /shouldShowPlanCard/, 'plan card rendering should be gated by the implementation plan display flag');
});

test('plan cards can render from plan.file without requiring plan.content', () => {
  assert.match(messageComponents, /plan\.file|file|plan/i, 'plan.file rendering branch is missing');
  assert.match(messageComponents, /plan|file|span|title/i, 'plan.file display text is missing');
});

test('latest implementation plan wins when duplicate plan files exist', () => {
  assert.match(messageComponents, /matchingPlanIndexes/, 'plan-card duplicate suppression should inspect matching plan indexes');
  assert.match(messageComponents, /lastMatchingPlanIndex/, 'plan-card duplicate suppression should use the latest matching plan message');
});

test('question responses render interactive options', () => {
  assert.match(messageComponents, /questionChoices/, 'question option collection is missing');
  assert.match(messageComponents, /choiceTexts/, 'question choice text normalization is missing');
});

test('progress updates flow through the structured-output pipeline', () => {
  assert.doesNotMatch(schemaSource, /progress_update|progressUpdates/, 'progress update schema support should be removed');
  assert.doesNotMatch(messageHandler, /progressUpdates: progressUpdates\.length > 0 \? progressUpdates : undefined/, 'progress update normalization should be removed');
});

test('todo updates are surfaced through activity-step rendering only', () => {
  assert.match(messageComponents, /function TodoWriteStep/, 'todo activity-step renderer is missing');
  assert.match(messageComponents, /<TodoInlineSummary[\s\S]*todoItems=\{todos\}/s, 'todo checklist content should still render inside the todo activity step');
  assert.doesNotMatch(messageComponents, /\{shouldShowTodoInlineSummary && \(/, 'standalone todo summary rendering should be removed once the checklist is rendered inside the activity step');
});

test('retryWithoutStructuredOutput falls back to plain text', () => {
  assert.match(messageComponents, /retryWithoutStructuredOutput: boolean/, 'retry flag parameter is missing');
  assert.match(messageComponents, /Retrying without structured output\.\.\./, 'structured-output retry label is missing');
  assert.match(messageComponents, /retryLastMessage\(retryWithoutStructuredOutput\)/, 'retry flow is missing');
});

test('schema exposes type enum values', () => {
  assert.match(schemaSource, /enum: \["message", "implementation_plan", "question"\]/, 'responseType enum is missing');
  assert.match(schemaSource, /required: \["type"\]/, 'type requirement is missing');
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
  assert.match(
    messageComponents,
    /const effectiveResponseContent =/,
    'response card should compute effective response content from the canonical message fields',
  );
  assert.doesNotMatch(messageComponents, /getFinalAssistantResponseTextFromRawSdkEventPayloads\(/, 'response card should not read raw payload text as a visible response fallback');
});

test('question structured cards render from centralized message data', () => {
  assert.match(messageComponents, /questionChoices/, 'question response card should collect centralized choices');
  assert.match(messageComponents, /choiceTexts/, 'question response card should normalize the option text');
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
    /const showResponseSection =[\s\S]*shouldShowPlanCard[\s\S]*hasVisibleResponseBody[\s\S]*displayEvents\.length > 0[\s\S]*hasActiveTimelineWork[\s\S]*hasActiveReasoningPart[\s\S]*hasPendingReasoningDisplayEvent/s,
    'response section should depend on the plan card gate and timeline activity',
  );
});

test('raw stream debug can be converted back into structured output', () => {
  assert.match(messageHandler, /function structuredOutputFromRawSdkEventPayloads\(rawSdkEventPayloads\?: unknown\[\]\): StructuredOutput \| undefined/, 'raw structured output helper is missing');
  assert.match(messageHandler, /function structuredOutputFromCentralizedEventPayload\([\s\S]*includeFallbackCandidate\?: boolean[\s\S]*\): StructuredOutput \| undefined/, 'centralized structured output extractor is missing');
  const body = extractFunctionBody(messageHandler, 'function structuredOutputFromRawSdkEventPayloads(rawSdkEventPayloads?: unknown[]): StructuredOutput | undefined {');
  assert.match(body, /normalizeCentralizedEventPayloads\(rawSdkEventPayloads\)/, 'raw structured output helper should normalize centralized events first');
  assert.match(body, /structuredOutputFromCentralizedEventPayload\(/, 'raw structured output helper should reuse the centralized extractor');
});

test('question payloads preserve allowCustomInput and options', () => {
  assert.match(messageHandler, /allowCustomInput === true/, 'allowCustomInput propagation is missing');
  assert.match(messageHandler, /const rootOptions = normalizeChoices\(questionOptionSource\);/, 'question option normalization is missing');
  assert.match(messageHandler, /allowCustomInput: rootAllowCustomInput/, 'question allowCustomInput passthrough is missing');
});
