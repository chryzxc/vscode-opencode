import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const rawResponseSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "rawResponse.ts")],
  "rawResponse.ts",
);

test("coalesced assistant cards can render multiple ordered response chunks", () => {
  assert.match(
    messageComponentsSource,
    /function orderedAssistantResponseChunksFromCentralizedData\(/,
    "assistant cards should build ordered response chunks from centralized data",
  );
  assert.match(
    messageComponentsSource,
    /completedQuestionOutputChunksFromRawEventPayloads\(/,
    "completed question tool outputs should be eligible response chunks",
  );
  assert.match(
    messageComponentsSource,
    /const responseBodyChunks = useMemo\(\(\) => \{[\s\S]*orderedAssistantResponseChunksFromCentralizedData\(/,
    "response body rendering should prefer ordered coalesced response chunks over a latest-only extractor",
  );
});

test("answered centralized questions do not remain active in the composer popover", () => {
  const body = extractFunctionBody(
    rawResponseSource,
    "export function getInteractiveEventsFromRawSdkEventPayloads(",
  );

  assert.match(
    body,
    /answeredQuestionRequestIds = new Set/,
    "interactive event extraction should track answered question request ids",
  );
  assert.match(
    body,
    /eventType === "question\.replied"/,
    "question.replied events should mark raw questions as answered",
  );
  assert.match(
    body,
    /answeredQuestionCallIds = new Set[\s\S]*answeredQuestionMessageIds = new Set/,
    "interactive event extraction should also track answered question tool identities",
  );
  assert.match(
    body,
    /answeredQuestionTool[\s\S]*continue;/,
    "completed question tool parts should not keep rebuilding a stale interactive prompt",
  );
});
