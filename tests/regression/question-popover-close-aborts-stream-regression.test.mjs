import assert from "node:assert/strict";
import test from "node:test";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const panelComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "PanelComponents.tsx")],
  "PanelComponents.tsx",
);

test("closing an active question popover aborts the current assistant turn before dismissing it", () => {
  assert.match(
    panelComponentsSource,
    /const abortActiveResponse = \(\) =>[\s\S]*type:\s*"abortResponse"[\s\S]*const dismissInteractivePopover = \(interactiveEvent: InteractiveEvent\) => \{[\s\S]*interactiveEvent\.type === "question"[\s\S]*isProcessing \|\| assistantTurnPending \|\| Boolean\(streaming\)[\s\S]*abortActiveResponse\(\)[\s\S]*type:\s*"DISMISS_INTERACTIVE_EVENT"[\s\S]*payload:\s*interactiveEvent\.id/s,
    "question popover dismiss should send a dedicated abortResponse request before removing the interactive event locally",
  );
});

test("abortResponse is handled by the provider stop flow that calls the SDK abort API", async () => {
  const { readSource, joinFromRoot } = await import("../helpers/source-utils.mjs");
  const chatViewProviderSource = readSource(
    [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
    "ChatViewProvider.ts",
  );

  assert.match(
    chatViewProviderSource,
    /case "abortResponse": \{[\s\S]*await this\.handleStopRequest\(message\.sessionId\);[\s\S]*break;/s,
    "provider should route abortResponse through the shared stop flow",
  );

  assert.match(
    chatViewProviderSource,
    /await client\.session\.abort\(\{[\s\S]*sessionID:\s*resolvedSessionId/s,
    "shared stop flow should call the OpenCode SDK session.abort API",
  );
});
