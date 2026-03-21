import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { updateAt, getValueType } from './jsonUtils';

describe('updateAt', () => {
  it('should update primitive at root path', () => {
    const result = updateAt('old_value', [], 'new_value');
    assert.strictEqual(result, 'new_value');
  });

  it('should update nested object property', () => {
    const obj = { api: { timeout: 30 } };
    const result = updateAt(obj, ['api', 'timeout'], 60);
    assert.deepStrictEqual(result, { api: { timeout: 60 } });
  });

  it('should update array item by index', () => {
    const arr = ['a', 'b', 'c'];
    const result = updateAt(arr, ['1'], 'B');
    assert.deepStrictEqual(result, ['a', 'B', 'c']);
  });

  it('should not mutate original object', () => {
    const obj = { level1: { level2: { value: 1 } } };
    const result = updateAt(obj, ['level1', 'level2', 'value'], 2);
    assert.strictEqual(obj.level1.level2.value, 1);
    assert.strictEqual(result.level1.level2.value, 2);
  });

  it('should handle deep nesting', () => {
    const obj = { a: { b: { c: { d: 1 } } } };
    const result = updateAt(obj, ['a', 'b', 'c', 'd'], 2);
    assert.deepStrictEqual(result, { a: { b: { c: { d: 2 } } } });
  });
});

describe('getValueType', () => {
  it('should identify string', () => {
    assert.strictEqual(getValueType('hello'), 'string');
  });

  it('should identify number', () => {
    assert.strictEqual(getValueType(42), 'number');
  });

  it('should identify boolean', () => {
    assert.strictEqual(getValueType(true), 'boolean');
  });

  it('should identify null', () => {
    assert.strictEqual(getValueType(null), 'null');
  });

  it('should identify object', () => {
    assert.strictEqual(getValueType({}), 'object');
  });

  it('should identify array', () => {
    assert.strictEqual(getValueType([]), 'array');
  });
});
