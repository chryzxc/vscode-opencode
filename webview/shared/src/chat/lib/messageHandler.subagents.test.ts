import test from "node:test";
import assert from "node:assert/strict";

import { applyStructuredSubagentPayload } from "./messageHandler";
import { appReducer, initialState, type AppAction } from "./store";
import type { AppState } from "./types";

test("structured subagent payloads populate the inline-card state", () => {
  let state: AppState = {
    ...initialState,
    currentSessionId: "ses-parent",
  };
  const dispatch = (action: AppAction) => {
    state = appReducer(state, action);
  };

  applyStructuredSubagentPayload(
    dispatch,
    () => state,
    {
      responseType: "subagents",
      subagents: [
        {
          id: "bg_research",
          backgroundTaskId: "bg_research",
          agentRole: "explorer",
          status: "running",
          latestActivity: "Searching the codebase",
        },
      ],
    },
    "msg-parent",
  );

  assert.equal(state.subagentsByParentMessageId["msg-parent"]?.length, 1);
  const subagent = state.subagentsByParentMessageId["msg-parent"]?.[0];
  assert.equal(subagent?.id, "bg_research");
  assert.equal(subagent?.backgroundTaskId, "bg_research");
  assert.equal(subagent?.parentSessionId, "ses-parent");
  assert.equal(subagent?.parentMessageId, "msg-parent");
  assert.equal(subagent?.agentRole, "explorer");
  assert.equal(subagent?.status, "running");
  assert.equal(subagent?.latestActivity, "Searching the codebase");
});
