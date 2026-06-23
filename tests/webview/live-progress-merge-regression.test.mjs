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
    /buildTimeline\(\s*thoughtItems,\s*mergedProgressItems,/s,
    "Merged progress rows should be passed into buildTimeline",
  );
});
