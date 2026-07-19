import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: `ResponseMessage` is wrapped in `memo()` with no
 * custom comparator. It receives `streaming` as a direct prop. Every
 * stream batch produces a new `streaming` object identity, which forces
 * every mounted ResponseMessage card to rerender — even cards that
 * correspond to historical messages and don't visibly depend on the
 * live stream. The `ResponseMessageInner` subtree then redoes O(n)
 * work over `responseBodyChunks` / accumulated events each render.
 *
 * During active streaming with a long conversation visible, this means
 * every historical assistant card rerenders on every batch.
 *
 * Contract: `ResponseMessage`'s memo must use a custom comparator that
 * skips rerenders for cards whose own message identity is unchanged AND
 * that are not the active streaming card. Alternatively, the `streaming`
 * prop must not be passed unconditionally to every card.
 */

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("ResponseMessage memo uses a custom comparator (not default shallow compare)", () => {
  // The default `memo(Component)` rerenders on every prop identity change.
  // After the fix, the memo must take a second argument: a comparator that
  // avoids rerendering cards whose own message identity didn't change and
  // that aren't the streaming card.
  //
  // Acceptable shapes:
  //   memo(function ResponseMessage(...) { ... }, arePropsEqual)
  //   memo(Component, (prev, next) => ...)
  //
  // Forbidden: memo(Component) with no second argument.
  //
  // Find the ResponseMessage memo expression and look for a comparator.
  const memoIdx = messageComponentsSource.indexOf("export const ResponseMessage = memo(");
  assert.notEqual(memoIdx, -1, "expected to find ResponseMessage memo export");

  // Capture up to 4000 chars after `memo(` — generous to include the
  // inline component body and the trailing comparator argument.
  const after = messageComponentsSource.slice(memoIdx, memoIdx + 6000);

  // The memo call must close the inner function and then have a comma
  // before the comparator. Look for `}, <identifierOrArrow>` near the end.
  // If the memo has no second argument, the call ends with `});` directly.
  const memoCloseIdx = after.indexOf("});");
  assert.ok(memoCloseIdx > -1, "expected to find the end of the ResponseMessage memo call");

  const memoArgs = after.slice(0, memoCloseIdx);
  // The closing `}` of the inner function followed by `,` (not `)`) is the
  // signal that a comparator argument follows.
  assert.match(
    memoArgs,
    /\}\s*,\s*[A-Za-z_]/,
    "ResponseMessage memo must take a custom comparator as its second argument (default shallow compare rerenders every card on every stream batch)",
  );
});

test("ResponseMessage comparator avoids rerender for non-streaming cards on streaming identity change", () => {
  // The comparator (and any helper it uses) must consider whether this card
  // is the streaming card. Search the whole file — helpers are typically
  // defined above the memo export.
  assert.match(
    messageComponentsSource,
    /streamingMessageId|isStreamingCard|isActiveForThisCard|streaming\.messageId|cardIsStreaming|isLiveCard|isStreamingForThisCard|isStreamingForCard/,
    "ResponseMessage comparator (or its helper) must distinguish the active streaming card from historical cards so non-streaming cards skip rerender on streaming identity changes",
  );

  // Additionally, the comparator must reference the helper so the check is
  // actually wired in. Find areResponseMessagePropsEqual and verify.
  const comparatorIdx = messageComponentsSource.indexOf("function areResponseMessagePropsEqual(");
  assert.ok(comparatorIdx > -1, "areResponseMessagePropsEqual should be defined");
  const comparatorWindow = messageComponentsSource.slice(comparatorIdx, comparatorIdx + 2000);
  assert.match(
    comparatorWindow,
    /isStreamingForThisCard|isStreamingCard|isActiveForThisCard|streamingMessageId|cardIsStreaming|isLiveCard|streaming\.messageId/,
    "areResponseMessagePropsEqual must invoke the streaming-card check so non-streaming cards skip rerender on streaming identity changes",
  );
});
