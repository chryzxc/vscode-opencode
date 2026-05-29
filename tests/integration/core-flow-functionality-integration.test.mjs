/**
 * Core Flow Integration Tests - Actual Implementation Patterns
 *
 * Tests that follow the real implementation patterns and flows in the codebase:
 *   - Extension activation and service initialization
 *   - Command execution flows
 *   - Context management flows
 *   - Session management flows
 *   - WebView communication flows
 *   - Real user journey scenarios
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSource,
  joinFromRoot,
} from '../helpers/source-utils.mjs';

// Read the actual implementation files
const extensionSource = readSource(
  [joinFromRoot('src', 'extension.ts')],
  'extension.ts',
);

const chatViewProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

const sessionServiceSource = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);

const opencodeServerManagerSource = readSource(
  [joinFromRoot('src', 'services', 'OpencodeServerManager.ts')],
  'OpencodeServerManager.ts',
);

const statusbarProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'StatusBarProvider.ts')],
  'StatusBarProvider.ts',
);

// ---------------------------------------------------------------------------
// Extension Activation Flow
// ---------------------------------------------------------------------------

test('Extension activation: Service initialization in correct order', () => {
  // Phase 1: Core Services initialization
  assert.match(
    extensionSource,
    /OpencodeServerManager.*new|new.*OpencodeServerManager/i,
    'Step 1: OpencodeServerManager initialized first',
  );

  assert.match(
    extensionSource,
    /SessionService.*new|new.*SessionService/i,
    'Step 2: SessionService initialized after OpencodeServerManager',
  );

  assert.match(
    extensionSource,
    /StatusBarProvider.*new|new.*StatusBarProvider/i,
    'Step 3: StatusBarProvider initialized after SessionService',
  );

  assert.match(
    extensionSource,
    /SkillManagementService.*new|new.*SkillManagementService/i,
    'Step 4: SkillManagementService initialized',
  );
});

test('Extension activation: WebView provider registration', () => {
  // Phase 2: WebView provider registration
  assert.match(
    extensionSource,
    /ModelCapabilitiesService|ChatViewProvider|SkillsPanelProvider/i,
    'WebView providers are initialized',
  );

  assert.match(
    extensionSource,
    /registerWebviewViewProvider/i,
    'WebView providers are registered with VSCode',
  );
});

test('Extension activation: Status change subscription setup', () => {
  assert.match(
    extensionSource,
    /onStatusChange|status.*change/i,
    'Must subscribe to server status changes',
  );

  assert.match(
    extensionSource,
    /updateStatus|statusBar.*update/i,
    'StatusBarProvider must update on status change',
  );
});

test('Extension activation: Command registration', () => {
  // Phase 3: Command registration
  assert.match(
    extensionSource,
    /registerCommand/i,
    'Commands are registered with VSCode',
  );

  assert.match(
    extensionSource,
    /opencode\.(focus|newSession|sendSelection|showPlan)/i,
    'Core opencode commands are registered',
  );
});

// ---------------------------------------------------------------------------
// Auto-Attach Highlighted Text Flow
// ---------------------------------------------------------------------------

test('Auto-attach flow: Debounced selection change handling', () => {
  // Auto-attach feature with debouncing
  assert.match(
    extensionSource,
    /onDidChangeTextEditorSelection/i,
    'Must listen to selection changes',
  );

  assert.match(
    extensionSource,
    /setTimeout|debounce|150/i,
    'Must debounce selection changes (150ms)',
  );

  assert.match(
    extensionSource,
    /clearAutoContext|clear.*auto/i,
    'Must clear auto context on empty selection',
  );
});

test('Auto-attach flow: Context extraction and sending', () => {
  assert.match(
    extensionSource,
    /getText|selection|content/i,
    'Must extract selected text',
  );

  assert.match(
    extensionSource,
    /asRelativePath|fileName|file/i,
    'Must extract file path',
  );

  assert.match(
    extensionSource,
    /lineInfo|start.*line|end.*line/i,
    'Must extract line information',
  );

  assert.match(
    extensionSource,
    /languageId|language/i,
    'Must extract language ID',
  );
});

test('Auto-attach flow: AutoAddContext invocation', () => {
  assert.match(
    extensionSource,
    /autoAddContext|auto.*add/i,
    'Must call autoAddContext on ChatViewProvider',
  );

  assert.match(
    chatViewProviderSource,
    /autoAddContext|auto.*context/i,
    'ChatViewProvider must implement autoAddContext method',
  );

  assert.match(
    chatViewProviderSource,
    /postMessage|addContext/i,
    'Must send addContext message to webview',
  );

  assert.match(
    chatViewProviderSource,
    /isAuto.*true|auto.*true/i,
    'Must mark context as automatic',
  );
});

test('Auto-attach flow: ClearAutoContext on empty selection', () => {
  assert.match(
    extensionSource,
    /selection.*isEmpty|!selection/i,
    'Must check for empty selection',
  );

  assert.match(
    extensionSource,
    /clearAutoContext/i,
    'Must call clearAutoContext for empty selection',
  );

  assert.match(
    chatViewProviderSource,
    /clearAutoContext/i,
    'ChatViewProvider must implement clearAutoContext method',
  );

  assert.match(
    chatViewProviderSource,
    /postMessage|clearAutoContext/i,
    'Must send clearAutoContext message to webview',
  );
});

// ---------------------------------------------------------------------------
// Command Execution Flows
// ---------------------------------------------------------------------------

test('Command flow: opencode.focus execution', () => {
  assert.match(
    extensionSource,
    /opencode\.focus|focus.*command/i,
    'Must register opencode.focus command',
  );

  assert.match(
    extensionSource,
    /executeCommand.*chatView\.focus/i,
    'Must execute chatView.focus command',
  );
});

test('Command flow: opencode.newSession execution', () => {
  assert.match(
    extensionSource,
    /opencode\.newSession|newSession.*command/i,
    'Must register opencode.newSession command',
  );

  assert.match(
    extensionSource,
    /createNewSession|sessionService.*create/i,
    'Must call createNewSession on SessionService',
  );

  assert.match(
    extensionSource,
    /executeCommand.*focus/i,
    'Must focus chat view after session creation',
  );
});

test('Command flow: opencode.sendSelection with selection', () => {
  assert.match(
    extensionSource,
    /opencode\.sendSelection|sendSelection.*command/i,
    'Must register opencode.sendSelection command',
  );

  assert.match(
    extensionSource,
    /activeTextEditor|editor/i,
    'Must get active text editor',
  );

  assert.match(
    extensionSource,
    /getText.*selection|document\.getText/i,
    'Must extract selected text',
  );

  assert.match(
    extensionSource,
    /addContext|chatViewProvider\.add/i,
    'Must call addContext on ChatViewProvider',
  );

  assert.match(
    extensionSource,
    /executeCommand.*focus/i,
    'Must focus chat view after adding context',
  );
});

test('Command flow: opencode.sendSelection without selection (current line)', () => {
  assert.match(
    extensionSource,
    /selection.*isEmpty|!selection/i,
    'Must check if selection is empty',
  );

  assert.match(
    extensionSource,
    /lineAt|line\.text|current.*line/i,
    'Must get current line if no selection',
  );

  assert.match(
    extensionSource,
    /addContext/i,
    'Must add current line as context',
  );
});

test('Command flow: opencode.showPlan execution', () => {
  assert.match(
    extensionSource,
    /opencode\.showPlan|showPlan.*command/i,
    'Must register opencode.showPlan command',
  );

  assert.match(
    extensionSource,
    /PlanViewProvider\.show|show.*plan/i,
    'Must call PlanViewProvider.show()',
  );

  assert.match(
    extensionSource,
    /payload.*content|title|sourceFile/i,
    'Must handle plan payload with content, title, and source file',
  );
});

// ---------------------------------------------------------------------------
// Context Management Flows
// ---------------------------------------------------------------------------

test('Context flow: addContext sends message to webview', () => {
  assert.match(
    chatViewProviderSource,
    /addContext/i,
    'ChatViewProvider must implement addContext method',
  );

  assert.match(
    chatViewProviderSource,
    /postMessage|addContext/i,
    'Must send addContext message to webview',
  );

  assert.match(
    chatViewProviderSource,
    /context.*parameter|context\:/i,
    'Must pass context parameter in message',
  );
});

test('Context flow: autoAddContext marks context as automatic', () => {
  assert.match(
    chatViewProviderSource,
    /autoAddContext/i,
    'ChatViewProvider must implement autoAddContext method',
  );

  assert.match(
    chatViewProviderSource,
    /isAuto.*true|auto.*true/i,
    'Must mark context with isAuto: true',
  );

  assert.match(
    chatViewProviderSource,
    /\.\.\.context.*isAuto|context.*\{.*isAuto/i,
    'Must spread context and add isAuto property',
  );
});

test('Context flow: clearAutoContext removes automatic context', () => {
  assert.match(
    chatViewProviderSource,
    /clearAutoContext/i,
    'ChatViewProvider must implement clearAutoContext method',
  );

  assert.match(
    chatViewProviderSource,
    /postMessage|clearAutoContext/i,
    'Must send clearAutoContext message to webview',
  );
});

// ---------------------------------------------------------------------------
// Session Management Flows
// ---------------------------------------------------------------------------

test('Session flow: createNewSession server interaction', () => {
  assert.match(
    sessionServiceSource,
    /createNewSession/i,
    'SessionService must implement createNewSession method',
  );

  assert.match(
    sessionServiceSource,
    /ensureRunning|serverManager/i,
    'Must ensure server is running',
  );

  assert.match(
    sessionServiceSource,
    /client\.session\.create|session\.create/i,
    'Must call session.create on server client',
  );

  assert.match(
    sessionServiceSource,
    /title.*body|body.*title/i,
    'Must pass title in request body',
  );

  assert.match(
    sessionServiceSource,
    /response\.data|data.*session/i,
    'Must check for response data',
  );

  assert.match(
    sessionServiceSource,
    /throw.*error|Error.*create/i,
    'Must throw error if session creation fails',
  );
});

test('Session flow: createNewSession error handling', () => {
  assert.match(
    sessionServiceSource,
    /response\.error|error.*details/i,
    'Must check for response error',
  );

  assert.match(
    sessionServiceSource,
    /JSON\.stringify.*error/i,
    'Must log error details',
  );

  assert.match(
    sessionServiceSource,
    /message.*errors|errors\[0\]/i,
    'Must extract error message from response',
  );

  assert.match(
    sessionServiceSource,
    /log\.error.*Failed.*create/i,
    'Must log session creation failure',
  );

  assert.match(
    sessionServiceSource,
    /endFeatureFlow.*failed/i,
    'Must end feature flow with failed status',
  );
});

test('Session flow: Server manager ensures running state', () => {
  assert.match(
    opencodeServerManagerSource,
    /ensureRunning/i,
    'OpencodeServerManager must implement ensureRunning method',
  );

  assert.match(
    opencodeServerManagerSource,
    /setStatus.*starting|starting/i,
    'Must set status to starting before ensuring running',
  );

  assert.match(
    opencodeServerManagerSource,
    /client.*ready|running.*status/i,
    'Must return ready client or start server',
  );

  assert.match(
    opencodeServerManagerSource,
    /startServer|spawn.*serve/i,
    'Must start server process if not running',
  );
});

test('Session flow: Status change subscription and notification', () => {
  assert.match(
    opencodeServerManagerSource,
    /onStatusChange/i,
    'OpencodeServerManager must provide onStatusChange method',
  );

  assert.match(
    statusbarProviderSource,
    /updateStatus/i,
    'StatusBarProvider must implement updateStatus method',
  );

  assert.match(
    extensionSource,
    /subscriptions.*push|onStatusChange|subscribe/i,
    'Extension must subscribe to status changes',
  );

  assert.match(
    extensionSource,
    /statusBarProvider\.updateStatus/i,
    'Must call updateStatus on status change',
  );
});

// ---------------------------------------------------------------------------
// Real User Journey Flows
// ---------------------------------------------------------------------------

test('User journey: Complete auto-attach context flow', () => {
  // Step 1: User selects text in editor
  assert.match(
    extensionSource,
    /onDidChangeTextEditorSelection/i,
    'Step 1: Selection change is detected',
  );

  // Step 2: Debounce timer is set
  assert.match(
    extensionSource,
    /setTimeout|150|debounce/i,
    'Step 2: 150ms debounce timer is set',
  );

  // Step 3: Selection is extracted
  assert.match(
    extensionSource,
    /getText.*selection|editor\.document/i,
    'Step 3: Selected text is extracted',
  );

  // Step 4: File metadata is extracted
  assert.match(
    extensionSource,
    /asRelativePath|fileName|startLine|endLine/i,
    'Step 4: File metadata is extracted',
  );

  // Step 5: Context is sent to webview
  assert.match(
    extensionSource,
    /autoAddContext/i,
    'Step 5: autoAddContext is called',
  );

  // Step 6: Webview receives addContext message
  assert.match(
    chatViewProviderSource,
    /postMessage|addContext/i,
    'Step 6: addContext message sent to webview',
  );
});

test('User journey: Complete new session creation flow', () => {
  // Step 1: User executes newSession command
  assert.match(
    extensionSource,
    /registerCommand.*newSession/i,
    'Step 1: newSession command is registered',
  );

  // Step 2: Command handler calls createNewSession
  assert.match(
    extensionSource,
    /sessionService\.createNewSession/i,
    'Step 2: createNewSession is called on SessionService',
  );

  // Step 3: Server is ensured running
  assert.match(
    sessionServiceSource,
    /ensureRunning/i,
    'Step 3: Server is ensured running',
  );

  // Step 4: Session is created via server
  assert.match(
    sessionServiceSource,
    /client\.session\.create/i,
    'Step 4: Session is created via server client',
  );

  // Step 5: Response is validated
  assert.match(
    sessionServiceSource,
    /response\.data/i,
    'Step 5: Response data is validated',
  );

  // Step 6: Chat view is focused
  assert.match(
    extensionSource,
    /executeCommand.*chatView\.focus/i,
    'Step 6: Chat view is focused',
  );
});

test('User journey: Complete send selection flow', () => {
  // Step 1: User executes sendSelection command
  assert.match(
    extensionSource,
    /registerCommand.*sendSelection/i,
    'Step 1: sendSelection command is registered',
  );

  // Step 2: Active editor is obtained
  assert.match(
    extensionSource,
    /activeTextEditor/i,
    'Step 2: Active text editor is obtained',
  );

  // Step 3: Selection or current line is extracted
  assert.match(
    extensionSource,
    /getText.*selection|lineAt/i,
    'Step 3: Selection or current line is extracted',
  );

  // Step 4: Context is added to chat
  assert.match(
    extensionSource,
    /addContext/i,
    'Step 4: addContext is called on ChatViewProvider',
  );

  // Step 5: Chat view is focused
  assert.match(
    extensionSource,
    /executeCommand.*chatView\.focus/i,
    'Step 5: Chat view is focused',
  );
});

test('User journey: Complete plan viewing flow', () => {
  // Step 1: Plan is generated and detected
  assert.match(
    extensionSource,
    /showPlan/i,
    'Step 1: showPlan command is registered',
  );

  // Step 2: Plan payload is received
  assert.match(
    extensionSource,
    /payload.*content|content.*string/i,
    'Step 2: Plan payload content is extracted',
  );

  // Step 3: PlanViewProvider.show is called
  assert.match(
    extensionSource,
    /PlanViewProvider\.show/i,
    'Step 3: PlanViewProvider.show is called',
  );

  // Step 4: Plan is rendered in webview
  assert.match(
    extensionSource,
    /PlanViewProvider/i,
    'Step 4: Plan is rendered in dedicated panel',
  );
});

// ---------------------------------------------------------------------------
// Error Handling Flows
// ---------------------------------------------------------------------------

test('Error flow: No active editor warning', () => {
  assert.match(
    extensionSource,
    /activeEditor|activeTextEditor|editor/i,
    'Must check for active editor',
  );

  assert.match(
    extensionSource,
    /showWarningMessage.*No.*active.*editor|showWarningMessage/i,
    'Must show warning if no active editor',
  );
});

test('Error flow: Empty selection warning', () => {
  assert.match(
    extensionSource,
    /!selection.*trim.*length|selection.*trim.*===.*0/i,
    'Must check if selection is empty',
  );

  assert.match(
    extensionSource,
    /showWarningMessage.*No text to send/i,
    'Must show warning if selection is empty',
  );
});

test('Error flow: Session creation error handling', () => {
  assert.match(
    sessionServiceSource,
    /!response\.data|response\.error/i,
    'Must check for failed session creation',
  );

  assert.match(
    sessionServiceSource,
    /throw.*Error.*Failed.*create/i,
    'Must throw error with descriptive message',
  );

  assert.match(
    sessionServiceSource,
    /log\.error/i,
    'Must log session creation failure',
  );
});

// ---------------------------------------------------------------------------
// Service Dependencies and Integration
// ---------------------------------------------------------------------------

test('Service integration: ChatViewProvider depends on serverManager and sessionService', () => {
  assert.match(
    extensionSource,
    /ChatViewProvider.*serverManager|ChatViewProvider.*sessionService/i,
    'ChatViewProvider must receive serverManager and sessionService',
  );

  assert.match(
    chatViewProviderSource,
    /serverManager|sessionService/i,
    'ChatViewProvider constructor must accept serverManager and sessionService',
  );
});

test('Service integration: SessionService depends on serverManager', () => {
  assert.match(
    extensionSource,
    /SessionService.*serverManager/i,
    'SessionService must receive serverManager',
  );

  assert.match(
    sessionServiceSource,
    /serverManager/i,
    'SessionService constructor must accept serverManager',
  );

  assert.match(
    sessionServiceSource,
    /serverManager\.ensureRunning/i,
    'SessionService must call serverManager.ensureRunning',
  );
});

test('Service integration: StatusBarProvider depends on serverManager', () => {
  assert.match(
    extensionSource,
    /StatusBarProvider.*new|new.*StatusBarProvider/i,
    'StatusBarProvider must receive serverManager',
  );

  assert.match(
    statusbarProviderSource,
    /serverManager/i,
    'StatusBarProvider constructor must accept serverManager',
  );

  assert.match(
    extensionSource,
    /onStatusChange.*statusBar|statusBar.*updateStatus|updateStatus/i,
    'StatusBarProvider must update on server status changes',
  );
});

test('Service integration: SkillManagementService initialization', () => {
  assert.match(
    extensionSource,
    /SkillManagementService.*new/i,
    'SkillManagementService must be instantiated',
  );

  assert.match(
    extensionSource,
    /initialize.*catch/i,
    'SkillManagementService.initialize must be called with error handling',
  );

  assert.match(
    extensionSource,
    /Failed.*initialize.*skill/i,
    'Must log skill management initialization failures',
  );
});