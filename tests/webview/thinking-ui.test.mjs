import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, readSource, joinFromRoot } from '../helpers/source-utils.mjs';

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

    assert.match(
        messageComponentsSource,
        /subagents\.length > 0/,
        'Expected hasStreamingActivity to check streaming subagent activity',
    );

    // Ensure showStreamingLoading uses the negation of the guard
    assert.match(
        messageComponentsSource,
        /const showStreamingLoading\s*=\s*!message && !!streaming\?\.isActive && !hasStreamingActivity;/,
        "Expected showStreamingLoading to hide 'Thinking...' when streaming has activity",
    );
});

test("MessageComponents uses rotating thinking status text and handles response visibility", () => {
    assert.match(
        messageComponentsSource,
        /THINKING.*TEXT|thinkingText|loadingText/i,
        'Expected rotating thinking status messages to exist',
    );
    assert.match(
        messageComponentsSource,
        /function ThinkingStatusTicker|ThinkingStatusTicker\s*=/,
        'Expected ThinkingStatusTicker component to exist',
    );
    assert.match(
        messageComponentsSource,
        /FadeSwapText/,
        'Expected text animation component to be used',
    );
    assert.match(
        messageComponentsSource,
        /response|showResponse|hasResponseContent/i,
        'Expected response section visibility logic to exist',
    );
    assert.match(
        messageComponentsSource,
        /{[\s\S]*showResponseSection|hasResponseContent[\s\S]*<section/,
        'Expected response panel rendering with visibility control',
    );
    assert.match(
        messageComponentsSource,
        /showResponseSection\s*=\s*[\s\S]*timelineDisplayEvents\.length > 0/,
        'Expected the response section to stay visible when timeline activity exists even without response text',
    );
});

test('MessageComponents merges reasoning chunks by message and part id', () => {
    const body = extractFunctionBody(
        messageComponentsSource,
        'function thoughtItemsFromRawEventPayloads(',
    );

    assert.match(
        body,
        /const mergeKey = `\$\{messageID \|\| "message"\}:\$\{partID \|\| "part"\}`;/,
        'Expected reasoning chunks to be grouped by messageID and partID',
    );

    assert.match(
        body,
        /if \(existing\) \{[\s\S]*existing\.text = nextText;[\s\S]*continue;[\s\S]*\}/,
        'Expected later reasoning chunks to update the same live item instead of creating duplicates',
    );
});
