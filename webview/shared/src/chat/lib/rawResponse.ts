import type {
  InteractiveChoice,
  InteractiveEvent,
  OpenCodeRawResponse,
  OpenCodeRawResponsePart,
} from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

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

function normalizeRawResponse(rawResponse: OpenCodeRawResponse | string): Record<string, unknown> | null {
  if (typeof rawResponse !== "string") {
    return asRecord(rawResponse);
  }

  const trimmed = rawResponse.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function recordAtPath(
  root: Record<string, unknown> | null,
  path: string[],
): Record<string, unknown> | null {
  let current: unknown = root;
  for (const segment of path) {
    const next = asRecord(current);
    if (!next) {
      return null;
    }
    current = next[segment];
  }
  return asRecord(current);
}

function firstRecordAtPaths(
  root: Record<string, unknown> | null,
  paths: string[][],
): Record<string, unknown> | null {
  for (const path of paths) {
    const found = recordAtPath(root, path);
    if (found) {
      return found;
    }
  }
  return null;
}

function finalTextBeforeStepFinish(parts?: Array<OpenCodeRawResponsePart | Record<string, unknown> | null | undefined>): string {
  if (!Array.isArray(parts) || parts.length === 0) {
    return "";
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const partRec = asRecord(parts[index]);
    if (!partRec) {
      continue;
    }

    const partType = firstNonEmptyString(
      typeof partRec.type === "string" ? partRec.type : undefined,
      typeof partRec.partType === "string" ? partRec.partType : undefined,
    )?.toLowerCase();

    if (partType === "step-finish") {
      continue;
    }

    const text = firstNonEmptyString(
      typeof partRec.message === "string" ? partRec.message : undefined,
      typeof partRec.text === "string" ? partRec.text : undefined,
      typeof partRec.content === "string" ? partRec.content : undefined,
    );
    if (text) {
      return text;
    }
  }

  return "";
}

function normalizeInteractiveChoices(raw: unknown): InteractiveChoice[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item, index) => {
      if (typeof item === "string") {
        const label = item.trim();
        return label ? { id: `choice-${index}`, label, value: label } : null;
      }
      const rec = asRecord(item);
      if (!rec) {
        return null;
      }
      const label = firstNonEmptyString(rec.label, rec.value, rec.title, rec.text);
      if (!label) {
        return null;
      }
      return {
        id: firstNonEmptyString(rec.id) || `choice-${index}`,
        label,
        value: firstNonEmptyString(rec.value) || undefined,
        description: firstNonEmptyString(rec.description, rec.detail) || undefined,
      };
    })
    .filter((item): item is InteractiveChoice => !!item);
}

function interactiveEventFromQuestionRecord(
  record: Record<string, unknown> | null,
  fallbackId: string,
): InteractiveEvent | null {
  if (!record) {
    return null;
  }
  const prompt = firstNonEmptyString(
    record.displayPrompt,
    record.question,
    record.message,
    record.content,
    record.title,
    record.prompt,
  );
  if (!prompt) {
    return null;
  }

  const type = firstNonEmptyString(record.type)?.toLowerCase() || "question";
  if (type === "confirm") {
    return {
      type: "confirm",
      id: firstNonEmptyString(record.id) || fallbackId,
      title: firstNonEmptyString(record.title) || undefined,
      question: prompt,
    };
  }

  if (type === "quick_actions" || type === "quick-actions") {
    const actions = normalizeInteractiveChoices(record.actions ?? record.options ?? record.choices);
    return actions.length > 0
      ? {
        type: "quick_actions",
        id: firstNonEmptyString(record.id) || fallbackId,
        title: prompt,
        actions,
      }
      : null;
  }

  const options = normalizeInteractiveChoices(record.options ?? record.choices ?? record.actions);
  const allowCustomInput = record.allowCustomInput === true;
  if (options.length < 2 && !allowCustomInput) {
    return null;
  }

  return {
    type: "question",
    id: firstNonEmptyString(record.id) || fallbackId,
    title: firstNonEmptyString(record.title) || undefined,
    question: prompt,
    options,
    multiSelect: record.multiSelect === true,
    allowCustomInput,
  };
}

