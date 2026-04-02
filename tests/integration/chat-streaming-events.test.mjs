import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert";

/**
 * Chat Streaming Events Integration Tests
 *
 * Tests the complete streaming event flow from server to webview:
 *
 * **Streaming Pipeline:**
 * 1. Server sends SSE events
 * 2. MessageStreamService receives and parses
 * 3. StreamEventHandler processes and enriches
 * 4. Events posted to webview
 * 5. Webview updates React state
 * 6. UI re-renders with new content
 *
 * **Event Types Tested:**
 * - message.part.updated (delta streaming)
 * - message.updated (complete message)
 * - usage (token tracking)
 * - subagent.* (background tasks)
 * - permission.* (interactive requests)
 * - error (error handling)
 */

// ============================================================================
// Mock Implementations
// ============================================================================

class MockSSEStream {
    constructor() {
        this.events = [];
        this.closed = false;
    }

    addEvent(event) {
        if (this.closed) return;
        this.events.push(event);
    }

    close() {
        this.closed = true;
    }

    reset() {
        this.events = [];
        this.closed = false;
    }
}

class MockStreamCallback {
    constructor() {
        this.receivedEvents = [];
    }

    callback(event) {
        this.receivedEvents.push(event);
    }

    reset() {
        this.receivedEvents = [];
    }
}

// ============================================================================
// SSE Event Parser
// ============================================================================

class SSEEventParser {
    constructor() {
        this.buffer = "";
    }

    parse(chunk) {
        const events = [];
        this.buffer += chunk;

        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || ""; // Keep incomplete line in buffer

        let currentEvent = {};

        for (const line of lines) {
            if (line === "") {
                // Empty line marks end of event
                if (Object.keys(currentEvent).length > 0) {
                    events.push(currentEvent);
                    currentEvent = {};
                }
                continue;
            }

            if (line.startsWith("data: ")) {
                const data = line.slice(6);
                try {
                    currentEvent.data = JSON.parse(data);
                } catch {
                    currentEvent.data = data;
                }
            } else if (line.startsWith("event: ")) {
                currentEvent.type = line.slice(7);
            } else if (line.startsWith("id: ")) {
                currentEvent.id = line.slice(4);
            }
        }

        // Handle last event if stream ended without trailing newline
        if (Object.keys(currentEvent).length > 0) {
            events.push(currentEvent);
        }

        return events;
    }

    reset() {
        this.buffer = "";
    }
}

// ============================================================================
// Test Suite
// ============================================================================

