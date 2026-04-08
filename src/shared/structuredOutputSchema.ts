/**
 * Simplified Structured Output Schema
 *
 * Following SDK best practices:
 * - Simple structure with clear descriptions
 * - Reduced response types to core use cases
 * - Removed complex conditional validation
 * - Flattened nested structures
 * - Increased retryCount from 1 to 2 (SDK default)
 */

export type StructuredResponseType =
  | "message"
  | "implementation_plan"
  | "question"
  | "progress_update";

export type StructuredOutputSchema = {
  type: "json_schema";
  retryCount?: number;
  schema: {
    type: "object";
    description?: string;
    additionalProperties: boolean;
    required?: string[];
    properties: Record<string, unknown>;
  };
};

export const structuredOutputSchema: StructuredOutputSchema = {
  type: "json_schema",
  retryCount: 2, // SDK default
  schema: {
    type: "object",
    description:
      "Return a JSON object with a responseType field. Use 'message' for normal responses, 'implementation_plan' for multi-step plans with a plan object (plan.file is required and must be a markdown filepath), 'question' for user interactions with options, or 'progress_update' for execution steps.",
    additionalProperties: false,
    required: ["responseType"],
    properties: {
      responseType: {
        type: "string",
        enum: ["message", "implementation_plan", "question", "progress_update"],
        description:
          "Response type: 'message' for normal text, 'implementation_plan' for plans (must include plan.file), 'question' for user choices, 'progress_update' for steps",
      },

      message: {
        type: "string",
        description: "User-facing text response for normal replies",
      },

      reasoning: {
        type: "array",
        items: { type: "string" },
        description: "Optional thinking trace for UI timeline",
      },

      plan: {
        type: "object",
        description: "Implementation plan payload. For responseType='implementation_plan', include a full markdown filepath in plan.file.",
        properties: {
          title: { type: "string", description: "Plan title" },
          file: { type: "string", description: "Required for implementation_plan: full markdown file path (absolute or workspace-relative)" },
          content: {
            type: "string",
            description: "Optional markdown content for the plan body (can be persisted to plan.file)",
          },
          summary: { type: "string", description: "One-line plan summary" },
        },
        required: ["title", "file"],
      },

      question: {
        type: "object",
        description: "Interactive question requiring user input",
        properties: {
          question: { type: "string", description: "Question text to display" },
          type: {
            type: "string",
            enum: ["question", "confirm", "quick_actions"],
            description: "Interaction type",
          },
          options: {
            type: "array",
            description: "Available choices for the user",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Option label" },
                value: { type: "string", description: "Option value" },
              },
              required: ["label"],
            },
          },
        },
        required: ["question"],
      },

      progressUpdates: {
        type: "array",
        description: "Execution progress steps. For bash/shell commands, include BOTH the command text in 'command' field AND the terminal output (stdout/stderr) in 'output' field when status is 'done' or 'error'. For file edit operations, include diff information to show code changes.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Step title" },
            status: {
              type: "string",
              enum: ["pending", "done", "error"],
              description: "Step status",
            },
            command: {
              type: "string",
              description: "Command text for bash/shell operations (e.g., 'npm run build'). REQUIRED for bash steps.",
            },
            output: {
              type: "string",
              description: "Terminal output (stdout/stderr) from command execution. INCLUDE this for bash steps when status is 'done' or 'error' - show what the command printed to the terminal.",
            },
            kind: {
              type: "string",
              enum: ["tool_call", "file_edit", "command", "read", "search", "other"],
              description: "Kind of activity - use 'file_edit' for file modifications, 'command' for shell operations, 'tool_call' for tool invocations",
            },
            file: {
              type: "string",
              description: "File path for file_edit operations (e.g., 'src/utils/helpers.ts')",
            },
            diffStats: {
              type: "object",
              description: "Diff statistics for file edits - provides quick overview of changes",
              properties: {
                added: { type: "number", description: "Number of lines added" },
                deleted: { type: "number", description: "Number of lines deleted" },
              },
            },
            diffExcerpt: {
              type: "object",
              description: "Compact diff preview showing representative code changes (3-5 lines). Each line should be prefixed with '+' for additions, '-' for deletions, or no prefix for context lines.",
              properties: {
                header: { type: "string", description: "Diff header (e.g., file path, hunk headers like '@@ -1,3 +1,4 @@')" },
                lines: {
                  type: "array",
                  items: { type: "string" },
                  description: "Diff lines - prefix with + for additions, - for deletions. Example: ['@@ -1,3 +1,4 @@', '- old code', '+ new code', '  context']",
                },
                added: { type: "number", description: "Total additions across entire diff" },
                deleted: { type: "number", description: "Total deletions across entire diff" },
              },
            },
          },
          required: ["title", "status"],
        },
      },
    },
  },
};
