import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);
const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("completed question tools still participate in the activity timeline", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function progressItemsFromRawEventPayloads(",
  );

  assert.doesNotMatch(
    body,
    /completed_question_response_lane/,
    "question tool progress rows should not be suppressed from the activity timeline",
  );
  assert.match(
    body,
    /kind: tool === "read" \? "read" : isQuestionTool \? "other" : tool \|\| "tool_call"/,
    "question tool events should still be normalized into progress items",
  );
});

test("direct hydrated completed question parts retain their output and assistant ownership", () => {
  const body = extractFunctionBody(
    messageHandlerSource,
    "export function getCentralizedEventPart(",
  );

  assert.match(
    body,
    /directType === "tool"[\s\S]*asRecord\(event\.state\)[\s\S]*return event;/,
    "a bare hydrated tool part should be treated as the centralized part instead of being discarded",
  );

  assert.match(
    messageComponentsSource,
    /const part = getCentralizedEventPart\(eventRecord\);/,
    "assistant-card scoping should use the same direct-part-aware extractor",
  );
});

test("live completed question tools are marked done", () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    "function handleStreamEvent(",
  );

  assert.match(
    handlerBody,
    /normalizedStateStatus === "completed"[\s\S]*\? "done"/,
    "a question tool with state.status=completed should update its activity row as done",
  );
});

test("question completion survives the answer-continuation stray-event transition", () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    "function handleStreamEvent(",
  );

  assert.match(
    handlerBody,
    /strayEventIsCompletedQuestionTool[\s\S]*completedQuestionToolPresentation\([\s\S]*\.isCompleted/,
    "the original assistant question completion must not be dropped after the reply opens a continuation stream",
  );
  assert.match(
    handlerBody,
    /isCompletedQuestionTool[\s\S]*questionPresentation\.title[\s\S]*activityDetail: baseActivityDetail/s,
    "the completed question row should expose its captured-answer output to the activity UI",
  );
});

test("question asked events become first-class activity timeline rows", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function progressItemsFromRawEventPayloads(",
  );

  assert.match(
    body,
    /if \(eventType === "question\.asked"\)/,
    "top-level question.asked events should be converted into timeline progress rows",
  );
  assert.match(
    body,
    /title: "Requested clarification"/,
    "question.asked timeline rows should use the polished clarification title",
  );
  assert.match(
    body,
    /tool: "question"/,
    "question.asked timeline rows should be tagged as question activity so the question lane can recognize them",
  );
});

test("completed question tool rows use the professional reply title", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function progressItemsFromRawEventPayloads(",
  );

  assert.match(
    body,
    /completedQuestionToolPresentation\(tool, status, output\)[\s\S]*questionPresentation\.title/,
    "completed question tool rows should render as a professional response-capture activity",
  );
});

test("parentless assistant question phases do not inherit the visible user turn for ownership", () => {
  const body = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedRenderMessages(",
  );

  assert.doesNotMatch(
    body,
    /latestVisibleUserMessageId/,
    "centralized render builder should not infer ownership from the latest visible user turn",
  );
  assert.match(
    body,
    /const parentId = firstNonEmptyString\(\s*assistantParentIdByMessageId\.get\(messageId\),\s*\);/s,
    "assistant part-only phases should resolve parent ids only from centralized message links, not legacy source messages or the latest visible user turn",
  );
  assert.match(
    body,
    /const pendingTextDescriptors: Array</,
    "centralized render builder should defer text classification until later raw events reveal the role or assistant parent linkage",
  );
  assert.match(
    body,
    /for \(const descriptor of pendingTextDescriptors\) \{/,
    "centralized render builder should resolve text candidates after the full centralized scan completes",
  );
});

test("assistant timeline groups interleave completed question outputs in stream order", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "const timelineDisplayEventGroups = useMemo(() => {",
  );

  assert.match(
    body,
    /completedQuestionOutputChunksFromRawEventPayloads\(/,
    "timeline grouping should inject completed question outputs into the ordered assistant flow",
  );
  assert.match(
    body,
    /type:\s*"question-output"/,
    "timeline grouping should include explicit question-output entries alongside activity events",
  );
  assert.match(
    body,
    /left\.type === "event" \? -1 : 1/,
    "when activity and question output share a sequence, activity should render first",
  );
  assert.match(
    body,
    /seq:\s*eventIndex/,
    "activity and assistant response entries must use retained arrival order, not mixed raw/live sequence domains",
  );
  assert.match(
    body,
    /anchorIndex >= 0[\s\S]*?anchorIndex \+ 0\.1/s,
    "derived question output should be anchored to the retained timeline position",
  );
});

test("question prelude is hoisted ahead of generic activity rendering", () => {
  assert.match(
    messageComponentsSource,
    /const questionPreludeGroups = useMemo/,
    "question-related timeline groups should be split into a dedicated prelude lane",
  );
  assert.match(
    messageComponentsSource,
    /data-assistant-section="question-prelude"/,
    "assistant card should render the question prelude section before the generic activity lane",
  );
  assert.match(
    messageComponentsSource,
    /const nonQuestionTimelineDisplayEventGroups = useMemo/,
    "generic activity rendering should exclude hoisted question groups to avoid duplicates",
  );
});