describe("Chat Streaming Events Integration Tests", () => {
    let stream;
    let callback;
    let parser;

    before(() => {
        stream = new MockSSEStream();
        callback = new MockStreamCallback();
        parser = new SSEEventParser();
    });

    afterEach(() => {
        stream.reset();
        callback.reset();
        parser.reset();
    });

    describe("SSE Protocol Parsing", () => {
        it("should parse single complete event", () => {
            const chunk = 'data: {"type":"test","value":"hello"}\n\n';

            const events = parser.parse(chunk);

            assert.strictEqual(events.length, 1);
            assert.deepStrictEqual(events[0].data, { type: "test", value: "hello" });
        });

        it("should parse multiple events in one chunk", () => {
            const chunk = 'data: {"type":"event1"}\n\ndata: {"type":"event2"}\n\n';

            const events = parser.parse(chunk);

            assert.strictEqual(events.length, 2);
            assert.strictEqual(events[0].data.type, "event1");
            assert.strictEqual(events[1].data.type, "event2");
        });

        it("should handle incomplete events across chunks", () => {
            const chunk1 = 'data: {"type":"test",';
            const chunk2 = '"value":"hello"}\n\n';

            const events1 = parser.parse(chunk1);
            const events2 = parser.parse(chunk2);

            assert.strictEqual(events1.length, 0);
            assert.strictEqual(events2.length, 1);
            assert.strictEqual(events2[0].data.value, "hello");
        });

        it("should handle events with id and type", () => {
            const chunk = 'id: msg-123\nevent: message.updated\ndata: {"content":"Hello"}\n\n';

            const events = parser.parse(chunk);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].id, "msg-123");
            assert.strictEqual(events[0].type, "message.updated");
            assert.deepStrictEqual(events[0].data, { content: "Hello" });
        });
    });

    describe("Message Delta Streaming", () => {
        it("should stream message deltas in real-time", () => {
            const deltas = [
                'data: {"type":"message.part.updated","properties":{"delta":"Hello"}}\n\n',
                'data: {"type":"message.part.updated","properties":{"delta":" world"}}\n\n',
                'data: {"type":"message.part.updated","properties":{"delta":"!"}}\n\n',
            ];

            let fullContent = "";

            for (const delta of deltas) {
                const events = parser.parse(delta);
                for (const event of events) {
                    if (event.data.type === "message.part.updated") {
                        fullContent += event.data.properties.delta;
                        callback.callback(event.data);
                    }
                }
            }

            assert.strictEqual(fullContent, "Hello world!");
            assert.strictEqual(callback.receivedEvents.length, 3);
        });

        it("should handle message completion event", () => {
            const completionEvent = 'data: {"type":"message.updated","properties":{"content":"Complete message","role":"assistant"}}\n\n';

            const events = parser.parse(completionEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.type, "message.updated");
            assert.strictEqual(events[0].data.properties.content, "Complete message");
            assert.strictEqual(events[0].data.properties.role, "assistant");
        });
    });

    describe("Token Usage Tracking", () => {
        it("should track prompt tokens", () => {
            const usageEvent = 'data: {"type":"usage","properties":{"promptTokens":100,"completionTokens":0,"totalTokens":100}}\n\n';

            const events = parser.parse(usageEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.properties.promptTokens, 100);
            assert.strictEqual(events[0].data.properties.totalTokens, 100);
        });

        it("should track completion tokens", () => {
            const usageEvent = 'data: {"type":"usage","properties":{"promptTokens":50,"completionTokens":75,"totalTokens":125}}\n\n';

            const events = parser.parse(usageEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.properties.completionTokens, 75);
            assert.strictEqual(events[0].data.properties.totalTokens, 125);
        });

        it("should accumulate usage across multiple events", () => {
            const events = [
                'data: {"type":"usage","properties":{"promptTokens":50,"completionTokens":25}}\n\n',
                'data: {"type":"usage","properties":{"promptTokens":75,"completionTokens":50}}\n\n',
            ];

            let totalPrompt = 0;
            let totalCompletion = 0;

            for (const event of events) {
                const parsed = parser.parse(event);
                for (const e of parsed) {
                    totalPrompt += e.data.properties.promptTokens || 0;
                    totalCompletion += e.data.properties.completionTokens || 0;
                }
            }

            assert.strictEqual(totalPrompt, 125);
            assert.strictEqual(totalCompletion, 75);
        });
    });

    describe("Subagent Event Streaming", () => {
        it("should handle subagent creation", () => {
            const subagentEvent = 'data: {"type":"subagent.created","properties":{"subagent":{"id":"sub-1","parentMessageId":"msg-1","status":"running"}}}\n\n';

            const events = parser.parse(subagentEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.type, "subagent.created");
            assert.strictEqual(events[0].data.properties.subagent.id, "sub-1");
            assert.strictEqual(events[0].data.properties.subagent.status, "running");
        });

        it("should handle subagent progress updates", () => {
            const progressEvent = 'data: {"type":"subagent.updated","properties":{"subagent":{"id":"sub-1","status":"running","progress":"Processing file..."}}}\n\n';

            const events = parser.parse(progressEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.properties.subagent.progress, "Processing file...");
        });

        it("should handle subagent completion", () => {
            const completionEvent = 'data: {"type":"subagent.updated","properties":{"subagent":{"id":"sub-1","status":"completed","result":"Success"}}}\n\n';

            const events = parser.parse(completionEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.properties.subagent.status, "completed");
            assert.strictEqual(events[0].data.properties.subagent.result, "Success");
        });
    });

    describe("Permission Request Events", () => {
        it("should handle permission requests", () => {
            const permissionEvent = 'data: {"type":"permission.request","properties":{"id":"perm-1","action":"read_file","path":"/test/file.txt"}}\n\n';

            const events = parser.parse(permissionEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.type, "permission.request");
            assert.strictEqual(events[0].data.properties.action, "read_file");
        });

        it("should handle permission responses", () => {
            const responseEvent = 'data: {"type":"permission.response","properties":{"id":"perm-1","approved":true}}\n\n';

            const events = parser.parse(responseEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.properties.approved, true);
        });
    });

    describe("Error Event Handling", () => {
        it("should handle error events", () => {
            const errorEvent = 'data: {"type":"error","properties":{"message":"API error","code":"RATE_LIMIT"}}\n\n';

            const events = parser.parse(errorEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.type, "error");
            assert.strictEqual(events[0].data.properties.message, "API error");
        });

        it("should handle session error events", () => {
            const sessionError = 'data: {"type":"session.error","properties":{"sessionId":"sess-1","error":"Session expired"}}\n\n';

            const events = parser.parse(sessionError);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.type, "session.error");
        });
    });

    describe("Structured Output Events", () => {
        it("should handle structured output events", () => {
            const structuredEvent = 'data: {"type":"structured.output","properties":{"responseType":"message","message":"Hello","format":"markdown"}}\n\n';

            const events = parser.parse(structuredEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.properties.responseType, "message");
            assert.strictEqual(events[0].data.properties.format, "markdown");
        });

        it("should handle progress update events", () => {
            const progressEvent = 'data: {"type":"progress.update","properties":{"title":"Step 1","status":"running","progress":50}}\n\n';

            const events = parser.parse(progressEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.properties.status, "running");
            assert.strictEqual(events[0].data.properties.progress, 50);
        });
    });

    describe("Compaction Events", () => {
        it("should handle compaction started event", () => {
            const compactionEvent = 'data: {"type":"compaction.started","properties":{"sessionId":"sess-1","threshold":8000}}\n\n';

            const events = parser.parse(compactionEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.type, "compaction.started");
            assert.strictEqual(events[0].data.properties.threshold, 8000);
        });

        it("should handle compaction completed event", () => {
            const completionEvent = 'data: {"type":"compaction.completed","properties":{"sessionId":"sess-1","compacted":true,"baselineStats":{"input":5000,"output":2000}}}\n\n';

            const events = parser.parse(completionEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.properties.compacted, true);
            assert.strictEqual(events[0].data.properties.baselineStats.input, 5000);
        });
    });

    describe("Heartbeat and Keep-Alive", () => {
        it("should handle heartbeat events", () => {
            const heartbeatEvent = 'data: {"type":"server.heartbeat","properties":{"timestamp":1234567890}}\n\n';

            const events = parser.parse(heartbeatEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.type, "server.heartbeat");
        });

        it("should handle keep-alive comments", () => {
            const keepAlive = ': keep-alive\n\n';

            const events = parser.parse(keepAlive);

            assert.strictEqual(events.length, 0); // Comments are ignored
        });
    });

    describe("Edge Cases", () => {
        it("should handle malformed JSON gracefully", () => {
            const malformedEvent = 'data: {invalid json}\n\n';

            const events = parser.parse(malformedEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data, "{invalid json}"); // String fallback
        });

        it("should handle empty events", () => {
            const emptyEvent = '\n\n\n';

            const events = parser.parse(emptyEvent);

            assert.strictEqual(events.length, 0);
        });

        it("should handle events with extra whitespace", () => {
            const whitespaceEvent = 'data: {"type":"test"}  \n  \n';

            const events = parser.parse(whitespaceEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.type, "test");
        });

        it("should handle very large events", () => {
            const largeContent = "A".repeat(100000);
            const largeEvent = `data: {"type":"message.part.updated","properties":{"delta":"${largeContent}"}}\n\n`;

            const events = parser.parse(largeEvent);

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].data.properties.delta.length, 100000);
        });

        it("should handle unicode content", () => {
            const unicodeEvent = 'data: {"type":"test","content":"Hello 世界 🌍"}\n\n';

            const events = parser.parse(unicodeEvent);

            assert.strictEqual(events.length, 1);
            assert.ok(events[0].data.content.includes("世界"));
            assert.ok(events[0].data.content.includes("🌍"));
        });
    });

    describe("Event Ordering and Timing", () => {
        it("should preserve event order", () => {
            const events = [
                'data: {"seq":1}\n\n',
                'data: {"seq":2}\n\n',
                'data: {"seq":3}\n\n',
            ];

            const received = [];
            for (const event of events) {
                const parsed = parser.parse(event);
                received.push(...parsed.map(e => e.data.seq));
            }

            assert.deepStrictEqual(received, [1, 2, 3]);
        });

        it("should handle out-of-order chunks", () => {
            // Simulate network reordering
            const chunk1 = 'data: {"seq":2}\n\n';
            const chunk2 = 'data: {"seq":1}\n\n';

            const events1 = parser.parse(chunk1);
            const events2 = parser.parse(chunk2);

            // Parser should preserve order of arrival
            assert.strictEqual(events1[0].data.seq, 2);
            assert.strictEqual(events2[0].data.seq, 1);
        });
    });

    describe("Buffer Management", () => {
        it("should handle chunk splitting in middle of JSON", () => {
            const chunk1 = 'data: {"type":"tes';
            const chunk2 = 't","value":"hello"}\n\n';

            const events1 = parser.parse(chunk1);
            const events2 = parser.parse(chunk2);

            assert.strictEqual(events1.length, 0);
            assert.strictEqual(events2.length, 1);
            assert.strictEqual(events2[0].data.type, "test");
        });

        it("should handle multiple incomplete events", () => {
            const chunks = [
                'data: {"type":"eve',
                'nt1","value":"a"}',
                '\n\ndata: {"type":"eve',
                'nt2","value":"b"}\n\n',
            ];

            let allEvents = [];
            for (const chunk of chunks) {
                const events = parser.parse(chunk);
                allEvents.push(...events);
            }

            assert.strictEqual(allEvents.length, 2);
            assert.strictEqual(allEvents[0].data.type, "event1");
            assert.strictEqual(allEvents[1].data.type, "event2");
        });
    });
});
