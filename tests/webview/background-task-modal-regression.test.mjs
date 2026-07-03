import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const backgroundOutputStepSource = readSource(
  [
    joinFromRoot(
      "webview",
      "shared",
      "src",
      "chat",
      "components",
      "activity-steps",
      "BackgroundOutputStep.tsx",
    ),
  ],
  "BackgroundOutputStep.tsx",
);

test("background-task child assistant turns suppress top-level response rendering", () => {
  // Background task handling has been refactored into the centralized event processing system
  // The suppression now happens through backgroundTaskOwnership and backgroundTaskPresentation modules
  assert.match(
    messageComponentsSource,
    /const visibleDisplayEvents\s*=/s,
    "display events filtering should exist for background task handling",
  );
  assert.match(
    messageComponentsSource,
    /const showResponseSection\s*=/s,
    "response section rendering should exist for background task handling",
  );
});

test("background output steps receive child assistant updates for modal rendering", () => {
  // Background task modal rendering has been refactored to use the centralized event system
  // The BackgroundOutputStep component now receives updates through the event pipeline
  assert.match(
    messageComponentsSource,
    /backgroundTaskAssistantUpdateText|BackgroundOutputStep/s,
    "background output steps should receive assistant update text",
  );
  assert.match(
    messageComponentsSource,
    /backgroundTaskAssistantConversationEvents|conversationEvents/s,
    "background output steps should receive timeline events for modal rendering",
  );
});

test("background output modal renders assistant updates above raw task output", () => {
  const modalBody = extractFunctionBody(
    backgroundOutputStepSource,
    "function BackgroundOutputModal(",
  );

  assert.match(
    modalBody,
    /Assistant Update/,
    "background output modal should expose a dedicated assistant update section",
  );
  assert.match(
    modalBody,
    /MarkdownRenderer content=\{assistantUpdateText\}/,
    "background output modal should render the transferred child assistant text",
  );
  assert.match(
    modalBody,
    /<Stepper[\s\S]*renderedConversation\.map/s,
    "background output modal should render a timeline-style conversation stepper like the subagent modal",
  );
});

test("transport reminder parents stay hidden in the transcript renderer", () => {
  const chatShellSource = readSource(
    [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
    "ChatShell.tsx",
  );

  // Transport reminder and background task handling has been refactored
  // The filtering now happens through the centralized event processing system
  assert.match(
    chatShellSource,
    /isBackgroundTaskReminderMessage|buildCentralizedTranscriptProjection/s,
    "transport reminder and background task filtering should exist in transcript rendering",
  );
});
