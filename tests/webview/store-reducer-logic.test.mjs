import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert";

/**
 * Store/Reducer Logic Tests
 *
 * Tests the React store reducer logic for state management:
 *
 * **State Management Tested:**
 * - Message state (SET_MESSAGES, APPEND_MESSAGE)
 * - Processing state (SET_PROCESSING, SET_STEERING)
 * - Session state (SET_SESSION, SWITCH_SESSION)
 * - Streaming state (SET_STREAMING, UPDATE_STREAMING)
 * - Queue management (ADD_TO_QUEUE, REMOVE_FROM_QUEUE)
 * - UI state (SET_INPUT_VALUE, SET_SELECTED_FILES, etc.)
 *
 * **Reducer Actions Tested:**
 * - State transitions
 * - Immutability
 * - Edge cases
 * - Complex state updates
 */

// ============================================================================
// Initial State
// ============================================================================

function createInitialState() {
    return {
        // Session state
        currentSessionId: null,
        sessionsList: [],
        processingSessionIds: [],
        switchingSessionId: null,

        // Messages
        messages: [],
        inputValue: "",

        // Processing flags
        isProcessing: false,
        isSteering: false,
        isExecutingQueue: false,
        executingQueueSessionIds: new Set(),

        // Queue
        promptQueue: [],
        queueBySessionId: {},
        isQueueOpen: false,

        // UI state
        isSidebarOpen: false,
        isSessionModalOpen: false,

        // Attachments
        selectedFiles: [],
        selectedContexts: [],
        attachments: [],

        // Models & Agents
        availableModels: [],
        selectedModel: null,
        availableAgents: [],
        selectedAgent: "",

        // Streaming
        streaming: null,

        // Statistics
        sessionStats: {
            input: 0,
            output: 0,
            read: 0,
            write: 0,
            duration: 0,
        },

        // Budget
        budgetInfo: null,

        // Quota
        quotaData: null,

        // Server status
        serverStatus: "connecting",
        receivedInitState: false,

        // Subagents
        subagentsByParentMessageId: {},
        subagentsDetailsById: {},
        selectedSubagentId: null,

        // Todos
        todoItems: [],

        // Commands
        availableCommands: [],
        commandsLoaded: false,
    };
}

// ============================================================================
// Reducer Implementation (Simplified)
// ============================================================================

