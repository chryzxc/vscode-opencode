import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readAllSources, } from '../helpers/source-utils.mjs';

const chatProviderSource = readAllSources([
  joinFromRoot("src", "providers", "ChatViewProvider.ts"),
  joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts"),
  joinFromRoot("src", "providers", "chat", "PlanManager.ts"),
  joinFromRoot("src", "providers", "chat", "StructuredOutputProcessor.ts"),
], "Chat modularized logic");

test("history hydration reuses canonical processing path and disables synthetic fallback errors", () => {
  // History processing has been refactored to use HistoryProcessor module
  assert.match(
    chatProviderSource,
    /processHistoryMessages|HistoryProcessor|historyProcessor/,
    "ChatViewProvider should use HistoryProcessor for message history processing",
  );
});

test("assistant burst coalescing keeps latest base and dedupes timeline arrays", () => {
  const coalesceBody = extractFunctionBody(chatProviderSource, 'private coalesceAssistantBurst(burst: any[]): any',
  );

  assert.match(
    coalesceBody,
    /const\s+base\s*=\s*\{\s*\.\.\.\(burst\[burst\.length\s*-\s*1\]\s*\|\|\s*burst\[0\]\s*\|\|\s*\{\}\)\s*\};/,
    "coalesceAssistantBurst should use the latest assistant fragment as the base snapshot",
  );
  assert.match(
    coalesceBody,
    /appendUnique\(/,
    "coalesceAssistantBurst should use uniqueness-preserving appends for merged timeline arrays",
  );
  assert.doesNotMatch(
    coalesceBody,
    /const\s+mergeArrayField\s*=\s*\(field:\s*string\)/,
    "coalesceAssistantBurst should not re-append base arrays with mergeArrayField (causes duplicate activity rows)",
  );
  assert.match(
    coalesceBody,
    /let\s+latestRawResponse\s*:\s*unknown\s*=\s*base\.rawResponse;/,
    "coalesceAssistantBurst should track latest rawResponse while collapsing assistant bursts",
  );
  assert.match(
    coalesceBody,
    /base\.rawResponse\s*=\s*latestRawResponse;/,
    "coalesceAssistantBurst should retain rawResponse for hydrated debug rendering parity",
  );
  assert.match(
    coalesceBody,
    /base\.reasoningEvents\s*=\s*Array\.isArray\(base\.reasoningEvents\)/,
    "coalesceAssistantBurst should preserve hydrated reasoning events from earlier assistant fragments",
  );
  assert.match(
    coalesceBody,
    /base\.info\s*=\s*mergeInfoRecord\(base\.info,\s*message\?\.info\);/,
    "coalesceAssistantBurst should merge info metadata so hydrated token stats and durations survive",
  );
  assert.match(
    coalesceBody,
    /base\.variant\s*=\s*message\.variant;/,
    "coalesceAssistantBurst should backfill the thinking variant from earlier assistant fragments",
  );
});

test("assistant burst coalescing avoids collapsing distinct assistant replies", () => {
  const burstBody = extractFunctionBody(
    chatProviderSource,
    'public mergeConsecutiveAssistantBursts(messages: any[]): any[]',
  );
  const guardBody = extractFunctionBody(
    chatProviderSource,
    'private shouldMergeAssistantBurstMessages(previous: any, next: any): boolean',
  );

  assert.match(
    burstBody,
    /!this\.shouldMergeAssistantBurstMessages\(previous,\s*message\)/,
    "mergeConsecutiveAssistantBursts should split bursts when messages are not part of the same assistant turn",
  );
  assert.match(
    guardBody,
    /if \(!previousActivityOnly && !nextActivityOnly\)\s*\{\s*return false;\s*\}/,
    "burst merge guard should not collapse two content-bearing assistant replies",
  );
  assert.match(
    guardBody,
    /return Boolean\(previousId && nextId && previousId === nextId\);/,
    "burst merge guard should only merge assistant entries that share the same message id",
  );

  const adjacentActivityBody = extractFunctionBody(
    chatProviderSource,
    'public mergeAdjacentAssistantActivityMessages(messages: any[]): any[]',
  );
  assert.match(
    adjacentActivityBody,
    /lastId === currentId/,
    "adjacent activity merge should only combine fragments that share the same message id",
  );
});

test("history timestamps parse numeric created fields instead of falling back to Date.now", () => {
  const createdAtBody = extractFunctionBody(
    chatProviderSource,
    'private historyMessageCreatedAt(message: any): number | undefined',
  );

  assert.match(
    createdAtBody,
    /time\?\.created/,
    "historyMessageCreatedAt should read time.created numeric timestamps",
  );
  assert.match(
    createdAtBody,
    /typeof candidate === "number" && Number\.isFinite\(candidate\)/,
    "historyMessageCreatedAt should preserve numeric timestamps without string coercion",
  );
  assert.doesNotMatch(
    createdAtBody,
    /return Date\.now\(\);/,
    "historyMessageCreatedAt should not default to Date.now which can collapse unrelated hydration turns",
  );
});

test("session hydration does not apply extension-owned message overrides", () => {
  assert.doesNotMatch(chatProviderSource, /applySessionMessageOverrides\(sessionId, messages\)/);
});

test("final assistant response does not persist a debug hydration override", () => {
  const sendBody = extractFunctionBody(chatProviderSource, 'private async handleSendMessage(',
  );

  assert.doesNotMatch(
    sendBody,
    /persistSessionMessageOverride/,
    "SDK history must not be replaced with a local debug payload",
  );
});

test("structured-output fallback synthesis can be disabled for session reload normalization", () => {
  const applyBody = extractFunctionBody(chatProviderSource, 'private applyStructuredOutputToMessage(',
  );

  assert.match(
    applyBody,
    /const\s+allowSyntheticFallbackError\s*=\s*[\s\S]*options\?\.allowSyntheticFallbackError\s*!==\s*false/,
    "applyStructuredOutputToMessage should accept a toggle for synthetic fallback errors",
  );
  assert.match(
    applyBody,
    /if\s*\(!allowSyntheticFallbackError\)\s*\{\s*return message;\s*\}/,
    "applyStructuredOutputToMessage should skip synthetic error-text injection when disabled",
  );
});

test("mirror-deduper preserves intentional idless repeats while merging synthetic/local mirrors", () => {
  const mirrorBody = extractFunctionBody(chatProviderSource, 'private areMirrorHistoryMessages(a: any, b: any): boolean',
  );
  const canonicalIdBody = extractFunctionBody(chatProviderSource, 'private pickCanonicalHistoryMessageId(messages: any[]): string | undefined',
  );

  assert.match(
    mirrorBody,
    /else if\s*\(!existingId\s*&&\s*!incomingId\)\s*\{[\s\S]*return false;/,
    "dedupe should not collapse repeated idless user turns",
  );
  assert.match(
    mirrorBody,
    /Math\.abs\(existingCreatedAt\s*-\s*incomingCreatedAt\)\s*<=\s*15_000/,
    "dedupe should only merge mirror entries when timestamps are close",
  );
  assert.match(
    canonicalIdBody,
    /!this\.isSyntheticLocalMessageId\(id\)/,
    "canonical id selection should prefer non-synthetic message ids when merging",
  );
});

test("history hydration filters internal system-reminder transport messages", () => {
  const renderableBody = extractFunctionBody(chatProviderSource, 'private hasRenderableHistoryPayload(message: any): boolean',
  );
  const helperBody = extractFunctionBody(chatProviderSource, 'private isInternalSystemReminderMessage(message: any): boolean',
  );

  assert.match(
    renderableBody,
    /this\.isInternalSystemReminderMessage\(message\)/,
    "hasRenderableHistoryPayload should check for internal reminder messages",
  );
  assert.match(
    helperBody,
    /lower\.includes\("<system-reminder>"\)/,
    "internal reminder detector should recognize <system-reminder> wrapper payloads",
  );
  assert.match(
    helperBody,
    /lower\.includes\("<!-- omo_internal_initiator -->"\)/,
    "internal reminder detector should recognize internal initiator marker payloads",
  );
  assert.match(
    helperBody,
    /lower\.includes\("\[search-model\]"\)\s*&&[\s\S]*lower\.includes\("maximize search effort"\)/,
    "internal reminder detector should recognize search-model reminder payloads",
  );
  assert.match(
    helperBody,
    /if \(role !== "user" && role !== "system"\) return false;/,
    "internal reminder detector should ignore non-user/non-system roles",
  );

});
