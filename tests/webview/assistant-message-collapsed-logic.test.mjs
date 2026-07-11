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
    isBlockHeaderAnchor,
    blockSize = 1,
    isStreamingActive,
    hasCopyableResponseContent,
}) {
    // 1. Agent/model metadata belongs to the AI response block, not every
    // message within it. The shell chooses one visible anchor per block.
    const showAssistantResponseHeader =
        isBlockHeaderAnchor && (hasPrimaryResponseBody || blockSize > 1);

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
            isBlockHeaderAnchor: false,
            isStreamingActive: false,
            hasCopyableResponseContent: false, // No text
        });

        assert.strictEqual(state.showAssistantResponseHeader, false, "Header should be hidden for intermediate steps");
        assert.strictEqual(state.showTimestampInsideBubble, true, "Timestamp should be moved inside the bubble for intermediate steps");
        assert.strictEqual(state.showFooterOutsideBubble, false, "Copy button and external footer should be hidden for intermediate steps");
    });

    it("should not repeat the header on later expanded messages in the same block", () => {
        const state = getCollapsedRenderingState({
            hasPrimaryResponseBody: true,
            isBlockHeaderAnchor: false,
            isStreamingActive: false,
            hasCopyableResponseContent: true, // It has text
        });

        assert.strictEqual(state.showAssistantResponseHeader, false, "Header should not repeat on a non-anchor message");
        assert.strictEqual(state.showTimestampInsideBubble, false, "Timestamp should NOT be inside the bubble because it has text");
        assert.strictEqual(state.showFooterOutsideBubble, true, "Copy button and external footer should be visible because it has text");
    });

    it("should show header on the collapsed block's visible summary card", () => {
        const state = getCollapsedRenderingState({
            hasPrimaryResponseBody: true,
            isBlockHeaderAnchor: true,
            blockSize: 3,
            isStreamingActive: false,
            hasCopyableResponseContent: true,
        });

        assert.strictEqual(state.showAssistantResponseHeader, true, "Header should be visible on the response-block anchor");
        assert.strictEqual(state.showTimestampInsideBubble, false, "Timestamp should NOT be inside the bubble for the final message");
        assert.strictEqual(state.showFooterOutsideBubble, true, "Copy button and external footer should be visible for the final message");
    });

    it("should keep the header on an expanded block's first activity-only card", () => {
        const state = getCollapsedRenderingState({
            hasPrimaryResponseBody: false,
            isBlockHeaderAnchor: true,
            blockSize: 2,
            isStreamingActive: false,
            hasCopyableResponseContent: false,
        });

        assert.strictEqual(state.showAssistantResponseHeader, true, "The response-block anchor should retain its header");
    });
    
    it("should hide footers while streaming is active", () => {
        const state = getCollapsedRenderingState({
            hasPrimaryResponseBody: true,
            isBlockHeaderAnchor: true,
            isStreamingActive: true,
            hasCopyableResponseContent: true,
        });

        assert.strictEqual(state.showTimestampInsideBubble, false);
        assert.strictEqual(state.showFooterOutsideBubble, false);
    });
});
