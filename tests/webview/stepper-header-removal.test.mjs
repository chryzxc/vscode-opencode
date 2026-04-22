/**
 * Stepper Header Tests
 *
 * Tests for the activity section structure, including status counts
 * computation, show-more expansion, and stepper rendering.
 *
 * Covered areas:
 * - Activity header section status badges removed from rendered output
 * - Status counts computation still tracks activity statuses
 * - Simplified stepper container structure
 * - Direct stepper rendering with compact metrics rail
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

const messageComponentsSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
    'MessageComponents.tsx',
);

// ---------------------------------------------------------------------------
// 1. Activity header section removal tests
// ---------------------------------------------------------------------------

test('activity section no longer contains header with status counts', () => {
    // Check that the old header structure with flex justify-between is removed
    assert.doesNotMatch(
        messageComponentsSource,
        /flex flex-wrap items-center justify-between gap-2 px-3 py-2\.5.*activityStatusCounts\.pending/s,
        'Activity section should not contain header with status counts display',
    );
});

test('activity section no longer displays pending count badge', () => {
    assert.doesNotMatch(
        messageComponentsSource,
        /activityStatusCounts\.pending.*text-oc-accent/s,
        'Activity section should not display pending count badge',
    );
});

test('activity section no longer displays done count badge', () => {
    assert.doesNotMatch(
        messageComponentsSource,
        /activityStatusCounts\.done.*text-oc-green/s,
        'Activity section should not display done count badge',
    );
});

test('activity section no longer displays error count badge', () => {
    assert.doesNotMatch(
        messageComponentsSource,
        /activityStatusCounts\.error.*text-oc-red/s,
        'Activity section should not display error count badge',
    );
});

test('activity section displays hidden event count with show-more toggle', () => {
    // The variable exists and is rendered in a "Show more (N)" toggle
    assert.match(
        messageComponentsSource,
        /hiddenActivityEventCount/,
        'Activity section uses hiddenActivityEventCount for show-more toggle',
    );
    assert.match(
        messageComponentsSource,
        /`Show more \(\$\{hiddenActivityEventCount\}\)`/,
        'Activity section UI renders hiddenActivityEventCount in show-more button text',
    );
});

test('activity section no longer contains text preview toggle button', () => {
    // Check that the toggle button dispatch is removed from activity section
    assert.doesNotMatch(
        messageComponentsSource,
        /dispatch.*TOGGLE_ACTIVITY_DETAILS/s,
        'Activity section should not contain TOGGLE_ACTIVITY_DETAILS dispatch',
    );
});

// ---------------------------------------------------------------------------
// 2. Status counts computation removal tests
// ---------------------------------------------------------------------------

test('activityStatusCounts useMemo computation tracks activity statuses', () => {
    assert.match(
        messageComponentsSource,
        /const activityStatusCounts\s*=\s*useMemo/s,
        'activityStatusCounts computation should exist for tracking activity status',
    );
});

test('activityStatusCounts reduce function computes pending/done/error counts', () => {
    assert.match(
        messageComponentsSource,
        /userFacingDisplayEvents\.reduce\([\s\S]*?pending.*done.*error/s,
        'Status counts reduce function computes pending, done, and error counts',
    );
});

test('activityStatusCounts dependency on userFacingDisplayEvents is removed', () => {
    assert.doesNotMatch(
        messageComponentsSource,
        /\[userFacingDisplayEvents\][\s\S]{0,50}activityStatusCounts/s,
        'activityStatusCounts dependency array should be removed',
    );
});

// ---------------------------------------------------------------------------
// 3. Simplified stepper container structure tests
// ---------------------------------------------------------------------------

test('activity section still exists with simplified structure', () => {
    assert.match(
        messageComponentsSource,
        /data-assistant-section="activity"/,
        'Activity section should still exist with data-assistant-section attribute',
    );
});

test('activity section has simplified container without border-t divider', () => {
    // The old structure had a border-t div separating header from stepper
    // The new structure should go directly to the stepper container
    assert.match(
        messageComponentsSource,
        /data-assistant-section="activity"[\s\S]{0,200}<div className="px-3 py-2\.5">/,
        'Activity section should have simplified container going directly to stepper',
    );
});

test('stepper is rendered directly in simplified container', () => {
    assert.match(
        messageComponentsSource,
        /<div className="px-3 py-2\.5">[\s\S]{0,100}<Stepper/s,
        'Stepper should be rendered directly in simplified container without header div',
    );
});

test('activity section uses compact metrics rail with completed-activity expansion', () => {
  // Activity section exposes a secondary activity section
  assert.match(
    messageComponentsSource,
    /data-assistant-section=["']activity["']/,
    'Activity section should expose a secondary activity section',
  );
  
  // Completed activity uses threshold-based condensing
  assert.match(
    messageComponentsSource,
    /const\s+MAX_VISIBLE_COMPLETED_ACTIVITY\s*=\s*5/,
    'Condensed threshold constant exists for completed activity expansion',
  );
  
  // Header with status counts still exists
  assert.match(
    messageComponentsSource,
    /activityStatusCounts/,
    'Status counts are still tracked for the activity section',
  );
  
  // Metrics rail is present alongside activity
  assert.match(
    messageComponentsSource,
    /oc-metrics-rail/,
    'Metrics rail exists for response context',
  );
});

// ---------------------------------------------------------------------------
// 4. Stepper functionality preservation tests
// ---------------------------------------------------------------------------

test('stepper still receives autoScrollToBottom prop', () => {
    assert.match(
        messageComponentsSource,
        /autoScrollToBottom=\{isStreamingActive\}/,
        'Stepper should still receive autoScrollToBottom prop',
    );
});

test('stepper still receives ref for external access', () => {
    assert.match(
        messageComponentsSource,
        /ref=\{progressTimelineRef\}/,
        'Stepper should still receive ref for external access',
    );
});

test('stepper still renders timeline display events', () => {
    assert.match(
        messageComponentsSource,
        /timelineDisplayEvents\.map\(\(event,\s*index\)\s*=>/s,
        'Stepper should still map over timeline display events',
    );
});

test('stepper still uses isLast prop for StepperItem', () => {
    assert.match(
        messageComponentsSource,
        /isLast=\{isLast\}/,
        'Stepper should still use isLast prop for StepperItem',
    );
});

// ---------------------------------------------------------------------------
// 5. Activity section styling tests
// ---------------------------------------------------------------------------

test('activity section maintains rounded border styling', () => {
    assert.match(
        messageComponentsSource,
        /data-assistant-section="activity"[^>]*className="[^"]*rounded-md border border-oc-border/,
        'Activity section should maintain rounded border styling',
    );
});

test('activity section maintains background styling', () => {
    assert.match(
        messageComponentsSource,
        /data-assistant-section="activity"[^>]*bg-oc-panel-soft/,
        'Activity section should maintain background styling',
    );
});

test('stepper container maintains padding', () => {
    assert.match(
        messageComponentsSource,
        /<div className="px-3 py-2\.5">/,
        'Stepper container should maintain horizontal and vertical padding',
    );
});

// ---------------------------------------------------------------------------
// 6. Integration tests
// ---------------------------------------------------------------------------

test('activity section is rendered when display events exist', () => {
    assert.match(
        messageComponentsSource,
        /\(displayEvents\.length > 0\s*\|\|\s*showThinkingPlaceholder\)/,
        'Activity section should be rendered when display events exist or thinking placeholder shown',
    );
});

test('thinking placeholder is still rendered in stepper', () => {
    assert.match(
        messageComponentsSource,
        /showThinkingPlaceholder.*!hasThinkingEvents/s,
        'Thinking placeholder logic should still exist',
    );
});

test('conditional rendering for activity section is preserved', () => {
    assert.match(
        messageComponentsSource,
        /\{.*displayEvents\.length.*showThinkingPlaceholder.*\}/s,
        'Conditional rendering for activity section should be preserved',
    );
});

// ---------------------------------------------------------------------------
// 7. Removed UI elements tests
// ---------------------------------------------------------------------------

test('no filter controls remain in activity section', () => {
    assert.doesNotMatch(
        messageComponentsSource,
        /TOGGLE_ACTIVITY_DETAILS.*activity section/s,
        'Activity section should not contain TOGGLE_ACTIVITY_DETAILS controls',
    );
});

test('no status badges remain in activity section', () => {
    assert.doesNotMatch(
        messageComponentsSource,
        /rounded border border-oc-border px-1\.5 py-0\.5 font-mono text-\[10px\].*activityStatusCounts/s,
        'Activity section should not contain status badges',
    );
});

test('removed header controls no longer present in activity section', () => {
    // Verify that the old complex header structure with multiple controls is gone
    assert.doesNotMatch(
        messageComponentsSource,
        /flex flex-wrap items-center justify-between.*timelineDisplayEvents\.length.*hiddenActivityEventCount/s,
        'Activity section should not have old header structure with event counts and controls',
    );
});
