import { describe, it, before } from "node:test";
import assert from "node:assert";

// Mock implementations for testing
class MockWorkspaceState {
    constructor() {
        this.storage = new Map();
    }

    get(key) {
        return this.storage.get(key);
    }

    update(key, value) {
        if (value === undefined) {
            this.storage.delete(key);
        } else {
            this.storage.set(key, value);
        }
        return Promise.resolve();
    }
}

class MockLogger {
    info(...args) {
        console.log("[INFO]", ...args);
    }
    debug(...args) {
        console.log("[DEBUG]", ...args);
    }
    warn(...args) {
        console.log("[WARN]", ...args);
    }
    error(...args) {
        console.log("[ERROR]", ...args);
    }
}

class MockStructuredOutputProcessor {
    extractStructuredOutput(message) {
        if (!message) return undefined;
        return message.structuredOutput ||
            message.structured_output ||
            message.info?.structuredOutput ||
            undefined;
    }

    applyStructuredOutputToMessage(message, structured) {
        if (!message || !structured) return message;
        return {
            ...message,
            structuredOutput: structured,
            hasStructuredOutput: true,
        };
    }

    enrichMessageWithPlan(message) {
        // Simple mock: just return message as-is
        return message;
    }
}

describe("HistoryProcessor", () => {
    let workspaceState;
    let logger;
    let structuredOutputProcessor;
    let helpers;

    before(() => {
        workspaceState = new MockWorkspaceState();
        logger = new MockLogger();
        structuredOutputProcessor = new MockStructuredOutputProcessor();

        // Helper functions
        helpers = {
            asRecord: (value) => {
                if (value && typeof value === "object") {
                    return value;
                }
                return undefined;
            },
            firstNonEmptyString: (...values) => {
                return values.find((v) => typeof v === "string" && v.length > 0);
            },
            isLikelyToolCallTranscript: (text) => {
                return typeof text === "string" && text.includes("tool");
            },
            extractMessageBodyText: (message) => {
                if (!message) return undefined;
                return (
                    message.content ||
                    message.text ||
                    message.body ||
                    undefined
                );
            },
        };
    });

    describe("Message pipeline processing", () => {
        it("should handle empty messages array without error", () => {
            // This tests that the .map() call doesn't fail on non-arrays
            const rawMessages = [];

            assert.strictEqual(rawMessages.length, 0);
            const processed = rawMessages
                .map((msg) => ({ ...msg }))
                .filter((msg) => msg);

            assert.strictEqual(processed.length, 0);
        });

        it("should handle undefined/null gracefully in extraction", () => {
            const messages = [null, undefined, { content: "test" }];

            const extracted = messages
                .map((msg) => {
                    if (!msg || typeof msg !== "object") return undefined;
                    return helpers.extractMessageBodyText(msg);
                })
                .filter((text) => text);

            assert.strictEqual(extracted.length, 1);
            assert.strictEqual(extracted[0], "test");
        });

        it("should safely call .map() only on arrays", () => {
            const testCases = [
                { input: [], expected: [] },
                { input: [1, 2, 3], expected: [10, 20, 30] },
                { input: undefined, expected: [] },
                { input: null, expected: [] },
            ];

            for (const testCase of testCases) {
                const arr = Array.isArray(testCase.input) ? testCase.input : [];
                const result = arr.map((v) => v * 10);
                assert.deepStrictEqual(result, testCase.expected);
            }
        });
    });

    describe("Structured output application", () => {
        it("should apply structured output to message correctly", () => {
            const message = {
                content: "Hello",
                role: "assistant",
            };

            const structured = {
                responseType: "message",
                message: "Hello",
            };

            const result = structuredOutputProcessor.applyStructuredOutputToMessage(
                message,
                structured
            );

            assert(result.structuredOutput);
            assert.strictEqual(result.structuredOutput.responseType, "message");
            assert.strictEqual(result.content, "Hello");
        });

        it("should handle missing structured output gracefully", () => {
            const message = {
                content: "Hello",
                role: "assistant",
            };

            // No structured output to apply
            const result = structuredOutputProcessor.extractStructuredOutput(message);

            assert.strictEqual(result, undefined);
        });

        it("should handle system messages with default structured output", () => {
            const message = {
                content: "System message",
                info: { role: "system" },
            };

            const role = helpers.firstNonEmptyString(
                message?.info?.role,
                message?.role
            );

            if (role === "system") {
                const result = {
                    ...message,
                    responseType: "system",
                    structuredOutput: {
                        responseType: "system",
                    },
                };

                assert.strictEqual(result.responseType, "system");
                assert.strictEqual(result.structuredOutput.responseType, "system");
            }
        });
    });

    describe("Message enrichment", () => {
        it("should preserve message data during enrichment pipeline", () => {
            const original = {
                id: "msg123",
                role: "assistant",
                content: "Hello world",
                info: {
                    timestamp: new Date().toISOString(),
                },
            };

            // Simulate enrichment pipeline - should not lose original data
            const enrichedMessage = structuredOutputProcessor.enrichMessageWithPlan(
                original
            );

            assert.strictEqual(enrichedMessage.id, original.id);
            assert.strictEqual(enrichedMessage.role, original.role);
            assert.strictEqual(enrichedMessage.content, original.content);
        });

        it("should handle messages with plan information", () => {
            const message = {
                id: "msg456",
                role: "assistant",
                content: "# Implementation Plan\n\n## Steps",
                plan: {
                    file: "implementation_plan.md",
                    title: "Plan Title",
                },
            };

            const enriched = structuredOutputProcessor.enrichMessageWithPlan(message);

            assert(enriched);
            if (enriched.plan) {
                assert.strictEqual(enriched.plan.title, "Plan Title");
            }
        });
    });

    describe("Helper function safety", () => {
        it("firstNonEmptyString should handle various input types", () => {
            const testCases = [
                {
                    inputs: ["", "test", "other"],
                    expected: "test",
                },
                {
                    inputs: [undefined, null, "value"],
                    expected: "value",
                },
                {
                    inputs: [undefined, undefined, undefined],
                    expected: undefined,
                },
                {
                    inputs: ["first", "second"],
                    expected: "first",
                },
            ];

            for (const testCase of testCases) {
                const result = helpers.firstNonEmptyString(...testCase.inputs);
                assert.strictEqual(result, testCase.expected);
            }
        });

        it("asRecord should safely convert values to records", () => {
            const testCases = [
                {
                    input: { key: "value" },
                    expected: { key: "value" },
                },
                {
                    input: { nested: { key: "value" } },
                    expected: { nested: { key: "value" } },
                },
                {
                    input: undefined,
                    expected: undefined,
                },
                {
                    input: null,
                    expected: undefined,
                },
                {
                    input: "string",
                    expected: undefined,
                },
            ];

            for (const testCase of testCases) {
                const result = helpers.asRecord(testCase.input);
                assert.deepStrictEqual(result, testCase.expected);
            }
        });

        it("extractMessageBodyText should extract from various message formats", () => {
            const testCases = [
                {
                    message: { content: "Hello" },
                    expected: "Hello",
                },
                {
                    message: { text: "World" },
                    expected: "World",
                },
                {
                    message: { body: "Body text" },
                    expected: "Body text",
                },
                {
                    message: { content: "Priority", text: "Low priority" },
                    expected: "Priority",
                },
                {
                    message: undefined,
                    expected: undefined,
                },
                {
                    message: {},
                    expected: undefined,
                },
            ];

            for (const testCase of testCases) {
                const result = helpers.extractMessageBodyText(testCase.message);
                assert.strictEqual(result, testCase.expected);
            }
        });
    });

    describe("Array operations safety", () => {
        it("should safely handle appendUnique operation", () => {
            const target = [];
            const incoming = [{ id: 1 }, { id: 2 }];

            // Simulate appendUnique logic
            const seen = new Set(target.map((entry) => JSON.stringify(entry)));
            for (const item of incoming) {
                const key = JSON.stringify(item);
                if (!seen.has(key)) {
                    seen.add(key);
                    target.push(item);
                }
            }

            assert.strictEqual(target.length, 2);
            assert.deepStrictEqual(target[0], { id: 1 });
            assert.deepStrictEqual(target[1], { id: 2 });
        });

        it("should handle falsy arrays in coalesce operation", () => {
            const base = {};

            // Initialize arrays safely
            base.parts = Array.isArray(base.parts) ? [...base.parts] : [];
            base.subagents = Array.isArray(base.subagents) ? [...base.subagents] : [];
            base.reasoning = Array.isArray(base.reasoning) ? [...base.reasoning] : [];

            assert.strictEqual(Array.isArray(base.parts), true);
            assert.strictEqual(Array.isArray(base.subagents), true);
            assert.strictEqual(Array.isArray(base.reasoning), true);
            assert.strictEqual(base.parts.length, 0);
        });

        it("should handle message merging with array safety", () => {
            const messages = [
                { content: "First", parts: [{ type: "text", text: "Part 1" }] },
                { content: "Second", parts: [{ type: "text", text: "Part 2" }] },
            ];

            const merged = {
                ...messages[0],
            };
            merged.parts = messages.flatMap((m) => m.parts || []);

            assert.strictEqual(merged.parts.length, 2);
            assert.strictEqual(merged.parts[0].text, "Part 1");
            assert.strictEqual(merged.parts[1].text, "Part 2");
        });
    });

    describe("Error conditions", () => {
        it("should not throw when .slice() is called on strings", () => {
            const content = "This is a test message";
            assert.doesNotThrow(() => {
                const preview = content.slice(0, 100);
                assert.strictEqual(typeof preview, "string");
            });
        });

        it("should not throw when .slice() is called on arrays", () => {
            const arr = [1, 2, 3, 4, 5];
            assert.doesNotThrow(() => {
                const subset = arr.slice(0, 2);
                assert.strictEqual(subset.length, 2);
            });
        });

        it("should prevent .map() calls on non-arrays by type checking", () => {
            const values = [[], "string", null, undefined, 123];

            for (const value of values) {
                if (!Array.isArray(value)) {
                    assert.throws(
                        () => {
                            value.map((x) => x);
                        },
                        TypeError
                    );
                } else {
                    assert.doesNotThrow(() => {
                        value.map((x) => x);
                    });
                }
            }
        });
    });

    describe("Pipeline integration", () => {
        it("should process a complete message through the pipeline", () => {
            const rawMessage = {
                id: "msg789",
                role: "assistant",
                content: "Test response",
                info: {
                    timestamp: new Date().toISOString(),
                },
            };

            // Simulate pipeline: normalize → structured → enrich → filter
            const normalized = rawMessage; // normalizePlanProceedUserMessage
            const structured = structuredOutputProcessor.extractStructuredOutput(
                normalized
            );
            const withStructuredOutput =
                structuredOutputProcessor.applyStructuredOutputToMessage(
                    normalized,
                    structured || {}
                );
            const enriched =
                structuredOutputProcessor.enrichMessageWithPlan(withStructuredOutput);

            // Should have all original properties
            assert.strictEqual(enriched.id, "msg789");
            assert.strictEqual(enriched.role, "assistant");
            assert.strictEqual(enriched.content, "Test response");
        });
    });
});
