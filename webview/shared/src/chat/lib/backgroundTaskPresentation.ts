import {
  getCentralizedAssistantContentChunksFromRawSdkEventPayloads,
  getCentralizedEventPart,
  normalizeCentralizedEventPayloads,
} from "./messageHandler";
import {
  backgroundTaskIdFromReminderText,
  findBackgroundTaskReminderMessageByTaskId,
  getBackgroundTaskChildAssistantMessages,
  parseBackgroundTaskReminderText,
} from "./backgroundTaskOwnership";

import type {
  ActivityDetail,
  Message,
  SubagentConversationEvent,
} from "./types";

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function firstNonEmptyNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeComparableText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function thoughtItemsFromRawEventPayloads(rawPayloads: unknown[]): Array<{
  text: string;
  startedAt?: number;
  endedAt?: number;
}> {
  const items: Array<{
    text: string;
    startedAt?: number;
    endedAt?: number;
  }> = [];

  for (const payload of normalizeCentralizedEventPayloads(rawPayloads)) {
    const part = getCentralizedEventPart(payload);
    const partType = firstNonEmptyString(part?.type)?.toLowerCase();
    if (partType !== "reasoning") {
      continue;
    }
    const text = firstNonEmptyString(part?.text, part?.content, part?.message);
    if (!text) {
      continue;
    }
    const time = asRecord(part?.time);
    items.push({
      text,
      startedAt: typeof time?.start === "number" ? time.start : undefined,
      endedAt: typeof time?.end === "number" ? time.end : undefined,
    });
  }

  return items;
}

export type BackgroundTaskPresentation = {
  reminderMessage?: Message;
  reminderText: string;
  backgroundTaskId?: string;
  assistantConversationEvents: SubagentConversationEvent[];
  assistantUpdateText?: string;
  activityDetail?: ActivityDetail;
};

export function buildBackgroundTaskPresentation(params: {
  taskId?: string;
  message?: Message;
  messages?: Message[];
}): BackgroundTaskPresentation {
  const reminderMessage =
    params.message ||
    findBackgroundTaskReminderMessageByTaskId(params.messages, params.taskId);
  const reminderText = firstNonEmptyString(
    reminderMessage?.content,
    reminderMessage?.text,
    reminderMessage?.info?.content,
    reminderMessage?.info?.text,
  ) ?? "";
  const parsedReminder = parseBackgroundTaskReminderText(reminderText);
  const backgroundTaskId =
    params.taskId ||
    parsedReminder.taskId ||
    backgroundTaskIdFromReminderText(reminderText);
  const reminderMessageId = firstNonEmptyString(
    reminderMessage?.info?.id,
    reminderMessage?.id,
    reminderMessage?.messageId,
  );
  const childAssistantMessages = getBackgroundTaskChildAssistantMessages(
    params.messages,
    reminderMessageId,
  );

  const assistantConversationEvents: SubagentConversationEvent[] = [];
  const seen = new Set<string>();
  let sequence = 0;
  const pushEvent = (
    kind: SubagentConversationEvent["kind"],
    text: string,
    createdAt: number,
    idPrefix: string,
  ) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const fingerprint = `${kind}:${normalizeComparableText(trimmed)}`;
    if (!fingerprint || seen.has(fingerprint)) {
      return;
    }
    seen.add(fingerprint);
    assistantConversationEvents.push({
      id: `${idPrefix}-${sequence}`,
      role: "assistant",
      kind,
      text: trimmed,
      createdAt,
    });
    sequence += 1;
  };

  childAssistantMessages.forEach((childMessage, childIndex) => {
    const rawPayloads = normalizeCentralizedEventPayloads(
      Array.isArray(childMessage.rawSdkEventPayloads) ? childMessage.rawSdkEventPayloads : [],
    );
    const fallbackCreatedAt =
      firstNonEmptyNumber(
        childMessage.created,
        childMessage.info?.created,
        (asRecord(childMessage.info?.time)?.created as number | undefined),
        Date.now() + childIndex,
      ) ?? Date.now() + childIndex;

    thoughtItemsFromRawEventPayloads(rawPayloads).forEach((item, itemIndex) => {
      pushEvent(
        "reasoning",
        item.text,
        item.startedAt ?? item.endedAt ?? fallbackCreatedAt + itemIndex,
        "background-reminder-reasoning",
      );
    });

    getCentralizedAssistantContentChunksFromRawSdkEventPayloads(rawPayloads).forEach(
      (chunk, chunkIndex) => {
        pushEvent(
          "message",
          chunk,
          fallbackCreatedAt + 100 + chunkIndex,
          "background-reminder-message",
        );
      },
    );
  });

  const assistantUpdateText = assistantConversationEvents
    .map((event) => event.text.trim())
    .filter(Boolean)
    .join("\n\n") || undefined;

  let matchedDetail: ActivityDetail | undefined;
  childAssistantMessages.some((childMessage) => {
    const rawPayloads = normalizeCentralizedEventPayloads(
      Array.isArray(childMessage.rawSdkEventPayloads) ? childMessage.rawSdkEventPayloads : [],
    );
    for (const payload of rawPayloads) {
      const part = getCentralizedEventPart(payload);
      const tool = firstNonEmptyString(part?.tool, part?.name)?.trim().toLowerCase();
      if (tool !== "background_output") {
        continue;
      }

      const state = asRecord(part?.state);
      const input = asRecord(state?.input);
      const taskId = firstNonEmptyString(
        input?.task_id,
        input?.taskId,
        backgroundTaskId,
      );
      if (backgroundTaskId && taskId && taskId !== backgroundTaskId) {
        continue;
      }

      const time = asRecord(state?.time);
      matchedDetail = {
        tool: "background_output",
        summary: parsedReminder.description || "Background task completed",
        output:
          firstNonEmptyString(
            state?.output,
            part?.output,
            parsedReminder.description,
            parsedReminder.statusLine,
          ) || "Background task completed",
        input: {
          task_id: taskId || backgroundTaskId,
          description: parsedReminder.description,
          duration: parsedReminder.duration,
        },
        metadata: {
          ...(asRecord(state?.metadata) ?? {}),
          task_id: taskId || backgroundTaskId || "",
        },
        backgroundTaskId: taskId || backgroundTaskId,
        sessionID: firstNonEmptyString(
          childMessage.info?.sessionID,
          childMessage.info?.sessionId,
          childMessage.sessionID,
        ),
        startedAt: typeof time?.start === "number" ? time.start : undefined,
        endedAt: typeof time?.end === "number" ? time.end : undefined,
      };
      return true;
    }
    return false;
  });

  const activityDetail = matchedDetail || (
    reminderMessage
      ? {
          tool: "background_output",
          summary: parsedReminder.description || "Background task completed",
          output:
            parsedReminder.description ||
            parsedReminder.statusLine ||
            "Background task completed",
          input: {
            task_id: backgroundTaskId,
            description: parsedReminder.description,
            duration: parsedReminder.duration,
          },
          metadata: {
            task_id: backgroundTaskId || "",
          },
          backgroundTaskId,
          sessionID: firstNonEmptyString(
            reminderMessage.info?.sessionID,
            reminderMessage.info?.sessionId,
            reminderMessage.sessionID,
          ),
        } satisfies ActivityDetail
      : undefined
  );

  return {
    reminderMessage,
    reminderText,
    backgroundTaskId,
    assistantConversationEvents,
    assistantUpdateText,
    activityDetail,
  };
}
