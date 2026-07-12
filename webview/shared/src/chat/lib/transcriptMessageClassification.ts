import {
  getBackgroundTaskReminderTaskId,
  hasBackgroundTaskLaunchForTaskId,
  isBackgroundTaskChildAssistantMessage,
  isBackgroundTaskReminderMessage,
  isCrossSessionSubagentMessage,
  isSubagentInitiatorMessage,
} from "./backgroundTaskOwnership";

import type { Message } from "./types";

export type TranscriptMessageRenderKind =
  | "user"
  | "assistant"
  | "system"
  | "permission"
  | "background-task-reminder"
  | "hidden";

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/** Server-authored mode/context directives use a user transport role. */
export function isExplicitSystemTransportText(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return (
    /^\[[a-z][a-z0-9_\- ]*\]/i.test(trimmed) ||
    /^<[a-z][a-z0-9_\-]*>/i.test(trimmed) ||
    /^<!--\s*[a-z][a-z0-9_\-]*/i.test(trimmed)
  );
}

/**
 * The single ownership/render-kind policy for centralized transcript messages.
 * Transport normalization and ordering remain separate concerns; they must not
 * duplicate these visibility or role rules.
 */
export function classifyCentralizedTranscriptMessage(params: {
  message: Message;
  rawSdkEventPayloads: unknown[];
  messages: Message[];
}): TranscriptMessageRenderKind {
  const { message, rawSdkEventPayloads, messages } = params;
  const role = firstNonEmptyString(message.role, message.info?.role)?.toLowerCase() ?? "user";
  const text = firstNonEmptyString(
    message.content,
    message.text,
    message.info?.content,
    message.info?.text,
  ) ?? "";

  // This must be the first ownership check. A forwarded child event may carry
  // a normal assistant role and valid text, so role-based rendering would turn
  // a subagent step/conversation entry into a duplicate main-chat AI bubble.
  // Returning `hidden` affects only this projection; the raw centralized event
  // remains available to subagent extraction and the detail modal.
  if (isCrossSessionSubagentMessage({ message, rawSdkEventPayloads })) {
    return "hidden";
  }

  if (isSubagentInitiatorMessage({ message, rawSdkEventPayloads })) {
    return "hidden";
  }

  if (isBackgroundTaskChildAssistantMessage({ message, rawSdkEventPayloads, messages })) {
    return "hidden";
  }

  if (isBackgroundTaskReminderMessage(message)) {
    const backgroundTaskId = getBackgroundTaskReminderTaskId(message);
    return hasBackgroundTaskLaunchForTaskId(rawSdkEventPayloads, backgroundTaskId)
      ? "hidden"
      : "background-task-reminder";
  }

  if (role === "system") {
    return text.length > 0 ? "system" : "hidden";
  }

  if ((message as Record<string, unknown>).type === "permission") {
    return "permission";
  }

  return role === "user" ? "user" : "assistant";
}
