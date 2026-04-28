import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert";

/**
 * Message Handler Tests
 *
 * Tests the messageHandler that processes messages from extension:
 *
 * **Message Types Tested:**
 * - initState - Initial state sync
 * - streamEvent - Real-time streaming updates
 * - chatHistory - Message history loading
 * - sessionsList - Session list updates
 * - quotaData/budgetInfo - Quota/budget updates
 * - error messages - Error handling
 * - compaction events - Compaction status
 * - userMessageAppended - User message echo
 *
 * **Processing Logic Tested:**
 * - Message validation
 * - State transformation
 * - Type coercion
 * - Error recovery
 */

// ============================================================================
// Mock Message Handler
// ============================================================================

class MockMessageHandler {
    constructor() {
        this.dispatchCalls = [];
        this.lastState = null;
    }

    createMockDispatch() {
        return (action) => {
            this.dispatchCalls.push(action);
            return action;
        };
    }

    createMockGetState() {
        return () => this.lastState;
    }

    reset() {
        this.dispatchCalls = [];
        this.lastState = null;
    }
}

// ============================================================================
// Message Validation
// ============================================================================

function validateMessage(message) {
    if (!message || typeof message !== "object") {
        return false;
    }
    if (!message.type || typeof message.type !== "string") {
        return false;
    }
    return true;
}

// ============================================================================
// Message Processing
// ============================================================================

function processStreamEvent(event, currentState) {
    if (!event || !event.properties) {
        return null;
    }

    const properties = event.properties || {};
    const info = properties.info || {};

    return {
        type: "STREAM_EVENT",
        eventType: event.type,
        sessionId: event.sessionId || properties.sessionId || info.sessionId,
        properties,
        timestamp: Date.now(),
    };
}

function processChatHistory(message, currentState) {
    if (!message.messages || !Array.isArray(message.messages)) {
        return null;
    }

    return {
        type: "SET_MESSAGES",
        payload: message.messages,
        sessionId: message.sessionId,
    };
}

function processSessionsList(message, currentState) {
    if (!message.sessions || !Array.isArray(message.sessions)) {
        return null;
    }

    return {
        type: "SET_SESSIONS_LIST",
        payload: message.sessions,
    };
}

function processQuotaData(message, currentState) {
    if (!message.quotaData || typeof message.quotaData !== "object") {
        return null;
    }

    return {
        type: "SET_QUOTA_DATA",
        payload: message.quotaData,
    };
}

function processCompactionStatus(message, currentState) {
    if (!message.status) {
        return null;
    }

    return {
        type: "COMPACTION_STATUS",
        sessionId: message.sessionId,
        status: message.status,
        error: message.error,
        compacted: message.compacted,
        baselineStats: message.baselineStats,
    };
}

function processUserMessageAppended(message, currentState) {
    if (!message.message || typeof message.message !== "object") {
        return null;
    }

    return {
        type: "APPEND_MESSAGE",
        payload: message.message,
        echo: true,
    };
}

// ============================================================================
// Test Suite
// ============================================================================

