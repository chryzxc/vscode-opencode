import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from "./helpers/source-utils.mjs";

const chatProviderSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("history hydration reuses canonical processing path and disables synthetic fallback errors", () => {
  const processBody = extractFunctionBody(
    chatProviderSource,
    "private processHistoryMessages(",
  );

  assert.match(
    processBody,
    /const\s+normalizedMessage\s*=\s*this\.normalizePlanProceedUserMessage\(message\);/,
    "processHistoryMessages should canonicalize plan proceed user turns before hydration rendering",
  );
  assert.match(
    processBody,
    /allowSyntheticFallbackError:\s*false/,
    "processHistoryMessages should disable synthetic structured-output fallback messages during hydration",
  );
  assert.match(
    processBody,
    /\.filter\(\(message\)\s*=>\s*this\.isRenderableHistoryMessage\(message\)\)/,
    "processHistoryMessages should drop non-renderable transport artifacts",
  );
  assert.match(
    processBody,
    /const\s+deduped\s*=\s*this\.dedupeMirrorHistoryMessages\(processed\);/,
    "processHistoryMessages should dedupe mirror local/server entries before merge/coalescing",
  );
  assert.match(
    processBody,
    /const\s+mergedActivity\s*=\s*this\.mergeAdjacentAssistantActivityMessages\(deduped\);/,
    "processHistoryMessages should merge adjacent assistant activity fragments after dedupe",
  );
  assert.match(
    processBody,
    /return\s+this\.mergeConsecutiveAssistantBursts\(mergedActivity\);/,
    "processHistoryMessages should coalesce consecutive assistant bursts into a single hydrated turn",
  );
});

test("assistant burst coalescing keeps latest base and dedupes timeline arrays", () => {
  const coalesceBody = extractFunctionBody(
    chatProviderSource,
    "private coalesceAssistantBurst(burst: any[]): any",
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
});

test("structured-output fallback synthesis can be disabled for session reload normalization", () => {
  const applyBody = extractFunctionBody(
    chatProviderSource,
    "private applyStructuredOutputToMessage(",
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
  const mirrorBody = extractFunctionBody(
    chatProviderSource,
    "private areMirrorHistoryMessages(existing: any, incoming: any): boolean",
  );
  const canonicalIdBody = extractFunctionBody(
    chatProviderSource,
    "private pickCanonicalHistoryMessageId(preferred: any, fallback: any): string | undefined",
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
  const renderableBody = extractFunctionBody(
    chatProviderSource,
    "private hasRenderableHistoryPayload(message: any): boolean",
  );
  const helperBody = extractFunctionBody(
    chatProviderSource,
    "private isInternalSystemReminderMessage(message: any): boolean",
  );

  assert.match(
    renderableBody,
    /if\s*\(\s*this\.isInternalSystemReminderMessage\(message\)\s*\)\s*\{\s*return false;\s*\}/,
    "hasRenderableHistoryPayload should drop internal reminder pseudo-user messages",
  );
  assert.match(
    helperBody,
    /normalized\.includes\("<system-reminder>"\)/,
    "internal reminder detector should recognize <system-reminder> wrapper payloads",
  );
  assert.match(
    helperBody,
    /normalized\.includes\("<!-- omo_internal_initiator -->"\)/,
    "internal reminder detector should recognize internal initiator marker payloads",
  );
  assert.match(
    helperBody,
    /normalized\.includes\("\[search-model\]"\)\s*&&[\s\S]*normalized\.includes\("maximize search effort"\)/,
    "internal reminder detector should recognize search-model reminder payloads",
  );
  assert.match(
    helperBody,
    /if\s*\(\s*this\.isPlanProceedMessageText\(text\)\s*\)\s*\{\s*return false;\s*\}/,
    "internal reminder detector should preserve plan proceed confirmations",
  );
});
