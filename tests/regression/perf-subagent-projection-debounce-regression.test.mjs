import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: every subagent-bearing stream event called
 * `persistSubagentProjection` directly with a fresh full snapshot from
 * `subagentTracker.getSnapshotPayload()`. During active subagent work
 * (dozens of events per second), this triggered dozens of full-snapshot
 * writes per second to VS Code's workspaceState — each write serializing
 * the entire projection graph.
 *
 * Contract: persist must be debounced (trailing) so rapid bursts coalesce
 * into a single write. The debouncer must rebuild the snapshot at flush
 * time from the live tracker state (not snapshot at schedule time).
 */

const chatViewProviderSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("persistSubagentProjection is not invoked directly on the stream-event path", () => {
  // Find the stream-event subagent-update block (around line ~4570) and
  // assert the persist call goes through a debouncing scheduler instead
  // of calling persistSubagentProjection directly.
  const subagentUpdateIdx = chatViewProviderSource.indexOf(
    'this.view?.webview.postMessage({\n          type: "subagentUpdate"',
  );
  assert.ok(subagentUpdateIdx > -1, "expected to find the subagentUpdate postMessage site");

  const window = chatViewProviderSource.slice(subagentUpdateIdx, subagentUpdateIdx + 1500);
  assert.doesNotMatch(
    window,
    /void\s+this\.persistSubagentProjection\(/,
    "stream-event subagent-update path must not call persistSubagentProjection directly — go through a debounce scheduler",
  );
});

test("ChatViewProvider exposes a debounced scheduler for subagent projection persistence", () => {
  assert.match(
    chatViewProviderSource,
    /(private|public)\s+(scheduleSubagentProjectionPersist|scheduleSubagentProjectionWrite|schedulePersistSubagentProjection|scheduleProjectionPersist)\s*\(/,
    "ChatViewProvider should expose a debounced scheduler for subagent projection persistence",
  );
});

test("the debounced scheduler flushes via setTimeout and is cleared on dispose", () => {
  // Find the scheduler body and verify it uses setTimeout with a trailing
  // debounce, and that dispose tears down any in-flight timers.
  const schedulerMatch = chatViewProviderSource.match(
    /(private|public)\s+(scheduleSubagentProjectionPersist|scheduleSubagentProjectionWrite|schedulePersistSubagentProjection|scheduleProjectionPersist)\s*\([^)]*\)\s*:\s*void\s*\{/
  );
  assert.ok(schedulerMatch, "scheduler body should be extractable");

  const schedulerBody = extractFunctionBody(
    chatViewProviderSource,
    schedulerMatch[0],
  );
  assert.ok(schedulerBody.length > 0);

  assert.match(
    schedulerBody,
    /setTimeout\(/,
    "scheduler should use setTimeout for trailing debounce",
  );

  // The dispose path must clear the timer map.
  const disposeBody = extractFunctionBody(chatViewProviderSource, "public dispose(): void");
  assert.ok(disposeBody.length > 0);
  assert.match(
    disposeBody,
    /clearTimeout\(|subagentProjectionDebounce|projectionPersistTimer|projectionDebounce/,
    "dispose must clear any in-flight projection debounce timers",
  );
});
