import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const messageComponentsSource = readFileSync(
  new URL("../../webview/shared/src/chat/MessageComponents.tsx", import.meta.url),
  "utf8",
);

test("AssistantResponseCardInner merges live streaming progress rows into the activity timeline", () => {
  assert.match(
    messageComponentsSource,
    /progressItemsFromSteps\(\s*\[\s*\.\.\.\(Array\.isArray\(scopedActivityTimelineStreaming\?\.progressEvents\)/s,
    "Live streaming progressEvents should be projected into progress items",
  );

  assert.match(
    messageComponentsSource,
    /mergeProgressItemsForTimeline\(progressItems,\s*liveProgressItems,\s*isStreamingActive\)/,
    "Finalized and live progress rows should prefer the live stream while it is active",
  );

  assert.match(
    messageComponentsSource,
    /mergeThoughtItemsForTimeline\(finalizedThoughtItems,\s*liveThoughtItems,\s*isStreamingActive\)/,
    "Thought items should also prefer live streaming text while the turn is active",
  );

  assert.match(
    messageComponentsSource,
    /function progressItemIdentityKey\(/,
    "Progress rows should use a centralized identity key before rendering",
  );

  assert.match(
    messageComponentsSource,
    /function mergeProgressItemRecord\(/,
    "Progress rows should merge repeated status updates into one canonical row",
  );

  assert.match(
    messageComponentsSource,
    /function mergeStickyDisplayEventsForTurn\(/,
    "Activity timeline rows should be merged through a sticky turn-scoped helper",
  );

  assert.match(
    messageComponentsSource,
    /const stickyTimelineDisplayEventsRef = useRef<\{\s*messageId: string \| null;\s*events: DisplayEvent\[\];\s*\}>/s,
    "The timeline should keep a per-turn sticky snapshot so partial hydration cannot clear already rendered rows",
  );

  assert.match(
    messageComponentsSource,
    /const hasStickyTimelineActivity = timelineDisplayEvents\.length > 0;/,
    "The assistant card should keep showing the timeline once sticky rows exist",
  );

  assert.match(
    messageComponentsSource,
    /const showResponseSection =[\s\S]*hasStickyTimelineActivity/s,
    "The response section should stay mounted when the sticky timeline has activity",
  );

  assert.match(
    messageComponentsSource,
    /mergeStickyDisplayEventsForTurn\(\s*stickyTimelineDisplayEventsRef\.current\.events,\s*visibleDisplayEvents,\s*\)/s,
    "Incoming timeline rows should be merged into the sticky snapshot instead of replacing it",
  );

  assert.match(
    messageComponentsSource,
    /const events = buildDisplayEvents\([\s\S]*?thoughtItems,[\s\S]*?mergedProgressItems,[\s\S]*?commentaryItems,[\s\S]*?fileChanges,[\s\S]*?assistantScopeMessageIds,[\s\S]*?\)/,
    "Merged progress rows should be passed directly into buildDisplayEvents using message-scoped ids",
  );
});
