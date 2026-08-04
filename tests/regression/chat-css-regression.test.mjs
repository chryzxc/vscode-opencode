import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const chatCssSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'index.css')],
  'chat index.css',
);
const postcssConfigSource = readSource(
  [joinFromRoot('webview', 'shared', 'postcss.config.js')],
  'postcss config',
);
const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'chat shell source',
);
const panelComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'panel components source',
);
const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'message components source',
);

test('chat source css keeps active Tailwind directives', () => {
  assert.match(chatCssSource, /^\s*@tailwind\s+base\s*;/m, 'chat source css must include @tailwind base directive');
  assert.match(chatCssSource, /^\s*@tailwind\s+components\s*;/m, 'chat source css must include @tailwind components directive');
  assert.match(chatCssSource, /^\s*@tailwind\s+utilities\s*;/m, 'chat source css must include @tailwind utilities directive');
  assert.doesNotMatch(
    chatCssSource,
    /\/\*\s*@tailwind\s+base;[\s\S]*@tailwind\s+utilities;\s*\*\//,
    'tailwind directives must not be left commented out',
  );
});

test('chat css pipeline keeps Tailwind enabled for utility-heavy React chat components', () => {
  assert.match(postcssConfigSource, /tailwindcss\s*:\s*\{\s*\}/, 'postcss config must include tailwindcss plugin');
  assert.match(chatShellSource, /className="[^"]*\bh-screen\b[^"]*"/, 'chat shell should continue using Tailwind utility classes');
  assert.match(panelComponentsSource, /className="[^"]*\brounded-md\b[^"]*"/, 'panel components should continue using Tailwind utility classes');
  assert.match(panelComponentsSource, /className="[^"]*\bpx-3\b[^"]*"/, 'panel components should continue using spacing utility classes');
});

test('details tabs use one shared content gutter with an overview reset', () => {
  assert.match(
    chatCssSource,
    /\.oc-details-sheet\s+\.oc-details-tab-content\s*\{[^}]*box-sizing:\s*border-box;[^}]*padding:\s*8px\s+8px\s+10px;/s,
    'all details tabs should align through the shared horizontal and vertical content gutter',
  );
  assert.match(
    chatCssSource,
    /\.oc-details-sheet\s+\.oc-details-tab-content--overview\s*\{[^}]*padding-top:\s*0;[^}]*padding-right:\s*0;[^}]*padding-left:\s*0;/s,
    'overview should remove only its duplicate inner gutter while retaining the shared tab contract',
  );
});

test('Active Task is a peer overview section instead of a parent heading', () => {
  assert.match(
    panelComponentsSource,
    /className="oc-active-task-content[^\"]*"[\s\S]*?<MiniSection title="Active Task" className="order-2">/,
    'Active Task should use the same MiniSection row as Context, Runtime, and Session',
  );
  assert.doesNotMatch(
    panelComponentsSource,
    /oc-panel-title">Active Task</,
    'Active Task should not render a separate parent heading above the overview sections',
  );
  assert.doesNotMatch(
    panelComponentsSource,
    /<MiniSection title="Todo Checklist">/,
    'the checklist content should not introduce a second nested section title',
  );
});

test('overview section headers use labels and chevrons without decorative dots', () => {
  assert.doesNotMatch(
    panelComponentsSource,
    /inline-block h-1\.5 w-1\.5 rounded-full transition-colors/,
    'MiniSection headers should not render a low-contrast decorative status dot',
  );
  assert.doesNotMatch(
    chatCssSource,
    /\.oc-details-sheet\s+\.oc-inspector-section-toggle\s*>\s*span:first-child\s*\{[^}]*width:\s*5px/s,
    'the first section-header span is its label, not a dot that needs dot sizing styles',
  );
});

test('active checklist progress marker uses the themed status indicator', () => {
  assert.match(
    panelComponentsSource,
    /oc-todo-progress-indicator[\s\S]*aria-label="In progress"/,
    'in-progress checklist items should use the themed progress marker',
  );
  assert.doesNotMatch(
    panelComponentsSource,
    /case "in_progress"[\s\S]*<RefreshCw className="h-2\.5 w-2\.5 animate-spin" \/>/,
    'the active checklist marker should not render the bright refresh glyph',
  );
  assert.match(
    chatCssSource,
    /\.oc-todo-progress-indicator::before[\s\S]*border-top-color:[\s\S]*animation:\s*oc-todo-progress-spin/,
    'the active checklist marker should use an accent arc animation',
  );
});

