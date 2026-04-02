import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert";

/**
 * CompactionManager Unit Tests
 *
 * Tests the CompactionManager module which handles:
 * - Context compaction lifecycle
 * - Persistence of compaction view state
 * - UI state management for compaction divider
 * - Auto-compaction based on token thresholds
 */

// Mock implementations
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

    async reset() {
        this.storage.clear();
    }
}

class MockLogger {
    constructor() {
        this.infos = [];
        this.warns = [];
        this.errors = [];
    }

    info(message, context) {
        this.infos.push({ message, context });
    }

    warn(message, context) {
        this.warns.push({ message, context });
    }

    error(message, context) {
        this.errors.push({ message, context });
    }

    reset() {
        this.infos = [];
        this.warns = [];
        this.errors = [];
    }
}

class MockServerManager {
    constructor() {
        this.compactSessionResult = null;
        this.shouldThrow = false;
    }

    async compactSession(sessionId) {
        if (this.shouldThrow) {
            throw new Error("Network error");
        }
        return this.compactSessionResult;
    }
}

// Helper functions from the module
const asRecord = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return undefined;
};

const firstNonEmptyString = (...values) => {
    return values.find((v) => typeof v === "string" && v.length > 0);
};

const processHistoryMessages = (messages, sessionId) => {
    if (!Array.isArray(messages)) return [];
    return messages.map((msg) => ({
        ...msg,
        sessionId,
    }));
};

// Import the CompactionManager class
async function createCompactionManager() {
    // Dynamic import to avoid module resolution issues
    const module = await import("../../src/providers/chat/CompactionManager.ts");
    return module.CompactionManager;
}

