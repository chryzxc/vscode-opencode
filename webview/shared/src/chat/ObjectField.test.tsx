import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen } from '@testing-library/react';
import { ObjectField } from './ObjectField';

test('ObjectField renders object header with key', () => {
  const onChange = () => {};
  const { getByText } = render(
    <ObjectField
      value={{ timeout: 30 }}
      path={['api']}
      onChange={onChange}
      isExpanded={false}
      onToggleExpanded={() => {}}
      depth={0}
    />
  );
  assert.ok(getByText('api'));
});

test('ObjectField renders type badge', () => {
  const onChange = () => {};
  const { container } = render(
    <ObjectField
      value={{}}
      path={['test']}
      onChange={onChange}
      isExpanded={false}
      onToggleExpanded={() => {}}
      depth={0}
    />
  );
  assert.ok(container.textContent?.includes('object'));
});

test('ObjectField shows children when expanded', () => {
  const onChange = () => {};
  const { container } = render(
    <ObjectField
      value={{ timeout: 30 }}
      path={['api']}
      onChange={onChange}
      isExpanded={true}
      onToggleExpanded={() => {}}
      depth={0}
    />
  );
  assert.ok(container.textContent?.includes('timeout'));
});
