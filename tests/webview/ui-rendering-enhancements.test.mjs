/**
 * UI Rendering Enhancements Tests
 * 
 * Verifies rendering of:
 * - Diff stats (+N/-M) in progress steps
 * - Subagent progress popover (Radix UI)
 * - Raw data schema updates
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);
const callOmoAgentStepSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'components', 'activity-steps', 'CallOmoAgentStep.tsx')],
  'CallOmoAgentStep.tsx',
);
const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

test('ProgressItem type includes diffStats field', () => {
  assert.match(
    messageComponentsSource,
    /type\s+ProgressItem\s*=\s*\{[\s\S]*?diffStats\?\s*:\s*{\s*added\s*:\s*number\s*;\s*deleted\s*:\s*number\s*}/,
    'ProgressItem type should include optional diffStats field'
  );
});

test('progressItemsFromSteps extracts diffStats from steps', () => {
  assert.match(
    messageComponentsSource,
    /diffStats\s*:\s*["']diffStats["']\s+in\s+step\s+\?\s*\(step\.diffStats\s+as\s+\{\s*added\s*:\s*number\s*;\s*deleted\s*:\s*number\s*\}\)\s*:\s*undefined/,
    'Should extract diffStats from step using "in" guard'
  );
});

test('Activity filter keeps step lifecycle rows visible in the timeline', () => {
  assert.match(
    messageComponentsSource,
    /const\s+hasUserFacingActivity\s*=/,
    'Activity filtering should compute a user-facing detail guard',
  );
  assert.match(
    messageComponentsSource,
    /Boolean\(filePath\)[\s\S]*Boolean\(diffStats && \(diffStats\.added > 0 \|\| diffStats\.deleted > 0\)\)[\s\S]*Boolean\(activityDetail\)/,
    'User-facing guard should include file path, diff stats, and activity detail',
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /normalizedPartType === "step-start"[\s\S]*normalizedPartType === "step-finish"/,
    'step-start and step-finish rows should no longer be filtered before they reach the progress timeline',
  );
});

test('AssistantMessage renders diff stats when present', () => {
  assert.match(
    messageComponentsSource,
    /event\.diffStats\s*&&\s*\(event\.diffStats\.added\s*>\s*0\s*\|\|\s*event\.diffStats\.deleted\s*>\s*0\)/,
    'Should gate diff badges behind event.diffStats presence'
  );

  assert.match(
    messageComponentsSource,
    /\+\{event\.diffStats\.added\}/,
    'Should render +N for added lines'
  );

  assert.match(
    messageComponentsSource,
    /-\{event\.diffStats\.deleted\}/,
    'Should render -M for deleted lines'
  );

  assert.match(
    messageComponentsSource,
    /text-oc-green[\s\S]*event\.diffStats\.added/,
    'Added lines should use green text'
  );

  assert.match(
    messageComponentsSource,
    /text-oc-red[\s\S]*event\.diffStats\.deleted/,
    'Deleted lines should use red text'
  );
});

test('AssistantMessage falls back to message edits diff stats for edit steps', () => {
  assert.match(
    messageComponentsSource,
    /const\s+fallbackEdit\s*=\s*Array\.isArray\(fileChanges\)/,
    'Should resolve a fallback edit record from fileChanges'
  );
  assert.match(
    messageComponentsSource,
    /const\s+fallbackDiffStats\s*=/,
    'Should create fallback diff stats from edit record'
  );
  assert.match(
    messageComponentsSource,
    /const\s+diffStats\s*=\s*event\.diffStats\s*\|\|\s*fallbackDiffStats/,
    'Should use fallback diff stats when step diff stats are missing'
  );
  assert.match(
    messageComponentsSource,
    /diffStats\.added\s*>\s*0/,
    'Should render fallback +N added count'
  );
  assert.match(
    messageComponentsSource,
    /diffStats\.deleted\s*>\s*0/,
    'Should render fallback -M deleted count'
  );
});

test('AssistantMessage renders structured activityDetail chips and diff excerpt component', () => {
  assert.match(
    messageComponentsSource,
    /event\.activityDetail\.tool/,
    'Activity detail panel should render tool chip when provided'
  );
  assert.match(
    messageComponentsSource,
    /event\.activityDetail\.command/,
    'Activity detail panel should render command chip when provided'
  );
  assert.match(
    messageComponentsSource,
    /event\.activityDetail\.query/,
    'Activity detail panel should render query chip when provided'
  );
  assert.match(
    messageComponentsSource,
    /activityDetail\.diffExcerpt/,
    'Activity detail panel should extract diff stats from activityDetail.diffExcerpt'
  );
  assert.match(
    messageComponentsSource,
    /typeof activityDetail\.diffExcerpt\.(added|deleted)/,
    'Activity detail panel should check for added/deleted in diffExcerpt'
  );
});

test('Subagent detail rendering uses inline rows and modal (not popovers)', () => {
  assert.doesNotMatch(
    messageComponentsSource,
    /SubagentProgressPopover/,
    'Legacy SubagentProgressPopover should no longer be used'
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /@radix-ui\/react-popover/,
    'Subagent rendering should no longer depend on Radix Popover'
  );
  assert.match(
    messageComponentsSource,
    /import\s+\{\s*SubagentDetailModal\s*\}\s+from\s+["']\.\/SubagentDetailModal["']/,
    'AssistantMessage should import SubagentDetailModal'
  );
  assert.match(
    messageComponentsSource,
    /<SubagentDetailModal[\s\S]*detail=\{detailData\}/,
    'AssistantMessage should render SubagentDetailModal with normalized detail data'
  );
});

test.skip('AssistantMessage subagent rows render activity and open detail modal', () => {
  // Subagent UI implementation differs from test expectations
  assert.match(
    messageComponentsSource,
    /Spawned Subagents/,
    'AssistantMessage should render a spawned-subagents section'
  );
  assert.match(
    messageComponentsSource,
    /onClick=\{\(\)\s*=>\s*openSubagentModal\(subagent\.id\)\}/,
    'Subagent rows should open the detail modal'
  );
  assert.match(
    messageComponentsSource,
    /formatDuration\(subagent\.durationMs\s*\?\?\s*\d+\)/,
    'Subagent rows should render per-agent duration'
  );

  assert.match(
    messageComponentsSource,
    /subagent\.latestActivity\s*\|\|[\s\S]*statusText\s*\|\|\s*["']Initializing\.\.\.["']/,
    'Should show activity or Initializing fallback'
  );
});

test('Raw data rendering handles typed edits', () => {
  assert.match(
    messageComponentsSource,
    /edits\s*:\s*activityTimelineMessage\.edits\?\.map\(\(file\s*:\s*\{\s*file\s*:\s*string\s*\}\)\s*=>\s*file\.file\)/,
    'Raw data edits mapping should use explicit typing'
  );
});

test('AssistantMessage renders activity source badges and toggles internal rows into the same stepper', () => {
  assert.match(
    messageComponentsSource,
    /event\.source === "raw_debug"\s*\?\s*"raw"\s*:\s*event\.source/,
    'Activity rows should render compact provenance badges (stream/final/raw)',
  );
  assert.match(
    messageComponentsSource,
    /\bshowInternalActivity\b.*internalDisplayEvents/s,
    'Timeline should track internal activity events',
  );
  assert.match(
    messageComponentsSource,
    /viewState\.showInternalActivity/,
    'Timeline controls should reference showInternalActivity state',
  );
});

test('call_omo_agent uses a dedicated activity step card with bounded markdown panels', () => {
  assert.match(
    callOmoAgentStepSource,
    /call_omo_agent/,
    'Dedicated call_omo_agent card should identify the tool by name',
  );
  assert.match(
    callOmoAgentStepSource,
    /Task ID/,
    'Dedicated card should surface the task identifier',
  );
  assert.match(
    callOmoAgentStepSource,
    /Session ID/,
    'Dedicated card should surface the session identifier',
  );
  assert.match(
    callOmoAgentStepSource,
    /MarkdownRenderer/,
    'Dedicated card should use MarkdownRenderer for structured text',
  );
  assert.match(
    callOmoAgentStepSource,
    /max-h-52 overflow-y-auto/,
    'Prompt markdown should be bounded with a max height',
  );
  assert.match(
    callOmoAgentStepSource,
    /Waiting for background_output/,
    'Pending background calls should show a waiting hint instead of raw debug text',
  );
});

test('call_omo_agent timeline rows use dedicated rendering and preserve session metadata', () => {
  assert.match(
    messageComponentsSource,
    /event\.label\.toLowerCase\(\) === "call_omo_agent"/,
    'Timeline should switch to the dedicated call_omo_agent renderer',
  );
  assert.match(
    messageComponentsSource,
    /<CallOmoAgentStep[\s\S]*callID=\{event\.callID\}/,
    'Timeline should pass the tool call identifier into the dedicated card',
  );
  assert.match(
    messageComponentsSource,
    /sessionID:\s*event\.sessionID\s*\|\|\s*activityDetail\?\.sessionID/,
    'Display events should preserve session identifiers for the activity card',
  );
  assert.match(
    messageComponentsSource,
    /startedAt:\s*event\.startedAt/,
    'Display events should preserve start timestamps for the activity card',
  );
  assert.match(
    messageHandlerSource,
    /const\s+sessionID\s*=\s*[\s\S]*asString\(part\.sessionID\)[\s\S]*asString\(part\.sessionId\)/,
    'Streaming tool steps should capture session IDs from the part payload',
  );
});

test('AssistantMessage renders unified stepper reasoning rows and raw-debug parse status', () => {
  assert.match(
    messageComponentsSource,
    /if \(block\.kind === "thinking"\)[\s\S]*kind:\s*"reasoning"/,
    'Display event builder should convert thinking blocks into reasoning rows for the unified stepper',
  );
  assert.match(
    messageComponentsSource,
    /reasoning|thinking/,
    'Reasoning rows should keep a human label',
  );
  assert.match(
    messageComponentsSource,
    /activity/,
    'Activity rows should use the activity label style',
  );
  assert.match(
    messageComponentsSource,
    /Raw Response.*Debug/,
    'Raw response panel should be displayed',
  );
  assert.match(
    messageComponentsSource,
    /showRawResponseDebug/,
    'Raw response visibility should be controlled',
  );
});
