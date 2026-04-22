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
  assert.match(source, /export class StructuredOutputProcessor/, 'should export the processor class');
  assert.match(
    source,
    /getStructuredOutputFormat\(\): Record<string, unknown> \{/,
    'should define getStructuredOutputFormat',
  );
  assert.match(
    source,
    /shouldUseStructuredOutput\(modelKey: string\): boolean \{/,
    'should define shouldUseStructuredOutput',
  );

  const formatBody = body('getStructuredOutputFormat()');
  assert.match(formatBody, /type:\s*"json_schema"/, 'should return a docs-style json schema envelope');
  assert.match(
    formatBody,
    /typeof topLevel\.retryCount === "number" \? topLevel\.retryCount : 1/,
    'should preserve schema retryCount with a default of 1',
  );
  assert.match(
    formatBody,
    /const required = Array\.isArray\(schemaRecord\?\.required\)[\s\S]*:\s*\["responseType"\];/,
    'should default required fields to responseType when the schema omits them',
  );
  assert.match(formatBody, /properties,\s*required,/, 'should forward schema properties and required fields');
  assert.match(
    formatBody,
    /\.\.\.\(allOf \? \{ allOf \} : \{\}\)/,
    'should preserve allOf when present',
  );

  const gatingBody = body('shouldUseStructuredOutput(modelKey: string)');
  assert.match(
    gatingBody,
    /this\.structuredOutputMode === "disabled"[\s\S]*return false;/,
    'should disable structured output when the mode is disabled',
  );
  assert.match(
    gatingBody,
    /this\.structuredOutputIncompatibleModelKeys\.has\(modelKey\)[\s\S]*return false;/,
    'should block incompatible model keys',
  );
  assert.match(gatingBody, /return true;/, 'should allow structured output otherwise');
});

