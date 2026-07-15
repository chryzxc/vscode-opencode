import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const adapterSource = readSource(
  [joinFromRoot('src', 'services', 'SdkMessageAdapter.ts')],
  'SdkMessageAdapter.ts',
);

const snapshotLoaderSource = readSource(
  [joinFromRoot('src', 'services', 'SessionSnapshotLoader.ts')],
  'SessionSnapshotLoader.ts',
);

// ── Phase 2a: SDK-message adapter contract tests ──

test('adaptSdkMessage exports main adapter function', () => {
  assert.match(
    adapterSource,
    /export function adaptSdkMessage\(sdkMessage: SdkMessageEnvelope\): SdkRenderedMessage/,
    'adaptSdkMessage should be exported with correct signature',
  );
});

test('adaptSdkMessages exports batch adapter function', () => {
  assert.match(
    adapterSource,
    /export function adaptSdkMessages\(sdkMessages: SdkMessageEnvelope\[\]\): SdkRenderedMessage\[\]/,
    'adaptSdkMessages should be exported with array signature',
  );
});

test('adaptStructuredOutput handles all structured response types', () => {
  // Must handle plan, question, and generic message response types
  assert.match(
    adapterSource,
    /implementation_plan|plan !== undefined/,
    'should detect implementation_plan from structured data',
  );
  assert.match(
    adapterSource,
    /question !== undefined \? "question"/,
    'should detect question response type',
  );
  assert.match(
    adapterSource,
    /: "message"/,
    'should fall back to message response type',
  );
});

