import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert";

/**
 * SessionHandler Unit Tests
 *
 * Tests the SessionHandler module which handles:
 * - Session CRUD operations (load, delete, rename, list)
 * - Session state management
 * - Processing state tracking
 * - Integration with HistoryProcessor, SubagentPersistence, CompactionManager
 */

// Mock implementations
class MockSessionService {
    constructor() {
        this.sessions = [];
        this.messages = new Map();
        this.currentSessionId = null;
        this.shouldThrow = false;
        this.throwOnOperation = null;
    }

    async listSessions() {
        if (this.shouldThrow && this.throwOnOperation === 'list') {
            throw new Error("List sessions failed");
        }
        return [...this.sessions];
    }

    async switchSession(sessionId) {
        if (this.shouldThrow && this.throwOnOperation === 'switch') {
            throw new Error("Switch session failed");
        }
        this.currentSessionId = sessionId;
    }

    async loadSessionMessages(sessionId) {
        if (this.shouldThrow && this.throwOnOperation === 'load') {
            throw new Error("Load messages failed");
        }
        return this.messages.get(sessionId) || [];
    }

    async deleteSession(sessionId) {
        if (this.shouldThrow && this.throwOnOperation === 'delete') {
            throw new Error("Delete session failed");
        }
        this.sessions = this.sessions.filter(s => s.id !== sessionId);
        this.messages.delete(sessionId);
        if (this.currentSessionId === sessionId) {
            this.currentSessionId = null;
        }
    }

    async renameSession(sessionId, newTitle) {
        if (this.shouldThrow && this.throwOnOperation === 'rename') {
            throw new Error("Rename session failed");
        }
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            session.title = newTitle;
        }
    }

    addSession(session) {
        this.sessions.push(session);
    }

    setMessages(sessionId, messages) {
        this.messages.set(sessionId, messages);
    }

    reset() {
        this.sessions = [];
        this.messages.clear();
        this.currentSessionId = null;
        this.shouldThrow = false;
        this.throwOnOperation = null;
    }
}

class MockHistoryProcessor {
    processHistoryMessages(messages, sessionId) {
        if (!Array.isArray(messages)) return [];
        return messages.map((msg, index) => ({
            ...msg,
            sessionId,
            processed: true,
            index,
        }));
    }
}

class MockSubagentPersistence {
    constructor() {
        this.syncedSessions = [];
        this.clearedSessions = [];
        this.shouldThrow = false;
    }

    async syncSubagentSnapshotForSession(sessionId, messages) {
        if (this.shouldThrow) {
            throw new Error("Sync failed");
        }
        this.syncedSessions.push({ sessionId, messageCount: messages?.length || 0 });
    }

    async clearPersistedSubagentSnapshot(sessionId) {
        if (this.shouldThrow) {
            throw new Error("Clear failed");
        }
        this.clearedSessions.push(sessionId);
    }

    reset() {
        this.syncedSessions = [];
        this.clearedSessions = [];
        this.shouldThrow = false;
    }
}

class MockCompactionManager {
    constructor() {
        this.sentStates = [];
        this.clearedSessions = [];
        this.shouldThrow = false;
    }

    async sendPersistedCompactionViewState(sessionId) {
        if (this.shouldThrow) {
            throw new Error("Compaction state failed");
        }
        this.sentStates.push(sessionId);
    }

    async clearPersistedCompactionViewState(sessionId) {
        if (this.shouldThrow) {
            throw new Error("Clear compaction failed");
        }
        this.clearedSessions.push(sessionId);
    }

    reset() {
        this.sentStates = [];
        this.clearedSessions = [];
        this.shouldThrow = false;
    }
}

class MockModelAndAgentManager {
    constructor() {
        this.appliedSessions = [];
        this.shouldThrow = false;
    }

    async applySessionSettings(sessionId) {
        if (this.shouldThrow) {
            throw new Error("Apply settings failed");
        }
        this.appliedSessions.push(sessionId);
    }

