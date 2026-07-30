import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  canonicalActivityActionIdentity,
  stableActivityIdentity,
} from "../../webview/shared/src/chat/lib/activityIdentity";

test("semantic action identity ignores lifecycle timing but preserves meaningful input", () => {
  const firstSnapshot = canonicalActivityActionIdentity("skill_mcp", {
    mcp_name: "playwright",
    tool_name: "browser_close",
    arguments: {},
    time: { start: 100, end: 120 },
  });
  const laterSnapshot = canonicalActivityActionIdentity("skill_mcp", {
    mcp_name: "playwright",
    tool_name: "browser_close",
    arguments: {},
    time: { start: 900, end: 950 },
  });
  const differentAction = canonicalActivityActionIdentity("skill_mcp", {
    mcp_name: "playwright",
    tool_name: "browser_navigate",
    arguments: { url: "https://example.com" },
    time: { start: 900, end: 950 },
  });

  assert.equal(laterSnapshot, firstSnapshot);
  assert.notEqual(differentAction, firstSnapshot);
});

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

test("lifecycle markers without call IDs cannot replace a later activity block", () => {
  // A message ID identifies the assistant turn, not each step within it.
  // Render-time lifecycle identity must therefore use the tape position when
  // the SDK omitted both callID and partID.
  const source = readFileSync(
    new URL("../../webview/shared/src/chat/MessageComponents.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /isLifecycleMarker[\s\S]*?lifecycle:\$\{event\.streamSeq\}/,
    "unidentified lifecycle markers should retain distinct stream positions",
  );
  assert.match(
    source,
    /function activitySnapshotIdentity\(event: DisplayEvent\): string \{[\s\S]*?partType === \"step-start\"[\s\S]*?return \"\";/,
    "lifecycle markers must not be collapsed by the action-text fallback",
  );
});
