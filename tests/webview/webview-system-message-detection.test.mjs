import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from '../helpers/source-utils.mjs';

const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);

test("webview store exports isInternalTransportReminderMessage function", () => {
  assert.match(
    storeSource,
    /export\s+function\s+isInternalTransportReminderMessage/,
    "store should export isInternalTransportReminderMessage function",
  );
});

test("webview store isInternalTransportReminderMessage detects square-bracketed system messages", () => {
  const funcBody = extractFunctionBody(
    storeSource,
    "export function isInternalTransportReminderMessage(message: Message): boolean",
  );

  assert.match(
    funcBody,
    /const\s+squareBracketPattern/,
    "isInternalTransportReminderMessage should define square bracket pattern",
  );
  assert.match(
    funcBody,
    /squareBracketPattern\.test/,
    "isInternalTransportReminderMessage should test text against square bracket pattern",
  );
  assert.match(
    funcBody,
    /hasSquareBracketPrefix/,
    "isInternalTransportReminderMessage should use square bracket prefix detection",
  );
});

test("webview store isInternalTransportReminderMessage detects angle-bracketed system messages", () => {
  const funcBody = extractFunctionBody(
    storeSource,
    "export function isInternalTransportReminderMessage(message: Message): boolean",
  );

  assert.match(
    funcBody,
    /const\s+angleBracketPattern/,
    "isInternalTransportReminderMessage should define angle bracket pattern",
  );
  assert.match(
    funcBody,
    /angleBracketPattern\.test/,
    "isInternalTransportReminderMessage should test text against angle bracket pattern",
  );
  assert.match(
    funcBody,
    /hasAngleBracketPrefix/,
    "isInternalTransportReminderMessage should use angle bracket prefix detection",
  );
});

test("webview store isInternalTransportReminderMessage detects comment-style system messages", () => {
  const funcBody = extractFunctionBody(
    storeSource,
    "export function isInternalTransportReminderMessage(message: Message): boolean",
  );

  assert.match(
    funcBody,
    /const\s+commentPattern/,
    "isInternalTransportReminderMessage should define comment pattern",
  );
  assert.match(
    funcBody,
    /commentPattern\.test/,
    "isInternalTransportReminderMessage should test text against comment pattern",
  );
  assert.match(
    funcBody,
    /hasCommentPrefix/,
    "isInternalTransportReminderMessage should use comment prefix detection",
  );
});

test("webview store isInternalTransportReminderMessage uses dynamic pattern matching", () => {
  const funcBody = extractFunctionBody(
    storeSource,
    "export function isInternalTransportReminderMessage(message: Message): boolean",
  );

  // Check that it uses dynamic patterns (catches ANY [bracket] or <angled> pattern)
  assert.match(
    funcBody,
    /const\s+squareBracketPattern/,
    "isInternalTransportReminderMessage should define square bracket pattern",
  );
  assert.match(
    funcBody,
    /const\s+angleBracketPattern/,
    "isInternalTransportReminderMessage should define angle bracket pattern",
  );
  assert.match(
    funcBody,
    /const\s+commentPattern/,
    "isInternalTransportReminderMessage should define comment pattern",
  );
  assert.match(
    funcBody,
    /return\s+hasSquareBracketPrefix\s*\|\|\s*hasAngleBracketPrefix\s*\|\|\s*hasCommentPrefix/,
    "isInternalTransportReminderMessage should return true if any pattern matches",
  );
});

test("webview store isInternalTransportReminderMessage checks role before checking patterns", () => {
  const funcBody = extractFunctionBody(
    storeSource,
    "export function isInternalTransportReminderMessage(message: Message): boolean",
  );

  assert.match(
    funcBody,
    /const\s+role\s*=\s*getMessageRoleForCanonical/,
    "isInternalTransportReminderMessage should get message role",
  );
  assert.match(
    funcBody,
    /if\s*\(\s*role\s*!==\s*"user"\s*&&\s*role\s*!==\s*"system"\s*\)/,
    "isInternalTransportReminderMessage should check if role is user or system",
  );
});

test("webview store exports hasSystemMessagePatternInText helper function", () => {
  assert.match(
    storeSource,
    /export\s+function\s+hasSystemMessagePatternInText/,
    "store should export hasSystemMessagePatternInText helper function",
  );
});

test("webview store hasSystemMessagePatternInText uses same pattern matching logic", () => {
  const funcBody = extractFunctionBody(
    storeSource,
    "export function hasSystemMessagePatternInText(text: string): boolean",
  );

  assert.match(
    funcBody,
    /const\s+squareBracketPattern/,
    "hasSystemMessagePatternInText should define square bracket pattern",
  );
  assert.match(
    funcBody,
    /const\s+angleBracketPattern/,
    "hasSystemMessagePatternInText should define angle bracket pattern",
  );
  assert.match(
    funcBody,
    /const\s+commentPattern/,
    "hasSystemMessagePatternInText should define comment pattern",
  );
  assert.match(
    funcBody,
    /hasSquareBracketPrefix\s*\|\|\s*hasAngleBracketPrefix\s*\|\|\s*hasCommentPrefix/,
    "hasSystemMessagePatternInText should return true if any pattern matches",
  );
});

