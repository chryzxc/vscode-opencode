import assert from "node:assert/strict";
import test from "node:test";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const provider = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("session switches synchronize the prompt model with restored session settings", () => {
  const applySessionSettings = extractFunctionBody(
    provider,
    "private async applySessionSettings(sessionId: string): Promise<void>",
  );

  assert.match(
    applySessionSettings,
    /await this\.modelAndAgentManager\.applySessionSettings\(sessionId\)/,
    "session settings must be restored before synchronizing prompt state",
  );
  assert.match(
    applySessionSettings,
    /this\.selectedModel\s*=\s*this\.modelAndAgentManager\.getSelectedModel\(\)/,
    "prompts must use the model restored for the active session",
  );
  assert.match(
    provider,
    /await this\.applySessionSettings\(sessionId\);/,
    "session loading must use the synchronized restore path",
  );
});
