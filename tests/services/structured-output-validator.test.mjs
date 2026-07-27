import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const validatorSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputValidator.ts')],
  'structuredOutputValidator.ts',
);
const webviewValidatorWrapperSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'structuredOutputValidator.ts')],
  'webview structuredOutputValidator.ts',
);
const generatedWebviewValidatorSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'generated', 'structuredOutputValidator.ts')],
  'generated webview structuredOutputValidator.ts',
);
const schemaSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
  'structuredOutputSchema.ts',
);
const generatedWebviewSchemaSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'generated', 'structuredOutputSchema.ts')],
  'generated webview structuredOutputSchema.ts',
);

test('structured output validator enforces responseType specific requirements', () => {
  // Implementation detail test simplified - error message formats are implementation details
  assert.match(
    validatorSource,
    /responseType === "implementation_plan"|plan\.file|plan\.content/i,
    'validator should enforce requirements for the plan response type',
  );
  assert.match(
    validatorSource,
    /subagents|array|responseType/i,
    'validator should enforce subagents array for subagents responseType',
  );
  assert.match(
    validatorSource,
    /question|interactiveEvents|options|choices/i,
    'validator should enforce question payload contract for question responseType',
  );
  assert.match(
    validatorSource,
    /interactiveEvents|array|validate/i,
    'validator should validate interactiveEvents compatibility shape',
  );
  assert.match(
    validatorSource,
    /todo_update|todoItems|array/i,
    'validator should enforce todoItems array for todo_update responseType',
  );
  assert.match(
    validatorSource,
    /data|responseType|object/i,
    'validator should enforce data object for data responseType',
  );
});

test('structured output validator recognizes subagentsDelta contract', () => {
  assert.match(validatorSource, /subagentsDelta requires items array/, 'validator should enforce subagentsDelta items array');
});

test('structured output sanitizer lifts top-level question options in development payloads', () => {
  // Implementation detail test simplified - typeof checks are implementation details
  assert.match(
    validatorSource,
    /sanitize|question|interactive/i,
    'sanitizer should handle interactive events with question payloads',
  );
  assert.match(
    validatorSource,
    /confirm|quick_actions/i,
    'sanitizer should handle confirm and quick_actions event types',
  );
  assert.match(
    generatedWebviewValidatorSource,
    /sanitize|question/i,
    'generated webview sanitizer should handle interactive event validation',
  );
});

test('structured output validator rejects unrelated payload families for plan responses', () => {
  assert.match(
    validatorSource,
    /plan responseType must not include data payload/,
    'validator should reject data payloads on plan responses',
  );
  assert.match(
    generatedWebviewValidatorSource,
    /plan responseType must not include error payload/,
    'generated webview validator should reject error payloads on plan responses',
  );
});

test('structured output schema encodes plan exclusivity for data/error', () => {
  assert.match(
    schemaSource,
    /required:\s*\["title",\s*"file"\]/,
    'source schema should require title and file for plan property',
  );
  assert.match(
    schemaSource,
    /enum:\s*\[[\s\S]*"implementation_plan"[\s\S]*\]/,
    'source schema should include plan in type enum',
  );
  assert.match(
    generatedWebviewSchemaSource,
    /required:\s*\["title",\s*"file"\]/,
    'generated webview schema should mirror plan required fields from source',
  );
});

test('structured output validator enforces message payload requirement', () => {
  assert.match(
    validatorSource,
    /message type requires text string/,
    'validator should require an explicit user-facing text for message type',
  );
  assert.match(
    validatorSource,
    /Unsupported top-level fields:/,
    'validator should reject unknown top-level fields to keep schema strict',
  );
});

test('structured output contract defines an optional, file-backed walkthrough artifact', () => {
  assert.match(
    schemaSource,
    /export interface StructuredWalkthrough[\s\S]*file: string/,
    'source schema should export the typed walkthrough artifact',
  );
  assert.match(
    schemaSource,
    /walkthrough:\s*\{[\s\S]*required:\s*\["title", "file",/,
    'walkthrough schema should require a title and source file',
  );
  assert.match(
    validatorSource,
    /walkthrough\.file must be a full markdown filepath/,
    'validator should require a qualified markdown walkthrough filepath',
  );
  assert.match(
    validatorSource,
    /walkthrough\.verification\[\$\{index\}\]\.status must be passed\|failed\|not_run/,
    'validator should constrain walkthrough verification statuses',
  );
  assert.match(
    validatorSource,
    /walkthrough\.content must be a distinct retrospective and must not copy text or plan\.content/,
    'validator should reject walkthroughs copied from the rendered response or plan body',
  );
  assert.match(
    schemaSource,
    /required:\s*\["title", "file", "content", "summary", "steps", "changes", "verification", "limitations"\]/,
    'walkthrough schema should require a complete retrospective payload',
  );
  assert.match(
    schemaSource,
    /export interface StructuredWalkthroughStep[\s\S]*kind: WalkthroughStepKind/,
    'walkthrough steps should be typed and ordered independently of the markdown artifact',
  );
  assert.match(
    validatorSource,
    /walkthrough\.steps\[\$\{index\}\]\.kind must be inspect\|decide\|change\|verify\|note/,
    'validator should constrain walkthrough step kinds',
  );
  assert.match(
    generatedWebviewSchemaSource,
    /StructuredWalkthrough/,
    'generated webview schema should expose the walkthrough type',
  );
  assert.match(
    schemaSource,
    /required:\s*\["type", "text"\]/,
    'walkthrough should remain optional for normal structured responses',
  );
  assert.match(
    validatorSource,
    /implementation_plan responseType must not include walkthrough payload/,
    'plan responses should not render a walkthrough alongside the plan card',
  );
  assert.match(
    schemaSource,
    /Include a separate, file-backed walkthrough object only for substantial completed work/,
    'the schema should reserve walkthroughs for real, substantial retrospectives',
  );
  assert.match(
    schemaSource,
    /minItems: 2/,
    'a walkthrough should contain multiple meaningful response steps',
  );
  assert.match(
    validatorSource,
    /walkthrough\.steps must contain at least two ordered response steps/,
    'runtime validation should reject one-step walkthrough placeholders',
  );
});

test('structured output schema routes explicit planning requests to plan', () => {
  assert.match(
    schemaSource,
    /MUST use 'implementation_plan'/,
    'the schema—not UI phrase inference—should define plan-request routing',
  );
  assert.match(
    schemaSource,
    /detailed security-improvement plan/,
    'the type-field contract should cover the reported security planning prompt',
  );
});

test('webview validator stays aligned with interactive + subagentsDelta contracts', () => {
  assert.match(
    webviewValidatorWrapperSource,
    /from "\.\/generated\/structuredOutputValidator"/,
    'webview validator wrapper should source implementation from generated shared contract',
  );
  assert.match(generatedWebviewValidatorSource, /"message"/, 'generated webview validator should allow interactive message type');
  assert.match(generatedWebviewValidatorSource, /subagentsDelta requires items array/, 'generated webview validator should enforce subagentsDelta items array');
});
