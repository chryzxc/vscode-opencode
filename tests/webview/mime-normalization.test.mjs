/**
 * Regression: promptFiles and contexts must use mime:"text/plain" and
 * name:filePath (full path) instead of mime:ctx.languageId and
 * name:path.basename, so the server can correctly identify file content
 * type and the agent can reference full paths.
 *
 * Bug: The old code used `mime: ctx.languageId` (e.g. "typescript") which
 * is NOT a valid MIME type, causing the server to reject or misclassify
 * file attachments. It also used `name: path.basename(filePath)` which
 * stripped the directory, so when two files with the same name existed in
 * different directories, the agent couldn't distinguish them.
 *
 * Fix: All promptFiles entries now use mime:"text/plain" and name:filePath
 * (full path preserved).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, joinFromRoot, extractFunctionBody } from "../helpers/source-utils.mjs";

const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

function extractBuildPromptPayload(source) {
  // Raw SDK refactor: prompt attachments are now SessionPromptData body parts.
  // Find the section that builds the SDK `parts` array through promptBody.
  const start = source.indexOf("const parts: NonNullable<SessionPromptData");
  if (start === -1) return "";
  const end = source.indexOf("const promptBody: NonNullable<SessionPromptData", start);
  return end === -1 ? "" : source.slice(start, end);
}

test("promptFiles entries for files use mime text/plain", () => {
  const body = extractBuildPromptPayload(providerSource);
  assert.ok(body.length > 0, "promptFiles builder section must exist");

  // The files loop must push a text/plain SDK file part.
  assert.match(
    body,
    /if \(files && files\.length > 0\)[\s\S]*?parts\.push\(\{[\s\S]*?mime:\s*"text\/plain"/,
    "file entries must use mime 'text/plain' not ctx.languageId",
  );
});

test("promptFiles entries for files preserve full filePath in source path", () => {
  const body = extractBuildPromptPayload(providerSource);

  // Raw SDK parts use display filename separately; the full path must be preserved in source.path.
  assert.match(
    body,
    /source:\s*\{[\s\S]*?path:\s*filePath/,
    "file entries must preserve full filePath in source.path, not only display basename",
  );

  assert.doesNotMatch(
    body,
    /source:\s*\{[\s\S]*?path:\s*path\.basename/,
    "file source.path must NOT use path.basename — this was the bug",
  );
});

test("promptFiles entries for contexts use mime text/plain", () => {
  const body = extractBuildPromptPayload(providerSource);

  const contextsSection = body.slice(body.indexOf("if (contexts && contexts.length > 0)"));

  assert.match(
    contextsSection,
    /parts\.push\(\{[\s\S]*?mime:\s*"text\/plain"/,
    "context entries must use mime 'text/plain' not ctx.languageId",
  );
});

test("promptFiles entries for contexts preserve full filePath in source path", () => {
  const body = extractBuildPromptPayload(providerSource);
  const contextsSection = body.slice(body.indexOf("if (contexts && contexts.length > 0)"));

  assert.match(
    contextsSection,
    /path:\s*(selectionPath|ctx\.file)/,
    "context entries must preserve full filePath in source.path",
  );
});

test("promptFiles entries for contexts include source object with text content", () => {
  const body = extractBuildPromptPayload(providerSource);

  // When content is present, a source object with text value/start/end must be attached.
  assert.match(
    body,
    /source:\s*\{[\s\S]*?text:\s*\{[\s\S]*?value:\s*selectionContent,[\s\S]*?start:\s*0,[\s\S]*?end:\s*selectionContent\.length/s,
    "context entries with content must include source with start/end/text",
  );
});

test("promptFiles entries for images preserve data URL mime detection", () => {
  const body = extractBuildPromptPayload(providerSource);

  // Images must still extract mime from data URL — NOT forced to text/plain
  assert.match(
    providerSource,
    /dataUrl\.match\(|img\.match\(/,
    "image entries must extract mime from data URL via regex match",
  );
  assert.match(
    providerSource,
    /image\/(?:png|jpeg)/,
    "image mime fallback must default to a valid image MIME type",
  );
});

// Deleted: the raw SDK event-driven chat refactor removed the legacy optional `files` payload wrapper;
// SDK prompts now always carry a `parts` array with file parts appended only when inputs exist.
