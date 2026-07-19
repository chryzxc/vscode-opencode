import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const streamingSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "StreamingComponents.tsx")],
  "StreamingComponents.tsx",
);
const messageSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const shellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);
const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("renderable stream text paints immediately and centralized transcript takes over after completion", () => {
  assert.match(
    messageSource,
    /!cardMessage[\s\S]*streaming\?\.hasRenderableContent === true[\s\S]*return \[streaming\.content\]/,
    "the live response card should render only explicitly safe streamed text",
  );
  assert.match(
    streamingSource,
    /hasTranscriptAssistantForCurrentTurn && !streaming\.isActive/,
    "an assistant transcript placeholder must not hide the active live stream",
  );
  assert.match(
    shellSource,
    /hasLiveAssistantTurn[\s\S]*?!isAiResponseBlockFinished/,
    "the loading ticker must stay visible throughout the live assistant turn alongside Stop, regardless of streaming content arrival",
  );
  assert.doesNotMatch(
    shellSource,
    /hasRenderableStreamingContent/,
    "stream content must not gate the loading ticker — hasRenderableStreamingContent was removed in favor of hasLiveAssistantTurn",
  );
});

test("raw text delta envelopes update the live response before final hydration", () => {
  assert.match(
    handlerSource,
    /const isRawDeltaTextField =[\s\S]*?deltaField === "text"[\s\S]*?deltaField === "content"/,
  );
  assert.match(
    handlerSource,
    /partType === "message" \|\|[\s\S]*?isRawDeltaTextField/,
    "text deltas without part.type must be accepted by the streaming content path",
  );
  assert.match(
    handlerSource,
    /renderable:[\s\S]*?isRawDeltaTextField/,
    "a raw text delta must dismiss the loading bubble by becoming renderable",
  );
});
