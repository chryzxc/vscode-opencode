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

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function countValidChoiceOptions(value: unknown): number {
  const options = Array.isArray(value) ? value : [];
  return options.filter((option) => {
    if (!option || typeof option !== "object") {
      return false;
    }
    const optionRecord = option as Record<string, unknown>;
    return (
      isNonEmptyString(optionRecord.label) ||
      isNonEmptyString(optionRecord.value)
    );
  }).length;
}

function parseMaybeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasQuestionIntent(
  value: Record<string, unknown>,
  sanitized: Record<string, unknown>,
): boolean {
  const questionValue = sanitized.question ?? value.question;
  const questionRecord = asRecord(questionValue);
  if (typeof questionValue === "string" && questionValue.trim().length > 0) {
    const optionCount = countValidChoiceOptions(value.options ?? value.choices ?? value.actions);
    return optionCount >= 2 || value.allowCustomInput === true;
  }

  if (questionRecord) {
    const type = asString(questionRecord.type).trim().toLowerCase() || "question";
    if (type === "message") {
      return false;
    }
    if (type === "confirm") {
      return isNonEmptyString(questionRecord.question);
    }
    if (type === "quick_actions" || type === "quick-actions") {
      return parseMaybeArray(questionRecord.actions).length > 0;
    }
    const optionCount = countValidChoiceOptions(
      questionRecord.options ?? questionRecord.choices,
    );
    return (
      isNonEmptyString(questionRecord.question) &&
      (optionCount >= 2 || questionRecord.allowCustomInput === true)
    );
  }

  return parseMaybeArray(sanitized.interactiveEvents ?? value.interactiveEvents).some(
    (entry) => {
      const event = asRecord(entry);
      if (!event) {
        return false;
      }
      const type = asString(event.type).trim().toLowerCase();
      return type === "question" || type === "confirm" || type === "quick_actions";
    },
  );
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

      record.progressUpdates.forEach((item, index) => {
        const update = asRecord(item);
        if (!update) {
          return;
        }
        const kind = typeof update.kind === "string"
          ? update.kind.trim().toLowerCase()
          : "";
        const status = typeof update.status === "string"
          ? update.status.trim().toLowerCase()
          : "";
        const hasFile = isNonEmptyString(update.file) || isNonEmptyString(update.filePath);
        const isFileEdit = kind === "file_edit" || hasFile;
        const isFinalStep = status === "done" || status === "error";
        if (!isFileEdit || !isFinalStep) {
          return;
        }

        const diffExcerpt = asRecord(update.diffExcerpt);
        const hasExcerptLines =
          Array.isArray(diffExcerpt?.lines) &&
          diffExcerpt.lines.some(
            (line) => typeof line === "string" && line.trim().length > 0,
          );
        const diffStats = asRecord(update.diffStats);
        const addedCount =
          typeof diffStats?.added === "number" ? Math.max(0, diffStats.added) : 0;
        const deletedCount =
          typeof diffStats?.deleted === "number" ? Math.max(0, diffStats.deleted) : 0;
        const hasDiffStats = addedCount > 0 || deletedCount > 0;

        if (!hasExcerptLines && !hasDiffStats) {
          errors.push(
            `progressUpdates[${index}] file_edit step requires diffExcerpt.lines or diffStats for done/error status`,
          );
        }
        if (!hasExcerptLines && hasDiffStats) {
          errors.push(
            `progressUpdates[${index}] file_edit step with changes must include diffExcerpt.lines`,
          );
        }
      });
    }
  }

  if (typeof record.fileChanges !== "undefined") {
    if (!Array.isArray(record.fileChanges)) {
      errors.push("fileChanges must be an array");
    } else {
      record.fileChanges.forEach((item, index) => {
        const change = asRecord(item);
        if (!change) {
          errors.push(`fileChanges[${index}] must be an object`);
          return;
        }
        const file = asString(change.file).trim();
        if (!file) {
          errors.push(`fileChanges[${index}] file is required`);
          return;
        }

        const diffExcerpt = asRecord(change.diffExcerpt);
        const hasExcerptLines =
          Array.isArray(diffExcerpt?.lines) &&
          diffExcerpt.lines.some(
            (line) => typeof line === "string" && line.trim().length > 0,
          );
        const diffStats = asRecord(change.diffStats);
        const addedCount =
          typeof diffStats?.added === "number" ? Math.max(0, diffStats.added) : 0;
        const deletedCount =
          typeof diffStats?.deleted === "number"
            ? Math.max(0, diffStats.deleted)
            : 0;
        const hasDiffStats = addedCount > 0 || deletedCount > 0;

        if (!hasExcerptLines && !hasDiffStats) {
          errors.push(
            `fileChanges[${index}] requires diffExcerpt.lines or diffStats`,
          );
        }
        if (!hasExcerptLines && hasDiffStats) {
          errors.push(
            `fileChanges[${index}] with non-zero diffStats must include diffExcerpt.lines`,
          );
        }
      });
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
          const validOptionCount = countValidChoiceOptions(eventRecord.options);
          if (validOptionCount < 2) {
            errors.push(
              `interactiveEvents[${index}] question event requires at least two options`,
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

  if (responseType === "question" && typeof record.question !== "undefined") {
    if (!record.question || typeof record.question !== "object") {
      errors.push("question must be an object");
    } else {
      const questionRecord = record.question as Record<string, unknown>;
      const questionType =
        typeof questionRecord.type === "string" && questionRecord.type.trim().length > 0
          ? questionRecord.type
          : "question";
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

        const validOptionCount = countValidChoiceOptions(questionRecord.options);
        if (validOptionCount < 2) {
          errors.push(
            "question interactive payload requires at least two options",
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
    const planFile =
      plan && typeof plan.file === "string" ? plan.file.trim() : "";
    if (!planFile) {
      errors.push("implementation_plan requires plan.file string");
    }
    if (plan && typeof plan.content !== "undefined" && typeof plan.content !== "string") {
      errors.push("plan.content must be a string when provided");
    }
    if (plan && typeof plan.file !== "undefined" && typeof plan.file !== "string") {
      errors.push("plan.file must be a string when provided");
    }
    if (plan && typeof plan.intro !== "undefined" && typeof plan.intro !== "string") {
      errors.push("plan.intro must be a string when provided");
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
    if (typeof record.data !== "undefined") {
      errors.push("implementation_plan responseType must not include data payload");
    }
    if (typeof record.error !== "undefined") {
      errors.push("implementation_plan responseType must not include error payload");
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

    const questionRecord = asRecord(record.question);
    const questionType = asString(questionRecord?.type).trim() || "question";
    const questionOptionCount =
      questionType === "question"
        ? countValidChoiceOptions(questionRecord?.options)
        : 0;
    const interactiveQuestionOptionCount = Array.isArray(record.interactiveEvents)
      ? record.interactiveEvents.reduce((maxCount, entry) => {
          const eventRecord = asRecord(entry);
          if (!eventRecord || asString(eventRecord.type) !== "question") {
            return maxCount;
          }
          return Math.max(maxCount, countValidChoiceOptions(eventRecord.options));
        }, 0)
      : 0;

    if (
      questionOptionCount < 2 &&
      interactiveQuestionOptionCount < 2
    ) {
      errors.push(
        "question responseType requires choices: provide at least two options in question.options or interactiveEvents[].options",
      );
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
    const messageText =
      typeof record.message === "string" && record.message.trim().length > 0
        ? record.message
        : undefined;
    if (!messageText) {
      errors.push(
        "message responseType requires message string",
      );
    }
  }

  if (responseType === "error") {
    const errorRecord = asRecord(record.error);
    const errorMessage =
      errorRecord && isNonEmptyString(errorRecord.message)
        ? errorRecord.message
        : undefined;
    const messageText =
      typeof record.message === "string" && record.message.trim().length > 0
        ? record.message
        : undefined;
    if (!errorMessage && !messageText) {
      errors.push(
        "error responseType requires error.message or message",
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Normalize question options to ensure allowCustomInput is set correctly
 * and handle JSON-stringified options arrays
 */
function normalizeQuestionOptions(
  question: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...question };

  // Handle JSON-stringified options array
  let options = normalized.options;
  if (typeof options === "string") {
    try {
      options = JSON.parse(options);
    } catch {
      // If parsing fails, treat as empty array
      options = [];
    }
  }

  // Ensure options is an array
  if (!Array.isArray(options)) {
    options = [];
  }

  normalized.options = options;

  return normalized;
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

  // Handle malformed question structure where responseType is "question"
  // but question is a string instead of an object
  let responseType = isNonEmptyString(sanitized.responseType)
    ? String(sanitized.responseType).toLowerCase()
    : "";
  if (responseType !== "implementation_plan" && hasQuestionIntent(value, sanitized)) {
    responseType = "question";
    sanitized.responseType = "question";
  }

  if (responseType === "question") {
    // If question is a string, convert it to a proper question object
    if (typeof sanitized.question === "string" && sanitized.question.trim()) {
      const questionText = String(sanitized.question).trim();
      const questionObj: Record<string, unknown> = {
        type: "question",
        question: questionText,
      };

      // Move top-level option-like fields into the question object.
      // In development, models may still emit question/options at the top level.
      const rawQuestionOptions =
        typeof sanitized.options !== "undefined"
          ? sanitized.options
          : typeof value.options !== "undefined"
            ? value.options
            : typeof sanitized.choices !== "undefined"
              ? sanitized.choices
              : typeof value.choices !== "undefined"
                ? value.choices
                : typeof sanitized.actions !== "undefined"
                  ? sanitized.actions
                  : value.actions;

      if (typeof rawQuestionOptions === "string") {
        try {
          questionObj.options = JSON.parse(rawQuestionOptions);
        } catch {
          questionObj.options = [];
        }
      } else if (Array.isArray(rawQuestionOptions)) {
        questionObj.options = rawQuestionOptions;
      }

      // Copy other question-related fields (title, id, etc.)
      if (sanitized.title) {
        questionObj.title = sanitized.title;
      }
      if (sanitized.id) {
        questionObj.id = sanitized.id;
      }

      sanitized.question = questionObj;
      // Remove top-level option aliases as they're now in the question object
      delete sanitized.options;
      delete sanitized.choices;
      delete sanitized.actions;
    }

    // Normalize top-level question object
    if (typeof sanitized.question === "object" && sanitized.question !== null) {
      sanitized.question = normalizeQuestionOptions(
        sanitized.question as Record<string, unknown>,
      );
    }
  }

  // Normalize interactiveEvents array
  // Handle JSON-stringified interactiveEvents array
  let interactiveEvents = sanitized.interactiveEvents;
  if (typeof interactiveEvents === "string") {
    try {
      interactiveEvents = JSON.parse(interactiveEvents);
    } catch {
      // If parsing fails, treat as empty array
      interactiveEvents = [];
    }
  }

  // Ensure interactiveEvents is an array
  if (!Array.isArray(interactiveEvents)) {
    interactiveEvents = [];
  }

  const eventsArray = interactiveEvents as unknown[];
  sanitized.interactiveEvents = eventsArray;

  sanitized.interactiveEvents = eventsArray.map((event) => {
    if (!event || typeof event !== "object") {
      return event;
    }
    const eventRecord = event as Record<string, unknown>;
    const eventType = isNonEmptyString(eventRecord.type)
      ? eventRecord.type
      : "";

    // Normalize question-type events
    if (eventType === "question") {
      return normalizeQuestionOptions(eventRecord);
    }

    return event;
  });

  return sanitized;
}
