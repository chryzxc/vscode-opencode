import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'services', 'CheckpointRestore.ts')],
  'CheckpointRestore.ts',
);

test('CheckpointRestore: exports CheckpointPayload type', () => {
  assert.match(source, /export\s+type\s+CheckpointPayload\s*=\s*\{/, 'should export CheckpointPayload type');
  assert.match(source, /sessions\?:\s*unknown\[\]/, 'CheckpointPayload should have optional sessions array');
  assert.match(source, /currentSessionId\?:\s*string\s*\|\s*null/, 'CheckpointPayload should have optional currentSessionId');
  assert.match(source, /messages\?:\s*Record<string,\s*unknown\[\]>/, 'CheckpointPayload should have optional messages map');
});

test('CheckpointRestore: exports restoreCheckpointIfPresent async function', () => {
  assert.match(
    source,
    /export\s+async\s+function\s+restoreCheckpointIfPresent/,
    'should export async restoreCheckpointIfPresent',
  );
  assert.match(
    source,
    /context:\s*vscode\.ExtensionContext/,
    'should accept ExtensionContext parameter',
  );
  assert.match(
    source,
    /Promise<\{?\s*restored:\s*boolean/,
    'should return Promise with restored boolean',
  );
});

test('CheckpointRestore: looks for checkpoint at .sisyphus/checkpoint.json', () => {
  assert.match(source, /\.sisyphus/, 'should reference .sisyphus directory');
  assert.match(source, /checkpoint\.json/, 'should look for checkpoint.json');
  assert.match(source, /path\.join\(folder\.uri\.fsPath/, 'should construct path from workspace folder');
});

test('CheckpointRestore: validates workspace folder exists', () => {
  assert.match(source, /workspaceFolders/, 'should check workspace folders');
  assert.match(source, /No workspace folder open/, 'should log when no workspace');
});

test('CheckpointRestore: validates checkpoint file exists', () => {
  assert.match(source, /existsSync\(checkpointPath\)/, 'should check file existence with existsSync');
});

test('CheckpointRestore: parses JSON payload safely', () => {
  assert.match(source, /JSON\.parse\(raw\)/, 'should parse JSON from file contents');
  assert.match(source, /Invalid JSON in checkpoint/, 'should log on parse failure');
});

test('CheckpointRestore: validates sessions is array and messages is object', () => {
  assert.match(source, /Array\.isArray\(payload\.sessions\)/, 'should validate sessions is array');
  assert.match(source, /typeof\s+payload\.messages\s*===\s*["']object["']/, 'should validate messages is object');
});

test('CheckpointRestore: requires at least sessions or messages', () => {
  assert.match(source, /!sessions\s*&&\s*!messages/, 'should require at least one of sessions or messages');
  assert.match(source, /Checkpoint payload missing sessions and messages/, 'should log when both missing');
});

test('CheckpointRestore: writes to workspaceState keys', () => {
  assert.match(source, /opencode\.sessions/, 'should write opencode.sessions');
  assert.match(source, /opencode\.session\.messages\./, 'should write per-session messages');
  assert.match(source, /opencode\.currentSessionId/, 'should write currentSessionId');
  assert.match(source, /workspaceState\.update/, 'should use workspaceState.update');
});

test('CheckpointRestore: validates subagent entries in messages', () => {
  assert.match(source, /rec\.subagents/, 'should inspect subagents');
  assert.match(source, /parentMessageId/, 'should check parentMessageId');
  assert.match(source, /invalidEntries/, 'should track invalid entries');
});

test('CheckpointRestore: renames checkpoint after successful restore', () => {
  assert.match(source, /checkpoint\.restored/, 'should rename to checkpoint.restored');
  assert.match(source, /Date\.now\(\)/, 'should include timestamp in renamed file');
  assert.match(source, /fs\.promises\.rename/, 'should use rename');
});

test('CheckpointRestore: wraps entire function in try-catch', () => {
  assert.match(source, /Unexpected error during checkpoint restore/, 'should catch unexpected errors');
  assert.match(source, /restored:\s*false/, 'should return restored: false on error');
});

test('CheckpointRestore: returns details with session/message counts', () => {
  assert.match(source, /sessions:\s*sessions\??\./, 'should include session count in details');
  assert.match(source, /messages:\s*messagesCount/, 'should include messages count in details');
  assert.match(source, /restored:\s*true/, 'should return restored: true on success');
});
