/**
 * QuotaMonitor Component Tests
 *
 * Tests for QuotaMonitor component:
 * - Refresh functionality
 * - Collapsible UI
 * - Platform display and sorting
 * - Status badges
 * - Budget info rendering
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('QuotaMonitor has refresh handler', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /const\s+handleRefresh\s*=\s*\(\)\s*=>\s*\{/,
    'Should define handleRefresh'
  );
});

test('QuotaMonitor refresh sets refreshing state', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /SET_QUOTA_REFRESHING/,
    'Should dispatch SET_QUOTA_REFRESHING'
  );
});

test('QuotaMonitor refresh requests backend refresh', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /type:\s*["']refreshQuota["']/,
    'Should post refreshQuota message'
  );
});

test('QuotaMonitor has refresh button', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /title=\"Refresh quota\"/,
    'Should have refresh button with title'
  );
  assert.match(
    quotaPanelBody,
    />\s*Refresh\s*</,
    'Should show Refresh label'
  );
});

test('QuotaMonitor manages collapsible state', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /useState\(true\)/,
    'Should manage open/closed state'
  );
});

test('QuotaMonitor has accessible collapse toggle', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /Collapse\s+Quota\s+Monitor/,
    'Should have accessible label'
  );
  assert.match(
    quotaPanelBody,
    /setOpen\(/,
    'Should call setOpen'
  );
});

test('QuotaMonitor shows chevron indicator', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /<ChevronDown/,
    'Should render chevron'
  );
});

test('QuotaMonitor conditionally renders content', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /{\s*open\s*\?\s*\(/,
    'Should conditionally render content'
  );
});

test('QuotaMonitor copies platforms before sorting', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /\.\.\.quotaData\.platforms\]/,
    'Should copy platforms array'
  );
});

test('QuotaMonitor sorts platforms alphabetically', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /\.sort\(/,
    'Should sort platforms'
  );
  assert.match(
    quotaPanelBody,
    /localeCompare/,
    'Should use localeCompare'
  );
});

test('QuotaMonitor renders provider cards', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /\.map\(\(platform\)/,
    'Should map over platforms'
  );
  assert.match(
    quotaPanelBody,
    /platform\.status/,
    'Should check platform status'
  );
});

test('QuotaMonitor renders error badge for error status', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /platform\.status\s*===\s*["']error["']/,
    'Should check for error status'
  );
  assert.match(
    quotaPanelBody,
    /variant=["']error["'][^>]*>\s*error\s*</,
    'Should render error badge'
  );
});

test('QuotaMonitor renders warning badge for warning status', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /platform\.status\s*===\s*["']warning["']/,
    'Should check for warning status'
  );
  assert.match(
    quotaPanelBody,
    /variant=["']warning["'][^>]*>\s*warning\s*</,
    'Should render warning badge'
  );
});

test('QuotaMonitor omits badge for OK status', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /\)\s*:\s*null\}/,
    'Should not render badge for OK status'
  );
});

test('QuotaMonitor shows empty state', () => {
  const quotaPanelBody = extractFunctionBody(panelSource, 'export function QuotaMonitor()');

  assert.match(
    quotaPanelBody,
    /No quota data/,
    'Should show empty state text'
  );
});
