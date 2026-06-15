import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("assistant raw response debug visibility is driven by config, not payload presence or debug flags", () => {
  const rawResponseBlock = messageComponentsSource.match(
    /const\s+\{\s*rawResponseText\s*\}\s*=\s*useMemo\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[centralizedRawResponse\]\);/,
  )?.[0];
  assert.ok(rawResponseBlock, "raw response debug memo should be present");

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
    /normalizeDebugStringForDisplay\(value: string\): unknown/,
    "raw response debug text should normalize JSON-shaped strings for readability",
  );
  assert.match(
    messageComponentsSource,
    /return\s+formatDebugObjectLiteral\(JSON\.parse\(trimmed\),\s*depth,\s*seen\);/,
    "debug object literal rendering should parse JSON-shaped strings instead of quoting them",
  );

  assert.match(
    messageComponentsSource,
    /\{showRawResponseDebug && \(/,
    "raw response debug block should render whenever the config flag is enabled",
  );

  assert.doesNotMatch(
    rawResponseBlock,
    /compactDuplicateDebugFields\(displayValue\)/,
    "raw response debug text should not compact the raw payload",
  );
});
