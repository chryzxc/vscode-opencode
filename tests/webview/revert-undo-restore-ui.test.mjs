/**
 * Regression: Undo button loading state + Restore button swap + revertState persistence.
 *
 * Covers three behaviors:
 * 1. Undo button shows loading state (isUndoing + Loader2 spinner) while revert is in-flight
 * 2. After successful revert, Undo button is replaced by Restore button inline
 * 3. Top-level "Changes from this message were reverted" banner is removed
 * 4. Host syncs revertState from server on session load (syncRevertStateFromServer)
 * 5. Deferred SDK prompt path uses data URI for code selections (not raw file path)
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

const chatViewProviderSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

function extractFileChangesSectionUndoArea(source) {
  const start = source.indexOf("const undoMessageId = summaryMessageId");
  if (start === -1) return "";
  const end = source.indexOf("const handleReview", start);
  if (end === -1) return "";
  return source.slice(start, end);
}

function extractUndoButtonRenderBlock(source) {
  const start = source.indexOf('isReverted ? (');
  if (start === -1) return "";
  const end = source.indexOf("onClick={handleReview}", start);
  if (end === -1) return "";
  return source.slice(start, end);
}

test("undo button has isUndoing loading state with Loader2 spinner", () => {
  const undoArea = extractFileChangesSectionUndoArea(messageComponentsSource);
  assert.ok(undoArea.length > 0, "undo state/handler area must exist");

  assert.ok(
    undoArea.includes("const [isUndoing, setIsUndoing] = useState(false)"),
    "isUndoing state must be declared",
  );

  assert.ok(
    undoArea.includes("setIsUndoing(true)"),
    "isUndoing must be set true on undo click",
  );
});

test("undo button shows Loader2 spinner while isUndoing", () => {
  const renderBlock = extractUndoButtonRenderBlock(messageComponentsSource);
  assert.ok(renderBlock.length > 0, "undo/restore render block must exist");

  assert.ok(
    renderBlock.includes("isUndoing ? ("),
    "render must branch on isUndoing",
  );

  assert.ok(
    renderBlock.includes('Loader2 className="h-3.5 w-3.5 animate-spin"'),
    "Loader2 spinner must be rendered when isUndoing",
  );

  assert.ok(
    renderBlock.includes('"Undoing..."'),
    "button text must show Undoing... while loading",
  );

  assert.ok(
    renderBlock.includes("disabled={!undoMessageId || isUndoing}"),
    "undo button must be disabled while isUndoing",
  );
});

test("Restore button replaces Undo when revertState matches message ID", () => {
  const undoArea = extractFileChangesSectionUndoArea(messageComponentsSource);
  assert.ok(undoArea.length > 0, "undo state/handler area must exist");

  assert.ok(
    undoArea.includes("const [revertedMessageId, setRevertedMessageId] = useState<string | null>(null)"),
    "revertedMessageId state must be declared",
  );

  assert.ok(
    undoArea.includes("revertedMessageId === undoMessageId"),
    "isReverted must compare revertedMessageId with undoMessageId",
  );

  const renderBlock = extractUndoButtonRenderBlock(messageComponentsSource);
  assert.ok(renderBlock.length > 0, "undo/restore render block must exist");

  assert.ok(
    renderBlock.includes("isReverted ? ("),
    "render must branch on isReverted",
  );

  assert.ok(
    renderBlock.includes("RotateCcw"),
    "Restore button must use RotateCcw icon",
  );

  assert.ok(
    undoArea.includes("handleRestore"),
    "handleRestore must be defined",
  );

  assert.ok(
    undoArea.includes("type: \"unrevertSession\""),
    "handleRestore must dispatch unrevertSession",
  );
});

test("revertStateUpdate message clears isUndoing and sets revertedMessageId", () => {
  const fileChangesSectionStart = messageComponentsSource.indexOf(
    "export const FileChangesSection = memo(function FileChangesSection(",
  );
  const sectionBody = messageComponentsSource.slice(
    fileChangesSectionStart,
    fileChangesSectionStart + 8000,
  );

  assert.ok(
    sectionBody.includes('data.type === "revertStateUpdate"'),
    "message listener must handle revertStateUpdate",
  );

  assert.ok(
    sectionBody.includes("setIsUndoing(false)"),
    "isUndoing must be cleared on revertStateUpdate",
  );

  assert.ok(
    sectionBody.includes("setRevertedMessageId(data.revertState?.messageID ?? null)"),
    "revertedMessageId must be set from revertStateUpdate payload",
  );
});

test("top-level 'Changes from this message were reverted' banner is removed from ChatShell", () => {
  assert.ok(
    !chatShellSource.includes("Changes from this message were reverted"),
    "the pinned top banner text must not exist in ChatShell",
  );

  assert.ok(
    !chatShellSource.includes("state.revertState && state.currentSessionId ? ("),
    "the pinned revertState banner block must not exist",
  );
});

test("ChatShell no longer imports RotateCcw (moved to MessageComponents)", () => {
  const importLine = chatShellSource.match(
    /import \{[^}]*\} from "lucide-react"/,
  );
  assert.ok(importLine, "lucide-react import must exist");
  assert.ok(
    !importLine[0].includes("RotateCcw"),
    "RotateCcw must not be imported in ChatShell (removed with banner)",
  );
});

test("MessageComponents imports RotateCcw for Restore button", () => {
  const importBlock = messageComponentsSource.match(
    /import \{[\s\S]*?\} from "lucide-react"/,
  );
  assert.ok(importBlock, "lucide-react import must exist");
  assert.ok(
    importBlock[0].includes("RotateCcw"),
    "RotateCcw must be imported in MessageComponents for Restore button",
  );
});

test("ChatShell still maps revertState from appState (for centralized transcript if needed)", () => {
  assert.ok(
    chatShellSource.includes("revertState: appState.revertState"),
    "revertState must still be mapped from appState",
  );
});

test("host syncRevertStateFromServer fetches session.revert and posts revertStateUpdate", () => {
  assert.ok(
    chatViewProviderSource.includes("private async syncRevertStateFromServer(sessionId: string)"),
    "syncRevertStateFromServer method must exist",
  );

  const methodBody = chatViewSource_extractMethodBody();
  assert.ok(methodBody.length > 0, "syncRevertStateFromServer body must exist");

  assert.ok(
    methodBody.includes("client.session.get({ sessionID: sessionId })"),
    "must fetch session via client.session.get",
  );

  assert.ok(
    methodBody.includes("revert?.messageID"),
    "must check session.revert.messageID",
  );

  assert.ok(
    methodBody.includes('type: "revertStateUpdate"'),
    "must post revertStateUpdate message",
  );

  assert.ok(
    methodBody.includes("revertState: null"),
    "must post revertState:null when no revert field",
  );
});

function chatViewSource_extractMethodBody() {
  const start = chatViewProviderSource.indexOf(
    "private async syncRevertStateFromServer(sessionId: string)",
  );
  if (start === -1) return "";
  const end = chatViewProviderSource.indexOf(
    "private async handleGetMessageFileDiffPreview",
    start,
  );
  if (end === -1) return "";
  return chatViewProviderSource.slice(start, end);
}

test("handleLoadSession calls syncRevertStateFromServer", () => {
  const loadSessionStart = chatViewProviderSource.indexOf("private async handleLoadSession(");
  const loadSessionBody = chatViewProviderSource.slice(loadSessionStart, loadSessionStart + 10000);

  assert.ok(
    loadSessionBody.includes("syncRevertStateFromServer(sessionId)"),
    "handleLoadSession must call syncRevertStateFromServer",
  );
});

test("SDK prompt uses data URI for code selections instead of raw file path", () => {
  const promptBody = chatViewProviderSource.slice(
    chatViewProviderSource.indexOf("const parts: NonNullable<SessionPromptData"),
    chatViewProviderSource.indexOf("const promptBody: NonNullable<SessionPromptData"),
  );

  assert.ok(
    promptBody.includes("data:text/plain;base64"),
    "prompt path must construct data URI for selections",
  );

  assert.ok(
    promptBody.includes("Buffer.from(") && promptBody.includes('"base64"'),
    "prompt path must base64-encode selection content",
  );

  assert.ok(
    promptBody.includes("selectionPathWithLineInfo"),
    "prompt path must include line info in filename",
  );
});

test("no [UNDO-DEBUG] logs remain in host or webview", () => {
  assert.ok(
    !chatViewProviderSource.includes("[UNDO-DEBUG]"),
    "no UNDO-DEBUG logs should remain in ChatViewProvider",
  );

  assert.ok(
    !messageComponentsSource.includes("[UNDO-DEBUG]"),
    "no UNDO-DEBUG logs should remain in MessageComponents",
  );
});
