import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);

function extractSessionErrorBranch(source) {
  const match = source.match(/if \(entry\.kind === "session\.error"\) \{([\s\S]*?)\n\s*\}\n\s*return \(/);
  return match?.[1] ?? '';
}

const sessionErrorBranch = extractSessionErrorBranch(chatShellSource);

describe('Session error banner rendering', () => {
  test('ChatShell derives ordered session-error transcript entries from centralized raw event payloads', () => {
    assert.match(
      chatShellSource,
      /parseCentralizedSessionErrorEvent\s*\(/,
      'ChatShell must define a helper that parses session errors from centralized raw payloads',
    );
    assert.match(
      chatShellSource,
      /nestedErrorData\?\.message,[\s\S]*?nestedError\?\.message,[\s\S]*?record\?\.message/s,
      'exact nested server errors must win over generic top-level messages',
    );
    assert.match(
      chatShellSource,
      /eventType\s*===\s*"session\.error"\s*\|\|\s*eventType\s*===\s*"error"[\s\S]*?eventType\s*!==\s*"message\.updated"/s,
      'centralized error parsing must inspect session.error/error and message.updated error-bearing events',
    );
    assert.match(
      chatShellSource,
      /kind:\s*"session\.error"[\s\S]*?error:\s*errorEvent[\s\S]*?order:\s*priorMessageCount\s*\*\s*10\s*\+\s*6/s,
      'ChatShell must emit a session.error conversation entry ordered from the centralized tape',
    );
    assert.match(
      chatShellSource,
      /const fingerprint = JSON\.stringify\([\s\S]*?id: errorEvent\.id \?\? null,[\s\S]*?rawIndex: errorEvent\.rawIndex,[\s\S]*?message: errorEvent\.message/s,
      'session-error dedupe must remain event-specific so repeated identical error text can still render for later errored turns',
    );
    assert.match(
      chatShellSource,
      /if \(entry\.kind === "session\.error"\)[\s\S]*?Session error/s,
      'ChatShell must render Session error from the transcript entry renderer, not a pinned top block',
    );
    assert.doesNotMatch(
      chatShellSource,
      /errorBanners\.length\s*>\s*0[\s\S]*?Session error/s,
      'ChatShell must not render session errors as a standalone top-of-list banner block anymore',
    );
    assert.match(
      chatShellSource,
      /w-full[\s\S]*?rounded-\[14px\][\s\S]*?Response could not be completed/s,
      'session error should render as a compact full-width row instead of a floating bubble card',
    );
    assert.doesNotMatch(
      sessionErrorBranch,
      /backdrop-blur-\[10px\]|linear-gradient\(180deg|boxShadow:/s,
      'session error row should not keep the old glow, blur, or glassy gradient treatment',
    );
    assert.match(
      chatShellSource,
      /nestedErrorData\?\.message,[\s\S]*?nestedError\?\.message,[\s\S]*?record\?\.message/s,
      'nested server error text must still take precedence in the error parser',
    );
    assert.match(
      chatShellSource,
      /isGenericSessionErrorMessage\(candidateError\.message\)/,
      'generic fallback errors should be detectable so more specific messages can win',
    );
    assert.doesNotMatch(
      chatShellSource,
      /The session failed before a normal assistant reply was added\./,
      'the redesigned error bubble should drop the extra explainer copy',
    );
  });

  test('banner shows the exact parsed error message without a dismiss button', () => {
    assert.doesNotMatch(
      sessionErrorBranch,
      /Dismiss session error banner|CLEAR_ERROR_MESSAGES|<X className=/s,
      'session error row should not render a dismiss control',
    );
    assert.match(
      chatShellSource,
      /\{entry\.error\.message\}/,
      'the rendered session error card must show the exact parsed error message',
    );
  });
});
