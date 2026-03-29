export type StructuredResponseType =
  | "message"
  | "implementation_plan"
  | "progress_update"
  | "subagents"
  | "question"
  | "todo_update"
  | "system"
  | "data"
  | "error";

export type StructuredOutputSchema = {
  type: "json_schema";
  retryCount?: number;
  schema: {
    type: "object";
    description?: string;
    additionalProperties: boolean;
    required?: string[];
    properties: Record<string, unknown>;
    examples?: unknown[];
  };
};

export const structuredOutputSchema: StructuredOutputSchema = {
  type: "json_schema",
  retryCount: 1,
  schema: {
    type: "object",
    description:
      "Return one JSON object. Always include responseType and assistantMessage. RULES: (1) responseType='implementation_plan' when proposing/creating any multi-step plan — populate the plan object. (2) responseType='question' when asking questions, presenting choices, or needing user input — populate the question object. Even a minimal question object { question: 'text' } is valid and triggers the interactive UI. NEVER fall back to plain text for questions. (3) responseType='message' for everything else. assistantMessage is the chat bubble text for every turn.",
    additionalProperties: false,
    required: ["responseType", "assistantMessage"],
    properties: {
      responseType: {
        type: "string",
        minLength: 1,
        default: "message",
        enum: [
          "message",
          "implementation_plan",
          "progress_update",
          "subagents",
          "question",
          "todo_update",
          "system",
          "data",
          "error",
        ],
        description:
          "Classifier. implementation_plan: multi-step plans, code changes, refactors, migrations — populate plan object. When in doubt vs message, choose implementation_plan. question: asking questions, presenting choices, needing confirmation or user decisions — populate question object. Minimal valid: { question: 'text' }. When in doubt vs message, choose question. NEVER output questions as plain text — always use responseType='question'. message: normal replies, greetings, explanations. progress_update: execution steps. subagents: background agents. todo_update: task changes. system: context. data: structured cards. error: failures.",
        examples: [
          "message",
          "implementation_plan",
          "progress_update",
          "subagents",
          "question",
          "todo_update",
          "system",
          "data",
          "error",
        ],
      },

      assistantMessage: {
        type: "string",
        minLength: 1,
        description:
          "Required chat bubble text for every turn. For question: list all questions as a numbered summary. For implementation_plan: describe what the plan covers. Keep concise and actionable.",
        examples: [
          "Hello! How can I help?",
          "I updated the parser and tests.",
          "I've created an implementation plan for the authentication refactor covering 8 files.",
          "I need to clarify a few things before proceeding:\n1. Which approach?\n2. Include migration?",
        ],
      },
      message: {
        type: "string",
        minLength: 1,
        description: "Legacy alias for assistantMessage. Prefer assistantMessage.",
      },
      reasoning: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional thinking trace for the UI thinking timeline. Keep this separate from assistantMessage and do not duplicate assistantMessage text.",
      },
      progressUpdates: {
        type: "array",
        description:
          "Ordered progress step updates for responseType='progress_update'. Include concrete, user-visible execution steps.",
        examples: [
          [{ title: "Run structured-output sync", status: "done" }],
          [{ title: "Compile extension host", status: "pending" }],
        ],
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: {
              type: "string",
              description: "Stable identifier for deduping or updating a step.",
            },
            type: {
              type: "string",
              description: "Optional step category such as tool, patch, or step.",
            },
            title: {
              type: "string",
              description: "Short human-readable step title shown in activity UI.",
            },
            status: {
              type: "string",
              enum: ["pending", "done", "error"],
              description: "Current status of the step.",
            },
            meta: {
              type: "string",
              description: "Optional extra context such as command, query, or summary.",
            },
            filePath: {
              type: "string",
              description: "Optional workspace-relative or absolute file path affected by the step.",
            },
            createdAt: {
              type: "number",
              description: "Optional epoch timestamp in milliseconds.",
            },
          },
        },
      },
      question: {
        type: "object",
        additionalProperties: true,
        required: ["question"],
        description:
          "Question payload for responseType='question'. Minimal valid: { question: 'your question' }. type defaults to 'question'. Add options[] for choices. The chat bubble shows assistantMessage (numbered question list); the popup shows question.question + options.",
        properties: {
          type: {
            type: "string",
            enum: ["question", "confirm", "quick_actions", "message"],
            default: "question",
            description: "Interactive mode. Defaults to 'question'. confirm: yes/no. quick_actions: action buttons.",
          },
          id: {
            type: "string",
            description: "Optional stable interaction id.",
          },
          title: {
            type: "string",
            description: "Optional short title above the prompt.",
          },
          question: {
            type: "string",
            description: "Prompt text shown in the popup. Required. Keep short (one sentence).",
          },
          displayPrompt: {
            type: "string",
            description: "Optional override for the chat bubble text instead of assistantMessage.",
          },
          multiSelect: {
            type: "boolean",
            description: "Allow selecting multiple options.",
          },
          allowCustomInput: {
            type: "boolean",
            description: "Allow free-form text input.",
          },
          answer: {
            type: "string",
            description: "Optional default answer.",
          },
          options: {
            type: "array",
            description: "Choices for type='question'. Each needs a label.",
            items: {
              type: "object",
              additionalProperties: true,
              required: ["label"],
              properties: {
                label: { type: "string", description: "Option button text." },
                value: { type: "string", description: "Value returned on select. Defaults to label." },
                description: { type: "string", description: "Optional tooltip." },
              },
            },
          },
          actions: {
            type: "array",
            description: "Action buttons for type='quick_actions'.",
            items: {
              type: "object",
              additionalProperties: true,
              required: ["label"],
              properties: {
                label: { type: "string", description: "Button text." },
                value: { type: "string", description: "Value returned on click." },
              },
            },
          },
          confirmLabel: { type: "string", description: "Custom confirm button label." },
          cancelLabel: { type: "string", description: "Custom cancel button label." },
        },
      },
      plan: {
        type: "object",
        additionalProperties: true,
        description:
          "CRITICAL: Implementation plan payload — MUST be populated when responseType='implementation_plan'. Conversely, when this object is populated, responseType MUST be 'implementation_plan'. At least one of plan.file or plan.content is required. If the plan was written to disk, set plan.file to the actual filepath. If the plan was proposed inline without writing a file, set plan.content with the full markdown. The UI renders a plan card below the assistantMessage showing plan.title, plan.file, and a 'View Plan' button that opens an interactive plan viewer. Keep user clarifications/questions out of this object — route those to the question field instead.",
        examples: [
          {
            file: "/workspace/project/plans/todo-feature.md",
            title: "Todo Feature Implementation",
            summary: "Add todo CRUD with priority levels and due dates",
          },
          {
            file: "C:\\Workspace\\project\\plans\\auth-session-hardening.md",
            files: ["C:\\Workspace\\project\\plans\\auth-session-hardening.md"],
            title: "Auth Session Hardening",
            content: "## Plan\n1. Update schema\n2. Sync generated artifacts",
          },
          {
            title: "API Rate Limiting",
            content: "## Proposed Changes\n### 1. Add RateLimiter middleware\n- Create `src/middleware/rateLimiter.ts`\n- Configure per-route limits\n\n### 2. Update API routes\n- Apply middleware to all public endpoints\n\n### 3. Add tests\n- Unit tests for limiter logic\n- Integration tests for rate-limited routes",
            summary: "Implement rate limiting across public API endpoints",
          },
        ],
        properties: {
          file: {
            type: "string",
            description:
              "Full filepath of the implementation plan markdown written to the workspace (absolute path preferred, workspace-relative path accepted; examples: '/workspace/project/plans/todo-feature.md' or 'C:\\\\Workspace\\\\project\\\\plans\\\\todo-feature.md'). Set this to the same path the tool write used; do not emit placeholder values that were not actually written to disk. Required when a plan file was written. Omit ONLY if no file was written (and provide plan.content instead).",
          },
          files: {
            type: "array",
            description:
              "Optional additional markdown filepath hints relevant to this plan. Include when multiple plan markdown files were touched and keep the canonical source-of-truth file in plan.file.",
            items: { type: "string" },
          },
          content: {
            type: "string",
            description:
              "Markdown implementation plan content. Required when no plan.file was written (inline proposals). IMPORTANT: Must NOT contain questions, clarifications, or choices — route those to the top-level 'question' field. If you wrote the plan to disk using tools, you SHOULD omit this field to prevent stale content from overwriting the source-of-truth file.",
            examples: [
              "## Proposed Changes\n### 1. Update SessionService\n- Refactor token validation\n- Add refresh token rotation\n\n### 2. Update API middleware\n- Add token expiry checks\n\n### 3. Migration\n- Create migration script for existing sessions",
            ],
          },
          // Note: runtime validator enforces mutual exclusivity between
          // question/interactive responseTypes and substantial plan content.
          // JSON Schema cannot easily express conditional string-length
          // constraints; see src/shared/structuredOutputValidator.ts for
          // the actual enforcement logic.
          title: {
            type: "string",
            description:
              "Plan title shown in the implementation plan card header and plan tab title. MUST be set when the plan object is populated. Use specific, descriptive titles (e.g. 'Todo Feature Implementation', 'Auth Session Hardening', 'API Rate Limiting'). Avoid generic values like 'Summary' or 'Plan'.",
          },
          summary: {
            type: "string",
            description: "Optional high-level one-line summary of the plan scope and goals, shown as secondary text in the plan card.",
          },
        },
      },
      subagents: {
        type: "array",
        description:
          "Background subagent snapshots for responseType='subagents'. Use when reporting parallel/child agent work.",
        examples: [
          [
            {
              id: "agent-1",
              name: "Schema Worker",
              status: "running",
              latestActivity: "Updating schema examples",
            },
          ],
        ],
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: {
              type: "string",
              description: "Stable subagent identifier.",
            },
            name: {
              type: "string",
              description: "Human-readable subagent label.",
            },
            status: {
              type: "string",
              enum: ["pending", "running", "done", "error", "orphaned"],
              description: "Current execution status of this subagent.",
            },
            progress: {
              type: "number",
              description: "Optional completion ratio from 0 to 100.",
            },
            description: {
              type: "string",
              description: "Optional subagent objective/role description.",
            },
            latestActivity: {
              type: "string",
              description: "Latest user-visible activity summary for this subagent.",
            },
            childSessionId: {
              type: "string",
              description: "Session id of the child subagent thread, if any.",
            },
            parentSessionId: {
              type: "string",
              description: "Parent session id containing the main conversation.",
            },
            parentMessageId: {
              type: "string",
              description: "Parent assistant message id this subagent belongs to.",
            },
            exploredFiles: {
              type: "array",
              description: "List of file paths the subagent has explored or modified.",
              items: { type: "string" },
            },
            timelineEvents: {
              type: "array",
              description: "Chronological event timeline entries for this subagent.",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  key: {
                    type: "string",
                    description: "Stable timeline event key.",
                  },
                  type: {
                    type: "string",
                    description: "Event kind/category label.",
                  },
                  label: {
                    type: "string",
                    description: "Event text shown in timeline UI.",
                  },
                  createdAt: {
                    type: "number",
                    description: "Epoch timestamp in milliseconds.",
                  },
                  messageID: {
                    type: "string",
                    description: "Related message id, if available.",
                  },
                  partID: {
                    type: "string",
                    description: "Related message part id, if available.",
                  },
                  callID: {
                    type: "string",
                    description: "Related tool call id, if available.",
                  },
                },
              },
            },
            progressEvents: {
              type: "array",
              description: "Structured progress events emitted by this subagent.",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  id: {
                    type: "string",
                    description: "Stable progress event id.",
                  },
                  title: {
                    type: "string",
                    description: "Progress step title.",
                  },
                  status: {
                    type: "string",
                    description: "Progress event status text.",
                  },
                  meta: {
                    type: "string",
                    description: "Optional metadata for the progress step.",
                  },
                  filePath: {
                    type: "string",
                    description: "Optional related file path.",
                  },
                  createdAt: {
                    type: "number",
                    description: "Epoch timestamp in milliseconds.",
                  },
                  messageID: {
                    type: "string",
                    description: "Related message id, if available.",
                  },
                  partID: {
                    type: "string",
                    description: "Related message part id, if available.",
                  },
                  callID: {
                    type: "string",
                    description: "Related tool call id, if available.",
                  },
                },
              },
            },
            thinkingEvents: {
              type: "array",
              description: "Optional concise reasoning snippets attributed to this subagent.",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  id: {
                    type: "string",
                    description: "Stable thinking event id.",
                  },
                  text: {
                    type: "string",
                    description: "Thinking/event text.",
                  },
                  createdAt: {
                    type: "number",
                    description: "Epoch timestamp in milliseconds.",
                  },
                  messageID: {
                    type: "string",
                    description: "Related message id, if available.",
                  },
                  partID: {
                    type: "string",
                    description: "Related message part id, if available.",
                  },
                },
              },
            },
          },
        },
      },
      subagentsDelta: {
        type: "object",
        additionalProperties: true,
        description:
          "Partial subagent updates when only changed fields are emitted.",
        properties: {
          parentMessageId: {
            type: "string",
            description: "Target parent assistant message id for this delta batch.",
          },
          items: {
            type: "array",
            description: "Delta items keyed by subagent id.",
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                id: {
                  type: "string",
                  description: "Stable subagent identifier.",
                },
                name: {
                  type: "string",
                  description: "Updated subagent label, if changed.",
                },
                status: {
                  type: "string",
                  enum: ["pending", "running", "done", "error", "orphaned"],
                  description: "Updated status, if changed.",
                },
                progress: {
                  type: "number",
                  description: "Updated progress value, if changed.",
                },
                description: {
                  type: "string",
                  description: "Updated objective/description, if changed.",
                },
                latestActivity: {
                  type: "string",
                  description: "Updated activity summary, if changed.",
                },
                childSessionId: {
                  type: "string",
                  description: "Updated child session id, if changed.",
                },
                parentSessionId: {
                  type: "string",
                  description: "Updated parent session id, if changed.",
                },
                parentMessageId: {
                  type: "string",
                  description: "Updated parent message id, if changed.",
                },
                exploredFiles: {
                  type: "array",
                  description: "Updated list of file paths explored, if changed.",
                  items: { type: "string" },
                },
              },
            },
          },
        },
      },
      todoItems: {
        type: "array",
        description:
          "Optional todo/task list payload used by responseType='todo_update'.",
        examples: [
          [
            { id: "todo-1", text: "Sync generated schema", status: "pending" },
            { id: "todo-2", text: "Run compile", status: "completed" },
          ],
        ],
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: {
              type: "string",
              description: "Stable todo item id.",
            },
            text: {
              type: "string",
              description: "Todo item label shown to the user.",
            },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed", "cancelled", "failed"],
              description: "Current todo lifecycle status.",
            },
            description: {
              type: "string",
              description: "Optional long-form todo description.",
            },
          },
        },
      },
      data: {
        type: "object",
        additionalProperties: true,
        description:
          "Machine-readable payload for UI components that render custom data cards. Use only for structured data, not normal chat text.",
        examples: [{ cardType: "metrics", values: { passed: 12, failed: 0 } }],
      },
      error: {
        type: "object",
        additionalProperties: true,
        description:
          "Error metadata for responseType='error'. Include user-safe message text in error.message and/or assistantMessage.",
        examples: [
          {
            message: "Schema validation failed.",
            code: "SCHEMA_VALIDATION_ERROR",
            retryable: true,
          },
        ],
        properties: {
          message: {
            type: "string",
            description: "User-facing error message.",
          },
          code: {
            type: "string",
            description: "Stable machine-readable error code.",
          },
          details: {
            type: "string",
            description: "Optional diagnostic details.",
          },
          retryable: {
            type: "boolean",
            description: "Whether retrying the request may succeed.",
          },
        },
      },
    },
    examples: [
      {
        responseType: "message",
        assistantMessage: "Hello! How can I help?",
      },
      {
        responseType: "implementation_plan",
        assistantMessage:
          "I've created an implementation plan for the todo feature. The plan covers database schema changes, API endpoints, and frontend components with full test coverage.",
        plan: {
          file: "plans/todo-feature.md",
          title: "Todo Feature Implementation",
          summary: "Add todo CRUD with priority levels and due dates",
        },
      },
      {
        responseType: "implementation_plan",
        assistantMessage:
          "Here's my proposed plan for the authentication refactor. It covers session management updates, token validation hardening, and the migration path for existing sessions.",
        plan: {
          title: "Auth Session Refactoring",
          content:
            "## Proposed Changes\n### 1. Update SessionService\n- Refactor token validation\n\n### 2. Add migration script",
          summary: "Refactor session management for token-based auth",
        },
      },
      {
        responseType: "progress_update",
        assistantMessage: "Progress update: compile step completed.",
        progressUpdates: [{ title: "Running compile", status: "done" }],
      },
      {
        responseType: "subagents",
        assistantMessage: "Subagents are running in the background.",
        subagents: [{ id: "agent-1", name: "Worker", status: "running" }],
      },
      {
        responseType: "question",
        assistantMessage:
          "I need a few clarifications before proceeding:\n1. Which schema mode should we use — strict or compatibility?\n2. Should we include backward-compatible migration support?",
        question: {
          type: "question",
          question: "Which schema mode should we use?",
          options: [
            { label: "Strict schema", value: "strict" },
            { label: "Compat schema", value: "compat" },
          ],
        },
      },
      {
        responseType: "todo_update",
        assistantMessage: "I updated the task checklist.",
        todoItems: [{ id: "todo-1", text: "Update tests", status: "pending" }],
      },
      {
        responseType: "data",
        assistantMessage: "Here is the structured data summary.",
        data: { cardType: "summary", status: "ok" },
      },
      {
        responseType: "error",
        assistantMessage: "I hit an error while processing your request.",
        error: {
          message: "Unable to parse output.",
          code: "PARSE_ERROR",
          retryable: true,
        },
      },
    ],
  },
};
