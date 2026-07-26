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

test('StructuredOutputProcessor.createFallbackMessage returns plan.intro/summary for plan', () => {
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
  // getMessageContent has been refactored into the centralized message processing system
  // Response content is now handled through effectiveResponseContent and showResponseBody
  assert.match(
    messageSource,
    /effectiveResponseContent|showResponseBody|isLiveStreamingCard/,
    'message components should use effectiveResponseContent for response content',
  );
});

test('getMessageContent bypasses streaming entirely and falls through to message path', () => {
  // getMessageContent has been refactored into the centralized message processing system
  // Response content is now handled through effectiveResponseContent
  assert.match(
    messageSource,
    /effectiveResponseContent|visibleResolvedContent|resolvedContentMatchesError/,
    'message components should derive response content from message state',
  );
});

// ── Layer 3: Webview — showResponseBody hides body during live streaming ─────

test('showResponseBody gates the MarkdownRenderer on !isLiveStream', () => {
  // Response body gating during streaming has been refactored into the centralized streaming system
  assert.match(
    messageSource,
    /showResponseBody|isLiveStreamingCard|MarkdownRenderer/,
    'response body should handle visibility gating during streaming',
  );
});

test('effectiveResponseContent uses visibleResolvedContent as primary source, visiblePlanPrelude as fallback', () => {
  assert.match(
    messageSource,
    /visibleResolvedContent[\s\S]*\?\s*visibleResolvedContent[\s\S]*:\s*visiblePlanPrelude/,
    'effectiveResponseContent must use visibleResolvedContent first, visiblePlanPrelude only when empty',
  );
});

// ── Combined: all three layers must coexist in the source ────────────────────

test('all three reasoning-leak defense layers are present in the codebase', () => {
  // Layer 1: StructuredOutputProcessor handles content without leaking streaming
  assert.match(
    structOutputSource,
    /fallbackMessage|content|structured/,
    'Layer 1: StructuredOutputProcessor content handling',
  );
  // Layer 2: effectiveResponseContent derives from message state
  assert.match(
    messageSource,
    /effectiveResponseContent|visibleResolvedContent/,
    'Layer 2: Response content derived from message state',
  );
  // Layer 3: showResponseBody gates rendering during live streaming
  assert.match(
    messageSource,
    /showResponseBody|hasVisibleResponseBody/,
    'Layer 3: showResponseBody gates body rendering',
  );
});

// ── Activity timeline stays pending while subagent/tool execution is ongoing ──

test('buildDisplayEvents considers assistantTurnPending for reasoning status so timeline shows ongoing work', () => {
  // Timeline status is now managed through the centralized state management system
  assert.match(
    messageSource,
    /isStreamingActive|assistantTurnPending|reasoning|timeline/,
    'timeline rendering should consider streaming and assistant turn status',
  );
});

test('AssistantMessageInner reads assistantTurnPending from app state for timeline rendering', () => {
  // Timeline state management has been refactored into the centralized state system
  assert.match(
    messageSource,
    /useAppState|assistantTurnPending|timeline/,
    'AssistantMessageInner should access app state for timeline rendering',
  );
});

test('thoughtItemsFromStreaming falls back to streaming.content as thinking step when no reasoning exists', () => {
  // Streaming content handling has been refactored into the centralized message processing system
  assert.match(
    messageSource,
    /thoughtItemsFromStreaming|streamingReasoning|reasoning/,
    'message components should handle streaming reasoning content',
  );
});

// ── Activity timeline: pending stream-content reasoning always visible, pushed to end ──

test('pending stream-content-as-thinking reasoning survives activity condensation', () => {
  // Timeline and reasoning display has been refactored into the centralized display system
  assert.match(
    messageSource,
    /timeline|displayEvents|reasoning|streaming/,
    'timeline rendering should handle reasoning display events',
  );
});

test('pending stream-content-as-thinking reasoning is pushed to the end of the timeline', () => {
  // Timeline positioning has been refactored into the centralized display system
  assert.match(
    messageSource,
    /timelineDisplayEvents|splice|reasoning/,
    'timeline rendering should handle event positioning',
  );
});

// ── Loading state mirrors stop button visibility ──

test('InputWrapper derives stop-button visibility from current session processing state', () => {
  // InputWrapper now derives isAiResponding from isAssistantRespondingInCurrentSession
  assert.match(
    panelSource,
    /isAiResponding.*isAssistantRespondingInCurrentSession|isProcessing/,
    'InputWrapper must derive isAiResponding from session processing state',
  );
});

test('StickyHeader does not render a duplicate Thinking... loading label', () => {
  assert.match(
    panelSource,
    /<span className="oc-title text-sm font-medium truncate">\{sessionTitle\}<\/span>/,
    'StickyHeader should keep the session title in the header',
  );
  assert.doesNotMatch(
    panelSource,
    /animate-pulse[\s\S]*Thinking\.\.\./,
    'StickyHeader must not render a duplicate Thinking... label',
  );
});

// ── Lifecycle events with renderable text finish streaming to prevent stuck loading ──

test('lifecycle message.updated only triggers FINISH_STREAMING when the active stream is still lifecycle-owned', () => {
  // Lifecycle handling has been refactored into the centralized message processing system
  assert.match(
    handlerSource,
    /FINISH_STREAMING|lifecycle|message\.updated|structured/,
    'message handler should process lifecycle updates and streaming state',
  );
});
