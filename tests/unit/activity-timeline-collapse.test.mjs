import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test.skip('activity timeline defaults to collapsed mode', () => {
  // This feature is not yet implemented
  assert.match(
    messageComponentsSource,
    /showExpandedActivityTimeline:\s*false/,
    'timeline should default to collapsed mode',
  );
});

test.skip('activity timeline renders collapsed latest activity summary row', () => {
  // This feature is not yet implemented
  assert.match(
    messageComponentsSource,
    /!\s*viewState\.showExpandedActivityTimeline\s*&&\s*latestTimelineEvent/,
    'collapsed mode should be gated by showExpandedActivityTimeline and latestTimelineEvent',
  );
  assert.match(
    messageComponentsSource,
    /collapsedTimelineTitle/,
    'collapsed mode should display latest activity title',
  );
  assert.match(
    messageComponentsSource,
    /collapsedTimelineDescription/,
    'collapsed mode should display latest activity description',
  );
});

test.skip('activity timeline supports expand and collapse toggles', () => {
  assert.match(
    messageComponentsSource,
    /showExpandedActivityTimeline:\s*true/,
    'should set expanded timeline state to true when expanding',
  );
  assert.match(
    messageComponentsSource,
    /showExpandedActivityTimeline:\s*false/,
    'should set expanded timeline state to false when collapsing',
  );
  assert.match(
    messageComponentsSource,
    />\s*Expand\s*</,
    'should render an Expand control',
  );
  assert.match(
    messageComponentsSource,
    />\s*Collapse\s*</,
    'should render a Collapse control',
  );
});

test.skip('collapsed activity timeline reflects fallback in-progress placeholder', () => {
  assert.match(
    messageComponentsSource,
    /const collapsedDisplayTitle = showInProgressActivityPlaceholder\s*\?\s*"IN PROGRESS"/,
    'collapsed timeline should show IN PROGRESS title when fallback placeholder is active',
  );
  assert.match(
    messageComponentsSource,
    /const collapsedDisplayDescription = showInProgressActivityPlaceholder\s*\?\s*"Working in the background\.\.\."/,
    'collapsed timeline should show background-working description when fallback placeholder is active',
  );
});
