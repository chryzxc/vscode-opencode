import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'components', 'SessionModal.tsx')],
  'SessionModal.tsx',
);

test('exports SessionModal with the expected props', () => {
  assert.match(
    source,
    /export function SessionModal\(\{ isOpen, onClose \}: SessionModalProps\)/,
    'SessionModal.tsx must export SessionModal with SessionModalProps',
  );
});

test('uses useState for editing and search state', () => {
  assert.match(source, /const \[editingSessionId, setEditingSessionId\] = useState<[^>]+>\(null\);/, 'SessionModal.tsx must use useState for editingSessionId');
  assert.match(source, /const \[newTitle, setNewTitle\] = useState\(""\);/, 'SessionModal.tsx must use useState for newTitle');
  assert.match(source, /const \[searchQuery, setSearchQuery\] = useState\(""\);/, 'SessionModal.tsx must use useState for searchQuery');
  assert.match(source, /const \[confirmDeleteId, setConfirmDeleteId\] = useState<[^>]+>\(null\);/, 'SessionModal.tsx must use useState for confirmDeleteId');
});

test('uses useMemo for filteredSessions and groupedSessions', () => {
  assert.match(
    source,
    /useMemo\([\s\S]*?filteredSessions/,
    'SessionModal.tsx must use useMemo for filteredSessions',
  );
  assert.match(
    source,
    /useMemo\([\s\S]*?groupedSessions/,
    'SessionModal.tsx must use useMemo for groupedSessions',
  );
});

test('groups sessions by day with the expected labels', () => {
  assert.match(
    source,
    /const day = 86_400_000/,
    'SessionModal.tsx must define const day = 86_400_000',
  );
  assert.match(
    source,
    /"Today"/,
    'SessionModal.tsx must label recent sessions as Today',
  );
  assert.match(
    source,
    /"Yesterday"/,
    'SessionModal.tsx must label recent sessions as Yesterday',
  );
  assert.match(
    source,
    /"This Week"/,
    'SessionModal.tsx must label recent sessions as This Week',
  );
  assert.match(
    source,
    /"Older"/,
    'SessionModal.tsx must label older sessions as Older',
  );
});

test('posts renameSession messages through vscode', () => {
  assert.match(
    source,
    /vscode\.postMessage\(\{[\s\S]*?type: "renameSession"[\s\S]*?\}\)/,
    'SessionModal.tsx must post renameSession messages through vscode.postMessage',
  );
});

test('posts deleteSession messages through vscode', () => {
  assert.match(
    source,
    /vscode\.postMessage\(\{[\s\S]*?type: "deleteSession"[\s\S]*?\}\)/,
    'SessionModal.tsx must post deleteSession messages through vscode.postMessage',
  );
});

test('posts switchSession messages through vscode', () => {
  assert.match(
    source,
    /vscode\.postMessage\(\{[\s\S]*?type: "switchSession"[\s\S]*?\}\)/,
    'SessionModal.tsx must post switchSession messages through vscode.postMessage',
  );
});

test('dispatches START_SESSION_LOADING', () => {
  assert.match(
    source,
    /START_SESSION_LOADING/,
    'SessionModal.tsx must dispatch START_SESSION_LOADING',
  );
});

test('creates inputRef with useRef and autofocuses it', () => {
  assert.match(
    source,
    /const inputRef = useRef<HTMLInputElement>\(null\);/,
    'SessionModal.tsx must create inputRef with useRef',
  );
  assert.match(
    source,
    /inputRef\.current\?\.focus\(|inputRef\.current\.focus\(/,
    'SessionModal.tsx must autofocus the inputRef',
  );
});

test('defines relativeSessionTime helper', () => {
  assert.match(
    source,
    /function relativeSessionTime\(ts: number \| undefined\): string/,
    'SessionModal.tsx must define relativeSessionTime(ts: number | undefined): string',
  );
});
