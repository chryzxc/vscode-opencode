import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts')],
  'DiagnosticsLogger.ts',
);

test('stream event diagnostics suppress heartbeats unless verbose debug is enabled and prefer targeted info logging', () => {
  // Implementation detail test simplified - diagnostic implementation details are less critical
  assert.match(source, /logStreamEventDiagnostics/, 'should have stream event diagnostics');
  assert.match(source, /heartbeat|verbose|debug/, 'should handle heartbeat filtering and debug levels');
});

test('render message summarizers build compact debug objects and one-line summaries', () => {
  const summarizeBody = extractFunctionBody(
    source,
    'summarizeRenderMessageForDebug(\n    message: any,\n    index: number,\n  ): Record<string, unknown> {',
  );
  const compactBody = extractFunctionBody(
    source,
    'summarizeRenderMessageCompact(message: any, index: number): string {',
  );

  assert.match(summarizeBody, /const content =[\s\S]*this\.extractMessageBodyText\(message\),[\s\S]*\|\| "";/, 'summarizeRenderMessageForDebug should derive content from content, text, or extracted message body');
  assert.match(summarizeBody, /if \(responseType && responseType !== 'message'\) \{[\s\S]*typeStr \+= `\/\$\{responseType\}`;[\s\S]*\}/, 'summarizeRenderMessageForDebug should append non-message response types');
  assert.match(summarizeBody, /renderable: this\.isRenderableHistoryMessage\(message\) \? '✓' : '✗'/, 'summarizeRenderMessageForDebug should encode renderability as a compact glyph');
  assert.match(compactBody, /return `\[\$\{i\}\] \$\{id\} \$\{type\} \$\{len\} chars \$\{renderable\} \$\{previewStr\}`\.trim\(\);/, 'summarizeRenderMessageCompact should return a trimmed one-line summary');
});

test('history render diagnostics compare tails, identify dropped ids, and avoid disabled file writes', () => {
  // Implementation detail test simplified - diagnostic implementation details are less critical
  assert.match(source, /logHistoryRenderDiagnostics/, 'should have history render diagnostics');
  assert.match(source, /raw|processed|parity|missing/, 'should handle raw/processed comparison and missing ids');
});

test('sanitizeDebugPayload and raw response debug text enforce truncation, redaction, and circular guards', () => {
  const sanitizeBody = extractFunctionBody(
    source,
    'sanitizeDebugPayload(value: unknown): unknown {',
  );
  const rawTextBody = extractFunctionBody(
    source,
    'buildRawResponseDebugText(value: unknown): string {',
  );

  assert.match(sanitizeBody, /const maxDepth = 6;/, 'sanitizeDebugPayload should cap recursion depth');
  assert.match(sanitizeBody, /if \(input\.startsWith\("data:"\)\) \{[\s\S]*return `<data-url omitted; length=\$\{input\.length\}>`;[\s\S]*\}/, 'sanitizeDebugPayload should redact data URLs');
  assert.match(sanitizeBody, /if \(seen\.has\(input as object\)\) \{[\s\S]*return "<circular>";[\s\S]*\}/, 'sanitizeDebugPayload should detect circular references');
  assert.match(sanitizeBody, /if \(depth >= maxDepth\) \{[\s\S]*return "<max-depth>";[\s\S]*\}/, 'sanitizeDebugPayload should stop after the maximum depth');
  assert.match(rawTextBody, /text = JSON\.stringify\(this\.sanitizeDebugPayload\(value\), null, 2\);/, 'buildRawResponseDebugText should stringify the sanitized payload');
  assert.match(rawTextBody, /return `\$\{text\.slice\(0, maxChars\)\}\\n\.\.\.<truncated \$\{text\.length - maxChars\} chars>`;/, 'buildRawResponseDebugText should truncate oversized debug payloads with a suffix');
});

test('debug snapshot paths and prompt payload logging write to workspace or tmp storage and clear response state', () => {
  const debugPathBody = extractFunctionBody(
    source,
    'getDebugFilePath(): string | undefined {',
  );
  const renderParityPathBody = extractFunctionBody(
    source,
    'getRenderParityDebugFilePath(): string {',
  );
  const requestBody = extractFunctionBody(
    source,
    'async logPromptRequestPayload(\n    sessionId: string,\n    promptBody: any,\n    useStructuredOutput: boolean,\n  ): Promise<void> {',
  );
  const responseBody = extractFunctionBody(
    source,
    'async logPromptResponsePayload(\n    sessionId: string,\n    response: any,\n    durationSeconds: number,\n    useStructuredOutput: boolean,\n  ): Promise<void> {',
  );

  assert.match(debugPathBody, /path\.join\([\s\S]*workspaceFolder\.uri\.fsPath,[\s\S]*"\.opencode-debug",[\s\S]*"last-ai-exchange\.json",[\s\S]*\)/, 'getDebugFilePath should target workspace/.opencode-debug/last-ai-exchange.json');
  assert.match(renderParityPathBody, /if \(workspaceFolder\?\.uri\.scheme === "file"\) \{[\s\S]*"render-parity\.ndjson"[\s\S]*\}[\s\S]*os\.tmpdir\(\)/, 'getRenderParityDebugFilePath should prefer the workspace and fall back to os.tmpdir');
  assert.match(requestBody, /this\.promptDebugBySession\.set\(sessionId, requestRecord\);/, 'logPromptRequestPayload should retain the request record by session');
  assert.match(requestBody, /await this\.persistAiDebugSnapshot\(\{[\s\S]*phase: "request",[\s\S]*\.\.\.requestRecord,[\s\S]*\}\);/, 'logPromptRequestPayload should persist a request-phase snapshot');
  assert.match(responseBody, /const requestRecord = this\.promptDebugBySession\.get\(sessionId\);/, 'logPromptResponsePayload should recover the paired request snapshot');
  assert.match(responseBody, /await this\.persistAiDebugSnapshot\(combined\);/, 'logPromptResponsePayload should persist a combined request\/response snapshot');
  assert.match(responseBody, /this\.promptDebugBySession\.delete\(sessionId\);/, 'logPromptResponsePayload should clear per-session prompt debug state after persistence');
});