function reducer(state, action) {
    switch (action.type) {
        case "SET_MESSAGES":
            return { ...state, messages: action.payload };

        case "APPEND_MESSAGE":
            return {
                ...state,
                messages: [...state.messages, action.payload],
            };

        case "SET_PROCESSING":
            return { ...state, isProcessing: action.payload };

        case "SET_STEERING":
            return { ...state, isSteering: action.payload };

        case "SET_SESSION":
            return { ...state, currentSessionId: action.payload };

        case "SET_STREAMING":
            return { ...state, streaming: action.payload };

        case "UPDATE_STREAMING":
            return {
                ...state,
                streaming: {
                    ...state.streaming,
                    ...action.payload,
                },
            };

        case "SET_INPUT_VALUE":
            return { ...state, inputValue: action.payload };

        case "CLEAR_INPUT":
            return { ...state, inputValue: "" };

        case "SET_SELECTED_FILES":
            return { ...state, selectedFiles: action.payload };

        case "SET_SELECTED_CONTEXTS":
            return { ...state, selectedContexts: action.payload };

        case "ADD_ATTACHMENT":
            return {
                ...state,
                attachments: [...state.attachments, action.payload],
            };

        case "CLEAR_ATTACHMENTS":
            return { ...state, attachments: [] };

        case "ADD_TO_QUEUE":
            return {
                ...state,
                promptQueue: [...state.promptQueue, action.payload],
            };

        case "ADD_TO_LOCAL_QUEUE": {
            const item = action.payload;
            const sessionId = item.sessionId || state.currentSessionId;
            if (!sessionId) return state;
            const alreadyExists = state.promptQueue.some(q => q.id === item.id);
            if (alreadyExists) return state;
            const nextBySession = { ...state.queueBySessionId };
            nextBySession[sessionId] = [...(nextBySession[sessionId] || []), item];
            const updatedQueue = sessionId === state.currentSessionId
                ? [...state.promptQueue, item]
                : state.promptQueue;
            return {
                ...state,
                queueBySessionId: nextBySession,
                promptQueue: updatedQueue,
                isQueueOpen: true,
            };
        }

        case "SET_QUEUE": {
            const targetSessionId = action.payload.sessionId;
            if (!targetSessionId) return state;
            const sessionQueue = action.payload.queue.filter(
                (item) => !targetSessionId || item.sessionId === targetSessionId
            );
            const nextBySession = { ...state.queueBySessionId };
            if (sessionQueue.length > 0) {
                nextBySession[targetSessionId] = sessionQueue;
            } else {
                delete nextBySession[targetSessionId];
            }
            return {
                ...state,
                queueBySessionId: nextBySession,
                promptQueue: targetSessionId === state.currentSessionId
                    ? sessionQueue
                    : state.promptQueue,
            };
        }

        case "SET_QUEUE_OPEN":
            return { ...state, isQueueOpen: action.payload };

        case "SET_EXECUTING_QUEUE": {
            const next = new Set(state.executingQueueSessionIds);
            if (action.payload.executing) {
                next.add(action.payload.sessionId);
            } else {
                next.delete(action.payload.sessionId);
            }
            return { ...state, executingQueueSessionIds: next };
        }

        case "REMOVE_FROM_QUEUE":
            return {
                ...state,
                promptQueue: state.promptQueue.filter(item => item.id !== action.payload.id),
            };

        case "CLEAR_QUEUE":
            return { ...state, promptQueue: [] };

        case "SET_SESSIONS_LIST":
            return { ...state, sessionsList: action.payload };

        case "SET_BUDGET_INFO":
            return { ...state, budgetInfo: action.payload };

        case "SET_QUOTA_DATA":
            return { ...state, quotaData: action.payload };

        case "SET_SERVER_STATUS":
            return { ...state, serverStatus: action.payload };

        case "SET_AVAILABLE_MODELS":
            return { ...state, availableModels: action.payload };

        case "SET_SELECTED_MODEL":
            return { ...state, selectedModel: action.payload };

        case "SET_AVAILABLE_AGENTS":
            return { ...state, availableAgents: action.payload };

        case "SET_SELECTED_AGENT":
            return { ...state, selectedAgent: action.payload };

        case "UPSERT_SUBAGENT_SUMMARIES":
            return {
                ...state,
                subagentsByParentMessageId: {
                    ...state.subagentsByParentMessageId,
                    ...action.payload,
                },
            };

        case "UPSERT_SUBAGENT_DETAIL":
            return {
                ...state,
                subagentsDetailsById: {
                    ...state.subagentsDetailsById,
                    ...action.payload,
                },
            };

        case "ADD_TODO_ITEM":
            return {
                ...state,
                todoItems: [...state.todoItems, action.payload],
            };

        case "UPDATE_TODO_ITEM":
            return {
                ...state,
                todoItems: state.todoItems.map(item =>
                    item.id === action.payload.id
                        ? { ...item, ...action.payload.updates }
                        : item
                ),
            };

        case "REMOVE_TODO_ITEM":
            return {
                ...state,
                todoItems: state.todoItems.filter(item => item.id !== action.payload.id),
            };

        case "SET_AVAILABLE_COMMANDS":
            return { ...state, availableCommands: action.payload };

        case "SET_SESSION_STATS":
            return {
                ...state,
                sessionStats: {
                    ...state.sessionStats,
                    ...action.payload,
                },
            };

        default:
            return state;
    }
}

// ============================================================================
// Test Suite
// ============================================================================

