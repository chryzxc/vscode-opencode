import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from "../helpers/source-utils.mjs";

const panelSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "PanelComponents.tsx")],
  "PanelComponents.tsx",
);
const pendingSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "pendingUserMessages.ts")],
  "pendingUserMessages.ts",
);
const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("selected @ file mentions are sent as SDK-backed contexts", () => {
  assert.match(
    panelSource,
    /export function resolveMentionedFileContexts\([\s\S]*?text\.matchAll\(FILE_MENTION_REGEX\)[\s\S]*?fileMentionPaths\[mention\]/,
    "@ mention paths must be resolved from autocomplete selections",
  );

  const sendPrompt = extractFunctionBody(panelSource, "const sendPrompt = () =>");
  assert.match(
    sendPrompt,
    /const currentContexts = resolveMentionedFileContexts\([\s\S]*?text,[\s\S]*?selectedContexts,[\s\S]*?fileMentionPaths/,
    "regular sends must include selected @ file mentions in contexts",
  );
  assert.match(
    sendPrompt,
    /contexts:\s*currentContexts/,
    "regular sends must forward resolved mention contexts to the extension host",
  );
});

test("steered messages attach selected @ file mentions too", () => {
  const steerPrompt = extractFunctionBody(panelSource, "const steerPrompt = () =>");
  assert.match(
    steerPrompt,
    /contexts:\s*resolveMentionedFileContexts\([\s\S]*?text,[\s\S]*?selectedContexts,[\s\S]*?fileMentionPaths/,
    "live steering must use the same @ mention attachment path",
  );
});

test("live optimistic and host-echo user bubbles retain @ file context paths", () => {
  assert.match(
    panelSource,
    /attachments: currentAttachments,\s*contexts: currentContexts/,
    "the optimistic webview message must retain resolved mention contexts",
  );
  assert.match(
    pendingSource,
    /\(pending\.contexts \?\? \[\]\)[\s\S]*?source: \{[\s\S]*?path:/,
    "pending bubbles must convert contexts into file parts with paths",
  );
  assert.match(
    providerSource,
    /Array\.isArray\(contexts\)[\s\S]*?source: \{[\s\S]*?path:/,
    "the host's immediate user-message echo must include context file parts",
  );
});
