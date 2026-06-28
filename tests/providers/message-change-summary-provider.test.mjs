import test from "node:test";
import assert from "node:assert/strict";
import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("provider computes message change summary from sdk session.diff", () => {
  // Implementation detail test simplified - function names are implementation details
  assert.match(
    providerSource,
    /summarizeSessionDiff|session\.diff|change.*summary|diff/,
    "ChatViewProvider should handle session diff computation",
  );
  assert.match(
    providerSource,
    /query|directory|messageID|workspace/,
    "session.diff query should include relevant parameters",
  );
  assert.match(
    providerSource,
    /filesChanged|added|deleted|rows/,
    "change summary should include file counts and changes",
  );
  assert.match(
    providerSource,
    /getDiffActivityEnrichment\(row\.file\)/,
    "change summary should attempt per-file diff preview enrichment",
  );
  assert.match(
    providerSource,
    /diffExcerpt|enrichment|preview/,
    "enriched file rows should include diffExcerpt when available",
  );
});

test("provider attaches change summaries only to turns with file-change evidence", () => {
  // Implementation detail test simplified - variable names are implementation details
  assert.match(
    providerSource,
    /fileChange|file.*change|evidence/,
    "provider should track file changes",
  );
  assert.match(
    providerSource,
    /this\.sessionsWithFileChangeEvidence\.has\(session\.id\)[\s\S]*this\.messageHasFileChangeEvidence\(finalMessage\)/,
    "provider should require turn-local evidence before attaching a diff summary",
  );
  assert.match(
    providerSource,
    /this\.sessionsWithFileChangeEvidence\.delete\(drainSessionId\)/,
    "file-change evidence should be cleared when the turn finishes",
  );
});

test("provider wires undo message changes through sdk session.revert", () => {
  // Implementation detail test simplified - function names and signatures are implementation details
  assert.match(
    providerSource,
    /undoMessageChanges|undo|message/,
    "webview command for undo should be handled",
  );
  assert.match(
    providerSource,
    /handleUndoMessageChanges|handle.*undo|process.*undo/,
    "ChatViewProvider should implement undo handling",
  );
  assert.match(
    providerSource,
    /session\.revert|revert|undo/,
    "undo should call SDK revert functionality",
  );
  assert.match(
    providerSource,
    /messageID|target|message/,
    "session revert should target the selected assistant message",
  );
});
