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
  assert.match(
    messageComponentsSource,
    /const visibleDisplayEvents = isBackgroundTaskChildAssistantTurn\s*\?[\s\S]*event\.kind === "activity" && !isBackgroundOutputDisplayEvent\(event\)[\s\S]*: displayEvents;/s,
    "background-task child assistant turns should suppress the top-level background output row and keep it modal-owned",
  );
  assert.match(
    messageComponentsSource,
    /const showResponseSection =[\s\S]*!isBackgroundTaskChildAssistantTurn[\s\S]*\(/s,
    "background-task child assistant turns should not render the normal assistant response section at the top level",
  );
});

test("background output steps receive child assistant updates for modal rendering", () => {
  assert.match(
    messageComponentsSource,
    /<BackgroundOutputStep[\s\S]*assistantUpdateText=\{[\s\S]*isBackgroundTaskChildAssistantTurn[\s\S]*backgroundTaskAssistantUpdateText/s,
    "background output steps should receive the child assistant update text when the turn belongs to a background-task reminder parent",
  );
  assert.match(
    messageComponentsSource,
    /const backgroundTaskAssistantUpdateText = useMemo\(\(\) => \{[\s\S]*visibleResponseBodyChunks[\s\S]*thoughtItems/s,
    "child assistant update text should be composed from the turn reasoning and resolved response body chunks",
  );
  assert.match(
    messageComponentsSource,
    /const backgroundTaskAssistantConversationEvents = useMemo<SubagentConversationEvent\[]>\(\(\) => \{[\s\S]*thoughtItems[\s\S]*visibleResponseBodyChunks/s,
    "background-task child turns should build timeline conversation events for the modal",
  );
  assert.match(
    messageComponentsSource,
    /<BackgroundOutputStep[\s\S]*assistantConversationEvents=\{[\s\S]*backgroundTaskAssistantConversationEvents/s,
    "background output steps should receive the child assistant timeline events for modal rendering",
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

  assert.match(
    chatShellSource,
    /const isHiddenTransportReminder =[\s\S]*role === "system"[\s\S]*hasSystemMessagePatternInText\(messageText\)/s,
    "transport reminder parents should be detected before transcript rendering",
  );
  assert.match(
    chatShellSource,
    /if \(isHiddenTransportReminder \|\| isHiddenBackgroundTaskChildAssistant\) \{[\s\S]*return dividerHere \? \([\s\S]*CompactionDivider[\s\S]*: null;[\s\S]*\}/s,
    "transport reminder parents should be skipped instead of rendering at the top of the conversation",
  );
  assert.match(
    chatShellSource,
    /const isHiddenBackgroundTaskChildAssistant =[\s\S]*isBackgroundTaskChildAssistantMessage\(/s,
    "background-task child assistant cards should be detected in the transcript renderer",
  );
  assert.match(
    chatShellSource,
    /if \(isHiddenTransportReminder \|\| isHiddenBackgroundTaskChildAssistant\) \{/s,
    "background-task child assistant cards should be skipped as standalone top-level transcript entries",
  );
});
