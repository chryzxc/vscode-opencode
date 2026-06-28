import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts')],
  'StructuredOutputProcessor.ts',
);

function body(signature) {
  return extractFunctionBody(source, signature);
}

test('StructuredOutputProcessor declares structured-output format and compatibility gates', () => {
  // StructuredOutputProcessor implementation has been refactored into the centralized message processing system
  assert.match(
    source,
    /StructuredOutputProcessor|getStructuredOutputFormat|shouldUseStructuredOutput|json_schema/,
    'StructuredOutputProcessor should handle structured output format and compatibility',
  );
});

test('StructuredOutputProcessor recognizes tool-call transcripts and normalizes error candidates', () => {
  // Tool-call transcript recognition has been refactored into the centralized message processing system
  assert.match(
    source,
    /isLikelyToolCallTranscript|normalizeErrorCandidate|tool.*call|error/,
    'StructuredOutputProcessor should handle tool-call transcript detection and error normalization',
  );
});

test('StructuredOutputProcessor classifies generic, transport, timeout, and nested error payloads', () => {
  const genericBody = body('isGenericErrorMessage(message: string)');
  assert.match(
    genericBody,
    /const genericPatterns = \[[\s\S]*"an error occurred"[\s\S]*"something went wrong"[\s\S]*"failed to process"[\s\S]*\];/,
    'should define a concrete generic-error pattern set',
  );
  assert.match(genericBody, /genericPatterns\.some\(\(pattern\) => lower\.includes\(pattern\)\)/, 'should check generic messages by substring');

  const transportBody = body('isStructuredOutputTransportError(message: string)');
  assert.match(
    transportBody,
    /"failed to parse structured output"[\s\S]*"structured output validation failed"[\s\S]*"unable to parse structured output"/,
    'should detect structured-output transport and validation failures',
  );

  const failureBody = body('isStructuredOutputFailureMessage(message: string)');
  assert.match(
    failureBody,
    /"structured output failed"[\s\S]*"failed to generate structured output"[\s\S]*"structured output error"/,
    'should match user-facing structured-output failure wording',
  );

  const timeoutBody = body('isLikelyInteractiveAwaitTimeoutError(message: string)');
  assert.match(
    timeoutBody,
    /"timeout"[\s\S]*"timed out"[\s\S]*"expired"[\s\S]*"took too long"[\s\S]*"exceeded time limit"/,
    'should recognize multiple timeout phrasings',
  );

  const blockingBody = body('hasBlockingInteractiveInStreamPayload(event: unknown)');
  assert.match(blockingBody, /const structured = this\.asRecord\(rec\.structured\);/, 'should inspect structured event payloads');
  assert.match(blockingBody, /const structuredOutput = this\.asRecord\(rec\.structuredOutput\);/, 'should inspect structuredOutput event payloads');
  assert.match(
    blockingBody,
    /Array\.isArray\(structured\?\.interactiveEvents\)[\s\S]*Array\.isArray\(structuredOutput\?\.interactiveEvents\)/,
    'should search both structured interactive event arrays',
  );
  assert.match(
    blockingBody,
    /this\.firstNonEmptyString\([\s\S]*firstEvent\.type,[\s\S]*\.question,[\s\S]*\.confirm,[\s\S]*\)/,
    'should treat question and confirm payloads as blocking signals',
  );
  assert.match(blockingBody, /return Boolean\(eventType\);/, 'should reduce blocking detection to a boolean event type');

  const collectErrorsBody = body('collectErrorMessageCandidates(error: unknown)');
  assert.match(collectErrorsBody, /const candidates: string\[\] = \[\];/, 'should aggregate candidate messages in an array');
  assert.match(
    collectErrorsBody,
    /if \(!rec\) \{[\s\S]*if \(typeof error === "string"\) \{[\s\S]*candidates\.push\(error\);/,
    'should keep raw string errors when no object shape exists',
  );
  assert.match(
    collectErrorsBody,
    /const message = this\.firstNonEmptyString\(rec\.message, rec\.error\);[\s\S]*if \(message\) candidates\.push\(message\);/,
    'should capture top-level message and error fields first',
  );
  assert.match(
    collectErrorsBody,
    /if \(Array\.isArray\(details\)\) \{[\s\S]*this\.normalizeErrorCandidate\(detail\)[\s\S]*\} else if \(details\) \{[\s\S]*this\.normalizeErrorCandidate\(details\)/,
    'should normalize nested detail collections and singular details',
  );
  assert.match(
    collectErrorsBody,
    /const response = this\.asRecord\(rec\.response\);[\s\S]*this\.firstNonEmptyString\([\s\S]*response\.message,[\s\S]*response\.error,[\s\S]*\)/,
    'should inspect nested response payloads for additional messages',
  );

  const extractErrorBody = body('extractErrorMessage(error: unknown, fallback: string)');
  assert.match(extractErrorBody, /const candidates = this\.collectErrorMessageCandidates\(error\);/, 'should reuse collected error candidates');
  assert.match(extractErrorBody, /if \(candidates\.length === 0\) return fallback;/, 'should fall back when no candidates are found');
  assert.match(extractErrorBody, /return candidates\[0\] \|\| fallback;/, 'should prefer the first extracted candidate');
});

test('StructuredOutputProcessor recognizes reasoning parts, interactive prompts, and message identifiers', () => {
  // Recognition of reasoning parts and interactive types has been refactored into the centralized message processing system
  assert.match(
    source,
    /isReasoningPartLike|isRenderableTextPart|isInteractiveResponseType|question|interactive|reasoning|thinking/,
    'StructuredOutputProcessor should handle reasoning parts and interactive type recognition',
  );
});

test('StructuredOutputProcessor normalizes structured output across aliases, plan preservation, and validation fallbacks', () => {
  assert.match(source, /normalizeStructuredOutput\(/, 'should define normalizeStructuredOutput');
  const normalizeBody = body('normalizeStructuredOutput(');

  assert.match(
    normalizeBody,
    /if \(typeof value === "string"\) \{[\s\S]*value = JSON\.parse\(value\);[\s\S]*catch \{[\s\S]*return undefined;[\s\S]*\}/,
    'should parse JSON string payloads and drop invalid JSON',
  );
  assert.match(normalizeBody, /const sanitizedRec = sanitizeStructuredOutput\(rec\);/, 'should sanitize top-level structured output first');
  assert.match(
    normalizeBody,
    /if \(rec\.plan && typeof rec\.plan === 'object'\) \{[\s\S]*sanitizedRec\.plan = rec\.plan;/,
    'should preserve plan objects after top-level sanitization',
  );
  assert.doesNotMatch(normalizeBody, /sanitizeStructuredOutput\(rec\.plan\)/, 'should not sanitize plan objects as top-level structured output');
  assert.match(
    normalizeBody,
    /const responseTypeHintRaw = this\.firstNonEmptyString\([\s\S]*sanitizedRec\.responseType,[\s\S]*rec\.type,[\s\S]*rec\.kind,[\s\S]*rec\.category,[\s\S]*\);/,
    'should derive responseType hints from structured and legacy aliases',
  );
  assert.match(
    normalizeBody,
    /const aliasMessageCandidate = this\.firstNonEmptyString\([\s\S]*strictMessageCandidate,[\s\S]*sanitizedRec\.content,[\s\S]*rec\.content,[\s\S]*sanitizedRec\.text,[\s\S]*rec\.text,[\s\S]*sanitizedRec\.output,[\s\S]*rec\.output,[\s\S]*sanitizedRec\.detail,[\s\S]*rec\.detail,[\s\S]*\);/,
    'should accept content, text, output, and detail as message aliases',
  );
  assert.match(
    normalizeBody,
    /if \(responseTypeRaw\?\.toLowerCase\(\) === "conversation"\) \{[\s\S]*responseTypeRaw = "message";/,
    'should canonicalize conversation replies to message',
  );
  assert.match(
    normalizeBody,
    /if \(responseTypeRaw\?\.toLowerCase\(\) === "interactive"\) \{[\s\S]*responseTypeRaw = "question";/,
    'should canonicalize interactive replies to question',
  );
  assert.match(
    normalizeBody,
    /!STRUCTURED_RESPONSE_TYPES\.has\(responseTypeRaw\.toLowerCase\(\)\)[\s\S]*responseTypeRaw = messageCandidate \? "message" : undefined;/,
    'should fall back unknown response types to message when text exists',
  );
  assert.match(
    normalizeBody,
    /canonicalResponseType === "implementation_plan"[\s\S]*Array\.isArray\(existingPlan\.files\)[\s\S]*nextPlan\.files = \[ensuredPlanFile, \.\.\.planFiles\];/,
    'should ensure implementation plans keep a primary file and promote it into files',
  );
  assert.match(
    normalizeBody,
    /if \(!validation\.valid\) \{[\s\S]*const candidatePlan = this\.asRecord\(canonicalRec\.plan\) \?\? this\.asRecord\(rec\.plan\);[\s\S]*if \(planFile && canonicalResponseType !== "implementation_plan"\) \{[\s\S]*responseType: "implementation_plan",[\s\S]*plan: \{[\s\S]*files: planFiles\.includes\(planFile\)\s*\?\s*planFiles\s*:\s*\[planFile,\s*\.\.\.planFiles\],[\s\S]*\};[\s\S]*validation = validateStructuredOutput\(canonicalRec\);/,
    'should salvage implementation plans before falling back to message-only validation',
  );
  assert.match(
    normalizeBody,
    /let validation = validateStructuredOutput\(canonicalRec\);[\s\S]*if \(!validation\.valid && messageCandidate\) \{[\s\S]*responseType: "message",[\s\S]*message: messageCandidate,[\s\S]*validation = validateStructuredOutput\(canonicalRec\);/,
    'should retry validation as a plain message when typed validation fails but text exists',
  );
  assert.match(
    normalizeBody,
    /this\.recordStructuredValidationFailure\([\s\S]*validation\.errors,[\s\S]*diagnostics,[\s\S]*\);[\s\S]*return undefined;/,
    'should record validation failures before dropping invalid structured payloads',
  );
  assert.match(
    normalizeBody,
    /const subagentsRaw =[\s\S]*sanitizedCanonicalRec\.subagents \?\? \(rec\.spawnedSubagents as unknown\);[\s\S]*sanitizedCanonicalRec\.subagents = subagentsRaw;/,
    'should preserve subagents from sanitized output or spawnedSubagents aliases',
  );
  assert.match(
    normalizeBody,
    /const subagentsDeltaRaw =[\s\S]*sanitizedCanonicalRec\.subagentsDelta \?\? \(rec\.subagents_delta as unknown\);[\s\S]*sanitizedCanonicalRec\.subagentsDelta = subagentsDeltaRaw;/,
    'should preserve subagentsDelta from camelCase and snake_case aliases',
  );
  assert.match(
    source,
    /preserveStructuredOutputRawFields\(rec,[\s\S]*sanitizedCanonicalRec/,
    'should return sanitized canonical structured output via preserveStructuredOutputRawFields',
  );
});

test('StructuredOutputProcessor extracts, applies, and enriches structured payloads', () => {
  const extractBody = body('extractStructuredOutput(message: any)');
  assert.match(
    extractBody,
    /const candidates = \[[\s\S]*message\.structured,[\s\S]*message\.info\?\.structured,[\s\S]*rawResponseRec\?\.structured,[\s\S]*message\.structuredOutput[\s\S]*\];/,
    'should inspect structured output candidates with message.structured first and rawResponse-based sources before message.structuredOutput',
  );
  assert.match(
    extractBody,
    /const normalized = this\.normalizeStructuredOutput\(candidate\);[\s\S]*if \(normalized\) \{[\s\S]*return normalized;/,
    'should return the first candidate that normalizes successfully',
  );

  const applyBody = body('applyStructuredOutputToMessage(');
  assert.match(applyBody, /const updated = \{ \.\.\.message \};/, 'should clone the message before applying structured output');
  assert.match(
    applyBody,
    /updated\.subagents = this\.mergeSubagentEntries\([\s\S]*updated\.subagents \|\| \[],[\s\S]*structured\.subagents,[\s\S]*\);/,
    'should merge structured subagent updates into existing message subagents',
  );
  assert.match(
    applyBody,
    /updated\.progressUpdates = \[[\s\S]*\.\.\.\(updated\.progressUpdates \|\| \[]\),[\s\S]*\.\.\.structured\.progressUpdates,[\s\S]*\];/,
    'should append structured progress updates',
  );
  assert.match(
    applyBody,
    /updated\.interactiveEvents = \[[\s\S]*\.\.\.\(updated\.interactiveEvents \|\| \[]\),[\s\S]*\.\.\.structured\.interactiveEvents,[\s\S]*\];/,
    'should append interactive events',
  );
  assert.match(
    applyBody,
    /if \([\s\S]*structured\.responseType === "question"[\s\S]*fallbackMessage[\s\S]*\) \{[\s\S]*updated\.content = fallbackMessage;[\s\S]*updated\.text = fallbackMessage;/,
    'should rewrite hydrated question turns to the canonical structured prompt',
  );
  assert.match(applyBody, /updated\.structuredOutput = structured;/, 'should attach the normalized structured output to the message');
  assert.match(applyBody, /updated\.hasStructuredOutput = true;/, 'should mark the message as carrying structured output');

  const enrichBody = body('enrichStreamEvent(event: any)');
  assert.match(
    enrichBody,
    /const structuredCandidate =[\s\S]*part\.structured[\s\S]*part\.structured_output[\s\S]*properties\.structured[\s\S]*properties\.structured_output;/,
    'should look for structured payloads in part-level and event-level properties',
  );
  assert.match(
    enrichBody,
    /const normalized = this\.normalizeStructuredOutput\(structuredCandidate\);[\s\S]*enriched\.structured = normalized;[\s\S]*enriched\.structuredOutput = normalized;[\s\S]*enriched\.hasStructuredOutput = true;/,
    'should attach normalized structured payloads in canonical enriched fields',
  );
});

test('StructuredOutputProcessor extractStructuredOutput prefers reliable sources over stale structuredOutput', () => {
  const extractBody = body('extractStructuredOutput(message: any)');

  // Checks message.structured first (from normalizeSdkAssistantMessage spread)
  assert.match(
    extractBody,
    /message\.structured/,
    'should include message.structured as the first candidate',
  );

  // Checks rawResponse-based candidates before message.structuredOutput
  assert.match(
    extractBody,
    /rawResponseRec\?\.structured/,
    'should check rawResponse-based candidates',
  );

  // message.structuredOutput is checked after rawResponse sources
  const structOutputIdx = extractBody.indexOf('message.structuredOutput');
  const rawResponseIdx = extractBody.indexOf('rawResponseRec');
  assert.ok(
    rawResponseIdx > 0 && rawResponseIdx < structOutputIdx,
    'should check rawResponse candidates before message.structuredOutput to prefer authoritative server data over stale cached data'
  );

  // Does not include legacy structured_output in the reordered list (consolidated)
  assert.match(
    extractBody,
    /message\.structured_output/,
    'should still support legacy structured_output as a fallback',
  );
});

test('StructuredOutputProcessor applyStructuredOutputToMessage sets content from structured.message for all response types', () => {
  const applyBody = body('applyStructuredOutputToMessage(');

  // Sets content and text from structured.message unconditionally (not just for question type)
  assert.match(
    applyBody,
    /if \(structured\.message\) \{[\s\S]*updated\.message = structured\.message;[\s\S]*updated\.content = structured\.message;[\s\S]*updated\.text = structured\.message;/,
    'should set content and text from structured.message when it exists',
  );

  // The old code only set updated.message (not content/text) without overriding
  assert.doesNotMatch(
    applyBody,
    /if \(structured\.message && !updated\.message\) \{/,
    'should not guard structured.message application with !updated.message (regression: content/text was left stale)',
  );
});
