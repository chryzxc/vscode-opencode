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

test('TerminalBlock has copy functionality', () => {
  assert.match(
    terminalBlockSource,
    /handleCopy/,
    'Should have handleCopy function'
  );

  assert.match(
    terminalBlockSource,
    /navigator\.clipboard\.writeText/,
    'Should use clipboard API to copy'
  );

  assert.match(
    terminalBlockSource,
    /setCopied\(true\)/,
    'Should set copied state to true'
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
    /oc-bash-prompt/,
    'Should have prompt element'
  );

  assert.match(
    terminalBlockSource,
    /\$\s*<\/?span>/,
    'Prompt should show $ symbol'
  );

  assert.match(
    terminalBlockSource,
    /oc-bash-command-code/,
    'Should have command code element'
  );
});

test('TerminalBlock has copy button', () => {
  assert.match(
    terminalBlockSource,
    /oc-bash-copy-btn/,
    'Should have copy button'
  );

  assert.match(
    terminalBlockSource,
    /Copy\s+size=\{14\}/,
    'Should use Copy icon from lucide-react'
  );

  assert.match(
    terminalBlockSource,
    /aria-label="Copy command"/,
    'Should have accessibility label'
  );
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
