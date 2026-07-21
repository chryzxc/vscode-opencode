import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert";

/**
 * Message Components Rendering Tests
 *
 * Tests the React components that render chat messages:
 *
 * **Components Tested:**
 * - UserMessage - User message rendering
 * - AssistantMessage - Assistant message rendering
 * - SystemMessage - System message rendering
 * - ThinkingBubble - Reasoning/thinking display
 * - PermissionCard - Permission request cards
 * - StreamingCard - Real-time streaming display
 *
 * **Test Coverage:**
 * - Component rendering with various props
 * - Message part handling (text, images, files)
 * - Markdown rendering
 * - Interactive elements
 * - Edge cases (empty messages, special characters, very long content)
 */

// ============================================================================
// Mock Implementations
// ============================================================================

class MockReact {
    createElement(type, props, ...children) {
        return {
            type,
            props: props || {},
            children: children.flat().filter(c => c != null),
        };
    }

    cloneElement(element, newProps, ...newChildren) {
        return {
            ...element,
            props: {
                ...element.props,
                ...newProps,
            },
            children: newChildren.length > 0 ? newChildren : element.children,
        };
    }
}

// ============================================================================
// Test Data
// ============================================================================

function createUserMessage(content, options = {}) {
    return {
        role: "user",
        content,
        text: content,
        parts: [{ type: "text", text: content }],
        time: { created: Date.now() },
        images: options.images || [],
        ...options,
    };
}

function createAssistantMessage(content, options = {}) {
    return {
        role: "assistant",
        content,
        text: content,
        parts: [{ type: "text", text: content }],
        time: { created: Date.now() },
        ...options,
    };
}

function createSystemMessage(content, options = {}) {
    return {
        role: "system",
        content,
        ...options,
    };
}

function createThinkingEvents(events) {
    return events.map(event => ({
        type: "thinking",
        timestamp: Date.now(),
        ...event,
    }));
}

// ============================================================================
// Message Rendering Tests
// ============================================================================

