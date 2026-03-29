import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("assistant raw response debug visibility is driven by payload presence, not debug flags", () => {
  assert.match(
    messageComponentsSource,
    /const\s+hasRawResponseDebug\s*=\s*rawResponseText\.trim\(\)\.length\s*>\s*0;/,
    "raw response debug block should render whenever rawResponse text exists",
  );

  assert.doesNotMatch(
    messageComponentsSource,
    /RAW_RESPONSE_DEBUG_ENABLED\s*&&\s*rawResponseText\.trim\(\)\.length\s*>\s*0/,
    "raw response debug visibility should not be gated by a stream-debug window flag",
  );
});