    reset() {
        this.appliedSessions = [];
        this.shouldThrow = false;
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

// Import the SessionHandler class
async function createSessionHandler() {
    const module = await import("../../src/providers/chat/SessionHandler.ts");
    return module.SessionHandler;
}

describe("SessionHandler", () => {
    let sessionService;
    let historyProcessor;
    let subagentPersistence;
    let compactionManager;
    let modelAndAgentManager;
    let logger;
    let SessionHandler;
    let sessionHandler;
    let postedMessages;
    let currentSessionId;
    let setCurrentSessionIdMock;

    before(async () => {
        sessionService = new MockSessionService();
        historyProcessor = new MockHistoryProcessor();
        subagentPersistence = new MockSubagentPersistence();
        compactionManager = new MockCompactionManager();
        modelAndAgentManager = new MockModelAndAgentManager();
        logger = new MockLogger();
        SessionHandler = await createSessionHandler();
    });

    afterEach(() => {
        sessionService.reset();
        subagentPersistence.reset();
        compactionManager.reset();
        modelAndAgentManager.reset();
        logger.reset();
        postedMessages = [];
        currentSessionId = undefined;
    });

    const createMockPostMessage = () => {
        postedMessages = [];
        return (msg) => {
            postedMessages.push(msg);
        };
    };

    const createMockGetCurrentSessionId = () => {
        return () => currentSessionId;
    };

    const createMockSetCurrentSessionId = () => {
        return (id) => {
            currentSessionId = id;
        };
    };

    const createInstance = () => {
        const instance = new SessionHandler(
            sessionService,
            historyProcessor,
            subagentPersistence,
            compactionManager,
            modelAndAgentManager,
            logger,
        );
        instance.setPostMessage(createMockPostMessage());
        instance.setGetCurrentSessionId(createMockGetCurrentSessionId());
        instance.setSetCurrentSessionId(createMockSetCurrentSessionId());
        return instance;
    };

    describe("Session Listing", () => {
        it("should successfully return sessions list", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "First Session",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.addSession({
                id: "session-2",
                title: "Second Session",
                createdAt: 1234567910,
                updatedAt: 1234567920,
            });

            await handler.handleGetSessions();

            assert.strictEqual(postedMessages.length, 1);
            assert.deepStrictEqual(postedMessages[0], {
                type: "sessionsList",
                sessions: [
                    {
                        id: "session-1",
                        title: "First Session",
                        createdAt: 1234567890,
                        updatedAt: 1234567900,
                    },
                    {
                        id: "session-2",
                        title: "Second Session",
                        createdAt: 1234567910,
                        updatedAt: 1234567920,
                    },
                ],
            });
        });

        it("should skip duplicate payloads with same fingerprint", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Session",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });

            await handler.handleGetSessions();
            await handler.handleGetSessions();

            assert.strictEqual(postedMessages.length, 1);
        });

        it("should handle stale requests with version check", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Session",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });

            const promise1 = handler.handleGetSessions();
            const promise2 = handler.handleGetSessions();

            await Promise.all([promise1, promise2]);

            // Should only post once (second request is stale)
            assert.strictEqual(postedMessages.length, 1);
        });

        it("should handle service errors gracefully", async () => {
            const handler = createInstance();

            sessionService.shouldThrow = true;
            sessionService.throwOnOperation = 'list';

            await handler.handleGetSessions();

            assert.strictEqual(postedMessages.length, 0);
            assert.strictEqual(logger.errors.length, 1);
            assert.strictEqual(logger.errors[0].message, "Failed to get sessions");
        });

        it("should handle empty sessions list", async () => {
            const handler = createInstance();

            await handler.handleGetSessions();

            assert.strictEqual(postedMessages.length, 1);
            assert.deepStrictEqual(postedMessages[0], {
                type: "sessionsList",
                sessions: [],
            });
        });
    });

