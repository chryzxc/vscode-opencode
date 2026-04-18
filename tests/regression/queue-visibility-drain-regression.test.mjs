/**
 * Queue Visibility & Drain Regression Tests
 *
 * Prevents regressions in the message queue flow:
 *
 * 1. Backend getQueueState() must return a flat array (not a wrapped object)
 *    so the webview's isQueueItem validator can parse each item.
 *    Regression: getQueueState() returned { size, isExecuting, prompts: [{id, text}] }
 *    which caused asArray(data.queue, isQueueItem) to fail silently — items never rendered.
 *
 * 2. executeQueue must shift each item BEFORE executing it, and fire onItemCompleted
 *    immediately so the webview removes the item from the pending stack the moment it
 *    is dispatched — not after the AI finishes responding.
 *    Regression: items were shifted after await executePrompt(), so the stack only
 *    updated once all items completed.
 *
 * 3. sendPrompt must optimistically add to local promptQueue via ADD_TO_LOCAL_QUEUE
 *    so the user sees their message instantly in the stack before the backend confirms.
 *    Regression: messages were invisible until the backend's queueUpdate arrived.
 *
 * 4. QueueContainer must render a compact always-visible stack (not a collapsible panel).
 *    Regression: QueueContainer was collapsed by default showing only "Queue [N]".
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from "../helpers/source-utils.mjs";

const queueManagerSource = readSource(
  [joinFromRoot("src", "providers", "chat", "QueueManager.ts")],
  "QueueManager.ts",
);

const panelSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "PanelComponents.tsx")],
  "PanelComponents.tsx",
);

const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

// ---------------------------------------------------------------------------
// 1. Backend: getQueueState() returns flat array
// ---------------------------------------------------------------------------

test.describe("Queue backend data format", () => {
  test("getQueueState returns a flat array via this.queue.map (not a wrapped object)", () => {
    const body = extractFunctionBody(queueManagerSource, "getQueueState()");

    assert.match(
      body,
      /return\s+this\.queue\.map/,
      "getQueueState must return this.queue.map(...) — a flat array of items",
    );

    assert.doesNotMatch(
      body,
      /size:\s*this\.queue\.length/,
      "getQueueState must NOT wrap items in { size, isExecuting, prompts } — the webview expects a bare array",
    );
  });

  test("getQueueState serializes full item fields (id, sessionId, createdAt, text, files, contexts, agent)", () => {
    const body = extractFunctionBody(queueManagerSource, "getQueueState()");

    assert.match(body, /id:\s*p\.id/, "must include id");
    assert.match(body, /sessionId:\s*p\.sessionId/, "must include sessionId");
    assert.match(body, /createdAt:\s*p\.createdAt/, "must include createdAt");
    assert.match(body, /text:\s*p\.text/, "must include text");
    assert.match(body, /files:\s*p\.files/, "must include files");
    assert.match(body, /contexts:\s*p\.contexts/, "must include contexts");
    assert.match(body, /agent:\s*p\.agent/, "must include agent");
  });

  test("sendQueueUpdate passes queue array directly as the queue field", () => {
    const body = extractFunctionBody(queueManagerSource, "sendQueueUpdate(sessionId");

    assert.match(
      body,
      /queue:\s*this\.getQueueState\(\)/,
      "sendQueueUpdate must pass getQueueState() directly as the queue payload",
    );
  });

  test("messageHandler queueUpdate handler parses data.queue as an array", () => {
    assert.match(
      messageHandlerSource,
      /case\s+["']queueUpdate["'][\s\S]*asArray\s*\(\s*data\.queue\s*,\s*isQueueItem\s*\)/s,
      "queueUpdate handler must call asArray(data.queue, isQueueItem) — expects bare array",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Backend: executeQueue shifts items BEFORE execution
// ---------------------------------------------------------------------------

test.describe("Queue drain ordering", () => {
  test("executeQueue shifts items off the queue BEFORE executing each prompt", () => {
    const body = extractFunctionBody(queueManagerSource, "async executeQueue(");

    // The pattern we're locking in: shift() must appear BEFORE await executePrompt()
    // We check that shift() comes before the execute call
    const shiftIndex = body.indexOf("this.queue.shift()");
    const executeIndex = body.indexOf("await executePrompt(prompt)");

    assert.ok(shiftIndex !== -1, "must call this.queue.shift()");
    assert.ok(executeIndex !== -1, "must call await executePrompt(prompt)");
    assert.ok(
      shiftIndex < executeIndex,
      "this.queue.shift() must come BEFORE await executePrompt — items are removed from the queue before the AI processes them",
    );
  });

  test("executeQueue accepts onItemCompleted callback parameter", () => {
    const body = extractFunctionBody(queueManagerSource, "async executeQueue(");

    assert.match(
      body,
      /onItemCompleted/,
      "executeQueue must accept an onItemCompleted callback",
    );
  });

  test("onItemCompleted is called immediately after shift (before executePrompt)", () => {
    const body = extractFunctionBody(queueManagerSource, "async executeQueue(");

    const shiftIndex = body.indexOf("this.queue.shift()");
    const callbackIndex = body.indexOf("onItemCompleted?.()");
    const executeIndex = body.indexOf("await executePrompt(prompt)");

    assert.ok(callbackIndex !== -1, "must call onItemCompleted?.()");
    assert.ok(
      callbackIndex > shiftIndex,
      "onItemCompleted fires after shift",
    );
    assert.ok(
      callbackIndex < executeIndex,
      "onItemCompleted fires BEFORE await executePrompt — the webview is notified before the AI starts responding",
    );
  });

  test("handleExecuteQueue passes sendQueueUpdate as onItemCompleted callback", () => {
    const body = extractFunctionBody(queueManagerSource, "async handleExecuteQueue(");

    assert.match(
      body,
      /this\.executeQueue\s*\(/,
      "handleExecuteQueue must call this.executeQueue",
    );
    assert.match(
      body,
      /\(\)\s*=>[\s\S]*?this\.sendQueueUpdate\(sessionId\)/s,
      "handleExecuteQueue must pass () => this.sendQueueUpdate(sessionId) as second arg to executeQueue",
    );
  });

  test("executeQueue uses while loop (not for-of) so shift() works correctly", () => {
    const body = extractFunctionBody(queueManagerSource, "async executeQueue(");

    assert.match(
      body,
      /while\s*\(\s*this\.queue\.length\s*>\s*0\s*\)/,
      "must use while(this.queue.length > 0) loop to support shift-before-execute",
    );

    assert.doesNotMatch(
      body,
      /for\s*\(\s*const\s+prompt\s+of\s+this\.queue\s*\)/,
      "must NOT use for-of loop — iterating while shifting would skip items",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Frontend: sendPrompt optimistically adds to local queue
// ---------------------------------------------------------------------------

test.describe("Optimistic queue add", () => {
  test("sendPrompt dispatches ADD_TO_LOCAL_QUEUE when isProcessing", () => {
    const body = extractFunctionBody(panelSource, "export function InputWrapper()");

    assert.match(
      body,
      /if\s*\(isProcessing\)\s*\{[\s\S]*type:\s*["']ADD_TO_LOCAL_QUEUE["']/s,
      "when isProcessing, sendPrompt must dispatch ADD_TO_LOCAL_QUEUE",
    );
  });

  test("sendPrompt also sends addToQueue to backend when isProcessing", () => {
    const body = extractFunctionBody(panelSource, "export function InputWrapper()");

    assert.match(
      body,
      /if\s*\(isProcessing\)\s*\{[\s\S]*type:\s*["']addToQueue["']/s,
      "when isProcessing, sendPrompt must also post addToQueue to extension host",
    );
  });

  test("optimistic payload includes id, sessionId, createdAt, text", () => {
    const body = extractFunctionBody(panelSource, "export function InputWrapper()");

    assert.match(
      body,
      /ADD_TO_LOCAL_QUEUE[\s\S]*payload:\s*\{[^}]*id:\s*optimisticId/s,
      "optimistic payload must include a generated id",
    );
    assert.match(
      body,
      /ADD_TO_LOCAL_QUEUE[\s\S]*payload:\s*\{[^}]*sessionId:/s,
      "optimistic payload must include sessionId",
    );
    assert.match(
      body,
      /ADD_TO_LOCAL_QUEUE[\s\S]*payload:\s*\{[^}]*createdAt:\s*Date\.now/s,
      "optimistic payload must include createdAt",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Frontend: store reducer handles ADD_TO_LOCAL_QUEUE and SET_QUEUE
// ---------------------------------------------------------------------------

test.describe("Queue store reducer", () => {
  test("ADD_TO_LOCAL_QUEUE action type exists in store", () => {
    assert.match(
      storeSource,
      /type:\s*["']ADD_TO_LOCAL_QUEUE["']/,
      "store must define ADD_TO_LOCAL_QUEUE action type",
    );
  });

  test("ADD_TO_LOCAL_QUEUE reducer adds item and sets isQueueOpen true", () => {
    const body = extractFunctionBody(storeSource, 'case "ADD_TO_LOCAL_QUEUE"');

    assert.match(
      body,
      /promptQueue.*item|promptQueue:.*payload/,
      "ADD_TO_LOCAL_QUEUE must add item to promptQueue",
    );

    assert.match(
      body,
      /isQueueOpen:\s*true/,
      "ADD_TO_LOCAL_QUEUE must set isQueueOpen to true",
    );
  });

  test("ADD_TO_LOCAL_QUEUE deduplicates by id", () => {
    const body = extractFunctionBody(storeSource, 'case "ADD_TO_LOCAL_QUEUE"');

    assert.match(
      body,
      /alreadyExists|some\s*\(.*q\.id\s*===\s*item\.id\)/,
      "ADD_TO_LOCAL_QUEUE must check for duplicate ids",
    );
  });

  test("ADD_TO_LOCAL_QUEUE also updates queueBySessionId", () => {
    const body = extractFunctionBody(storeSource, 'case "ADD_TO_LOCAL_QUEUE"');

    assert.match(
      body,
      /queueBySessionId/,
      "ADD_TO_LOCAL_QUEUE must also update queueBySessionId",
    );
  });

  test("SET_QUEUE replaces promptQueue with backend-authoritative data", () => {
    const body = extractFunctionBody(storeSource, 'case "SET_QUEUE"');

    assert.match(
      body,
      /getQueueForSession|sessionQueue/,
      "SET_QUEUE must derive session-specific queue from payload",
    );

    assert.match(
      body,
      /queueBySessionId/,
      "SET_QUEUE must update queueBySessionId",
    );

    assert.match(
      body,
      /promptQueue:/,
      "SET_QUEUE must update promptQueue for the active session",
    );
  });

  test("SET_QUEUE clears queueBySessionId entry when session queue is empty", () => {
    const body = extractFunctionBody(storeSource, 'case "SET_QUEUE"');

    assert.match(
      body,
      /delete\s+nextBySession/,
      "SET_QUEUE must delete the session key when queue is empty — not leave stale entries",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Frontend: QueueContainer renders compact stack (not collapsible)
// ---------------------------------------------------------------------------

test.describe("QueueContainer UI contract", () => {
  test("QueueContainer renders all items by default (no collapsed state)", () => {
    const body = extractFunctionBody(panelSource, "export function QueueContainer()");

    assert.doesNotMatch(
      body,
      /isQueueOpen\s*&&\s*\(/,
      "QueueContainer must NOT gate item rendering on isQueueOpen — items are always visible",
    );

    assert.match(
      body,
      /promptQueue\.map/,
      "QueueContainer must map promptQueue to render items",
    );
  });

  test("QueueContainer shows Pending label with count badge", () => {
    const body = extractFunctionBody(panelSource, "export function QueueContainer()");

    assert.match(
      body,
      /Pending/,
      "QueueContainer must show 'Pending' label",
    );

    assert.match(
      body,
      /promptQueue\.length/,
      "QueueContainer must show queue count",
    );
  });

  test("QueueContainer shows per-item remove button (X icon)", () => {
    const body = extractFunctionBody(panelSource, "export function QueueContainer()");

    assert.match(
      body,
      /removeQueuedItem/,
      "QueueContainer must have a removeQueuedItem handler",
    );

    assert.match(
      body,
      /<X\s+className/,
      "QueueContainer must render X icon for remove button on each item",
    );
  });

  test("QueueContainer supports clear all action", () => {
    const body = extractFunctionBody(panelSource, "export function QueueContainer()");

    assert.match(
      body,
      /type:\s*["']clearQueue["']/,
      "QueueContainer must post clearQueue action",
    );
  });

  test("QueueContainer does NOT render steer or send-now per-item buttons", () => {
    const body = extractFunctionBody(panelSource, "export function QueueContainer()");

    assert.doesNotMatch(
      body,
      /steerQueuedItem/,
      "QueueContainer must NOT render steer buttons — items auto-execute",
    );

    assert.doesNotMatch(
      body,
      /sendQueuedItemNow/,
      "QueueContainer must NOT render send-now buttons — items auto-execute",
    );
  });

  test("QueueContainer shows numbered index per item", () => {
    const body = extractFunctionBody(panelSource, "export function QueueContainer()");

    assert.match(
      body,
      /index\s*\+\s*1/,
      "QueueContainer must show 1-based position number for each queued item",
    );
  });
});