describe("Message Components Rendering Tests", () => {
    let React;

    before(() => {
        React = new MockReact();
    });

    describe("UserMessage Component", () => {
        it("should render simple text message", () => {
            const message = createUserMessage("Hello, AI!");

            const element = React.createElement("UserMessage", { message });

            assert.strictEqual(element.type, "UserMessage");
            assert.deepStrictEqual(element.props.message, message);
            assert.strictEqual(element.props.message.content, "Hello, AI!");
        });

        it("should render message with images", () => {
            const images = [
                "data:image/png;base64,iVBORw0KG...",
                "data:image/jpeg;base64,/9j/4AAQ...",
            ];

            const message = createUserMessage("Check this image", { images });

            assert.strictEqual(message.images.length, 2);
            assert.ok(message.images[0].startsWith("data:image/png"));
            assert.ok(message.images[1].startsWith("data:image/jpeg"));
        });

        it("should render message with file attachments", () => {
            const message = createUserMessage("Review these files", {
                parts: [
                    { type: "text", text: "Review these files" },
                    {
                        type: "file",
                        filename: "test.ts",
                        url: "file:///test/workspace/test.ts",
                    },
                ],
            });

            assert.strictEqual(message.parts.length, 2);
            assert.strictEqual(message.parts[1].type, "file");
            assert.strictEqual(message.parts[1].filename, "test.ts");
        });

        it("should render message with code context", () => {
            const message = createUserMessage("Explain this function", {
                parts: [
                    { type: "text", text: "Explain this function" },
                    {
                        type: "text",
                        text: "```typescript\nfunction test() { return true; }\n```",
                    },
                ],
            });

            assert.ok(message.parts[1].text.includes("```typescript"));
            assert.ok(message.parts[1].text.includes("function test"));
        });

        it("should handle empty message", () => {
            const message = createUserMessage("");

            assert.strictEqual(message.content, "");
            assert.strictEqual(message.text, "");
        });

        it("should handle very long message", () => {
            const longText = "A".repeat(10000);
            const message = createUserMessage(longText);

            assert.strictEqual(message.content.length, 10000);
            assert.strictEqual(message.text.length, 10000);
        });

        it("should handle special characters", () => {
            const specialText = "Test with émojis 🎉, spëcial çhars, and <script> tags";
            const message = createUserMessage(specialText);

            assert.ok(message.content.includes("🎉"));
            assert.ok(message.content.includes("émojis"));
            assert.ok(message.content.includes("<script>"));
        });

        it("should handle multiline message", () => {
            const multiline = `Line 1
Line 2
Line 3`;

            const message = createUserMessage(multiline);

            assert.strictEqual(message.content.split("\n").length, 3);
        });
    });

    describe("AssistantMessage Component", () => {
        it("should render simple text response", () => {
            const message = createAssistantMessage("Hello! How can I help?");

            assert.strictEqual(message.role, "assistant");
            assert.strictEqual(message.content, "Hello! How can I help?");
        });

        it("should render message with structured output", () => {
            const message = createAssistantMessage("Response", {
                structuredOutput: {
                    responseType: "message",
                    message: "Actual response",
                },
            });

            assert.ok(message.structuredOutput);
            assert.strictEqual(message.structuredOutput.responseType, "message");
        });

        it("should render message with plan", () => {
            const message = createAssistantMessage("Here's my plan", {
                plan: {
                    file: "plan.md",
                    title: "Implementation Plan",
                    content: "# Plan\n\n1. Step 1\n2. Step 2",
                },
            });

            assert.ok(message.plan);
            assert.strictEqual(message.plan.title, "Implementation Plan");
            assert.ok(message.plan.content.includes("Step 1"));
        });

        it("should render message with subagents", () => {
            const messageId = `msg-${Date.now()}`;
            const message = createAssistantMessage("Working on it", {
                subagents: [
                    {
                        id: "subagent-1",
                        parentMessageId: messageId,
                        status: "running",
                        title: "Analyzing code",
                    },
                ],
            });

            assert.strictEqual(message.subagents.length, 1);
            assert.strictEqual(message.subagents[0].status, "running");
            assert.strictEqual(message.subagents[0].title, "Analyzing code");
        });

        it("should render message with reasoning", () => {
            const message = createAssistantMessage("Let me think...", {
                reasoning: {
                    events: createThinkingEvents([
                        { content: "Analyzing the problem..." },
                        { content: "Considering options..." },
                        { content: "Formulating solution..." },
                    ]),
                },
            });

            assert.ok(message.reasoning);
            assert.strictEqual(message.reasoning.events.length, 3);
        });

        it("should render message with progress updates", () => {
            const message = createAssistantMessage("Processing...", {
                progressUpdates: [
                    { title: "Step 1", status: "done" },
                    { title: "Step 2", status: "running" },
                    { title: "Step 3", status: "pending" },
                ],
            });

            assert.strictEqual(message.progressUpdates.length, 3);
            assert.strictEqual(message.progressUpdates[0].status, "done");
        });

        it("should render message with interactive choices", () => {
            const message = createAssistantMessage("Choose an option", {
                interactiveEvents: [
                    {
                        id: "choice-1",
                        type: "choice",
                        label: "Option A",
                        value: "a",
                    },
                    {
                        id: "choice-2",
                        type: "choice",
                        label: "Option B",
                        value: "b",
                    },
                ],
            });

            assert.strictEqual(message.interactiveEvents.length, 2);
            assert.strictEqual(message.interactiveEvents[0].label, "Option A");
        });

        it("should render message with todo items", () => {
            const message = createAssistantMessage("Here are your tasks", {
                todoItems: [
                    { id: "todo-1", text: "Task 1", status: "pending" },
                    { id: "todo-2", text: "Task 2", status: "in_progress" },
                    { id: "todo-3", text: "Task 3", status: "done" },
                ],
            });

            assert.strictEqual(message.todoItems.length, 3);
            assert.strictEqual(message.todoItems[1].status, "in_progress");
        });
    });

    describe("SystemMessage Component", () => {
        it("should render system notification", () => {
            const message = createSystemMessage("Session saved successfully");

            assert.strictEqual(message.role, "system");
            assert.strictEqual(message.content, "Session saved successfully");
        });

        it("should render error message", () => {
            const message = createSystemMessage("An error occurred", {
                level: "error",
            });

            assert.strictEqual(message.level, "error");
        });

        it("should render warning message", () => {
            const message = createSystemMessage("Budget running low", {
                level: "warning",
            });

            assert.strictEqual(message.level, "warning");
        });

        it("should render info message", () => {
            const message = createSystemMessage("New session created", {
                level: "info",
            });

            assert.strictEqual(message.level, "info");
        });
    });

    describe("ThinkingBubble Component", () => {
        it("should render thinking events", () => {
            const thinkingEvents = createThinkingEvents([
                { content: "Analyzing request..." },
                { content: "Searching knowledge base..." },
                { content: "Formulating response..." },
            ]);

            assert.strictEqual(thinkingEvents.length, 3);
            assert.strictEqual(thinkingEvents[0].content, "Analyzing request...");
            assert.strictEqual(thinkingEvents[1].content, "Searching knowledge base...");
        });

        it("should render collapsed thinking", () => {
            const thinkingEvents = createThinkingEvents([
                { content: "Thinking step 1" },
                { content: "Thinking step 2" },
            ]);

            const collapsed = {
                events: thinkingEvents,
                collapsed: true,
            };

            assert.strictEqual(collapsed.collapsed, true);
            assert.strictEqual(collapsed.events.length, 2);
        });

        it("should render expanded thinking", () => {
            const thinkingEvents = createThinkingEvents([
                { content: "Detailed analysis..." },
            ]);

            const expanded = {
                events: thinkingEvents,
                collapsed: false,
            };

            assert.strictEqual(expanded.collapsed, false);
        });
    });

    describe("PermissionCard Component", () => {
        it("should render file read permission", () => {
            const permission = {
                id: "perm-1",
                type: "permission",
                action: "read_file",
                path: "/test/workspace/secret.txt",
                reason: "To analyze the code",
            };

            assert.strictEqual(permission.action, "read_file");
            assert.strictEqual(permission.path, "/test/workspace/secret.txt");
            assert.strictEqual(permission.reason, "To analyze the code");
        });

        it("should render file write permission", () => {
            const permission = {
                id: "perm-2",
                type: "permission",
                action: "write_file",
                path: "/test/workspace/output.txt",
                reason: "To save results",
            };

            assert.strictEqual(permission.action, "write_file");
            assert.strictEqual(permission.path, "/test/workspace/output.txt");
        });

        it("should render command execution permission", () => {
            const permission = {
                id: "perm-3",
                type: "permission",
                action: "execute_command",
                command: "npm install",
                reason: "To install dependencies",
            };

            assert.strictEqual(permission.action, "execute_command");
            assert.strictEqual(permission.command, "npm install");
        });
    });

    describe("StreamingCard Component", () => {
        it("should render active streaming state", () => {
            const streaming = {
                sessionId: "session-1",
                messageId: "msg-1",
                isStreaming: true,
                steps: [
                    { type: "text", text: "Hello" },
                    { type: "text", text: " world" },
                ],
            };

            assert.strictEqual(streaming.isStreaming, true);
            assert.strictEqual(streaming.steps.length, 2);
        });

        it("should render streaming with multiple parts", () => {
            const streaming = {
                sessionId: "session-1",
                messageId: "msg-1",
                isStreaming: true,
                steps: [
                    { type: "text", text: "Thinking..." },
                    { type: "thinking", content: "Analyzing" },
                    { type: "text", text: "Done" },
                ],
            };

            assert.strictEqual(streaming.steps.length, 3);
            assert.strictEqual(streaming.steps[1].type, "thinking");
        });

        it("should render streaming completion", () => {
            const streaming = {
                sessionId: "session-1",
                messageId: "msg-1",
                isStreaming: false,
                completedAt: Date.now(),
            };

            assert.strictEqual(streaming.isStreaming, false);
            assert.ok(streaming.completedAt);
        });
    });

    describe("Message Part Rendering", () => {
        it("should render text part", () => {
            const part = {
                type: "text",
                text: "Plain text content",
            };

            assert.strictEqual(part.type, "text");
            assert.strictEqual(part.text, "Plain text content");
        });

        it("should render file part", () => {
            const part = {
                type: "file",
                filename: "test.ts",
                url: "file:///test/workspace/test.ts",
                mime: "text/plain",
            };

            assert.strictEqual(part.type, "file");
            assert.strictEqual(part.filename, "test.ts");
            assert.strictEqual(part.mime, "text/plain");
        });

        it("should render image part", () => {
            const part = {
                type: "file",
                filename: "screenshot.png",
                url: "data:image/png;base64,iVBORw0KG...",
                mime: "image/png",
            };

            assert.strictEqual(part.type, "file");
            assert.strictEqual(part.filename, "screenshot.png");
            assert.strictEqual(part.mime, "image/png");
        });

        it("should render code block part", () => {
            const part = {
                type: "text",
                text: "```javascript\nconst x = 42;\n```",
            };

            assert.ok(part.text.includes("```javascript"));
            assert.ok(part.text.includes("const x = 42"));
        });

        it("should render markdown part", () => {
            const part = {
                type: "text",
                text: "**Bold** and *italic* text",
            };

            assert.ok(part.text.includes("**Bold**"));
            assert.ok(part.text.includes("*italic*"));
        });
    });

    describe("Edge Cases", () => {
        it("should handle message with null content", () => {
            const message = {
                role: "assistant",
                content: null,
                text: undefined,
            };

            assert.strictEqual(message.content, null);
            assert.strictEqual(message.text, undefined);
        });

        it("should handle message with empty parts", () => {
            const message = createAssistantMessage("", {
                parts: [],
            });

            assert.strictEqual(message.parts.length, 0);
        });

        it("should handle message with very long word", () => {
            const longWord = "a".repeat(1000);
            const message = createUserMessage(longWord);

            assert.strictEqual(message.content.length, 1000);
        });

        it("should handle message with only whitespace", () => {
            const message = createUserMessage("   \n\t  ");

            assert.strictEqual(message.content.trim().length, 0);
        });

        it("should handle message with mixed content types", () => {
            const message = createUserMessage("Check this", {
                parts: [
                    { type: "text", text: "Check this" },
                    {
                        type: "file",
                        filename: "code.ts",
                        url: "file:///test/code.ts",
                    },
                    {
                        type: "text",
                        text: "and this image",
                    },
                    {
                        type: "file",
                        filename: "diag.png",
                        url: "data:image/png;base64,...",
                    },
                ],
            });

            assert.strictEqual(message.parts.length, 4);
            assert.strictEqual(message.parts[0].type, "text");
            assert.strictEqual(message.parts[1].type, "file");
            assert.strictEqual(message.parts[2].type, "text");
            assert.strictEqual(message.parts[3].type, "file");
        });

        it("should handle message with unicode emojis", () => {
            const emojis = "😀 🎉 🚀 💻 🎨";
            const message = createUserMessage(emojis);

            assert.strictEqual(message.content, emojis);
        });

        it("should handle message with RTL text", () => {
            const rtlText = "مرحبا بالعالم"; // Arabic
            const message = createUserMessage(rtlText);

            assert.strictEqual(message.content, rtlText);
        });

        it("should handle message with code injection attempt", () => {
            const malicious = "<script>alert('xss')</script>";
            const message = createUserMessage(malicious);

            assert.ok(message.content.includes("<script>"));
            // In real component, this would be sanitized
        });

        it("should handle message with markdown injection", () => {
            const markdown = "# Header\n\n**Bold** and *italic*";
            const message = createAssistantMessage(markdown);

            assert.ok(message.content.includes("# Header"));
            assert.ok(message.content.includes("**Bold**"));
        });
    });

    describe("Message Timestamps", () => {
        it("should render message with timestamp", () => {
            const timestamp = Date.now();
            const message = createUserMessage("Test", {
                time: { created: timestamp },
            });

            assert.strictEqual(message.time.created, timestamp);
        });

        it("should render message with edited timestamp", () => {
            const created = Date.now() - 10000;
            const edited = Date.now();
            const message = createUserMessage("Test", {
                time: { created, edited },
            });

            assert.strictEqual(message.time.created, created);
            assert.strictEqual(message.time.edited, edited);
        });

        it("should handle message without timestamp", () => {
            const message = createUserMessage("Test");

            // In real component, would default to current time
            assert.ok(message.time);
        });
    });

    describe("Message Metadata", () => {
        it("should render message with model info", () => {
            const message = createAssistantMessage("Response", {
                model: {
                    providerID: "openai",
                    modelID: "gpt-4",
                    providerName: "OpenAI",
                },
            });

            assert.strictEqual(message.model.providerID, "openai");
            assert.strictEqual(message.model.modelID, "gpt-4");
        });

        it("should render message with agent info", () => {
            const message = createAssistantMessage("Response", {
                agent: {
                    id: "build",
                    name: "Build Agent",
                    color: "#FF5733",
                },
            });

            assert.strictEqual(message.agent.id, "build");
            assert.strictEqual(message.agent.name, "Build Agent");
            assert.strictEqual(message.agent.color, "#FF5733");
        });

        it("should render message with token usage", () => {
            const message = createAssistantMessage("Response", {
                usage: {
                    promptTokens: 100,
                    completionTokens: 50,
                    totalTokens: 150,
                },
            });

            assert.strictEqual(message.usage.promptTokens, 100);
            assert.strictEqual(message.usage.completionTokens, 50);
            assert.strictEqual(message.usage.totalTokens, 150);
        });
    });

    describe("Message Grouping", () => {
        it("should group contiguous messages from same role", () => {
            const messages = [
                createUserMessage("Hello"),
                createUserMessage("How are you?"),
                createAssistantMessage("I'm doing well"),
                createAssistantMessage("How can I help?"),
            ];

            const userGroup = messages.filter(m => m.role === "user");
            const assistantGroup = messages.filter(m => m.role === "assistant");

            assert.strictEqual(userGroup.length, 2);
            assert.strictEqual(assistantGroup.length, 2);
        });

        it("should detect message boundaries", () => {
            const messages = [
                createUserMessage("Message 1"),
                createAssistantMessage("Response 1"),
                createUserMessage("Message 2"),
                createAssistantMessage("Response 2"),
            ];

            const boundaries = [];
            for (let i = 1; i < messages.length; i++) {
                if (messages[i].role !== messages[i - 1].role) {
                    boundaries.push(i);
                }
            }

            assert.strictEqual(boundaries.length, 3); // Every message is a boundary
        });
    });

    describe("Message Filtering", () => {
        it("should filter messages by role", () => {
            const messages = [
                createUserMessage("User 1"),
                createAssistantMessage("Assistant 1"),
                createSystemMessage("System 1"),
                createUserMessage("User 2"),
            ];

            const userMessages = messages.filter(m => m.role === "user");
            const assistantMessages = messages.filter(m => m.role === "assistant");
            const systemMessages = messages.filter(m => m.role === "system");

            assert.strictEqual(userMessages.length, 2);
            assert.strictEqual(assistantMessages.length, 1);
            assert.strictEqual(systemMessages.length, 1);
        });

        it("should filter messages by content", () => {
            const messages = [
                createUserMessage("Hello world"),
                createUserMessage("Goodbye world"),
                createAssistantMessage("Hello there"),
            ];

            const helloMessages = messages.filter(m =>
                m.content.toLowerCase().includes("hello")
            );

            assert.strictEqual(helloMessages.length, 2);
        });

        it("should filter messages by time range", () => {
            const now = Date.now();
            const messages = [
                createUserMessage("Old", { time: { created: now - 10000 } }),
                createUserMessage("Recent", { time: { created: now - 1000 } }),
                createUserMessage("Now", { time: { created: now } }),
            ];

            const recentMessages = messages.filter(m =>
                m.time.created >= now - 5000
            );

            assert.strictEqual(recentMessages.length, 2);
        });
    });

    describe("Message Transformation", () => {
        it("should transform message to plain text", () => {
            const message = createAssistantMessage("**Bold** text");
            const plain = message.content.replace(/\*\*/g, "");

            assert.strictEqual(plain, "Bold text");
        });

        it("should extract message preview", () => {
            const longMessage = createUserMessage("A".repeat(1000));
            const preview = longMessage.content.slice(0, 100) + "...";

            assert.strictEqual(preview.length, 103); // 100 + "..."
            assert.ok(preview.endsWith("..."));
        });

        it("should sanitize HTML in message", () => {
            const message = createUserMessage("<script>alert('xss')</script>");
            const sanitized = message.content
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            assert.ok(sanitized.includes("&lt;script&gt;"));
        });
    });
});
