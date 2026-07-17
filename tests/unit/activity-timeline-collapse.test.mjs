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

test("collapsed mode keeps only the last response chunk visible while earlier assistant chunks stay collapsed", () => {
  assert.match(
    messageComponentsSource,
    /showResponseSection && hasVisibleResponseSectionContent/,
    "response section should stay mounted even when the activity timeline is collapsed",
  );
  assert.match(
    messageComponentsSource,
    /const responseChunksVisibleInCurrentView =[\s\S]*isAssistantTurnCollapsed[\s\S]*responseChunksToRender\.slice\(-1\)[\s\S]*:\s*responseChunksToRender;/,
    "collapsed mode should keep only the final assistant response chunk visible",
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
