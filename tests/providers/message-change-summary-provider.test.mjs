import test from "node:test";
import assert from "node:assert/strict";
import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("provider computes message change summary from sdk session.diff", () => {
  assert.match(
    providerSource,
    /summarizeSessionDiffForMessage\(/,
    "ChatViewProvider should define summarizeSessionDiffForMessage helper",
  );
  assert.match(
    providerSource,
    /client\.session\.diff\(/,
    "ChatViewProvider should call SDK session.diff for per-message change summary",
  );
  assert.match(
    providerSource,
    /query:\s*\{\s*directory:\s*workspaceDir,\s*messageID:\s*messageId\s*\}/,
    "session.diff query should include directory + messageID when workspace is available",
  );
  assert.match(
    providerSource,
    /filesChanged:\s*enrichedRows\.length[\s\S]*added[\s\S]*deleted[\s\S]*files:\s*enrichedRows/s,
    "change summary should include file count, totals, and file rows",
  );
  assert.match(
    providerSource,
    /getDiffActivityEnrichment\(row\.file\)/,
    "change summary should attempt per-file diff preview enrichment",
  );
  assert.match(
    providerSource,
    /diffExcerpt:\s*enrichment\?\.diffExcerpt/,
    "enriched file rows should include diffExcerpt when available",
  );
});

test("provider wires undo message changes through sdk session.revert", () => {
  assert.match(
    providerSource,
    /case\s+"undoMessageChanges"/,
    "webview command undoMessageChanges should be handled",
  );
  assert.match(
    providerSource,
    /handleUndoMessageChanges\(/,
    "ChatViewProvider should implement handleUndoMessageChanges",
  );
  assert.match(
    providerSource,
    /client\.session\.revert\(/,
    "undo should call SDK session.revert",
  );
  assert.match(
    providerSource,
    /body:\s*\{\s*messageID:\s*targetMessageId\s*\}/,
    "session.revert should target the selected assistant message",
  );
});
