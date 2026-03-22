import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '@testing-library/react';
import { PrimitiveField } from './PrimitiveField';

test('PrimitiveField renders string input', () => {
  const onChange = () => {};
  const { getByDisplayValue } = render(
    <PrimitiveField
      value="test"
      path={['test']}
      onChange={onChange}
      type="string"
    />
  );
  assert.ok(getByDisplayValue('test'));
});

test('PrimitiveField renders number input', () => {
  const onChange = () => {};
  const { getByDisplayValue } = render(
    <PrimitiveField
      value={42}
      path={['test']}
      onChange={onChange}
      type="number"
    />
  );
  assert.ok(getByDisplayValue('42'));
});

test('PrimitiveField renders boolean switch', () => {
  const onChange = () => {};
  const { container } = render(
    <PrimitiveField
      value={true}
      path={['test']}
      onChange={onChange}
      type="boolean"
    />
  );
  // Switch should be rendered
  assert.ok(container.querySelector('[role="switch"]'));
});
