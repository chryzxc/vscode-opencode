export type StructuredResponseType =
  | "message"
  | "implementation_plan"
  | "progress_update"
  | "subagents"
  | "question"
  | "interactive"
  | "error";

export type StructuredOutputSchema = {
  type: "json_schema";
  name: "opencode_assistant_response";
  strict: boolean;
  schema: {
    type: "object";
    additionalProperties: boolean;
    properties: Record<string, unknown>;
  };
};

export const structuredOutputSchema: StructuredOutputSchema = {
  type: "json_schema",
  name: "opencode_assistant_response",
  strict: false,
  schema: {
    type: "object",
    additionalProperties: true,
    properties: {
      responseType: {
        type: "string",
        enum: [
          "message",
          "implementation_plan",
          "progress_update",
          "subagents",
          "question",
          "interactive",
          "error",
        ],
      },
      message: { type: "string" },
      reasoning: { type: "array", items: { type: "string" } },
      progressUpdates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            title: { type: "string" },
            status: { type: "string", enum: ["pending", "done", "error"] },
            meta: { type: "string" },
            filePath: { type: "string" },
          },
        },
      },
      interactiveEvents: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            type: {
              type: "string",
              enum: ["question", "confirm", "quick_actions"],
            },
            id: { type: "string" },
            title: { type: "string" },
            question: { type: "string" },
            multiSelect: { type: "boolean" },
            allowCustomInput: { type: "boolean" },
            confirmLabel: { type: "string" },
            cancelLabel: { type: "string" },
            options: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                  value: { type: "string" },
                  description: { type: "string" },
                },
              },
            },
            actions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                  value: { type: "string" },
                  description: { type: "string" },
                },
              },
            },
          },
        },
      },
      plan: {
        type: "object",
        additionalProperties: true,
        properties: {
          file: { type: "string" },
          content: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
        },
      },
      subagents: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            status: { type: "string" },
            progress: { type: "number" },
            description: { type: "string" },
            latestActivity: { type: "string" },
            childSessionId: { type: "string" },
            parentSessionId: { type: "string" },
            parentMessageId: { type: "string" },
            timelineEvents: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  key: { type: "string" },
                  type: { type: "string" },
                  label: { type: "string" },
                  createdAt: { type: "number" },
                  messageID: { type: "string" },
                  partID: { type: "string" },
                  callID: { type: "string" },
                },
              },
            },
            progressEvents: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  status: { type: "string" },
                  meta: { type: "string" },
                  filePath: { type: "string" },
                  createdAt: { type: "number" },
                  messageID: { type: "string" },
                  partID: { type: "string" },
                  callID: { type: "string" },
                },
              },
            },
            thinkingEvents: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  id: { type: "string" },
                  text: { type: "string" },
                  createdAt: { type: "number" },
                  messageID: { type: "string" },
                  partID: { type: "string" },
                },
              },
            },
          },
        },
      },
      subagentsDelta: {
        type: "object",
        additionalProperties: true,
        properties: {
          parentMessageId: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                status: { type: "string" },
                progress: { type: "number" },
                description: { type: "string" },
                latestActivity: { type: "string" },
                childSessionId: { type: "string" },
                parentSessionId: { type: "string" },
                parentMessageId: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};
