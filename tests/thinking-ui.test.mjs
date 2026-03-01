import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot } from './helpers/source-utils.mjs';

const messageComponentsSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
    'MessageComponents.tsx',
);

test("MessageComponents declares hasStreamingActivity and guards 'Thinking...' UI", () => {
    // Ensure the new guard variable exists
    assert.match(
        messageComponentsSource,
        /const hasStreamingActivity\s*=\s*!!\(/,
        'Expected hasStreamingActivity declaration to be present',
    );

    // Ensure the guard checks for streaming.content and streaming.reasoning
    assert.match(
        messageComponentsSource,
        /streaming\.content\s*&&\s*String\(streaming\.content\)\.trim\(\)\.length > 0/,
        'Expected hasStreamingActivity to check streaming.content',
    );

    assert.match(
        messageComponentsSource,
        /streaming\.reasoning\s*&&\s*String\(streaming\.reasoning\)\.trim\(\)\.length > 0/,
        'Expected hasStreamingActivity to check streaming.reasoning',
    );

    // Ensure it checks reasoningEvents, progressEvents and steps arrays
    assert.match(
        messageComponentsSource,
        /Array\.isArray\(streaming\.reasoningEvents\)\s*&&\s*streaming\.reasoningEvents\.length > 0/,
        'Expected hasStreamingActivity to check streaming.reasoningEvents',
    );

    assert.match(
        messageComponentsSource,
        /Array\.isArray\(streaming\.progressEvents\)\s*&&\s*streaming\.progressEvents\.length > 0/,
        'Expected hasStreamingActivity to check streaming.progressEvents',
    );

    assert.match(
        messageComponentsSource,
        /Array\.isArray\(streaming\.steps\)\s*&&\s*streaming\.steps\.length > 0/,
        'Expected hasStreamingActivity to check streaming.steps',
    );

    // Ensure showStreamingLoading uses the negation of the guard
    assert.match(
        messageComponentsSource,
        /const showStreamingLoading = !message && !!streaming\?\.isActive && !hasStreamingActivity;/,
        "Expected showStreamingLoading to hide 'Thinking...' when streaming has activity",
    );
});
