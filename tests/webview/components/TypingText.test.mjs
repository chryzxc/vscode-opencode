import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot } from '../../helpers/source-utils.mjs';

const typingTextSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'TypingText.tsx')],
  'TypingText.tsx',
);

test('TypingText component exists and is exported', () => {
  assert.match(
    typingTextSource,
    /export\s+const\s+TypingText/,
    'TypingText should be exported'
  );
});

test('TypingText has correct props interface', () => {
  assert.match(
    typingTextSource,
    /export\s+interface\s+TypingTextProps/,
    'Should have TypingTextProps interface'
  );

  assert.match(
    typingTextSource,
    /children:\s*string/,
    'Should have children prop as string'
  );

  assert.match(
    typingTextSource,
    /isTyping\?:\s*boolean/,
    'Should have optional isTyping prop'
  );

  assert.match(
    typingTextSource,
    /className\?:\s*string/,
    'Should have optional className prop'
  );
});

test('TypingText calculates duration based on text length', () => {
  assert.match(
    typingTextSource,
    /const\s+duration\s*=\s*Math\.min\(1500,\s*Math\.max\(800,\s*children\.length\s*\*\s*30\)\)/,
    'Should calculate duration based on text length (30ms per char, min 800ms, max 1500ms)'
  );
});

test('TypingText applies typing class when isTyping is true', () => {
  assert.match(
    typingTextSource,
    /isTyping\s*&&\s*"oc-typing-text--typing"/,
    'Should apply typing class when isTyping is true'
  );
});

test('TypingText sets animation duration in style', () => {
  assert.match(
    typingTextSource,
    /style=\{\{\s*animationDuration:\s*`\$\{duration\}ms`\s*\}\}/,
    'Should set animation duration in inline style'
  );
});

test('TypingText uses forwardRef', () => {
  assert.match(
    typingTextSource,
    /React\.forwardRef/,
    'Should use React.forwardRef'
  );
});

test('TypingText has displayName', () => {
  assert.match(
    typingTextSource,
    /TypingText\.displayName\s*=\s*"TypingText"/,
    'Should have displayName set'
  );
});

test('TypingText uses cn utility for className', () => {
  assert.match(
    typingTextSource,
    /import\s+\{[^}]*cn[^}]*\}\s+from\s+"@\/utils"/,
    'Should import cn utility from @/utils'
  );

  assert.match(
    typingTextSource,
    /className=\{cn\(/,
    'Should use cn utility for className'
  );
});
