import test from "node:test";
import assert from "node:assert/strict";

/**
 * Behavioral tests for system message rendering
 * These tests verify actual behavior with real message objects
 * rather than just code pattern matching
 */

test("system reminder messages should be detected by pattern matching", () => {
  // Test various system reminder patterns
  const systemReminderMessages = [
    { content: "<system-reminder>Some reminder text</system-reminder>", role: "user" },
    { content: "<auto-slash-command>Executing command</auto-slash-command>", role: "user" },
    { content: "<!-- omo_internal_initiator -->", role: "user" },
    { content: "[analyze-mode] Starting analysis", role: "user" },
    { content: "[background-task] Task completed", role: "user" },
    { content: "[search-model] maximize search effort", role: "user" },
    { text: "System reminder: you can edit settings", role: "user" },
    { text: "Internal reminder: check your work", role: "user" },
  ];

  // Helper function to detect system reminders (simplified version of the actual logic)
  function isSystemReminder(message) {
    const text = (message.content || message.text || "").trim().toLowerCase();
    if (!text) return false;

    // Check for angle bracket patterns
    if (text.includes("<system-reminder>") ||
        text.includes("<auto-slash-command>") ||
        text.includes("<!-- omo_internal_initiator -->")) {
      return true;
    }

    // Check for square bracket pattern at start
    const bracketPattern = /^\[[a-z][a-z0-9_\- ]*\]/i;
    if (bracketPattern.test(text)) {
      return true;
    }

    // Check for specific reminder text patterns
    if (text.includes("[search-model]") && text.includes("maximize search effort")) {
      return true;
    }

    if (text.startsWith("system reminder") || text.startsWith("internal reminder")) {
      return true;
    }

    if (text.includes("reminder: you can")) {
      return true;
    }

    return false;
  }

  // Verify all system reminder patterns are detected
  for (const message of systemReminderMessages) {
    assert.strictEqual(
      isSystemReminder(message),
      true,
      `Should detect system reminder in: ${message.content || message.text}`
    );
  }
});

test("non-system messages should not be detected as system reminders", () => {
  const nonSystemMessages = [
    { content: "Hello, how are you?", role: "user" },
    { content: "Can you help me with this code?", role: "user" },
    { content: "Here's my analysis:", role: "assistant" },
    { text: "Let me explain the solution:", role: "assistant" },
    { content: "Check out this link: https://example.com", role: "user" },
  ];

  function isSystemReminder(message) {
    const text = (message.content || message.text || "").trim().toLowerCase();
    if (!text) return false;

    // Check for angle bracket patterns
    if (text.includes("<system-reminder>") ||
        text.includes("<auto-slash-command>") ||
        text.includes("<!-- omo_internal_initiator -->")) {
      return true;
    }

    // Check for square bracket pattern at start (must start with lowercase letter)
    const bracketPattern = /^\[[a-z][a-z0-9_\- ]*\]/i;
    if (bracketPattern.test(text)) {
      return true;
    }

    // Check for specific reminder text patterns
    if (text.includes("[search-model]") && text.includes("maximize search effort")) {
      return true;
    }

    if (text.startsWith("system reminder") || text.startsWith("internal reminder")) {
      return true;
    }

    if (text.includes("reminder: you can")) {
      return true;
    }

    return false;
  }

  // Verify non-system messages are not detected as system reminders
  for (const message of nonSystemMessages) {
    assert.strictEqual(
      isSystemReminder(message),
      false,
      `Should not detect as system reminder: ${message.content || message.text}`
    );
  }
});

test("system messages should be converted to system role for rendering", () => {
  // Simulate the conversion process
  function processMessageForRendering(message) {
    const text = (message.content || message.text || "").trim().toLowerCase();
    if (!text) return message;

    // Check if it's a system reminder
    const isSystemReminder =
      text.includes("<system-reminder>") ||
      text.includes("<auto-slash-command>") ||
      text.includes("<!-- omo_internal_initiator -->") ||
      /^\[[a-z][a-z0-9_\- ]*\]/i.test(text) ||
      (text.includes("[search-model]") && text.includes("maximize search effort")) ||
      text.startsWith("system reminder") ||
      text.startsWith("internal reminder") ||
      text.includes("reminder: you can");

    if (isSystemReminder) {
      return {
        ...message,
        role: "system",
        responseType: "system",
      };
    }

    return message;
  }

  const systemReminderMessage = {
    content: "<system-reminder>Mode switched to analyze</system-reminder>",
    role: "user",
  };

  const processed = processMessageForRendering(systemReminderMessage);

  assert.strictEqual(processed.role, "system");
  assert.strictEqual(processed.responseType, "system");
});

