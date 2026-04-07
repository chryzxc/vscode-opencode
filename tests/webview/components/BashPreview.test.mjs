import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot } from '../../helpers/source-utils.mjs';

const bashPreviewSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'BashPreview.tsx')],
  'BashPreview.tsx'
);

test('BashPreview component exists and is exported', () => {
  assert.match(
    bashPreviewSource,
    /export\s+const\s+BashPreview/,
    'BashPreview should be exported'
  );
});

test('BashPreview has correct props interface', () => {
  assert.match(
    bashPreviewSource,
    /export\s+interface\s+BashPreviewProps/,
    'Should have BashPreviewProps interface'
  );

  assert.match(
    bashPreviewSource,
    /command:\s*string/,
    'Should have command prop of type string'
  );

  assert.match(
    bashPreviewSource,
    /className\?:\s*string/,
    'Should have optional className prop'
  );
});

test('BashPreview truncates long commands', () => {
  assert.match(
    bashPreviewSource,
    /maxLength.*60/,
    'Should have max length of 60 characters for command preview'
  );
});

test('BashPreview uses monospace font', () => {
  assert.match(
    bashPreviewSource,
    /font-mono|font-family.*mono/,
    'Should use monospace font for command text'
  );
});

test('BashPreview has bash prompt indicator', () => {
  assert.match(
    bashPreviewSource,
    /\$|bash|prompt/i,
    'Should have bash prompt indicator'
  );
});
