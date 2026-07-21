import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const providerSource = readFileSync(
  new URL("../../src/providers/ChatViewProvider.ts", import.meta.url),
  "utf8",
);
const handlerSource = readFileSync(
  new URL("../../webview/shared/src/chat/lib/messageHandler.ts", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../webview/shared/src/chat/ChatShell.tsx", import.meta.url),
  "utf8",
);
const componentSource = readFileSync(
  new URL("../../webview/shared/src/chat/MessageComponents.tsx", import.meta.url),
  "utf8",
);
const sessionServiceSource = readFileSync(
  new URL("../../src/services/SessionService.ts", import.meta.url),
  "utf8",
);

test("provider forwards SDK history availability to the chat webview", () => {
  assert.match(
    providerSource,
    /available:\s*sessionHistory\.available,[\s\S]*?unavailableReason:\s*sessionHistory\.unavailableReason/,
  );
  assert.match(providerSource, /unavailableStatus\s*===\s*404[\s\S]*?"not_found"/);
});

test("missing history clears stale processing state", () => {
  assert.match(
    handlerSource,
    /if\s*\(!historyAvailable\)[\s\S]*?SET_PROCESSING_SESSIONS[\s\S]*?sessionId\s*!==\s*unavailableSessionId/,
  );
  assert.match(
    handlerSource,
    /if\s*\(!historyAvailable\)[\s\S]*?SET_SESSION_LOAD_ERROR/,
  );
});

test("chat renders the unavailable state independently of AI processing state", () => {
  const unavailableRender = shellSource.match(
    /\{!hasAnyRenderableConversation\s*&&\s*!state\.streaming\s*&&\s*state\.sessionLoadError[\s\S]*?<SessionUnavailableState error=\{state\.sessionLoadError\} \/>/,
  )?.[0] ?? "";
  assert.ok(unavailableRender, "the chat shell must render SessionUnavailableState");
  assert.doesNotMatch(
    unavailableRender,
    /!isAiResponding/,
    "a stale processing marker must not hide the missing-session UI",
  );
  assert.match(componentSource, /Session not found/);
  assert.match(componentSource, /Choose another session/);
  assert.match(componentSource, /New session/);
});

test("internal compatibility probes cannot persist in user session history", () => {
  assert.match(
    sessionServiceSource,
    /INTERNAL_SESSION_TITLE_PREFIXES[\s\S]*?OpenCode structured-output compatibility probe/,
  );
  assert.match(
    sessionServiceSource,
    /response\.data\.filter\([\s\S]*?!isInternalSession\(session\)/,
  );
  assert.match(
    sessionServiceSource,
    /persistedSessions\.filter\(\(session\)\s*=>\s*!isInternalSession\(session\)\)/,
  );
  assert.match(
    sessionServiceSource,
    /internalSessionIds\.has\(sessionId\)[\s\S]*?SESSION_ID_KEY,[\s\S]*?undefined/,
  );
});