test("webview store hasSystemMessagePatternInText checks for empty text", () => {
  const funcBody = extractFunctionBody(
    storeSource,
    "export function hasSystemMessagePatternInText(text: string): boolean",
  );

  assert.match(
    funcBody,
    /const\s+trimmed\s*=\s*text\.trim\(\)/,
    "hasSystemMessagePatternInText should trim text",
  );
  assert.match(
    funcBody,
    /if\s*\(\s*!trimmed\s*\)\s*\{\s*return\s*false/,
    "hasSystemMessagePatternInText should return false for empty text",
  );
});

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("webview messageHandler imports hasSystemMessagePatternInText from store", () => {
  // Check that hasSystemMessagePatternInText is imported from store, allowing other symbols as well
  assert.match(
    messageHandlerSource,
    /import\s*\{[^}]*hasSystemMessagePatternInText[^}]*\}\s*from\s+['"]\.\/store['"]/,
    "messageHandler should import hasSystemMessagePatternInText from store",
  );
});

test("webview messageHandler checks for system messages in message.part.updated events", () => {
  // Find the message.part.updated case
  const caseMatch = messageHandlerSource.match(
    /case\s+['"]message\.part\.updated['"]:\s*case\s+['"]message\.part\.added['"]:\s*case\s+['"]message\.part\.created['"]:\s*\{([\s\S]*?)\n\s{0,4}\}/
  );

  assert.ok(caseMatch, "messageHandler should have message.part.updated case");

  const caseBody = caseMatch[1];

  assert.match(
    caseBody,
    /hasSystemMessagePatternInText/,
    "message.part.updated case should check for system message patterns",
  );
  assert.match(
    caseBody,
    /const\s+partText/,
    "message.part.updated case should extract part text",
  );
  assert.match(
    caseBody,
    /if\s*\(\s*partText\s*&&\s*hasSystemMessagePatternInText\(partText\)\s*\)/,
    "message.part.updated case should check if part text has system pattern",
  );
});

test("webview messageHandler creates system message when pattern detected", () => {
  const caseMatch = messageHandlerSource.match(
    /case\s+['"]message\.part\.updated['"]:\s*case\s+['"]message\.part\.added['"]:\s*case\s+['"]message\.part\.created['"]:\s*\{([\s\S]*?)\n\s{0,4}\}/
  );

  assert.ok(caseMatch, "messageHandler should have message.part.updated case");

  const caseBody = caseMatch[1];

  assert.match(
    caseBody,
    /upsertRealtimeSystemMessage\(/,
    "Should upsert realtime system message",
  );
  assert.match(
    caseBody,
    /break\s*;[\s\S]*\/\/\s*Don't\s+process\s+this\s+as\s+regular\s+content/,
    "Should break to prevent processing as regular content",
  );
});

test("webview messageHandler allows user messages through role filter for system pattern detection", () => {
  const filterMatch = messageHandlerSource.match(
    /\/\/\s*Filter\s+out\s+non-assistant\s+roles[\s\S]*?return\s*;/m
  );

  assert.ok(filterMatch, "messageHandler should have role filter");

  const filterBody = filterMatch[0];

  assert.match(
    filterBody,
    /if\s*\(\s*eventRole\s*&&\s*eventRole\s*!==\s*['"]assistant['"]\s*\)/,
    "Should filter non-assistant roles",
  );
  assert.match(
    filterBody,
    /if\s*\(\s*eventRole\s*!==\s*['"]user['"]\s*&&\s*eventRole\s*!==\s*['"]system['"]\s*\)\s*\{\s*return/,
    "Should allow user and system messages through (don't filter them out)",
  );
  assert.match(
    filterBody,
    /system\s+messages\s+are\s+handled\s+in\s+the\s+switch\s+cases\s+below/,
    "Should have comment explaining system messages are handled elsewhere",
  );
});

test("webview messageHandler checks system patterns early in message.part.updated flow", () => {
  const caseMatch = messageHandlerSource.match(
    /case\s+['"]message\.part\.updated['"]:\s*case\s+['"]message\.part\.added['"]:\s*case\s+['"]message\.part\.created['"]:\s*\{([\s\S]{0,10000})/
  );

  assert.ok(caseMatch, "messageHandler should have message.part.updated case");

  const caseBody = caseMatch[1];

  // The system message check should happen before content processing
  const systemCheckIndex = caseBody.indexOf('hasSystemMessagePatternInText');
  const contentProcessingIndex = caseBody.indexOf('UPDATE_STREAMING_CONTENT');

  assert.ok(
    systemCheckIndex > 0,
    "System message pattern check should be present",
  );
  assert.ok(
    contentProcessingIndex < 0 || systemCheckIndex < contentProcessingIndex,
    "System message check should happen before content processing",
  );
});
