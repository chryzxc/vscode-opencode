import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("AI loading ticker displays each selected status as complete text", () => {
  const ticker = source.slice(
    source.indexOf("export function AIStatusTicker"),
    source.indexOf("function latestNonEmptyLine"),
  );

  assert.match(ticker, /<FadeSwapText[\s\S]*?useTypewriter=\{false\}/);
  assert.doesNotMatch(
    ticker,
    /useTypewriter=\{true\}/,
    "a remounted loading ticker must not restart a partial character animation",
  );
  assert.doesNotMatch(
    ticker,
    /oc-glowing-text/,
    "the loading label must not use a continuously repainted clipped-gradient animation",
  );
  assert.match(
    ticker,
    /oc-ai-status-ticker/,
    "the loading ticker should opt into its isolated compositing surface",
  );
  assert.match(
    source,
    /oc-ai-status-ticker-text transition-\[opacity,transform\]/,
    "the loading label should transition compositor-only properties rather than all properties",
  );
  assert.match(
    source,
    /AI_LOADING_TEXT_SWITCH_INTERVAL_MS = 2800/,
    "the loading status should visibly advance during a live response",
  );
});
