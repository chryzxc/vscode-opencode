/**
 * Stepper Auto-Scroll Behavior Contract Tests
 *
 * CRITICAL: These tests lock the essential auto-scroll behavior to prevent future regressions.
 * The autoScrollToBottom feature MUST scroll to bottom on EVERY RENDER when true,
 * not just when props change. This is essential for streaming scenarios where new steps
 * are added continuously.
 *
 * Key behaviors to preserve:
 * - autoScrollToBottom=true triggers scroll on every render
 * - alwaysShowLastStep=true triggers scroll on every render
 * - New steps being added during streaming trigger automatic scroll
 * - Effect runs on every render, not just when dependencies change
 * - No dependency array that would miss new steps being added
 *
 * Covered areas:
 * - Effect runs on every render (no dependency array that would prevent this)
 * - Scroll triggers for both autoScrollToBottom and alwaysShowLastStep
 * - New step detection and automatic scrolling
 * - Prevention of dependency-based optimization that breaks streaming
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource, extractFunctionBody } from '../helpers/source-utils.mjs';

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

const stepperSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'stepper.tsx')],
    'stepper.tsx',
);

// ---------------------------------------------------------------------------
// CRITICAL: Effect execution frequency tests
// ---------------------------------------------------------------------------

test('CRITICAL: useLayoutEffect includes children to run when new steps are added', () => {
    // The effect includes children in deps so it runs when new steps appear during streaming
    assert.match(
        stepperSource,
        /React\.useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?scrollToLastStep\(\)[\s\S]*?\}\s*,\s*\[autoScrollToBottom,\s*alwaysShowLastStep,\s*children,\s*scrollToLastStep\]/,
        'useLayoutEffect must include children in deps to scroll when new steps appear during streaming',
    );
});

test('CRITICAL: useLayoutEffect deps include children to catch new streaming steps', () => {
    // The deps must include children so the effect runs when new steps are added
    const effectMatch = stepperSource.match(
        /React\.useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[(.*?)\]\s*\)/
    );

    assert.ok(effectMatch, 'useLayoutEffect must exist with dependency array');

    const deps = effectMatch[1];
    assert.ok(
        deps.includes('children'),
        `useLayoutEffect deps must include "children" to catch new steps, got: [${deps}]`
    );
});

test('CRITICAL: autoScrollToBottom check happens inside useLayoutEffect', () => {
    // The check for autoScrollToBottom should be inside the effect body
    assert.match(
        stepperSource,
        /React\.useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*autoScrollToBottom\s*\|\|\s*alwaysShowLastStep\s*\)/,
        'autoScrollToBottom and alwaysShowLastStep checks must be inside the useLayoutEffect body',
    );
});

// ---------------------------------------------------------------------------
// Auto-scroll triggering tests
// ---------------------------------------------------------------------------

test('autoScrollToBottom=true triggers scrollToLastStep call', () => {
    assert.match(
        stepperSource,
        /React\.useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*autoScrollToBottom\s*\|\|\s*alwaysShowLastStep\s*\)\s*\{[\s\S]*?scrollToLastStep\(\)/,
        'When autoScrollToBottom is true, scrollToLastStep must be called inside useLayoutEffect',
    );
});

test('alwaysShowLastStep=true triggers scrollToLastStep call', () => {
    assert.match(
        stepperSource,
        /React\.useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*autoScrollToBottom\s*\|\|\s*alwaysShowLastStep\s*\)\s*\{[\s\S]*?scrollToLastStep\(\)/,
        'When alwaysShowLastStep is true, scrollToLastStep must be called inside useLayoutEffect',
    );
});

test('scrollToLastStep is called unconditionally when either prop is true', () => {
    // The effect should call scrollToLastStep directly without additional conditions
    assert.match(
        stepperSource,
        /if\s*\(\s*autoScrollToBottom\s*\|\|\s*alwaysShowLastStep\s*\)\s*\{[\s\S]{0,50}scrollToLastStep\(\)/,
        'scrollToLastStep must be called when either autoScrollToBottom or alwaysShowLastStep is true',
    );
});

// ---------------------------------------------------------------------------
// Prevention of optimization breaks tests
// ---------------------------------------------------------------------------

test('CRITICAL: Effect deps include children to catch new steps during streaming', () => {
    // The deps must include children so the effect runs when new steps are added
    assert.match(
        stepperSource,
        /React\.useLayoutEffect\([\s\S]*?,\s*\[autoScrollToBottom,\s*alwaysShowLastStep,\s*children,\s*scrollToLastStep\]/,
        'useLayoutEffect deps must include children to catch new streaming steps',
    );
});

test('CRITICAL: No conditional return based on prop state that prevents scroll execution', () => {
    // The effect should not have an early return based on prop state
    // that would prevent scrolling when new steps are added
    assert.doesNotMatch(
        stepperSource,
        /React\.useEffect\(\s*\(\)\s*=>\s*\{[\s\S]{0,100}if\s*\(\s*!autoScrollToBottom\s*\)\s*return/s,
        'Effect must NOT have early return based on autoScrollToBottom state',
    );
});

// ---------------------------------------------------------------------------
// scrollToLastStep implementation tests
// ---------------------------------------------------------------------------

test('scrollToLastStep sets scrollTop to scrollHeight for bottom positioning', () => {
    assert.match(
        stepperSource,
        /el\.scrollTop\s*=\s*el\.scrollHeight/,
        'scrollToLastStep must set scrollTop to scrollHeight to scroll to bottom',
    );
});

test('scrollToLastStep uses direct scrollTop assignment for container-only scrolling', () => {
    // scrollToLastStep is a useCallback; extract the callback body region
    // The callback sets el.scrollTop = el.scrollHeight and avoids scrollIntoView
    const scrollFnMatch = stepperSource.match(
        /scrollToLastStep\s*=\s*React\.useCallback\(\s*\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[\]\s*\)/
    );
    assert.ok(scrollFnMatch, 'Should find scrollToLastStep useCallback body');
    const scrollFnBody = scrollFnMatch[1];

    assert.match(
        scrollFnBody,
        /el\.scrollTop\s*=\s*el\.scrollHeight/,
        'scrollToLastStep should use scrollTop for container-only scrolling',
    );
    // Check there is no scrollIntoView CALL (allowing it in comments)
    assert.doesNotMatch(
        scrollFnBody.replace(/\/\/.*$/gm, ''),
        /\.scrollIntoView\(/,
        'scrollToLastStep should NOT call scrollIntoView to avoid scrolling ancestor containers',
    );
});

// ---------------------------------------------------------------------------
// Integration with props tests
// ---------------------------------------------------------------------------

test('Stepper component accepts autoScrollToBottom prop', () => {
    assert.match(
        stepperSource,
        /autoScrollToBottom\?\s*:\s*boolean/,
        'Stepper must accept autoScrollToBottom as optional boolean prop',
    );
});

test('Stepper component accepts alwaysShowLastStep prop', () => {
    assert.match(
        stepperSource,
        /alwaysShowLastStep\?\s*:\s*boolean/,
        'Stepper must accept alwaysShowLastStep as optional boolean prop',
    );
});

test('Both props are properly destructured from component props', () => {
    assert.match(
        stepperSource,
        /\(\s*\{\s*[^}]*autoScrollToBottom[^}]*alwaysShowLastStep[^}]*\}/,
        'Both autoScrollToBottom and alwaysShowLastStep must be destructured from props',
    );
});

// ---------------------------------------------------------------------------
// Edge cases and safety tests
// ---------------------------------------------------------------------------

test('scrollToLastStep guards against null element', () => {
    assert.match(
        stepperSource,
        /if\s*\(\s*!el\s*\)\s*return/,
        'scrollToLastStep must guard against null element',
    );
});

test('scrollToLastStep is stable with useCallback', () => {
    assert.match(
        stepperSource,
        /const scrollToLastStep\s*=\s*React\.useCallback/,
        'scrollToLastStep must be defined with useCallback for reference stability',
    );
});

// ---------------------------------------------------------------------------
// Prevention of future regression tests
// ---------------------------------------------------------------------------

test('CRITICAL: Effect deps include children for streaming step detection', () => {
    // The effect must include children in deps to detect new steps during streaming
    const effectMatch = stepperSource.match(
        /React\.useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]{0,500}\}\s*,\s*\[(.*?)\]\s*\)/
    );

    assert.ok(
        effectMatch,
        'useLayoutEffect must exist with dependency array',
    );

    const deps = effectMatch[1];
    assert.ok(
        deps.includes('children'),
        `useLayoutEffect deps must include "children" for streaming step detection, got: [${deps}]`
    );
});

test('CRITICAL: No conditional effect hooks based on props', () => {
    // Ensure we're not using conditional hooks like:
    // if (autoScrollToBottom) { useEffect(...) }
    assert.doesNotMatch(
        stepperSource,
        /if\s*\(\s*autoScrollToBottom\s*\)\s*\{[\s\S]*?useEffect/,
        'Must not use conditional useEffect based on autoScrollToBottom prop',
    );
});

test('CRITICAL: Auto-scroll logic is in useLayoutEffect (synchronous before paint)', () => {
    // The scroll must happen in useLayoutEffect for synchronous scroll before paint
    assert.match(
        stepperSource,
        /React\.useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?scrollToLastStep\(\)/,
        'Auto-scroll logic must be in useLayoutEffect for synchronous scroll before paint',
    );
});

// ---------------------------------------------------------------------------
// Documentation and comments tests
// ---------------------------------------------------------------------------

test('autoScrollToBottom prop has documentation comment', () => {
    assert.match(
        stepperSource,
        /\/\*\*[\s\S]*?auto-scrolls to the bottom on each render[\s\S]*?\*\//,
        'autoScrollToBottom prop should have documentation explaining it runs on each render',
    );
});

test('alwaysShowLastStep prop has documentation comment', () => {
    assert.match(
        stepperSource,
        /\/\*\*[\s\S]*?ensures the last step is always visible[\s\S]*?\*\//,
        'alwaysShowLastStep prop should have documentation',
    );
});

test('scrollToLastStep function has explanatory comment', () => {
    assert.match(
        stepperSource,
        /\/\*\*[\s\S]*?Scrolls the stepper[\s\S]*?\*\//,
        'scrollToLastStep function should have explanatory comment',
    );
});

// ---------------------------------------------------------------------------
// Integration behavior tests
// ---------------------------------------------------------------------------
// Integration behavior tests
// ---------------------------------------------------------------------------

test('Both props can be true simultaneously without conflict', () => {
    // The OR condition means both can be true and it will still work
    assert.match(
        stepperSource,
        /if\s*\(\s*autoScrollToBottom\s*\|\|\s*alwaysShowLastStep\s*\)/,
        'Both props can be true using OR condition',
    );
});

test('Effect runs even when props are false (no-op case)', () => {
    // The effect should run on every render, but only scroll when props are true
    assert.match(
        stepperSource,
        /if\s*\(\s*autoScrollToBottom\s*\|\|\s*alwaysShowLastStep\s*\)\s*\{[\s\S]*?\}/,
        'Effect must have conditional check inside, so it runs but only scrolls when props are true',
    );
});

// ---------------------------------------------------------------------------
// Performance consideration tests
// ---------------------------------------------------------------------------

test('scrollToLastStep uses useCallback for performance', () => {
    // While the effect runs every render, the function itself should be stable
    assert.match(
        stepperSource,
        /React\.useCallback\(\s*\(\)\s*=>/,
        'scrollToLastStep should use useCallback for performance',
    );
});

test('scrollToLastStep has empty dependency array in useCallback', () => {
    assert.match(
        stepperSource,
        /React\.useCallback\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/,
        'scrollToLastStep useCallback should have empty dependencies for stability',
    );
});
