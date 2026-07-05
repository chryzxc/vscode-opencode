import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
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
    /const canCollapseCompletedAssistantTurn =[\s\S]*!isCurrentCardLiveAssistantTurn[\s\S]*hasStickyTimelineActivity;/,
    "collapse should only be disabled for the currently live assistant turn, not every older card in the session",
  );
  assert.match(
    messageComponentsSource,
    /const canCollapseCompletedAssistantTurn =[\s\S]*!\(assistantTurnPending && isLatestAssistantMessage\)[\s\S]*hasStickyTimelineActivity;/,
    "the newest assistant card should stay expanded while its turn is still pending, even before stream ids fully attach",
  );
  assert.match(
    messageComponentsSource,
    /const isAssistantTurnCollapsed =[\s\S]*!viewState\.showExpandedActivityTimeline;/,
    "collapsed mode should be derived from the completed-turn gate plus local expansion state",
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