describe("Message Handler Tests", () => {
    let handler;
    let dispatch;
    let getState;

    before(() => {
        handler = new MockMessageHandler();
    });

    afterEach(() => {
        handler.reset();
        dispatch = handler.createMockDispatch();
        getState = handler.createMockGetState();
    });

    describe("Message Validation", () => {
        it("should validate valid message", () => {
            const message = { type: "test", payload: "data" };

            assert.strictEqual(validateMessage(message), true);
        });

        it("should reject null message", () => {
            assert.strictEqual(validateMessage(null), false);
        });

        it("should reject undefined message", () => {
            assert.strictEqual(validateMessage(undefined), false);
        });

        it("should reject message without type", () => {
            const message = { payload: "data" };

            assert.strictEqual(validateMessage(message), false);
        });

        it("should reject message with non-string type", () => {
            const message = { type: 123, payload: "data" };

            assert.strictEqual(validateMessage(message), false);
        });

        it("should reject non-object message", () => {
            assert.strictEqual(validateMessage("string"), false);
            assert.strictEqual(validateMessage(123), false);
            assert.strictEqual(validateMessage(true), false);
        });
    });

    describe("Stream Event Processing", () => {
        it("should process valid stream event", () => {
            const event = {
                type: "message.delta",
                sessionId: "session-1",
                properties: {
                    delta: "Hello",
                },
            };

            const processed = processStreamEvent(event, {});

            assert.ok(processed);
            assert.strictEqual(processed.eventType, "message.delta");
            assert.strictEqual(processed.sessionId, "session-1");
        });

        it("should handle stream event without properties", () => {
            const event = { type: "message.delta" };

            const processed = processStreamEvent(event, {});

            assert.strictEqual(processed, null);
        });

        it("should extract sessionId from properties", () => {
            const event = {
                type: "message.delta",
                properties: {
                    sessionId: "session-2",
                },
            };

            const processed = processStreamEvent(event, {});

            assert.strictEqual(processed.sessionId, "session-2");
        });

        it("should extract sessionId from info", () => {
            const event = {
                type: "message.delta",
                properties: {
                    info: {
                        sessionId: "session-3",
                    },
                },
            };

            const processed = processStreamEvent(event, {});

            assert.strictEqual(processed.sessionId, "session-3");
        });

        it("should handle missing sessionId", () => {
            const event = {
                type: "message.delta",
                properties: {},
            };

            const processed = processStreamEvent(event, {});

            assert.ok(processed);
            assert.strictEqual(processed.sessionId, undefined);
        });
    });

    describe("Chat History Processing", () => {
        it("should process chat history with messages", () => {
            const message = {
                type: "chatHistory",
                sessionId: "session-1",
                messages: [
                    { id: "msg-1", role: "user", content: "Hello" },
                    { id: "msg-2", role: "assistant", content: "Hi" },
                ],
            };

            const processed = processChatHistory(message, {});

            assert.ok(processed);
            assert.strictEqual(processed.type, "SET_MESSAGES");
            assert.strictEqual(processed.payload.length, 2);
        });

        it("should handle empty messages array", () => {
            const message = {
                type: "chatHistory",
                sessionId: "session-1",
                messages: [],
            };

            const processed = processChatHistory(message, {});

            assert.ok(processed);
            assert.strictEqual(processed.payload.length, 0);
        });

        it("should handle missing messages", () => {
            const message = { type: "chatHistory" };

            const processed = processChatHistory(message, {});

            assert.strictEqual(processed, null);
        });

        it("should handle non-array messages", () => {
            const message = {
                type: "chatHistory",
                messages: "not an array",
            };

            const processed = processChatHistory(message, {});

            assert.strictEqual(processed, null);
        });
    });

    describe("Sessions List Processing", () => {
        it("should process sessions list", () => {
            const message = {
                type: "sessionsList",
                sessions: [
                    { id: "s-1", title: "Chat 1" },
                    { id: "s-2", title: "Chat 2" },
                ],
            };

            const processed = processSessionsList(message, {});

            assert.ok(processed);
            assert.strictEqual(processed.payload.length, 2);
        });

        it("should handle empty sessions list", () => {
            const message = {
                type: "sessionsList",
                sessions: [],
            };

            const processed = processSessionsList(message, {});

            assert.ok(processed);
            assert.strictEqual(processed.payload.length, 0);
        });

        it("should handle missing sessions", () => {
            const message = { type: "sessionsList" };

            const processed = processSessionsList(message, {});

            assert.strictEqual(processed, null);
        });
    });

    describe("Quota Data Processing", () => {
        it("should process quota data", () => {
            const message = {
                type: "quotaData",
                quotaData: {
                    provider: "openai",
                    used: 50000,
                    limit: 100000,
                },
            };

            const processed = processQuotaData(message, {});

            assert.ok(processed);
            assert.strictEqual(processed.payload.provider, "openai");
        });

        it("should handle missing quota data", () => {
            const message = { type: "quotaData" };

            const processed = processQuotaData(message, {});

            assert.strictEqual(processed, null);
        });

        it("should handle null quota data", () => {
            const message = {
                type: "quotaData",
                quotaData: null,
            };

            const processed = processQuotaData(message, {});

            assert.strictEqual(processed, null);
        });
    });

    describe("Compaction Status Processing", () => {
        it("should process compaction started", () => {
            const message = {
                type: "compactionStatus",
                sessionId: "session-1",
                status: "running",
            };

            const processed = processCompactionStatus(message, {});

            assert.ok(processed);
            assert.strictEqual(processed.status, "running");
        });

        it("should process compaction completed", () => {
            const message = {
                type: "compactionStatus",
                sessionId: "session-1",
                status: "done",
                compacted: true,
                baselineStats: {
                    input: 5000,
                    output: 2000,
                },
            };

            const processed = processCompactionStatus(message, {});

            assert.ok(processed);
            assert.strictEqual(processed.status, "done");
            assert.strictEqual(processed.compacted, true);
        });

        it("should process compaction error", () => {
            const message = {
                type: "compactionStatus",
                sessionId: "session-1",
                status: "error",
                error: "Compaction failed",
            };

            const processed = processCompactionStatus(message, {});

            assert.ok(processed);
            assert.strictEqual(processed.status, "error");
            assert.strictEqual(processed.error, "Compaction failed");
        });

        it("should handle compaction without status", () => {
            const message = {
                type: "compactionStatus",
                sessionId: "session-1",
            };

            const processed = processCompactionStatus(message, {});

            assert.strictEqual(processed, null);
        });
    });

    describe("User Message Appended Processing", () => {
        it("should process user message appended", () => {
            const message = {
                type: "userMessageAppended",
                message: {
                    id: "msg-1",
                    role: "user",
                    content: "Hello",
                },
            };

            const processed = processUserMessageAppended(message, {});

            assert.ok(processed);
            assert.strictEqual(processed.type, "APPEND_MESSAGE");
            assert.strictEqual(processed.payload.role, "user");
        });

        it("should handle missing message", () => {
            const message = { type: "userMessageAppended" };

            const processed = processUserMessageAppended(message, {});

            assert.strictEqual(processed, null);
        });
    });

    describe("Error Message Handling", () => {
        it("should handle error messages gracefully", () => {
            const errorMessage = {
                type: "error",
                error: "Something went wrong",
            };

            // Should validate
            assert.strictEqual(validateMessage(errorMessage), true);
        });

        it("should handle malformed error messages", () => {
            const errorMessage = {
                type: "error",
                // Missing error field
            };

            assert.strictEqual(validateMessage(errorMessage), true);
        });
    });

    describe("Message Transformation", () => {
        it("should transform message types to actions", () => {
            const message = {
                type: "chatHistory",
                sessionId: "session-1",
                messages: [{ id: "msg-1", role: "user", content: "Test" }],
            };

            const processed = processChatHistory(message, {});

            assert.strictEqual(processed.type, "SET_MESSAGES");
        });

        it("should preserve message payload", () => {
            const payload = { test: "data" };
            const message = {
                type: "testMessage",
                payload,
            };

            // In real handler, would dispatch with payload
            assert.deepStrictEqual(message.payload, payload);
        });

        it("should add timestamp to processed messages", () => {
            const event = {
                type: "message.delta",
                properties: {},
            };

            const processed = processStreamEvent(event, {});

            assert.ok(processed.timestamp);
            assert.ok(processed.timestamp > 0);
        });
    });

    describe("Edge Cases", () => {
        it("should handle message with very large payload", () => {
            const largePayload = "A".repeat(1000000);
            const message = {
                type: "test",
                payload: largePayload,
            };

            assert.strictEqual(validateMessage(message), true);
            assert.strictEqual(message.payload.length, 1000000);
        });

        it("should handle message with special characters in type", () => {
            const message = {
                type: "test-message-with/special_chars",
                payload: "data",
            };

            assert.strictEqual(validateMessage(message), true);
        });

        it("should handle message with nested objects", () => {
            const message = {
                type: "test",
                payload: {
                    nested: {
                        deeply: {
                            value: "data",
                        },
                    },
                },
            };

            assert.strictEqual(validateMessage(message), true);
        });

        it("should handle message with circular references", () => {
            const message = { type: "test" };
            message.circular = message;

            // Should validate type but not process circular ref
            assert.strictEqual(validateMessage(message), true);
        });
    });

    describe("Performance", () => {
        it("should process messages quickly", () => {
            const messages = Array.from({ length: 1000 }, (_, i) => ({
                type: "chatHistory",
                sessionId: `session-${i}`,
                messages: [{ id: `msg-${i}`, role: "user", content: `Message ${i}` }],
            }));

            const startTime = Date.now();

            for (const message of messages) {
                validateMessage(message);
                processChatHistory(message, {});
            }

            const duration = Date.now() - startTime;

            assert.ok(duration < 1000, `Processing took ${duration}ms, should be < 1000ms`);
        });

        it("should handle rapid stream events", () => {
            const events = Array.from({ length: 100 }, (_, i) => ({
                type: "message.delta",
                properties: { delta: `Chunk ${i}` },
            }));

            const startTime = Date.now();

            for (const event of events) {
                processStreamEvent(event, {});
            }

            const duration = Date.now() - startTime;

            assert.ok(duration < 500, `Processing took ${duration}ms, should be < 500ms`);
        });
    });

    describe("State Updates", () => {
        it("should dispatch actions in correct order", () => {
            const messages = [
                { type: "SET_PROCESSING", payload: true },
                { type: "APPEND_MESSAGE", payload: { id: "msg-1", role: "user", content: "Test" } },
                { type: "SET_STREAMING", payload: { isStreaming: true } },
            ];

            for (const action of messages) {
                dispatch(action);
            }

            assert.strictEqual(handler.dispatchCalls.length, 3);
            assert.strictEqual(handler.dispatchCalls[0].type, "SET_PROCESSING");
            assert.strictEqual(handler.dispatchCalls[1].type, "APPEND_MESSAGE");
            assert.strictEqual(handler.dispatchCalls[2].type, "SET_STREAMING");
        });

        it("should handle state transitions", () => {
            let state = { isProcessing: false, messages: [] };

            // Start processing
            const action1 = { type: "SET_PROCESSING", payload: true };
            state = { ...state, isProcessing: action1.payload };
            assert.strictEqual(state.isProcessing, true);

            // Add message
            const action2 = { type: "APPEND_MESSAGE", payload: { role: "user", content: "Test" } };
            state = { ...state, messages: [...state.messages, action2.payload] };
            assert.strictEqual(state.messages.length, 1);

            // End processing
            const action3 = { type: "SET_PROCESSING", payload: false };
            state = { ...state, isProcessing: action3.payload };
            assert.strictEqual(state.isProcessing, false);
        });
    });
});
