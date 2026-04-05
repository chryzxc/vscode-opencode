import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);
const messageSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const typesSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "types.ts")],
  "types.ts",
);
const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);

test("question flow lock: synthesize assistant bubble text when popover exists but no trusted body yet", () => {
  assert.match(
    handlerSource,
    /const hasRenderableContent = !!streamingState\?\.hasRenderableContent;/,
    "should read trusted renderable-content state before deciding prompt injection",
  );
  assert.match(
    handlerSource,
    /if \(\s*hasRenderableContent[\s\S]*!shouldOverrideStreamingContentWithInteractivePrompt\(/s,
    "should only gate injection behind override check when trusted text already exists",
  );
  assert.match(
    handlerSource,
    /payload: \{ content: synthesized, append: false, renderable: true \}/,
    "synthesized question prompt should be written as trusted renderable content",
  );
});

test("question flow lock: non-message stream kinds cannot seed assistant bubble body", () => {
  assert.match(
    handlerSource,
    /\(structuredKind === "message" \|\|[\s\S]*\(!structuredKind \|\| structuredKind === "message"\)[\s\S]*\(partType === "text" \|\| partType === "message"\)\)/s,
    "assistant body should only be seeded by message/text parts under message structured kind",
  );
});

test("question flow lock: final normalized question fallback persists interactive events and responseType", () => {
  assert.match(
    handlerSource,
    /allEvents\.length > 0[\s\S]*normalized\.interactiveEvents = allEvents;/s,
    "tool-question fallback should preserve interactiveEvents on final assistant message",
  );
  assert.match(
    handlerSource,
    /allEvents\.length > 0[\s\S]*normalized\.responseType = "question";/s,
    "tool-question fallback should mark responseType=question when missing",
  );
});

test("question flow lock: renderer hides untrusted streaming text until trusted content exists", () => {
  assert.match(
    messageSource,
    /const hasRenderableContent = streaming\.hasRenderableContent === true;/,
    "renderer should read hasRenderableContent trust bit",
  );
  assert.match(
    messageSource,
    /if \(!hasRenderableContent\) \{\s*return '';\s*\}/,
    "renderer should suppress untrusted transient chunks",
  );
});

test("question flow lock: streaming trust bit is defined and only elevated by explicit renderable writes", () => {
  assert.match(
    typesSource,
    /hasRenderableContent\?: boolean;/,
    "StreamingState should expose hasRenderableContent",
  );
  assert.match(
    storeSource,
    /hasRenderableContent:\s*action\.payload\.hasRenderableContent \?\? false/,
    "SET_STREAMING should default trust bit to false",
  );
  assert.match(
    storeSource,
    /hasRenderableContent:[\s\S]*state\.streaming\.hasRenderableContent[\s\S]*\|\|[\s\S]*!!action\.payload\.renderable/s,
    "UPDATE_STREAMING_CONTENT should only elevate trust via explicit renderable writes",
  );
});

test("question flow lock: interactive answer submission clears stale stream snapshots", () => {
  assert.match(
    handlerSource,
    /isLikelyInteractiveAnswerSubmissionMessage\(message\)[\s\S]*latestStreamingSnapshot = null;[\s\S]*SET_STREAMING[\s\S]*payload:\s*null/s,
    "interactive answer submit should clear stale streaming snapshot/state before next assistant turn",
  );
});

test("question flow lock: messageResponse drops mismatched snapshots when final payload has its own content", () => {
  assert.match(
    handlerSource,
    /const shouldDropMismatchedSnapshot =[\s\S]*snapshotMessageId !== responseMessageId[\s\S]*hasOwnResponsePayload;/s,
    "messageResponse should compute a mismatched-snapshot drop guard",
  );
  assert.match(
    handlerSource,
    /const snapshotStreaming =[\s\S]*currentStreaming[\s\S]*shouldDropMismatchedSnapshot \? null : latestStreamingSnapshot/s,
    "messageResponse should avoid reusing stale snapshots when final response payload is complete",
  );
});

test("question flow lock: suppress stale popover re-show during interactive transition", () => {
  assert.match(
    handlerSource,
    /const suppressInteractiveReshow =[\s\S]*inInteractiveTransitionWindow[\s\S]*isLikelyInteractiveAnswerSubmissionMessage\(latestMessage\)[\s\S]*hasBlockingInteractiveEvents\(interactiveEvents\);/s,
    "messageResponse should suppress stale blocking interactive events during post-answer transition",
  );
});
