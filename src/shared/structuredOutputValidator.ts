import { structuredOutputSchema } from "./structuredOutputSchema";

export type StructuredOutputValidationResult = {
  valid: boolean;
  errors: string[];
};

const TOP_LEVEL_FIELDS = Object.keys(
  structuredOutputSchema.schema.properties ?? {},
);
const LEGACY_COMPAT_TOP_LEVEL_FIELDS = new Set(["interactiveEvents"]);

const RESPONSE_TYPES = new Set(
  (structuredOutputSchema.schema.properties as { responseType?: { enum?: string[] } })
    ?.responseType?.enum ?? [],
);

const VALID_INTERACTIVE_TYPES = new Set([
  "question",
  "confirm",
  "quick_actions",
  "message",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function isQualifiedMarkdownPath(value: string): boolean {
  const candidate = value.trim();
  if (!candidate || !/\.md$/i.test(candidate)) {
    return false;
  }

  return (
    /^[a-zA-Z]:[\\/]/.test(candidate) ||
    candidate.startsWith("/") ||
    candidate.startsWith("\\\\") ||
    candidate.startsWith("./") ||
    candidate.startsWith("../") ||
    candidate.startsWith(".\\") ||
    candidate.startsWith("..\\") ||
    candidate.includes("/") ||
    candidate.includes("\\")
  );
}

export function validateStructuredOutput(
  value: unknown,
): StructuredOutputValidationResult {
  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["Structured output is not an object"] };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  const unknownTopLevelFields = Object.keys(record).filter(
    (key) =>
      !TOP_LEVEL_FIELDS.includes(key) &&
      !LEGACY_COMPAT_TOP_LEVEL_FIELDS.has(key),
  );
  if (unknownTopLevelFields.length > 0) {
    errors.push(
      `Unsupported top-level fields: ${unknownTopLevelFields.join(", ")}`,
    );
  }
  const responseType =
    typeof record.responseType === "string" && record.responseType.trim().length > 0
      ? record.responseType
      : "";

  if (!responseType) {
    errors.push("responseType is required and must be a string");
  }

  if (responseType) {
    if (!RESPONSE_TYPES.has(responseType)) {
      errors.push(`Unsupported responseType: ${responseType}`);
    }
  }

  if (
    typeof record.assistantMessage !== "undefined" &&
    typeof record.assistantMessage !== "string"
  ) {
    errors.push("assistantMessage must be a string");
  }

  if (
    typeof record.message !== "undefined" &&
    typeof record.message !== "string"
  ) {
    errors.push("message must be a string");
  }

  if (typeof record.reasoning !== "undefined" && !Array.isArray(record.reasoning)) {
    errors.push("reasoning must be an array of strings");
  } else if (Array.isArray(record.reasoning)) {
    const invalidReasoningItem = record.reasoning.some(
      (item) => typeof item !== "string",
    );
    if (invalidReasoningItem) {
      errors.push("reasoning must only contain strings");
    }
  }

  if (
    typeof record.plan !== "undefined" &&
    (!record.plan || typeof record.plan !== "object")
  ) {
    errors.push("plan must be an object");
  }

  if (typeof record.progressUpdates !== "undefined") {
    if (!Array.isArray(record.progressUpdates)) {
      errors.push("progressUpdates must be an array");
    } else {
      const invalidProgressUpdate = record.progressUpdates.some((item) => {
        const update = asRecord(item);
        if (!update) return true;
        const title = isNonEmptyString(update.title) || isNonEmptyString(update.message);
        return !title;
      });
      if (invalidProgressUpdate) {
        errors.push(
          "progressUpdates must only contain objects with non-empty title/message",
        );
      }
    }
  }

  if (typeof record.error !== "undefined") {
    const errorRecord = asRecord(record.error);
    if (!errorRecord) {
      errors.push("error must be an object");
    } else {
      if (
        typeof errorRecord.message !== "undefined" &&
        typeof errorRecord.message !== "string"
      ) {
        errors.push("error.message must be a string");
      }
      if (
        typeof errorRecord.code !== "undefined" &&
        typeof errorRecord.code !== "string"
      ) {
        errors.push("error.code must be a string");
      }
      if (
        typeof errorRecord.details !== "undefined" &&
        typeof errorRecord.details !== "string"
      ) {
        errors.push("error.details must be a string");
      }
      if (
        typeof errorRecord.retryable !== "undefined" &&
        typeof errorRecord.retryable !== "boolean"
      ) {
        errors.push("error.retryable must be a boolean");
      }
    }
  }

  let hasCompatibleInteractivePayload = false;
  if (typeof record.interactiveEvents !== "undefined") {
    if (!Array.isArray(record.interactiveEvents)) {
      errors.push("interactiveEvents must be an array");
    } else {
      record.interactiveEvents.forEach((entry, index) => {
        const eventRecord = asRecord(entry);
        if (!eventRecord) {
          errors.push(`interactiveEvents[${index}] must be an object`);
          return;
        }
        const eventType = typeof eventRecord.type === "string"
          ? eventRecord.type
          : "";
        if (eventType && !VALID_INTERACTIVE_TYPES.has(eventType)) {
          errors.push(`interactiveEvents[${index}].type invalid: ${eventType}`);
          return;
        }
        if (!eventType) {
          return;
        }

        hasCompatibleInteractivePayload = true;

        if (eventType === "question") {
          if (!isNonEmptyString(eventRecord.question)) {
            errors.push(
              `interactiveEvents[${index}] question event requires question text`,
            );
          }
          const allowCustomInput = eventRecord.allowCustomInput === true;
          const options = Array.isArray(eventRecord.options)
            ? eventRecord.options
            : [];
          const validOptionCount = options.filter((option) => {
            if (!option || typeof option !== "object") {
              return false;
            }
            const optionRecord = option as Record<string, unknown>;
            return (
              isNonEmptyString(optionRecord.label) ||
              isNonEmptyString(optionRecord.value)
            );
          }).length;
          if (!allowCustomInput && validOptionCount < 2) {
            errors.push(
              `interactiveEvents[${index}] question interactive event requires at least two options`,
            );
          }
        }

        if (eventType === "confirm" && !isNonEmptyString(eventRecord.question)) {
          errors.push(
            `interactiveEvents[${index}] confirm event requires question text`,
          );
        }

        if (eventType === "quick_actions") {
          const actions = Array.isArray(eventRecord.actions)
            ? eventRecord.actions
            : [];
          if (actions.length === 0) {
            errors.push(
              `interactiveEvents[${index}] quick_actions event requires actions array`,
            );
          }
        }

        if (eventType === "message") {
          const hasMessageText =
            isNonEmptyString(eventRecord.message) ||
            isNonEmptyString(eventRecord.content);
          if (!hasMessageText) {
            errors.push(
              `interactiveEvents[${index}] message event requires message/content text`,
            );
          }
        }
      });
    }
  }

  if (typeof record.question !== "undefined") {
    if (!record.question || typeof record.question !== "object") {
      errors.push("question must be an object");
    } else {
      const questionRecord = record.question as Record<string, unknown>;
      const questionType =
        typeof questionRecord.type === "string" && questionRecord.type.trim().length > 0
          ? questionRecord.type
          : responseType === "question"
            ? "question"
            : "";
      if (
        typeof questionRecord.displayPrompt !== "undefined" &&
        typeof questionRecord.displayPrompt !== "string"
      ) {
        errors.push("question.displayPrompt must be a string");
      }

      if (
        typeof questionRecord.type === "string" &&
        !VALID_INTERACTIVE_TYPES.has(questionRecord.type)
      ) {
        errors.push(`question.type invalid: ${questionRecord.type}`);
      }

      const isQuestionPayload = questionType === "question";
      if (isQuestionPayload) {
        if (!isNonEmptyString(questionRecord.question)) {
          errors.push("question requires question text");
        }

        if (
          typeof questionRecord.answer !== "undefined" &&
          typeof questionRecord.answer !== "string"
        ) {
          errors.push("question.answer must be a string");
        }
        if (
          typeof questionRecord.answers !== "undefined" &&
          (!Array.isArray(questionRecord.answers) ||
            questionRecord.answers.some((item) => typeof item !== "string"))
        ) {
          errors.push("question.answers must be an array of strings");
        }

        const allowCustomInput = questionRecord.allowCustomInput === true;
        const options = Array.isArray(questionRecord.options)
          ? questionRecord.options
          : [];
        const validOptionCount = options.filter((option) => {
          if (!option || typeof option !== "object") {
            return false;
          }
          const optionRecord = option as Record<string, unknown>;
          return (
            isNonEmptyString(optionRecord.label) ||
            isNonEmptyString(optionRecord.value)
          );
        }).length;

        if (!allowCustomInput && validOptionCount < 2) {
          errors.push(
            "question interactive payload requires at least two options unless allowCustomInput is true",
          );
        }
      }

      if (questionType === "confirm" && !isNonEmptyString(questionRecord.question)) {
        errors.push("question confirm payload requires question text");
      }

      if (questionType === "quick_actions") {
        const actions = Array.isArray(questionRecord.actions)
          ? questionRecord.actions
          : [];
        if (actions.length === 0) {
          errors.push("question quick_actions payload requires actions array");
        }
      }

      if (questionType === "message") {
        const msg =
          isNonEmptyString(questionRecord.message) ||
            isNonEmptyString(questionRecord.content)
            ? true
            : false;
        if (!msg) {
          errors.push("question message payload requires message/content text");
        }
      }
    }
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

  if (responseType === "implementation_plan") {
    // IMPORTANT CONTRACT: implementation plans must provide plan.file so the
    // plan viewer/proceed flow can resolve the source-of-truth file path.
    const plan = asRecord(record.plan);
    const planContent =
      plan && typeof plan.content === "string" ? plan.content.trim() : "";
    const planFile =
      plan && typeof plan.file === "string" ? plan.file.trim() : "";
    if (!planFile) {
      errors.push("implementation_plan requires plan.file string");
    }
    if (planContent && planFile) {
      errors.push("implementation_plan must not include plan.content when plan.file is provided. Omit plan.content to prevent overwriting.");
    }
    if (plan && typeof plan.content !== "undefined" && typeof plan.content !== "string") {
      errors.push("plan.content must be a string when provided");
    }
    if (plan && typeof plan.file !== "undefined" && typeof plan.file !== "string") {
      errors.push("plan.file must be a string when provided");
    }
    if (planFile && !isQualifiedMarkdownPath(planFile)) {
      errors.push(
        "plan.file must be a full markdown filepath (absolute or workspace-relative), not just a filename",
      );
    }
    if (plan && typeof plan.files !== "undefined") {
      if (!Array.isArray(plan.files)) {
        errors.push("plan.files must be an array of strings when provided");
      } else {
        const invalidPlanFiles = plan.files.some((entry) => {
          if (typeof entry !== "string") {
            return true;
          }
          return !isQualifiedMarkdownPath(entry);
        });
        if (invalidPlanFiles) {
          errors.push(
            "plan.files must contain full markdown filepaths (absolute or workspace-relative)",
          );
        }
      }
    }
  }

  // Enforce mutual exclusivity: question/interactive responses must not include
  // a substantial implementation plan in plan.content. The schema contains
  // documentation but JSON Schema can't easily express this runtime rule.
  // We treat plan.content > 100 chars as a substantial plan.
  if (responseType === "question") {
    const plan = asRecord(record.plan);
    const planContent = plan && typeof plan.content === "string" ? plan.content : "";
    if (planContent && planContent.trim().length > 100) {
      errors.push(
        "question/interactive response cannot include implementation plan payload: move questions to top-level 'question' and remove plan.content",
      );
    }
  }

  if (responseType === "subagents") {
    const hasSubagentsArray =
      Array.isArray(record.subagents) && record.subagents.length > 0;
    const deltaRecord = asRecord(record.subagentsDelta);
    const hasSubagentsDeltaArray =
      Array.isArray(deltaRecord?.items) && deltaRecord.items.length > 0;
    if (!hasSubagentsArray && !hasSubagentsDeltaArray) {
      errors.push(
        "subagents responseType requires subagents array or subagentsDelta.items",
      );
    }
  }

  if (typeof record.subagentsDelta !== "undefined") {
    const delta = record.subagentsDelta as Record<string, unknown> | undefined;
    if (!delta || !Array.isArray(delta.items)) {
      errors.push("subagentsDelta requires items array");
    }
  }

  if (responseType === "question") {
    if (
      (!record.question || typeof record.question !== "object") &&
      !hasCompatibleInteractivePayload
    ) {
      errors.push("question responseType requires question object or interactiveEvents");
    }
  }

  if (responseType === "progress_update") {
    if (!Array.isArray(record.progressUpdates)) {
      errors.push("progress_update responseType requires progressUpdates array");
    } else if (record.progressUpdates.length === 0) {
      errors.push("progress_update responseType requires at least one progress update");
    }
  }

  if (typeof record.todoItems !== "undefined") {
    if (!Array.isArray(record.todoItems)) {
      errors.push("todoItems must be an array");
    } else {
      record.todoItems.forEach((item, index) => {
        const todo = asRecord(item);
        if (!todo) {
          errors.push(`todoItems[${index}] must be an object`);
          return;
        }
        if (!isNonEmptyString(todo.id)) {
          errors.push(`todoItems[${index}].id must be a non-empty string`);
          return;
        }
        if (!isNonEmptyString(todo.text)) {
          errors.push(`todoItems[${index}].text must be a non-empty string`);
          return;
        }
        const status = typeof todo.status === "string" ? todo.status : "";
        if (
        status &&
        status !== "pending" &&
        status !== "in_progress" &&
        status !== "completed" &&
        status !== "cancelled" &&
        status !== "failed"
      ) {
          errors.push(
            `todoItems[${index}].status must be pending|in_progress|completed|cancelled|failed`,
          );
          return;
        }
      });
    }
  }

  if (responseType === "todo_update") {
    if (!Array.isArray(record.todoItems)) {
      errors.push("todo_update responseType requires todoItems array");
    } else if (record.todoItems.length === 0) {
      errors.push("todo_update responseType requires at least one todo item");
    }
  }

  if (responseType === "data") {
    if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) {
      errors.push("data responseType requires data object");
    }
  }

  if (responseType === "message") {
    const assistantMessage =
      typeof record.assistantMessage === "string" && record.assistantMessage.trim().length > 0
        ? record.assistantMessage
        : undefined;
    const legacyMessage =
      typeof record.message === "string" && record.message.trim().length > 0
        ? record.message
        : undefined;
    if (!assistantMessage && !legacyMessage) {
      errors.push(
        "message responseType requires assistantMessage or message string",
      );
    }
  }

  if (responseType === "error") {
    const errorRecord = asRecord(record.error);
    const errorMessage =
      errorRecord && isNonEmptyString(errorRecord.message)
        ? errorRecord.message
        : undefined;
    const assistantMessage =
      typeof record.assistantMessage === "string" && record.assistantMessage.trim().length > 0
        ? record.assistantMessage
        : undefined;
    const legacyMessage =
      typeof record.message === "string" && record.message.trim().length > 0
        ? record.message
        : undefined;
    if (!errorMessage && !assistantMessage && !legacyMessage) {
      errors.push(
        "error responseType requires error.message or assistantMessage/message",
      );
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
  LEGACY_COMPAT_TOP_LEVEL_FIELDS.forEach((key) => {
    if (typeof value[key] !== "undefined") {
      sanitized[key] = value[key];
    }
  });
  return sanitized;
}