function interactiveEventsFromStructuredQuestionRecord(
  record: Record<string, unknown> | null | undefined,
  fallbackId: string,
): InteractiveEvent[] {
  if (!record) {
    return [];
  }

  const questions = Array.isArray(record.questions)
    ? record.questions
    : Array.isArray(record.items)
      ? record.items
      : Array.isArray(record.prompts)
        ? record.prompts
        : Array.isArray(record.events)
          ? record.events
          : null;

  const entries = Array.isArray(questions) && questions.length > 0
    ? questions
    : [record.question ?? record];

  return entries
    .map((entry, index) => interactiveEventFromQuestionRecord(asRecord(entry), `${fallbackId}-${index}`))
    .filter((entry): entry is InteractiveEvent => !!entry);
}

function interactiveEventsFromToolParts(
  parts: Array<OpenCodeRawResponsePart | Record<string, unknown> | null | undefined> | undefined,
  fallbackId: string,
): InteractiveEvent[] {
  if (!Array.isArray(parts) || parts.length === 0) {
    return [];
  }

  for (const part of parts) {
    const partRec = asRecord(part);
    if (!partRec) {
      continue;
    }
    const toolName = firstNonEmptyString(partRec.tool, partRec.name)?.toLowerCase();
    if (toolName !== "structuredoutput" && toolName !== "structured_output") {
      continue;
    }

    const state = asRecord(partRec.state);
    const input = asRecord(state?.input) || asRecord(partRec.input) || asRecord(partRec.arguments);
    if (!input) {
      continue;
    }

    const questionRecord =
      asRecord(input.question) ||
      asRecord(input.questions?.[0]) ||
      asRecord(input.prompt) ||
      asRecord(input.message) ||
      asRecord(input);

    const responseType = firstNonEmptyString(
      input.responseType,
      input.type,
      partRec.responseType,
    )?.toLowerCase();

    const question = questionRecord ?? (responseType === "question" ? input : null);
    if (!question) {
      continue;
    }

    const events = interactiveEventsFromStructuredQuestionRecord(
      {
        ...input,
        ...question,
        type: firstNonEmptyString(question.type, input.type, responseType) || "question",
      },
      `${fallbackId}-${firstNonEmptyString(partRec.id, partRec.callID, partRec.callId) || "tool"}`,
    );
    if (events.length > 0) {
      return events;
    }
  }

  return [];
}

function rawSdkEventPartRecord(
  payload: unknown,
): {
  event: Record<string, unknown>;
  properties: Record<string, unknown> | null;
  part: Record<string, unknown> | null;
} | null {
  const event = asRecord(payload);
  if (!event) {
    return null;
  }
  const properties = asRecord(event.properties);
  const part = asRecord(properties?.part) ?? asRecord(event.part);
  return { event, properties, part };
}

function rawSdkEventPartRecords(
  rawSdkEventPayloads?: unknown[],
): Array<Record<string, unknown>> {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return [];
  }

  const parts: Array<Record<string, unknown>> = [];
  for (const payload of rawSdkEventPayloads) {
    const rec = rawSdkEventPartRecord(payload);
    if (!rec?.part) {
      continue;
    }
    parts.push(rec.part);
  }
  return parts;
}

/**
 * Extract the final assistant-facing response from the raw SDK payload.
 *
 * Priority:
 * 1. `rawResponse.info.structured.message` or the equivalent nested sync payload
 * 2. Last text-bearing part before the terminal `step-finish`
 */
export function getFinalAssistantResponseText(
  rawResponse?: OpenCodeRawResponse | string,
): string {
  if (!rawResponse) {
    return "";
  }

  const normalized = normalizeRawResponse(rawResponse);
  if (!normalized) {
    return "";
  }

  const rawInfoRec = firstRecordAtPaths(normalized, [
    ["info"],
    ["payload", "syncEvent", "data", "info"],
    ["payload", "data", "info"],
    ["data", "info"],
  ]);
  const structured = asRecord(rawInfoRec?.structured);
  const structuredMessage = firstNonEmptyString(
    typeof structured?.message === "string" ? structured.message : undefined,
    typeof structured?.content === "string" ? structured.content : undefined,
  );
  if (structuredMessage) {
    return structuredMessage;
  }

  const partsBody = finalTextBeforeStepFinish(
    Array.isArray(normalized.parts) ? normalized.parts : [],
  );
  if (partsBody) {
    return partsBody;
  }
  return "";
}

export function getFinalAssistantResponseTextFromRawSdkEventPayloads(
  rawSdkEventPayloads?: unknown[],
): string {
  const parts = rawSdkEventPartRecords(rawSdkEventPayloads);
  if (parts.length === 0) {
    return "";
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const partRec = asRecord(parts[index]);
    if (!partRec) {
      continue;
    }

    const partType = firstNonEmptyString(
      typeof partRec.type === "string" ? partRec.type : undefined,
      typeof partRec.partType === "string" ? partRec.partType : undefined,
    )?.toLowerCase();
    if (partType === "step-finish") {
      continue;
    }

    const text = firstNonEmptyString(
      typeof partRec.message === "string" ? partRec.message : undefined,
      typeof partRec.text === "string" ? partRec.text : undefined,
      typeof partRec.content === "string" ? partRec.content : undefined,
    );
    if (text) {
      return text;
    }
  }

  return "";
}

