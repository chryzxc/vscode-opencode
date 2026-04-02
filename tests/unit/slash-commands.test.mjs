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

test('slash commands include all required fields from skill definition', () => {
  // Verify that the mapping from SkillDefinition to SlashCommand includes all fields
  const getCommandsBody = extractFunctionBody(
    chatProviderSource,
    'async handleGetCommands(): Promise<void> {',
  );

  // Check that name is mapped
  assert.match(
    getCommandsBody,
    /name:\s*skill\.name/,
    'Slash command must include name from skill',
  );

  // Check that description is mapped
  assert.match(
    getCommandsBody,
    /description:\s*skill\.description/,
    'Slash command must include description from skill',
  );

  // Check that optional fields are mapped
  assert.match(
    getCommandsBody,
    /agent:\s*skill\.agent/,
    'Slash command must include agent from skill',
  );

  assert.match(
    getCommandsBody,
    /model:\s*skill\.model/,
    'Slash command must include model from skill',
  );

  assert.match(
    getCommandsBody,
    /template:\s*skill\.template/,
    'Slash command must include template from skill',
  );

  assert.match(
    getCommandsBody,
    /subtask:\s*skill\.subtask/,
    'Slash command must include subtask from skill',
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
    /catch\s*\(\s*error\s*\)\s*\{[\s\S]*this\.logger\.error\(["']Failed to load commands["']/,
    'handleGetCommands must log errors when loading commands fails',
  );

  assert.match(
    getCommandsBody,
    /catch\s*\([^)]*\)\s*\{[\s\S]*this\.view\?\.webview\.postMessage\(\s*\{\s*type:\s*["']commandsList["']\s*,\s*commands:\s*\[\s*\]/,
    'handleGetCommands must send empty commands array on error',
  );
});