describe("Store/Reducer Logic Tests", () => {
    let initialState;

    before(() => {
        initialState = createInitialState();
    });

    afterEach(() => {
        initialState = createInitialState();
    });

    describe("Message State Management", () => {
        it("should set messages", () => {
            const messages = [
                { id: "msg-1", role: "user", content: "Hello" },
                { id: "msg-2", role: "assistant", content: "Hi there" },
            ];

            const newState = reducer(initialState, {
                type: "SET_MESSAGES",
                payload: messages,
            });

            assert.strictEqual(newState.messages.length, 2);
            assert.strictEqual(newState.messages[0].content, "Hello");
            assert.notStrictEqual(newState.messages, initialState.messages);
        });

        it("should append message", () => {
            const newMessage = { id: "msg-2", role: "user", content: "New" };

            const stateWithMessages = {
                ...initialState,
                messages: [{ id: "msg-1", role: "assistant", content: "Existing" }],
            };

            const newState = reducer(stateWithMessages, {
                type: "APPEND_MESSAGE",
                payload: newMessage,
            });

            assert.strictEqual(newState.messages.length, 2);
            assert.strictEqual(newState.messages[1].id, "msg-2");
            assert.strictEqual(newState.messages[1].content, "New");
        });

        it("should not mutate original state when setting messages", () => {
            const messages = [{ id: "msg-1", role: "user", content: "Test" }];
            const originalMessages = initialState.messages;

            reducer(initialState, { type: "SET_MESSAGES", payload: messages });

            assert.strictEqual(initialState.messages.length, 0);
            assert.strictEqual(originalMessages.length, 0);
        });
    });

    describe("Processing State Management", () => {
        it("should set processing state", () => {
            const newState = reducer(initialState, {
                type: "SET_PROCESSING",
                payload: true,
            });

            assert.strictEqual(newState.isProcessing, true);
            assert.strictEqual(initialState.isProcessing, false);
        });

        it("should set steering state", () => {
            const newState = reducer(initialState, {
                type: "SET_STEERING",
                payload: true,
            });

            assert.strictEqual(newState.isSteering, true);
        });

        it("should handle concurrent processing and steering", () => {
            let state = initialState;

            state = reducer(state, { type: "SET_PROCESSING", payload: true });
            state = reducer(state, { type: "SET_STEERING", payload: true });

            assert.strictEqual(state.isProcessing, true);
            assert.strictEqual(state.isSteering, true);
        });
    });

    describe("Session State Management", () => {
        it("should set current session", () => {
            const sessionId = "session-123";

            const newState = reducer(initialState, {
                type: "SET_SESSION",
                payload: sessionId,
            });

            assert.strictEqual(newState.currentSessionId, sessionId);
        });

        it("should update sessions list", () => {
            const sessions = [
                { id: "session-1", title: "Chat 1" },
                { id: "session-2", title: "Chat 2" },
            ];

            const newState = reducer(initialState, {
                type: "SET_SESSIONS_LIST",
                payload: sessions,
            });

            assert.strictEqual(newState.sessionsList.length, 2);
            assert.strictEqual(newState.sessionsList[0].title, "Chat 1");
        });

        it("should switch sessions", () => {
            let state = initialState;

            state = reducer(state, { type: "SET_SESSION", payload: "session-1" });
            assert.strictEqual(state.currentSessionId, "session-1");

            state = reducer(state, { type: "SET_SESSION", payload: "session-2" });
            assert.strictEqual(state.currentSessionId, "session-2");
        });
    });

    describe("Streaming State Management", () => {
        it("should set streaming state", () => {
            const streaming = {
                sessionId: "session-1",
                messageId: "msg-1",
                isStreaming: true,
                steps: [{ type: "text", text: "Hello" }],
            };

            const newState = reducer(initialState, {
                type: "SET_STREAMING",
                payload: streaming,
            });

            assert.ok(newState.streaming);
            assert.strictEqual(newState.streaming.isStreaming, true);
            assert.strictEqual(newState.streaming.steps.length, 1);
        });

        it("should update streaming state", () => {
            const existingStreaming = {
                sessionId: "session-1",
                messageId: "msg-1",
                isStreaming: true,
                steps: [{ type: "text", text: "Hello" }],
            };

            const stateWithStreaming = {
                ...initialState,
                streaming: existingStreaming,
            };

            const newState = reducer(stateWithStreaming, {
                type: "UPDATE_STREAMING",
                payload: { isStreaming: false },
            });

            assert.strictEqual(newState.streaming.isStreaming, false);
            assert.strictEqual(newState.streaming.sessionId, "session-1"); // Preserved
        });

        it("should clear streaming state", () => {
            const stateWithStreaming = {
                ...initialState,
                streaming: { isStreaming: true },
            };

            const newState = reducer(stateWithStreaming, {
                type: "SET_STREAMING",
                payload: null,
            });

            assert.strictEqual(newState.streaming, null);
        });
    });

    describe("Queue Management", () => {
        it("should add item to queue", () => {
            const queueItem = {
                id: "queue-1",
                text: "Queued message",
                sessionId: "session-1",
                createdAt: Date.now(),
            };

            const newState = reducer(initialState, {
                type: "ADD_TO_QUEUE",
                payload: queueItem,
            });

            assert.strictEqual(newState.promptQueue.length, 1);
            assert.strictEqual(newState.promptQueue[0].id, "queue-1");
        });

        it("should remove item from queue", () => {
            const item1 = { id: "queue-1", text: "Msg 1", sessionId: "session-1", createdAt: Date.now() };
            const item2 = { id: "queue-2", text: "Msg 2", sessionId: "session-1", createdAt: Date.now() };

            const stateWithQueue = {
                ...initialState,
                promptQueue: [item1, item2],
            };

            const newState = reducer(stateWithQueue, {
                type: "REMOVE_FROM_QUEUE",
                payload: { id: "queue-1" },
            });

            assert.strictEqual(newState.promptQueue.length, 1);
            assert.strictEqual(newState.promptQueue[0].id, "queue-2");
        });

        it("should clear queue", () => {
            const stateWithQueue = {
                ...initialState,
                promptQueue: [
                    { id: "queue-1", text: "Msg", sessionId: "session-1", createdAt: Date.now() },
                ],
            };

            const newState = reducer(stateWithQueue, { type: "CLEAR_QUEUE" });

            assert.strictEqual(newState.promptQueue.length, 0);
        });
    });

    describe("Input Management", () => {
        it("should set input value", () => {
            const newState = reducer(initialState, {
                type: "SET_INPUT_VALUE",
                payload: "Hello, AI!",
            });

            assert.strictEqual(newState.inputValue, "Hello, AI!");
        });

        it("should clear input", () => {
            const stateWithValue = {
                ...initialState,
                inputValue: "Some text",
            };

            const newState = reducer(stateWithValue, { type: "CLEAR_INPUT" });

            assert.strictEqual(newState.inputValue, "");
        });

        it("should update input value", () => {
            let state = initialState;

            state = reducer(state, { type: "SET_INPUT_VALUE", payload: "First" });
            state = reducer(state, { type: "SET_INPUT_VALUE", payload: "Second" });

            assert.strictEqual(state.inputValue, "Second");
        });
    });

    describe("Attachment Management", () => {
        it("should set selected files", () => {
            const files = ["/test/file1.ts", "/test/file2.ts"];

            const newState = reducer(initialState, {
                type: "SET_SELECTED_FILES",
                payload: files,
            });

            assert.strictEqual(newState.selectedFiles.length, 2);
            assert.strictEqual(newState.selectedFiles[0], "/test/file1.ts");
        });

        it("should set selected contexts", () => {
            const contexts = [
                { file: "test.ts", lineInfo: "10:15", content: "code" },
            ];

            const newState = reducer(initialState, {
                type: "SET_SELECTED_CONTEXTS",
                payload: contexts,
            });

            assert.strictEqual(newState.selectedContexts.length, 1);
        });

        it("should add attachment", () => {
            const attachment = {
                id: "att-1",
                dataUrl: "data:image/png;base64,...",
                filename: "screenshot.png",
            };

            const newState = reducer(initialState, {
                type: "ADD_ATTACHMENT",
                payload: attachment,
            });

            assert.strictEqual(newState.attachments.length, 1);
            assert.strictEqual(newState.attachments[0].id, "att-1");
        });

        it("should clear attachments", () => {
            const stateWithAttachments = {
                ...initialState,
                attachments: [
                    { id: "att-1", dataUrl: "...", filename: "img1.png" },
                    { id: "att-2", dataUrl: "...", filename: "img2.png" },
                ],
            };

            const newState = reducer(stateWithAttachments, { type: "CLEAR_ATTACHMENTS" });

            assert.strictEqual(newState.attachments.length, 0);
        });
    });

    describe("Model and Agent Management", () => {
        it("should set available models", () => {
            const models = [
                { providerID: "openai", modelID: "gpt-4", name: "GPT-4" },
                { providerID: "anthropic", modelID: "claude-3", name: "Claude 3" },
            ];

            const newState = reducer(initialState, {
                type: "SET_AVAILABLE_MODELS",
                payload: models,
            });

            assert.strictEqual(newState.availableModels.length, 2);
            assert.strictEqual(newState.availableModels[0].name, "GPT-4");
        });

        it("should set selected model", () => {
            const model = { providerID: "openai", modelID: "gpt-4", name: "GPT-4" };

            const newState = reducer(initialState, {
                type: "SET_SELECTED_MODEL",
                payload: model,
            });

            assert.deepStrictEqual(newState.selectedModel, model);
        });

        it("should set available agents", () => {
            const agents = [
                { id: "build", name: "Build Agent", color: "#FF5733" },
                { id: "plan", name: "Plan Agent", color: "#33FF57" },
            ];

            const newState = reducer(initialState, {
                type: "SET_AVAILABLE_AGENTS",
                payload: agents,
            });

            assert.strictEqual(newState.availableAgents.length, 2);
        });

        it("should set selected agent", () => {
            const newState = reducer(initialState, {
                type: "SET_SELECTED_AGENT",
                payload: "build",
            });

            assert.strictEqual(newState.selectedAgent, "build");
        });
    });

    describe("Budget and Quota Management", () => {
        it("should set budget info", () => {
            const budgetInfo = {
                dailyBudget: 100,
                usedToday: 25,
                remaining: 75,
            };

            const newState = reducer(initialState, {
                type: "SET_BUDGET_INFO",
                payload: budgetInfo,
            });

            assert.deepStrictEqual(newState.budgetInfo, budgetInfo);
            assert.strictEqual(newState.budgetInfo.remaining, 75);
        });

        it("should set quota data", () => {
            const quotaData = {
                provider: "openai",
                used: 50000,
                limit: 100000,
            };

            const newState = reducer(initialState, {
                type: "SET_QUOTA_DATA",
                payload: quotaData,
            });

            assert.deepStrictEqual(newState.quotaData, quotaData);
        });
    });

    describe("Subagent Management", () => {
        it("should upsert subagent summaries", () => {
            const summaries = {
                "msg-1": [
                    { id: "sub-1", title: "Task 1", status: "running" },
                ],
            };

            const newState = reducer(initialState, {
                type: "UPSERT_SUBAGENT_SUMMARIES",
                payload: summaries,
            });

            assert.deepStrictEqual(newState.subagentsByParentMessageId, summaries);
        });

        it("should upsert subagent details", () => {
            const details = {
                "sub-1": {
                    id: "sub-1",
                    title: "Task 1",
                    timeline: [],
                },
            };

            const newState = reducer(initialState, {
                type: "UPSERT_SUBAGENT_DETAIL",
                payload: details,
            });

            assert.deepStrictEqual(newState.subagentsDetailsById, details);
        });

        it("should merge subagent summaries", () => {
            const initialSummaries = {
                "msg-1": [{ id: "sub-1", status: "running" }],
            };

            const stateWithSummaries = {
                ...initialState,
                subagentsByParentMessageId: initialSummaries,
            };

            const additionalSummaries = {
                "msg-2": [{ id: "sub-2", status: "running" }],
            };

            const newState = reducer(stateWithSummaries, {
                type: "UPSERT_SUBAGENT_SUMMARIES",
                payload: additionalSummaries,
            });

            assert.ok(newState.subagentsByParentMessageId["msg-1"]);
            assert.ok(newState.subagentsByParentMessageId["msg-2"]);
        });
    });

    describe("Todo Management", () => {
        it("should add todo item", () => {
            const todo = { id: "todo-1", text: "Task 1", status: "pending" };

            const newState = reducer(initialState, {
                type: "ADD_TODO_ITEM",
                payload: todo,
            });

            assert.strictEqual(newState.todoItems.length, 1);
            assert.strictEqual(newState.todoItems[0].id, "todo-1");
        });

        it("should update todo item", () => {
            const stateWithTodos = {
                ...initialState,
                todoItems: [
                    { id: "todo-1", text: "Task 1", status: "pending" },
                    { id: "todo-2", text: "Task 2", status: "pending" },
                ],
            };

            const newState = reducer(stateWithTodos, {
                type: "UPDATE_TODO_ITEM",
                payload: {
                    id: "todo-1",
                    updates: { status: "done" },
                },
            });

            assert.strictEqual(newState.todoItems[0].status, "done");
            assert.strictEqual(newState.todoItems[1].status, "pending"); // Unchanged
        });

        it("should remove todo item", () => {
            const stateWithTodos = {
                ...initialState,
                todoItems: [
                    { id: "todo-1", text: "Task 1", status: "pending" },
                    { id: "todo-2", text: "Task 2", status: "pending" },
                ],
            };

            const newState = reducer(stateWithTodos, {
                type: "REMOVE_TODO_ITEM",
                payload: { id: "todo-1" },
            });

            assert.strictEqual(newState.todoItems.length, 1);
            assert.strictEqual(newState.todoItems[0].id, "todo-2");
        });
    });

    describe("Session Statistics", () => {
        it("should update session stats", () => {
            const stats = {
                input: 1000,
                output: 500,
            };

            const newState = reducer(initialState, {
                type: "SET_SESSION_STATS",
                payload: stats,
            });

            assert.strictEqual(newState.sessionStats.input, 1000);
            assert.strictEqual(newState.sessionStats.output, 500);
            assert.strictEqual(newState.sessionStats.read, 0); // Unchanged
        });

        it("should merge session stats", () => {
            const stateWithStats = {
                ...initialState,
                sessionStats: {
                    input: 500,
                    output: 250,
                    read: 100,
                    write: 50,
                    duration: 1000,
                },
            };

            const additionalStats = {
                input: 750,
                output: 400,
            };

            const newState = reducer(stateWithStats, {
                type: "SET_SESSION_STATS",
                payload: additionalStats,
            });

            assert.strictEqual(newState.sessionStats.input, 750);
            assert.strictEqual(newState.sessionStats.output, 400);
            assert.strictEqual(newState.sessionStats.read, 100); // Preserved
        });
    });

    describe("Server Status Management", () => {
        it("should set server status", () => {
            const newState = reducer(initialState, {
                type: "SET_SERVER_STATUS",
                payload: "connected",
            });

            assert.strictEqual(newState.serverStatus, "connected");
        });

        it("should track status transitions", () => {
            let state = initialState;

            state = reducer(state, { type: "SET_SERVER_STATUS", payload: "connecting" });
            assert.strictEqual(state.serverStatus, "connecting");

            state = reducer(state, { type: "SET_SERVER_STATUS", payload: "connected" });
            assert.strictEqual(state.serverStatus, "connected");

            state = reducer(state, { type: "SET_SERVER_STATUS", payload: "error" });
            assert.strictEqual(state.serverStatus, "error");
        });
    });

    describe("Unknown Actions", () => {
        it("should return unchanged state for unknown action", () => {
            const newState = reducer(initialState, {
                type: "UNKNOWN_ACTION",
                payload: "test",
            });

            assert.deepStrictEqual(newState, initialState);
        });
    });

    describe("Immutability", () => {
        it("should not mutate messages array", () => {
            const messages = [{ id: "msg-1", role: "user", content: "Test" }];
            const originalLength = messages.length;

            reducer(initialState, { type: "SET_MESSAGES", payload: messages });

            assert.strictEqual(messages.length, originalLength);
        });

        it("should not mutate prompt queue", () => {
            const queue = [{ id: "q-1", text: "Queued", sessionId: "s-1", createdAt: Date.now() }];
            const originalLength = queue.length;

            reducer(initialState, { type: "ADD_TO_QUEUE", payload: queue[0] });

            assert.strictEqual(queue.length, originalLength);
        });

        it("should create new object for every action", () => {
            const state1 = reducer(initialState, {
                type: "SET_INPUT_VALUE",
                payload: "Test",
            });

            const state2 = reducer(state1, {
                type: "SET_INPUT_VALUE",
                payload: "Test",
            });

            assert.notStrictEqual(state1, state2);
            assert.strictEqual(state1.inputValue, "Test");
            assert.strictEqual(state2.inputValue, "Test");
        });
    });

    describe("Complex State Transitions", () => {
        it("should handle complete message flow", () => {
            let state = initialState;

            // Start processing
            state = reducer(state, { type: "SET_PROCESSING", payload: true });
            assert.strictEqual(state.isProcessing, true);

            // Add user message
            state = reducer(state, {
                type: "APPEND_MESSAGE",
                payload: { id: "msg-1", role: "user", content: "Hello" },
            });
            assert.strictEqual(state.messages.length, 1);

            // Start streaming
            state = reducer(state, {
                type: "SET_STREAMING",
                payload: { isStreaming: true, steps: [] },
            });
            assert.ok(state.streaming);

            // Update streaming
            state = reducer(state, {
                type: "UPDATE_STREAMING",
                payload: { steps: [{ type: "text", text: "Hi" }] },
            });
            assert.strictEqual(state.streaming.steps.length, 1);

            // End streaming
            state = reducer(state, { type: "SET_STREAMING", payload: null });
            assert.strictEqual(state.streaming, null);

            // End processing
            state = reducer(state, { type: "SET_PROCESSING", payload: false });
            assert.strictEqual(state.isProcessing, false);
        });

        it("should handle queue execution flow", () => {
            let state = initialState;

            // Add items to queue
            state = reducer(state, {
                type: "ADD_TO_QUEUE",
                payload: { id: "q-1", text: "Msg 1", sessionId: "s-1", createdAt: Date.now() },
            });
            state = reducer(state, {
                type: "ADD_TO_QUEUE",
                payload: { id: "q-2", text: "Msg 2", sessionId: "s-1", createdAt: Date.now() },
            });
            assert.strictEqual(state.promptQueue.length, 2);

            // Execute queue
            state = reducer(state, { type: "SET_PROCESSING", payload: true });
            state = reducer(state, { type: "REMOVE_FROM_QUEUE", payload: { id: "q-1" } });
            assert.strictEqual(state.promptQueue.length, 1);

            // Complete
            state = reducer(state, { type: "REMOVE_FROM_QUEUE", payload: { id: "q-2" } });
            state = reducer(state, { type: "SET_PROCESSING", payload: false });
            assert.strictEqual(state.promptQueue.length, 0);
            assert.strictEqual(state.isProcessing, false);
        });

        it("should handle SET_QUEUE drain from backend — items removed one by one", () => {
            let state = { ...initialState, currentSessionId: "s-1" };

            const item1 = { id: "q-1", text: "Msg 1", sessionId: "s-1", createdAt: 1 };
            const item2 = { id: "q-2", text: "Msg 2", sessionId: "s-1", createdAt: 2 };
            const item3 = { id: "q-3", text: "Msg 3", sessionId: "s-1", createdAt: 3 };

            // Backend sends full queue
            state = reducer(state, {
                type: "SET_QUEUE",
                payload: { sessionId: "s-1", queue: [item1, item2, item3] },
            });
            assert.strictEqual(state.promptQueue.length, 3);

            // After first item dispatched, backend sends updated queue with remaining items
            state = reducer(state, {
                type: "SET_QUEUE",
                payload: { sessionId: "s-1", queue: [item2, item3] },
            });
            assert.strictEqual(state.promptQueue.length, 2);
            assert.strictEqual(state.promptQueue[0].id, "q-2");

            // After second item dispatched
            state = reducer(state, {
                type: "SET_QUEUE",
                payload: { sessionId: "s-1", queue: [item3] },
            });
            assert.strictEqual(state.promptQueue.length, 1);

            // After last item dispatched — empty queue
            state = reducer(state, {
                type: "SET_QUEUE",
                payload: { sessionId: "s-1", queue: [] },
            });
            assert.strictEqual(state.promptQueue.length, 0);
        });

        it("should handle ADD_TO_LOCAL_QUEUE optimistic add and SET_QUEUE reconciliation", () => {
            let state = { ...initialState, currentSessionId: "s-1" };

            const optimisticItem = {
                id: "pending-123",
                text: "My queued message",
                sessionId: "s-1",
                createdAt: Date.now(),
            };

            // User sends while processing — optimistic local add
            state = reducer(state, { type: "ADD_TO_LOCAL_QUEUE", payload: optimisticItem });
            assert.strictEqual(state.promptQueue.length, 1);
            assert.strictEqual(state.promptQueue[0].id, "pending-123");
            assert.strictEqual(state.isQueueOpen, true);

            // Backend confirms with authoritative data (different id, same text)
            const backendItem = { id: "q-1", text: "My queued message", sessionId: "s-1", createdAt: Date.now() };
            state = reducer(state, {
                type: "SET_QUEUE",
                payload: { sessionId: "s-1", queue: [backendItem] },
            });
            assert.strictEqual(state.promptQueue.length, 1);
            assert.strictEqual(state.promptQueue[0].id, "q-1");

            // Backend drains — item sent
            state = reducer(state, {
                type: "SET_QUEUE",
                payload: { sessionId: "s-1", queue: [] },
            });
            assert.strictEqual(state.promptQueue.length, 0);
        });

        it("should deduplicate ADD_TO_LOCAL_QUEUE by id", () => {
            let state = { ...initialState, currentSessionId: "s-1" };

            const item = { id: "dup-1", text: "Msg", sessionId: "s-1", createdAt: Date.now() };
            state = reducer(state, { type: "ADD_TO_LOCAL_QUEUE", payload: item });
            assert.strictEqual(state.promptQueue.length, 1);

            state = reducer(state, { type: "ADD_TO_LOCAL_QUEUE", payload: item });
            assert.strictEqual(state.promptQueue.length, 1);
        });
    });

    describe("Edge Cases", () => {
        it("should handle null payload", () => {
            const newState = reducer(initialState, {
                type: "SET_MESSAGES",
                payload: null,
            });

            assert.strictEqual(newState.messages, null);
        });

        it("should handle undefined payload", () => {
            const newState = reducer(initialState, {
                type: "SET_SELECTED_MODEL",
                payload: undefined,
            });

            assert.strictEqual(newState.selectedModel, undefined);
        });

        it("should handle empty array", () => {
            const newState = reducer(initialState, {
                type: "SET_MESSAGES",
                payload: [],
            });

            assert.strictEqual(newState.messages.length, 0);
        });

        it("should handle very large state", () => {
            const largeMessages = Array.from({ length: 10000 }, (_, i) => ({
                id: `msg-${i}`,
                role: "user",
                content: `Message ${i}`,
            }));

            const newState = reducer(initialState, {
                type: "SET_MESSAGES",
                payload: largeMessages,
            });

            assert.strictEqual(newState.messages.length, 10000);
        });
    });
});
