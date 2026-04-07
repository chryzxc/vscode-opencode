import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const terminalBlockSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'TerminalBlock.tsx')],
  'TerminalBlock.tsx',
);

test('TerminalBlock component exists and is exported', () => {
  assert.match(
    terminalBlockSource,
    /export\s+const\s+TerminalBlock/,
    'TerminalBlock should be exported'
  );
});

test('TerminalBlock has correct props interface', () => {
  assert.match(
    terminalBlockSource,
    /export\s+interface\s+TerminalBlockProps/,
    'Should have TerminalBlockProps interface'
  );

  assert.match(
    terminalBlockSource,
    /command:\s*string/,
    'Should have command prop of type string'
  );

  assert.match(
    terminalBlockSource,
    /output\?:\s*string/,
    'Should have optional output prop'
  );

  assert.match(
    terminalBlockSource,
    /className\?:\s*string/,
    'Should have optional className prop'
  );
});

test('TerminalBlock uses React.forwardRef', () => {
  assert.match(
    terminalBlockSource,
    /React\.forwardRef/,
    'Should use React.forwardRef for ref forwarding'
  );
});

test('TerminalBlock handles empty command gracefully', () => {
  assert.match(
    terminalBlockSource,
    /if\s*\(\s*!\s*command\s*\|\|\s*typeof\s+command\s+!==\s+'string'\s*\)/,
    'Should check for empty or invalid command'
  );

  assert.match(
    terminalBlockSource,
    /return\s+null/,
    'Should return null for empty command'
  );
});

test('TerminalBlock renders correct structure', () => {
  assert.match(
    terminalBlockSource,
    /oc-bash-command-block/,
    'Should have command block container'
  );

  assert.match(
    terminalBlockSource,
    /oc-bash-command-code/,
    'Should have command code element'
  );

  // Verify no prompt or copy button
  const hasPrompt = terminalBlockSource.includes('oc-bash-prompt');
  const hasCopyButton = terminalBlockSource.includes('oc-bash-copy-btn');
  assert.equal(hasPrompt || hasCopyButton, false, 'Should NOT have prompt or copy button');
});

test('TerminalBlock renders optional output', () => {
  assert.match(
    terminalBlockSource,
    /output\s+/,
    'Should use output prop'
  );

  assert.match(
    terminalBlockSource,
    /oc-bash-output/,
    'Should have output container class'
  );
});

test('TerminalBlock has displayName', () => {
  assert.match(
    terminalBlockSource,
    /TerminalBlock\.displayName\s*=\s*["']TerminalBlock["']/,
    'Should have displayName for better debugging'
  );
});

test('TerminalBlock uses cn utility for className merging', () => {
  assert.match(
    terminalBlockSource,
    /cn\(\s*["']oc-bash-command-block["']\s*,\s*className\s*\)/,
    'Should use cn utility to merge class names'
  );
});
