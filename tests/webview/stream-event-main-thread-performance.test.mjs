import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);
const debugStoreSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "sdkDebugStore.ts")],
  "sdkDebugStore.ts",
);
const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);
const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);
const streamHandlerSource = readSource(
  [joinFromRoot("src", "providers", "chat", "StreamEventHandler.ts")],
  "StreamEventHandler.ts",
);
const webviewLoggerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "logger.ts")],
  "webview logger",
);
const perfProbeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "streamingPerfProbe.ts")],
  "streamingPerfProbe.ts",
);
const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);
const diagnosticsLoggerSource = readSource(
  [joinFromRoot("src", "providers", "chat", "DiagnosticsLogger.ts")],
  "DiagnosticsLogger.ts",
);

test("live reasoning deltas do not retain an accumulated buffer", () => {
  assert.match(
    storeSource,
    /const suppressLiveReasoningText =[\s\S]*?state\.streaming\.isActive === true[\s\S]*?action\.payload\.append === true/s,
  );
  assert.match(
    storeSource,
    /suppressLiveReasoningText\s*\? \{ reasoning: state\.streaming\.reasoning \}/,
  );
});

test("live response text is never rerouted into reasoning by duplicate-token heuristics", () => {
  assert.doesNotMatch(
    handlerSource,
    /candidateTokens = comparableTokens\(candidateContent\.slice\(-2048\)\)[\s\S]*?UPDATE_STREAMING_REASONING/s,
  );
});

