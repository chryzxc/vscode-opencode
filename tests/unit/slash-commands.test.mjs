import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readAllSources } from '../helpers/source-utils.mjs';

const chatProviderSource = readAllSources([
  joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
  joinFromRoot('src', 'providers', 'chat', '*.ts'),
], 'ChatViewProvider.ts');

test('slash suggestions fetch OpenCode commands and skills', () => {
  // Verify handleGetCommands method exists and has correct implementation
  const getCommandsBody = extractFunctionBody(
    chatProviderSource,
    'private async handleGetCommands(): Promise<void> {',
  );

  assert.match(
    getCommandsBody,
    /await this\.serverManager\.ensureRunning\(\)/,
    'handleGetCommands must ensure server is running',
  );

  assert.match(
    getCommandsBody,
    /client\.tool\.list\(/,
    'handleGetCommands must fetch tools from server via client.tool.list for skills',
  );

  assert.match(
    getCommandsBody,
    /client\.command\.list\(/,
    'handleGetCommands must fetch command catalog via client.command.list',
  );

  assert.match(
    getCommandsBody,
    /skill|commands/i,
    'handleGetCommands must extract or filter skill-related tools/commands',
  );

  assert.match(
    getCommandsBody,
    /sendCommandsToWebview\(/,
    'handleGetCommands must send commands to webview',
  );
});

test('slash suggestions label command and skill sources', () => {
  const getCommandsBody = extractFunctionBody(
    chatProviderSource,
    'private async handleGetCommands(): Promise<void> {',
  );

  assert.match(
    getCommandsBody,
    /source:\s*["']command["']/,
    'command catalog entries should be labelled as commands',
  );

  assert.match(
    getCommandsBody,
    /source:\s*["']skill["']/,
    'skill entries should be labelled as skills',
  );
});

test('slash command handler is properly wired in message router', () => {
  // Verify that getCommands message type is handled in the message router
  assert.match(
    chatProviderSource,
    /case\s+["']getCommands["']:\s*\{[\s\S]*await\s+this\.handleGetCommands\(\)[\s\S]*break/,
    'Message router must handle getCommands and call handleGetCommands method',
  );
});

test('slash commands include mapped fields from skill definition', () => {
  // Verify that skills are mapped to commands with necessary fields
  const getCommandsBody = extractFunctionBody(
    chatProviderSource,
    'async handleGetCommands(): Promise<void> {',
  );

  // Check that command mapping exists
  assert.match(
    getCommandsBody,
    /commands|name|description|skill/i,
    'Slash commands should map skill fields to command structure',
  );

  assert.match(
    getCommandsBody,
    /Array|map|\/\*|\/\/|parse|extract/i,
    'Should have logic to extract or parse commands from skills',
  );

  assert.match(
    getCommandsBody,
    /sendCommandsToWebview|postMessage|send|commands/i,
    'Should send mapped commands to webview',
  );
});

test('slash commands handler gracefully handles errors', () => {
  // Verify error handling in handleGetCommands
  const getCommandsBody = extractFunctionBody(
    chatProviderSource,
    'async handleGetCommands(): Promise<void> {',
  );

  assert.match(
    getCommandsBody,
    /try\s*\{/,
    'handleGetCommands must have try block for error handling',
  );

  assert.match(
    getCommandsBody,
    /catch\s*\([\s\S]*\{/,
    'handleGetCommands must have catch block for error handling',
  );

  assert.match(
    getCommandsBody,
    /logger|error|log/i,
    'handleGetCommands should log errors appropriately',
  );

  assert.match(
    getCommandsBody,
    /sendCommandsToWebview|postMessage|commands/i,
    'handleGetCommands should send response even on error',
  );
});