    describe("Session Loading", () => {
        it("should successfully load session and messages", async () => {
            const handler = createInstance();

            const messages = [
                { id: "msg-1", role: "user", content: "Hello" },
                { id: "msg-2", role: "assistant", content: "Hi there" },
            ];

            sessionService.addSession({
                id: "session-1",
                title: "Test Session",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", messages);

            await handler.handleLoadSession({ sessionId: "session-1" });

            assert.strictEqual(currentSessionId, "session-1");
            assert.strictEqual(postedMessages.length, 1);
            assert.strictEqual(postedMessages[0].type, "chatHistory");
            assert.strictEqual(postedMessages[0].sessionId, "session-1");
            assert.strictEqual(postedMessages[0].messages.length, 2);
            assert.strictEqual(postedMessages[0].messages[0].processed, true);
            assert.strictEqual(postedMessages[0].messages[1].processed, true);

            assert.strictEqual(logger.infos.length, 1);
            assert.strictEqual(logger.infos[0].message, "Session loaded");
            assert.strictEqual(logger.infos[0].context.messageCount, 2);
        });

        it("should process messages through HistoryProcessor", async () => {
            const handler = createInstance();

            const messages = [
                { id: "msg-1", role: "user", content: "Hello" },
                { id: "msg-2", role: "assistant", content: "Hi" },
            ];

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", messages);

            await handler.handleLoadSession({ sessionId: "session-1" });

            assert.strictEqual(postedMessages[0].messages[0].sessionId, "session-1");
            assert.strictEqual(postedMessages[0].messages[1].sessionId, "session-1");
        });

        it("should sync subagent snapshots", async () => {
            const handler = createInstance();

            const messages = [
                { id: "msg-1", role: "user", content: "Hello" },
            ];

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", messages);

            await handler.handleLoadSession({ sessionId: "session-1" });

            assert.strictEqual(subagentPersistence.syncedSessions.length, 1);
            assert.strictEqual(subagentPersistence.syncedSessions[0].sessionId, "session-1");
            assert.strictEqual(subagentPersistence.syncedSessions[0].messageCount, 1);
        });

        it("should send compaction view state", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", []);

            await handler.handleLoadSession({ sessionId: "session-1" });

            assert.strictEqual(compactionManager.sentStates.length, 1);
            assert.strictEqual(compactionManager.sentStates[0], "session-1");
        });

        it("should apply session settings", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", []);

            await handler.handleLoadSession({ sessionId: "session-1" });

            assert.strictEqual(modelAndAgentManager.appliedSessions.length, 1);
            assert.strictEqual(modelAndAgentManager.appliedSessions[0], "session-1");
        });

        it("should prevent concurrent loads of same session", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", []);

            const promise1 = handler.handleLoadSession({ sessionId: "session-1" });
            const promise2 = handler.handleLoadSession({ sessionId: "session-1" });

            await Promise.all([promise1, promise2]);

            assert.strictEqual(logger.warns.length, 1);
            assert.strictEqual(logger.warns[0].message, "Session already loading");
        });

        it("should handle missing sessionId", async () => {
            const handler = createInstance();

            await handler.handleLoadSession({ sessionId: "" });
            await handler.handleLoadSession({ sessionId: undefined });
            await handler.handleLoadSession({});

            assert.strictEqual(postedMessages.length, 0);
            assert.strictEqual(logger.infos.length, 0);
        });

        it("should handle empty messages array", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", []);

            await handler.handleLoadSession({ sessionId: "session-1" });

            assert.strictEqual(postedMessages[0].messages.length, 0);
        });

