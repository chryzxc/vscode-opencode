import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Message, PendingUserMessage } from "./types.ts";
import {
  getPendingUserMessageIdsForClientRequest,
  getRepresentedPendingUserMessageIds,
  getVisiblePendingUserMessages,
  pendingUserMessageToMessage,
} from "./pendingUserMessages.ts";

describe("pendingUserMessages helpers", () => {
  it("keeps a pending message visible until a recent centralized user turn matches it", () => {
    const pending: PendingUserMessage[] = [
      {
        id: "pending-1",
        sessionId: "session-1",
        createdAt: 10_000,
        text: "Ship it",
      },
    ];
    const centralized: Message[] = [
      {
        role: "user",
        content: "Older unrelated text",
        created: 1_000,
      },
    ];

    const visible = getVisiblePendingUserMessages(pending, centralized);

    assert.deepStrictEqual(visible.map((message) => message.id), ["pending-1"]);
  });

  it("reconciles a pending message once the centralized transcript contains the same recent user text", () => {
    const pending: PendingUserMessage[] = [
      {
        id: "pending-1",
        sessionId: "session-1",
        createdAt: 10_000,
        text: "Ship it",
      },
    ];
    const centralized: Message[] = [
      {
        role: "user",
        content: "  ship it  ",
        created: 12_000,
      },
    ];

    assert.deepStrictEqual(getVisiblePendingUserMessages(pending, centralized), []);
    assert.deepStrictEqual(
      getRepresentedPendingUserMessageIds(pending, centralized),
      ["pending-1"],
    );
  });

  it("does not reconcile against an old repeated prompt from earlier history", () => {
    const pending: PendingUserMessage[] = [
      {
        id: "pending-1",
        sessionId: "session-1",
        createdAt: 90_000,
        text: "Ship it",
      },
    ];
    const centralized: Message[] = [
      {
        role: "user",
        content: "Ship it",
        created: 1_000,
      },
    ];

    const visible = getVisiblePendingUserMessages(pending, centralized);

    assert.deepStrictEqual(visible.map((message) => message.id), ["pending-1"]);
  });

  it("converts a pending entry into a renderable user message", () => {
    const pending: PendingUserMessage = {
      id: "pending-1",
      sessionId: "session-1",
      createdAt: 10_000,
      text: "Ship it",
      images: ["data:image/png;base64,abc"],
      interactiveSubmit: true,
    };

    const message = pendingUserMessageToMessage(pending);

    assert.strictEqual(message.role, "user");
    assert.strictEqual(message.content, "Ship it");
    assert.deepStrictEqual(message.images, ["data:image/png;base64,abc"]);
    assert.strictEqual(message.sessionID, "session-1");
    assert.strictEqual(message.created, 10_000);
    assert.strictEqual(message.createdAt, 10_000);
    assert.strictEqual(message.time?.created, 10_000);
    assert.strictEqual(message.info?.createdAt, 10_000);
    assert.strictEqual(message.info?.time?.created, 10_000);
  });

  it("finds optimistic pending ids by client request id", () => {
    const pending: PendingUserMessage[] = [
      {
        id: "pending-1",
        sessionId: "session-1",
        clientRequestId: "req-1",
        createdAt: 10_000,
        text: "Ship it",
      },
      {
        id: "pending-2",
        sessionId: "session-1",
        clientRequestId: "req-2",
        createdAt: 10_001,
        text: "Search it",
      },
    ];

    assert.deepStrictEqual(
      getPendingUserMessageIdsForClientRequest(pending, "req-2"),
      ["pending-2"],
    );
  });

  it("reconciles immediately once the centralized transcript contains the confirmed canonical message id", () => {
    const pending: PendingUserMessage[] = [
      {
        id: "pending-1",
        sessionId: "session-1",
        clientRequestId: "req-1",
        confirmedMessageId: "msg-123",
        confirmedAt: 10_000,
        createdAt: 10_000,
        text: "Ship it",
      },
    ];
    const centralized: Message[] = [
      {
        id: "msg-123",
        role: "user",
        content: "Something else",
        created: 50_000,
      },
    ];

    assert.deepStrictEqual(getVisiblePendingUserMessages(pending, centralized), []);
    assert.deepStrictEqual(
      getRepresentedPendingUserMessageIds(pending, centralized),
      ["pending-1"],
    );
  });

  it("reconciles when the confirmed message id is present in coalesced ids", () => {
    const pending: PendingUserMessage[] = [
      {
        id: "pending-1",
        sessionId: "session-1",
        clientRequestId: "req-1",
        confirmedMessageId: "msg-original",
        confirmedAt: 10_000,
        createdAt: 10_000,
        text: "Ship it",
      },
    ];
    const centralized: Message[] = [
      {
        id: "msg-canonical",
        role: "user",
        content: "Ship it",
        created: 10_100,
        coalescedIds: ["msg-original"],
      } as Message,
    ];

    assert.deepStrictEqual(getVisiblePendingUserMessages(pending, centralized), []);
  });

  it("reconciles against centralized user text after stripping an injected system prompt", () => {
    const pending: PendingUserMessage[] = [
      {
        id: "pending-1",
        sessionId: "session-1",
        createdAt: 10_000,
        text: "where is the summary?",
      },
    ];
    const centralized: Message[] = [
      {
        role: "user",
        content:
          "[search-mode]\nMAXIMIZE SEARCH EFFORT.\n\n---\n\nwhere is the summary?",
        created: 10_050,
      },
    ];

    assert.deepStrictEqual(getVisiblePendingUserMessages(pending, centralized), []);
  });
});
