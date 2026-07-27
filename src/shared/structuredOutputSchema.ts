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

export type WalkthroughChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed";

export type WalkthroughVerificationStatus =
  | "passed"
  | "failed"
  | "not_run";

export type WalkthroughStepKind =
  | "inspect"
  | "decide"
  | "change"
  | "verify"
  | "note";

export interface StructuredWalkthroughChange {
  file: string;
  summary: string;
  kind?: WalkthroughChangeKind;
}

export interface StructuredWalkthroughVerification {
  summary: string;
  status: WalkthroughVerificationStatus;
  command?: string;
}

/** One ordered action from the completed assistant turn. */
export interface StructuredWalkthroughStep {
  title: string;
  summary: string;
  kind: WalkthroughStepKind;
  outcome?: string;
  files?: string[];
  command?: string;
}

/** A file-backed summary emitted after a completed implementation turn. */
export interface StructuredWalkthrough {
  title: string;
  file: string;
  content: string;
  summary: string;
  steps: StructuredWalkthroughStep[];
  changes: StructuredWalkthroughChange[];
  verification: StructuredWalkthroughVerification[];
  limitations: string[];
}

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
      "Return a JSON object with a type field. Use 'message' for normal responses. When the user asks to create, draft, produce, or improve an implementation plan—including a detailed plan for security improvements—you MUST use 'implementation_plan' and include a plan object (plan.file is required and must be a markdown filepath; you MUST create/write this markdown file before finalizing whenever you can edit files. If the file is not already written, include the full markdown in plan.content so the extension can persist it). Include a separate, file-backed walkthrough object only for substantial completed work that benefits from a detailed retrospective, such as multi-step implementation, debugging, or research with multiple meaningful actions. Omit walkthrough for implementation_plan responses, simple replies, conversational responses, and work without a real multi-step retrospective. A walkthrough is a record of what actually happened, NEVER a copy or restatement of text or plan.content. Its ordered walkthrough.steps must explain the AI response block in sequence: what it inspected, decisions made from the evidence, files actually changed, and checks run. Only list actual file changes in walkthrough.changes—never proposed changes. Record checks actually run in walkthrough.verification, using status='not_run' when no check was performed, and disclose unfinished work in walkthrough.limitations. If emitting subagent/background-task payloads through compatible fields, include a stable background task id as 'backgroundTaskId' (for example 'bg_123abc') and subagent role hints as 'agentRole' (or 'agentType') such as 'explorer' or 'librarian'.",
    additionalProperties: false,
    required: ["type", "text"],
    properties: {
      type: {
        type: "string",
        enum: ["message", "implementation_plan"],
        description:
          "Response type. MUST be 'implementation_plan' when the user requests a plan, including a detailed security-improvement plan; otherwise use 'message'. The implementation_plan type requires plan.file and a created or persistable plan artifact.",
      },

      text: {
        type: "string",
        description: "Concise user-facing response. Do not duplicate the walkthrough narrative here.",
      },

      plan: {
        type: "object",
        description: "Implementation plan payload. For type='implementation_plan', include a full markdown filepath in plan.file. The assistant should write that file to disk; if not yet written, include full markdown in plan.content so the extension can create it.",
        properties: {
          title: { type: "string", description: "Plan title" },
          file: { type: "string", description: "Required for type='implementation_plan': full markdown file path (absolute or workspace-relative). This is the file that should be created/written." },
          content: {
            type: "string",
            description: "Full markdown plan body. Include this when the plan file has not already been written so the extension can persist it to plan.file.",
          },
          summary: {
            type: "string",
            description:
              "One-line user-facing plan summary in a personal assistant voice. Phrase it as completed first-person action, such as 'I have created a 5-day plan to implement ...', instead of a detached noun phrase.",
          },
        },
        required: ["title", "file"],
      },

      walkthrough: {
        type: "object",
        description: "Optional distinct retrospective for substantial completed multi-step work. Do not include it for implementation_plan responses, simple replies, or conversational responses. It must not copy text or plan.content. walkthrough.file is the markdown artifact path.",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "Walkthrough title" },
          file: { type: "string", description: "Markdown filepath for the walkthrough artifact. Use a workspace-relative path, preferably .opencode/artifacts/walkthroughs/<descriptive-name>-walkthrough.md. Never use /tmp, /var/folders, a system temp directory, or another path outside the workspace." },
          content: { type: "string", minLength: 1, description: "Markdown artifact generated from the ordered steps. Use this exact shape: ## Summary, then ## Walkthrough with a numbered entry for every walkthrough.steps item. Each entry states what happened, the evidence or files involved when relevant, and its outcome. End with ## Verification and ## Limitations. Do not repeat the title as an H1, copy text or plan.content, or describe future work as completed." },
          summary: { type: "string", minLength: 1, description: "Concise retrospective outcome describing what was actually completed, distinct from the assistant response and plan summary." },
          steps: {
            type: "array",
            minItems: 2,
            description: "Ordered walkthrough of substantial completed work. Include at least two meaningful actions in execution order, covering inspection, decisions, changes, or verification when they occurred.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string", description: "Short action-oriented step title, such as 'Reviewed authentication middleware'." },
                summary: { type: "string", description: "What the AI did and the evidence it used; never future proposed work." },
                kind: { type: "string", enum: ["inspect", "decide", "change", "verify", "note"] },
                outcome: { type: "string", description: "Concrete result or finding from this step." },
                files: { type: "array", items: { type: "string" }, description: "Files actually inspected or changed in this step." },
                command: { type: "string", description: "Command actually run for this step, when applicable." },
              },
              required: ["title", "summary", "kind"],
            },
          },
          changes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                file: { type: "string" },
                summary: { type: "string" },
                kind: { type: "string", enum: ["added", "modified", "deleted", "renamed"] },
              },
              required: ["file", "summary"],
            },
          },
          verification: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: { type: "string" },
                status: { type: "string", enum: ["passed", "failed", "not_run"] },
                command: { type: "string" },
              },
              required: ["summary", "status"],
            },
          },
          limitations: { type: "array", items: { type: "string" } },
        },
        required: ["title", "file", "content", "summary", "steps", "changes", "verification", "limitations"],
      },
    },
  },
};
