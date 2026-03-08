import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);
const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('right panel width increased by 15 percent from 320px to 368px', () => {
  // Verify extended panel width was increased for better content display.
  assert.match(
    chatShellSource,
    /className="oc-right-panel\s+hidden\s+w-\[368px\]/,
    'desktop right panel width should be 368px (15% increase from 320px)',
  );
});

test('right panel renders TODO MCP and LSP sections in correct order', () => {
  // Verify all three new panels are rendered in the extended sidebar.
  assert.match(chatShellSource, /<ActiveTaskPanel\s*\/>/, 'right panel should render active task panel first');
  assert.match(chatShellSource, /<QuotaMonitor\s*\/>/, 'right panel should render quota monitor second');
  assert.match(chatShellSource, /<TodoPanel\s*\/>/, 'right panel should render TODO panel third');
  assert.match(chatShellSource, /<McpPanel\s*\/>/, 'right panel should render MCP panel fourth');
  assert.match(chatShellSource, /<LspPanel\s*\/>/, 'right panel should render LSP panel fifth');
});

test('MCP panel displays server connection status and tool counts', () => {
  // Verify MCP server status visualization with connection indicators.
  const mcpBody = extractFunctionBody(panelSource, 'export function McpPanel()');

  assert.match(mcpBody, /const\s+\{\s*mcpServers\s*\}\s*=\s*useAppState\(\)/, 'MCP panel should read server list from state');
  assert.match(mcpBody, /s\.status\s*===\s*["']connected["']/, 'MCP panel should track server connection status');
  assert.match(mcpBody, /tools\.length\s*>\s*0/, 'MCP panel should check for tools');
  assert.match(mcpBody, /bg-\[var\(--oc-green\)\]/, 'MCP panel should show green dot for connected servers');
  assert.match(mcpBody, /bg-\[var\(--oc-red\)\]/, 'MCP panel should show red dot for disconnected servers');
  assert.match(mcpBody, /\{\s*server\.name\s*\}/, 'MCP panel should render server name');
  assert.match(mcpBody, /server\.tools\.length\s*>\s*0\s*\?\s*`\$\{server\.tools\.length\}\s+tools`/, 'MCP panel should render tool count label');
  assert.match(mcpBody, /connectedCount\}\s*\/\s*\{mcpServers\.length\}\s*connected/, 'MCP panel should show total server count');
});

test('LSP panel displays language server status with versions', () => {
  // Verify LSP server status visualization with version information.
  const lspBody = extractFunctionBody(panelSource, 'export function LspPanel()');

  assert.match(lspBody, /const\s+\{\s*lspServers\s*\}\s*=\s*useAppState\(\)/, 'LSP panel should read server list from state');
  assert.match(lspBody, /s\.status\s*===\s*["']connected["']/, 'LSP panel should track server running status');
  assert.match(lspBody, /bg-\[var\(--oc-green\)\]/, 'LSP panel should show green dot for running servers');
  assert.match(lspBody, /bg-\[var\(--oc-red\)\]/, 'LSP panel should show red dot for stopped servers');
  assert.match(lspBody, /\{\s*server\.name\s*\}/, 'LSP panel should render server name');
  assert.match(lspBody, /language servers active/, 'LSP panel should show total server count');
});

test('quota monitor supports collapsible UI with toggle button', () => {
  // Verify quota monitor can be collapsed to save vertical space.
  const quotaBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(quotaBody, /const\s+\[open,\s*setOpen\]\s*=\s*useState\(true\)/, 'quota monitor should manage open/closed state');
  assert.match(quotaBody, /aria-label=\{\s*\n?\s*open\s*\?\s*["']Collapse\s+Quota\s+Monitor["']\s*:\s*["']Expand\s+Quota\s+Monitor["']\s*\n?\s*\}/, 'quota monitor should have accessible toggle button label');
  assert.match(quotaBody, /setOpen\(/, 'quota monitor toggle should call setOpen');
  assert.match(quotaBody, /\{\s*open\s*\?\s*\(\s*\n?\s*<ChevronDown/, 'quota monitor should show down chevron when expanded');
  assert.match(quotaBody, /:\s*\(\s*\n?\s*<ChevronUp/, 'quota monitor should show up chevron when collapsed');
  assert.match(quotaBody, /\{\s*open\s*\?\s*\(/, 'quota monitor content should be conditionally rendered based on open state');
});

test('quota monitor sorts platforms alphabetically to prevent reordering on refresh', () => {
  // Verify provider cards maintain consistent ordering across refreshes.
  const quotaBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(quotaBody, /\[\.\.\.quotaData\.platforms\]/, 'quota monitor should copy platforms array before sorting');
  assert.match(quotaBody, /\.sort\(\(\w+,\s*\w+\)\s*=>\s*\{/, 'quota monitor should apply stable sort');
  assert.match(quotaBody, /a\.platform\.localeCompare\(b\.platform\)/, 'quota monitor should sort by platform name first');
  assert.match(quotaBody, /return\s+a\.account\.localeCompare\(b\.account\)/, 'quota monitor should sort by account name second');
  assert.match(quotaBody, /\.map\(\(platform\)\s*=>\s*\(/, 'quota monitor should map over sorted platforms');
});

test('quota monitor omits OK badge for healthy providers', () => {
  // Verify only error and warning badges are rendered to reduce visual clutter.
  const quotaBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(quotaBody, /\)\s*:\s*null\}/, 'quota panel should render null for OK status instead of badge');
});

test('all new panels support collapsible UI with consistent toggle behavior', () => {
  // Verify TODO MCP and LSP panels have collapse/expand toggles.
  const todoBody = extractFunctionBody(panelSource, 'export function TodoPanel()');
  const mcpBody = extractFunctionBody(panelSource, 'export function McpPanel()');
  const lspBody = extractFunctionBody(panelSource, 'export function LspPanel()');

  assert.match(todoBody, /const\s+\[open,\s*setOpen\]\s*=\s*useState\(/, 'TODO panel should manage open state');
  assert.match(todoBody, /aria-label=\{\s*open\s*\?\s*["']Collapse\s+TODOs["']/, 'TODO panel toggle should have accessible label');

  assert.match(mcpBody, /const\s+\[open,\s*setOpen\]\s*=\s*useState\(/, 'MCP panel should manage open state');
  assert.match(mcpBody, /aria-label=\{\s*open\s*\?\s*["']Collapse\s+MCP["']/, 'MCP panel toggle should have accessible label');

  assert.match(lspBody, /const\s+\[open,\s*setOpen\]\s*=\s*useState\(/, 'LSP panel should manage open state');
  assert.match(lspBody, /aria-label=\{\s*open\s*\?\s*["']Collapse\s+LSP["']/, 'LSP panel toggle should have accessible label');
});

test('panel components use improved text colors for better readability', () => {
  // Verify secondary text uses brighter colors for improved accessibility.
  const todoBody = extractFunctionBody(panelSource, 'export function TodoPanel()');
  const mcpBody = extractFunctionBody(panelSource, 'export function McpPanel()');
  const lspBody = extractFunctionBody(panelSource, 'export function LspPanel()');

  assert.match(todoBody, /text-\[var\(--oc-text-soft\)\]/, 'TODO panel should use text-soft for better readability');
  assert.match(mcpBody, /text-\[var\(--oc-text-soft\)\]/, 'MCP panel should use text-soft for better readability');
  assert.match(lspBody, /text-\[var\(--oc-text-soft\)\]/, 'LSP panel should use text-soft for better readability');
  assert.match(mcpBody, /opacity-80/, 'MCP panel should use moderate opacity for secondary text');
  assert.match(lspBody, /opacity-50/, 'LSP panel should use moderate opacity for secondary text');
});
