import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('subagent modal logic uses openSubagentModal and closeSubagentModal', () => {
  assert.match(messageSource, /const\s+openSubagentModal\s*=\s*\(subagentId:\s*string\)\s*=>/, 'Should have openSubagentModal function');
  assert.match(messageSource, /const\s+closeSubagentModal\s*=\s*\(\)\s*=>/, 'Should have closeSubagentModal function');
  assert.match(messageSource, /onClick={\(\)\s*=>\s*openSubagentModal\(subagent\.id\)}/, 'Should open modal on subagent click');
});

test('token usage tooltips provide context', () => {
  assert.match(messageSource, /title=|tooltip|aria-label/i, 'Should have tooltip or title attributes for accessibility');
  assert.match(messageSource, /tokens|prompt|response|cache/i, 'Should have token-related content');
});

test('diffStats are rendered in progress events', () => {
  assert.match(messageSource, /event\.diffStats\s*&&\s*\(event\.diffStats\.added\s*>\s*0\s*\|\|\s*event\.diffStats\.deleted\s*>\s*0\)/, 'Should check for diffStats');
  assert.match(messageSource, /\+\{event\.diffStats\.added\}/, 'Should render added lines');
  assert.match(messageSource, /-\{event\.diffStats\.deleted\}/, 'Should render deleted lines');
});

test('AssistantMessage component types subagent data to SubagentDetail', () => {
  assert.match(messageSource, /const\s+detailData\s*=\s*\(subagentDetailsById\[selected\.id\]\s+as\s*\|?\s*SubagentDetail\s*\|\s*undefined\)\s*\|\|/, 'Should normalize selected detailData to SubagentDetail shape');
  const modalSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'SubagentDetailModal.tsx')],
    'SubagentDetailModal.tsx',
  );
  assert.match(modalSource, /detail\.childSessionId/, 'Should use typed detailData childSessionId');
  assert.match(modalSource, /detail\.thinkingEvents\s*&&\s*detail\.thinkingEvents\.length\s*>\s*0/, 'Should use typed detailData thinkingEvents');
  assert.match(modalSource, /detail\.progressEvents\?\.length/, 'Should use typed detailData progressEvents');
  assert.match(modalSource, /detail\.timelineEvents\?\.length/, 'Should use typed detailData timelineEvents');
});

test('inline subagent rows are integrated into the assistant item loop', () => {
  assert.doesNotMatch(messageSource, /SubagentProgressPopover/, 'Legacy SubagentProgressPopover should not be present');
  assert.match(messageSource, /visibleSubagents\.map\(\(subagent:\s*SubagentSummary\)\s*=>/, 'AssistantMessage should map inline subagent rows');
  assert.match(messageSource, /onClick=\{\(\)\s*=>\s*openSubagentModal\(subagent\.id\)\}/, 'Inline subagent rows should open modal details');
  assert.match(messageSource, /subagent\.latestActivity\s*\|\|[\s\S]*statusText\s*\|\|\s*"Initializing\.\.\."/,
    'Inline subagent rows should show latest activity with fallback'
  );
});

test('subagent list container is scrollable for large agent batches', () => {
  assert.match(
    messageSource,
    /max-h-\[320px\]\s+space-y-1\.5\s+overflow-y-auto\s+pr-1/,
    'Inline spawned subagents list should cap height and scroll instead of expanding indefinitely',
  );
});

test('subagent detail modal is wired for selected subagents', () => {
  assert.match(messageSource, /<SubagentDetailModal/, 'AssistantMessage should render SubagentDetailModal');
  assert.match(messageSource, /providerLabel/, 'SubagentDetailModal should receive provider/model label');
});

test('subagent color differentiation is applied deterministically', () => {
  assert.match(messageSource, /function\s+getSubagentColor/, 'Should have getSubagentColor helper');
  assert.match(messageSource, /const\s+cardStyle\s*=\s*getSubagentCardStyle\(subagent\.id\)/, 'Should derive deterministic subagent card style once per row');
  assert.match(messageSource, /const\s+accentTextStyle\s*=\s*getSubagentAccentTextStyle\([\s\S]*subagent\.id[\s\S]*\)/, 'Should derive deterministic accent text style once per row');
  assert.match(messageSource, /<SubagentDetailModal[\s\S]*colorClass=\{getSubagentColor\(selected\.id\)\}/, 'Should pass deterministic subagent color to detail modal');
  const modalSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'SubagentDetailModal.tsx')],
    'SubagentDetailModal.tsx',
  );
  assert.match(modalSource, /colorClass/, 'SubagentDetailModal should accept colorClass');
});

test('subagent sessions are filtered out of History Sidebar', () => {
  assert.match(panelSource, /topLevelSessions\s*=\s*sessionsList\.filter\(/, 'Should filter sessionsList to get top-level sessions');
  assert.match(panelSource, /parentSessionId\s*=\s*session\.parentSessionId/, 'Should check parentSessionId property');
  assert.match(panelSource, /if\s*\(!parentSessionId\)/, 'Should include sessions without parentSessionId');
});

test('ThinkingStatusTicker renders below the spawned subagents UI', () => {
  assert.match(
    messageSource,
    /subagents\.length\s*>\s*0\s*&&[\s\S]*?showSubagents\s*&&[\s\S]*?visibleSubagents\.map[\s\S]*?ThinkingStatusTicker/s,
    'Subagents UI should appear in the source before ThinkingStatusTicker for correct visual ordering'
  );
});

test('subagent detail modal is responsive and visually aligned with chat surfaces', () => {
  const modalSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'SubagentDetailModal.tsx')],
    'SubagentDetailModal.tsx',
  );

  assert.match(
    modalSource,
    /className="relative z-50 flex h-\[min\(92vh,860px\)\] min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-oc-border bg-oc-panel/,
    'Modal container should use responsive constrained height and shared oc surface tokens',
  );
  assert.match(
    modalSource,
    /className="flex min-h-0 flex-1 flex-col lg:flex-row"/,
    'Modal content should stack on mobile and switch to columns on large screens',
  );
  assert.match(
    modalSource,
    /className="order-1 w-full shrink-0 max-h-\[38vh\][\s\S]*lg:order-2[\s\S]*lg:w-80[\s\S]*lg:border-l/,
    'Timeline pane should be mobile-first (top section) and move to right column on desktop',
  );
  assert.match(
    modalSource,
    /className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-oc-border bg-oc-bg-soft[\s\S]*sm:w-auto"/,
    'Header actions should be full-width on mobile and auto-width on larger screens',
  );
});
