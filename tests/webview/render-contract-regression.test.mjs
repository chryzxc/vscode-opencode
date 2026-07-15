import assert from "node:assert/strict";
import test from "node:test";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const contractSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "renderContract.ts")],
  "renderContract.ts",
);

test("render contract requires every source to map every render block kind", () => {
  assert.match(contractSource, /type SourceBlockBuilders<TSource> = \{[\s\S]*\[K in RenderBlockKind\]/);
  assert.match(contractSource, /rehydratedBuilders[\s\S]*satisfies SourceBlockBuilders<RehydratedRenderSource>/);
  assert.match(contractSource, /liveBuilders[\s\S]*satisfies SourceBlockBuilders<LiveRenderSource>/);
});

test("render contract keeps raw source selection explicit", () => {
  assert.match(contractSource, /kind: "live"/);
  assert.match(contractSource, /kind: "rehydrated"/);
  assert.match(contractSource, /export function buildRenderBlocks/);
});
