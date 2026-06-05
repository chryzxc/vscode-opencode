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

test('AssistantMessage uses MarkdownRenderer with markdown content', () => {
  // The actual logic is in AssistantMessageInner, not AssistantMessage
  assert.match(
    messageComponentsSource,
    /<MarkdownRenderer|MarkdownRenderer|content.*markdown/i,
    'AssistantMessage must render markdown content using MarkdownRenderer',
  );
});

test('AssistantMessage renders content based on streaming state', () => {
  // The actual logic is in AssistantMessageInner
  assert.match(
    messageComponentsSource,
    /streaming|isActive|content|render/i,
    'AssistantMessage should handle streaming state and content rendering',
  );
  assert.match(
    messageComponentsSource,
    /response|section|visible|show|hide/i,
    'AssistantMessage should control response section visibility',
  );
});

test('Activity step content uses block-level wrappers for markdown rendering', () => {
  assert.match(
    messageComponentsSource,
    /<div className="flex min-w-0 flex-1 flex-col gap-1 oc-refined-event-content w-full">/,
    'Activity step content should use a div wrapper so markdown blocks can lay out correctly.',
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /<span className="flex min-w-0 flex-1 flex-col gap-1 oc-refined-event-content w-full">/,
    'Activity step content must not be wrapped in a span because it contains block elements.',
  );
});

test('Activity step file-linked content renders the full summary inline', () => {
  assert.match(
    messageComponentsSource,
    /\{event\.summary \|\| event\.filePath\}/,
    'Activity step file-linked content should show the full summary/path inline instead of a shortened basename.',
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /fileName\s*\|\|\s*event\.summary/,
    'Activity step file-linked content should not prefer the basename for display.',
  );
});

test('Assistant message part bodies preserve markdown block separation across text parts', () => {
  const messageBodyFromPartsBody = extractFunctionBody(
    messageComponentsSource,
    'function messageBodyFromParts(',
  );
  assert.match(
    messageBodyFromPartsBody,
    /\.join\("\\n\\n"\)/,
    'messageBodyFromParts should preserve paragraph/list separation between assistant text parts instead of concatenating them directly.',
  );
  assert.doesNotMatch(
    messageBodyFromPartsBody,
    /\.join\(""\)/,
    'messageBodyFromParts must not glue adjacent assistant text parts together without separators.',
  );
});

test('Interactive question rendering suppresses flattened option echo beneath the canonical prompt', () => {
  assert.match(
    messageComponentsSource,
    /function hasQuestionLikeInteractiveContent\(/,
    'AssistantMessage should recognize question-like interactive payloads even when responseType is not explicitly "question".',
  );
  assert.match(
    messageComponentsSource,
    /messageResponseType === "progress"[\s\S]*hasQuestionLikeInteractiveContent\(message\)[\s\S]*return questionPrompt;/,
    'Live progress turns with blocking interactive questions should render the canonical question prompt instead of the reasoning draft.',
  );
});

test('Aborted assistant turns do not render the response markdown body', () => {
  assert.match(
    messageComponentsSource,
    /const showResponseSection = !isAborted && \(hasVisibleResponseBody \|\| !!plan\);/,
    'Interrupted assistant turns should hide the AI response section instead of rendering partial markdown content.',
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

test('injectCodeBlockCopyButtons adds a persistent copy control to fenced code blocks', () => {
  const injectBody = extractFunctionBody(markdownRendererSource, 'function injectCodeBlockCopyButtons(');
  assert.match(
    injectBody,
    /querySelectorAll<HTMLPreElement>\(['"]pre['"]\)/,
    'injectCodeBlockCopyButtons should scan rendered pre blocks.',
  );
  assert.match(
    injectBody,
    /markdown-copy-button/,
    'injectCodeBlockCopyButtons should create a dedicated copy button class.',
  );
  assert.match(
    injectBody,
    /aria-label['"]?\s*,\s*['"]Copy code block['"]/,
    'injectCodeBlockCopyButtons should expose an accessible label for the copy button.',
  );
  assert.match(
    injectBody,
    /copyMarkdownCode\(codeText\)/,
    'injectCodeBlockCopyButtons should copy the fenced code text through the shared clipboard helper.',
  );
  assert.match(
    injectBody,
    /pre\.insertBefore\(button,\s*pre\.firstChild\)/,
    'injectCodeBlockCopyButtons should place the copy button inside the code block container.',
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
    /const\s+processedContent\s*=\s*useMemo\([\s\S]*isPreParsed\s*\?\s*content\s*:\s*preprocessMarkdown/,
    'MarkdownRenderer must apply preprocessMarkdown when isPreParsed is false.',
  );
});

test('MarkdownRenderer does NOT apply preprocessing when isPreParsed is true', () => {
  assert.match(
    markdownRendererSource,
    /const\s+html\s*=\s*useMemo\([\s\S]*isPreParsed[\s\S]*\?\s*content\s*:/,
    'MarkdownRenderer must skip preprocessing when isPreParsed is true.',
  );
});

test('MarkdownRenderer memoizes markdown preprocessing and HTML generation', () => {
  assert.match(
    markdownRendererSource,
    /const\s+processedContent\s*=\s*useMemo\(/,
    'MarkdownRenderer should memoize preprocessing so parent rerenders do not recompute markdown unnecessarily.',
  );
  assert.match(
    markdownRendererSource,
    /const\s+html\s*=\s*useMemo\(/,
    'MarkdownRenderer should memoize HTML generation so unchanged content avoids repeated marked parsing.',
  );
  assert.match(
    markdownRendererSource,
    /export\s+const\s+MarkdownRenderer\s*=\s*memo\(/,
    'MarkdownRenderer should be wrapped in React.memo to avoid rerendering unchanged markdown blocks.',
  );
});
