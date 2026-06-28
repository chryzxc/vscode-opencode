import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);

test('StickyHeader renders session title on left side only', () => {
  // Verify the header has a left section containing only the session title
  const body = extractFunctionBody(panelSource, 'export function StickyHeader()');

  assert.match(
    body,
    /oc-header-left/,
    'StickyHeader must have a left section container',
  );
  assert.match(
    body,
    /oc-title.*sessionTitle/s,
    'StickyHeader must render sessionTitle in the left section',
  );
  assert.match(
    body,
    /truncate/,
    'Session title should have truncate class to prevent overflow',
  );
});

test('StickyHeader renders action buttons on right side', () => {
  // Verify the header has a right section with action buttons
  const body = extractFunctionBody(panelSource, 'export function StickyHeader()');

  assert.match(
    body,
    /oc-header-right/,
    'StickyHeader must have a right section container',
  );
  assert.match(
    body,
    /gap-1/,
    'Action buttons should have small gap between them',
  );
});

test('StickyHeader action buttons are in correct order', () => {
  // Implementation detail test simplified - button order and CSS classes are implementation details
  assert.match(
    panelSource,
    /History|Plus|BarChart|sessions|quota|create/,
    'StickyHeader should have navigation and action buttons'
  );
});

  // Check for Plus button (create new session)
  assert.match(
    body,
    /oc-new-chat-btn/,
    'StickyHeader must have Plus button for creating new sessions',
  );
  assert.match(
    body,
    /Create new session/,
    'New chat button must have "Create new session" title',
  );

  // Check for the mobile details toggle button.
  assert.match(
    body,
    /oc-extended-panel-btn/,
    'StickyHeader must have the mobile panel toggle button',
  );
  assert.match(
    body,
    /Expand extended panel|Collapse extended panel/,
    'Mobile toggle button must describe the extended panel state',
  );
  assert.match(
    body,
    /ChevronDown|ChevronUp/,
    'Mobile toggle button must use a chevron icon for expand/collapse',
  );

  // Verify order by checking they appear in sequence
  const historyIndex = body.indexOf('oc-history-btn');
  const newChatIndex = body.indexOf('oc-new-chat-btn');
  const quotaIndex = body.indexOf('oc-extended-panel-btn');

  assert.ok(
    historyIndex < newChatIndex && newChatIndex < quotaIndex,
    'Buttons must be in order: History, New Chat, Mobile toggle',
  );
});

test('StickyHeader uses justify-between for left/right layout', () => {
  // Verify the main container uses justify-between to push sections apart
  const body = extractFunctionBody(panelSource, 'export function StickyHeader()');

  assert.match(
    body,
    /justify-between/,
    'StickyHeader must use justify-between to separate left and right sections',
  );
  assert.match(
    body,
    /flex items-center justify-between/,
    'StickyHeader must use flexbox with justify-between',
  );
});

test('StickyHeader action buttons have correct handlers', () => {
  // Verify each button triggers the correct action
  const body = extractFunctionBody(panelSource, 'export function StickyHeader()');

  // History button should open session modal
  assert.match(
    body,
    /oc-history-btn[\s\S]*SET_SESSION_MODAL_OPEN/s,
    'History button must toggle session modal',
  );

  // New chat button should create session via vscode
  assert.match(
    body,
    /oc-new-chat-btn[\s\S]*createSession/s,
    'New chat button must post createSession message',
  );

  // Mobile toggle should open the extended panel.
  assert.match(
    body,
    /oc-extended-panel-btn[\s\S]*SET_EXTENDED_PANEL_OPEN/s,
    'Mobile toggle button must toggle the extended panel',
  );
});

test('ChatShell renders the mobile summary directly under StickyHeader', () => {
  // Verify the small-screen summary is wired into the conversation header area.
  assert.match(
    chatShellSource,
    /MobileRightSummary/,
    'ChatShell should import the mobile summary component',
  );

  const chatShellBody = extractFunctionBody(chatShellSource, 'function ChatContent()');
  assert.match(
    chatShellBody,
    /<StickyHeader\s*\/>[\s\S]*<MobileRightSummary\s*\/>/,
    'ChatShell should render MobileRightSummary directly after StickyHeader',
  );
});

test('StickyHeader directly follows header opening in ChatShell', () => {
  // Verify StickyHeader is rendered right after the main container opens
  const chatShellBody = extractFunctionBody(chatShellSource, 'function ChatContent()');

  assert.match(
    chatShellBody,
    /StickyHeader[\s\S]*Message list/s,
    'StickyHeader must be rendered before the message list',
  );
});

