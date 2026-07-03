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
    /const canCollapseCompletedAssistantTurn =[\s\S]*!isLiveAssistantTurn[\s\S]*hasStickyTimelineActivity;/,
    "collapse should only be enabled for non-live assistant turns that already have activity",
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
    /Expand activity timeline and assistant response/,
    "collapsed summary row should expand both the timeline and the hidden final response",
  );
});

test("collapsed mode hides the final response section until expanded", () => {
  assert.match(
    messageComponentsSource,
    /!\s*isAssistantTurnCollapsed\s*&&\s*showResponseSection/,
    "final assistant response should stay hidden while the completed turn is collapsed",
  );
  assert.match(
    messageComponentsSource,
    /Collapse activity timeline and hide final response/,
    "expanded completed turns should offer a way to collapse back to the summary row",
  );
});
