import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);
const messageHandlerSource = readSource(
  [
    joinFromRoot(
      "webview",
      "shared",
      "src",
      "chat",
      "lib",
      "messageHandler.ts",
    ),
  ],
  "messageHandler.ts",
);

test("assistant fork action follows the copy footer visibility contract", () => {
  assert.match(messageSource, /GitFork/, "assistant response should import a fork icon");
  assert.match(
    messageSource,
    /!isStreamingActive &&[\s\S]*showResponseSection &&[\s\S]*hasCopyableResponseContent && \(/,
    "fork should only appear in the completed, copyable response footer",
  );
  assert.match(
    messageSource,
    /type:\s*"forkSession"[\s\S]*sessionId:\s*centralizedSessionId[\s\S]*messageId:\s*assistantMessageId/s,
    "fork requests should target the rendered response's session and assistant message",
  );
});

test("host forks through the v2 SDK and loads the returned child session", () => {
  assert.match(
    providerSource,
    /case "forkSession"[\s\S]*handleForkSession/s,
    "provider should accept the webview fork message",
  );
  assert.match(
    providerSource,
    /client\.session\.fork\(\{[\s\S]*sessionID:\s*sourceSessionId,[\s\S]*messageID:\s*sourceMessageId,/s,
    "provider should fork from the selected assistant message",
  );
  assert.match(
    providerSource,
    /getSdkResponseError\(forkResult\)[\s\S]*getSdkResponseData\(forkResult\)/s,
    "provider should handle SDK responses that return errors instead of throwing",
  );
  assert.match(
    providerSource,
    /await this\.handleLoadSession\(forkedSessionId,\s*\{\s*suppressSessionLoading:\s*true,/s,
    "successful forks should open the child session without presenting it as AI work",
  );
  assert.match(
    providerSource,
    /type:\s*"chatHistory"[\s\S]*suppressSessionLoading:\s*options\?\.suppressSessionLoading === true/s,
    "host should carry the fork hydration marker to the webview",
  );
});

test("fork hydration bypasses generic session-loading state", () => {
  assert.match(
    messageHandlerSource,
    /const suppressSessionLoading = asBoolean\([\s\S]*data as UnknownRecord\)\.suppressSessionLoading/s,
    "chat history should read the explicit non-loading hydration marker",
  );
  assert.match(
    messageHandlerSource,
    /if \(isSwitchingSession && !suppressSessionLoading\)/,
    "only ordinary session switches should start the loading state",
  );
  assert.match(
    messageHandlerSource,
    /\(!isSwitchingSession \|\| suppressSessionLoading\)/,
    "fork hydration should clear any stale processing UI before showing copied history",
  );
});
