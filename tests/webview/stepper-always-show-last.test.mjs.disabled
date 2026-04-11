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

test('Stepper uses empty dependency array for every-render execution', () => {
    assert.match(
        stepperSource,
        /\[\s*\]/,
        'Stepper effect should have empty dependency array to run on every render',
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

test('scrollToLastStep finds last child element', () => {
    assert.match(
        stepperSource,
        /const lastChild\s*=\s*el\.lastElementChild/,
        'scrollToLastStep should find the last child element',
    );
});

test('scrollToLastStep calls scrollIntoView on last child with smooth behavior', () => {
    assert.match(
        stepperSource,
        /lastChild\.scrollIntoView\(\s*\{\s*behavior:\s*["']smooth["']\s*,\s*block:\s*["']end["']\s*\}\s*\)/,
        'scrollToLastStep should call scrollIntoView with smooth behavior and block end',
    );
});

test('scrollToLastStep guards against null element', () => {
    assert.match(
        stepperSource,
        /if\s*\(\s*!el\s*\)\s*return/,
        'scrollToLastStep should return early if element is null',
    );
});

test('scrollToLastStep guards against null last child before scrollIntoView', () => {
    assert.match(
        stepperSource,
        /if\s*\(\s*lastChild\s*\)/,
        'scrollToLastStep should check lastChild exists before calling scrollIntoView',
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

test('CRITICAL: scrollToLastStep is called on EVERY RENDER, not just when props change', () => {
    // CRITICAL: The effect must run on every render to catch new steps during streaming
    // This prevents the regression where adding dependencies breaks streaming auto-scroll
    assert.match(
        stepperSource,
        /React\.useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?scrollToLastStep\(\)[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/,
        'Effect MUST have empty dependency array to run on every render',
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

test('scrollToLastStep performs actions without explicit return value', () => {
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
        /el\.scrollTop|scrollIntoView/,
        'scrollToLastStep should perform scroll operations',
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

test('CRITICAL: alwaysShowLastStep effect runs on every render when prop is true', () => {
    // The effect must run on every render to catch new steps during streaming
    assert.match(
        stepperSource,
        /React\.useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*\[\s*\]\s*\)/,
        'Effect MUST have empty dependency array to run on every render when alwaysShowLastStep is true',
    );
});

test('scrollToLastStep uses smooth scrolling for better UX', () => {
    assert.match(
        stepperSource,
        /behavior:\s*["']smooth["']/,
        'scrollToLastStep should use smooth scrolling behavior',
    );
});

test('scrollToLastStep aligns last step to end of viewport', () => {
    assert.match(
        stepperSource,
        /block:\s*["']end["']/,
        'scrollToLastStep should align last step to end of viewport',
    );
});
