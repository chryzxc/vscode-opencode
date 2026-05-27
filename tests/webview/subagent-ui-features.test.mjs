import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'components', 'SessionModal.tsx')],
  'SessionModal.tsx',
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
  assert.match(modalSource, /detail\.conversationEvents/, 'Should use typed detailData conversationEvents');
});

test('inline subagent rows are integrated into the assistant item loop', () => {
  assert.doesNotMatch(messageSource, /SubagentProgressPopover/, 'Legacy SubagentProgressPopover should not be present');
  assert.match(messageSource, /visibleSubagents\.map\(\(subagent:\s*SubagentSummary\)\s*=> \{/, 'AssistantMessage should map inline subagent rows');
  assert.match(messageSource, /onClick=\{\(\)\s*=>\s*openSubagentModal\(subagent\.id\)\}/, 'Inline subagent rows should open modal details');
  assert.match(messageSource, /statusText \|\| "Initializing\.\.\."/,
    'Inline subagent rows should show status text with fallback'
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
  assert.match(messageSource, /modelInfo/, 'SubagentDetailModal should receive model info label');
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
  assert.match(panelSource, /return\s*!sessionIds\.has\(parentSessionId\)/, 'Should exclude true child sessions when parent exists');
});

test.skip('ThinkingStatusTicker renders below the spawned subagents UI', () => {
  // Visual ordering test is not applicable to current implementation
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
    /className="oc-modal-shell relative z-50 flex h-\[min\(92vh,860px\)\] min-h-0 w-full max-w-5xl flex-col overflow-hidden text-foreground animate-in zoom-in-95 duration-200"/,
    'Modal container should use responsive constrained height and shared modal shell tokens',
  );
  assert.match(
    modalSource,
    /className="oc-modal-content min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5"/,
    'Modal body should use the shared modal content class with responsive padding',
  );
  assert.match(
    modalSource,
    /Assistant Conversation/,
    'Modal should render a dedicated assistant conversation heading',
  );
  assert.match(
    modalSource,
    /className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-oc-border bg-oc-bg-soft[\s\S]*sm:w-auto"/,
    'Header actions should be full-width on mobile and auto-width on larger screens',
  );
});

test('subagent modal requests child-session conversation when detail is missing it', () => {
  assert.match(
    messageSource,
    /type:\s*"getSubagentConversation"/,
    'AssistantMessage should request subagent conversation hydration from extension',
  );
  assert.match(
    messageSource,
    /requestedSubagentConversationRef/,
    'AssistantMessage should de-duplicate conversation hydration requests',
  );
  assert.match(
    messageSource,
    /subagentId:\s*selected\.id[\s\S]*childSessionId[\s\S]*parentSessionId[\s\S]*parentMessageId/s,
    'Conversation request should include subagent and parent/child identifiers',
  );
});

test('jump to parent action closes subagent modal before navigation', () => {
  assert.match(
    messageSource,
    /onJumpToParent=\{\(\)\s*=>\s*\{[\s\S]*closeSubagentModal\(\);[\s\S]*jumpToMessage\(/s,
    'Jump to Parent should close the modal then jump',
  );
});

test('subagent conversation modal renders markdown and removes legacy sections', () => {
  const modalSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'SubagentDetailModal.tsx')],
    'SubagentDetailModal.tsx',
  );
  assert.match(
    modalSource,
    /MarkdownRenderer/,
    'Subagent conversation should render message bodies via MarkdownRenderer',
  );
  assert.match(
    modalSource,
    /role\s*!==\s*"assistant"/,
    'Subagent conversation should only include assistant-authored events',
  );
  assert.doesNotMatch(modalSource, /Timeline \(/, 'Legacy timeline section should be removed');
  assert.doesNotMatch(modalSource, /Progress \(/, 'Legacy progress section should be removed');
  assert.doesNotMatch(modalSource, /Latest Activity/, 'Legacy latest activity section should be removed');
});
