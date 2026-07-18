import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);
const assistantBlockPresentationSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "assistantBlockPresentation.ts")],
  "assistantBlockPresentation.ts",
);
const fadedCollapseOverlaySource = readSource(
  [joinFromRoot("webview", "shared", "src", "components", "ui", "FadedCollapseOverlay.tsx")],
  "FadedCollapseOverlay.tsx",
);


test("activity timeline tracks an explicit expanded-vs-collapsed assistant turn state", () => {
  assert.match(
    messageComponentsSource,
    /showExpandedActivityTimeline:\s*boolean/,
    "assistant cards should track whether the completed turn is expanded",
  );
  assert.match(
    messageComponentsSource,
    /showExpandedActivityTimeline:\s*false/,
    "completed assistant turns should default to collapsed mode",
  );
});

test("activity timeline only collapses after the assistant turn is finished", () => {
  assert.match(
    messageComponentsSource,
    /const isCurrentCardLiveAssistantTurn = useMemo\(/,
    "collapse logic should distinguish the current live assistant card from older completed cards",
  );
  assert.match(
    messageComponentsSource,
    /for \(const candidate of \[\s*assistantTurnMessageId,\s*activityTimelineStreaming\?\.messageId,\s*\]\)/s,
    "live-card matching should key off the active turn ids only, not every rendered assistant card id",
  );
  assert.match(
    messageComponentsSource,
    /const canCollapseCompletedAssistantTurn =[\s\S]*!isCurrentCardLiveAssistantTurn[\s\S]*hasExpandableTimelineActivity;/,
    "collapse should only be disabled for the currently live assistant turn, not every older card in the session",
  );
  assert.match(
    messageComponentsSource,
    /const canCollapseCompletedAssistantTurn =[\s\S]*!\(assistantTurnPending && isLatestAssistantMessage && isAfterLatestUserMessage\)[\s\S]*hasExpandableTimelineActivity;/,
    "the newest assistant card should stay expanded while its turn is still pending, even before stream ids fully attach",
  );
  assert.match(
    messageComponentsSource,
    /const isAssistantTurnCollapsed =[\s\S]*!effectiveExpanded;/,
    "collapsed mode should be derived from the completed-turn gate plus local expansion state",
  );
});

test("lifecycle-only timeline events do not enable an empty expand control", () => {
  assert.match(
    messageComponentsSource,
    /const isHiddenLifecycleTimelineEvent =[\s\S]*labelLower === "step-start"[\s\S]*labelLower === "step-finish"/,
    "step lifecycle markers should be identified as hidden timeline content",
  );
  assert.match(
    messageComponentsSource,
    /const hasExpandableTimelineActivity = timelineDisplayEvents\.some\([\s\S]*!isHiddenLifecycleTimelineEvent\(event\)/,
    "only visible timeline content should enable the collapse/expand control",
  );
});

test("lifecycle hide check keys off partType so label-text drift cannot re-enable the empty expand control", () => {
  assert.match(
    messageComponentsSource,
    /const isHiddenLifecycleTimelineEvent = \(event: DisplayEvent\) => \{[\s\S]*partTypeLower[\s\S]*partTypeLower === "step-start" \|\| partTypeLower === "step-finish"/,
    "the hide check must treat step-start / step-finish partType values as lifecycle markers regardless of label text",
  );
  assert.match(
    messageComponentsSource,
    /const isHiddenLifecycleTimelineEvent = \(event: DisplayEvent\) => \{[\s\S]*if \(partTypeLower === "step-start" \|\| partTypeLower === "step-finish"\) \{[\s\S]*return true;/,
    "a step lifecycle partType should short-circuit the hide check to true without relying on label formatting",
  );
});

test("render-loop lifecycle marker detection keys off partType to keep hiding consistent with the count check", () => {
  assert.match(
    messageComponentsSource,
    /const isLifecycleMarkerEvent =[\s\S]*\(event\.partType \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "step-start"[\s\S]*\(event\.partType \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "step-finish"/,
    "the render-loop lifecycle marker check must prefer the canonical partType signal so visible-row hiding stays in sync with the expand/collapse count check",
  );
  assert.match(
    messageComponentsSource,
    /if \(isLifecycleMarkerEvent\) \{[\s\S]*const partTypeLower = \(event\.partType \|\| ""\)\.trim\(\)\.toLowerCase\(\);[\s\S]*const isStart = partTypeLower === "step-start"/,
    "the start-vs-finish determination inside the lifecycle branch must derive from partType so step-start rows are correctly classified even when their label text is the human-readable 'Starting step' form",
  );
});

test("the final visible activity row ends its connector before hidden lifecycle markers", () => {
  assert.match(
    messageComponentsSource,
    /const isLastVisibleEventInGroup = !group\.events[\s\S]*?\.some\(\(candidate\) => !isHiddenLifecycleTimelineEvent\(candidate\)\);[\s\S]*?const isLast =[\s\S]*?isLastVisibleEventInGroup;/,
    "hidden lifecycle markers should not leave a trailing timeline connector and empty gap before the subagent panel",
  );
});

test("collapsed activity timeline renders the worked-for summary affordance", () => {
  assert.match(
    messageComponentsSource,
    /const collapsedTimelineLabel =[\s\S]*`Worked for \$\{formatDuration\(duration \* 1000\)\}`/s,
    "collapsed assistant turns should summarize the completed work duration",
  );
  assert.match(
    messageComponentsSource,
    /data-assistant-section="activity-collapsed"/,
    "collapsed assistant turns should render a dedicated collapsed activity row",
  );
  assert.match(
    messageComponentsSource,
    /Expand activity timeline/,
    "collapsed summary row should expand the activity timeline after the turn completes",
  );
});

test("activity collapse leaves the full assistant response under its own local control", () => {
  assert.match(
    messageComponentsSource,
    /showResponseSection && hasVisibleResponseSectionContent/,
    "response section should remain independent from the activity timeline state",
  );
  assert.match(
    messageComponentsSource,
    /const responseChunksVisibleInCurrentView = responseChunksToRender;/,
    "activity collapse must not truncate assistant response chunks",
  );
  assert.match(
    messageComponentsSource,
    /responseChunksVisibleInCurrentView\.map\(/,
    "response rendering should use the collapse-aware response chunk selection",
  );
  assert.match(
    messageComponentsSource,
    /Collapse activity timeline/,
    "expanded completed turns should offer a way to collapse the non-final assistant context back to the summary row",
  );
});

test("completed assistant responses use rendered overflow for their card preview", () => {
  assert.match(
    messageComponentsSource,
    /const \[hasResponseOverflow, setHasResponseOverflow\] = useState\(false\);/,
    "response cards should track whether their rendered body overflows",
  );
  assert.match(
    messageComponentsSource,
    /const \[isResponseExpanded, setIsResponseExpanded\] = useState\(false\);/,
    "long responses should start in preview mode",
  );
  assert.match(
    messageComponentsSource,
    /const shouldConstrainResponsePreview =[\s\S]*!isStreamingActive[\s\S]*showResponseBody[\s\S]*!isResponseExpanded;/,
    "every completed response body should receive the shared preview boundary",
  );
  assert.match(
    messageComponentsSource,
    /preview\.scrollHeight > preview\.clientHeight \+ 1/,
    "the fade should be based on real rendered overflow rather than character count",
  );
  assert.match(
    messageComponentsSource,
    /data-assistant-section="response"[\s\S]*max-h-\[28rem\][\s\S]*<FadedCollapseOverlay/s,
    "the bounded preview should use the shared fade control inside the response card",
  );
  assert.match(
    messageComponentsSource,
    /<FadedCollapseOverlay[\s\S]*setIsResponseExpanded\(true\)[\s\S]*setIsResponseExpanded\(false\)/s,
    "the response card should toggle between preview and full content",
  );
});

test("shortened-content surfaces share one centered fade affordance", () => {
  assert.match(
    fadedCollapseOverlaySource,
    /label = "Show full"/,
    "the shared control should provide the standard action text",
  );
  assert.match(
    fadedCollapseOverlaySource,
    /items-end justify-center/,
    "the shared control should use the standard centered bottom alignment",
  );
  for (const relativePath of [
    "webview/shared/src/chat/MessageComponents.tsx",
    "webview/shared/src/chat/components/activity-steps/DiffPreviewStep.tsx",
    "webview/shared/src/chat/components/activity-steps/SearchActivityPreview.tsx",
  ]) {
    assert.match(
      readSource([joinFromRoot(...relativePath.split("/"))], relativePath),
      /FadedCollapseOverlay/,
      `${relativePath} should reuse the standard fade affordance`,
    );
  }
});

test("multi-card block collapse maintains visibility of the final text-containing card", () => {
  assert.match(
    assistantBlockPresentationSource,
    /lastTextIndexByKey\.set\(key, index\)/,
    "block evaluation should track the last card that actually contains text",
  );
  assert.match(
    assistantBlockPresentationSource,
    /isLastTextInBlockByIndex\.set\(\s*index,[\s\S]*lastTextIndex === undefined \? isAbsoluteLast : lastTextIndex === index/s,
    "block evaluation should tag the text-bearing card as the logical last for collapse purposes",
  );
});

test("multi-card block collapse controls render correctly in collapsed and expanded states", () => {
  assert.match(
    messageComponentsSource,
    /data-assistant-section="block-collapse-control-collapsed"/,
    "multi-card block should render a unified pill when collapsed",
  );
  assert.match(
    messageComponentsSource,
    /data-assistant-section="block-collapse-control-expanded"/,
    "multi-card block should render a collapse link when expanded",
  );
});

test("a streaming response block stays expanded without collapse controls", () => {
  assert.match(
    chatShellSource,
    /const isBlockExpanded =\s*isLiveBlock \|\| blockExpandedState\.get\(blockGroupKey\) === true;/,
    "the active streaming block should override any collapsed state",
  );
  assert.match(
    messageComponentsSource,
    /isLastInBlock && blockSize > 1 && !isBlockStreaming && !isBlockExpanded/,
    "the block expand control should stay hidden while streaming",
  );
  assert.match(
    messageComponentsSource,
    /isLastInBlock && blockSize > 1 && !isBlockStreaming && isBlockExpanded/,
    "the block collapse control should stay hidden while streaming",
  );
});
