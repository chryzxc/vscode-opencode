import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts')],
  'DiagnosticsLogger.ts',
);

test('stream event diagnostics suppress heartbeats unless verbose debug is enabled and prefer targeted info logging', () => {
  const body = extractFunctionBody(
    source,
    'logStreamEventDiagnostics(event: any, enrichedEvent?: any): void {',
  );

  assert.match(body, /const eventType = typeof event\?\.type === "string" \? event\.type : "unknown";/, 'logStreamEventDiagnostics should normalize the incoming event type');
  assert.match(body, /const summary: Record<string, unknown> = \{[\s\S]*preview: preview \? preview\.slice\(0, 180\) : undefined,[\s\S]*\};/, 'logStreamEventDiagnostics should build a compact summary including a truncated preview');
  assert.match(body, /if \(eventType === "server\.heartbeat"\) \{[\s\S]*if \(this\.shouldVerboseStreamDebug\(\)\) \{[\s\S]*this\.logger\.debug\("Stream heartbeat", summary\);[\s\S]*\}[\s\S]*return;[\s\S]*\}/, 'logStreamEventDiagnostics should filter heartbeats unless verbose stream debug is active');
  assert.match(body, /const shouldLogInfo =[\s\S]*eventType === "message\.updated"[\s\S]*eventType === "message\.completed"[\s\S]*eventType === "session\.completed";/, 'logStreamEventDiagnostics should reserve info logs for key render-parity milestones');
  assert.match(body, /if \(this\.shouldVerboseStreamDebug\(\)\) \{[\s\S]*this\.logger\.debug\("Stream event received", summary\);[\s\S]*return;[\s\S]*\}[\s\S]*if \(shouldLogInfo\) \{[\s\S]*this\.logger\.info\("Render parity stream snapshot", summary\);[\s\S]*\}/, 'logStreamEventDiagnostics should switch between verbose debug and targeted info logging');
  assert.match(body, /Removed render-parity\.ndjson file writing to prevent tool call creation[\s\S]*\/\/\s*this\.appendRenderParityDebugLog\("stream", summary\);/, 'logStreamEventDiagnostics should keep stream parity file writing disabled in commented form');
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
  const body = extractFunctionBody(
    source,
    'logHistoryRenderDiagnostics(\n    source: string,\n    sessionId: string | undefined,\n    rawMessages: any[],\n    processedMessages: any[],\n  ): void {',
  );

  assert.match(body, /const rawTail = rawMessages\.slice\(-20\);[\s\S]*const processedTail = processedMessages\.slice\(-20\);/, 'logHistoryRenderDiagnostics should focus on the last 20 raw and processed messages');
  assert.match(body, /const missingProcessedIds = Array\.from\(rawIds\)\.filter\([\s\S]*!processedIds\.has\(id\),[\s\S]*\);/, 'logHistoryRenderDiagnostics should compute missing processed ids');
  assert.match(body, /stats: `\$\{rawMessages\.length\} raw → \$\{processedMessages\.length\} processed \(\$\{rawMessages\.length - processedMessages\.length\} dropped\)`/, 'logHistoryRenderDiagnostics should include raw-to-processed parity stats');
  assert.match(body, /this\.logger\.info\("History render parity", summaryContext\);/, 'logHistoryRenderDiagnostics should emit a structured parity summary');
  assert.match(body, /Disabled render-parity\.ndjson file writing to prevent tool call creation[\s\S]*\/\/\s*this\.appendRenderParityDebugLog\("history", \{/, 'logHistoryRenderDiagnostics should keep history parity file writing disabled in commented form');
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
