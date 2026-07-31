import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  "webview/shared/src/chat/lib/messageHandler.ts",
  "utf8",
);

test("stream tool handoff does not assign into a missing pending text holder", () => {
  const toolHandoff = source.match(
    /if \(partType === ['"]tool['"]\)[\s\S]*?const tool = asString\(part\.tool\);/,
  )?.[0] ?? "";

  assert.match(
    toolHandoff,
    /pendingRenderableTextPart\?\.partID === preludePartID[\s\S]*Object\.assign\(pendingRenderableTextPart,/,
    "the optional pending holder must be checked before Object.assign",
  );
  assert.match(
    toolHandoff,
    /if \(pendingRenderableTextPart\?\.partID === preludePartID\)/,
    "tool handoff must tolerate scoped events without the holder",
  );
});
