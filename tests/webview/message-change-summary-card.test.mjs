import test from "node:test";
import assert from "node:assert/strict";
import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

const typesSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "types.ts")],
  "types.ts",
);

test("message types include message-level change summary payload", () => {
  assert.match(
    typesSource,
    /export\s+interface\s+MessageChangeSummary/,
    "types should define MessageChangeSummary",
  );
  assert.match(
    typesSource,
    /changeSummary\?:\s*MessageChangeSummary/,
    "Message should include optional changeSummary payload",
  );
});

test("message change summary card renders actions", () => {
  assert.match(
    messageComponentsSource,
    /changeSummary|summary|fileChange/i,
    "message rendering should handle change summary data",
  );
  assert.match(
    messageComponentsSource,
    /undoMessageChanges|reviewMessageChanges|messageChange/i,
    "card should post change-related actions",
  );
  assert.match(
    messageComponentsSource,
    /map.*fileChange|visibleChanges|changed.*file/i,
    "card should render changed file rows",
  );
});

test("file change summary card is scoped to its owning SDK message", () => {
  assert.match(
    messageComponentsSource,
    /ownership|owner|scope|messageId/i,
    "message rendering should use ownership checks for change summaries",
  );
  assert.match(
    messageComponentsSource,
    /summaryMessageId|messageId.*summary|changeSummary\.messageId/i,
    "ownership check should read the summary message id",
  );
  assert.match(
    messageComponentsSource,
    /some\(|every\(|filter\(|find\(/,
    "summary should use array methods for ownership checks",
  );
  assert.match(
    messageComponentsSource,
    /fileChange|edits|hasOwn/i,
    "summary should check for file-change evidence",
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /Array\.isArray\(message\?\.edits\)[\s\S]{0,120}hasOwnFileChanges/,
    "generic edit lists should not make every assistant response render the scoped undo/review panel",
  );
});

test("file change summary card prefers provider-attached message change summaries", () => {
  assert.match(
    messageComponentsSource,
    /const messageChangeSummary = message\?\.changeSummary;/,
    "response rendering should read the provider-attached message change summary",
  );
  assert.match(
    messageComponentsSource,
    /changeSummary=\{messageChangeSummary\}/,
    "file change section should receive the explicit change summary payload",
  );
  assert.match(
    messageComponentsSource,
    /firstNonEmptyString\(messageChangeSummary\?\.messageId,\s*messageId\)/,
    "explicit change summaries should supply the owning message id for undo and preview actions",
  );
});

test("rehydrated SDK summaries render after their final assistant envelope", () => {
  assert.match(
    chatShellSource,
    /ownerUserMessageId[\s\S]{0,2200}isLastAssistantForUserTurn/,
    "the transcript should use the SDK assistant parentID to find a turn's final envelope",
  );
  assert.match(
    chatShellSource,
    /kind: "fileChanges",\s*key: `file-changes:\$\{ownerUserMessageId\}`/,
    "the transcript should insert a dedicated summary block after the response",
  );
  assert.match(
    chatShellSource,
    /entry\.kind === "fileChanges"[\s\S]{0,1200}FileChangesSection/,
    "the transcript should render the dedicated summary block",
  );
});

test("file change summary normalizes .sisyphus absolute and relative paths to avoid duplicates", () => {
  assert.match(
    messageComponentsSource,
    /\.sisyphus|sisyphus|hidden.*path|normali[sz]e/i,
    "path normalization should handle .sisyphus paths",
  );
  assert.match(
    messageComponentsSource,
    /slice\(|substring\(|replace\(|toLowerCase\(/,
    "path normalization should use string manipulation methods",
  );
  assert.match(
    messageComponentsSource,
    /\/|\\|path/i,
    "path normalization should handle path separators",
  );
});