export function getInteractiveEventsFromRawResponse(
  rawResponse?: OpenCodeRawResponse | string,
): InteractiveEvent[] {
  if (!rawResponse) {
    return [];
  }

  const normalized = normalizeRawResponse(rawResponse);
  if (!normalized) {
    return [];
  }

  const rawInfoRec = firstRecordAtPaths(normalized, [
    ["info"],
    ["payload", "syncEvent", "data", "info"],
    ["payload", "data", "info"],
    ["data", "info"],
  ]);

  const rawPartEvents = interactiveEventsFromToolParts(
    Array.isArray(normalized.parts) ? normalized.parts : undefined,
    firstNonEmptyString(rawInfoRec?.id, rawInfoRec?.parentID, normalized.id) || `question-${Date.now()}`,
  );
  if (rawPartEvents.length > 0) {
    return rawPartEvents;
  }

  const structured =
    firstRecordAtPaths(normalized, [
      ["info", "structured"],
      ["info", "structuredOutput"],
      ["info", "structured_output"],
      ["structured"],
      ["structuredOutput"],
      ["structured_output"],
    ]) ||
    firstRecordAtPaths(rawInfoRec, [["structured"], ["structuredOutput"], ["structured_output"]]);

  const responseType = firstNonEmptyString(
    rawInfoRec?.responseType,
    structured?.responseType,
    normalized.responseType,
  )?.toLowerCase();

  const questionCandidate =
    firstRecordAtPaths(structured, [["question"]]) ||
    firstRecordAtPaths(rawInfoRec, [["question"]]) ||
    firstRecordAtPaths(normalized, [["question"]]);

  const hasQuestionLikePayload =
    responseType === "question" ||
    !!questionCandidate ||
    Array.isArray((structured as Record<string, unknown> | null)?.interactiveEvents);
  if (!hasQuestionLikePayload) {
    return [];
  }

  const structuredEvents = interactiveEventsFromStructuredQuestionRecord(
    structured,
    firstNonEmptyString(rawInfoRec?.id, rawInfoRec?.parentID, normalized.id) || `question-${Date.now()}`,
  );
  if (structuredEvents.length > 0) {
    return structuredEvents;
  }

  const fallbackEvent = interactiveEventFromQuestionRecord(
    asRecord(questionCandidate),
    firstNonEmptyString(rawInfoRec?.id, rawInfoRec?.parentID, normalized.id) || `question-${Date.now()}`,
  );
  return fallbackEvent ? [fallbackEvent] : [];
}

export function getInteractiveEventsFromRawSdkEventPayloads(
  rawSdkEventPayloads?: unknown[],
): InteractiveEvent[] {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return [];
  }

  for (let index = rawSdkEventPayloads.length - 1; index >= 0; index -= 1) {
    const rec = rawSdkEventPartRecord(rawSdkEventPayloads[index]);
    if (!rec?.part) {
      continue;
    }

    const partRec = rec.part;
    const toolName = firstNonEmptyString(partRec.tool, partRec.name)?.toLowerCase();
    if (toolName === "structuredoutput" || toolName === "structured_output") {
      const state = asRecord(partRec.state);
      const input = asRecord(state?.input) || asRecord(partRec.input) || asRecord(partRec.arguments);
      if (input) {
        const questionRecord =
          asRecord(input.question) ||
          asRecord(input.questions?.[0]) ||
          asRecord(input.prompt) ||
          asRecord(input.message) ||
          asRecord(input);
        const responseType = firstNonEmptyString(
          input.responseType,
          input.type,
          partRec.responseType,
        )?.toLowerCase();
        const question = questionRecord ?? (responseType === "question" ? input : null);
        if (question) {
          const events = interactiveEventsFromStructuredQuestionRecord(
            {
              ...input,
              ...question,
              type: firstNonEmptyString(question.type, input.type, responseType) || "question",
            },
            `${firstNonEmptyString(partRec.id, partRec.callID, partRec.callId, rec.event.id) || "question"}`,
          );
          if (events.length > 0) {
            return events;
          }
        }
      }
    }
  }

  return [];
}
