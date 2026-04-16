/**
 * Extension Activation Flow Regression Tests
 *
 * These tests prevent regressions in extension initialization and service startup.
 * The activation flow is critical for all extension functionality.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const extensionSource = readSource(
  [joinFromRoot('src', 'extension.ts')],
  'extension.ts',
);

test.describe('Extension Activation - Service Initialization Order', () => {

  test('initializes OpencodeServerManager first', () => {
    const source = extensionSource;

    assert.match(
      source,
      /PHASE 1.*Initialize Core Services|serverManager\s*=\s*new OpencodeServerManager/s,
      'must initialize OpencodeServerManager before other services'
    );
  });

  test('initializes SessionService after server manager', () => {
    const source = extensionSource;

    assert.match(
      source,
      /sessionService\s*=\s*new SessionService\(context,\s*serverManager\)/s,
      'must initialize SessionService with server manager dependency'
    );
  });

  test('initializes StatusBarProvider after server manager', () => {
    const source = extensionSource;

    assert.match(
      source,
      /statusBarProvider\s*=\s*new StatusBarProvider\(serverManager\)/s,
      'must initialize StatusBarProvider with server manager dependency'
    );
  });

  test('initializes SkillManagementService', () => {
    const source = extensionSource;

    assert.match(
      source,
      /skillManagementService\s*=\s*new SkillManagementService/s,
      'must initialize SkillManagementService'
    );
  });

  test('awaits skill management initialization', () => {
    const source = extensionSource;

    assert.match(
      source,
      /await skillManagementService\.initialize\(\)/s,
      'must await skill management service initialization'
    );
  });

});

test.describe('Extension Activation - WebView Provider Registration', () => {

  test('initializes ModelCapabilitiesService', () => {
    const source = extensionSource;

    assert.match(
      source,
      /const modelCapabilitiesService\s*=\s*new ModelCapabilitiesService\(\)/s,
      'must initialize ModelCapabilitiesService for webviews'
    );
  });

  test('initializes ChatViewProvider with dependencies', () => {
    const source = extensionSource;

    assert.match(
      source,
      /chatViewProvider\s*=\s*new ChatViewProvider\(context,\s*serverManager,\s*sessionService,\s*modelCapabilitiesService\)/s,
      'must initialize ChatViewProvider with all required dependencies'
    );
  });

  test('registers ChatViewProvider with VSCode', () => {
    const source = extensionSource;

    assert.match(
      source,
      /registerWebviewViewProvider\("opencode\.chatView",\s*chatViewProvider\)/s,
      'must register ChatViewProvider with VSCode'
    );
  });

  test('initializes SkillsPanelProvider', () => {
    const source = extensionSource;

    assert.match(
      source,
      /const skillsPanelProvider\s*=\s*new SkillsPanelProvider/s,
      'must initialize SkillsPanelProvider'
    );
  });

  test('registers SkillsPanelProvider with VSCode', () => {
    const source = extensionSource;

    assert.match(
      source,
      /registerWebviewViewProvider\("opencode\.skillsPanel",\s*skillsPanelProvider\)/s,
      'must register SkillsPanelProvider with VSCode'
    );
  });

});

test.describe('Extension Activation - Status Bar Integration', () => {

  test('subscribes to server status changes', () => {
    const source = extensionSource;

    assert.match(
      source,
      /serverManager\.onStatusChange\(\(\)\s*=>\s*\{[\s\S]*statusBarProvider\.updateStatus\(\)/s,
      'must subscribe to server manager status changes'
    );
  });

  test('updates status bar on status change', () => {
    const source = extensionSource;

    assert.match(
      source,
      /onStatusChange[\s\S]*statusBarProvider\.updateStatus\(\)/s,
      'must update status bar when server status changes'
    );
  });

  test('adds status change subscription to context', () => {
    const source = extensionSource;

    assert.match(
      source,
      /context\.subscriptions\.push\([\s\S]*onStatusChange/s,
      'must add status change subscription to context for cleanup'
    );
  });

});

test.describe('Extension Activation - Config Files Provider', () => {

  test('initializes ConfigFilesProvider', () => {
    const source = extensionSource;

    assert.match(
      source,
      /const configFilesProvider\s*=\s*new ConfigFilesProvider\(\)/s,
      'must initialize ConfigFilesProvider'
    );
  });

  test('registers getConfigFiles command', () => {
    const source = extensionSource;

    assert.match(
      source,
      /registerCommand\('opencode\.getConfigFiles'/s,
      'must register opencode.getConfigFiles command'
    );
  });

  test('registers saveConfigFile command', () => {
    const source = extensionSource;

    assert.match(
      source,
      /registerCommand\('opencode\.saveConfigFile'/s,
      'must register opencode.saveConfigFile command'
    );
  });

  test('handles config file scan errors', () => {
    const source = extensionSource;

    assert.match(
      source,
      /getConfigFiles.*catch.*error.*showErrorMessage/s,
      'must handle errors when scanning config files'
    );
  });

  test('handles config file save errors', () => {
    const source = extensionSource;

    assert.match(
      source,
      /saveConfigFile.*catch.*error.*showErrorMessage/s,
      'must handle errors when saving config files'
    );
  });

});

test.describe('Extension Activation - Error Handling', () => {

  test('wraps activation in try-catch', () => {
    const source = extensionSource;

    assert.match(
      source,
      /export async function activate[\s\S]*try\s*\{/s,
      'must wrap activation logic in try-catch block'
    );
  });

  test('logs activation start', () => {
    const source = extensionSource;

    assert.match(
      source,
      /log\.info.*OpenCode extension activating/s,
      'must log activation start'
    );
  });

  test('includes version in activation log', () => {
    const source = extensionSource;

    assert.match(
      source,
      /activating.*version.*context\.extension\.packageJSON\.version/s,
      'must include extension version in activation log'
    );
  });

});

test.describe('Extension Activation - Service Storage', () => {

  test('stores services as module-level variables', () => {
    const source = extensionSource;

    assert.match(
      source,
      /let serverManager.*let sessionService.*let chatViewProvider/s,
      'must store services as module-level variables'
    );
  });

  test('declares services with let for mutability', () => {
    const source = extensionSource;

    assert.match(
      source,
      /let\s+serverManager|let\s+sessionService|let\s+chatViewProvider/s,
      'must use let for service declarations to allow reassignment'
    );
  });

});

test.describe('Extension Activation - Command Registration', () => {

  test('adds commands to context subscriptions', () => {
    const source = extensionSource;

    assert.match(
      source,
      /context\.subscriptions\.push\([\s\S]*registerCommand/s,
      'must add registered commands to context subscriptions'
    );
  });

  test('registers commands with opencode namespace', () => {
    const source = extensionSource;

    assert.match(
      source,
      /registerCommand\('opencode\./s,
      'must register commands with opencode namespace prefix'
    );
  });

});

test.describe('Extension Activation - Documentation', () => {

  test('documents service initialization order', () => {
    const source = extensionSource;

    assert.match(
      source,
      /Service Initialization Order.*important.*dependencies/s,
      'must document service initialization order'
    );
  });

  test('documents error handling strategy', () => {
    const source = extensionSource;

    assert.match(
      source,
      /Error Handling Strategy.*Logs.*degrades gracefully/s,
      'must document error handling strategy'
    );
  });

  test('documents command registration pattern', () => {
    const source = extensionSource;

    assert.match(
      source,
      /Command Registration Pattern.*context\.subscriptions/s,
      'must document command registration pattern'
    );
  });

  test('documents configuration settings', () => {
    const source = extensionSource;

    assert.match(
      source,
      /Configuration.*opencode\.serverPort|opencode\.autoStart/s,
      'must document VSCode settings used by extension'
    );
  });

});

test.describe('Extension Activation - Auto-Attach Feature', () => {

  test('has text editor selection change handler', () => {
    const source = extensionSource;

    assert.match(
      source,
      /onDidChangeTextEditorSelection/s,
      'must handle text editor selection changes'
    );
  });

  test('implements debouncing for selection changes', () => {
    const source = extensionSource;

    assert.match(
      source,
      /selectionChangeTimer.*NodeJS\.Timeout|debounce/s,
      'must implement debouncing to prevent excessive calls'
    );
  });

  test('clears existing timer on new selection', () => {
    const source = extensionSource;

    assert.match(
      source,
      /selectionChangeTimer.*clearTimeout/s,
      'must clear existing timer before setting new one'
    );
  });

});

test.describe('Extension Activation - Provider Dependencies', () => {

  test('ChatViewProvider receives server manager', () => {
    const source = extensionSource;

    assert.match(
      source,
      /new ChatViewProvider\(context,\s*serverManager/s,
      'must pass server manager to ChatViewProvider'
    );
  });

  test('ChatViewProvider receives session service', () => {
    const source = extensionSource;

    assert.match(
      source,
      /new ChatViewProvider\(context,\s*serverManager,\s*sessionService/s,
      'must pass session service to ChatViewProvider'
    );
  });

  test('ChatViewProvider receives model capabilities service', () => {
    const source = extensionSource;

    assert.match(
      source,
      /new ChatViewProvider\(context,\s*serverManager,\s*sessionService,\s*modelCapabilitiesService\)/s,
      'must pass model capabilities service to ChatViewProvider'
    );
  });

  test('SkillsPanelProvider receives extension URI', () => {
    const source = extensionSource;

    assert.match(
      source,
      /new SkillsPanelProvider\(context\.extensionUri/s,
      'must pass extension URI to SkillsPanelProvider'
    );
  });

  test('SkillsPanelProvider receives skill management service', () => {
    const source = extensionSource;

    assert.match(
      source,
      /new SkillsPanelProvider\(context\.extensionUri,\s*skillManagementService/s,
      'must pass skill management service to SkillsPanelProvider'
    );
  });

  test('SkillsPanelProvider receives server manager', () => {
    const source = extensionSource;

    assert.match(
      source,
      /new SkillsPanelProvider\(context\.extensionUri,\s*skillManagementService,\s*serverManager\)/s,
      'must pass server manager to SkillsPanelProvider'
    );
  });

});
