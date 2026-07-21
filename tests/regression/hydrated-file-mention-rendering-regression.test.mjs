import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("hydrated user bubbles exclude synthetic file-read echoes", () => {
  assert.match(
    source,
    /const rawUserText =\s*messageBodyFromParts\(message\?\.parts, message\?\.role \?\? message\?\.info\?\.role\) \|\|/,
    "UserMessage must prefer renderable message parts over hydrated top-level text",
  );
  assert.match(
    source,
    /\(part as \{ synthetic\?: unknown \}\)\.synthetic === true\) \{\s*return false;/,
    "synthetic SDK parts must remain excluded from visible user text",
  );
  assert.match(
    source,
    /isSyntheticUserToolTextPart\(splitInjectedSystemPromptFromUserText\(text\)\.userText\)/,
    "the synthetic-text guard must receive the user text string, not the split result object",
  );
});

test("hydrated user bubbles exclude text already represented by an attached file", () => {
  assert.match(
    source,
    /\.map\(\(text\) => text\.trim\(\)\)[\s\S]*?attachmentContents\.has\(text\)/,
    "attachment data-URL contents and rendered text parts must use the same trimmed form",
  );
});

test("attached file mentions use the SDK source path", () => {
  assert.match(
    source,
    /const fileMentionTargets = Array\.from\([\s\S]*?filename: chip\.label, path: chip\.path/,
    "file mention rendering must derive path targets from attached SDK file parts",
  );
  assert.match(
    source,
    /file: part\.path \|\| \(part as any\)\.filename/,
    "clicking a mention must use its resolved workspace path",
  );
  assert.match(
    source,
    /const explicitFileChips = attachedFileChips\.filter\([\s\S]*?!hasInlineFileMention\(content, chip\.label\)/,
    "inline @ references must not render a duplicate attachment chip",
  );
});
