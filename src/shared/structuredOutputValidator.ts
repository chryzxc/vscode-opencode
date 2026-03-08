import { structuredOutputSchema } from "./structuredOutputSchema";

export type StructuredOutputValidationResult = {
  valid: boolean;
  errors: string[];
};

const TOP_LEVEL_FIELDS = Object.keys(
  structuredOutputSchema.schema.properties ?? {},
);

const RESPONSE_TYPES = new Set(
  (structuredOutputSchema.schema.properties as { responseType?: { enum?: string[] } })
    ?.responseType?.enum ?? [],
);

const VALID_INTERACTIVE_TYPES = new Set(["question", "confirm", "quick_actions"]);

export function validateStructuredOutput(
  value: unknown,
): StructuredOutputValidationResult {
  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["Structured output is not an object"] };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];

  if (
    typeof record.responseType === "string" &&
    record.responseType.trim().length > 0
  ) {
    if (!RESPONSE_TYPES.has(record.responseType)) {
      errors.push(`Unsupported responseType: ${record.responseType}`);
    }
  }

  if (
    typeof record.message !== "undefined" &&
    typeof record.message !== "string"
  ) {
    errors.push("message must be a string");
  }

  if (
    typeof record.plan !== "undefined" &&
    (!record.plan || typeof record.plan !== "object")
  ) {
    errors.push("plan must be an object");
  }

  if (Array.isArray(record.interactiveEvents)) {
    record.interactiveEvents.forEach((event, index) => {
      if (!event || typeof event !== "object") {
        errors.push(`interactiveEvents[${index}] must be an object`);
        return;
      }
      const eventRecord = event as Record<string, unknown>;
      if (
        typeof eventRecord.type === "string" &&
        !VALID_INTERACTIVE_TYPES.has(eventRecord.type)
      ) {
        errors.push(`interactiveEvents[${index}].type invalid: ${eventRecord.type}`);
      }
    });
  }

  if (Array.isArray(record.subagents)) {
    record.subagents.forEach((subagent, index) => {
      if (!subagent || typeof subagent !== "object") {
        errors.push(`subagents[${index}] must be an object`);
        return;
      }
      const subagentRecord = subagent as Record<string, unknown>;
      if (typeof subagentRecord.id !== "string") {
        errors.push(`subagents[${index}].id must be a string`);
      }
      if (
        typeof subagentRecord.name !== "undefined" &&
        typeof subagentRecord.name !== "string"
      ) {
        errors.push(`subagents[${index}].name must be a string`);
      }
    });
  }

  if (record.responseType === "implementation_plan") {
    const plan = record.plan as Record<string, unknown> | undefined;
    if (!plan || typeof plan.content !== "string") {
      errors.push("implementation_plan requires plan.content string");
    }
  }

  if (record.responseType === "subagents") {
    if (!Array.isArray(record.subagents) || record.subagents.length === 0) {
      errors.push("subagents responseType requires subagents array");
    }
  }

  if (typeof record.subagentsDelta !== "undefined") {
    const delta = record.subagentsDelta as Record<string, unknown> | undefined;
    if (!delta || !Array.isArray(delta.items)) {
      errors.push("subagentsDelta requires items array");
    }
  }

  if (record.responseType === "interactive") {
    if (!Array.isArray(record.interactiveEvents)) {
      errors.push("interactive responseType requires interactiveEvents array");
    }
  }

  if (record.responseType === "progress_update") {
    if (!Array.isArray(record.progressUpdates)) {
      errors.push("progress_update responseType requires progressUpdates array");
    }
  }

  return { valid: errors.length === 0, errors };
}

export function sanitizeStructuredOutput(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  TOP_LEVEL_FIELDS.forEach((key) => {
    if (typeof value[key] !== "undefined") {
      sanitized[key] = value[key];
    }
  });
  return sanitized;
}
