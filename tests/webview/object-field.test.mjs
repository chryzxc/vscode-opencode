import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const objectFieldSource = readSource(
  [
    joinFromRoot('webview', 'shared', 'src', 'chat', 'components', 'fields', 'ObjectField.tsx'),
    joinFromRoot('webview', 'shared', 'src', 'chat', 'ObjectField.tsx'),
  ],
  'ObjectField.tsx',
);

test('ObjectField exports the expected object editor props contract', () => {
  assert.match(
    objectFieldSource,
    /export function ObjectField\(\{[\s\S]*value,[\s\S]*path,[\s\S]*onChange,[\s\S]*isExpanded,[\s\S]*onToggleExpanded,[\s\S]*depth,[\s\S]*availableModels[\s\S]*\}: ObjectFieldProps\)/,
    'ObjectField should export with value, path, onChange, isExpanded, onToggleExpanded, depth, and availableModels props',
  );
});

test('ObjectField stores the new field key in React state', () => {
  assert.match(
    objectFieldSource,
    /const \[newKey, setNewKey\] = useState\(''\);/,
    'ObjectField should use useState for the new field key input',
  );
});

test('ObjectField guards duplicate and empty keys before add', () => {
  assert.match(
    objectFieldSource,
    /if \(!newKey\.trim\(\) \|\| newKey in value\) return;/,
    'handleAddField should reject blank keys and duplicate keys',
  );
});

test('ObjectField removes a field by destructuring it out of the object', () => {
  assert.match(
    objectFieldSource,
    /const \{ \[key\]: removed, \.\.\.rest \} = value;[\s\S]*?onChange\(path, rest\);/,
    'handleRemoveField should strip the selected key and emit the rest object',
  );
});

test('ObjectField toggles chevrons from expanded state', () => {
  assert.match(
    objectFieldSource,
    /isExpanded \? \([\s\S]*?ChevronDown[\s\S]*?: \([\s\S]*?ChevronRight/,
    'ObjectField should switch between ChevronDown and ChevronRight based on expansion state',
  );
});

test('ObjectField adds fields on Enter key press', () => {
  assert.match(
    objectFieldSource,
    /onKeyDown=\{\(e\) => e\.key === 'Enter' && handleAddField\(\)\}/,
    'ObjectField should submit new fields when Enter is pressed',
  );
});

test('ObjectField shows the empty-state copy for empty objects', () => {
  assert.match(
    objectFieldSource,
    /No fields - click \+ to add/,
    'ObjectField should display the empty object helper text',
  );
});
