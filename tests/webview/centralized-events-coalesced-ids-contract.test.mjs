import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('coalesced message burst IDs are preserved to ensure centralized events map properly', () => {
  assert.match(
    messageHandlerSource,
    /baseRec\.coalescedIds\.push\(messageId\)/,
    'message handler should append each message ID inside a coalesced burst to coalescedIds to avoid hiding early events'
  );

  assert.match(
    messageComponentsSource,
    /coalescedIds/,
    'message components should read coalescedIds to keep early centralized events in scope'
  );
  
  assert.match(
    messageComponentsSource,
    /\.\.\.\(Array\.isArray\(\(message as any\)\.coalescedIds\) \? \(message as any\)\.coalescedIds : \[\]\)/,
    'collectMessageIdentityCandidates should include all coalescedIds from the unified turn'
  );
});
