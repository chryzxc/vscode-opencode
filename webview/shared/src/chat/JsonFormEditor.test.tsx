import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen } from '@testing-library/react';
import { JsonFormEditor } from './JsonFormEditor';

test('JsonFormEditor dispatches to PrimitiveField for string', () => {
  const onChange = () => {};
  const { container } = render(
    <JsonFormEditor
      value="test"
      path={['test']}
      onChange={onChange}
    />
  );
  assert.ok(container.querySelector('input[type="text"]'));
});

test('JsonFormEditor dispatches to ObjectField for object', () => {
  const onChange = () => {};
  const { getByText } = render(
    <JsonFormEditor
      value={{ key: 'value' }}
      path={['obj']}
      onChange={onChange}
    />
  );
  assert.ok(getByText('obj'));
});

test('JsonFormEditor dispatches to ArrayField for array', () => {
  const onChange = () => {};
  const { container } = render(
    <JsonFormEditor
      value={['a', 'b']}
      path={['arr']}
      onChange={onChange}
    />
  );
  assert.ok(container.textContent?.includes('array'));
});