test("extension-host stream delivery posts every event without batching or coalescing", () => {
  assert.match(
    providerSource,
    /private enqueueStreamWebviewEvent\([\s\S]*?type: "streamEvent",[\s\S]*?event,[\s\S]*?sessionId,[\s\S]*?immediate/s,
  );
  assert.doesNotMatch(
    providerSource,
    /pendingStreamWebviewEvents|coalesceWebviewStreamDelta|streamEventBatch/,
  );
  assert.match(
    streamHandlerSource,
    /this\.postMessage\(\{[\s\S]*?type: "streamEvent",[\s\S]*?event: enrichedEvent \|\| event,[\s\S]*?sessionId/s,
  );
  assert.doesNotMatch(
    streamHandlerSource,
    /pendingEvents|streamEventBatch|flushPendingEvents/,
  );
});

test("extension host suppresses a replayed direct transport event without preferring either source", () => {
  assert.match(
    providerSource,
    /private isDuplicateStreamEvent\(event: unknown, sessionId\?: string\)/,
  );
  assert.match(
    providerSource,
    /const eventId = this\.firstNonEmptyString\(record\.id, record\.eventID, record\.eventId\)/,
    "direct and sync-wrapped copies share the SDK event id",
  );
  assert.match(
    providerSource,
    /if \(this\.isDuplicateStreamEvent\(event, eventSessionId\)\)[\s\S]*?return;/,
    "the second transport copy is suppressed by SDK event identity, regardless of whether /event, /global/event, or sync arrived first",
  );
});

test("the first event of a new assistant turn remains marked as immediate", () => {
  assert.match(
    providerSource,
    /firstStreamWebviewEventPendingBySession = new Set<string>\(\)/,
  );
  assert.match(
    providerSource,
    /this\.firstStreamWebviewEventPendingBySession\.add\(sessionId\)/,
  );
  assert.match(
    providerSource,
    /this\.firstStreamWebviewEventPendingBySession\.delete\(resolvedSessionId\)/,
  );
  assert.match(
    providerSource,
    /immediate,/,
  );
  assert.match(handlerSource, /processScopedStreamEvent\(\);/);
  assert.doesNotMatch(handlerSource, /startTransition\(/);
});

test("enabled SDK diagnostics retain the complete external live-event trail", () => {
  assert.match(handlerSource, /appendLiveSdkDebugEvents\(sessionId, events\)/);
  assert.match(
    handlerSource,
    /appendLiveEventsToDebugPanel\(debugEvents\)/,
  );
  assert.doesNotMatch(storeSource, /LIVE_EVENT_STREAM_DEBUG/);
  assert.doesNotMatch(debugStoreSource, /MAX_LIVE_EVENTS/);
  assert.doesNotMatch(debugStoreSource, /NOTIFY_INTERVAL_MS|setTimeout\(publish/);
  assert.match(debugStoreSource, /publish\(\);/);
});

test("host does not send a second delayed debug-event stream", () => {
  assert.doesNotMatch(
    providerSource,
    /enqueueLiveEventDebugEvent|liveEventDebugFlushTimer|liveEventStreamDebugBatch/,
  );
  assert.match(handlerSource, /appendLiveEventsToDebugPanel\(\[/);
});

test("webview transport bounds oversized tool output without truncating persisted events", () => {
  assert.match(
    providerSource,
    /MAX_STREAM_WEBVIEW_TOOL_OUTPUT_CHARS = 16_384/,
  );
  assert.match(
    providerSource,
    /private buildWebviewStreamEvent\(/,
  );
  assert.match(
    providerSource,
    /const eventForWebview = this\.buildWebviewStreamEvent\(/,
  );
  // buildWebviewStreamEvent returns the truncated clone directly — no
  // redundant spread of the original event over the clone.
  assert.match(
    providerSource,
    /return this\.cloneAndTruncateStreamPayload\(enrichedEvent\)/,
  );
  assert.doesNotMatch(
    providerSource,
    /\.\.\.\s*enrichedEvent\b.*\.\.\.\s*truncatedDeepClone/s,
    "buildWebviewStreamEvent must not spread the original event over the truncated clone (the clone already contains every key)",
  );
});

test("hot stream diagnostics do not allocate an unbounded log entry per token", () => {
  assert.doesNotMatch(providerSource, /takeVerboseStreamDeltaLogSample\(\)/);
  assert.doesNotMatch(providerSource, /coalescedDeltaEvents/);
  assert.match(webviewLoggerSource, /wouldLog\(level: LogLevel\)/);
  assert.match(handlerSource, /if \(logger\.wouldLog\('debug'\)\)/);
  assert.match(storeSource, /logger\.wouldLog\('info'\)/);
  assert.match(
    diagnosticsLoggerSource,
    /eventType\.startsWith\("message\.part\."\)[\s\S]*?typeof properties\.delta === "string"[\s\S]*?typeof part\?\.delta === "string"[\s\S]*?return;/,
    "the duplicate diagnostics logger must skip individual token deltas",
  );
  assert.match(
    providerSource,
    /const shouldLogVerboseStreamDetail =[\s\S]*?verboseStreamDebugEnabled && !isHighFrequencyDelta/,
    "generic verbose stream logs must not emit once per token",
  );
  assert.match(providerSource, /lastStreamPerformanceLogAt < 2_000/);
  assert.match(webviewLoggerSource, /now - previous < 2_000/);
  assert.match(providerSource, /if \(durationMs < 16\) \{\s*return;/);
  assert.match(webviewLoggerSource, /typeof durationMs !== "number" \|\| durationMs < 16/);
  assert.doesNotMatch(
    handlerSource,
    /logger\.debug\(`Received Event:[\s\S]*?fullData:\s*data/,
    "browser console entries must not retain complete stream payload graphs",
  );
});

test("automatic stream diagnostics report stalls without retaining payloads", () => {
  assert.match(chatShellSource, /perfProbe\.setStreamingActive\(active, state\.currentSessionId\)/);
  assert.match(perfProbeSource, /EVENT_LOOP_STALL_MS = 200/);
  assert.match(perfProbeSource, /\[STREAM-DIAG\]/);
  assert.match(perfProbeSource, /message-handler-stall/);
  assert.match(perfProbeSource, /render-commit-stall/);
  assert.match(perfProbeSource, /webview-event-loop-gap/);
  assert.match(perfProbeSource, /stream-summary/);
  assert.doesNotMatch(perfProbeSource, /fullData|rawSdkEventPayloads|JSON\.stringify/);
  assert.match(
    perfProbeSource,
    /if \(manuallyEnabled\(\)\) \{\s*record\(dispatchBuckets/,
    "automatic diagnostics must not accumulate per-action bucket state",
  );
  assert.match(providerSource, /queueDepth: 0/);
  assert.match(providerSource, /heapUsedMb:/);
  assert.match(providerSource, /rssMb:/);
});
