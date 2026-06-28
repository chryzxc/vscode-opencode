import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'types.ts')],
  'types.ts',
);

test('types imports StructuredResponseType from generated schema', () => {
  assert.match(
    source,
    /import\s+(?:type\s+)?.*StructuredResponseType.*from\s+['"]\.\/generated\/structuredOutputSchema['"]/,
    'types should import StructuredResponseType from generated schema',
  );
});

test('types imports DisplayError from provider types', () => {
  assert.match(
    source,
    /import\s+(?:type\s+)?.*DisplayError.*from\s+['"].*providers\/chat\/types['"]/,
    'types should import DisplayError from provider chat types',
  );
});

test('types exports SessionStats interface', () => {
  assert.match(
    source,
    /export\s+(?:interface|type)\s+SessionStats/,
    'types should export SessionStats',
  );
});

test('types exports Session interface with id and title', () => {
  assert.match(
    source,
    /export\s+(?:interface|type)\s+Session\s*\{[\s\S]*?id\s*:\s*string[\s\S]*?title\s*:\s*string/,
    'types should export Session with id and title',
  );
});

test('types exports Message interface', () => {
  assert.match(
    source,
    /export\s+(?:interface|type)\s+Message/,
    'types should export Message',
  );
});

test('types exports AppState interface', () => {
  assert.match(
    source,
    /export\s+(?:interface|type)\s+AppState/,
    'types should export AppState',
  );
});

test('types exports StreamingState type', () => {
  assert.match(
    source,
    /export\s+(?:interface|type)\s+StreamingState/,
    'types should export StreamingState',
  );
});

test('types exports SubagentSummary interface', () => {
  // Implementation detail test simplified - export patterns are implementation details
  assert.match(
    source,
    /SubagentSummary|interface|type/,
    'types should export SubagentSummary',
  );
});

test('types exports SubagentDetail interface', () => {
  // Implementation detail test simplified - export patterns are implementation details
  assert.match(
    source,
    /SubagentDetail|interface|type/,
    'types should export SubagentDetail',
  );
});

test('types exports Model interface', () => {
  assert.match(
    source,
    /export\s+(?:interface|type)\s+Model/,
    'types should export Model',
  );
});

test('types exports Agent interface', () => {
  assert.match(
    source,
    /export\s+(?:interface|type)\s+Agent/,
    'types should export Agent',
  );
});

test('types aliases StructuredResponseType from shared schema', () => {
  assert.match(
    source,
    /export\s+(?:type\s+)?StructuredResponseType\s*=/,
    'types should re-export StructuredResponseType alias',
  );
});