test("question prelude suppresses duplicate output blocks when a question activity row already exists", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "const timelineDisplayEventGroups = useMemo(() => {",
  );

  assert.match(
    body,
    /const questionActivityFingerprints = new Set/,
    "timeline grouping should fingerprint question activity rows before injecting question-output blocks",
  );
  assert.match(
    body,
    /questionActivityFingerprints\.has\(normalizeComparableText\(chunk\.text\)\)/,
    "question-output text should be skipped when the same content is already shown by a question activity row",
  );
});

test("question activity labels prefer polished titles over the raw tool name", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function buildDisplayEvents(",
  );

  assert.match(
    body,
    /const questionLikeActivity = isQuestionLikeActivityTool\(/,
    "display-event assembly should identify question activity rows before assigning their labels",
  );
  assert.match(
    body,
    /questionLikeActivity && cleanedRawTitle[\s\S]*cleanEventLabel\(cleanedRawTitle\)/,
    "question activity labels should preserve the polished raw title instead of falling back to the generic question tool label",
  );
  assert.match(
    body,
    /const appendBaseSeq =[\s\S]*lastFinishedActivitySeq[\s\S]*lastKnownEntrySeq/s,
    "display-event assembly should compute an append base from the last finished step or prior centralized event",
  );
  assert.match(
    body,
    /if \(!isSiblingScopedMessageId\(messageId\)\) \{\s*return entry;\s*\}[\s\S]*seq: appendBaseSeq \+ appendedSiblingOffset/s,
    "sibling-scoped rows should append after the last finished activity instead of floating to the top",
  );
});

test("response-body dedupe can fully suppress redundant question-tool completion bodies", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "const visibleResponseBodyChunks = useMemo(() => {",
  );

  assert.match(
    body,
    /const filteredChunks = responseBodyChunks\.filter\(/,
    "response-body dedupe should compute the filtered chunk list before deciding what to render",
  );
  assert.match(
    body,
    /const questionToolOnlyResponse =[\s\S]*responseBodyChunks\.every\(\(chunk\) =>[\s\S]*duplicateFingerprints\.has\(normalizeComparableText\(chunk\)\)/,
    "response-body dedupe should detect when the assistant body is entirely redundant question-tool completion text",
  );
  assert.match(
    body,
    /return questionToolOnlyResponse \? \[\] : responseBodyChunks;/,
    "response-body dedupe should blank the assistant body when the timeline already renders the captured question response",
  );
});

test("centralized conversation ordering preserves multiple assistant phases for one user turn", () => {
  const body = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedTranscriptProjection(",
  );

  assert.match(
    body,
    /assistantEntriesByUserPrimaryId/,
    "conversation ordering should retain assistant siblings per user turn instead of a single winner",
  );
  assert.match(
    body,
    /assistantEntries\?\.forEach\(\(assistantEntry\) => \{[\s\S]*pushMessageEntry\(assistantEntry\);/s,
    "conversation ordering should emit every assistant phase attached to the user turn in raw order",
  );
});

test("centralized render builder preserves assistant siblings that share one parent user turn", () => {
  const body = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedRenderMessages(",
  );

  assert.match(
    body,
    /assistantDescriptorIdsByParent = new Map/,
    "assistant render assembly should track all assistant siblings per parent user turn",
  );
  assert.match(
    body,
    /rememberAssistantDescriptor\(/,
    "assistant render assembly should accumulate descriptors instead of replacing the previous sibling",
  );
  assert.doesNotMatch(
    body,
    /assistantDescriptorsByParent = new Map/,
    "assistant render assembly should not collapse assistant siblings into a single parent-keyed descriptor",
  );
});

test("assistant siblings in one turn use centralized raw order as the final render tiebreaker", () => {
  const body = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedRenderMessages(",
  );

  assert.match(
    body,
    /const rawIndexForMessage = \(messageId: string\): number =>/,
    "centralized render builder should derive a raw tape index for each message id",
  );
  assert.match(
    body,
    /const leftRawIndex = rawIndexForMessage\(leftId\);[\s\S]*const rightRawIndex = rawIndexForMessage\(rightId\);[\s\S]*if \(leftRawIndex !== rightRawIndex\) \{\s*return leftRawIndex - rightRawIndex;/s,
    "assistant siblings that share a parent turn should fall back to raw centralized order before created timestamps",
  );
});

test("centralized render messages do not re-coalesce adjacent assistant siblings", () => {
  const body = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedRenderMessages(",
  );

  assert.doesNotMatch(
    body,
    /return coalesceAdjacentAssistantHistoryMessages\(messagesWithSubagents\);/,
    "centralized render assembly should not collapse adjacent assistant siblings after preserving raw order",
  );
  assert.match(
    body,
    /return messagesWithSubagents;/,
    "centralized render assembly should return the ordered assistant siblings directly",
  );
});

test("assistant history coalescing keeps distinct sibling message ids separate", () => {
  const body = extractFunctionBody(
    messageHandlerSource,
    "function canCoalesceAssistantHistoryMessages(",
  );

  assert.match(
    body,
    /const leftId = getMessageId\(left\);[\s\S]*const rightId = getMessageId\(right\);[\s\S]*if \(leftId && rightId && leftId !== rightId\) \{\s*return false;/s,
    "assistant coalescing should not merge separate sibling assistant messages that only share a parent user turn",
  );
});
