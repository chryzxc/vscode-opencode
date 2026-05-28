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

export const simplifiedStructuredOutputSchema: StructuredOutputSchema = {
  type: "json_schema",
  retryCount: 2, // SDK default
  schema: {
    type: "object",
    description:
      "Return a JSON object with a responseType field. Use 'message' for normal responses, 'implementation_plan' for multi-step plans with a plan object (plan.file must be a markdown filepath and should be written to disk; include plan.content when the file is not yet written), 'question' for user interactions with options, or 'progress_update' for execution steps.",
    additionalProperties: false,
    required: ["responseType"],
    properties: {
      responseType: {
        type: "string",
        enum: ["message", "implementation_plan", "question", "progress_update"],
        description:
          "Response type: 'message' for normal text, 'implementation_plan' for plans (create/write plan.file), 'question' for user choices, 'progress_update' for steps",
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
        description: "Implementation plan payload. plan.file should be created/written on disk; include plan.content when file is not yet written.",
        properties: {
          title: { type: "string", description: "Plan title" },
          file: { type: "string", description: "Plan markdown file path to create/write" },
          content: {
            type: "string",
            description: "Full markdown plan content to persist when file is not yet written",
          },
          summary: { type: "string", description: "One-line plan summary" },
        },
        required: ["title"],
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
            description: "Available choices for the user. option.value should be the exact answer text to send back (human-readable, not snake_case/id slugs).",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Option label" },
                value: { type: "string", description: "Answer text sent back on selection (e.g. 'English only', not 'english_only')." },
              },
              required: ["label"],
            },
          },
        },
        required: ["question"],
      },

      progressUpdates: {
        type: "array",
        description: "Execution progress steps",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Step title" },
            status: {
              type: "string",
              enum: ["pending", "done", "error"],
              description: "Step status",
            },
          },
          required: ["title", "status"],
        },
      },
    },
  },
};