        it("should handle non-array messages", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", null);

            await handler.handleLoadSession({ sessionId: "session-1" });

            assert.strictEqual(postedMessages[0].messages.length, 0);
        });

        it("should handle load errors gracefully", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });

            sessionService.shouldThrow = true;
            sessionService.throwOnOperation = 'load';

            await handler.handleLoadSession({ sessionId: "session-1" });

            assert.strictEqual(logger.errors.length, 1);
            assert.strictEqual(logger.errors[0].message, "Failed to load session");
        });
    });

    describe("Session Deletion", () => {
        it("should successfully delete session", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });

            await handler.handleDeleteSession("session-1");

            const sessions = await sessionService.listSessions();
            assert.strictEqual(sessions.length, 0);

            assert.strictEqual(logger.infos.length, 1);
            assert.strictEqual(logger.infos[0].message, "Session deleted");
        });

        it("should clear subagent snapshots on delete", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });

            await handler.handleDeleteSession("session-1");

            assert.strictEqual(subagentPersistence.clearedSessions.length, 1);
            assert.strictEqual(subagentPersistence.clearedSessions[0], "session-1");
        });

        it("should clear compaction view state on delete", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });

            await handler.handleDeleteSession("session-1");

            assert.strictEqual(compactionManager.clearedSessions.length, 1);
            assert.strictEqual(compactionManager.clearedSessions[0], "session-1");
        });

        it("should unset current session if deleted", async () => {
            const handler = createInstance();

            currentSessionId = "session-1";

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });

            await handler.handleDeleteSession("session-1");

            assert.strictEqual(currentSessionId, undefined);
        });

        it("should not unset current session if different session deleted", async () => {
            const handler = createInstance();

            currentSessionId = "session-2";

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });

            await handler.handleDeleteSession("session-1");

            assert.strictEqual(currentSessionId, "session-2");
        });

        it("should refresh sessions list after delete", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.addSession({
                id: "session-2",
                title: "Test 2",
                createdAt: 1234567910,
                updatedAt: 1234567920,
            });

            await handler.handleDeleteSession("session-1");

            // Should have sessionsList message after delete
            const sessionsListMsg = postedMessages.find(msg => msg.type === "sessionsList");
            assert.ok(sessionsListMsg);
            assert.strictEqual(sessionsListMsg.sessions.length, 1);
            assert.strictEqual(sessionsListMsg.sessions[0].id, "session-2");
        });

        it("should handle missing sessionId", async () => {
            const handler = createInstance();

            await handler.handleDeleteSession("");
            await handler.handleDeleteSession(undefined);
            await handler.handleDeleteSession(null);

            assert.strictEqual(logger.infos.length, 0);
            assert.strictEqual(logger.errors.length, 0);
        });

        it("should handle delete errors gracefully", async () => {
            const handler = createInstance();

            sessionService.shouldThrow = true;
            sessionService.throwOnOperation = 'delete';

            await handler.handleDeleteSession("session-1");

            assert.strictEqual(logger.errors.length, 1);
            assert.strictEqual(logger.errors[0].message, "Failed to delete session");
        });
    });

    describe("Session Renaming", () => {
        it("should successfully rename session", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Old Title",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });

            await handler.handleRenameSession("session-1", "New Title");

            const sessions = await sessionService.listSessions();
            assert.strictEqual(sessions[0].title, "New Title");

            assert.strictEqual(logger.infos.length, 1);
            assert.strictEqual(logger.infos[0].message, "Session renamed");
            assert.strictEqual(logger.infos[0].context.newTitle, "New Title");
        });

        it("should refresh sessions list after rename", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Old Title",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });

            await handler.handleRenameSession("session-1", "New Title");

            const sessionsListMsg = postedMessages.find(msg => msg.type === "sessionsList");
            assert.ok(sessionsListMsg);
            assert.strictEqual(sessionsListMsg.sessions[0].title, "New Title");
        });

        it("should handle missing sessionId", async () => {
            const handler = createInstance();

            await handler.handleRenameSession("", "New Title");
            await handler.handleRenameSession(undefined, "New Title");

            assert.strictEqual(logger.infos.length, 0);
        });

        it("should handle missing newTitle", async () => {
            const handler = createInstance();

            await handler.handleRenameSession("session-1", "");
            await handler.handleRenameSession("session-1", undefined);

            assert.strictEqual(logger.infos.length, 0);
        });

        it("should handle rename errors gracefully", async () => {
            const handler = createInstance();

            sessionService.shouldThrow = true;
            sessionService.throwOnOperation = 'rename';

            await handler.handleRenameSession("session-1", "New Title");

            assert.strictEqual(logger.errors.length, 1);
            assert.strictEqual(logger.errors[0].message, "Failed to rename session");
        });
    });

    describe("Processing State Management", () => {
        it("should send processing sessions update", () => {
            const handler = createInstance();

            handler.sendProcessingSessionsUpdate();

            assert.strictEqual(postedMessages.length, 1);
            assert.deepStrictEqual(postedMessages[0], {
                type: "sessionsListUpdate",
                processingSessionIds: [],
            });
        });

        it("should track processing session during load", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", []);

            // Start loading (but don't await)
            const loadPromise = handler.handleLoadSession({ sessionId: "session-1" });

            // Check processing state during load
            handler.sendProcessingSessionsUpdate();
            assert.deepStrictEqual(postedMessages[postedMessages.length - 1], {
                type: "sessionsListUpdate",
                processingSessionIds: ["session-1"],
            });

            await loadPromise;

            // After load completes
            handler.sendProcessingSessionsUpdate();
            assert.deepStrictEqual(postedMessages[postedMessages.length - 1], {
                type: "sessionsListUpdate",
                processingSessionIds: [],
            });
        });

        it("should handle multiple concurrent session loads", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test 1",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.addSession({
                id: "session-2",
                title: "Test 2",
                createdAt: 1234567910,
                updatedAt: 1234567920,
            });
            sessionService.setMessages("session-1", []);
            sessionService.setMessages("session-2", []);

            const promise1 = handler.handleLoadSession({ sessionId: "session-1" });
            const promise2 = handler.handleLoadSession({ sessionId: "session-2" });

            await Promise.all([promise1, promise2]);

            // Only one should have succeeded (second was rejected as duplicate)
            assert.strictEqual(logger.warns.length, 0); // Different sessions, so no warning
        });
    });

    describe("Error Scenarios", () => {
        it("should handle HistoryProcessor errors", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });

            // Make HistoryProcessor throw
            historyProcessor.processHistoryMessages = () => {
                throw new Error("History processing failed");
            };

            await handler.handleLoadSession({ sessionId: "session-1" });

            // Should handle gracefully and log error
            assert.strictEqual(logger.errors.length, 1);
        });

        it("should handle SubagentPersistence errors", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", []);

            subagentPersistence.shouldThrow = true;

            await handler.handleLoadSession({ sessionId: "session-1" });

            // Should continue despite subagent sync failure
            assert.strictEqual(postedMessages.length, 1);
            assert.strictEqual(postedMessages[0].type, "chatHistory");
        });

        it("should handle CompactionManager errors", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", []);

            compactionManager.shouldThrow = true;

            await handler.handleLoadSession({ sessionId: "session-1" });

            // Should continue despite compaction state failure
            assert.strictEqual(postedMessages.length, 1);
            assert.strictEqual(postedMessages[0].type, "chatHistory");
        });

        it("should handle ModelAndAgentManager errors", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Test",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", []);

            modelAndAgentManager.shouldThrow = true;

            await handler.handleLoadSession({ sessionId: "session-1" });

            // Should continue despite settings apply failure
            assert.strictEqual(postedMessages.length, 1);
            assert.strictEqual(postedMessages[0].type, "chatHistory");
        });
    });

    describe("Integration Tests", () => {
        it("should handle complete session lifecycle", async () => {
            const handler = createInstance();

            // Create session
            sessionService.addSession({
                id: "session-1",
                title: "Test Session",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.setMessages("session-1", [
                { id: "msg-1", role: "user", content: "Hello" },
            ]);

            // Load session
            await handler.handleLoadSession({ sessionId: "session-1" });
            assert.strictEqual(currentSessionId, "session-1");

            // Rename session
            await handler.handleRenameSession("session-1", "Renamed Session");
            const sessions = await sessionService.listSessions();
            assert.strictEqual(sessions[0].title, "Renamed Session");

            // Delete session
            await handler.handleDeleteSession("session-1");
            assert.strictEqual(currentSessionId, undefined);
            assert.strictEqual((await sessionService.listSessions()).length, 0);
        });

        it("should handle switching between sessions", async () => {
            const handler = createInstance();

            sessionService.addSession({
                id: "session-1",
                title: "Session 1",
                createdAt: 1234567890,
                updatedAt: 1234567900,
            });
            sessionService.addSession({
                id: "session-2",
                title: "Session 2",
                createdAt: 1234567910,
                updatedAt: 1234567920,
            });
            sessionService.setMessages("session-1", [
                { id: "msg-1", role: "user", content: "Hello from 1" },
            ]);
            sessionService.setMessages("session-2", [
                { id: "msg-2", role: "user", content: "Hello from 2" },
            ]);

            // Load first session
            await handler.handleLoadSession({ sessionId: "session-1" });
            assert.strictEqual(currentSessionId, "session-1");
            assert.strictEqual(postedMessages[postedMessages.length - 1].messages[0].content, "Hello from 1");

            // Switch to second session
            await handler.handleLoadSession({ sessionId: "session-2" });
            assert.strictEqual(currentSessionId, "session-2");
            assert.strictEqual(postedMessages[postedMessages.length - 1].messages[0].content, "Hello from 2");
        });
    });
});
