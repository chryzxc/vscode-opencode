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

test('details overview uses the same content gutter as the other tabs', () => {
  assert.match(
    chatCssSource,
    /\.oc-details-sheet\s+\.oc-details-tab-content--overview\s*\{[^}]*padding:\s*8px\s+0\s+10px;/s,
    'the Active Task overview should align with Quota, Integrations, and Tools content',
  );
  assert.match(
    chatCssSource,
    /\.oc-details-sheet\s+\.oc-details-tab-content--overview\s*>\s*\.oc-active-task-panel\s*\{[^}]*margin-top:\s*0;/s,
    'the overview panel should not add a second top inset inside the shared tab gutter',
  );
});

test('Active Task is a peer overview section instead of a parent heading', () => {
  assert.match(
    panelComponentsSource,
    /className="oc-active-task-content"[\s\S]*?<MiniSection title="Active Task">/,
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
