import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("activity timeline uses raw centralized streamSeq for activity rows without artificial offset", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function buildDisplayEvents(",
  );

  assert.doesNotMatch(
    body,
    /item\.streamSeq \+ 1/,
    "activity timeline ordering should not shift activity/commentary rows ahead of their raw centralized position",
  );
  assert.match(
    body,
    /typeof item\.streamSeq === "number"\s*\?\s*item\.streamSeq/,
    "display-event ordering should use the raw centralized stream sequence directly",
  );
});
