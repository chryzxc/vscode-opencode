import assert from "node:assert/strict";
import test from "node:test";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

const conversationProjectionSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "conversationProjection.ts")],
  "conversationProjection.ts",
);

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("stopRequestHandled finalizes aborted assistant turns without stale interactive question payloads", () => {
  assert.match(
    messageHandlerSource,
    /case "stopRequestHandled": \{[\s\S]*normalizedMessage as unknown as UnknownRecord\)\.aborted = true[\s\S]*normalizedMessage\.interactiveEvents = \[\][\s\S]*normalizedMessage\.info = \{[\s\S]*aborted:\s*true/s,
    "stopped assistant turns should clear stale interactive payloads and persist aborted state",
  );
});

test("assistant renderer still shows the Interrupted badge for aborted turns", () => {
  assert.match(
    messageComponentsSource,
    /const (?:effectiveI|i)nterruptedPresentation =[\s\S]*\(isAborted \? "inline" : undefined\)[\s\S]*interruptedPresentation === "inline"[\s\S]*!hasQuestionLikeInteractiveContent\(cardMessage\)[\s\S]*Interrupted/s,
    "renderer should follow one interrupted-presentation field instead of separate aborted and detached-badge conditions",
  );
});

test("centralized assistant turns inherit MessageAbortedError as aborted state", () => {
  assert.match(
    chatShellSource,
    /const isCentralizedAbortEvent =[\s\S]*eventType !== "session\.error"[\s\S]*MessageAbortedError|messageabortederror/s,
    "centralized renderer should recognize abort events from the SDK tape",
  );
  assert.match(
    chatShellSource,
    /function getAssistantMessageIdBeforeRawIndex\([\s\S]*rawIndexExclusive[\s\S]*eventType === "message\.updated"[\s\S]*role\)\.trim\(\)\.toLowerCase\(\) === "assistant"/s,
    "session-level abort ownership should be resolved from the assistant turn immediately before the abort row",
  );
  assert.match(
    chatShellSource,
    /const eventType = getCentralizedEventType\(event\);/s,
    "the backward abort-owner scan must read normalized centralized event types so sync-wrapped message.updated rows still count as assistant ownership",
  );
  assert.doesNotMatch(
    chatShellSource,
    /function getAssistantMessageIdBeforeRawIndex\([\s\S]*partType === "text"[\s\S]*return assistantId/s,
    "the backward abort-owner scan must not treat generic text parts as assistant-owned, or it can attach aborts to newer user messages",
  );
  assert.match(
    chatShellSource,
    /if \(hasMessageScopedAbortSignal \|\| isLatestAssistantTurnAbortedBySessionError\) \{[\s\S]*normalized\.aborted = true;[\s\S]*normalized\.interactiveEvents = \[\];[\s\S]*aborted:\s*true/s,
    "centralized aborted turns should clear stale question payloads and persist interrupted state",
  );
  assert.match(
    chatShellSource,
    /assistantMessageIdBeforeAbort \|\| latestAssistantMessageId/s,
    "session-level aborts should prefer the assistant turn immediately before the abort row, with latest-assistant fallback for older fixtures",
  );
});

test("centralized aborted assistant turns preserve terminal abort metadata without moving the assistant card", () => {
  assert.match(
    chatShellSource,
    /terminalRawIndex[\s\S]*lastAbortRawIndex/s,
    "session-level abort rows should be attached to the affected assistant turn",
  );
});

test("conversation projection detaches late abort badges instead of reordering the assistant card", () => {
  assert.match(
    chatShellSource,
    /entry\.message = \{[\s\S]*interruptedPresentation:\s*"detached"[\s\S]*info:\s*\{[\s\S]*interruptedPresentation:\s*"detached"/s,
    "projection should mark assistant cards whose interrupted badge belongs to a later raw row using one presentation field",
  );
  assert.match(
    chatShellSource,
    /kind:\s*"assistant\.abort"[\s\S]*countCanonicalMessagesAtOrBeforeRawIndex[\s\S]*terminalRawIndex/s,
    "projection should emit a detached interruption entry at the terminal raw position",
  );
  assert.match(
    conversationProjectionSource,
    /Ordering is intentionally based on message creation time first, then raw tape[\s\S]*leftTimestamp[\s\S]*left\.rawOrder - right\.rawOrder/s,
    "conversation projection should keep canonical card order timestamp-first and leave late abort placement to the detached entry",
  );
});
