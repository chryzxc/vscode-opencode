import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("rehydrated SDK task tool parts project into the activity timeline", () => {
  assert.match(
    source,
    /const fromSnapshotParts = progressItemsFromRawResponseParts\(\{\s*parts: hydratedActivityParts,\s*\}\);[\s\S]*?return mergeProgressItemsForTimeline\(/,
    "standalone hydrated message parts must flow through the canonical timeline merge unconditionally (no length guard)",
  );
  assert.match(
    source,
    /const rawTitle = firstNonEmptyString\([\s\S]*?asString\(stateRec\?\.title\)/,
    "task tools must use their SDK state title instead of a generic label",
  );
});

test("rehydrated canonical activity arrays are not concatenated twice", () => {
  assert.match(
    source,
    /Array\.isArray\(candidate\.steps\)\s*&&\s*candidate\.steps\.length\s*>\s*0[\s\S]*?return candidate\.steps;[\s\S]*?return Array\.isArray\(candidate\.progressEvents\)/,
    "hydrated sibling messages should prefer the canonical steps array when progressEvents mirrors it",
  );
  assert.match(
    source,
    /Array\.isArray\(cardMessage\?\.steps\)\s*&&\s*cardMessage\.steps\.length\s*>\s*0[\s\S]*?\?\s*cardMessage\.steps[\s\S]*?:\s*\(cardMessage\?\.progressEvents \?\? \[\]\)/,
    "the current hydrated card should use progressEvents only as a fallback",
  );
});

test("rehydrated completed question parts keep the original prompt in the assistant card", () => {
  assert.match(
    source,
    /function questionPromptSummaryFromInput\([\s\S]*?questionPromptSummaryFromEventProperties\(input \?\? null\)/,
    "hydrated question parts must read the prompt from state.input using the same parser as live question events",
  );
  assert.match(
    source,
    /const questionPrompt = isQuestionToolName\(toolName\)[\s\S]*?summary: questionPrompt \|\| filePath \|\| preview \|\| rawTitle/,
    "raw hydrated tool parts must project the question prompt instead of only the generic question title",
  );
  assert.match(
    source,
    /const questionPrompt = isQuestionToolName\(rawActivityDetail\?\.tool\)[\s\S]*?summary: questionPrompt \?\? questionPresentation\.summary/,
    "the canonical steps projection must not replace the prompt with the completed answer output",
  );
});

test("hydrated final text parts remain the response-card candidate after question turns", () => {
  const chatShellSource = readSource(
    [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
    "ChatShell.tsx",
  );
  assert.match(
    chatShellSource,
    /const hasHydratedTextPart = \(message\.parts \?\? \[\]\)\.some\([\s\S]*?partType !== "text"[\s\S]*?firstNonEmptyString\(part\?\.text, part\?\.content, part\?\.message\)/,
    "final assistant text stored in hydrated SDK parts must be recognized as response content",
  );
  assert.match(
    chatShellSource,
    /message\.info\?\.text \|\|[\s\S]*?hasHydratedTextPart \|\|/,
    "the hydrated text-part signal must participate in collapsed response-card selection",
  );
});

test("live task tool events use the same SDK state title and streaming activity path", () => {
  assert.match(
    handlerSource,
    /const isProgressPartType =\s*partType === "tool"/,
    "live tool events must be classified as streaming progress",
  );
  assert.match(
    handlerSource,
    /asString\(part\.title\) \|\|\s*asString\(stateObj\?\.title\) \|\|\s*\(tool \? `Running \$\{tool\}\.\.\.`/,
    "live task tools must prefer state.title before the generic running label",
  );
  assert.match(
    handlerSource,
    /const activityMessageID = firstNonEmptyString\(\s*asString\(part\.messageID\),\s*asString\(part\.messageId\),\s*messageId,/,
    "live task tools must prefer the SDK part message ID over stream fallbacks",
  );
  assert.match(
    handlerSource,
    /messageID: step\.messageID \|\| current\.messageID/,
    "streaming step updates must preserve their owning message ID",
  );
});
