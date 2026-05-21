import test from "node:test";
import assert from "node:assert/strict";
import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("chat webview retains context when hidden", () => {
  assert.match(
    source,
    /retainContextWhenHidden:\s*true/,
    "ChatViewProvider should set retainContextWhenHidden so loaded conversations survive sidebar focus changes",
  );
});