test('adaptStructuredOutput extracts plan with all expected fields', () => {
  // Must pull file, content, title, intro, summary, files, fileCount from plan
  assert.match(
    adapterSource,
    /result\.plan = \{/,
    'should build plan object from structured data',
  );
  assert.match(
    adapterSource,
    /file: optionalString\(plan\.file\)/,
    'should extract plan file path',
  );
  assert.match(
    adapterSource,
    /content: optionalString\(plan\.content\)/,
    'should extract plan content',
  );
  assert.match(
    adapterSource,
    /title: optionalString\(plan\.title\)/,
    'should extract plan title',
  );
  assert.match(
    adapterSource,
    /fileCount: optionalNumber/,
    'should compute fileCount field',
  );
});

test('adaptStructuredOutput extracts question with interactive event', () => {
  assert.match(
    adapterSource,
    /questionRecordToInteractiveEvent\(question/,
    'should convert question record to interactive event',
  );
  assert.match(
    adapterSource,
    /result\.interactiveEvents = \[event\]/,
    'should attach interactive event to result',
  );
});

test('all supported SDK Part types have adapter branches', () => {
  // Each part type must have a corresponding if-branch in the part loop
  assert.match(adapterSource, /part\.type === "text"/, 'should handle TextPart');
  assert.match(adapterSource, /part\.type === "reasoning"/, 'should handle ReasoningPart');
  assert.match(adapterSource, /part\.type === "tool"/, 'should handle ToolPart');
  assert.match(adapterSource, /part\.type === "step-start"/, 'should handle StepStartPart');
  assert.match(adapterSource, /part\.type === "step-finish"/, 'should handle StepFinishPart');
  assert.match(adapterSource, /part\.type === "patch"/, 'should handle PatchPart');
  assert.match(adapterSource, /part\.type === "snapshot"/, 'should handle SnapshotPart');
  assert.match(adapterSource, /part\.type === "subtask"/, 'should handle SubtaskPart');
  assert.match(adapterSource, /part\.type === "file"/, 'should handle FilePart');
  assert.match(adapterSource, /part\.type === "agent"/, 'should handle AgentPart');
  assert.match(adapterSource, /part\.type === "retry"/, 'should handle RetryPart');
  assert.match(adapterSource, /part\.type === "compaction"/, 'should handle CompactionPart');
});

test('TextPart adapter produces text content and parts', () => {
  assert.match(
    adapterSource,
    /textParts\.push\(textPart\.text\)/,
    'should collect text from TextPart into textParts array',
  );
  assert.match(
    adapterSource,
    /message\.parts\?\.push\(\{ type: "text", text: textPart\.text \}\)/,
    'should push text as MessagePart with type=text',
  );
  assert.match(
    adapterSource,
    /message\.content = content/,
    'should set message.content from joined text',
  );
});

test('ReasoningPart adapter produces reasoningEvents with id and timing', () => {
  assert.match(
    adapterSource,
    /message\.reasoningEvents\?\.push\(\{/,
    'should push to reasoningEvents array',
  );
  assert.match(
    adapterSource,
    /id: reasoningPart\.id/,
    'should include part id',
  );
  assert.match(
    adapterSource,
    /text: reasoningPart\.text/,
    'should include reasoning text',
  );
  assert.match(
    adapterSource,
    /createdAt: reasoningPart\.time\?\.start/,
    'should extract timing from reasoning time.start',
  );
  assert.match(
    adapterSource,
    /messageID: info\.id/,
    'should link reasoning to parent message',
  );
});

test('ToolPart adapter produces steps with activity detail', () => {
  assert.match(
    adapterSource,
    /function adaptToolPart\(part: ToolPart\): SdkMessageStep/,
    'adaptToolPart should have correct signature',
  );
  assert.match(
    adapterSource,
    /type: "tool"/,
    'step type should be tool',
  );
  assert.match(
    adapterSource,
    /callID: part\.callID/,
    'should include tool callID for dedup',
  );
  assert.match(
    adapterSource,
    /status: part\.state\.status/,
    'should propagate tool state status',
  );
  assert.match(
    adapterSource,
    /kind: "tool_call"/,
    'activityDetail should be tool_call kind',
  );
  assert.match(
    adapterSource,
    /tool: part\.tool/,
    'should include tool name',
  );
  assert.match(
    adapterSource,
    /input: part\.state\.input/,
    'should include tool input',
  );
  assert.match(
    adapterSource,
    /function toolDiffProjection\(/,
    'should project SDK tool metadata through one diff fallback policy',
  );
  assert.match(
    adapterSource,
    /toRecord\(metadata\?\.filediff\)/,
    'should support SDK state.metadata.filediff',
  );
  assert.match(
    adapterSource,
    /optionalString\(input\?\.filePath\)/,
    'should use SDK state.input.filePath when state.filePath is absent',
  );
  assert.match(
    adapterSource,
    /diffExcerpt: diff\.diffExcerpt/,
    'should expose an inline activity diff preview',
  );
});

test('SDK summary diffs are projected as one owner-addressable change summary', () => {
  assert.match(
    adapterSource,
    /function summaryDiffProjection\(info: Message\): SdkMessageChangeSummary \| undefined/,
    'should project info.summary.diffs at the SDK boundary',
  );
  assert.match(
    adapterSource,
    /messageId: info\.id/,
    'the SDK envelope ID must remain the Undo target',
  );
  assert.match(
    adapterSource,
    /changeSummary: summaryDiffProjection\(info\)/,
    'every adapted message should carry its own SDK change summary when present',
  );
  assert.match(
    adapterSource,
    /Keep that ownership intact/,
    'should preserve the SDK message that owns the diff summary',
  );
  assert.doesNotMatch(
    adapterSource,
    /assistantIndexesByParentId/,
    'should not move a user-owned SDK summary onto a neighbouring assistant message',
  );
});

test('StepStartPart and StepFinishPart produce internal timeline steps', () => {
  assert.match(
    adapterSource,
    /function adaptStepStartPart\(part: StepStartPart\): SdkMessageStep/,
    'adaptStepStartPart should exist',
  );
  assert.match(
    adapterSource,
    /function adaptStepFinishPart\(part: StepFinishPart\): SdkMessageStep/,
    'adaptStepFinishPart should exist',
  );
  assert.match(
    adapterSource,
    /internal: true/,
    'both step parts should be marked internal',
  );
  assert.match(
    adapterSource,
    /type: "step-start"/,
    'step-start type should be preserved',
  );
  assert.match(
    adapterSource,
    /type: "step-finish"/,
    'step-finish type should be preserved',
  );
});

test('PatchPart adapter produces edits from file list', () => {
  assert.match(
    adapterSource,
    /function adaptPatchPart\(part: PatchPart\): SdkMessageEdit\[\]/,
    'adaptPatchPart should return array of edits',
  );
  assert.match(
    adapterSource,
    /files\.map\(\(file\): SdkMessageEdit =>/,
    'should map files to MessageEdit objects',
  );
  assert.match(
    adapterSource,
    /file,/,
    'each edit should include file path',
  );
  assert.match(
    adapterSource,
    /added: diffStats\?\.added/,
    'should include added line count',
  );
  assert.match(
    adapterSource,
    /deleted: diffStats\?\.deleted/,
    'should include deleted line count',
  );
});

test('SnapshotPart adapter creates checkpoint metadata step', () => {
  assert.match(
    adapterSource,
    /type: "snapshot"/,
    'should produce snapshot-type step',
  );
  assert.match(
    adapterSource,
    /title: "Checkpoint"/,
    'should label as Checkpoint',
  );
  assert.match(
    adapterSource,
    /meta: snapshotPart\.snapshot/,
    'should store snapshot text as meta',
  );
});

test('SubtaskPart adapter creates SubagentDetail for subagent linkage', () => {
  assert.match(
    adapterSource,
    /function adaptSubtaskPart\(part: SubtaskPart, info: Message\): SdkSubagentDetail/,
    'should export adaptSubtaskPart with Message context',
  );
  assert.match(
    adapterSource,
    /childSessionId: part\.sessionID/,
    'should link child session from SubtaskPart',
  );
  assert.match(
    adapterSource,
    /parentMessageId: part\.messageID/,
    'should link parent message from SubtaskPart',
  );
  assert.match(
    adapterSource,
    /agentId: part\.agent/,
    'should include agent ID',
  );
  assert.match(
    adapterSource,
    /status: "pending"/,
    'should set initial status to pending',
  );
  assert.match(
    adapterSource,
    /message\.subagents\?\.push\(/,
    'should push to parent message subagents array',
  );
});

test('FilePart adapter includes url, filename, mime, and source', () => {
  assert.match(
    adapterSource,
    /function adaptFilePart\(part: FilePart\): SdkMessagePart/,
    'adaptFilePart should return SdkMessagePart',
  );
  assert.match(
    adapterSource,
    /type: "file"/,
    'should set type to file',
  );
  assert.match(
    adapterSource,
    /url: part\.url/,
    'should include file url',
  );
  assert.match(
    adapterSource,
    /filename: part\.filename/,
    'should include filename',
  );
  assert.match(
    adapterSource,
    /mime: part\.mime/,
    'should include mime type',
  );
});

test('AgentPart adapter updates message agent field', () => {
  assert.match(
    adapterSource,
    /message\.agent = agentPart\.name/,
    'should set message agent from AgentPart',
  );
  assert.match(
    adapterSource,
    /agent: agentPart\.name/,
    'should update info.agent field',
  );
});

test('RetryPart adapter sets retry state with timing and error', () => {
  assert.match(
    adapterSource,
    /function applyRetryMarker\(message: SdkRenderedMessage, part: RetryPart\)/,
    'should have applyRetryMarker function',
  );
  assert.match(
    adapterSource,
    /retryState = "retrying_without_structured_output"/,
    'should set retry state string',
  );
  assert.match(
    adapterSource,
    /retryStartedAt = part\.time\.created/,
    'should capture retry start time',
  );
  assert.match(
    adapterSource,
    /retryMessage = errorToString\(part\.error\)/,
    'should extract error message',
  );
});

test('CompactionPart adapter sets summary with overflow and auto detection', () => {
  assert.match(
    adapterSource,
    /function applyCompactionMarker\(message: SdkRenderedMessage, part: CompactionPart\)/,
    'should have applyCompactionMarker function',
  );
  assert.match(
    adapterSource,
    /part\.overflow \? "Context compacted after overflow"/,
    'should detect overflow-triggered compaction',
  );
  assert.match(
    adapterSource,
    /part\.auto \? "Context compacted automatically"/,
    'should detect auto-triggered compaction',
  );
});

test('adaptQuestionRequest converts SDK QuestionRequest to interactive event', () => {
  assert.match(
    adapterSource,
    /export function adaptQuestionRequest\(q: QuestionRequest\): SdkInteractiveQuestionEvent/,
    'should export adaptQuestionRequest with correct signature',
  );
  assert.match(
    adapterSource,
    /firstQuestion = toRecord\(q\.questions\[0\]\)/,
    'should extract first question from array',
  );
  assert.match(
    adapterSource,
    /requestID: q\.id/,
    'should set requestID from QuestionRequest id',
  );
  assert.match(
    adapterSource,
    /\?\? \{\s*type: "question"/,
    'should have fallback for empty questions using nullish coalescing',
  );
});

test('adaptPermissionRequest extracts all permission fields', () => {
  assert.match(
    adapterSource,
    /export function adaptPermissionRequest\(p: PermissionRequest\)/,
    'should export adaptPermissionRequest',
  );
  assert.match(
    adapterSource,
    /id: p\.id/,
    'should include permission id',
  );
  assert.match(
    adapterSource,
    /sessionID: p\.sessionID/,
    'should include session ID',
  );
  assert.match(
    adapterSource,
    /permission: p\.permission/,
    'should include permission name',
  );
  assert.match(
    adapterSource,
    /patterns: p\.patterns/,
    'should include file patterns',
  );
  assert.match(
    adapterSource,
    /tool: p\.tool/,
    'should include tool linkage (messageID + callID)',
  );
});

test('adaptSessionToMeta converts SDK Session to webview Session shape', () => {
  assert.match(
    adapterSource,
    /export function adaptSessionToMeta\(session: Session\)/,
    'should export adaptSessionToMeta',
  );
  assert.match(
    adapterSource,
    /id: session\.id/,
    'should include session id',
  );
  assert.match(
    adapterSource,
    /title: session\.title/,
    'should include title',
  );
  assert.match(
    adapterSource,
    /createdAt: session\.time\?\.created/,
    'should extract created time',
  );
  assert.match(
    adapterSource,
    /parentSessionId: session\.parentID/,
    'should extract parent session ID',
  );
});

test('AssistantMessage structured output and error fields are preserved', () => {
  assert.match(
    adapterSource,
    /function isAssistantMessage\(info: Message\): info is AssistantMessage/,
    'should have assistant message type guard',
  );
  assert.match(
    adapterSource,
    /message\.error = errorToString\(info\.error\)/,
    'should extract error from assistant message',
  );
  assert.match(
    adapterSource,
    /message\.tokens = info\.tokens/,
    'should extract tokens from assistant message',
  );
  assert.match(
    adapterSource,
    /function durationSeconds\(info: AssistantMessage\): number \| undefined/,
    'should define the SDK-to-webview duration unit at the adapter boundary',
  );
  assert.match(
    adapterSource,
    /return \(completed - created\) \/ 1000/,
    'should normalize SDK millisecond timestamps to UI seconds',
  );
  assert.match(
    adapterSource,
    /messageInfo\.finish = info\.finish !== undefined/,
    'should flag finished messages',
  );
});

test('UserMessage image attachments are extracted from FileParts', () => {
  assert.match(
    adapterSource,
    /function isUserMessage\(info: Message\): info is UserMessage/,
    'should have user message type guard',
  );
  assert.match(
    adapterSource,
    /filePart\.mime\.startsWith\("image\/"\)/,
    'should detect image mime types',
  );
  assert.match(
    adapterSource,
    /images\.push\(filePart\.url\)/,
    'should collect image URLs',
  );
  assert.match(
    adapterSource,
    /message\.images = images/,
    'should set images on message',
  );
});

test('SessionSnapshotLoader loads all SDK endpoints in parallel', () => {
  assert.match(
    snapshotLoaderSource,
    /Promise\.all\(\[/,
    'should use Promise.all for parallel loading',
  );
  assert.match(
    snapshotLoaderSource,
    /client\.session\.get\(\{ sessionID \}\)/,
    'should load session metadata',
  );
  assert.match(
    snapshotLoaderSource,
    /client\.session\.messages\(\{ sessionID \}\)/,
    'should load session messages',
  );
  assert.match(
    snapshotLoaderSource,
    /client\.question\.list\(\)/,
    'should load pending questions',
  );
  assert.match(
    snapshotLoaderSource,
    /client\.permission\.list\(\)/,
    'should load pending permissions',
  );
  assert.match(
    snapshotLoaderSource,
    /client\.session\.children\(\{ sessionID \}\)/,
    'should load child sessions',
  );
});

test('SessionSnapshotLoader filters questions and permissions by sessionID', () => {
  assert.match(
    snapshotLoaderSource,
    /question\.sessionID === sessionID/,
    'should filter questions by sessionID',
  );
  assert.match(
    snapshotLoaderSource,
    /permission\.sessionID === sessionID/,
    'should filter permissions by sessionID',
  );
});

test('SessionSnapshotLoader handles partial failures gracefully', () => {
  assert.match(
    snapshotLoaderSource,
    /catch \(error\)/,
    'should catch individual endpoint errors',
  );
  assert.match(
    snapshotLoaderSource,
    /return undefined/,
    'should return undefined for failed endpoints',
  );
  assert.match(
    snapshotLoaderSource,
    /messages: messages \?\? \[\]/,
    'should default messages to empty array on failure',
  );
  assert.match(
    snapshotLoaderSource,
    /throw new Error\(`Failed to load session metadata/,
    'should throw only when session.get fails (critical)',
  );
});

test('SessionSnapshotLoader provides convenience methods', () => {
  assert.match(
    snapshotLoaderSource,
    /async loadMessagesOnly\(sessionID: string\)/,
    'should have loadMessagesOnly convenience method',
  );
  assert.match(
    snapshotLoaderSource,
    /async loadSessionMeta\(sessionID: string\)/,
    'should have loadSessionMeta convenience method',
  );
});