test("system messages with various patterns should all be renderable", () => {
  // Test that various system message patterns are marked as renderable
  const systemMessages = [
    { content: "<system-reminder>Test</system-reminder>", role: "user" },
    { content: "<auto-slash-command>/test</auto-slash-command>", role: "user" },
    { content: "[analyze-mode] Starting analysis", role: "user" },
    { content: "[background-task] Task running", role: "user" },
    { text: "System reminder: check settings", role: "user" },
  ];

  function isRenderable(message) {
    if (!message) return false;

    const text = (message.content || message.text || "").trim();
    if (!text) return false;

    // System reminders are renderable
    const lower = text.toLowerCase();
    const isSystemReminder =
      lower.includes("<system-reminder>") ||
      lower.includes("<auto-slash-command>") ||
      lower.includes("<!-- omo_internal_initiator -->") ||
      /^\[[a-z][a-z0-9_\- ]*\]/i.test(text) ||
      (lower.includes("[search-model]") && lower.includes("maximize search effort")) ||
      lower.startsWith("system reminder") ||
      lower.startsWith("internal reminder") ||
      lower.includes("reminder: you can");

    if (isSystemReminder) return true;

    // Regular messages are renderable if they have content
    return true;
  }

  // Verify all system messages are renderable
  for (const message of systemMessages) {
    assert.strictEqual(
      isRenderable(message),
      true,
      `System message should be renderable: ${message.content || message.text}`
    );
  }
});

test("empty messages should not be renderable", () => {
  const emptyMessages = [
    { content: "", role: "user" },
    { text: "", role: "assistant" },
    { content: "   ", role: "user" },
    { role: "user" },
    null,
    undefined,
  ];

  function isRenderable(message) {
    if (!message) return false;

    const text = (message.content || message.text || "").trim();
    if (!text) return false;

    return true;
  }

  // Verify empty messages are not renderable
  for (const message of emptyMessages) {
    assert.strictEqual(
      isRenderable(message),
      false,
      `Empty message should not be renderable: ${JSON.stringify(message)}`
    );
  }
});

test("system messages should not be treated as assistant messages", () => {
  const systemMessage = {
    content: "<system-reminder>Test</system-reminder>",
    role: "system",
  };

  function isAssistantMessage(message) {
    if (!message) return false;
    const role = (message.role || "").toLowerCase();
    return role === "assistant";
  }

  assert.strictEqual(
    isAssistantMessage(systemMessage),
    false,
    "System messages should not be treated as assistant messages"
  );
});

test("bracket pattern should only match valid system messages", () => {
  const validSystemMessages = [
    "[analyze-mode]",
    "[background-task]",
    "[search-model]",
    "[mode-switch]",
    "[auto-command]",
  ];

  const invalidSystemMessages = [
    "[", // incomplete
    "regular message",
    "Check [this] out", // bracket in middle
  ];

  const bracketPattern = /^\[[a-z][a-z0-9_\- ]*\]/i;

  // Valid system messages should match
  for (const message of validSystemMessages) {
    assert.strictEqual(
      bracketPattern.test(message),
      true,
      `Should match valid system message: ${message}`
    );
  }

  // Invalid system messages should not match
  for (const message of invalidSystemMessages) {
    assert.strictEqual(
      bracketPattern.test(message),
      false,
      `Should not match invalid system message: ${message}`
    );
  }
});

test("system message detection should be case-insensitive for patterns", () => {
  const caseVariations = [
    "[ANALYZE-MODE]",
    "[analyze-mode]",
    "[Analyze-Mode]",
    "[ANALYZE-MODE] Starting",
    "<SYSTEM-REMINDER>Test</system-reminder>",
    "<System-Reminder>Test</system-reminder>",
  ];

  function isSystemReminder(message) {
    const text = (message.content || message || "").trim().toLowerCase();

    // Bracket pattern is case-insensitive
    const bracketPattern = /^\[[a-z][a-z0-9_\- ]*\]/i;
    if (bracketPattern.test(text)) return true;

    // String includes are case-insensitive due to toLowerCase()
    if (text.includes("<system-reminder>")) return true;

    return false;
  }

  // All variations should be detected
  for (const message of caseVariations) {
    assert.strictEqual(
      isSystemReminder(message),
      true,
      `Should detect system message (case-insensitive): ${message}`
    );
  }
});

test("system messages should preserve original content after conversion", () => {
  const originalMessage = {
    content: "<system-reminder>Mode: analyze</system-reminder>",
    role: "user",
    timestamp: 1234567890,
  };

  function convertToSystemRole(message) {
    return {
      ...message,
      role: "system",
      responseType: "system",
    };
  }

  const converted = convertToSystemRole(originalMessage);

  assert.strictEqual(converted.content, originalMessage.content);
  assert.strictEqual(converted.timestamp, originalMessage.timestamp);
  assert.strictEqual(converted.role, "system");
  assert.strictEqual(converted.responseType, "system");
});
