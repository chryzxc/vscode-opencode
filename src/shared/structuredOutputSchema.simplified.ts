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
  | "implementation_plan";

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
      "Return a JSON object with a type field. Use 'message' for normal responses or 'implementation_plan' for multi-step plans with a plan object (plan.file must be a markdown filepath and should be written to disk; include plan.content when the file is not yet written).",
    additionalProperties: false,
    required: ["type"],
    properties: {
      type: {
        type: "string",
        enum: ["message", "implementation_plan"],
        description:
          "Response type: 'message' for normal text or 'implementation_plan' for plans (create/write plan.file)",
      },

      text: {
        type: "string",
        description: "User-facing text response for normal replies",
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
    },
  },
};
