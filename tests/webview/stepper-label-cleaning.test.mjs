/**
 * Stepper Label Cleaning Tests
 *
 * Tests the enhanced cleanEventLabel functionality that removes unwanted
 * text from stepper labels including "Stream", "Final", "Step" prefixes
 * and normalizes whitespace.
 *
 * Covered areas:
 * - "Final" prefix removal
 * - "Step" prefix removal
 * - "Stream" and "Streaming" text removal
 * - Whitespace normalization
 * - System noise filtering (starting/finishing)
 * - Fallback to original label when cleaning results in empty string
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
// 1. Prefix removal tests
// ---------------------------------------------------------------------------

test('cleanEventLabel removes "Final" prefix from labels', () => {
    assert.match(
        messageComponentsSource,
        /\.replace\(\/\^final\\s\+\/i,\s*['"]{2}\)/,
        'cleanEventLabel should strip leading "Final " prefix case-insensitively',
    );
});

test('cleanEventLabel removes "Step" prefix from labels', () => {
    assert.match(
        messageComponentsSource,
        /\.replace\(\/\^step\\s\+\/i,\s*['"]{2}\)/,
        'cleanEventLabel should strip leading "Step " prefix case-insensitively',
    );
});

// ---------------------------------------------------------------------------
// 2. Stream text removal tests
// ---------------------------------------------------------------------------

test('cleanEventLabel removes "Stream" text from labels', () => {
    assert.match(
        messageComponentsSource,
        /\.replace\(\/streaming\|stream\/gi,\s*['"]{2}\)/,
        'cleanEventLabel should remove "Stream" or "Streaming" text case-insensitively',
    );
});

test('cleanEventLabel handles stream removal with global flag', () => {
    assert.match(
        messageComponentsSource,
        /\/streaming\|stream\/gi/,
        'Stream replacement regex should use global flag to remove all occurrences',
    );
});

test('cleanEventLabel removes stream text case-insensitively', () => {
    assert.match(
        messageComponentsSource,
        /\/streaming\|stream\/gi/,
        'Stream replacement regex should use case-insensitive flag',
    );
});

// ---------------------------------------------------------------------------
// 3. Whitespace normalization tests
// ---------------------------------------------------------------------------

test('cleanEventLabel normalizes multiple spaces to single space', () => {
    assert.match(
        messageComponentsSource,
        /\.replace\(\/\\s\+\/g,\s*['"] ['"]\)/,
        'cleanEventLabel should normalize multiple whitespace characters to single space',
    );
});

test('cleanEventLabel applies final trim after all replacements', () => {
    const cleanEventLabelMatch = messageComponentsSource.match(
        /const cleanEventLabel[\s\S]*?return cleaned\.trim\(\)/
    );
    assert.ok(
        cleanEventLabelMatch,
        'cleanEventLabel should apply final trim after all cleaning operations',
    );
});

// ---------------------------------------------------------------------------
// 4. System noise filtering tests
// ---------------------------------------------------------------------------

test('cleanEventLabel filters out "starting" events', () => {
    assert.match(
        messageComponentsSource,
        /lowerCleaned\s*===\s*['"]starting['"]/,
        'cleanEventLabel should filter out exact "starting" label',
    );
});

test('cleanEventLabel filters out "finishing" events', () => {
    assert.match(
        messageComponentsSource,
        /lowerCleaned\s*===\s*['"]finishing['"]/,
        'cleanEventLabel should filter out exact "finishing" label',
    );
});

test('cleanEventLabel filters out labels starting with "starting "', () => {
    assert.match(
        messageComponentsSource,
        /lowerCleaned\.startsWith\(['"]starting\s['"]\)/,
        'cleanEventLabel should filter out labels starting with "starting "',
    );
});

test('cleanEventLabel filters out labels starting with "finishing "', () => {
    assert.match(
        messageComponentsSource,
        /lowerCleaned\.startsWith\(['"]finishing\s['"]\)/,
        'cleanEventLabel should filter out labels starting with "finishing "',
    );
});

test('cleanEventLabel filters out labels containing "starting..."', () => {
    assert.match(
        messageComponentsSource,
        /lowerCleaned\.includes\(['"]starting\.\.\.['"]\)/,
        'cleanEventLabel should filter out labels containing "starting..."',
    );
});

test('cleanEventLabel filters out labels containing "finishing..."', () => {
    assert.match(
        messageComponentsSource,
        /lowerCleaned\.includes\(['"]finishing\.\.\.['"]\)/,
        'cleanEventLabel should filter out labels containing "finishing..."',
    );
});

// ---------------------------------------------------------------------------
// 5. Fallback behavior tests
// ---------------------------------------------------------------------------

test('cleanEventLabel returns original label when cleaning results in empty string', () => {
    assert.match(
        messageComponentsSource,
        /return cleaned\.trim\(\)\s*\|\|\s*label/,
        'cleanEventLabel should fall back to original label if cleaned result is empty',
    );
});

test('cleanEventLabel returns empty string for filtered noise events', () => {
    assert.match(
        messageComponentsSource,
        /return\s*['"]{2}\s*;\s*\/\/\s*Return empty to filter out/,
        'cleanEventLabel should return empty string for system noise events',
    );
});

// ---------------------------------------------------------------------------
// 6. Integration tests
// ---------------------------------------------------------------------------

test('cleanEventLabel is called when creating activity display events', () => {
    assert.match(
        messageComponentsSource,
        /const cleanedLabel\s*=[\s\S]*\?\s*cleanEventLabel\([\s\S]*\)\s*:\s*cleanEventLabel\(metadataFirstLabel\)/,
        'buildDisplayEvents should call cleanEventLabel to process activity labels',
    );
});

test('buildDisplayEvents skips events when cleanEventLabel returns empty', () => {
    assert.match(
        messageComponentsSource,
        /if\s*\(\s*!cleanedLabel\s*\)\s*\{[\s\S]*?continue/,
        'buildDisplayEvents should skip events when cleanedLabel is empty',
    );
});

test('buildDisplayEvents uses cleaned label in display event', () => {
    assert.match(
        messageComponentsSource,
        /label:\s*isLifecycleMarker\s*\?\s*cleanedRawTitle\s*\|\|\s*cleanedLabel\s*:\s*cleanedLabel/,
        'Display events should use the cleaned label from cleanEventLabel',
    );
});

// ---------------------------------------------------------------------------
// 7. Processing order tests
// ---------------------------------------------------------------------------

test('cleanEventLabel applies prefix removals before whitespace normalization', () => {
    const cleanEventLabelMatch = messageComponentsSource.match(
        /const cleanEventLabel[\s\S]*?\.replace\(\/\^final\\s\+\/i[\s\S]*?\.replace\(\/\\s\+\/g/
    );
    assert.ok(
        cleanEventLabelMatch,
        'cleanEventLabel should apply prefix removals before whitespace normalization',
    );
});

test('cleanEventLabel applies stream removal after prefix removals', () => {
    const cleanEventLabelMatch = messageComponentsSource.match(
        /const cleanEventLabel[\s\S]*?\.replace\(\/\^step\\s\+\/i[\s\S]*?\.replace\(\/streaming\|stream\/gi/
    );
    assert.ok(
        cleanEventLabelMatch,
        'cleanEventLabel should apply stream removal after prefix removals',
    );
});

// ---------------------------------------------------------------------------
// 8. Edge case tests
// ---------------------------------------------------------------------------

test('cleanEventLabel handles labels with only whitespace after cleaning', () => {
    assert.match(
        messageComponentsSource,
        /cleaned\.trim\(\)\s*\|\|\s*label/,
        'cleanEventLabel should handle labels that become empty after trimming',
    );
});

test('cleanEventLabel preserves original label when all text is removed', () => {
    assert.match(
        messageComponentsSource,
        /return cleaned\.trim\(\)\s*\|\|\s*label/,
        'cleanEventLabel should preserve original label as fallback when cleaning removes everything',
    );
});
