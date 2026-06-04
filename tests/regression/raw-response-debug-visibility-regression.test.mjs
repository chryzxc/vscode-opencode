import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("assistant raw response debug visibility is driven by config, not payload presence or debug flags", () => {
  assert.match(
    messageComponentsSource,
    /const\s+showRawResponseDebug\s*=\s*config\.debug\.showRawResponse;/,
    "raw response debug block should still be controlled by the explicit config flag",
  );

  assert.match(
    messageComponentsSource,
    /const\s+visibleRawResponseText\s*=\s*rawResponseText\.trim\(\)\.length\s*>\s*0[\s\S]*\(rawResponse is missing on this message\)/,
    "raw response debug block should show a fallback message when rawResponse is missing",
  );

  assert.match(
    messageComponentsSource,
    /\{showRawResponseDebug && \(/,
    "raw response debug block should render whenever the config flag is enabled",
  );

  assert.doesNotMatch(
    messageComponentsSource,
    /showRawResponseDebug\s*&&\s*hasRawResponseDebug/,
    "raw response debug visibility should not also require a payload-presence gate",
  );
});
