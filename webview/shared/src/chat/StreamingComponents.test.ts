import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { StreamingState } from "./lib/types";
import {
  hasMatchingTranscriptContent,
  shouldShowStreamingCard,
  suppressDuplicateStreamingContent,
} from "./lib/streamingCardVisibility";

function streamingState(
  overrides: Partial<StreamingState> = {},
): StreamingState {
  return {
    messageId: "msg-live",
    content: "",
    hasRenderableContent: false,
    reasoning: "",
    reasoningEvents: [],
    steps: [],
    progressEvents: [],
    edits: [],
    isActive: true,
    ...overrides,
  };
}

describe("shouldShowStreamingCard live event ownership", () => {
  it("bridges ownership when phase IDs change but the current response is already rendered", () => {
    assert.strictEqual(
      hasMatchingTranscriptContent(
        streamingState({ content: "The response is complete.", hasRenderableContent: true }),
        ["The response is complete."],
      ),
      true,
    );
    assert.strictEqual(
      hasMatchingTranscriptContent(
        streamingState({ content: "A newer response.", hasRenderableContent: true }),
        ["An older response."],
      ),
      false,
    );
  });

  it("keeps live reasoning visible when the transcript already has an assistant placeholder", () => {
    const visible = shouldShowStreamingCard({
      streaming: streamingState({
        reasoningEvents: [
          {
            text: "Inspecting the event path",
            createdAt: 1,
            partID: "part-reasoning",
            messageID: "msg-live",
          },
        ],
      }),
      hasTranscriptAssistantForCurrentTurn: true,
      transcriptAssistantMessageIds: ["msg-live"],
    });

    assert.strictEqual(visible, true);
  });

  it("keeps live tool progress visible when its message ID already exists in the transcript", () => {
    const visible = shouldShowStreamingCard({
      streaming: streamingState({
        progressEvents: [
          {
            id: "tool-live",
            title: "Reading file",
            status: "running",
          },
        ],
      }),
      transcriptAssistantMessageIds: ["msg-live"],
    });

    assert.strictEqual(visible, true);
  });

  it("hands the turn to the matching transcript after streaming completes", () => {
    const visible = shouldShowStreamingCard({
      streaming: streamingState({
        isActive: false,
        hasAssistantFinishSignal: true,
        reasoningEvents: [
          {
            text: "Finished reasoning",
            createdAt: 1,
            messageID: "msg-live",
          },
        ],
      }),
      hasTranscriptAssistantForCurrentTurn: true,
      transcriptAssistantMessageIds: ["msg-live"],
    });

    assert.strictEqual(visible, false);
  });

  it("hides an inactive activity card after its assistant response is canonicalized", () => {
    const visible = shouldShowStreamingCard({
      streaming: streamingState({
        isActive: false,
        progressEvents: [{
          id: "step-finish",
          title: "Finishing step",
          status: "done",
        }],
      }),
      transcriptAssistantMessageIds: ["msg-live"],
      hasTranscriptAssistantForCurrentTurn: true,
    });

    assert.strictEqual(visible, false);
  });

  it("keeps an inactive live activity card visible until the transcript has response content", () => {
    const visible = shouldShowStreamingCard({
      streaming: streamingState({
        isActive: false,
        progressEvents: [
          {
            id: "step-finish",
            title: "Finishing step",
            status: "done",
          },
        ],
      }),
      transcriptAssistantMessageIds: ["msg-live"],
      hasTranscriptAssistantForCurrentTurn: false,
    });

    assert.strictEqual(visible, true);
  });

  it("keeps a completed response phase visible while the assistant turn has not finished", () => {
    const visible = shouldShowStreamingCard({
      streaming: streamingState({
        isActive: true,
        content: "First response message",
        hasRenderableContent: true,
      }),
      transcriptAssistantMessageIds: ["msg-live"],
      hasTranscriptAssistantForCurrentTurn: true,
    });

    assert.strictEqual(visible, true);
  });

  it("does not mount an empty active card before the first live event", () => {
    assert.strictEqual(
      shouldShowStreamingCard({
        streaming: streamingState(),
        transcriptAssistantMessageIds: ["msg-live"],
      }),
      false,
    );
  });

  it("removes transcript-owned text from a live phase overlay while preserving activity", () => {
    const result = suppressDuplicateStreamingContent(
      streamingState({
        content: "I’m tracing the battle loop, player/enemy actions.",
        hasRenderableContent: true,
        reasoningEvents: [{ text: "Thinking", createdAt: 1 }],
      }),
      [" I’m tracing the battle loop,   player/enemy actions. "],
    );

    assert.strictEqual(result.content, "");
    assert.strictEqual(result.hasRenderableContent, false);
    assert.deepStrictEqual(result.reasoningEvents, [{ text: "Thinking", createdAt: 1 }]);
  });

  it("removes a live partial response when the transcript already has its completed text", () => {
    const result = suppressDuplicateStreamingContent(
      streamingState({
        content: "I’ll trace where the battle screen is launched",
        hasRenderableContent: true,
        progressEvents: [{ id: "tool-live", title: "Read BattleScreen", status: "done" }],
      }),
      ["I’ll trace where the battle screen is launched and how the AI loop is wired."],
    );

    assert.strictEqual(result.content, "");
    assert.strictEqual(result.hasRenderableContent, false);
    assert.deepStrictEqual(result.progressEvents, [
      { id: "tool-live", title: "Read BattleScreen", status: "done" },
    ]);
  });
});
