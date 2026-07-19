import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: QuotaService.writeJsonFile() called fs.writeFileSync()
 * synchronously on the extension host main thread. The only caller at the
 * time of writing is the OpenAI token-refresh path inside refreshQuota()
 * (QuotaService.ts:504), which runs on the 5-minute quota poll.
 *
 * Synchronous file writes block the extension host main thread for the
 * duration of the syscall. The blocking window is normally small but
 * compounds with quota polling and other work running concurrently.
 *
 * Contract: writeJsonFile must use the async fs.promises.writeFile API
 * (or fs/promises). The function signature becomes async and callers must
 * await it.
 */

const quotaSource = readSource(
  [joinFromRoot("src", "services", "QuotaService.ts")],
  "QuotaService.ts",
);

test("writeJsonFile does not block the extension host main thread", () => {
  const writeJsonFileBody = extractFunctionBody(
    quotaSource,
    "async function writeJsonFile<T>(",
  );
  assert.ok(writeJsonFileBody.length > 0, "writeJsonFile body should be extractable");

  assert.doesNotMatch(
    writeJsonFileBody,
    /fs\.writeFileSync/,
    "writeJsonFile must not block the extension host main thread with fs.writeFileSync",
  );
});

test("writeJsonFile uses the async fs API", () => {
  const writeJsonFileBody = extractFunctionBody(
    quotaSource,
    "async function writeJsonFile<T>(",
  );
  assert.ok(writeJsonFileBody.length > 0, "writeJsonFile body should be extractable");
  assert.match(
    writeJsonFileBody,
    /fs\.promises\.writeFile|await fs\.(promises\.)?writeFile|fs\.writeFile/,
    "writeJsonFile should use the async fs APIs (fs.promises.writeFile or fs.writeFile callback form)",
  );
});

test("writeJsonFile is async-awaitable by its callers", () => {
  const writeJsonFileMatch = quotaSource.match(/async\s+function\s+writeJsonFile[^{]*\{/);
  assert.ok(writeJsonFileMatch, "writeJsonFile declaration should be found");

  const signatureEnd = quotaSource.slice(
    writeJsonFileMatch.index,
    writeJsonFileMatch.index + writeJsonFileMatch[0].length,
  );
  assert.ok(
    /async\s+function\s+writeJsonFile|function\s+writeJsonFile[^)]*\):\s*Promise</.test(signatureEnd),
    "writeJsonFile should be declared async (or return Promise<boolean>) so callers can await it",
  );
});

test("fetchOpenAI awaits the async writeJsonFile on the token-refresh path", () => {
  const fetchOpenAIBody = extractFunctionBody(
    quotaSource,
    "private async fetchOpenAI",
  );
  assert.ok(fetchOpenAIBody.length > 0, "fetchOpenAI body should be extractable");

  const callSiteMatch = fetchOpenAIBody.match(/writeJsonFile\([\s\S]*?\)/);
  assert.ok(callSiteMatch, "expected to find a writeJsonFile call inside fetchOpenAI");

  const callIdx = fetchOpenAIBody.indexOf("writeJsonFile");
  const preceding = fetchOpenAIBody.slice(Math.max(0, callIdx - 30), callIdx);
  assert.match(
    preceding,
    /await\s*$/,
    "fetchOpenAI must await writeJsonFile on the token-refresh path so the main thread is not blocked",
  );
});