test('StructuredOutputProcessor recognizes tool-call transcripts and normalizes error candidates', () => {
  assert.match(source, /isLikelyToolCallTranscript\(text: string\): boolean \{/, 'should define transcript detection');
  assert.match(source, /normalizeErrorCandidate\(value: unknown\): string \| undefined \{/, 'should define error candidate normalization');

  const transcriptBody = body('isLikelyToolCallTranscript(text: string)');
  assert.match(transcriptBody, /text\.toLowerCase\(\)\.trim\(\)/, 'should normalize transcript text before inspection');
  assert.match(transcriptBody, /if \(lower\.length < 50\) return false;/, 'should ignore short payloads');
  assert.match(
    transcriptBody,
    /const toolCallIndicators = \[[\s\S]*"tool call"[\s\S]*"function call"[\s\S]*"tool output"[\s\S]*\];/,
    'should keep a concrete list of tool transcript indicators',
  );
  assert.match(
    transcriptBody,
    /toolCallIndicators\.some\(\(indicator\) =>[\s\S]*lower\.startsWith\(indicator\)/,
    'should treat leading tool transcript prefixes as decisive',
  );
  assert.match(
    transcriptBody,
    /lower\.includes\("\{"\)[\s\S]*lower\.includes\('\"tool\"'\) \|\| lower\.includes\('\"function\"'\)[\s\S]*lower\.includes\('\"name\"'\)/,
    'should detect JSON-shaped tool transcripts as a fallback',
  );

  const normalizeErrorBody = body('normalizeErrorCandidate(value: unknown)');
  assert.match(
    normalizeErrorBody,
    /if \(typeof value === "string"\) \{[\s\S]*return value\.trim\(\);[\s\S]*\}/,
    'should trim string error candidates directly',
  );
  assert.match(normalizeErrorBody, /const rec = this\.asRecord\(value\);/, 'should normalize object candidates through asRecord');
  assert.match(
    normalizeErrorBody,
    /this\.firstNonEmptyString\(rec\.message, rec\.error, rec\.detail\)/,
    'should extract the first meaningful message-like field',
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
  const reasoningBody = body('isReasoningPartLike(part: unknown)');
  assert.match(reasoningBody, /const type = this\.firstNonEmptyString\(rec\.type\);/, 'should inspect the part type');
  assert.match(
    reasoningBody,
    /type\.toLowerCase\(\)\.includes\("reasoning"\)[\s\S]*type\.toLowerCase\(\)\.includes\("thinking"\)[\s\S]*typeof rec\.reasoning !== "undefined"[\s\S]*typeof rec\.thought !== "undefined"[\s\S]*typeof rec\.thinking !== "undefined"/,
    'should treat explicit reasoning and thinking markers as non-renderable reasoning parts',
  );

  const renderableBody = body('isRenderableTextPart(part: unknown)');
  assert.match(renderableBody, /if \(!type\) return true;/, 'should allow typeless parts to render by default');
  assert.match(renderableBody, /return !this\.isReasoningPartLike\(part\);/, 'should filter out reasoning-like parts');

  const interactiveTypeBody = body('isInteractiveResponseType(value: unknown)');
  assert.match(interactiveTypeBody, /String\(value\)\.toLowerCase\(\)\.trim\(\)/, 'should normalize candidate response types');
  assert.match(
    interactiveTypeBody,
    /return str === "question" \|\| str === "interactive" \|\| str === "confirm";/,
    'should recognize question, interactive, and confirm response types',
  );

  const promptBody = body('formatQuestionPromptForAssistant(question: string, options?: any[])');
  assert.match(promptBody, /let prompt = `USER QUESTION: \$\{question\}`;/, 'should prefix assistant-facing question prompts');
  assert.match(
    promptBody,
    /const label = typeof opt === "string" \? opt : opt\.label \|\| opt\.value \|\| "";/,
    'should derive option labels from strings, labels, or values',
  );
  assert.match(promptBody, /prompt \+= `\\n\\nOPTIONS:\\n\$\{optionsText\}`;/, 'should append option bullet lists when options exist');

  const derivePromptBody = body('deriveQuestionPromptFromInteractivePayload(payload:');
  assert.match(derivePromptBody, /const \{ question, options \} = payload;/, 'should destructure question payloads');
  assert.match(
    derivePromptBody,
    /return this\.formatQuestionPromptForAssistant\(question, options\);/,
    'should delegate interactive prompt formatting to the assistant formatter',
  );

  const lowValueBody = body('isLowValueInteractiveBodyText(value: string)');
  assert.match(
    lowValueBody,
    /"please answer the question"[\s\S]*"please select an option"[\s\S]*"waiting for your response"[\s\S]*"awaiting your input"/,
    'should screen out low-value interactive filler text',
  );
  assert.match(lowValueBody, /lowValuePhrases\.some\(\(phrase\) => lower\.includes\(phrase\)\)/, 'should use substring matching for low-value phrases');

  const clarificationBody = body('isClarificationQuestionnaire(content: unknown)');
  assert.match(
    clarificationBody,
    /Array\.isArray\(rec\.interactiveEvents\) \? rec\.interactiveEvents : undefined\) \|\|[\s\S]*Array\.isArray\(rec\.question\) \? \[\{ type: "question", question: rec\.question \}\] : undefined/,
    'should derive clarification events from interactiveEvents or question arrays',
  );
  assert.match(
    clarificationBody,
    /interactiveEvents\.some\([\s\S]*event\.type === "question" \|\| event\.type === "confirm"/,
    'should treat question and confirm events as clarification questionnaires',
  );
  assert.match(clarificationBody, /return hasQuestion;/, 'should return the questionnaire presence boolean directly');

  const messageIdBody = body('extractMessageId(message: any)');
  assert.match(
    messageIdBody,
    /this\.firstNonEmptyString\([\s\S]*message\.id,[\s\S]*message\.messageId,[\s\S]*message\.message_id,[\s\S]*\)/,
    'should extract message ids from multiple common field names',
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
  assert.match(normalizeBody, /return sanitizedCanonicalRec as StructuredAssistantOutput;/, 'should return sanitized canonical structured output');
});

test('StructuredOutputProcessor extracts, applies, and enriches structured payloads', () => {
  const extractBody = body('extractStructuredOutput(message: any)');
  assert.match(
    extractBody,
    /const candidates = \[[\s\S]*message\.structuredOutput,[\s\S]*message\.structured_output,[\s\S]*message\.info\?\.structuredOutput,[\s\S]*message\.info\?\.structured_output,[\s\S]*message\.info\?\.structured,[\s\S]*\];/,
    'should inspect structured output candidates from top-level and info payloads',
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
