import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

test("virtualized transcript measurement refs keep stable callback identities", () => {
  assert.match(
    chatShellSource,
    /measuredEntryRefCallbacksRef\s*=\s*useRef<[\s\S]*?getMeasuredEntryRef\s*=\s*useCallback/,
    "transcript entries should cache their measurement ref callbacks by stable entry key",
  );
  assert.match(
    chatShellSource,
    /ref=\{getMeasuredEntryRef\(entry\.key\)\}/,
    "transcript rows should use the cached measurement ref",
  );
  assert.doesNotMatch(
    chatShellSource,
    /ref=\{\(node\)\s*=>\s*attachMeasuredEntryNode\(entry\.key,\s*node\)\}/,
    "an inline measuring ref detaches on every render and can trigger React error 185",
  );
});