describe("CompactionManager", () => {
    let workspaceState;
    let logger;
    let serverManager;
    let CompactionManager;
    let compactionManager;
    let postedMessages;

    before(async () => {
        workspaceState = new MockWorkspaceState();
        logger = new MockLogger();
        serverManager = new MockServerManager();
        CompactionManager = await createCompactionManager();
    });

    afterEach(() => {
        workspaceState.reset();
        logger.reset();
        postedMessages = [];
    });

    const createMockPostMessage = () => {
        postedMessages = [];
        return (msg) => {
            postedMessages.push(msg);
        };
    };

    const createInstance = () => {
        const instance = new CompactionManager(
            workspaceState,
            serverManager,
            logger,
            asRecord,
            firstNonEmptyString,
            processHistoryMessages,
        );
        instance.setPostMessage(createMockPostMessage());
        return instance;
    };

    describe("State Normalization", () => {
        it("should normalize valid compaction baseline stats", () => {
            const manager = createInstance();

            const stats = manager.normalizeCompactionBaselineStats({
                input: 1000,
                output: 500,
                read: 100,
                write: 50,
                duration: 1234,
            });

            assert.deepStrictEqual(stats, {
                input: 1000,
                output: 500,
                read: 100,
                write: 50,
                duration: 1234,
            });
        });

        it("should normalize baseline stats with partial fields", () => {
            const manager = createInstance();

            const stats = manager.normalizeCompactionBaselineStats({
                input: 1000,
                output: 500,
            });

            assert.deepStrictEqual(stats, {
                input: 1000,
                output: 500,
                read: 0,
                write: 0,
                duration: 0,
            });
        });

        it("should normalize baseline stats with missing fields", () => {
            const manager = createInstance();

            const stats = manager.normalizeCompactionBaselineStats({});

            assert.deepStrictEqual(stats, {
                input: 0,
                output: 0,
                read: 0,
                write: 0,
                duration: 0,
            });
        });

        it("should reject baseline stats with invalid numbers", () => {
            const manager = createInstance();

            const stats = manager.normalizeCompactionBaselineStats({
                input: -100,
                output: Infinity,
                read: NaN,
                write: 50,
                duration: 1000,
            });

            assert.deepStrictEqual(stats, {
                input: 0,
                output: 0,
                read: 0,
                write: 50,
                duration: 1000,
            });
        });

        it("should normalize complete compaction view state", () => {
            const manager = createInstance();

            const state = manager.normalizeCompactionViewState({
                lastCompactedAt: 1234567890,
                baselineStats: {
                    input: 1000,
                    output: 500,
                    read: 100,
                    write: 50,
                    duration: 1234,
                },
                compactionDividerIndex: 5,
                compactionDividerBeforeMessageId: "msg-before",
                compactionDividerAfterMessageId: "msg-after",
                collapsed: true,
            });

            assert.deepStrictEqual(state, {
                lastCompactedAt: 1234567890,
                baselineStats: {
                    input: 1000,
                    output: 500,
                    read: 100,
                    write: 50,
                    duration: 1234,
                },
                compactionDividerIndex: 5,
                compactionDividerBeforeMessageId: "msg-before",
                compactionDividerAfterMessageId: "msg-after",
                collapsed: true,
            });
        });

        it("should normalize compaction view state with partial fields", () => {
            const manager = createInstance();

            const state = manager.normalizeCompactionViewState({
                lastCompactedAt: 1234567890,
                collapsed: false,
            });

            assert.deepStrictEqual(state, {
                lastCompactedAt: 1234567890,
                collapsed: false,
            });
        });

        it("should return null for invalid compaction view state", () => {
            const manager = createInstance();

            const state1 = manager.normalizeCompactionViewState(null);
            const state2 = manager.normalizeCompactionViewState(undefined);
            const state3 = manager.normalizeCompactionViewState("string");
            const state4 = manager.normalizeCompactionViewState({});

            assert.strictEqual(state1, null);
            assert.strictEqual(state2, null);
            assert.strictEqual(state3, null);
            assert.strictEqual(state4, null);
        });

        it("should reject compaction view state with invalid timestamps", () => {
            const manager = createInstance();

            const state = manager.normalizeCompactionViewState({
                lastCompactedAt: -100,
                compactionDividerIndex: -5,
            });

            assert.strictEqual(state, null);
        });
    });

    describe("Persistence Operations", () => {
        it("should save compaction view state successfully", async () => {
            const manager = createInstance();

            const state = {
                lastCompactedAt: 1234567890,
                collapsed: true,
            };

            await manager.savePersistedCompactionViewState("session-1", state);

            const saved = workspaceState.get("opencode.session.compaction-view.session-1");
            assert.deepStrictEqual(saved, state);
        });

        it("should load persisted compaction view state", async () => {
            const manager = createInstance();

            const state = {
                lastCompactedAt: 1234567890,
                baselineStats: {
                    input: 1000,
                    output: 500,
                    read: 100,
                    write: 50,
                    duration: 1234,
                },
            };

            await workspaceState.update("opencode.session.compaction-view.session-1", state);

            const loaded = await manager.loadPersistedCompactionViewState("session-1");
            assert.deepStrictEqual(loaded, state);
        });

        it("should return null for missing compaction view state", async () => {
            const manager = createInstance();

            const loaded = await manager.loadPersistedCompactionViewState("nonexistent");
            assert.strictEqual(loaded, null);
        });

        it("should clear persisted compaction view state", async () => {
            const manager = createInstance();

            const state = { lastCompactedAt: 1234567890 };
            await workspaceState.update("opencode.session.compaction-view.session-1", state);

            await manager.clearPersistedCompactionViewState("session-1");

            const loaded = workspaceState.get("opencode.session.compaction-view.session-1");
            assert.strictEqual(loaded, undefined);
        });

        it("should handle persistence errors gracefully", async () => {
            const manager = createInstance();

            // Make workspaceState.update throw
            const originalUpdate = workspaceState.update.bind(workspaceState);
            workspaceState.update = () => Promise.reject(new Error("Storage error"));

            const state = { lastCompactedAt: 1234567890 };

            // Should not throw, but error will be logged
            await manager.savePersistedCompactionViewState("session-1", state);

            // Restore original
            workspaceState.update = originalUpdate;
        });
    });

    describe("View State Management", () => {
        it("should post compaction view state to webview", () => {
            const manager = createInstance();

            const state = {
                lastCompactedAt: 1234567890,
                collapsed: true,
                compactionDividerIndex: 5,
            };

            manager.postCompactionViewState("session-1", state);

            assert.strictEqual(postedMessages.length, 1);
            assert.deepStrictEqual(postedMessages[0], {
                type: "compactionViewState",
                sessionId: "session-1",
                ...state,
            });
        });

        it("should send persisted compaction view state", async () => {
            const manager = createInstance();

            const state = {
                lastCompactedAt: 1234567890,
                collapsed: false,
            };

            await workspaceState.update("opencode.session.compaction-view.session-1", state);
            await manager.sendPersistedCompactionViewState("session-1");

            assert.strictEqual(postedMessages.length, 1);
            assert.deepStrictEqual(postedMessages[0], {
                type: "compactionViewState",
                sessionId: "session-1",
                ...state,
            });
        });

        it("should not post message if no persisted state", async () => {
            const manager = createInstance();

            await manager.sendPersistedCompactionViewState("session-1");

            assert.strictEqual(postedMessages.length, 0);
        });

        it("should persist and publish compaction view state", async () => {
            const manager = createInstance();

            const state = {
                lastCompactedAt: 1234567890,
                collapsed: true,
            };

            await manager.persistAndPublishCompactionViewState("session-1", state);

            const saved = workspaceState.get("opencode.session.compaction-view.session-1");
            assert.deepStrictEqual(saved, state);

            assert.strictEqual(postedMessages.length, 1);
            assert.deepStrictEqual(postedMessages[0], {
                type: "compactionViewState",
                sessionId: "session-1",
                ...state,
            });
        });
    });

    describe("Compaction Lifecycle", () => {
        it("should successfully compact session", async () => {
            const manager = createInstance();

            serverManager.compactSessionResult = {
                data: {
                    baselineStats: {
                        input: 5000,
                        output: 2000,
                        read: 300,
                        write: 150,
                        duration: 5000,
                    },
                },
            };

            await manager.handleCompactSession("session-1", {}, {});

            assert.strictEqual(postedMessages.length, 2);
            assert.strictEqual(postedMessages[0].status, "running");
            assert.strictEqual(postedMessages[1].status, "done");
            assert.strictEqual(postedMessages[1].compacted, true);
            assert.deepStrictEqual(postedMessages[1].baselineStats, {
                input: 5000,
                output: 2000,
                read: 300,
                write: 150,
                duration: 5000,
            });

            assert.strictEqual(logger.infos.length, 1);
            assert.strictEqual(logger.infos[0].message, "Session compacted successfully");
        });

        it("should prevent concurrent compaction", async () => {
            const manager = createInstance();

            serverManager.compactSessionResult = {
                data: { baselineStats: {} },
            };

            const promise1 = manager.handleCompactSession("session-1", {}, {});
            const promise2 = manager.handleCompactSession("session-1", {}, {});

            await Promise.all([promise1, promise2]);

            assert.strictEqual(logger.warns.length, 1);
            assert.strictEqual(logger.warns[0].message, "Compaction already in progress");
        });

        it("should handle compaction server error", async () => {
            const manager = createInstance();

            serverManager.shouldThrow = true;

            await manager.handleCompactSession("session-1", {}, {});

            assert.strictEqual(postedMessages.length, 2);
            assert.strictEqual(postedMessages[0].status, "running");
            assert.strictEqual(postedMessages[1].status, "error");
            assert.strictEqual(postedMessages[1].error, "Network error");

            assert.strictEqual(logger.errors.length, 1);
            assert.strictEqual(logger.errors[0].message, "Session compaction failed");
        });

        it("should handle compaction with no data in response", async () => {
            const manager = createInstance();

            serverManager.compactSessionResult = {};

            await manager.handleCompactSession("session-1", {}, {});

            assert.strictEqual(postedMessages.length, 2);
            assert.strictEqual(postedMessages[0].status, "running");
            assert.strictEqual(postedMessages[1].status, "error");

            assert.strictEqual(logger.errors.length, 1);
        });

        it("should auto-compact when threshold exceeded", async () => {
            const manager = createInstance();

            // Mock getSelectedModelContextLimit
            manager.getSelectedModelContextLimit = () => 10000;

            serverManager.compactSessionResult = {
                data: { baselineStats: {} },
            };

            const responseData = {
                usage: {
                    inputTokens: 7000,
                    totalTokens: 8500,
                },
            };

            await manager.maybeAutoCompact("session-1", responseData, {});

            assert.strictEqual(logger.infos.length, 1);
            assert.strictEqual(logger.infos[0].message, "Auto-compaction threshold reached");
        });

        it("should not auto-compact when below threshold", async () => {
            const manager = createInstance();

            manager.getSelectedModelContextLimit = () => 10000;

            serverManager.compactSessionResult = {
                data: { baselineStats: {} },
            };

            const responseData = {
                usage: {
                    inputTokens: 3000,
                    totalTokens: 4000,
                },
            };

            await manager.maybeAutoCompact("session-1", responseData, {});

            assert.strictEqual(postedMessages.length, 0);
        });

        it("should not auto-compact when no context limit", async () => {
            const manager = createInstance();

            manager.getSelectedModelContextLimit = () => undefined;

            serverManager.compactSessionResult = {
                data: { baselineStats: {} },
            };

            const responseData = {
                usage: {
                    inputTokens: 9000,
                    totalTokens: 9500,
                },
            };

            await manager.maybeAutoCompact("session-1", responseData, {});

            assert.strictEqual(postedMessages.length, 0);
        });

        it("should not auto-compact when already compacting", async () => {
            const manager = createInstance();

            manager.getSelectedModelContextLimit = () => 10000;

            serverManager.compactSessionResult = {
                data: { baselineStats: {} },
            };

            const responseData = {
                usage: {
                    inputTokens: 9000,
                    totalTokens: 9500,
                },
            };

            // Start first compaction
            const promise1 = manager.handleCompactSession("session-1", {}, {});

            // Try to auto-compact while already compacting
            await manager.maybeAutoCompact("session-1", responseData, {});

            await promise1;

            // Should not have started another compaction
            assert.strictEqual(logger.infos.filter(i => i.message === "Auto-compaction threshold reached").length, 0);
        });
    });

    describe("Set Compaction View State", () => {
        it("should update collapsed state", async () => {
            const manager = createInstance();

            const initialState = {
                lastCompactedAt: 1234567890,
                collapsed: false,
            };

            await workspaceState.update("opencode.session.compaction-view.session-1", initialState);

            await manager.handleSetCompactionViewState({
                sessionId: "session-1",
                collapsed: true,
            });

            const updated = await manager.loadPersistedCompactionViewState("session-1");
            assert.strictEqual(updated.collapsed, true);
        });

        it("should update compaction divider index", async () => {
            const manager = createInstance();

            const initialState = {
                lastCompactedAt: 1234567890,
                compactionDividerIndex: 5,
            };

            await workspaceState.update("opencode.session.compaction-view.session-1", initialState);

            await manager.handleSetCompactionViewState({
                sessionId: "session-1",
                compactionDividerIndex: 10,
            });

            const updated = await manager.loadPersistedCompactionViewState("session-1");
            assert.strictEqual(updated.compactionDividerIndex, 10);
        });

        it("should reject invalid divider index", async () => {
            const manager = createInstance();

            const initialState = {
                lastCompactedAt: 1234567890,
                compactionDividerIndex: 5,
            };

            await workspaceState.update("opencode.session.compaction-view.session-1", initialState);

            await manager.handleSetCompactionViewState({
                sessionId: "session-1",
                compactionDividerIndex: -5,
            });

            const updated = await manager.loadPersistedCompactionViewState("session-1");
            assert.strictEqual(updated.compactionDividerIndex, 5); // Should remain unchanged
        });

        it("should update divider message IDs", async () => {
            const manager = createInstance();

            const initialState = {
                lastCompactedAt: 1234567890,
            };

            await workspaceState.update("opencode.session.compaction-view.session-1", initialState);

            await manager.handleSetCompactionViewState({
                sessionId: "session-1",
                compactionDividerBeforeMessageId: "msg-before-new",
                compactionDividerAfterMessageId: "msg-after-new",
            });

            const updated = await manager.loadPersistedCompactionViewState("session-1");
            assert.strictEqual(updated.compactionDividerBeforeMessageId, "msg-before-new");
            assert.strictEqual(updated.compactionDividerAfterMessageId, "msg-after-new");
        });
    });

    describe("Stream Event Forwarding", () => {
        it("should forward valid compaction status from stream event", () => {
            const manager = createInstance();

            const event = {
                sessionId: "session-1",
                status: "completed",
                compacted: true,
                baselineStats: {
                    input: 5000,
                    output: 2000,
                    read: 300,
                    write: 150,
                    duration: 5000,
                },
                compactionDividerBeforeMessageId: "msg-before",
                compactionDividerAfterMessageId: "msg-after",
            };

            manager.forwardCompactionStatusFromStreamEvent(event);

            assert.strictEqual(postedMessages.length, 1);
            assert.deepStrictEqual(postedMessages[0], {
                type: "compactionStatus",
                sessionId: "session-1",
                status: "done",
                compacted: true,
                baselineStats: {
                    input: 5000,
                    output: 2000,
                    read: 300,
                    write: 150,
                    duration: 5000,
                },
                compactionDividerBeforeMessageId: "msg-before",
                compactionDividerAfterMessageId: "msg-after",
            });
        });

        it("should ignore invalid stream events", () => {
            const manager = createInstance();

            manager.forwardCompactionStatusFromStreamEvent(null);
            manager.forwardCompactionStatusFromStreamEvent(undefined);
            manager.forwardCompactionStatusFromStreamEvent("string");
            manager.forwardCompactionStatusFromStreamEvent({});
            manager.forwardCompactionStatusFromStreamEvent({ sessionId: "test" });

            assert.strictEqual(postedMessages.length, 0);
        });

        it("should handle compaction status with error", () => {
            const manager = createInstance();

            const event = {
                sessionId: "session-1",
                status: "error",
                error: "Compaction failed",
            };

            manager.forwardCompactionStatusFromStreamEvent(event);

            assert.strictEqual(postedMessages.length, 1);
            assert.deepStrictEqual(postedMessages[0], {
                type: "compactionStatus",
                sessionId: "session-1",
                status: "error",
                error: "Compaction failed",
            });
        });
    });

    describe("Storage Keys", () => {
        it("should generate correct storage key for session", () => {
            const manager = createInstance();

            const key = manager.getCompactionViewStateStorageKey("session-1");

            assert.strictEqual(key, "opencode.session.compaction-view.session-1");
        });

        it("should generate unique keys for different sessions", () => {
            const manager = createInstance();

            const key1 = manager.getCompactionViewStateStorageKey("session-1");
            const key2 = manager.getCompactionViewStateStorageKey("session-2");

            assert.notStrictEqual(key1, key2);
        });
    });

    describe("Post Compaction Status", () => {
        it("should post compaction status with all fields", () => {
            const manager = createInstance();

            const payload = {
                sessionId: "session-1",
                status: "done",
                compacted: true,
                baselineStats: {
                    input: 5000,
                    output: 2000,
                    read: 300,
                    write: 150,
                    duration: 5000,
                },
                compactionDividerBeforeMessageId: "msg-before",
                compactionDividerAfterMessageId: "msg-after",
            };

            manager.postCompactionStatus(payload);

            assert.strictEqual(postedMessages.length, 1);
            assert.deepStrictEqual(postedMessages[0], {
                type: "compactionStatus",
                ...payload,
            });
        });

        it("should post compaction status with minimal fields", () => {
            const manager = createInstance();

            const payload = {
                sessionId: "session-1",
                status: "running",
            };

            manager.postCompactionStatus(payload);

            assert.strictEqual(postedMessages.length, 1);
            assert.deepStrictEqual(postedMessages[0], {
                type: "compactionStatus",
                sessionId: "session-1",
                status: "running",
            });
        });
    });

    describe("Resolve Session Compaction Divider State", () => {
        it("should resolve divider state from messages", async () => {
            const manager = createInstance();

            const state = {
                compactionDividerIndex: 2,
            };

            await workspaceState.update("opencode.session.compaction-view.session-1", state);

            const mockSessionService = {
                getMessages: async () => [
                    { id: "msg-1", content: "First" },
                    { id: "msg-2", content: "Second" },
                    { id: "msg-3", content: "Third" },
                    { id: "msg-4", content: "Fourth" },
                ],
            };

            const result = await manager.resolveSessionCompactionDividerState(
                "session-1",
                mockSessionService,
            );

            assert.deepStrictEqual(result, {
                compactionDividerIndex: 2,
                compactionDividerBeforeMessageId: "msg-3",
                compactionDividerAfterMessageId: "msg-4",
            });
        });

        it("should return empty state for invalid divider index", async () => {
            const manager = createInstance();

            const state = {
                compactionDividerIndex: 100,
            };

            await workspaceState.update("opencode.session.compaction-view.session-1", state);

            const mockSessionService = {
                getMessages: async () => [
                    { id: "msg-1", content: "First" },
                ],
            };

            const result = await manager.resolveSessionCompactionDividerState(
                "session-1",
                mockSessionService,
            );

            assert.deepStrictEqual(result, {});
        });

        it("should return empty state when no state persisted", async () => {
            const manager = createInstance();

            const mockSessionService = {
                getMessages: async () => [],
            };

            const result = await manager.resolveSessionCompactionDividerState(
                "session-1",
                mockSessionService,
            );

            assert.deepStrictEqual(result, {});
        });

        it("should handle session service errors gracefully", async () => {
            const manager = createInstance();

            const state = {
                compactionDividerIndex: 1,
            };

            await workspaceState.update("opencode.session.compaction-view.session-1", state);

            const mockSessionService = {
                getMessages: async () => {
                    throw new Error("Service error");
                },
            };

            const result = await manager.resolveSessionCompactionDividerState(
                "session-1",
                mockSessionService,
            );

            assert.deepStrictEqual(result, {});
        });
    });

    describe("Resolve Compaction Session ID", () => {
        it("should resolve from sessionId field", async () => {
            const manager = createInstance();

            const result = await manager.resolveCompactionSessionId({
                sessionId: "session-1",
            });

            assert.strictEqual(result, "session-1");
        });

        it("should resolve from compactSession field", async () => {
            const manager = createInstance();

            const result = await manager.resolveCompactionSessionId({
                compactSession: "session-2",
            });

            assert.strictEqual(result, "session-2");
        });

        it("should prefer sessionId over compactSession", async () => {
            const manager = createInstance();

            const result = await manager.resolveCompactionSessionId({
                sessionId: "session-1",
                compactSession: "session-2",
            });

            assert.strictEqual(result, "session-1");
        });

        it("should return undefined when no session ID provided", async () => {
            const manager = createInstance();

            const result = await manager.resolveCompactionSessionId({});

            assert.strictEqual(result, undefined);
        });
    });
});
