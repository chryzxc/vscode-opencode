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
  | "question";

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
      "Return a JSON object with a responseType field. Use 'message' for normal responses, 'implementation_plan' for multi-step plans with a plan object, or 'question' for user interactions with options.",
    additionalProperties: false,
    required: ["responseType"],
    properties: {
      responseType: {
        type: "string",
        enum: ["message", "implementation_plan", "question"],
        description:
          "Response type: 'message' for normal text, 'implementation_plan' for plans, 'question' for user choices",
      },

      message: {
        type: "string",
        description: "User-facing text response for normal replies",
      },

      plan: {
        type: "object",
        description: "Implementation plan with title and content",
        properties: {
          title: { type: "string", description: "Plan title" },
          file: { type: "string", description: "Plan file path if written to disk" },
          content: {
            type: "string",
            description: "Plan markdown content if not written to file",
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
    },
  },
};
