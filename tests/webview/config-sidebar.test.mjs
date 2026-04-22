import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const configSidebarSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ConfigSidebar.tsx')],
  'ConfigSidebar.tsx',
);

test('ConfigSidebar exports the sidebar and props contract', () => {
  assert.match(
    configSidebarSource,
    /export function ConfigSidebar\(\{ files, activeFileName, onSelectFile, onSaveFile \}: ConfigSidebarProps\)/,
    'ConfigSidebar should export the component with the expected props signature',
  );
  assert.match(
    configSidebarSource,
    /interface ConfigSidebarProps \{[\s\S]*files: ConfigFile\[\];[\s\S]*activeFileName: string \| null;[\s\S]*onSelectFile: \(fileName: string\) => void;[\s\S]*onSaveFile: \(fileName: string\) => void;[\s\S]*\}/,
    'ConfigSidebarProps should declare files, activeFileName, onSelectFile, and onSaveFile',
  );
});

test('ConfigSidebar preserves the interactive file item behavior', () => {
  assert.match(
    configSidebarSource,
    /function ConfigFileItem\(/,
    'ConfigSidebar should include the ConfigFileItem internal component',
  );
  assert.match(
    configSidebarSource,
    /const \[isHovered, setIsHovered\] = useState\(false\);/,
    'ConfigFileItem should track hover state with useState',
  );
  assert.match(
    configSidebarSource,
    /if \(e\.key === 'Enter' \|\| e\.key === ' '\)/,
    'ConfigFileItem should handle keyboard activation with Enter and Space',
  );
  assert.match(
    configSidebarSource,
    /role="button"[\s\S]*tabIndex=\{0\}/,
    'ConfigFileItem should expose button semantics with role and tabIndex',
  );
});

test('ConfigSidebar keeps save interaction and active styling logic', () => {
  assert.match(
    configSidebarSource,
    /e\.stopPropagation\(\);[\s\S]*onSave\(\);/,
    'Save button should stop propagation before invoking onSave',
  );
  assert.match(
    configSidebarSource,
    /isActive\s*\?[\s\S]*'bg-oc-accent\/20 text-oc-accent'[\s\S]*:[\s\S]*'hover:bg-oc-bg-soft text-oc-text'/,
    'ConfigFileItem should switch between active and inactive class names',
  );
});
