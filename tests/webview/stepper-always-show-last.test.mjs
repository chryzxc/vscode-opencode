/**
 * Stepper Always Show Last Step Tests
 *
 * Tests the new alwaysShowLastStep functionality that ensures the last step
 * is always visible on every render, and the scrollToLastStep method that
 * can be called programmatically.
 *
 * Covered areas:
 * - alwaysShowLastStep prop wiring
 * - scrollToLastStep method implementation
 * - scrollIntoView behavior for last child element
 * - React.useImperativeHandle for exposing scrollToLastStep
 * - Effect triggering for alwaysShowLastStep
 * - Integration with existing autoScrollToBottom
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

const stepperSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'stepper.tsx')],
    'stepper.tsx',
);

// ---------------------------------------------------------------------------
// 1. alwaysShowLastStep prop
// ---------------------------------------------------------------------------

test('Stepper accepts alwaysShowLastStep prop', () => {
    assert.match(
        stepperSource,
        /alwaysShowLastStep\?\s*:\s*boolean/,
        'Stepper props type should declare optional alwaysShowLastStep boolean',
    );
});

test('Stepper useLayoutEffect includes children in deps to catch new steps during streaming', () => {
    assert.match(
        stepperSource,
        /React\.useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[autoScrollToBottom,\s*alwaysShowLastStep,\s*children,\s*scrollToLastStep\]\s*\)/,
        'Stepper effect should include children in deps so new steps trigger scroll',
    );
});

test('Stepper triggers scroll when alwaysShowLastStep is true', () => {
    assert.match(
        stepperSource,
        /if\s*\(\s*autoScrollToBottom\s*\|\|\s*alwaysShowLastStep\s*\)/,
        'Stepper should trigger scroll when either autoScrollToBottom or alwaysShowLastStep is true',
    );
});

// ---------------------------------------------------------------------------
// 2. scrollToLastStep method implementation
// ---------------------------------------------------------------------------

test('Stepper implements scrollToLastStep method', () => {
    assert.match(
        stepperSource,
        /const scrollToLastStep\s*=\s*React\.useCallback/,
        'Stepper should implement scrollToLastStep as a useCallback hook',
    );
});

test('scrollToLastStep scrolls container to bottom using scrollTop', () => {
    assert.match(
        stepperSource,
        /el\.scrollTop\s*=\s*el\.scrollHeight/,
        'scrollToLastStep should set scrollTop to scrollHeight to scroll to bottom',
    );
});

test('scrollToLastStep scrolls container to bottom using scrollTop', () => {
    assert.match(
        stepperSource,
        /el\.scrollTop\s*=\s*el\.scrollHeight/,
        'scrollToLastStep should set scrollTop to scrollHeight to scroll to bottom',
    );
});

test('scrollToLastStep guards against null element', () => {
    assert.match(
        stepperSource,
        /if\s*\(\s*!el\s*\)\s*return/,
        'scrollToLastStep should return early if element is null',
    );
});

// ---------------------------------------------------------------------------
// 3. React.useImperativeHandle for exposing scrollToLastStep
// ---------------------------------------------------------------------------

test('Stepper uses React.useImperativeHandle to expose scrollToLastStep', () => {
    assert.match(
        stepperSource,
        /React\.useImperativeHandle\(/,
        'Stepper should use useImperativeHandle to expose methods through ref',
    );
});

test('useImperativeHandle depends on scrollToLastStep', () => {
    assert.match(
        stepperSource,
        /React\.useImperativeHandle\([\s\S]*?\[scrollToLastStep\]/,
        'useImperativeHandle should have scrollToLastStep in dependency array',
    );
});

test('useImperativeHandle returns object with scrollToLastStep method', () => {
    assert.match(
        stepperSource,
        /return\s*\{[\s\S]*?\.\.\.el,[\s\S]*?scrollToLastStep,[\s\S]*?\}/,
        'useImperativeHandle should return object containing scrollToLastStep method',
    );
});

test('useImperativeHandle spreads native element properties', () => {
    assert.match(
        stepperSource,
        /\.\.\.el/,
        'useImperativeHandle should spread native element properties for full DOM access',
    );
});

// ---------------------------------------------------------------------------
// 4. Integration with existing autoScrollToBottom
// ---------------------------------------------------------------------------

test('Stepper effect triggers on both autoScrollToBottom and alwaysShowLastStep', () => {
    assert.match(
        stepperSource,
        /if\s*\(\s*autoScrollToBottom\s*\|\|\s*alwaysShowLastStep\s*\)\s*\{[\s\S]*?scrollToLastStep\(\)/,
        'Stepper effect should call scrollToLastStep when either prop is true',
    );
});

test('CRITICAL: scrollToLastStep is called when children change (new steps during streaming)', () => {
    // The effect runs when children change, ensuring new steps trigger scroll
    assert.match(
        stepperSource,
        /React\.useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?scrollToLastStep\(\)[\s\S]*?\}\s*,\s*\[autoScrollToBottom,\s*alwaysShowLastStep,\s*children,\s*scrollToLastStep\]/,
        'Effect must include children in deps to scroll when new steps are added during streaming',
    );
});

// ---------------------------------------------------------------------------
// 5. Method signatures and TypeScript types
// ---------------------------------------------------------------------------

test('scrollToLastStep is implemented as useCallback', () => {
    assert.match(
        stepperSource,
        /const scrollToLastStep\s*=\s*React\.useCallback\(\s*\(\)\s*=>/,
        'scrollToLastStep should be implemented as useCallback with no parameters',
    );
});

test('scrollToLastStep performs scroll via scrollTop assignment', () => {
    // Check that scrollToLastStep contains scroll operations but doesn't return a value
    const scrollToLastStepMatch = stepperSource.match(
        /const scrollToLastStep\s*=\s*React\.useCallback\([\s\S]*?\n\s*\}/
    );
    assert.ok(
        scrollToLastStepMatch,
        'scrollToLastStep function should exist',
    );
    // Check it contains scroll operations
    assert.match(
        scrollToLastStepMatch[0],
        /el\.scrollTop/,
        'scrollToLastStep should perform scroll operations via scrollTop',
    );
});

// ---------------------------------------------------------------------------
// 6. Edge cases and safety
// ---------------------------------------------------------------------------

test('scrollToLastStep has empty dependency array in useCallback', () => {
    assert.match(
        stepperSource,
        /React\.useCallback\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/,
        'scrollToLastStep useCallback should have empty dependency array (stable reference)',
    );
});

test('Stepper component forwards ref to useImperativeHandle', () => {
    assert.match(
        stepperSource,
        /React\.useImperativeHandle\(\s*forwardedRef/,
        'useImperativeHandle should use forwardedRef as first argument',
    );
});

// ---------------------------------------------------------------------------
// 7. Behavior expectations
// ---------------------------------------------------------------------------

test('CRITICAL: alwaysShowLastStep effect runs when children change during streaming', () => {
    // The effect includes children in deps, ensuring new steps trigger scroll
    assert.match(
        stepperSource,
        /React\.useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?autoScrollToBottom\s*\|\|\s*alwaysShowLastStep[\s\S]*?scrollToLastStep\(\)[\s\S]*?\}\s*,\s*\[.*children/s,
        'Effect must include children to run when new steps appear during streaming',
    );
});

test('scrollToLastStep uses direct scrollTop assignment for container-only scrolling', () => {
    assert.match(
        stepperSource,
        /el\.scrollTop\s*=\s*el\.scrollHeight/,
        'scrollToLastStep should use scrollTop assignment for container-only scrolling',
    );
});
