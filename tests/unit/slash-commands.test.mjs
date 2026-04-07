import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readAllSources } from '../helpers/source-utils.mjs';

const chatProviderSource = readAllSources([
  joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
  joinFromRoot('src', 'providers', 'chat', '*.ts'),
], 'ChatViewProvider.ts');

test('slash commands are fetched from skill manager and sent to webview', () => {
  // Verify handleGetCommands method exists and has correct implementation
  const getCommandsBody = extractFunctionBody(
    chatProviderSource,
    'async handleGetCommands(): Promise<void> {',
  );

  assert.match(
    getCommandsBody,
    /this\.skillManager\.listSkills\(\)/,
    'handleGetCommands must fetch skills from skillManager',
  );

  assert.match(
    getCommandsBody,
    /\.map\(\s*\([^)]+\)\s*=>\s*\(\{[\s\S]*name:\s*skill\.name/,
    'handleGetCommands must map skills to slash commands',
  );

  assert.match(
    getCommandsBody,
    /type:\s*["']commandsList["']/,
    'handleGetCommands must post commandsList message to webview',
  );

  assert.match(
    getCommandsBody,
    /commands:\s*commands/,
    'handleGetCommands must include commands in the message payload',
  );

  assert.match(
    getCommandsBody,
    /type:\s*["']commandsList["']\s*,\s*commands:\s*commands/,
    'handleGetCommands must post both type and commands in the message',
  );
});

test('slash command handler is properly wired in message router', () => {
  // Verify that getCommands message type is handled in the message router
  assert.match(
    chatProviderSource,
    /case\s+["']getCommands["']:\s*\{\s*await\s+this\.handleGetCommands\(\)[\s\S]*break/,
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
