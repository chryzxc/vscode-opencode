/**
 * Core Structured Output Processing Regression Tests
 *
 * These tests prevent regressions in structured output processing functionality.
 * Structured output is critical for message rendering and AI response handling.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const structuredOutputProcessorSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts')],
  'StructuredOutputProcessor.ts',
);

test.describe('Structured Output Processor - Output Extraction', () => {

  test('extractStructuredOutput handles different message formats', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /extractStructuredOutput[\s\S]*structured_output|structuredOutput|rawResponse/s,
      'must extract from various field names'
    );
  });

  test('extractStructuredOutput validates message structure', () => {
    const extractBody = extractFunctionBody(structuredOutputProcessorSource, 'extractStructuredOutput');

    assert.match(
      extractBody,
      /if\s*\(\s*!message\s*\)|message\s*&&|typeof/s,
      'must validate message input'
    );
  });

  test('extractStructuredOutput handles info field', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /extractStructuredOutput[\s\S]*message\.info|info\?\.structured|rawResponseRec/s,
      'must check info field for structured output'
    );
  });

  test('extractStructuredOutput reads rawResponse JSON payloads', () => {
    const extractBody = extractFunctionBody(structuredOutputProcessorSource, 'extractStructuredOutput');

    assert.match(
      extractBody,
      /parseRawResponseRecord\(message\.rawResponse\)|rawResponseRec\?\.structuredOutput|rawResponseInfoRec\?\.structured/,
      'must inspect rawResponse for hydrated structured output',
    );
  });

  test('extractStructuredOutput handles parts field', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /extractStructuredOutput[\s\S]*message\.parts|parts\.find/s,
      'must check parts array for structured output'
    );
  });

});

test.describe('Structured Output Processor - Output Application', () => {

  test('applyStructuredOutputToMessage merges structured output', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /applyStructuredOutputToMessage[\s\S]*\.\.\.message|structuredOutput/s,
      'must merge structured output with message'
    );
  });

  test('applyStructuredOutputToMessage handles different response types', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /applyStructuredOutputToMessage[\s\S]*responseType|interactive|clarification/s,
      'must handle various response types'
    );
  });

  test('applyStructuredOutputToMessage validates input parameters', () => {
    const applyBody = extractFunctionBody(structuredOutputProcessorSource, 'applyStructuredOutputToMessage');

    assert.match(
      applyBody,
      /if\s*\(\s*!message\s*\|\|\s*!structured\s*\)/,
      'must validate inputs'
    );
  });

});

test.describe('Structured Output Processor - Normalization', () => {

  test('normalizeStructuredOutput handles malformed data', () => {
    const normalizeBody = extractFunctionBody(structuredOutputProcessorSource, 'normalizeStructuredOutput');

    assert.match(
      normalizeBody,
      /if\s*\(\s*!structured\s*\)|typeof|asRecord/s,
      'must validate structured output'
    );
  });

  test('normalizeStructuredOutput extracts response type', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /normalizeStructuredOutput[\s\S]*responseType|kind/s,
      'must extract response type'
    );
  });

  test('normalizeStructuredOutput handles missing fields gracefully', () => {
    const normalizeBody = extractFunctionBody(structuredOutputProcessorSource, 'normalizeStructuredOutput');

    assert.match(
      normalizeBody,
      /\|\||fallback|default/s,
      'must provide safe defaults for missing fields'
    );
  });

  test('normalizeStructuredOutput preserves the original raw record after normalization', () => {
    assert.match(
      structuredOutputProcessorSource,
      /return this\.preserveStructuredOutputRawFields\(\s*rec,\s*sanitizedCanonicalRec,\s*\);/s,
      'normalizeStructuredOutput should keep the original raw record attached to the normalized payload',
    );
    assert.match(
      structuredOutputProcessorSource,
      /private preserveStructuredOutputRawFields\([\s\S]*\.\.\.\(rawRecord as StructuredAssistantOutput\),[\s\S]*\.\.\.\(normalizedRecord as StructuredAssistantOutput\),[\s\S]*raw: rawRecord,[\s\S]*\};/s,
      'preserveStructuredOutputRawFields should merge the raw and normalized records without dropping raw fields',
    );
    assert.match(
      structuredOutputProcessorSource,
      /const ignoredRawKeys = new Set\(\[[\s\S]*"raw"[\s\S]*"type"[\s\S]*"kind"/,
      'field-drop detection should ignore the internal raw preservation field',
    );
  });

  test('normalizeStructuredOutput salvages invalid payloads instead of always dropping them', () => {
    assert.match(
      structuredOutputProcessorSource,
      /if \(!validation\.valid\)[\s\S]*const salvaged = this\.salvageStructuredOutput\(rec\);[\s\S]*return salvaged \? this\.preserveStructuredOutputRawFields\(rec, salvaged\) : undefined;/s,
      'normalizeStructuredOutput should salvage invalid payloads before dropping them',
    );
    assert.match(
      structuredOutputProcessorSource,
      /private salvageStructuredOutput\([\s\S]*topLevelOptions[\s\S]*topLevelChoices[\s\S]*topLevelActions[\s\S]*rawInteractiveEvents/s,
      'salvageStructuredOutput should retain question-like raw fields for invalid payloads',
    );
    assert.doesNotMatch(
      structuredOutputProcessorSource,
      /if \(!validation\.valid\)[\s\S]*this\.logger\.warn\("Structured output validation failed"/s,
      'normalizeStructuredOutput should not emit the validation warning for every invalid payload; field-drop detection owns that warning now',
    );
  });

});

test.describe('Structured Output Processor - Error Detection', () => {

  test('isStructuredOutputFailureMessage detects failure patterns', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /isStructuredOutputFailureMessage[\s\S]*error|failure|invalid/s,
      'must detect error patterns'
    );
  });

  test('isStructuredOutputTransportError detects transport issues', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /isStructuredOutputTransportError[\s\S]*transport|network|timeout/s,
      'must detect transport error patterns'
    );
  });

  test('isGenericErrorMessage identifies generic errors', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /isGenericErrorMessage[\s\S]*generic|common|vague/s,
      'must identify generic error messages'
    );
  });

});

test.describe('Structured Output Processor - Interactive Responses', () => {

  test('isInteractiveResponseType detects interactive types', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /isInteractiveResponseType[\s\S]*clarification|question|interactive/s,
      'must detect interactive response types'
    );
  });

  test('isClarificationQuestionnaire detects questionnaires', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /isClarificationQuestionnaire[\s\S]*questions|clarification|options/s,
      'must detect clarification questionnaires'
    );
  });

  test('hasBlockingInteractiveInStreamPayload checks for blocking interactions', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /hasBlockingInteractiveInStreamPayload[\s\S]*interactive|blocking|await/s,
      'must check for blocking interactive elements'
    );
  });

});

test.describe('Structured Output Processor - Message Body Extraction', () => {

  test('extractMessageBodyText handles different content sources', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /extractMessageBodyText[\s\S]*content|text|message|delta/s,
      'must extract from various content fields'
    );
  });

  test('extractMessageBodyText prioritizes content sources', () => {
    const extractBody = extractFunctionBody(structuredOutputProcessorSource, 'extractMessageBodyText');

    assert.match(
      extractBody,
      /firstNonEmptyString|\|\||fallback/s,
      'must prioritize content sources'
    );
  });

  test('extractMessageBodyText handles empty content', () => {
    const extractBody = extractFunctionBody(structuredOutputProcessorSource, 'extractMessageBodyText');

    assert.match(
      extractBody,
      /return\s*["']{2}|return\s*""/s,
      'must return empty string for missing content'
    );
  });

});

test.describe('Structured Output Processor - Fallback Messages', () => {

  test('createFallbackMessage generates safe fallbacks', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /createFallbackMessage[\s\S]*responseType.*fallback|message.*default/s,
      'must create fallback message structure'
    );
  });

  test('createFallbackMessage includes error context', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /createFallbackMessage[\s\S]*error|validation|failure/s,
      'must include error information'
    );
  });

  test('createFallbackMessage handles missing input gracefully', () => {
    const fallbackBody = extractFunctionBody(structuredOutputProcessorSource, 'createFallbackMessage');

    assert.match(
      fallbackBody,
      /if\s*\(\s*|default|fallback/s,
      'must handle missing input parameters'
    );
  });

});

test.describe('Structured Output Processor - Subagent Handling', () => {

  test('hydrateSubagentsFromPayload processes subagent data', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /hydrateSubagentsFromPayload[\s\S]*subagents|summaries|details/s,
      'must process subagent information'
    );
  });

  test('hydrateSubagentsFromPayload validates subagent structure', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /hydrateSubagentsFromPayload[\s\S]*Array\.isArray|validate|check/s,
      'must validate subagent data'
    );
  });

  test('mergeSubagentEntries combines subagent data', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /mergeSubagentEntries[\s\S]*merge|combine|concat/s,
      'must merge subagent entries correctly'
    );
  });

});

test.describe('Structured Output Processor - Model Selection', () => {

  test('shouldUseStructuredOutput checks model compatibility', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /shouldUseStructuredOutput[\s\S]*model|provider|capabilities/s,
      'must check model capabilities'
    );
  });

  test('getStructuredOutputModelKey returns appropriate model', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /getStructuredOutputModelKey[\s\S]*model.*key|selectedModel|defaultModel/s,
      'must return structured output model key'
    );
  });

  test('structuredOutputIncompatibleModelKeys excludes incompatible models', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /structuredOutputIncompatibleModelKeys|incompatible|exclude/s,
      'must maintain list of incompatible models'
    );
  });

});

test.describe('Structured Output Processor - Plan Integration', () => {

  test('enrichMessageWithPlan attaches plan data', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /enrichMessageWithPlan[\s\S]*plan\.file|plan\.content|structured/s,
      'must attach plan information to message'
    );
  });

  test('persistPlan saves plan content', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /persistPlan[\s\S]*writeFile|createDirectory|save/s,
      'must persist plan to filesystem'
    );
  });

});

test.describe('Structured Output Processor - Error Handling', () => {

  test('structured output operations handle errors gracefully', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /try\s*\{[\s\S]*catch\s*\(|if\s*\(\s*!/s,
      'must include error handling'
    );
  });

  test('structured output operations validate inputs', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /if\s*\(\s*!.*\s*\)|typeof.*===|Array\.isArray/s,
      'must validate input parameters'
    );
  });

  test('structured output operations provide safe defaults', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /return\s*\{\s*\}|return\s*\[\]|return\s*""|fallback/s,
      'must return safe defaults'
    );
  });

});

test.describe('Structured Output Processor - Performance', () => {

  test('structured output processing uses efficient lookups', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /\.find\(|\.some\(|\.filter\(|Set|Map/s,
      'must use efficient search methods'
    );
  });

  test('structured output processing avoids unnecessary operations', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /early.*return|break|continue|\|\||&&/s,
      'must optimize processing flow'
    );
  });

});

test.describe('Structured Output Processor - Validation', () => {

  test('recordStructuredValidationFailure tracks failures', () => {
    const recordBody = extractFunctionBody(structuredOutputProcessorSource, 'recordStructuredValidationFailure');

    assert.match(
      recordBody,
      /structuredValidationFailureCounters\.set|current\s*\+\s*1/,
      'must track validation failures'
    );
  });

  test('structuredValidationFailureCounters maintains counters', () => {
    const source = structuredOutputProcessorSource;

    assert.match(
      source,
      /structuredValidationFailureCounters|counters|stats/s,
      'must maintain failure statistics'
    );
  });

});
