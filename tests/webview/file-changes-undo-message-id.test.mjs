/**
 * Regression: Undo button must receive messageId when FileChangesSection
 * is rendered from centralizedDiffEvent.
 *
 * Bug: When file changes came from a centralized session.diff event,
 * the FileChangesSection component was rendered WITHOUT a messageId prop.
 * Inside the component, summaryMessageId derived from changeSummary?.messageId
 * or messageId — both were null for the centralized-diff branch. The undo
 * button was permanently disabled with tooltip "no message identifier for
 * this change set".
 *
 * Fix: Pass messageId={messageId || null} from ResponseMessageInner to
 * FileChangesSection when rendering from centralizedDiffEvent.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, joinFromRoot } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

function extractCentralizedDiffBranch(source) {
  const start = source.indexOf("centralizedDiffEvent?.files?.length > 0 && (");
  if (start === -1) return "";
  const end = source.indexOf(")}", start);
  if (end === -1) return "";
  return source.slice(start, end + 2);
}

test("FileChangesSection from centralizedDiffEvent receives messageId prop", () => {
  const branch = extractCentralizedDiffBranch(messageComponentsSource);
  assert.ok(branch.length > 0, "centralized diff render branch must exist");

  assert.match(
    branch,
    /<FileChangesSection/,
    "must render FileChangesSection component",
  );

  assert.match(
    branch,
    /centralizedDiffEvent=\{centralizedDiffEvent\}/,
    "must pass centralizedDiffEvent",
  );

  assert.match(
    branch,
    /messageId=\{centralizedDiffEvent\.messageId \|\| messageId \|\| null\}/,
    "must pass messageId prop so undo button can use it",
  );

  assert.match(
    branch,
    /sessionId=\{currentSessionId\}/,
    "must pass sessionId for undo dispatch",
  );
});

test("FileChangesSection component derives summaryMessageId from messageId fallback", () => {
  assert.ok(
    messageComponentsSource.includes("const summaryMessageId = firstNonEmptyString(centralizedDiffEvent?.messageId, changeSummary?.messageId, messageId) || null"),
    "summaryMessageId must prioritize centralizedDiffEvent.messageId then fall back to changeSummary and messageId prop",
  );

  assert.ok(
    messageComponentsSource.includes("const undoMessageId = summaryMessageId"),
    "undoMessageId must be derived from summaryMessageId",
  );

  assert.match(
    messageComponentsSource,
    /disabled=\{!undoMessageId \|\| isUndoing\}/,
    "undo button must be disabled when no messageId or while undoing",
  );
});

test("undo handler dispatches undoMessageChanges with messageId and sessionId", () => {
  const componentStart = messageComponentsSource.indexOf(
    "export const FileChangesSection = memo(function FileChangesSection(",
  );
  const componentBody = messageComponentsSource.slice(componentStart, componentStart + 5000);

  assert.match(
    componentBody,
    /vscode\.postMessage\(\{[\s\S]*?type: "undoMessageChanges"/,
    "undo handler must post undoMessageChanges message",
  );

  assert.match(
    componentBody,
    /messageId: undoMessageId/,
    "undo handler must include messageId in dispatch",
  );
});

test("rehydrated user-owned SDK summary diffs remain visible in the transcript", () => {
  const transcriptStart = chatShellSource.indexOf("const MemoizedConversationTranscript");
  const fileChangesBranchStart = chatShellSource.indexOf(
    'if (entry.kind === "fileChanges")',
    transcriptStart,
  );
  const fileChangesBranch = chatShellSource.slice(
    fileChangesBranchStart,
    fileChangesBranchStart + 1400,
  );

  assert.ok(fileChangesBranchStart >= 0, "ChatShell must handle fileChanges entries");
  assert.match(
    fileChangesBranch,
    /const changeSummary = entry\.message\.changeSummary/,
    "must read the rehydrated SDK summary from its owning message",
  );
  assert.match(
    fileChangesBranch,
    /changeSummary\?\.files\?\.length/,
    "must render a populated rehydrated summary instead of dropping it",
  );
  assert.match(
    fileChangesBranch,
    /messageId=\{changeSummary\.messageId \|\| entry\.message\.id \|\| null\}/,
    "must preserve the owning SDK message ID as the Undo target",
  );
});

test("a hydrated summary suppresses only its matching assistant block fallback", () => {
  assert.match(
    chatShellSource,
    /const hydratedFileChangesByBlockKey = useMemo\(/,
    "must track response blocks that already render a hydrated summary",
  );
  assert.match(
    chatShellSource,
    /hydratedFileChangesByBlockKey\.has\(blockGroupKey\)/,
    "must hide the duplicate assistant fallback only in the matching block",
  );
  assert.match(
    chatShellSource,
    /ownerMessageId: ownerUserMessageId/,
    "must retain the owning user message when creating a hydrated summary row",
  );
});
