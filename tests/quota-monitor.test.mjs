import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const quotaServiceSource = readSource(
  [joinFromRoot('src', 'services', 'QuotaService.ts')],
  'QuotaService.ts',
);
const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);
const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('quota service refresh pipeline caches data and emits quotaUpdate events', () => {
  // Verify provider fetch chain emits quota data event for UI consumers.
  assert.match(quotaServiceSource, /export\s+class\s+QuotaService\s+extends\s+EventEmitter/, 'QuotaService should extend EventEmitter for update broadcasts');
  const refreshBody = extractFunctionBody(quotaServiceSource, 'public async refreshQuota(): Promise<QuotaData>');

  assert.match(refreshBody, /const\s+data:\s*QuotaData\s*=\s*\{[\s\S]*platforms,[\s\S]*lastUpdated:\s*Date\.now\(\)/, 'refreshQuota should construct normalized QuotaData payload');
  assert.match(refreshBody, /this\._cachedData\s*=\s*data;/, 'refreshQuota should cache latest quota data');
  assert.match(refreshBody, /this\.emit\("quotaUpdate",\s*data\)/, 'refreshQuota should emit quotaUpdate for subscribers');
});

test('chat provider forwards quota updates and initializes quota state on ready flow', () => {
  // Verify extension-to-webview quota bridge is wired for both live and initial data.
  assert.match(chatProviderSource, /this\.quotaService\.on\("quotaUpdate",\s*\(data\)\s*=>\s*\{[\s\S]*type:\s*"quotaData"/, 'ChatViewProvider should post quotaData on quotaUpdate events');
  assert.match(chatProviderSource, /const\s+quotaData\s*=\s*this\.quotaService\.cachedData;/, 'ready flow should inspect cached quota data');
  assert.match(chatProviderSource, /if\s*\(quotaData\)\s*\{[\s\S]*type:\s*"quotaData"/, 'ready flow should post cached quota data when available');
  assert.match(chatProviderSource, /else\s*\{[\s\S]*this\.quotaService\.refreshQuota\(\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/, 'ready flow should refresh quota when cache is empty');
});

test('message handler and quota panel consume and render quota update states', () => {
  // Verify inbound message reducer chain and right-panel rendering behavior.
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(handlerBody, /quotaData|quotaUpdate/, 'message handler should process quota messages');
  assert.match(handlerBody, /SET_QUOTA_DATA/, 'quota messages should dispatch SET_QUOTA_DATA');
  assert.match(quotaPanelBody, /refreshQuota/, 'quota panel should have refresh functionality');
  assert.match(quotaPanelBody, /Refresh quota/, 'quota panel should render refresh affordance label');
  assert.match(quotaPanelBody, /No quota data/, 'quota panel should show empty state text');
  assert.match(quotaPanelBody, /platform\.status/, 'quota panel should check provider status');
  assert.match(quotaPanelBody, /platforms/, 'quota panel should render provider cards');
});

test('quota monitor refresh button dispatches and posts refresh request', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(quotaPanelBody, /const\s+handleRefresh\s*=\s*\(\)\s*=>\s*\{/, 'quota monitor should define refresh handler');
  assert.match(quotaPanelBody, /SET_QUOTA_REFRESHING/, 'refresh handler should mark refresh state');
  assert.match(quotaPanelBody, /type:\s*["']refreshQuota["']/, 'refresh handler should request backend quota refresh');
  assert.match(quotaPanelBody, /title=\"Refresh quota\"/, 'refresh button should expose refresh title');
  assert.match(quotaPanelBody, />\s*Refresh\s*</, 'refresh button should show visible Refresh label');
});

test('quota monitor supports collapsible UI with state management', () => {
  // Verify quota monitor can be collapsed to save vertical space and preserve user preference.
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(quotaPanelBody, /useState\(true\)/, 'quota monitor should manage open/closed state with useState');
  assert.match(quotaPanelBody, /Collapse\s+Quota\s+Monitor/, 'quota monitor toggle should have accessible label');
  assert.match(quotaPanelBody, /setOpen\(/, 'quota monitor toggle should call setOpen');
  assert.match(quotaPanelBody, /<ChevronDown/, 'quota monitor should show chevron indicator');
  assert.match(quotaPanelBody, /{\s*open\s*\?\s*\(/, 'quota monitor content should be conditionally rendered');
});

test('quota monitor sorts platforms alphabetically to maintain consistent order', () => {
  // Verify provider cards maintain consistent ordering across refreshes.
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(quotaPanelBody, /\.\.\.quotaData\.platforms\]/, 'quota monitor should copy platforms array before sorting');
  assert.match(quotaPanelBody, /\.sort\(/, 'quota monitor should sort platforms');
  assert.match(quotaPanelBody, /localeCompare/, 'quota monitor should use localeCompare for sorting');
  assert.match(quotaPanelBody, /\.map\(\(platform\)/, 'quota monitor should map over sorted platforms');
});

test('quota monitor omits OK badge for healthy providers to reduce visual clutter', () => {
  // Verify only error and warning badges are rendered for unhealthy providers.
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(quotaPanelBody, /platform\.status\s*===\s*["']error["']/, 'quota panel should check for error status');
  assert.match(quotaPanelBody, /variant=["']destructive["'][^>]*>\s*error\s*</, 'quota panel should render error badge for error status');
  assert.match(quotaPanelBody, /platform\.status\s*===\s*["']warning["']/, 'quota panel should check for warning status');
  assert.match(quotaPanelBody, /variant=["']warning["'][^>]*>\s*warning\s*</, 'quota panel should render warning badge for warning status');
  assert.match(quotaPanelBody, /\)\s*:\s*null\}/, 'quota panel should render null for healthy status instead of badge');
  
  // Verify the status check structure has null for the else branch (OK status)
  const statusCheckMatch = quotaPanelBody.match(/platform\.status\s*===\s*["']error["'][^}]*\)\s*:\s*null\}/);
  assert.ok(statusCheckMatch, 'quota panel should not render a badge for OK status');
});
test('quota monitor renders budget info section when budgetInfo exists', () => {
  // Verify budget data integration and conditional rendering.
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(quotaPanelBody, /budgetInfo\s*\?\s*/, 'quota monitor should conditionally render budget section when budgetInfo exists');
  assert.match(quotaPanelBody, /Daily Budget/, 'quota monitor should show redesigned budget header');
  assert.match(quotaPanelBody, /budgetInfo\.usedToday[\s\S]*budgetInfo\.dailyAllowance/, 'quota monitor should show daily usage stats');
});

test('quota monitor renders budget bar with reactive scaling', () => {
  // Verify the progress bar logic for the budget monitor.
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(quotaPanelBody, /Math\.min\(100,\s*\(budgetInfo\.usedToday\s*\/\s*budgetInfo\.dailyAllowance\)\s*\*\s*100\)/, 'budget bar should clamp width at 100%');
  assert.match(quotaPanelBody, /barColor\(\s*budgetInfo\.dailyAllowance\s*>\s*0[\s\S]*budgetInfo\.remainingToday\s*\/\s*budgetInfo\.dailyAllowance/, 'budget bar should use barColor utility with remaining percentage');
});

test('quota monitor shows actionable advice items from budget payload', () => {
  // Verify rendering of the first advice item in budget section.
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(quotaPanelBody, /budgetInfo\.advice\s*&&\s*budgetInfo\.advice\.length\s*>\s*0/, 'quota monitor should check for advice presence');
  assert.match(quotaPanelBody, /\{budgetInfo\.advice\[0\]/, 'quota monitor should render the first advice item');
});
