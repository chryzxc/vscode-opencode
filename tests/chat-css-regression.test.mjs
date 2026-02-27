import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from './helpers/source-utils.mjs';

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
