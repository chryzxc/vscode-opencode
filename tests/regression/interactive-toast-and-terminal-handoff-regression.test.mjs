import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("toast overlay scopes notifications to the active session and exposes dismissal", () => {
  const source = read("webview/shared/src/chat/ToastOverlay.tsx");

  assert.match(
    source,
    /notification\.sessionId\s*&&\s*sessionId[\s\S]*notification\.sessionId\s*!==\s*sessionId/,
    "toast rendering must reject notifications belonging to another session",
  );
  assert.match(
    source,
    /aria-label=\"Dismiss notification\"[\s\S]*onClick=\{dismissActiveToast\}/,
    "toast rendering must provide an explicit dismiss action",
  );
  assert.match(
    source,
    /const dismissActiveToast = \(\) => \{[\s\S]*clearActiveTimer\(\)[\s\S]*showNextToast\(\)/,
    "dismissing a toast must release its timer and advance the queue",
  );
});

test("interactive composer ignores events from another session", () => {
  const source = read("webview/shared/src/chat/PanelComponents.tsx");

  const sessionFilterCount = (source.match(/event\.sessionID === currentSessionId/g) ?? []).length;
  assert.ok(
    sessionFilterCount >= 3,
    "top-level, streaming, and hydrated interactive events must share session filtering",
  );
  assert.match(
    source,
    /dismissedInteractiveEventKeys, currentSessionId\]/,
    "the composer must recompute when the active session changes",
  );
});

test("terminal transcript handoff does not use a stale deferred snapshot", () => {
  const source = read("webview/shared/src/chat/ChatShell.tsx");

  assert.match(
    source,
    /const transcriptSnapshotForRender = state\.streaming\?\.isActive\s*\n\s*\? deferredTranscriptSnapshot\s*\n\s*: transcriptSnapshot/,
    "completed turns must switch to the current transcript snapshot immediately",
  );
  assert.match(
    source,
    /renderMessages=\{transcriptSnapshotForRender\.renderMessages\}/,
    "the transcript must consume the same atomic snapshot as its visible entries",
  );
});
