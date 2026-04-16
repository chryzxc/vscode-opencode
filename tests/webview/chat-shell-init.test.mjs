import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function resolveChatShellPath() {
  const candidates = [
    path.join(repoRoot, 'webview', 'shared', 'src', 'chat', 'ChatShell.tsx'),
    path.join(repoRoot, 'webview', 'chat', 'ChatShell.tsx'),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(found, 'ChatShell.tsx not found in expected locations');
  return found;
}

const chatShellPath = resolveChatShellPath();

function getChatShellSource() {
  return fs.readFileSync(chatShellPath, 'utf8');
}

function getChatShellFunctionBody(source) {
  const fnStart = source.indexOf('export function ChatShell()');
  assert.notEqual(fnStart, -1, 'ChatShell component definition not found');

  const braceStart = source.indexOf('{', fnStart);
  assert.notEqual(braceStart, -1, 'ChatShell function body start not found');

  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, i);
      }
    }
  }

  throw new Error('ChatShell function body end not found');
}

function getNamedFunctionBody(source, signature) {
  const fnStart = source.indexOf(signature);
  assert.notEqual(fnStart, -1, `${signature} definition not found`);

  const braceStart = source.indexOf('{', fnStart);
  assert.notEqual(braceStart, -1, `${signature} body start not found`);

  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, i);
      }
    }
  }

  throw new Error(`${signature} body end not found`);
}

test('chat shell wires inbound webview message handling', () => {
  const source = getChatShellSource();

  const isLegacyHookPattern =
    /import\s+\{\s*useMessageHandler\s*\}\s+from\s+["']\.\/lib\/messageHandler["']/.test(source);

  if (isLegacyHookPattern) {
    const body = getChatShellFunctionBody(source);
    assert.match(
      body,
      /\buseMessageHandler\s*\(\s*\)\s*;/,
      'Legacy ChatShell must call useMessageHandler() so extension -> webview messages are handled',
    );
    return;
  }

  assert.match(
    source,
    /import\s+\{\s*createMessageHandler\s*\}\s+from\s+["']\.\/lib\/messageHandler["']/,
    'ChatShell must import createMessageHandler (or useMessageHandler in legacy implementation)',
  );

  const contentBody = getNamedFunctionBody(source, 'function ChatContent()');
  assert.match(
    contentBody,
    /\bcreateMessageHandler\s*\(/,
    'ChatContent must create an inbound message handler',
  );
  assert.match(
    contentBody,
    /window\.addEventListener\(\s*['"]message['"]\s*,\s*handler\s*\)/,
    'ChatContent must register a window message listener for extension -> webview messages',
  );
  assert.match(
    contentBody,
    /window\.removeEventListener\(\s*['"]message['"]\s*,\s*handler\s*\)/,
    'ChatContent must clean up the window message listener',
  );
});

test('chat shell only renders EmptyState after initState is received', () => {
  const source = getChatShellSource();
  const contentBody = getNamedFunctionBody(source, 'function ChatContent()');

  assert.match(
    contentBody,
    /state\.messages\.length\s*===\s*0[\s\S]*state\.receivedInitState[\s\S]*<EmptyState\s*\/>/s,
    'EmptyState should be gated by receivedInitState to avoid startup flicker before hydration starts',
  );
});