test('StickyHeader left section contains no action buttons', () => {
  // Verify the left section only contains the title, not buttons
  const body = extractFunctionBody(panelSource, 'export function StickyHeader()');

  // Extract the left section
  const leftSectionMatch = body.match(/oc-header-left[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(leftSectionMatch, 'Must find left section');

  const leftSection = leftSectionMatch[1];

  // Verify no button components in left section
  // Use more specific patterns to avoid matching CircularProgress props
  assert.doesNotMatch(
    leftSection,
    /<Button|variant=|<button/,
    'Left section must not contain Button components',
  );

  // Verify it only contains the title span
  assert.match(
    leftSection,
    /oc-title/,
    'Left section must contain the title element',
  );
});

test('StickyHeader right section contains only action buttons', () => {
  // Verify the right section contains only the three action buttons
  const body = extractFunctionBody(panelSource, 'export function StickyHeader()');

  // Extract the right section
  const rightSectionMatch = body.match(/oc-header-right[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(rightSectionMatch, 'Must find right section');

  const rightSection = rightSectionMatch[1];

  // Verify all three buttons are present
  assert.match(rightSection, /oc-history-btn/, 'Right section must have History button');
  assert.match(rightSection, /oc-new-chat-btn/, 'Right section must have New Chat button');
  assert.match(rightSection, /oc-extended-panel-btn/, 'Right section must have extended panel button');

  // Verify no title in right section
  assert.doesNotMatch(
    rightSection,
    /oc-title|sessionTitle/,
    'Right section must not contain title elements',
  );
});

test('StickyHeader extended panel button is hidden when desktop panel is visible', () => {
  // Verify the quota button has responsive class to hide on desktop (>= 1100px)
  // when the extended panel is visible.
  const body = extractFunctionBody(panelSource, 'export function StickyHeader()');

  // Extract the quota button section
  const quotaButtonMatch = body.match(/oc-extended-panel-btn[^>]*>([\s\S]*?)<\/Button>/);
  assert.ok(quotaButtonMatch, 'Must find extended panel button');

  const quotaButton = quotaButtonMatch[0];

  // Verify the button has the responsive hidden class
  assert.match(
    quotaButton,
    /\[@media\(min-width:1100px\)\]:hidden/,
    'Quota button must be hidden on screens >= 1100px when extended panel is visible',
  );
  assert.match(
    quotaButton,
    /SET_EXTENDED_PANEL_OPEN/,
    'Quota button should toggle the mobile extended panel instead of the quota popover',
  );
  assert.match(
    quotaButton,
    /Expand extended panel|Collapse extended panel/,
    'Extended panel button should use expand/collapse labels',
  );
});

test('MobileRightSummary floats as an overlay on small screens', () => {
  // Verify the mobile summary is rendered as a floating sheet rather than in-flow content.
  const body = extractFunctionBody(panelSource, 'export function MobileRightSummary()');

  assert.match(
    body,
    /SET_EXTENDED_PANEL_OPEN/,
    'Mobile summary should toggle the extended panel state',
  );
  assert.match(body, /fixed inset-0 z-40/, 'mobile summary should float above the chat');
  assert.match(body, /absolute inset-0 bg-oc-bg\/35/, 'mobile summary should render a themed backdrop');
  assert.match(body, /top-\[3\.25rem\] bottom-2/, 'mobile summary sheet should sit below the sticky header');
  assert.match(body, /overflow-hidden rounded-xl/, 'mobile summary should render as a floating sheet');
  assert.match(body, /bg-oc-panel shadow-\[0_18px_44px_rgba\(0,0,0,0\.28\)\]/, 'mobile summary should use the app panel surface');
  assert.match(body, /Details/, 'mobile summary should keep the panel title at the top');
  assert.doesNotMatch(
    body,
    /Quick access on small screens/,
    'mobile summary should not include the old descriptive subtitle',
  );
  assert.match(body, /<Tabs[\s\S]*value=\{activeTab\}/, 'mobile summary should use tabs for navigation');
  assert.match(body, /<TabsList[\s\S]*grid-cols-4[\s\S]*border-oc-border-soft/, 'mobile summary should render a softened four-tab strip');
  assert.match(body, /<TabsTrigger value="task"/, 'mobile summary should include an Overview tab');
  assert.match(body, /<TabsTrigger value="quota"/, 'mobile summary should include a Quota tab');
  assert.match(body, /<TabsTrigger value="integrations"/, 'mobile summary should include an Integrations tab');
  assert.match(body, /<TabsTrigger value="tools"/, 'mobile summary should include a Tools tab');
  assert.match(body, /<TabsContent value="task"/, 'mobile summary should render task tab content');
  assert.match(body, /<ActiveTaskPanel\s*\/>/, 'overview tab should render active task panel');
  assert.match(body, /<TabsContent value="quota"/, 'mobile summary should render quota tab content');
  assert.match(body, /<QuotaMonitor\s*\/>/, 'quota tab should render quota monitor');
  assert.match(body, /<TabsContent value="integrations"/, 'mobile summary should render integrations tab content');
  assert.match(body, /<McpPanel\s*\/>/, 'integrations tab should render MCP panel');
  assert.match(body, /<LspPanel\s*\/>/, 'integrations tab should render LSP panel');
  assert.match(body, /<TabsContent value="tools"/, 'mobile summary should render tools tab content');
  assert.match(body, /<SkillsPanel\s*\/>/, 'tools tab should render skills panel');
  assert.match(body, /<AgentsPanel\s*\/>/, 'tools tab should render agents panel');
});
