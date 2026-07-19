import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: the subagent-detail modal polling effect in
 * MessageComponents.tsx set up a 1500ms `getSubagentConversation` interval
 * with deps `[selectedSubagentId, subagents, subagentDetailsById]`. During
 * active streaming, `subagents` and `subagentDetailsById` mutate on every
 * stream event, tearing down and recreating the interval dozens of times
 * per second. Effective postMessage rate to the extension host approached
 * the stream event rate, not 1500ms.
 *
 * Contract: the polling effect must read latest `subagents` and
 * `subagentDetailsById` through refs (or another stable handle) and the
 * effect deps must NOT include those volatile objects.
 */

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

function findDepsArrayAfter(source, anchor) {
  const idx = source.indexOf(anchor);
  if (idx < 0) {
    return null;
  }
  const after = source.slice(idx);
  // Match the first deps array `}, [a, b, c]` that appears after the anchor.
  // The closing `}` and `,` are part of the useEffect block close.
  const match = after.match(/\},\s*\[([^\]]*)\]/);
  return match ? match[1] : null;
}

test("subagent modal getSubagentConversation poll does not depend on volatile subagents state", () => {
  const deps = findDepsArrayAfter(messageComponentsSource, "getSubagentConversation");
  assert.ok(
    deps !== null,
    "expected to find a useEffect deps array after the getSubagentConversation postMessage",
  );

  assert.doesNotMatch(
    deps,
    /\bsubagents\b/,
    `subagents must not appear in the poll effect deps array (causes interval tear-down/recreate on every stream event). Found: [${deps}]`,
  );
  assert.doesNotMatch(
    deps,
    /\bsubagentDetailsById\b/,
    `subagentDetailsById must not appear in the poll effect deps array (causes interval tear-down/recreate on every stream event). Found: [${deps}]`,
  );
});

test("subagent modal poll reads latest state via a ref or stable handle", () => {
  // After the fix, the effect body must still read latest subagents /
  // subagentDetailsById, but indirectly via a ref or selector handle so the
  // deps array can stay minimal. We assert that at least one ref-based
  // pattern is present in the modal component.
  const anchorIdx = messageComponentsSource.indexOf("getSubagentConversation");
  assert.ok(anchorIdx >= 0, "expected to find getSubagentConversation in MessageComponents");

  // Walk backwards from the anchor to find the enclosing component's body.
  // After the fix, latest subagents/subagentDetailsById must be read via a
  // named ref so the poll effect deps array can stay minimal. Generic
  // useRef() calls do not satisfy this — the ref must be clearly tied to
  // the subagents/subagentDetailsById state slices.
  const componentWindow = messageComponentsSource.slice(Math.max(0, anchorIdx - 12000), anchorIdx);
  assert.match(
    componentWindow,
    /\b(?:subagentsRef|latestSubagents|subagentDetailsByIdRef|latestSubagentDetailsById|latestSubagentsRef|latestSubagentDetailsRef)\b/,
    "the modal must read latest subagents/subagentDetailsById via a named ref (e.g. subagentsRef) so the poll effect deps can stay minimal",
  );
});
