import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Collapsed State Rendering Logic Tests
 *
 * This file captures the intended UI logic for the assistant's collapsed states,
 * ensuring that any future refactoring adheres to the correct visual presentation
 * of intermediate steps (non-last messages) vs the final response (last message).
 */

// Simulated logic from MessageComponents.tsx
function getCollapsedRenderingState({
    hasPrimaryResponseBody,
    isLastInBlock,
    isStreamingActive,
    hasCopyableResponseContent,
}) {
    // 1. Header is only shown for the last message in a block
    const showAssistantResponseHeader = hasPrimaryResponseBody && isLastInBlock;

    // 2. The timestamp is moved inside the bubble and copy button removed for messages WITHOUT copyable text
    const showTimestampInsideBubble = !isStreamingActive && !hasCopyableResponseContent;

    // 3. The copy button and external timestamp are only shown for messages WITH copyable text
    const showFooterOutsideBubble = !isStreamingActive && hasCopyableResponseContent;

    return {
        showAssistantResponseHeader,
        showTimestampInsideBubble,
        showFooterOutsideBubble,
    };
}

describe("Assistant Message Collapsed State UI Logic", () => {
    it("should hide header and move timestamp inside bubble for intermediate steps without text", () => {
        const state = getCollapsedRenderingState({
            hasPrimaryResponseBody: false,
            isLastInBlock: false, // This is an intermediate subagent step
            isStreamingActive: false,
            hasCopyableResponseContent: false, // No text
        });

        assert.strictEqual(state.showAssistantResponseHeader, false, "Header should be hidden for intermediate steps");
        assert.strictEqual(state.showTimestampInsideBubble, true, "Timestamp should be moved inside the bubble for intermediate steps");
        assert.strictEqual(state.showFooterOutsideBubble, false, "Copy button and external footer should be hidden for intermediate steps");
    });

    it("should hide header but put footer outside for intermediate steps WITH text (e.g. expanded text message followed by tool call)", () => {
        const state = getCollapsedRenderingState({
            hasPrimaryResponseBody: true,
            isLastInBlock: false, // It's an expanded text message that isn't the final card
            isStreamingActive: false,
            hasCopyableResponseContent: true, // It has text
        });

        assert.strictEqual(state.showAssistantResponseHeader, false, "Header should be hidden because it's not the last card");
        assert.strictEqual(state.showTimestampInsideBubble, false, "Timestamp should NOT be inside the bubble because it has text");
        assert.strictEqual(state.showFooterOutsideBubble, true, "Copy button and external footer should be visible because it has text");
    });

    it("should show header and external footer for the absolute last message in a block with text", () => {
        const state = getCollapsedRenderingState({
            hasPrimaryResponseBody: true,
            isLastInBlock: true, // This is the final response
            isStreamingActive: false,
            hasCopyableResponseContent: true,
        });

        assert.strictEqual(state.showAssistantResponseHeader, true, "Header should be visible for the final message");
        assert.strictEqual(state.showTimestampInsideBubble, false, "Timestamp should NOT be inside the bubble for the final message");
        assert.strictEqual(state.showFooterOutsideBubble, true, "Copy button and external footer should be visible for the final message");
    });
    
    it("should hide footers while streaming is active", () => {
        const state = getCollapsedRenderingState({
            hasPrimaryResponseBody: true,
            isLastInBlock: true,
            isStreamingActive: true,
            hasCopyableResponseContent: true,
        });

        assert.strictEqual(state.showTimestampInsideBubble, false);
        assert.strictEqual(state.showFooterOutsideBubble, false);
    });
});
