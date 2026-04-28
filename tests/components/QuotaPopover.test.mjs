/**
 * QuotaPopover Component Tests
 *
 * Tests for QuotaPopover component:
 * - Component structure and exports
 * - State management integration
 * - Click-outside-to-close behavior
 * - Escape key handling
 * - GitHub Copilot budget display
 * - Platform quota display
 * - Empty states
 * - Icon usage
 * - Spacing and layout
 * - Data formatting
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const quotaPopoverSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'QuotaPopover.tsx')],
  'QuotaPopover.tsx',
);

// Component Structure Tests
test('QuotaPopover is exported', () => {
  assert.match(
    quotaPopoverSource,
    /export\s+function\s+QuotaPopover\(\)/,
    'QuotaPopover should be exported'
  );
});

test('QuotaPopover uses app state', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /useAppState\(\)/,
    'Should use app state'
  );
  assert.match(
    popoverBody,
    /quotaData/,
    'Should access quotaData'
  );
  assert.match(
    popoverBody,
    /isQuotaPopoverOpen/,
    'Should access popover state'
  );
});

test('QuotaPopover uses app dispatch', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /useAppDispatch\(\)/,
    'Should use app dispatch'
  );
  assert.match(
    popoverBody,
    /dispatch\(/,
    'Should dispatch actions'
  );
});

test('QuotaPopover has ref for container', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /useRef<HTMLDivElement>\([^)]*\)/,
    'Should use useRef for popover container'
  );
  assert.match(
    popoverBody,
    /popoverRef/,
    'Should have popoverRef variable'
  );
});

// Conditional Rendering Tests
test('QuotaPopover returns null when closed', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /if\s*\(!isQuotaPopoverOpen\)\s*\{[\s\S]*return\s+null/,
    'Should return null when popover is closed'
  );
});

test('QuotaPopover renders overlay when open', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /quota-popover-overlay/,
    'Should render overlay container'
  );
  assert.match(
    popoverBody,
    /quota-popover/,
    'Should render popover container'
  );
});

// Click Outside Tests
test('QuotaPopover implements click-outside handler', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /handleClickOutside/,
    'Should define click outside handler'
  );
  assert.match(
    popoverBody,
    /addEventListener\(['"]mousedown['"]/,
    'Should add mousedown event listener'
  );
});

test('QuotaPopover checks if click is outside popover', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /popoverRef\.current\s*&&\s*!popoverRef\.current\.contains/,
    'Should check if click is outside popover ref'
  );
});

test('QuotaPopover ignores clicks on quota button', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /\.closest\(['"]\.oc-quota-btn['"]\)/,
    'Should ignore clicks on quota button'
  );
});

test('QuotaPopover closes popover on outside click', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /dispatch\(\{\s*type:\s*["']SET_QUOTA_POPOVER_OPEN["'],\s*payload:\s*false\s*\}\)/,
    'Should dispatch close action'
  );
});

// Escape Key Tests
test('QuotaPopover implements escape key handler', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /handleEscape/,
    'Should define escape key handler'
  );
  assert.match(
    popoverBody,
    /addEventListener\(['"]keydown['"]/,
    'Should add keydown event listener'
  );
});

test('QuotaPopover closes on escape key', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /event\.key\s*===\s*['"]Escape['"]/,
    'Should check for Escape key'
  );
  assert.match(
    popoverBody,
    /dispatch\(\{\s*type:\s*["']SET_QUOTA_POPOVER_OPEN["'],\s*payload:\s*false\s*\}\)/,
    'Should dispatch close action'
  );
});

// Cleanup Tests
test('QuotaPopover cleans up event listeners', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /return\s*\(\)\s*=>\s*\{[\s\S]*removeEventListener\(['"]mousedown['"]/,
    'Should remove mousedown listener'
  );
  assert.match(
    popoverBody,
    /removeEventListener\(['"]keydown['"]/,
    'Should remove keydown listener'
  );
});

test('QuotaPopover only adds listeners when open', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /if\s*\(isQuotaPopoverOpen\)\s*\{/,
    'Should conditionally add listeners'
  );
});

// Header Tests
test('QuotaPopover renders header with title', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /Quota Status/,
    'Should show popover title'
  );
  assert.match(
    popoverBody,
    /px-3\s+py-2\.5/,
    'Should use proper header padding'
  );
});

test('QuotaPopover renders close button', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /<X\s+size=\{14\}\s*\/>/,
    'Should render X icon'
  );
  assert.match(
    popoverBody,
    /onClick=\{\(\)\s*=>\s*dispatch/,
    'Should have onClick handler'
  );
  assert.match(
    popoverBody,
    /aria-label=["']Close popover["']/,
    'Should have accessibility label'
  );
});

// Platform Display Tests
test('QuotaPopover renders platform cards', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /quotaData\?\.platforms\?\.map\(\s*\(\s*platform/,
    'Should map over platforms'
  );
});

test('QuotaPopover normalizes platform names', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /toProviderName\(/,
    'Should use toProviderName helper'
  );
  assert.match(
    popoverBody,
    /platform\.platform/,
    'Should pass platform'
  );
  assert.match(
    popoverBody,
    /platform\.title/,
    'Should pass title'
  );
});

test('QuotaPopover displays platform account info', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /Account:/,
    'Should show account label'
  );
  assert.match(
    popoverBody,
    /platform\.account/,
    'Should display account name'
  );
  assert.match(
    popoverBody,
    /platform\.accountLabel/,
    'Should display account label if present'
  );
});

test('QuotaPopover shows platform status badges', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /platform\.status\s*===\s*['"]error['"]/,
    'Should check for error status'
  );
  assert.match(
    popoverBody,
    /platform\.status\s*===\s*['"]warning['"]/,
    'Should check for warning status'
  );
  assert.match(
    popoverBody,
    /variant=["']destructive["']/,
    'Should render error badge'
  );
  assert.match(
    popoverBody,
    /variant=["']warning["']/,
    'Should render warning badge'
  );
});

// Quota Items Tests
test('QuotaPopover renders quota items', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /platform\.quotas\.map\(\s*\(\s*quota\s*\)\s*=>\s*\{/,
    'Should map over quota items'
  );
});

test('QuotaPopover calculates quota percentage', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /const\s+pct\s*=\s*Math\.max\(0,\s*Math\.min\(100,\s*quota\.remainPercent\)\)/,
    'Should clamp percentage between 0 and 100'
  );
});

test('QuotaPopover displays quota labels', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /quota\.label/,
    'Should display quota label'
  );
});

test('QuotaPopover shows percent labels', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /quota\.percentLabel/,
    'Should use percentLabel if available'
  );
  assert.match(
    popoverBody,
    /Math\.round\(pct\).*%.*remaining/,
    'Should default to percentage remaining'
  );
});

test('QuotaPopover renders progress bars for quotas', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /h-1\s+w-full/,
    'Should render progress bar'
  );
  assert.match(
    popoverBody,
    /barColor\(pct\)/,
    'Should use barColor function for color'
  );
});

test('QuotaPopover displays usage totals', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /quota\.usedTotalDisplay/,
    'Should check for usedTotalDisplay'
  );
  assert.match(
    popoverBody,
    /Used/,
    'Should show "Used" label'
  );
});

test('QuotaPopover displays reset information', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /quota\.resetLabel/,
    'Should check for resetLabel'
  );
  assert.match(
    popoverBody,
    /Resets in/,
    'Should show "Resets in" label'
  );
});

test('QuotaPopover displays notes when present', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /quota\.note/,
    'Should check for note'
  );
  assert.match(
    popoverBody,
    /border-t\s+border-oc-border/,
    'Should add border above note'
  );
});

// Icon Tests
test('QuotaPopover imports lucide-react icons', () => {
  assert.match(
    quotaPopoverSource,
    /import\s+.*\{.*X.*\}\s+from\s+['"]lucide-react['"]/,
    'Should import X icon'
  );
  assert.match(
    quotaPopoverSource,
    /import\s+.*\{.*Calendar.*\}\s+from\s+['"]lucide-react['"]/,
    'Should import Calendar icon'
  );
  assert.match(
    quotaPopoverSource,
    /import\s+.*\{.*CalendarRange.*\}\s+from\s+['"]lucide-react['"]/,
    'Should import CalendarRange icon'
  );
  assert.match(
    quotaPopoverSource,
    /import\s+.*\{.*Clock.*\}\s+from\s+['"]lucide-react['"]/,
    'Should import Clock icon'
  );
  assert.match(
    quotaPopoverSource,
    /import\s+.*\{.*Award.*\}\s+from\s+['"]lucide-react['"]/,
    'Should import Award icon'
  );
});

test('QuotaPopover uses getQuotaIcon helper', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /getQuotaIcon\(/,
    'Should use getQuotaIcon helper'
  );
  assert.match(
    popoverBody,
    /quota\.label/,
    'Should pass quota label to getQuotaIcon'
  );
});

// Footer Tests
test('QuotaPopover renders footer with timestamp', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /Updated/,
    'Should show "Updated" label'
  );
  assert.match(
    popoverBody,
    /formatLastUpdated\(\)/,
    'Should call formatLastUpdated'
  );
});

test('QuotaPopover formats last updated time', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /const\s+formatLastUpdated\s*=/,
    'Should define formatLastUpdated function'
  );
  assert.match(
    popoverBody,
    /quotaData\?\.lastUpdated/,
    'Should access lastUpdated timestamp'
  );
  assert.match(
    popoverBody,
    /new\s+Date\(quotaData\.lastUpdated\)/,
    'Should create Date from lastUpdated'
  );
});

// Empty State Tests
test('QuotaPopover shows empty state when no data', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /!quotaData\?\.platforms\s*\|\|\s*quotaData\.platforms\.length\s*===\s*0/,
    'Should check for no data'
  );
  assert.match(
    popoverBody,
    /No quota data/,
    'Should show empty state message'
  );
  assert.match(
    popoverBody,
    /Configure providers in settings/,
    'Should show configuration hint'
  );
});

// Spacing Tests
test('QuotaPopover uses proper spacing for quota items', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /space-y-3/,
    'Should use space-y-3 for sections'
  );
  assert.match(
    popoverBody,
    /space-y-2\.5/,
    'Should use space-y-2.5 for quota items'
  );
  assert.match(
    popoverBody,
    /space-y-0\.5/,
    'Should use space-y-0.5 for detail items'
  );
});

test('QuotaPopover has proper header spacing', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /mb-2/,
    'Should use mb-2 for header spacing'
  );
  assert.match(
    popoverBody,
    /mt-2/,
    'Should use mt-2 for details section'
  );
});

test('QuotaPopover uses proper padding', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /px-3\s+py-2\.5/,
    'Should use proper header padding'
  );
  assert.match(
    popoverBody,
    /p-3/,
    'Should use p-3 for content padding'
  );
  assert.match(
    popoverBody,
    /p-2/,
    'Should use p-2 for quota item padding'
  );
});

// Bar Color Function Tests
test('QuotaPopover defines barColor function', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /const\s+barColor\s*=\s*\([^)]*\)\s*=>\s*\{/,
    'Should define barColor function'
  );
});

test('QuotaPopover uses green gradient for high percentages', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /pct\s*>=\s*50/,
    'Should check for >= 50%'
  );
  assert.match(
    popoverBody,
    /#2ea043,\s*#3fb950/,
    'Should use green gradient'
  );
});

test('QuotaPopover uses yellow gradient for medium percentages', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /pct\s*>=\s*20/,
    'Should check for >= 20%'
  );
  assert.match(
    popoverBody,
    /#bf8700,\s*#d29922/,
    'Should use yellow gradient'
  );
});

test('QuotaPopover uses red gradient for low percentages', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /#da3633,\s*#f85149/,
    'Should use red gradient'
  );
});

// Badge Component Tests
test('QuotaPopover imports Badge component', () => {
  assert.match(
    quotaPopoverSource,
    /import\s+.*Badge.*from\s+['"]@\/components\/ui\/badge['"]/,
    'Should import Badge component'
  );
});

test('QuotaPopover uses Badge component for warnings', () => {
  const popoverBody = extractFunctionBody(
    quotaPopoverSource,
    'export function QuotaPopover()'
  );

  assert.match(
    popoverBody,
    /<Badge/,
    'Should render Badge component'
  );
  assert.match(
    popoverBody,
    /variant=/,
    'Should use variant prop'
  );
});
