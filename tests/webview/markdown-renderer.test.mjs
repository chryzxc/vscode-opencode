import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const markdownRendererSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'MarkdownRenderer.tsx')],
  'MarkdownRenderer.tsx',
);

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

// ── Regression: AI response markdown must parse correctly ────────────────────

test('AssistantMessage uses MarkdownRenderer without isPreParsed flag', () => {
  // The actual logic is in AssistantMessageInner, not AssistantMessage
  assert.match(
    messageComponentsSource,
    /<MarkdownRenderer\s+content=\{content\}/,
    'AssistantMessage must pass raw markdown content to MarkdownRenderer without forcing isPreParsed.',
  );
});

test('AssistantMessage renders plain text while stream is active and markdown after completion', () => {
  // The actual logic is in AssistantMessageInner
  assert.match(
    messageComponentsSource,
    /const isLiveStreamingCard = !message && !!streaming\?\.isActive/,
    'AssistantMessage should distinguish between live streaming cards and completed messages',
  );
  assert.match(
    messageComponentsSource,
    /const showResponseSection = hasResponseContent/,
    'AssistantMessage should show response section based on hasResponseContent',
  );
});

// ── File icon injection ──────────────────────────────────────────────────────

test('injectFileIcons uses VS Code theme CSS classes and SVG fallback for unrecognised extensions', () => {
  // The file-icon span is initially EMPTY — the VS Code theme injects the icon via
  // a CSS ::before pseudo-element. After paint, a requestAnimationFrame check injects
  // an SVG fallback only for extensions whose ::before has no backgroundImage.
  const injectBody = extractFunctionBody(markdownRendererSource, 'function injectFileIcons(');
  assert.match(
    injectBody,
    /file-icon-type-\$\{cleanKey/,
    'injectFileIcons should add file-icon-type-* CSS classes for the VS Code theme icon.',
  );
  // The walk phase must NOT set innerHTML (that causes duplicates with the theme ::before icon)
  assert.doesNotMatch(
    injectBody,
    /iconEl\.innerHTML/,
    'injectFileIcons must not eagerly set innerHTML on the icon span during the walk.',
  );
  // The rAF fallback must be present to cover extensions the theme has no icon for
  assert.match(
    injectBody,
    /requestAnimationFrame/,
    'injectFileIcons should use requestAnimationFrame to inject a fallback SVG after paint.',
  );
  assert.match(
    injectBody,
    /makeFileSvg/,
    'injectFileIcons should call makeFileSvg for the fallback icon.',
  );
  assert.match(
    markdownRendererSource,
    /EXT_COLORS/,
    'EXT_COLORS should still be used to color-code the path text.',
  );
});




test('icon key sanitization is applied to file names and extensions', () => {
  // The cleanKey inline helper must apply the same transforms as FileIcon in
  // MessageComponents.tsx so generated CSS classes stay in sync with the icon theme.
  const injectBody = extractFunctionBody(markdownRendererSource, 'function injectFileIcons(');
  assert.match(injectBody, /replace\(\/\\\.\/g/, 'cleanKey should replace dots');
  assert.match(injectBody, /replace\(\/\\\+\/g/, 'cleanKey should replace plus signs');
  const replaceCalls = Array.from(injectBody.matchAll(/\.replace\(/g));
  assert.ok(replaceCalls.length >= 4, 'cleanKey should have at least 4 replace calls');
});

test('injectFileIcons skips PRE code blocks', () => {
  const injectBody = extractFunctionBody(markdownRendererSource, 'function injectFileIcons(');
  assert.match(
    injectBody,
    /tagName\s*===\s*['"]PRE['"]/,
    'injectFileIcons must skip PRE blocks to avoid mangling code samples.',
  );
});

// ── Click-to-open file paths ─────────────────────────────────────────────────

test('injectFileIcons posts openFile message on click', () => {
  const injectBody = extractFunctionBody(markdownRendererSource, 'function injectFileIcons(');
  assert.match(
    injectBody,
    /type:\s*['"]openFile['"]/,
    'injectFileIcons click handler must post an openFile message.',
  );
});

test('injectFileIcons uses capture group 2 for file path (not group 1 which is the boundary char)', () => {
  const injectBody = extractFunctionBody(markdownRendererSource, 'function injectFileIcons(');
  assert.match(
    injectBody,
    /match\[2\]/,
    'injectFileIcons must use match[2] as the file path (group 1 is the boundary char).',
  );
});

// ── acquireVsCodeApi double-call guard ───────────────────────────────────────
// VS Code only allows acquireVsCodeApi() to be called ONCE. A second call throws
// and crashes the webview with a blank screen and no console output.

test('MarkdownRenderer must NOT call acquireVsCodeApi directly', () => {
  assert.doesNotMatch(
    markdownRendererSource,
    /acquireVsCodeApi\s*\(\s*\)/,
    'MarkdownRenderer must not call acquireVsCodeApi() — a duplicate call crashes the VS Code webview.',
  );
});

test('MarkdownRenderer imports vscode from the shared singleton', () => {
  assert.match(
    markdownRendererSource,
    /import\s+vscode\s+from/,
    'MarkdownRenderer must import the vscode singleton rather than acquiring a new instance.',
  );
});

// ── Numbered list preprocessing ───────────────────────────────────────────────

test('MarkdownRenderer preprocesses markdown to remove blank lines between numbered list items', () => {
  const preprocessBody = extractFunctionBody(markdownRendererSource, 'function preprocessMarkdown(');
  assert.ok(
    preprocessBody.includes('return content.replace'),
    'MarkdownRenderer must export a preprocessMarkdown function that uses replace.',
  );
  assert.match(
    preprocessBody,
    /\\d\+\\\.\\s\+/,
    'preprocessMarkdown must use a regex that matches numbered list markers (e.g., "1. ").',
  );
  assert.match(
    preprocessBody,
    /\\n\\s\*\\n/,
    'preprocessMarkdown must match blank lines between list items.',
  );
  assert.match(
    preprocessBody,
    /\$1\$2\\n/,
    'preprocessMarkdown must replace blank lines with single newlines to merge list items.',
  );
});

test('MarkdownRenderer applies preprocessing when isPreParsed is false', () => {
  assert.match(
    markdownRendererSource,
    /const\s+processedContent\s*=\s*isPreParsed\s*\?\s*content\s*:\s*preprocessMarkdown/,
    'MarkdownRenderer must apply preprocessMarkdown when isPreParsed is false.',
  );
});

test('MarkdownRenderer does NOT apply preprocessing when isPreParsed is true', () => {
  assert.match(
    markdownRendererSource,
    /const\s+html\s*=\s*isPreParsed\s*\?\s*content\s*:/,
    'MarkdownRenderer must skip preprocessing when isPreParsed is true.',
  );
});
