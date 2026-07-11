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
  // The prompt payload builder is a private method that returns { text, files?, agents? }
  // Find the section that builds promptFiles
  const start = source.indexOf("const promptFiles: any[] = [];");
  if (start === -1) return "";
  // Find the return statement
  const returnIdx = source.indexOf("return {", start);
  if (returnIdx === -1) return "";
  const endBrace = source.indexOf("};", returnIdx);
  return endBrace === -1 ? "" : source.slice(start, endBrace + 2);
}

test("promptFiles entries for files use mime text/plain", () => {
  const body = extractBuildPromptPayload(providerSource);
  assert.ok(body.length > 0, "promptFiles builder section must exist");

  // The files loop must push mime:"text/plain"
  assert.match(
    body,
    /promptFiles\.push\(\{[\s\S]*?mime:\s*"text\/plain"/,
    "file entries must use mime 'text/plain' not ctx.languageId",
  );
});

test("promptFiles entries for files use full filePath as name", () => {
  const body = extractBuildPromptPayload(providerSource);

  // name must be filePath (full path), not path.basename(filePath)
  assert.match(
    body,
    /name:\s*filePath/,
    "file entries must use full filePath as name, not path.basename",
  );

  // Must NOT use path.basename for name
  assert.doesNotMatch(
    body,
    /name:\s*path\.basename/,
    "file entries must NOT use path.basename for name — this was the bug",
  );
});

test("promptFiles entries for contexts use mime text/plain", () => {
  const body = extractBuildPromptPayload(providerSource);

  // The contexts loop must also push mime:"text/plain"
  // Match the second promptFiles.push (contexts loop)
  const firstPushEnd = body.indexOf("});", body.indexOf("promptFiles.push(")) ;
  const contextsSection = body.slice(firstPushEnd);

  assert.match(
    contextsSection,
    /promptFiles\.push\(\{[\s\S]*?mime:\s*"text\/plain"/,
    "context entries must use mime 'text/plain' not ctx.languageId",
  );
});

test("promptFiles entries for contexts use full filePath as name", () => {
  const body = extractBuildPromptPayload(providerSource);
  const firstPushEnd = body.indexOf("});", body.indexOf("promptFiles.push("));
  const contextsSection = body.slice(firstPushEnd);

  assert.match(
    contextsSection,
    /name:\s*filePath/,
    "context entries must use full filePath as name",
  );
});

test("promptFiles entries for contexts include source object with text content", () => {
  const body = extractBuildPromptPayload(providerSource);

  // When content is present, a source object with start/end/text must be attached
  assert.match(
    body,
    /source:\s*\{[\s\S]*?start:\s*0,[\s\S]*?end:\s*content\.length,[\s\S]*?text:\s*content/s,
    "context entries with content must include source with start/end/text",
  );
});

test("promptFiles entries for images preserve data URL mime detection", () => {
  const body = extractBuildPromptPayload(providerSource);

  // Images must still extract mime from data URL — NOT forced to text/plain
  assert.match(
    body,
    /dataUrl\.match\(/,
    "image entries must extract mime from data URL via regex match",
  );
  assert.match(
    body,
    /image\/png/,
    "image mime fallback must default to image/png",
  );
});

test("promptFiles are only attached when non-empty", () => {
  const body = extractBuildPromptPayload(providerSource);

  assert.match(
    body,
    /promptFiles\.length > 0 \? \{ files: promptFiles \}/,
    "files array must only be attached to payload when promptFiles is non-empty",
  );
});
