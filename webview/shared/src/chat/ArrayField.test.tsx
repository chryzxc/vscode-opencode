import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen } from '@testing-library/react';
import { ArrayField } from './ArrayField';

test('ArrayField renders array header', () => {
  const onChange = () => {};
  const { container } = render(
    <ArrayField
      value={['a', 'b']}
      path={['items']}
      onChange={onChange}
      depth={0}
    />
  );
  assert.ok(container.textContent?.includes('2 items'));
});

test('ArrayField shows array items', () => {
  const onChange = () => {};
  const { container } = render(
    <ArrayField
      value={['a', 'b']}
      path={['items']}
      onChange={onChange}
      depth={0}
    />
  );
  assert.ok(container.textContent?.includes('[0]'));
  assert.ok(container.textContent?.includes('[1]'));
});
