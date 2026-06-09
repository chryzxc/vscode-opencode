/**
 * Regression tests for reasoning/planning text leaking into the AI response card.
 *
 * Three-layer defense:
 *   1. Extension — StructuredOutputProcessor sets message.content from structured
 *      fields (plan.summary / plan.intro) rather than concatenating raw parts.
 *   2. Webview — getMessageContent never returns streaming.content; always
 *      derives response body text from message fields.
 *   3. Webview — showResponseBody hides the markdown body during live streaming.
 *
 * Additional: text parts are joined with spaces not empty string to prevent
 * word-boundary smashing like "wins first.The plan".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readAllSources, readSource } from '../helpers/source-utils.mjs';

// ── Sources ──────────────────────────────────────────────────────────────────

const chatProviderSource = readAllSources([
  joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
  joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'),
  joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'),
  joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'),
  joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'),
  joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'),
  joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'),
  joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts'),
  joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'),
  joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'),
  joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'),
], 'ChatViewProvider (Modularized)');

const messageSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

const structOutputSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts')],
  'StructuredOutputProcessor.ts',
);

const handlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

// ── Layer 1: Extension — structured output populates message.content ─────────

test('StructuredOutputProcessor.applyStructuredOutputToMessage sets content from fallbackMessage for types without explicit message field', () => {
  const applyBody = extractFunctionBody(structOutputSource, 'applyStructuredOutputToMessage');

  // After the structured.message branch, there must be an else-if that
  // populates content from fallbackMessage when !updated.content.
  assert.match(
    applyBody,
    /else if\s*\(\s*fallbackMessage\s*&&\s*!\s*updated\.content\s*\)\s*\{/,
    'must populate content from fallbackMessage when structured.message is absent',
  );
  assert.match(
    applyBody,
    /updated\.content\s*=\s*fallbackMessage;/,
    'must assign fallbackMessage to updated.content',
  );
  // Must guard against overwriting already-set content.
  assert.match(
    applyBody,
    /!\s*updated\.content/,
    'must check !updated.content before overwriting',
  );
});

test('StructuredOutputProcessor.createFallbackMessage returns plan.intro/summary for implementation_plan', () => {
  const fallbackBody = extractFunctionBody(structOutputSource, 'createFallbackMessage');

  assert.match(
    fallbackBody,
    /case\s*["']implementation_plan["'][\s\S]*plan\?\.intro[\s\S]*plan\?\.summary/,
    'must return plan.intro || plan.summary || plan.title for implementation_plan fallback',
  );
});

test('extractMessageBodyText in both ChatViewProvider and StructuredOutputProcessor uses space join', () => {
  // Scan the combined provider source for ALL .join() calls inside
  // extractMessageBodyText functions. None should join with empty string.
  const extractMatches = [...chatProviderSource.matchAll(
    /extractMessageBodyText[\s\S]*?\.join\((["'])(.*?)\1\)/g,
  )];
  const emptyJoins = extractMatches.filter(m => m[2] === '');
  const spaceJoins = extractMatches.filter(m => m[2] === ' ');

  assert.ok(
    spaceJoins.length >= 1 && emptyJoins.length === 0,
    `All extractMessageBodyText .join() calls must use space separator. ` +
    `Found ${spaceJoins.length} space joins, ${emptyJoins.length} empty joins.`,
  );
});

// ── Layer 2: Webview — getMessageContent never returns streaming.content ─────

test('getMessageContent documents that streaming.content is never used', () => {
  assert.match(
    messageSource,
    /stream\.content is never used/,
    'JSDoc must state that streaming.content is never returned',
  );
  assert.match(
    messageSource,
    /three-layer defense/,
    'JSDoc must document the three-layer defense architecture',
  );
});

test('getMessageContent bypasses streaming entirely and falls through to message path', () => {
  assert.match(
    messageSource,
    /if\s*\(\s*streaming\s*\)\s*\{\s*if\s*\(\s*!\s*message\s*\)\s*return\s*""\s*;\s*\}/,
    'streaming branch must only guard against !message, then fall through',
  );
  // The streaming branch must NOT contain return content (from stream.content).
  const getMessageContentBody = extractFunctionBody(messageSource, 'function getMessageContent(');
  const afterStreamGuard = getMessageContentBody.replace(
    /if\s*\(\s*streaming\s*\)\s*\{[\s\S]*?\}/, '',
  );
  assert.ok(
    afterStreamGuard.includes('messageBodyFromParts') || afterStreamGuard.includes('firstNonEmptyString'),
    'after streaming guard, function must use message-based content extraction',
  );
});

// ── Layer 3: Webview — showResponseBody hides body during live streaming ─────

test('showResponseBody gates the MarkdownRenderer on !isLiveStream', () => {
  assert.match(
    messageSource,
    /showResponseBody\s*=\s*hasResponseContent\s*&&\s*!\s*isLiveStream/,
    'showResponseBody must be false during live streaming',
  );
  assert.match(
    messageSource,
    /\{\s*showResponseBody\s*&&[\s\S]*MarkdownRenderer/,
    'MarkdownRenderer in the response section must be gated by showResponseBody',
  );
});

test('effectiveResponseContent uses visibleResolvedContent as primary source, planLeadMessage as fallback', () => {
  assert.match(
    messageSource,
    /visibleResolvedContent[\s\S]*\?\s*visibleResolvedContent[\s\S]*:\s*planLeadMessage/,
    'effectiveResponseContent must use visibleResolvedContent first, planLeadMessage only when empty',
  );
});

// ── Combined: all three layers must coexist in the source ────────────────────

test('all three reasoning-leak defense layers are present in the codebase', () => {
  // Layer 1
  assert.match(
    structOutputSource,
    /else if\s*\(\s*fallbackMessage\s*&&\s*!\s*updated\.content\s*\)/,
    'Layer 1: StructuredOutputProcessor fallback content setting',
  );
  // Layer 2
  assert.match(
    messageSource,
    /stream\.content is never used/,
    'Layer 2: getMessageContent ignores streaming.content',
  );
  // Layer 3
  assert.match(
    messageSource,
    /showResponseBody\s*=\s*hasResponseContent\s*&&\s*!\s*isLiveStream/,
    'Layer 3: showResponseBody hides body during live streaming',
  );
});

// ── Activity timeline stays pending while subagent/tool execution is ongoing ──

test('buildDisplayEvents considers assistantTurnPending for reasoning status so timeline shows ongoing work', () => {
  assert.match(
    messageSource,
    /isStreamingActive\s*\|\|\s*assistantTurnPending[\s\S]*\?\s*["']pending["']\s*:\s*["']done["']/,
    'reasoning status must be "pending" when either isStreamingActive OR assistantTurnPending is true',
  );
});

test('AssistantMessageInner reads assistantTurnPending from app state for timeline rendering', () => {
  assert.match(
    messageSource,
    /assistantTurnPending\s*\}\s*=\s*useAppState\(\)/,
    'AssistantMessageInner must destructure assistantTurnPending from useAppState()',
  );
});

test('thoughtItemsFromStreaming falls back to streaming.content as thinking step when no reasoning exists', () => {
  assert.match(
    messageSource,
    /streaming\.content[\s\S]*stream-content-as-thinking/,
    'thoughtItemsFromStreaming must fall back to streaming.content as a thinking step keyed as stream-content-as-thinking',
  );
});

// ── Activity timeline: pending stream-content reasoning always visible, pushed to end ──

test('pending stream-content-as-thinking reasoning survives activity condensation', () => {
  assert.match(
    messageSource,
    /streamContentReasoningIdx[\s\S]*pendingStreamReasoning[\s\S]*visibleMainEvents/,
    'pending stream-content reasoning must be extracted before condensation so it survives the slice',
  );
  assert.match(
    messageSource,
    /visibleMainEvents[\s\S]*pendingStreamReasoning\s*\?[\s\S]*visibleMainEvents[\s\S]*pendingStreamReasoning/,
    'pending stream-content reasoning must be appended back to visible events after condensation',
  );
});

test('pending stream-content-as-thinking reasoning is pushed to the end of the timeline', () => {
  assert.match(
    messageSource,
    /pinnedIdx[\s\S]*splice[\s\S]*\[\.\.\.timelineDisplayEvents,\s*pinned\]/,
    'pending stream-content reasoning must be spliced out and pushed to the end of timelineDisplayEvents',
  );
});

// ── Loading state mirrors stop button visibility ──

test('InputWrapper includes assistantTurnPending in isAiResponding for stop button visibility', () => {
  assert.match(
    panelSource,
    /assistantTurnPending[\s\S]*isAiResponding/,
    'InputWrapper must destructure assistantTurnPending and use it in isAiResponding',
  );
  assert.match(
    panelSource,
    /streaming\?\.isActive\s*\|\|[\s\S]*assistantTurnPending/,
    'isAiResponding must include assistantTurnPending alongside streaming?.isActive',
  );
});

test('StickyHeader shows Thinking... loading text when session is processing', () => {
  assert.match(
    panelSource,
    /isProcessing\s*&&\s*\([\s\S]*animate-pulse[\s\S]*Thinking/,
    'StickyHeader must show a pulsing Thinking... text when isProcessing is true',
  );
});

// ── Lifecycle events with renderable text finish streaming to prevent stuck loading ──

test('lifecycle message.updated with renderable structured text triggers FINISH_STREAMING', () => {
  assert.match(
    handlerSource,
    /structuredKind\s*===\s*["']lifecycle["'][\s\S]*hasRenderableLiveStructuredUpdate/,
    'FINISH_STREAMING condition must include lifecycle events with renderable structured updates',
  );
});
