import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'SubagentDetailModal.tsx')],
  'SubagentDetailModal.tsx',
);

test('exports SubagentDetailModal with props type', () => {
  assert.match(
    source,
    /export function SubagentDetailModal\(\{[\s\S]*?\}: SubagentDetailModalProps\)/,
    'SubagentDetailModal.tsx must export SubagentDetailModal(props: SubagentDetailModalProps)',
  );
});

test('defines the expected props fields', () => {
  assert.match(
    source,
    /type SubagentDetailModalProps = \{[\s\S]*?isOpen: boolean;[\s\S]*?title: string;[\s\S]*?providerLabel\?: string;[\s\S]*?detail:[\s\S]*?onClose: \(\) => void;[\s\S]*?onCopyRefs: \([\s\S]*?\) => void;[\s\S]*?onJumpToParent: \([\s\S]*?\) => void;[\s\S]*?colorClass\?: string;[\s\S]*?\}/,
    'SubagentDetailModal.tsx must define SubagentDetailModalProps with the expected fields',
  );
});

test('renders into document.body with createPortal', () => {
  assert.match(
    source,
    /createPortal\(modalContent, document\.body\)/,
    'SubagentDetailModal.tsx must render with createPortal(modalContent, document.body)',
  );
});

test('handles Escape with a window keydown listener', () => {
  assert.match(
    source,
    /window\.addEventListener\(['"]keydown['"], onKeyDown\)/,
    'SubagentDetailModal.tsx must add a keydown Escape handler on window',
  );
});

test('deduplicates text with seenTexts set', () => {
  assert.match(
    source,
    /seenTexts\s*=\s*new Set<string>\(\)/,
    'SubagentDetailModal.tsx must create seenTexts = new Set<string>()',
  );
});

test('uses useMemo for renderedConversation', () => {
  assert.match(
    source,
    /useMemo\([\s\S]*?renderedConversation/,
    'SubagentDetailModal.tsx must use useMemo for renderedConversation',
  );
});

test('calls onCopyRefs with the detail object', () => {
  assert.match(
    source,
    /onCopyRefs\(detail\)/,
    'SubagentDetailModal.tsx must call onCopyRefs(detail)',
  );
});

test('renders Stepper and StepperItem components', () => {
  assert.match(
    source,
    /<Stepper[\s\S]*?<StepperItem/,
    'SubagentDetailModal.tsx must render Stepper and StepperItem components',
  );
});

test('renders MarkdownRenderer with event text', () => {
  assert.match(
    source,
    /<MarkdownRenderer content=\{event\.text\}/,
    'SubagentDetailModal.tsx must render MarkdownRenderer content={event.text}',
  );
});

test('defines getStepStatus helper', () => {
  assert.match(
    source,
    /const getStepStatus = \(/,
    'SubagentDetailModal.tsx must define getStepStatus helper as a const function',
  );
});
