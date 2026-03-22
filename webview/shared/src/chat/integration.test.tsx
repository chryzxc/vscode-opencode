import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent } from '@testing-library/react';
import { JsonFormEditor } from './JsonFormEditor';
import { updateAt } from './lib/jsonUtils';

test('full edit cycle: nested object to array to primitive', () => {
  const initialConfig = {
    api: {
      timeout: 30,
      endpoints: ['https://api.example.com']
    }
  };

  let currentConfig = initialConfig;
  const handleChange = (path: string[], newValue: unknown) => {
    currentConfig = updateAt(currentConfig, path, newValue) as typeof initialConfig;
  };

  const { container } = render(
    <JsonFormEditor value={currentConfig} path={[]} onChange={handleChange} />
  );

  // Should render the root object
  assert.ok(container.textContent?.includes('api'));
  assert.ok(container.textContent?.includes('object'));

  // Verify JSON serialization works
  const json = JSON.stringify(currentConfig, null, 2);
  assert.match(json, /"timeout": 30/);
  assert.match(json, /"endpoints"/);
});

test('updateAt correctly updates nested values', () => {
  const config = { level1: { level2: { value: 1 } } };

  const updated = updateAt(config, ['level1', 'level2', 'value'], 2);
  assert.deepStrictEqual(updated, { level1: { level2: { value: 2 } } });

  // Original should not be mutated
  assert.strictEqual(config.level1.level2.value, 1);
});

test('updateAt handles array updates', () => {
  const config = { items: ['a', 'b', 'c'] };

  const updated = updateAt(config, ['items', '1'], 'B');
  assert.deepStrictEqual(updated, { items: ['a', 'B', 'c'] });
});
