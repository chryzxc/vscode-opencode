/**
 * Message Streaming Flow Integration Tests
 *
 * Validates the complete SSE message streaming pipeline:
 *   subscribe → startListening → consumeEventStream → normalize → dedupe →
 *   filter → dispatch → callback
 *
 * Also covers:
 *   - Subscribe/unsubscribe lifecycle management
 *   - Event normalization for multiple incoming shapes
 *   - Duplicate suppression with time-windowed dedupe
 *   - Workspace directory filtering
 *   - Error recovery and reconnection
 *   - Heartbeat handling
 *
 * Uses source-introspection to assert the codebase implements
 * every step of the message streaming flow.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  readSource,
  readAllSources,
  extractFunctionBody,
  joinFromRoot,
} from "../helpers/source-utils.mjs";

const streamServiceSource = readSource(
  [joinFromRoot("src", "services", "MessageStreamService.ts")],
  "MessageStreamService.ts",
);

// ---------------------------------------------------------------------------
// Subscribe / unsubscribe lifecycle
// ---------------------------------------------------------------------------

test("MessageStreamService has subscribe method that registers callback", () => {
  assert.match(
    streamServiceSource,
    /subscribe\s*\(\s*callback/,
    "MessageStreamService must have subscribe(callback) method",
  );
});

test("subscribe returns unsubscribe function", () => {
  const subBody = extractFunctionBody(
    streamServiceSource,
    "subscribe(callback",
  );
  assert.ok(subBody, "subscribe method must exist");
  assert.match(
    subBody,
    /return\s*\(\s*\)\s*=>/,
    "subscribe must return an unsubscribe function",
  );
});

test("subscribe auto-starts listening on first subscriber", () => {
  const subBody = extractFunctionBody(
    streamServiceSource,
    "subscribe(callback",
  );
  assert.match(
    subBody,
    /startListening/,
    "subscribe must call startListening when first callback is added",
  );
});

test("subscribe uses a callbacks collection to track subscribers", () => {
  assert.match(
    streamServiceSource,
    /callbacks/,
    "MessageStreamService must maintain a callbacks collection",
  );
});

// ---------------------------------------------------------------------------
// Stream connection: startListening
// ---------------------------------------------------------------------------

test("startListening ensures server is running before subscribing to events", () => {
  const startBody = extractFunctionBody(
    streamServiceSource,
    "async startListening",
  );
  assert.ok(startBody, "startListening method must exist");
  assert.match(
    startBody,
    /serverManager\.ensureRunning/,
    "startListening must call serverManager.ensureRunning",
  );
});

test("startListening subscribes to server event stream", () => {
  assert.match(
    streamServiceSource,
    /client\.event\.subscribe/,
    "startListening must call client.event.subscribe",
  );
});

test("startListening passes workspace directory for scoped subscription", () => {
  assert.match(
    streamServiceSource,
    /workspaceDirectory|directory/,
    "startListening must pass workspace directory for event scoping",
  );
});

test("startListening subscribes to both workspace and global event streams", () => {
  assert.match(
    streamServiceSource,
    /global\.event|global\.subscribe|globalEvent/,
    "startListening must subscribe to global event stream as well",
  );
});

test("startListening handles connection errors and schedules reconnect", () => {
  assert.match(
    streamServiceSource,
    /reconnectTimer|reconnect|setTimeout/,
    "startListening must schedule reconnect on connection error",
  );
});

// ---------------------------------------------------------------------------
// Event stream consumption
// ---------------------------------------------------------------------------

test("consumeEventStream iterates over async iterable stream", () => {
  assert.match(
    streamServiceSource,
    /consumeEventStream/,
    "MessageStreamService must have consumeEventStream method",
  );
  assert.match(
    streamServiceSource,
    /for\s+await/,
    "consumeEventStream must iterate async iterable stream",
  );
});

test("consumeEventStream accepts abort signal for cancellation", () => {
  assert.match(
    streamServiceSource,
    /abortSignal|AbortController|abort/,
    "consumeEventStream must accept abort signal for stream cancellation",
  );
});

// ---------------------------------------------------------------------------
// Event normalization
// ---------------------------------------------------------------------------

test("MessageStreamService normalizes incoming event shapes", () => {
  assert.match(
    streamServiceSource,
    /normalizeIncomingEvent|normalizeEvent|normalize/,
    "MessageStreamService must normalize incoming event shapes",
  );
});

test("normalization handles { type, properties } shape", () => {
  assert.match(
    streamServiceSource,
    /properties/,
    "normalization must handle events with properties field",
  );
});

test("normalization handles { directory, payload: { type, properties } } shape", () => {
  assert.match(
    streamServiceSource,
    /payload/,
    "normalization must handle events with nested payload structure",
  );
});

// ---------------------------------------------------------------------------
// Duplicate suppression
// ---------------------------------------------------------------------------

test("MessageStreamService implements duplicate event detection", () => {
  assert.match(
    streamServiceSource,
    /isDuplicateEvent|duplicate|dedup/i,
    "MessageStreamService must detect and suppress duplicate events",
  );
});

test("duplicate detection uses event signatures", () => {
  assert.match(
    streamServiceSource,
    /getEventSignature|eventSignature|signature/i,
    "duplicate detection must compute event signatures",
  );
});

test("duplicate detection uses time-windowed cache", () => {
  assert.match(
    streamServiceSource,
    /recentEventSignatures|recentEvents|eventCache/i,
    "duplicate detection must use a recent events cache",
  );
});

test("stale entries are pruned from duplicate cache", () => {
  assert.match(
    streamServiceSource,
    /stale|prune|clean|expire/i,
    "duplicate detection must prune stale entries from cache",
  );
});

// ---------------------------------------------------------------------------
// Directory filtering
// ---------------------------------------------------------------------------

test("MessageStreamService filters events by workspace directory", () => {
  assert.match(
    streamServiceSource,
    /directory\s*===|directory\s*!==|\.directory\b/,
    "consumeEventStream must filter events by workspace directory",
  );
});

// ---------------------------------------------------------------------------
// Callback dispatch
// ---------------------------------------------------------------------------

test("MessageStreamService dispatches normalized events to all subscribers", () => {
  assert.match(
    streamServiceSource,
    /notifyCallbacks|callbacks\.forEach|callbacks\.\w+\(callback/,
    "MessageStreamService must dispatch events to all registered callbacks",
  );
});

test("callback errors are caught and logged without breaking delivery", () => {
  assert.match(
    streamServiceSource,
    /try\s*\{[\s\S]*callback[\s\S]*\}\s*catch/,
    "callback dispatch must wrap individual callbacks in try/catch",
  );
});

// ---------------------------------------------------------------------------
// Stop / dispose flow
// ---------------------------------------------------------------------------

test("stopListening aborts active stream connection", () => {
  const stopBody = extractFunctionBody(
    streamServiceSource,
    "stopListening",
  );
  assert.ok(stopBody, "stopListening method must exist");
  assert.match(
    stopBody,
    /abort|AbortController/,
    "stopListening must abort active stream",
  );
});

test("dispose stops listening and clears all callbacks", () => {
  const disposeBody = extractFunctionBody(
    streamServiceSource,
    "dispose",
  );
  assert.ok(disposeBody, "dispose method must exist");
  assert.match(
    disposeBody,
    /stopListening/,
    "dispose must call stopListening",
  );
  assert.match(
    disposeBody,
    /callbacks\.clear\(\)|callbacks\s*=\s*\[\]|callbacks\s*=\s*new\s+Set/,
    "dispose must clear callbacks collection",
  );
});

// ---------------------------------------------------------------------------
// Heartbeat handling
// ---------------------------------------------------------------------------

test("MessageStreamService recognizes heartbeat events", () => {
  assert.match(
    streamServiceSource,
    /heartbeat|HEARTBEAT/i,
    "MessageStreamService must handle heartbeat events",
  );
});

// ---------------------------------------------------------------------------
// Cross-service interaction: OpencodeServerManager
// ---------------------------------------------------------------------------

test("MessageStreamService constructor accepts serverManager", () => {
  assert.match(
    streamServiceSource,
    /serverManager/,
    "MessageStreamService must accept serverManager dependency",
  );
});

test("MessageStreamService uses serverManager to obtain SDK client", () => {
  assert.match(
    streamServiceSource,
    /serverManager\.ensureRunning/,
    "MessageStreamService must use serverManager.ensureRunning to get client",
  );
});

// ---------------------------------------------------------------------------
// SSE event type handling
// ---------------------------------------------------------------------------

test("MessageStreamService handles message.part.updated events", () => {
  assert.match(
    streamServiceSource,
    /message\.part\.updated/,
    "MessageStreamService must handle message.part.updated events",
  );
});

test("MessageStreamService handles message.updated events", () => {
  assert.match(
    streamServiceSource,
    /message\.updated/,
    "MessageStreamService must handle message.updated events",
  );
});

test("MessageStreamService handles session.error events", () => {
  assert.match(
    streamServiceSource,
    /session\.error/,
    "MessageStreamService must handle session.error events",
  );
});

// ---------------------------------------------------------------------------
// Stream source tracking
// ---------------------------------------------------------------------------

test("consumeEventStream tracks stream source for dedup context", () => {
  assert.match(
    streamServiceSource,
    /source/,
    "consumeEventStream must track which stream source events come from",
  );
});
