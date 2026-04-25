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
  // Verify buttons are: History (view sessions), Plus (create new), BarChart3 (quota)
  const body = extractFunctionBody(panelSource, 'export function StickyHeader()');

  // Check for History button (view sessions)
  assert.match(
    body,
    /oc-history-btn/,
    'StickyHeader must have History button for viewing sessions',
  );
  assert.match(
    body,
    /View sessions/,
    'History button must have "View sessions" title',
  );

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

  // Check for BarChart3 button (quota status)
  assert.match(
    body,
    /oc-quota-btn/,
    'StickyHeader must have BarChart3 button for quota status',
  );
  assert.match(
    body,
    /Quota status/,
    'Quota button must have "Quota status" title',
  );

  // Verify order by checking they appear in sequence
  const historyIndex = body.indexOf('oc-history-btn');
  const newChatIndex = body.indexOf('oc-new-chat-btn');
  const quotaIndex = body.indexOf('oc-quota-btn');

  assert.ok(
    historyIndex < newChatIndex && newChatIndex < quotaIndex,
    'Buttons must be in order: History, New Chat, Quota',
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

  // Quota button should open quota popover
  assert.match(
    body,
    /oc-quota-btn[\s\S]*SET_QUOTA_POPOVER_OPEN/s,
    'Quota button must toggle quota popover',
  );
});

test('ChatShell does not import or render MobileRightSummary', () => {
  // Verify MobileRightSummary has been removed from ChatShell
  assert.doesNotMatch(
    chatShellSource,
    /MobileRightSummary/,
    'ChatShell must not import MobileRightSummary',
  );

  // Verify there are no references to mobile summary rendering
  assert.doesNotMatch(
    chatShellSource,
    /mobile.*summary|summary.*mobile/i,
    'ChatShell must not render mobile summary component',
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
  assert.match(rightSection, /oc-quota-btn/, 'Right section must have Quota button');

  // Verify no title in right section
  assert.doesNotMatch(
    rightSection,
    /oc-title|sessionTitle/,
    'Right section must not contain title elements',
  );
});

test('StickyHeader quota button is hidden when extended panel is visible', () => {
  // Verify the quota button has responsive class to hide on desktop (>= 1100px)
  // when the extended panel with QuotaMonitor is visible
  const body = extractFunctionBody(panelSource, 'export function StickyHeader()');

  // Extract the quota button section
  const quotaButtonMatch = body.match(/oc-quota-btn[^>]*>([\s\S]*?)<\/Button>/);
  assert.ok(quotaButtonMatch, 'Must find quota button');

  const quotaButton = quotaButtonMatch[0];

  // Verify the button has the responsive hidden class
  assert.match(
    quotaButton,
    /\[@media\(min-width:1100px\)\]:hidden/,
    'Quota button must be hidden on screens >= 1100px when extended panel is visible',
  );
});
