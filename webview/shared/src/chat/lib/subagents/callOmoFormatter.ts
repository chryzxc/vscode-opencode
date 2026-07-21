import type { ActivityDetail } from "../types";
import type { SubagentDetail, SubagentStatus } from "./types";

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function statusFromActivity(status: "pending" | "done" | "error"): SubagentStatus {
  return status === "done" || status === "error" ? status : "pending";
}

/**
 * Converts a call_omo_agent timeline row into the same detail contract the
 * canonical SubagentDetailModal consumes. The caller should prefer an already
 * tracked detail (which contains the child timeline) and use this only while
 * that detail is still being hydrated.
 */
export function formatCallOmoAgentAsSubagentDetail(input: {
  callID?: string;
  parentSessionId?: string;
  parentMessageId?: string;
  childSessionId?: string;
  startedAt?: number;
  endedAt?: number;
  status: "pending" | "done" | "error";
  activityDetail?: ActivityDetail;
}): SubagentDetail {
  const detail = input.activityDetail;
  const toolInput = detail?.input ?? {};
  const backgroundTaskId =
    stringValue(detail?.backgroundTaskId) ||
    stringValue(detail?.metadata?.taskId) ||
    stringValue(detail?.metadata?.task_id) ||
    stringValue(toolInput.taskId) ||
    stringValue(toolInput.task_id) ||
    undefined;
  const childSessionId =
    input.childSessionId || stringValue(detail?.sessionID) || undefined;
  const latestActivity =
    stringValue(toolInput.description) ||
    stringValue(detail?.summary) ||
    stringValue(detail?.output) ||
    "Background agent launched";
  const id = `call-omo:${backgroundTaskId || childSessionId || input.callID || "unknown"}`;
  const createdAt = input.startedAt || Date.now();

  return {
    id,
    backgroundTaskId,
    parentSessionId: input.parentSessionId || "",
    parentMessageId: input.parentMessageId || "",
    childSessionId,
    agentId: stringValue(toolInput.subagent_type) || stringValue(toolInput.agent) || undefined,
    status: statusFromActivity(input.status),
    latestActivity,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs:
      input.startedAt && input.endedAt
        ? Math.max(0, input.endedAt - input.startedAt)
        : undefined,
    references: [{
      messageID: input.parentMessageId,
      callID: input.callID,
    }],
    rawEvents: [],
    thinkingEvents: [],
    conversationEvents: [],
    progressEvents: [],
    timelineEvents: [{
      key: `${id}:invocation`,
      type: "call_omo_agent",
      label: latestActivity,
      createdAt,
      messageID: input.parentMessageId,
      callID: input.callID,
    }],
  };
}