test('active compaction uses the shared card border token', () => {
  assert.match(
    chatCssSource,
    /\.oc-compaction-progress\s*\{[^}]*border:\s*1px solid var\(--oc-border\);/s,
    'the active compaction card should use the same visible border token as chat cards',
  );
  assert.match(
    chatCssSource,
    /\.oc-compaction-progress-icon\s*\{[^}]*border:\s*1px solid var\(--oc-border\);/s,
    'the active compaction icon should use the shared card border token',
  );
  assert.match(
    chatCssSource,
    /\.oc-compaction-progress-icon\s*\{[^}]*color:\s*var\(--oc-text\);/s,
    'the active compaction icon should use a visible foreground color',
  );
});

test('activity path tooltips use an owned opaque surface', () => {
  assert.match(
    chatCssSource,
    /\.oc-activity-path-tooltip::after\s*\{[\s\S]*?background:\s*var\(--oc-panel\);[\s\S]*?border:\s*1px solid var\(--oc-border\);/s,
    'activity path tooltips should have an opaque themed background and visible border',
  );
  assert.match(
    chatCssSource,
    /\.oc-activity-path-tooltip:hover::after,[\s\S]*?\.oc-activity-path-tooltip:focus-visible::after/s,
    'activity path tooltips should open on hover and keyboard focus',
  );
  assert.match(
    chatCssSource,
    /\.oc-refined-file-link-tooltip\s*\{[\s\S]*?background:\s*var\(--vscode-editor-background, var\(--oc-panel\)\);/s,
    'refined file-link tooltips should use an opaque editor surface instead of a translucent mix',
  );
});

test('response previews stay contained inside activity cards', () => {
  assert.match(
    messageComponentsSource,
    /const responseSectionClass = hasResponseContent\s*\? "min-w-0 max-w-full overflow-hidden rounded-md border border-oc-border-soft bg-background p-2\.5 shadow-sm"/,
    'response cards must clip oversized activity output to their own boundary',
  );
  assert.match(
    messageComponentsSource,
    /"relative min-w-0 max-w-full mt-1\.5 space-y-1\.5",\s*shouldConstrainResponsePreview && "max-h-32 overflow-hidden"/,
    'the bounded response preview must shrink with its card so its expand control remains visible',
  );
});

test('expanded response previews retain their collapse control', () => {
  assert.match(
    messageComponentsSource,
    /if \(!preview\) \{\s*setHasResponseOverflow\(false\);\s*return;\s*}\s*if \(!shouldConstrainResponsePreview\) return;/s,
    'expanding a response must preserve its measured overflow state so Show less remains available',
  );
});

// ── Markdown list styling regression tests ───────────────────────────────────────

test('markdown-body ordered lists must display with decimal numbers (not bullets)', () => {
  assert.match(
    chatCssSource,
    /\.markdown-body\s+ol\s*\{[^}]*list-style-type:\s*decimal/,
    'markdown-body ordered lists (ol) must explicitly use list-style-type: decimal to ensure numbers display correctly.',
  );
});

test('markdown-body unordered lists must display with disc bullets', () => {
  assert.match(
    chatCssSource,
    /\.markdown-body\s+ul\s*\{[^}]*list-style-type:\s*disc/,
    'markdown-body unordered lists (ul) must explicitly use list-style-type: disc.',
  );
});

test('markdown-body lists must have separate rules for ul and ol (not combined)', () => {
  // Check that there are separate .markdown-body ul and .markdown-body ol rules
  const ulRule = /\.markdown-body\s+ul\s*\{/;
  const olRule = /\.markdown-body\s+ol\s*\{/;

  assert.match(
    chatCssSource,
    ulRule,
    'CSS must have a separate rule for .markdown-body ul',
  );
  assert.match(
    chatCssSource,
    olRule,
    'CSS must have a separate rule for .markdown-body ol',
  );

  // Verify they appear in the right order (ul before ol) and are distinct rules
  const ulMatch = chatCssSource.match(ulRule);
  const olMatch = chatCssSource.match(olRule);
  assert.ok(ulMatch && olMatch, 'Both ul and ol rules must exist');
});

test('markdown-body code blocks must include a visible copy button affordance', () => {
  assert.match(
    chatCssSource,
    /\.markdown-body\s+pre\.markdown-code-block\s+\.markdown-copy-button\s*\{/,
    'markdown code blocks must style the persistent copy button inside the pre container.',
  );
  assert.match(
    chatCssSource,
    /\.markdown-body\s+pre\s*\{\s*[^}]*padding:\s*1\.7em\s+0\.85em\s+0\.8em;/s,
    'markdown code blocks need extra top padding so the copy control does not overlap the first line.',
  );
});
