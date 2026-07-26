import assert from "node:assert/strict";
import { test } from "node:test";
import { stableActivityIdentity } from "../../webview/shared/src/chat/lib/activityIdentity";

test("one read call keeps one identity while SDK lifecycle data is enriched", () => {
  const pending = stableActivityIdentity({
    callID: "call_read_common_config",
    partID: "part_read_common_config",
    messageID: "msg_assistant",
    tool: "read",
    title: "read",
  });
  const running = stableActivityIdentity({
    callID: "call_read_common_config",
    partID: "part_read_common_config",
    messageID: "msg_assistant",
    tool: "read",
    title: "common.config.ts",
    filePath: "/workspace/src/config/common.config.ts",
  });
  const completed = stableActivityIdentity({
    callID: "call_read_common_config",
    partID: "part_read_common_config",
    messageID: "msg_assistant",
    tool: "read_file",
    title: "Read common.config.ts",
    filePath: "/workspace/src/config/common.config.ts",
  });

  assert.equal(pending, "part:part_read_common_config");
  assert.equal(running, pending);
  assert.equal(completed, pending);
});

test("one TodoWrite call keeps one identity across pending, running, and completed snapshots", () => {
  const identities = ["pending", "running", "completed"].map((status) =>
    stableActivityIdentity({
      callID: "call_todo",
      partID: "part_todo",
      messageID: "msg_assistant",
      tool: status === "completed" ? "todowrite" : "tool_call",
      title: status === "completed" ? "7 todos" : "TodoWrite",
    }),
  );

  assert.deepEqual(identities, ["part:part_todo", "part:part_todo", "part:part_todo"]);
  assert.notEqual(
    stableActivityIdentity({ callID: "call_other", tool: "read" }),
    identities[0],
  );
});
