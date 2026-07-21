/**
 * StructuredOutputProcessor Module
 *
 * Handles all structured output parsing, normalization, validation,
 * and message enrichment.
 *
 * Extracted from ChatViewProvider.ts (~900 lines across multiple sections)
 */

import * as vscode from "vscode";
import type { OutputFormatJsonSchema } from "@opencode-ai/sdk/v2";
import type {
  StructuredAssistantOutput,
} from "./types";
import {
  structuredOutputSchema,
  type StructuredWalkthrough,
  type StructuredWalkthroughChange,
  type StructuredWalkthroughStep,
  type StructuredWalkthroughVerification,
} from "../../shared/structuredOutputSchema";
import {
  sanitizeStructuredOutput,
  validateStructuredOutput,
} from "../../shared/structuredOutputValidator";
import { STRUCTURED_RESPONSE_TYPES } from "./types";
import type { PlanManager } from "./PlanManager";
import { PlanParser } from "../../services/PlanParser";

export class StructuredOutputProcessor {
  private structuredOutputMode: "format" | "disabled" = "format";
  private readonly structuredValidationFailureCounters = new Map<string, number>();
  private readonly structuredOutputIncompatibleModelKeys = new Set<string>();

  constructor(
    private logger: ReturnType<typeof import("../../utils/Logger").createLogger>,
    private asRecord: (value: unknown) => Record<string, unknown> | undefined,
    private firstNonEmptyString: (...values: unknown[]) => string | undefined,
    private planManager: PlanManager,
  ) { }

  clearDiagnostics(): void {
    this.structuredValidationFailureCounters.clear();
    this.structuredOutputIncompatibleModelKeys.clear();
  }

  private persistPlan(
    content: string,
    preferredPath?: string,
  ): Promise<string | undefined> {
    return this.planManager.persistPlan(content, preferredPath);
  }

  /**
   * Derive a walkthrough only from the completed message's structured activity
   * metadata. This never mutates the raw SDK message/debug payload.
   */
  private async ensureActivityWalkthrough(message: any): Promise<any> {
    if (message?.walkthrough || this.asRecord(message?.structuredOutput)?.walkthrough) {
      return message;
    }

    const rawSteps: unknown[] = Array.isArray(message?.steps) ? message.steps : [];
    const activitySteps = rawSteps
      .map((value: unknown) => this.asRecord(value))
      .filter((step): step is Record<string, unknown> => {
        if (!step) return false;
        const activity = this.asRecord(step.activityDetail);
        const tool = this.firstNonEmptyString(
          activity?.tool,
          step.tool,
          step.partType === "tool" ? step.title : undefined,
        )?.toLowerCase();
        return !!tool && !tool.includes("structuredoutput") && !tool.includes("structured_output");
      });
    const rawEdits: unknown[] = Array.isArray(message?.edits) ? message.edits : [];
    const edits = rawEdits
      .map((value: unknown) => this.asRecord(value))
      .filter((edit): edit is Record<string, unknown> => !!edit);

    if (activitySteps.length === 0 && edits.length === 0) {
      return message;
    }

    const messageId = this.firstNonEmptyString(message?.id, message?.info?.id) || `${Date.now()}`;
    const safeMessageId = messageId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const file = `.opencode/artifacts/walkthroughs/walkthrough-${safeMessageId}.md`;
    const steps: StructuredWalkthroughStep[] = activitySteps.map((step) => {
      const activity = this.asRecord(step.activityDetail);
      const tool = this.firstNonEmptyString(activity?.tool, step.tool, step.title) || "activity";
      const stepFile = this.firstNonEmptyString(activity?.file, step.filePath, step.file);
      const command = this.firstNonEmptyString(
        activity?.command,
        this.asRecord(activity?.input)?.command,
      );
      const status = this.firstNonEmptyString(step.status)?.toLowerCase();
      const failed = status === "error" || status === "failed";
      return {
        title: tool,
        kind: command ? "verify" : stepFile ? "change" : "inspect",
        summary: stepFile
          ? `${tool} completed for ${stepFile}.`
          : `${tool} completed during this response.`,
        outcome: failed ? "The activity reported a failure." : "The activity completed.",
        files: stepFile ? [stepFile] : undefined,
        command,
      };
    });
    if (steps.length === 0) {
      steps.push({
        title: "Recorded file changes",
        kind: "change",
        summary: `${edits.length} file change${edits.length === 1 ? "" : "s"} completed during this response.`,
        files: edits
          .map((edit) => this.firstNonEmptyString(edit.file, edit.path))
          .filter((value): value is string => !!value),
      });
    }

    const changes: StructuredWalkthroughChange[] = edits
      .map((edit): StructuredWalkthroughChange | undefined => {
        const changedFile = this.firstNonEmptyString(edit.file, edit.path);
        if (!changedFile) return undefined;
        return {
          file: changedFile,
          summary: "Changed during this response.",
          kind: "modified" as const,
        };
      })
      .filter((change): change is StructuredWalkthroughChange => !!change);
    const verification: StructuredWalkthroughVerification[] = steps
      .filter((step) => !!step.command)
      .map((step) => ({
        summary: `Ran ${step.command}.`,
        status: step.outcome === "The activity reported a failure." ? "failed" : "passed",
        command: step.command,
      }));
    if (verification.length === 0) {
      verification.push({
        summary: "No explicit verification command was reported in the completed activity.",
        status: "not_run",
      });
    }

    const walkthrough: StructuredWalkthrough = {
      title: "Response activity walkthrough",
      file,
      summary: `Recorded ${steps.length} completed activity step${steps.length === 1 ? "" : "s"} from this response.`,
      steps,
      changes,
      verification,
      limitations: [
        "Generated from completed activity metadata because the model did not return a walkthrough payload.",
      ],
      content: this.renderActivityWalkthroughMarkdown(steps, changes, verification),
    };
    try {
      await this.persistPlan(walkthrough.content, walkthrough.file);
    } catch (error) {
      this.logger.error("Failed to persist activity-derived walkthrough", {}, error as Error);
    }

    this.logger.info("Created activity-derived walkthrough for completed assistant response", {
      messageId,
      activityStepCount: steps.length,
      changeCount: changes.length,
    });
    return {
      ...message,
      walkthrough,
      structuredOutput: {
        ...(this.asRecord(message?.structuredOutput) || {}),
        walkthrough,
      },
    };
  }

  private renderActivityWalkthroughMarkdown(
    steps: StructuredWalkthroughStep[],
    changes: StructuredWalkthroughChange[],
    verification: StructuredWalkthroughVerification[],
  ): string {
    const lines = [
      "## Summary",
      `Recorded ${steps.length} completed activity step${steps.length === 1 ? "" : "s"} from this response.`,
      "",
      "## Walkthrough",
    ];
    steps.forEach((step, index) => {
      lines.push(`${index + 1}. **${step.title}** — ${step.summary}`);
      if (step.files?.length) lines.push(`   - Files: ${step.files.map((file) => `\`${file}\``).join(", ")}`);
      if (step.command) lines.push(`   - Command: \`${step.command}\``);
      if (step.outcome) lines.push(`   - Outcome: ${step.outcome}`);
    });
    lines.push("", "## Changes");
    lines.push(...(changes.length > 0
      ? changes.map((change) => `- \`${change.file}\` — ${change.summary}`)
      : ["- No file change metadata was reported."]));
    lines.push("", "## Verification");
    lines.push(...verification.map((entry) => `- **${entry.status}** — ${entry.summary}`));
    lines.push("", "## Limitations");
    lines.push("- Generated from completed activity metadata because the model did not return a walkthrough payload.");
    return lines.join("\n");
  }

  private parseRawResponseRecord(rawResponse: unknown): Record<string, unknown> | undefined {
    const direct = this.asRecord(rawResponse);
    if (direct) {
      return direct;
    }

    if (typeof rawResponse !== "string") {
      return undefined;
    }

    const trimmed = rawResponse.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return this.asRecord(parsed);
    } catch {
      return undefined;
    }
  }


  /**
   * Get the structured output format for API requests
   */
  getStructuredOutputFormat(): OutputFormatJsonSchema {
    const topLevel = structuredOutputSchema as unknown as Record<string, unknown>;
    const schemaRecord = this.asRecord(topLevel.schema);
    const properties = this.asRecord(schemaRecord?.properties) ?? {};
    const additionalProperties = schemaRecord?.additionalProperties === false
      ? false
      : undefined;
    const required = Array.isArray(schemaRecord?.required)
      ? (schemaRecord?.required as string[]).filter(
        (item) => typeof item === "string" && item.trim().length > 0,
      )
      : ["type"];
    // Send a docs-style minimal JSON schema to maximize compatibility across providers.
    return {
      type: "json_schema",
      schema: {
        type: "object",
        properties,
        required,
        ...(additionalProperties === false ? { additionalProperties: false } : {}),
      },
    };
  }

  /**
   * Check if structured output should be used for the given model
   */
  shouldUseStructuredOutput(modelKey: string): boolean {
    if (this.structuredOutputMode === "disabled") {
      return false;
    }
    if (this.structuredOutputIncompatibleModelKeys.has(modelKey)) {
      return false;
    }
    return true;
  }

  /** Get the structured output model key. */
  getStructuredOutputModelKey(modelKey: string): string {
    return modelKey;
  }

  /**
   * Get the selected structured output model key
   */
  getSelectedStructuredOutputModelKey(): string | undefined {
    return undefined;
  }

  /**
   * Check if text is likely a tool call transcript
   */
  isLikelyToolCallTranscript(text: string): boolean {
    if (!text || typeof text !== "string") return false;
    const lower = text.toLowerCase().trim();
    if (lower.length < 50) return false;

    const toolCallIndicators = [
      "tool call",
      "tool_calls",
      "function call",
      "function_calls",
      "tooluse",
      "tool use",
      "tool result",
      "tool_output",
      "tool output",
    ];

    const hasToolCallPrefix = toolCallIndicators.some((indicator) =>
      lower.startsWith(indicator)
    );

    if (hasToolCallPrefix) return true;

    const hasJsonStructure =
      lower.includes("{") &&
      (lower.includes('"tool"') || lower.includes('"function"')) &&
      lower.includes('"name"');

    return hasJsonStructure;
  }

  /**
   * Normalize error candidate
   */
  normalizeErrorCandidate(value: unknown): string | undefined {
    if (typeof value === "string") {
      return value.trim();
    }
    const rec = this.asRecord(value);
    if (!rec) return undefined;
    return this.firstNonEmptyString(rec.message, rec.error, rec.detail);
  }

  /**
   * Check if message is a generic error message
   */
  isGenericErrorMessage(message: string): boolean {
    const genericPatterns = [
      "an error occurred",
      "something went wrong",
      "there was an error",
      "an error has occurred",
      "error processing your request",
      "unable to process",
      "failed to process",
    ];
    const lower = message.toLowerCase().trim();
    return genericPatterns.some((pattern) => lower.includes(pattern));
  }

  /**
   * Check if message is a structured output transport error
   */
  isStructuredOutputTransportError(message: string): boolean {
    const transportErrorPatterns = [
      "failed to parse structured output",
      "invalid structured output",
      "malformed structured output",
      "structured output validation failed",
      "unable to parse structured output",
    ];
    const lower = message.toLowerCase().trim();
    return transportErrorPatterns.some((pattern) => lower.includes(pattern));
  }

  /**
   * Check if message is a structured output failure message
   */
  isStructuredOutputFailureMessage(message: string): boolean {
    const failurePatterns = [
      "structured output failed",
      "failed to generate structured output",
      "could not produce structured output",
      "structured output error",
    ];
    const lower = message.toLowerCase().trim();
    return failurePatterns.some((pattern) => lower.includes(pattern));
  }

  /**
   * Check if message is likely an interactive await timeout error
   */
  isLikelyInteractiveAwaitTimeoutError(message: string): boolean {
    const timeoutPatterns = [
      "timeout",
      "timed out",
      "expired",
      "took too long",
      "exceeded time limit",
    ];
    const lower = message.toLowerCase().trim();
    return timeoutPatterns.some((pattern) => lower.includes(pattern));
  }

  /**
   * Check if stream payload has blocking interactive event
   */
  hasBlockingInteractiveInStreamPayload(event: unknown): boolean {
    const rec = this.asRecord(event);
    if (!rec) return false;

    const structured = this.asRecord(rec.structured);
    const structuredOutput = this.asRecord(rec.structuredOutput);

    const interactiveEvents =
      (Array.isArray(structured?.interactiveEvents)
        ? structured.interactiveEvents
        : undefined) ||
      (Array.isArray(structuredOutput?.interactiveEvents)
        ? structuredOutput.interactiveEvents
        : undefined);

    if (!interactiveEvents || interactiveEvents.length === 0) {
      return false;
    }

    const firstEvent = interactiveEvents[0];
    if (!firstEvent || typeof firstEvent !== "object") {
      return false;
    }

    const eventType = this.firstNonEmptyString(
      firstEvent.type,
      (firstEvent as Record<string, unknown>).question,
      (firstEvent as Record<string, unknown>).confirm,
    );

    return Boolean(eventType);
  }

  /**
   * Collect error message candidates from error object
   */
  collectErrorMessageCandidates(error: unknown): string[] {
    const candidates: string[] = [];

    if (!error) return candidates;

    const rec = this.asRecord(error);
    if (!rec) {
      if (typeof error === "string") {
        candidates.push(error);
      }
      return candidates;
    }

    const message = this.firstNonEmptyString(rec.message, rec.error);
    if (message) candidates.push(message);

    const details = rec.details;
    if (Array.isArray(details)) {
      for (const detail of details) {
        const msg = this.normalizeErrorCandidate(detail);
        if (msg) candidates.push(msg);
      }
    } else if (details) {
      const msg = this.normalizeErrorCandidate(details);
      if (msg) candidates.push(msg);
    }

    const response = this.asRecord(rec.response);
    if (response) {
      const responseMessage = this.firstNonEmptyString(
        response.message,
        response.error,
      );
      if (responseMessage) candidates.push(responseMessage);
    }

    return candidates;
  }

  /**
   * Extract error message from error object
   */
  extractErrorMessage(error: unknown, fallback: string): string {
    const candidates = this.collectErrorMessageCandidates(error);
    if (candidates.length === 0) return fallback;
    return candidates[0] || fallback;
  }

  /**
   * Collect normalized error messages
   */
  collectNormalizedErrorMessages(error: unknown): string[] {
    const candidates = this.collectErrorMessageCandidates(error);
    return candidates.filter((msg) => !this.isGenericErrorMessage(msg));
  }

  /**
   * Extract detailed error message
   */
  private extractDetailedErrorMessage(error: unknown, fallback: string): string {
    const normalized = this.collectNormalizedErrorMessages(error);
    if (normalized.length > 0) {
      const detailLines = normalized.map((detail) => `- ${detail}`);
      return `${fallback}\n\nDetails:\n${detailLines.join("\n")}`;
    }
    return this.extractErrorMessage(error, fallback);
  }

  /**
   * Check if part is a reasoning part
   */
  isReasoningPartLike(part: unknown): boolean {
    const rec = this.asRecord(part);
    if (!rec) return false;
    const type = this.firstNonEmptyString(rec.type);
    return Boolean(
      type &&
      (type.toLowerCase().includes("reasoning") ||
        type.toLowerCase().includes("thinking") ||
        typeof rec.reasoning !== "undefined" ||
        typeof rec.thought !== "undefined" ||
        typeof rec.thinking !== "undefined"),
    );
  }

  /**
   * Check if part is renderable text
   */
  isRenderableTextPart(part: unknown): boolean {
    const rec = this.asRecord(part);
    if (!rec) return false;
    const type = this.firstNonEmptyString(rec.type);
    if (!type) return true;
    return !this.isReasoningPartLike(part);
  }

  /**
   * Check if value is an interactive response type
   */
  isInteractiveResponseType(value: unknown): boolean {
    const str = String(value).toLowerCase().trim();
    return str === "confirm" || str === "quick_actions";
  }

  /**
   * Format question prompt for assistant
   */
  formatQuestionPromptForAssistant(question: string, options?: any[]): string {
    let prompt = `USER QUESTION: ${question}`;

    if (options && options.length > 0) {
      const optionsText = options
        .map((opt) => {
          const label = typeof opt === "string" ? opt : opt.label || opt.value || "";
          return `- ${label}`;
        })
        .join("\n");
      prompt += `\n\nOPTIONS:\n${optionsText}`;
    }

    return prompt;
  }

  /**
   * Derive question prompt from interactive payload
   */
  deriveQuestionPromptFromInteractivePayload(payload: {
    question: string;
    options?: any[];
  }): string {
    const { question, options } = payload;
    return this.formatQuestionPromptForAssistant(question, options);
  }

  /**
   * Check if body text is low value interactive text
   */
  isLowValueInteractiveBodyText(value: string): boolean {
    if (!value || typeof value !== "string") return false;
    const lower = value.toLowerCase().trim();
    const lowValuePhrases = [
      "please answer the question",
      "please select an option",
      "please choose",
      "please respond",
      "waiting for your response",
      "awaiting your input",
    ];
    return lowValuePhrases.some((phrase) => lower.includes(phrase));
  }

  /**
   * Check if content is a clarification questionnaire
   */
  isClarificationQuestionnaire(content: unknown): boolean {
    if (!content) return false;
    const rec = this.asRecord(content);
    if (!rec) return false;

    const interactiveEvents =
      Array.isArray(rec.interactiveEvents) ? rec.interactiveEvents : undefined;

    if (!interactiveEvents || interactiveEvents.length === 0) {
      return false;
    }

    const hasQuestion = interactiveEvents.some(
      (event: any) =>
        !!event &&
        typeof event === "object" &&
        (event.type === "question" || event.type === "confirm")
    );

    return hasQuestion;
  }

  private buildFallbackPlanMarkdown(options: {
    title?: string;
    summary?: string;
    messageText?: string;
  }): string {
    const title = this.firstNonEmptyString(options.title) || "Implementation Plan";
    const summary =
      this.firstNonEmptyString(options.summary, options.messageText) ||
      "I created an implementation plan with clear execution steps.";
    return `# ${title}\n\n${summary}\n`;
  }

  /**
   * Extract message ID from message
   */
  extractMessageId(message: any): string | undefined {
    if (!message) return undefined;
    return this.firstNonEmptyString(
      message.id,
      message.messageId,
      message.message_id,
    );
  }

  /**
   * Check if message has structured subagent signal
   */
  hasStructuredSubagentSignal(messageRaw: unknown): boolean {
    const rec = this.asRecord(messageRaw);
    if (!rec) return false;

    const subagents = rec.subagents;
    if (Array.isArray(subagents) && subagents.length > 0) {
      return true;
    }

    const structured = this.asRecord(rec.structured);
    const structuredSubagents = structured?.subagents;
    if (Array.isArray(structuredSubagents) && structuredSubagents.length > 0) {
      return true;
    }

    return false;
  }

  /**
   * Normalize subagent status
   */
  normalizeSubagentStatus(status: unknown): string {
    if (!status) return "pending";
    const str = String(status).toLowerCase().trim();
    const statusMap: Record<string, string> = {
      running: "running",
      active: "running",
      in_progress: "running",
      completed: "done",
      done: "done",
      finished: "done",
      success: "done",
      failed: "error",
      error: "error",
      cancelled: "cancelled",
      canceled: "error",
      pending: "pending",
      queued: "pending",
      orphaned: "orphaned",
    };
    return statusMap[str] || "pending";
  }

  /**
   * Merge subagent entries
   */
  mergeSubagentEntries(
    existing: any[],
    updates: any[],
  ): any[] {
    const merged = [...existing];
    const existingById = new Map(
      existing
        .filter((subagent) => subagent?.id)
        .map((subagent) => [subagent.id, subagent])
    );

    for (const update of updates) {
      if (!update?.id) continue;
      const existingSubagent = existingById.get(update.id);
      if (existingSubagent) {
        const index = merged.indexOf(existingSubagent);
        if (index !== -1) {
          merged[index] = { ...existingSubagent, ...update };
        }
      } else {
        merged.push(update);
      }
    }

    return merged;
  }

  /**
   * Hydrate subagents from payload
   */
  hydrateSubagentsFromPayload(payload: {
    subagents?: any[];
    subagentsDelta?: any;
  }): any[] | undefined {
    const { subagents, subagentsDelta } = payload;

    if (!subagents && !subagentsDelta) {
      return undefined;
    }

    if (subagents && Array.isArray(subagents)) {
      return subagents;
    }

    if (subagentsDelta?.items && Array.isArray(subagentsDelta.items)) {
      return subagentsDelta.items;
    }

    return undefined;
  }

  /**
   * Resolve subagent payload session ID
   */
  resolveSubagentPayloadSessionId(payload: {
    sessionId?: string;
    childSessionId?: string;
  }): string | undefined {
    return this.firstNonEmptyString(
      payload.sessionId,
      payload.childSessionId,
    );
  }

  /**
   * Find latest subagent parent message ID for session
   */
  findLatestSubagentParentMessageIdForSession(
    sessionId: string,
    messages: any[],
  ): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (!message) continue;

      const subagents = message.subagents;
      if (Array.isArray(subagents)) {
        for (const subagent of subagents) {
          if (subagent?.childSessionId === sessionId) {
            return this.extractMessageId(message);
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Record structured validation failure
   */
  private recordStructuredValidationFailure(
    canonicalRec: Record<string, unknown>,
    errors: string[],
    diagnostics?: {
      source?: string;
      providerID?: string;
      modelID?: string;
    },
  ): void {
    const responseType = this.firstNonEmptyString(canonicalRec.type, canonicalRec.responseType);
    if (!responseType) return;

    const providerID = diagnostics?.providerID || "unknown";
    const modelID = diagnostics?.modelID || "unknown";
    const key = `${responseType}|${providerID}/${modelID}`;
    const current = this.structuredValidationFailureCounters.get(key) || 0;
    this.structuredValidationFailureCounters.set(key, current + 1);

    if (current >= 3) {
      if (diagnostics?.modelID) {
        this.structuredOutputIncompatibleModelKeys.add(diagnostics.modelID);
      }
    }

    this.logger.warn("Structured output validation failure aggregate", {
      responseType,
      errors,
      source: diagnostics?.source,
      providerID: diagnostics?.providerID,
      modelID: diagnostics?.modelID,
      failureCount: current + 1,
    });
  }

  private buildStructuredOutputLogPreview(value: unknown): {
    type: string;
    preview: string;
    keys?: string[];
    responseType?: string;
  } {
    const rec = this.asRecord(value);
    const previewSource = rec ?? value;
    let preview = "";
    try {
      preview = JSON.stringify(previewSource).slice(0, 1200);
    } catch {
      preview = String(previewSource);
    }

    return {
      type: Array.isArray(value) ? "array" : typeof value,
      preview,
      keys: rec ? Object.keys(rec) : undefined,
      responseType: rec
        ? this.firstNonEmptyString(rec.type, rec.responseType, rec.kind, rec.category)
        : undefined,
      };
  }

  private hasMeaningfulStructuredValue(value: unknown): boolean {
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    if (typeof value === "number") {
      return Number.isFinite(value);
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (value && typeof value === "object") {
      return Object.keys(value as Record<string, unknown>).length > 0;
    }
    return false;
  }

  private getStructuredSemanticSnapshot(
    value: unknown,
  ): Record<string, unknown> {
    const rec = this.asRecord(value);
    if (!rec) {
      return {};
    }

    const planRec = this.asRecord(rec.plan);
    const questionRec = this.asRecord(rec.question);
    const topLevelQuestionChoices =
      (Array.isArray(rec.options) ? rec.options.length : 0) +
      (Array.isArray(rec.choices) ? rec.choices.length : 0) +
      (Array.isArray(rec.actions) ? rec.actions.length : 0);

    return {
      type: this.firstNonEmptyString(
        rec.type,
        rec.responseType,
        rec.kind,
        rec.category,
      ),
      text: this.firstNonEmptyString(rec.text, rec.message, rec.content),
      planFile: this.firstNonEmptyString(planRec?.file),
      planContent: this.firstNonEmptyString(planRec?.content),
      planFiles: Array.isArray(planRec?.files) ? planRec.files.length : 0,
      questionType: this.firstNonEmptyString(questionRec?.type),
      questionText: this.firstNonEmptyString(questionRec?.question, rec.question),
      questionOptions:
        (Array.isArray(questionRec?.options) ? questionRec.options.length : 0) +
        (Array.isArray(questionRec?.choices) ? questionRec.choices.length : 0) +
        (Array.isArray(questionRec?.actions) ? questionRec.actions.length : 0) +
        topLevelQuestionChoices,
      interactiveEvents: Array.isArray(rec.interactiveEvents)
        ? rec.interactiveEvents.length
        : 0,
      progressUpdates: Array.isArray(rec.progressUpdates)
        ? rec.progressUpdates.length
        : 0,
      reasoning: Array.isArray(rec.reasoning) ? rec.reasoning.length : 0,
      fileChanges: Array.isArray(rec.fileChanges) ? rec.fileChanges.length : 0,
      subagents: Array.isArray(rec.subagents) ? rec.subagents.length : 0,
      subagentsDeltaItems: Array.isArray(this.asRecord(rec.subagentsDelta)?.items)
        ? (this.asRecord(rec.subagentsDelta)?.items as unknown[]).length
        : Array.isArray(this.asRecord(rec.subagents_delta)?.items)
          ? (this.asRecord(rec.subagents_delta)?.items as unknown[]).length
          : 0,
    };
  }

  private detectStructuredFieldDrops(
    rawRecord: Record<string, unknown>,
    processedRecord: Record<string, unknown>,
  ): {
    droppedSemanticFields: string[];
    droppedTopLevelKeys: string[];
  } {
    const rawSnapshot = this.getStructuredSemanticSnapshot(rawRecord);
    const processedSnapshot = this.getStructuredSemanticSnapshot(processedRecord);
    const droppedSemanticFields = Object.keys(rawSnapshot).filter((key) => {
      const rawValue = rawSnapshot[key];
      const processedValue = processedSnapshot[key];
      return (
        this.hasMeaningfulStructuredValue(rawValue) &&
        !this.hasMeaningfulStructuredValue(processedValue)
      );
    });

    const ignoredRawKeys = new Set([
      "raw",
      "type",
      "responseType",
      "message",
      "kind",
      "category",
      "content",
      "text",
      "options",
      "choices",
      "actions",
      "allowCustomInput",
      "multiSelect",
    ]);
    const droppedTopLevelKeys = Object.keys(rawRecord).filter((key) => {
      if (ignoredRawKeys.has(key)) {
        return false;
      }
      return this.hasMeaningfulStructuredValue(rawRecord[key]) && !(key in processedRecord);
    });

    return {
      droppedSemanticFields,
      droppedTopLevelKeys,
    };
  }

  private warnOnStructuredFieldDrop(
    rawRecord: Record<string, unknown>,
    processedRecord: Record<string, unknown>,
    context: {
      stage: "sanitized" | "normalized" | "salvaged";
      diagnostics?: {
        source?: string;
        providerID?: string;
        modelID?: string;
      };
      validationErrors?: string[];
    },
  ): void {
    const dropReport = this.detectStructuredFieldDrops(rawRecord, processedRecord);
    if (
      dropReport.droppedSemanticFields.length === 0 &&
      dropReport.droppedTopLevelKeys.length === 0
    ) {
      return;
    }

    const isNormalizedStage = context.stage === "normalized";
    const log = isNormalizedStage
      ? this.logger.info.bind(this.logger)
      : this.logger.warn.bind(this.logger);

    log(
      isNormalizedStage
        ? "Structured output normalized with field mapping"
        : "Structured output validation failed",
      {
      errors: context.validationErrors?.length
        ? context.validationErrors
        : ["structured payload lost fields during normalization"],
      reason: "field-drop-detected",
      stage: context.stage,
      source: context.diagnostics?.source,
      providerID: context.diagnostics?.providerID,
      modelID: context.diagnostics?.modelID,
      droppedSemanticFields: dropReport.droppedSemanticFields,
      droppedTopLevelKeys: dropReport.droppedTopLevelKeys,
      inputPreview: this.buildStructuredOutputLogPreview(rawRecord).preview,
      sanitizedPreview: this.buildStructuredOutputLogPreview(processedRecord).preview,
      hasResponseType: typeof rawRecord.responseType !== "undefined",
      responseTypeValue: rawRecord.responseType,
      hasMessage: typeof rawRecord.message !== "undefined",
      hasPlan: typeof rawRecord.plan !== "undefined",
      hasQuestion: typeof rawRecord.question !== "undefined",
      keys: Object.keys(rawRecord),
      },
    );
  }

  private logStructuredValidationFailureComparison(
    params: {
      rawInput: unknown;
      sanitizedRec: Record<string, unknown>;
      canonicalRec: Record<string, unknown>;
      diagnostics?: {
        source?: string;
        providerID?: string;
        modelID?: string;
      };
      candidates: Array<{ source: string; value: unknown }>;
      validationErrors: string[];
      responseTypeHintRaw?: string;
      messageCandidate?: string;
    },
  ): void {
    const processedSanitizedCanonical = sanitizeStructuredOutput(params.canonicalRec);

    this.logger.info("Structured output validation raw candidates", {
      source: params.diagnostics?.source,
      providerID: params.diagnostics?.providerID,
      modelID: params.diagnostics?.modelID,
      validationErrors: params.validationErrors,
      responseTypeHintRaw: params.responseTypeHintRaw,
      messageCandidatePreview: params.messageCandidate?.slice(0, 240),
      rawInput: this.buildStructuredOutputLogPreview(params.rawInput),
      candidates: params.candidates
        .map((candidate) => ({
          source: candidate.source,
          ...this.buildStructuredOutputLogPreview(candidate.value),
        }))
        .filter((candidate) => {
          const preview = candidate.preview.trim();
          return preview.length > 0 && preview !== "undefined" && preview !== "null";
        }),
    });

    this.logger.info("Structured output validation processed records", {
      source: params.diagnostics?.source,
      providerID: params.diagnostics?.providerID,
      modelID: params.diagnostics?.modelID,
      validationErrors: params.validationErrors,
      sanitizedRec: this.buildStructuredOutputLogPreview(params.sanitizedRec),
      canonicalRec: this.buildStructuredOutputLogPreview(params.canonicalRec),
      sanitizedCanonicalRec: this.buildStructuredOutputLogPreview(
        processedSanitizedCanonical,
      ),
    });
  }

  private finalizeStructuredOutput(
    rawRecord: Record<string, unknown>,
    normalizedRecord: Record<string, unknown>,
  ): StructuredAssistantOutput {
    const output: StructuredAssistantOutput = {
      ...(normalizedRecord as StructuredAssistantOutput),
    };

    const responseType = this.firstNonEmptyString(
      output.type,
      output.responseType,
      rawRecord.type,
      rawRecord.responseType,
    );
    if (responseType) {
      output.type = responseType;
      output.responseType = responseType;
    }

    const text = this.firstNonEmptyString(
      output.text,
      output.message,
      rawRecord.text,
      rawRecord.message,
      rawRecord.content,
    );
    if (text) {
      output.text = output.text ?? text;
      output.message = output.message ?? text;
    }

    return output;
  }

  private salvageStructuredOutput(
    value: unknown,
  ): StructuredAssistantOutput | undefined {
    const rec = this.asRecord(value);
    if (!rec) {
      return undefined;
    }

    const rawResponseType = this.firstNonEmptyString(
      rec.responseType,
      rec.type,
      rec.kind,
    );
    const normalizedResponseType = rawResponseType
      ? rawResponseType.toLowerCase() === "conversation"
          ? "message"
          : ["question", "interactive", "confirm", "quick_actions"].includes(rawResponseType.toLowerCase())
            ? undefined
            : rawResponseType.toLowerCase()
      : undefined;

    const message =
      this.firstNonEmptyString(rec.message, rec.content, rec.text) || undefined;

    const planRec = this.asRecord(rec.plan);
    const plan = planRec
      ? {
        file: this.firstNonEmptyString(planRec.file),
        files: Array.isArray(planRec.files) ? planRec.files : undefined,
        content: this.firstNonEmptyString(planRec.content),
        title: this.firstNonEmptyString(planRec.title),
        intro: this.firstNonEmptyString(planRec.intro),
        summary: this.firstNonEmptyString(planRec.summary),
        fileCount:
          typeof planRec.fileCount === "number" && Number.isFinite(planRec.fileCount)
            ? planRec.fileCount
            : undefined,
      }
      : undefined;
    const hasPlan = Boolean(
      plan &&
      (
        this.firstNonEmptyString(plan.file, plan.content) ||
        (Array.isArray(plan.files) && plan.files.length > 0)
      ),
    );

    const rawInteractiveEvents = Array.isArray(rec.interactiveEvents)
      ? (rec.interactiveEvents as StructuredAssistantOutput["interactiveEvents"])
      : undefined;

    const fileChanges = this.normalizeStructuredFileChangesForValidation(
      rec.fileChanges,
    );
    const subagents = Array.isArray(rec.subagents) ? rec.subagents : undefined;
    const subagentsDelta =
      rec.subagentsDelta && typeof rec.subagentsDelta === "object"
        ? rec.subagentsDelta
        : rec.subagents_delta && typeof rec.subagents_delta === "object"
          ? rec.subagents_delta
          : undefined;

    const effectiveResponseType =
      normalizedResponseType ||
      (hasPlan ? "implementation_plan" : undefined) ||
      (message ? "message" : undefined);

    if (
      !effectiveResponseType &&
      !message &&
      !hasPlan &&
      fileChanges.length === 0 &&
      !rawInteractiveEvents &&
      !subagents &&
      !subagentsDelta
    ) {
      return undefined;
    }

    return this.finalizeStructuredOutput(rec, {
      type: effectiveResponseType,
      text: message,
      responseType: effectiveResponseType,
      message,
      plan: hasPlan ? plan : undefined,
      fileChanges: fileChanges.length > 0 ? fileChanges : undefined,
      interactiveEvents: rawInteractiveEvents,
      subagents: subagents as StructuredAssistantOutput["subagents"] | undefined,
      subagentsDelta:
        subagentsDelta as StructuredAssistantOutput["subagentsDelta"] | undefined,
    });
  }

  /**
   * Runtime boundary for provider/model output.
   *
   * Even when we request json-schema output, providers can still return
   * malformed or legacy-shaped payloads. This method converts unknown input
   * into a canonical, validated `StructuredAssistantOutput` for the rest of
   * the app. If validation still fails, we return `undefined` so callers can
   * apply safe fallback behavior.
   */
  normalizeStructuredOutput(
    raw: unknown,
    diagnostics?: {
      source?: string;
      providerID?: string;
      modelID?: string;
    },
  ): StructuredAssistantOutput | undefined {
    let value: unknown = raw;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        return undefined;
      }
    }

    const rec = this.asRecord(value);
    if (!rec) {
      return undefined;
    }

    // First-pass sanitation normalizes legacy aliases to schema field names.
    const sanitizedRec = sanitizeStructuredOutput(rec);
    this.warnOnStructuredFieldDrop(rec, sanitizedRec, {
      stage: "sanitized",
      diagnostics,
    });

    // Don't sanitize rec.plan separately - sanitizeStructuredOutput() is for
    // top-level structured output fields only. The plan object is already validated
    // by the schema and sanitizing it as a top-level object would strip its properties
    // (file, title, content, etc.) because those aren't valid top-level field names.
    this.logger.debug('Before plan preservation', {
      hasRecPlan: 'plan' in rec,
      recPlanType: typeof rec.plan,
      recPlanValue: rec.plan,
      hasSanitizedPlan: 'plan' in sanitizedRec,
      sanitizedPlanValue: sanitizedRec.plan
    });

    if (rec.plan && typeof rec.plan === 'object') {
      sanitizedRec.plan = rec.plan;
      const planRecord = rec.plan as Record<string, unknown>;
      this.logger.debug('Plan preserved', {
        planKeys: Object.keys(planRecord),
        hasFile: 'file' in planRecord,
        fileValue: planRecord.file
      });
    } else {
      this.logger.debug('Plan NOT preserved - condition failed', {
        hasRecPlan: 'plan' in rec,
        recPlanType: typeof rec.plan,
        recPlan: rec.plan
      });
    }

    const responseTypeHintRaw = this.firstNonEmptyString(
      sanitizedRec.type,
      sanitizedRec.responseType,
      rec.type,
      rec.kind,
      rec.category,
    );
    const responseTypeHint = responseTypeHintRaw?.toLowerCase();

    const strictMessageCandidate =
      this.firstNonEmptyString(sanitizedRec.text, sanitizedRec.message) ||
      (typeof rec.text === "string"
        ? rec.text
        : typeof rec.message === "string"
          ? rec.message
          : undefined);
    const aliasMessageCandidate = this.firstNonEmptyString(
      strictMessageCandidate,
      sanitizedRec.content,
      rec.content,
      sanitizedRec.output,
      rec.output,
      sanitizedRec.detail,
      rec.detail,
    );

    // Some providers return responseType="message" but put the body in content/text/output.
    // Accept those aliases so regular replies keep structured JSON instead of being dropped.
    let messageCandidate = strictMessageCandidate;
    if (
      !messageCandidate &&
      (!responseTypeHint ||
        responseTypeHint === "message" ||
        responseTypeHint === "conversation")
    ) {
      messageCandidate = aliasMessageCandidate;
    }

    let responseTypeRaw =
      responseTypeHintRaw || (messageCandidate ? "message" : undefined);

    if (responseTypeRaw?.toLowerCase() === "conversation") {
      responseTypeRaw = "message";
    }
    if (responseTypeRaw?.toLowerCase() === "interactive") {
      responseTypeRaw = "question";
    }
    if (responseTypeRaw?.toLowerCase() === "message" && !messageCandidate) {
      messageCandidate = aliasMessageCandidate;
    }

    if (
      responseTypeRaw &&
      !STRUCTURED_RESPONSE_TYPES.has(responseTypeRaw.toLowerCase())
    ) {
      responseTypeRaw = messageCandidate ? "message" : undefined;
    }

    if (!responseTypeRaw) {
      return undefined;
    }

    let canonicalRec: Record<string, unknown> = {
      ...sanitizedRec,
      type: responseTypeRaw,
    };
    // Normalize fileChanges before schema validation so malformed provider
    // values (ex: diffExcerpt.lines as string) don't cause the whole payload
    // to be downgraded to message-only fallback.
    const normalizedFileChanges = this.normalizeStructuredFileChangesForValidation(
      canonicalRec.fileChanges ?? rec.fileChanges,
    );
    if (normalizedFileChanges.length > 0) {
      canonicalRec.fileChanges = normalizedFileChanges;
    }
    if (
      messageCandidate &&
      !this.firstNonEmptyString(canonicalRec.text)
    ) {
      canonicalRec.text = messageCandidate;
    }

    const canonicalResponseType = this.firstNonEmptyString(
      canonicalRec.type,
    )?.toLowerCase();
    if (canonicalResponseType === "implementation_plan") {
      const existingPlan = this.asRecord(canonicalRec.plan) ?? this.asRecord(rec.plan);
      if (existingPlan) {
        let ensuredPlanFile = this.firstNonEmptyString(existingPlan.file);
        if (!ensuredPlanFile && Array.isArray(existingPlan.files)) {
          for (const entry of existingPlan.files) {
            const candidate = this.firstNonEmptyString(entry);
            if (candidate) {
              ensuredPlanFile = candidate;
              break;
            }
          }
        }

        if (ensuredPlanFile) {
          const planFiles = Array.isArray(existingPlan.files)
            ? existingPlan.files
                .map((entry) => this.firstNonEmptyString(entry))
                .filter((entry): entry is string => Boolean(entry))
            : [];
          const nextPlan: Record<string, unknown> = {
            ...existingPlan,
            file: ensuredPlanFile,
          };
          if (!planFiles.includes(ensuredPlanFile)) {
            nextPlan.files = [ensuredPlanFile, ...planFiles];
          } else {
            nextPlan.files = planFiles;
          }
          canonicalRec.plan = nextPlan;
        }
      }
    }

    let validation = validateStructuredOutput(canonicalRec);
    if (!validation.valid) {
      const candidatePlan = this.asRecord(canonicalRec.plan) ?? this.asRecord(rec.plan);
      const planFile =
        candidatePlan && typeof candidatePlan.file === "string"
          ? candidatePlan.file.trim()
          : "";
      if (planFile && canonicalResponseType !== "implementation_plan") {
        const planFiles = Array.isArray(candidatePlan?.files)
          ? candidatePlan.files
              .map((entry) => this.firstNonEmptyString(entry))
              .filter((entry): entry is string => Boolean(entry))
          : [];
        canonicalRec = {
          ...canonicalRec,
          type: "implementation_plan",
          plan: {
            ...candidatePlan,
            file: planFile,
            files: planFiles.includes(planFile)
              ? planFiles
              : [planFile, ...planFiles],
          },
        };
        validation = validateStructuredOutput(canonicalRec);
      }
    }
    if (!validation.valid && messageCandidate) {
      canonicalRec = {
        type: "message",
        text: messageCandidate,
      };
      validation = validateStructuredOutput(canonicalRec);
    }
    if (!validation.valid) {
      this.logStructuredValidationFailureComparison({
        rawInput: raw,
        sanitizedRec,
        canonicalRec,
        diagnostics,
        candidates: [
          { source: "raw", value: raw },
          { source: "sanitizedRec", value: sanitizedRec },
          { source: "canonicalRec", value: canonicalRec },
        ],
        validationErrors: validation.errors,
        responseTypeHintRaw,
        messageCandidate,
      });
      this.recordStructuredValidationFailure(
        canonicalRec,
        validation.errors,
        diagnostics,
      );
      const salvaged = this.salvageStructuredOutput(rec);
      if (salvaged) {
        this.warnOnStructuredFieldDrop(
          rec,
          salvaged as Record<string, unknown>,
          {
            stage: "salvaged",
            diagnostics,
            validationErrors: validation.errors,
          },
        );
      }
      return salvaged ? this.finalizeStructuredOutput(rec, salvaged) : undefined;
    }

    const sanitizedCanonicalRec = sanitizeStructuredOutput(canonicalRec);
    const subagentsRaw =
      sanitizedCanonicalRec.subagents ?? (rec.spawnedSubagents as unknown);
    if (Array.isArray(subagentsRaw)) {
      sanitizedCanonicalRec.subagents = subagentsRaw;
    }
    const subagentsDeltaRaw =
      sanitizedCanonicalRec.subagentsDelta ?? (rec.subagents_delta as unknown);
    if (subagentsDeltaRaw && typeof subagentsDeltaRaw === "object") {
      sanitizedCanonicalRec.subagentsDelta = subagentsDeltaRaw;
    }
    const responseType = this.firstNonEmptyString(
      sanitizedCanonicalRec.type,
      sanitizedCanonicalRec.responseType,
    );
    if (!responseType) {
      return undefined;
    }

    this.warnOnStructuredFieldDrop(rec, sanitizedCanonicalRec, {
      stage: "normalized",
      diagnostics,
    });

    return this.finalizeStructuredOutput(
      rec,
      sanitizedCanonicalRec,
    );
  }

  /**
   * Coerce provider file-change payloads into a schema-compatible shape.
   * This keeps strong validation while tolerating common wire-format glitches.
   */
  private normalizeStructuredFileChangesForValidation(
    value: unknown,
  ): NonNullable<StructuredAssistantOutput["fileChanges"]> {
    if (!Array.isArray(value)) {
      return [];
    }
    const out: NonNullable<StructuredAssistantOutput["fileChanges"]> = [];
    for (const item of value) {
      const rec = this.asRecord(item);
      if (!rec) {
        continue;
      }
      const file = this.firstNonEmptyString(rec.file);
      if (!file) {
        continue;
      }

      const next: NonNullable<StructuredAssistantOutput["fileChanges"]>[number] = {
        file,
      };
      const kind = this.firstNonEmptyString(rec.kind);
      if (kind) {
        next.kind = kind;
      }

      const diffStatsRec = this.asRecord(rec.diffStats);
      if (diffStatsRec) {
        const added = Number(diffStatsRec.added);
        const deleted = Number(diffStatsRec.deleted);
        next.diffStats = {
          added: Number.isFinite(added) ? added : 0,
          deleted: Number.isFinite(deleted) ? deleted : 0,
        };
      }

      const diffExcerptRec = this.asRecord(rec.diffExcerpt);
      if (diffExcerptRec) {
        const header = this.firstNonEmptyString(diffExcerptRec.header);
        const rawLines = diffExcerptRec.lines;
        const lines = Array.isArray(rawLines)
          ? rawLines
              .map((line) => (typeof line === "string" ? line : String(line ?? "")))
              .filter((line) => line.trim().length > 0)
          : typeof rawLines === "string"
            ? []
            : [];
        const excerpt: NonNullable<
          NonNullable<StructuredAssistantOutput["fileChanges"]>[number]["diffExcerpt"]
        > = {
          lines,
        };
        if (header) {
          excerpt.header = header;
        }
        const added = Number(diffExcerptRec.added);
        const deleted = Number(diffExcerptRec.deleted);
        if (Number.isFinite(added)) {
          excerpt.added = added;
        }
        if (Number.isFinite(deleted)) {
          excerpt.deleted = deleted;
        }
        next.diffExcerpt = excerpt;
      }

      out.push(next);
    }
    if (out.length > 0) {
      this.logger.info("[DIFF PREVIEW] normalized structured fileChanges", {
        inputCount: value.length,
        outputCount: out.length,
      });
    }
    return out;
  }

  /**
   * Create fallback message from structured output
   */
  createFallbackMessage(
    structured: StructuredAssistantOutput,
  ): string | undefined {
    if (!structured.type && !structured.responseType) return undefined;

    const { type, responseType, progressUpdates, interactiveEvents, plan } =
      structured;
    const responseKind = this.firstNonEmptyString(type, responseType);

    switch (responseKind) {
      case "implementation_plan":
        return this.firstNonEmptyString(
          plan?.intro,
          plan?.summary,
          plan?.title,
        );
      case "progress_update":
        if (progressUpdates && progressUpdates.length > 0) {
          const titles = progressUpdates.map((p) => p.title).join(", ");
          return `Progress: ${titles}`;
        }
        return "📊 Working on tasks...";
      case "subagents":
        return "🤖 Subagents...";
      case "error":
        return "⚠️ An error occurred";
      case "message":
      default:
        return undefined;
    }
  }

  /**
   * Extract message body text
   */
  extractMessageBodyText(message: any): string {
    if (!message) return "";

    let rawText = "";
    if (typeof message.content === "string" && message.content.trim()) {
      rawText = message.content.trim();
    } else if (typeof message.text === "string" && message.text.trim()) {
      rawText = message.text.trim();
    } else if (Array.isArray(message.parts)) {
      rawText = message.parts
        .map((part: any) => {
          if (!part || typeof part !== "object") return "";
          if (
            part.type === "reasoning" ||
            part.type === "thinking" ||
            part.type === "thought" ||
            typeof part.reasoning !== "undefined" ||
            typeof part.thought !== "undefined" ||
            typeof part.thinking !== "undefined"
          ) {
            return "";
          }
          return (part.text || part.content || "").toString();
        })
        .join(" ")
        .trim();
    }

    if (this.isLikelyToolCallTranscript(rawText)) {
      return "";
    }
    return rawText;
  }

  /**
   * Extract structured output from message
   */
  extractStructuredOutput(message: any): StructuredAssistantOutput | undefined {
    if (!message) return undefined;

    const rawResponseRec = this.parseRawResponseRecord(message.rawResponse);
    const rawResponseInfoRec = this.asRecord(rawResponseRec?.info);
    const candidates = [
      message.structured,
      message.info?.structured,
      message.info?.structuredOutput,
      rawResponseRec?.structured,
      rawResponseRec?.structuredOutput,
      rawResponseInfoRec?.structured,
      rawResponseInfoRec?.structuredOutput,
      message.structuredOutput,
      message.structured_output,
    ];

    let matchIdx = -1;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (candidate) {
        const normalized = this.normalizeStructuredOutput(candidate);
        if (normalized) {
          matchIdx = i;
          const sourceLabels = ["message.structured","info.structured","info.structuredOutput","rawResponse.structured","rawResponse.structuredOutput","rawResponseInfo.structured","rawResponseInfo.structuredOutput","message.structuredOutput","message.structured_output"];
          this.logger.debug("[CLIENT FACING] StructOutputProcessor.extractStructuredOutput MATCH", {
            messageId: message?.id || message?.info?.id,
            matchIndex: i,
            matchSource: sourceLabels[i] || `candidate-${i}`,
            responseType: normalized.type || normalized.responseType,
            messagePreview: String(normalized.text ?? normalized.message).slice(0, 200),
            totalCandidates: candidates.length,
          });
          return normalized;
        }
      }
    }
    this.logger.debug("[CLIENT FACING] StructOutputProcessor.extractStructuredOutput NO MATCH", {
      messageId: message?.id || message?.info?.id,
      hasRawResponse: !!message?.rawResponse,
      hasStructOutput: !!message?.structuredOutput,
      hasStruct: !!message?.structured,
      hasInfo: !!message?.info,
      structOutputMsg: String(message?.structuredOutput?.text ?? message?.structuredOutput?.message).slice(0, 200),
      rawResponsePreview: String(message?.rawResponse).slice(0, 200),
    });

    return undefined;
  }

  /**
   * Apply structured output to message
   */
  applyStructuredOutputToMessage(
    message: any,
    structured: StructuredAssistantOutput,
  ): any {
    if (!message || !structured) return message;

    const updated = { ...message };
    const fallbackMessage = this.createFallbackMessage(structured);

    const structuredText = this.firstNonEmptyString(structured.text, structured.message);
    if (structuredText) {
      this.logger.debug("[CLIENT FACING] StructOutputProcessor.applyStructured SET_CONTENT", {
        messageId: message?.id || message?.info?.id,
        oldContent: String(message?.content).slice(0, 200),
        structMessage: String(structuredText).slice(0, 200),
        responseType: structured.type || structured.responseType,
      });
      updated.message = structuredText;
      updated.content = structuredText;
      updated.text = structuredText;
    } else if (fallbackMessage && !updated.content) {
      // Structured response types like plan carry display text in
      // plan.summary/intro rather than in a top-level message field. Populate
      // content from the fallback so the webview renders structured fields instead
      // of concatenating raw response parts.
      updated.content = fallbackMessage;
      if (!updated.message) {
        updated.message = fallbackMessage;
      }
    }

    if (structured.subagents && structured.subagents.length > 0) {
      updated.subagents = this.mergeSubagentEntries(
        updated.subagents || [],
        structured.subagents,
      );
    }

    if (structured.progressUpdates && structured.progressUpdates.length > 0) {
      updated.progressUpdates = [
        ...(updated.progressUpdates || []),
        ...structured.progressUpdates,
      ];
    }

    if (structured.interactiveEvents && structured.interactiveEvents.length > 0) {
      updated.interactiveEvents = [
        ...(updated.interactiveEvents || []),
        ...structured.interactiveEvents,
      ];
    }

    if (structured.plan && !updated.plan) {
      updated.plan = structured.plan;
    }

    if (structured.walkthrough && !updated.walkthrough) {
      updated.walkthrough = structured.walkthrough;
    }

    if (structured.reasoning && structured.reasoning.length > 0) {
      updated.reasoning = [...(updated.reasoning || []), ...structured.reasoning];
    }

    updated.structuredOutput = structured;
    updated.hasStructuredOutput = true;

    return updated;
  }

  /**
   * Enrich stream event with structured output
   */
  enrichStreamEvent(event: any): any {
    if (!event) return event;

    const enriched = { ...event };
    const properties = enriched.properties || {};
    const part = properties.part || {};

    const structuredCandidate =
      part.structured ||
      part.structured_output ||
      properties.structured ||
      properties.structured_output;

    if (structuredCandidate) {
      const normalized = this.normalizeStructuredOutput(structuredCandidate);
      if (normalized) {
        enriched.structured = normalized;
        enriched.structuredOutput = normalized;
        enriched.hasStructuredOutput = true;
      }
    }

    return enriched;
  }

  /**
   * Enrich message with plan information
   */
  async enrichMessageWithPlan(
    message: any,
    options?: { createActivityWalkthrough?: boolean },
  ): Promise<any> {
    if (!message) return message;

    const role = message?.info?.role || message?.role;
    if (typeof role === "string" && role.toLowerCase() !== "assistant") {
      return message;
    }

    const structured = this.extractStructuredOutput(message);

    const structuredResponseType = this.firstNonEmptyString(
      structured?.type,
      structured?.responseType,
      message?.structuredOutput?.type,
      message?.structuredOutput?.responseType,
    );
    const hasInteractiveEvents =
      (Array.isArray(structured?.interactiveEvents) &&
        structured.interactiveEvents.length > 0) ||
      (Array.isArray(message?.interactiveEvents) &&
        message.interactiveEvents.length > 0);
    const isInteractiveClarificationResponse =
      this.isInteractiveResponseType(structuredResponseType) &&
      hasInteractiveEvents;

    if (isInteractiveClarificationResponse) {
      if (message.plan) {
        this.logger.debug("Plan suppressed", {
          source: "enrichMessageWithPlan",
          reason: "interactive-wins",
          responseType: structuredResponseType || "unknown",
          hasInteractiveEvents: !!hasInteractiveEvents,
          isClarification: false,
        });
        const nextMessage = { ...message };
        delete nextMessage.plan;
        return nextMessage;
      }
      return message;
    }

    if (options?.createActivityWalkthrough) {
      message = await this.ensureActivityWalkthrough(message);
    }

    if (structured) {
      const structuredWalkthrough = this.asRecord(structured.walkthrough);
      if (structuredWalkthrough) {
        const walkthroughFile = this.firstNonEmptyString(structuredWalkthrough.file);
        const walkthroughContent = this.firstNonEmptyString(structuredWalkthrough.content);
        if (walkthroughFile && walkthroughContent) {
          try {
            await this.persistPlan(walkthroughContent, walkthroughFile);
          } catch (err) {
            this.logger.error("Failed to persist structured walkthrough", {}, err as Error);
          }
        }
        message = {
          ...message,
          walkthrough: structured.walkthrough,
        };
      }
      const structuredPlanRecord = this.asRecord(structured.plan);
      const structuredPlanContent = this.firstNonEmptyString(
        structuredPlanRecord?.content,
      );
      const structuredPlanFiles =
        this.planManager.collectPlanFileCandidatesFromStructuredPlan(structuredPlanRecord);
      const structuredPlanFile = structuredPlanFiles[0];

      this.logger.debug("Structured plan data", {
        hasFile: !!structuredPlanRecord?.file,
        fileCount: structuredPlanFiles.length,
        structuredKeys: Object.keys(structured || {}).length
      });

      // Resolve the plan filename: prefer what the agent declared in structured
      // output, then look for a matching filename in the message edits/patches,
      // then from markdown references. The viewer reads this to load the live
      // file from disk so the user sees the exact content the agent wrote.
      const editsForPlan: any[] = message.edits || [];
      const partsForPlan: any[] = message.parts || [];
      const fileCandidatesFromEditsAndParts: string[] = [];
      for (const edit of editsForPlan) {
        if (this.planManager.isLikelyPlanMarkdownFile(edit?.file)) {
          fileCandidatesFromEditsAndParts.push(edit.file);
        }
      }
      for (const part of partsForPlan) {
        if (part?.type !== "patch" || !Array.isArray(part.files)) {
          continue;
        }
        for (const patchFile of part.files) {
          if (this.planManager.isLikelyPlanMarkdownFile(patchFile)) {
            fileCandidatesFromEditsAndParts.push(patchFile);
          }
        }
      }
      const mergedPlanFiles = this.planManager.prioritizePlanFileCandidates([
        ...structuredPlanFiles,
        ...fileCandidatesFromEditsAndParts,
        ...this.planManager.extractMarkdownFileReferences(structuredPlanContent),
        ...this.planManager.extractMarkdownFileReferences(structuredPlanRecord?.summary),
        ...this.planManager.extractMarkdownFileReferences(structuredPlanRecord?.title),
      ]);
      const resolvedPlanFile = mergedPlanFiles[0];

      this.logger.debug("Plan file extraction", {
        structuredPlanFile: structuredPlanFiles[0],
        mergedPlanFilesCount: mergedPlanFiles.length,
        resolvedPlanFile,
        fallbackPlanFile: resolvedPlanFile,
        hasPlanContent: !!structuredPlanContent,
        planContentLength: structuredPlanContent?.length || 0,
      });
      const resolvedPlanTitle = this.planManager.resolvePlanTitle({
        plan: { title: this.firstNonEmptyString(structuredPlanRecord?.title) },
        fallback: this.firstNonEmptyString(structuredPlanRecord?.summary),
        planFile: resolvedPlanFile,
      });
      const fallbackPlanFile = resolvedPlanFile;

      // Check if the plan file actually exists on disk
      let planFileExists = false;
      const planFileExistenceCandidates = resolvedPlanFile
        ? this.planManager.resolvePlanFileCandidates(resolvedPlanFile)
        : [];
      for (const candidate of planFileExistenceCandidates) {
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
          planFileExists = true;
          break;
        } catch {
          // File doesn't exist, need to persist it
          planFileExists = false;
        }
      }

      if (
        structuredPlanContent &&
        typeof structuredPlanContent === "string" &&
        structuredPlanContent.trim().length > 0
      ) {
        if (this.isClarificationQuestionnaire(structuredPlanContent)) {
          return message;
        }
        // Persist the plan if the file doesn't exist, even if we have a file path
        if (!planFileExists) {
          try {
            await this.persistPlan(
              structuredPlanContent,
              fallbackPlanFile,
            );
          } catch (err) {
            this.logger.error("Failed to auto-persist structured plan", {}, err as Error);
          }
        }

        return {
          ...message,
          structuredOutput: structured,
          plan: {
            file: fallbackPlanFile,
            content: structuredPlanContent,
            title: resolvedPlanTitle,
            summary: this.firstNonEmptyString(structuredPlanRecord?.summary),
            files:
              mergedPlanFiles.length > 0
                ? mergedPlanFiles
                : fallbackPlanFile
                  ? [fallbackPlanFile]
                  : undefined,
            fileCount:
              mergedPlanFiles.length > 0
                ? mergedPlanFiles.length
                : fallbackPlanFile
                  ? 1
                  : 0,
          },
        };
      }

      if (
        structuredResponseType === "implementation_plan" &&
        structuredPlanFile
      ) {
        // For file-only plans, always materialize a markdown file when missing.
        if (!planFileExists) {
          const fallbackMarkdown = this.buildFallbackPlanMarkdown({
            title: resolvedPlanTitle,
            summary: this.firstNonEmptyString(structuredPlanRecord?.summary),
            messageText: this.firstNonEmptyString(
              structured?.text,
              structured?.message,
              message?.content,
            ),
          });
          const contentToPersist =
            this.firstNonEmptyString(structuredPlanContent) || fallbackMarkdown;
          try {
            await this.persistPlan(
              contentToPersist,
              fallbackPlanFile,
            );
          } catch (err) {
            this.logger.error("Failed to auto-persist file-only plan", {}, err as Error);
          }
        }

        // Preserve structured file-only plans so the webview "View Plan" action
        // can open the plan tab directly from disk.
        return {
          ...message,
          structuredOutput: structured,
          plan: {
            file: fallbackPlanFile,
            title: resolvedPlanTitle,
            summary: this.firstNonEmptyString(structuredPlanRecord?.summary),
            files:
              mergedPlanFiles.length > 0
                ? mergedPlanFiles
                : fallbackPlanFile
                  ? [fallbackPlanFile]
                  : undefined,
            fileCount:
              mergedPlanFiles.length > 0
                ? mergedPlanFiles.length
                : fallbackPlanFile
                  ? 1
                  : 0,
          },
        };
      }
    }

    const normalizedStructuredResponseType = (structuredResponseType || "")
      .toLowerCase()
      .trim();
    // Hardened behavior: when providers emit plan-like content as plain
    // `responseType="message"` (or omit responseType), still run fallback plan
    // heuristics below so we can promote into `plan`.
    //
    // We still do NOT run fallback plan heuristics for non-message structured
    // families (question/progress/etc.) to avoid cross-family misclassification.
    const shouldRunFallbackPlanHeuristics =
      !normalizedStructuredResponseType ||
      normalizedStructuredResponseType === "implementation_plan" ||
      normalizedStructuredResponseType === "message";

    if (!shouldRunFallbackPlanHeuristics) {
      // During hydration, if the message already has a plan field from a previous
      // enrichment, preserve it instead of removing it. This ensures that implementation
      // plans loaded from storage are still displayed in the UI even if the structured
      // output recognition fails during hydration.
      if (message.plan) {
        // Check if this looks like a valid plan that was previously enriched
        const planRec = this.asRecord(message.plan);
        const hasValidPlanFields =
          (this.firstNonEmptyString(planRec?.file) || this.firstNonEmptyString(planRec?.content)) &&
          (this.firstNonEmptyString(planRec?.title) || this.firstNonEmptyString(planRec?.summary));

        if (hasValidPlanFields) {
          // Preserve the existing plan - it's likely from a previous enrichment
          return message;
        }

        // Remove invalid plan objects
        const nextMessage = { ...message };
        delete nextMessage.plan;
        return nextMessage;
      }
      return message;
    }

    // Check for implementation plan in edits, parts, or message content
    const edits = message.edits || [];
    const parts = message.parts || [];
    const info = message.info || {};

    // 1. Gather text body and fallback plan-like content in message summary,
    // parts, or plain content.
    const partsContent = parts
      .filter((p: any) => this.isRenderableTextPart(p)) // ignore reasoning parts directly
      .map((p: any) => {
        let c = p.text || p.content || "";
        if (p.files && Array.isArray(p.files)) c += " " + p.files.join(" ");
        return c;
      })
      .join(" ");

    // 2. Check for explicit markdown filenames in edits/parts/text.
    const extractedPlanFiles = this.planManager.prioritizePlanFileCandidates([
      ...edits
        .map((e: any) => this.firstNonEmptyString(e?.file))
        .filter(
          (file: unknown): file is string =>
            !!file && this.planManager.isLikelyPlanMarkdownFile(file),
        ),
      ...parts
        .filter((p: any) => p.type === "patch" && Array.isArray(p.files))
        .flatMap((p: any) =>
          (p.files as unknown[])
            .map((f) => this.firstNonEmptyString(f))
            .filter(
              (file: unknown): file is string =>
                !!file && this.planManager.isLikelyPlanMarkdownFile(file),
            ),
        ),
      ...this.planManager.extractMarkdownFileReferences(message?.content),
      ...this.planManager.extractMarkdownFileReferences(info.summary?.title),
      ...this.planManager.extractMarkdownFileReferences(info.summary?.body),
      ...this.planManager.extractMarkdownFileReferences(partsContent),
    ]);
    const hasPlanFile = extractedPlanFiles.length > 0;

    const fullContent =
      (info.summary?.title || "") +
      " " +
      (info.summary?.body || "") +
      " " +
      (message.content || "") +
      " " +
      partsContent;

    // Broadened regex to catch more variations of "Implementation Plan"
    // Also check if the title itself strongly indicates a plan
    const basicPlanKeywordMatch =
      /implementation\s*plan/i.test(fullContent) ||
      /goal\s*description/i.test(fullContent) ||
      /proposed\s*changes/i.test(fullContent) ||
      /plan\.md/i.test(fullContent) ||
      (/(plan|roadmap)/i.test(info.summary?.title || "") &&
        /(implementation|feature)/i.test(info.summary?.title || ""));

    // Require structural markers to avoid false positives from short mentions
    const hasStructuralMarkers =
      /##\s|###\s|- \[ \]|Files:|Steps:|Goal:/i.test(fullContent) ||
      // Long content is likely a real plan even if markers are missing
      fullContent.length > 500;

    const hasPlanKeywords = basicPlanKeywordMatch && hasStructuralMarkers;
    const looksLikeClarificationQuestions =
      this.isClarificationQuestionnaire(fullContent);

    // If the content looks like a clarification questionnaire, never promote it
    // into an implementation plan. If a plan was already attached, strip it.
    if (looksLikeClarificationQuestions) {
      if (message.plan) {
        this.logger.debug("Plan suppressed", {
          source: "enrichMessageWithPlan",
          reason: "clarification-detected",
          responseType: structuredResponseType || "unknown",
          hasInteractiveEvents: !!hasInteractiveEvents,
          isClarification: true,
        });
        const nextMessage = { ...message };
        delete nextMessage.plan;
        return nextMessage;
      }
      return message;
    }

    if (hasPlanFile || hasPlanKeywords) {
      // Extract and clean the plan content using the PlanParser
      let rawContent = message.content || partsContent;

      // If the AI structured output placed the overarching title in the summary but not the text, inject it as the H1
      const summaryTitle = info.summary?.title;
      if (summaryTitle && !rawContent.includes(summaryTitle)) {
        rawContent = `# ${summaryTitle}\n\n${rawContent}`;
      }

      const parsed = PlanParser.parse(rawContent);
      const cleanPlanContent = PlanParser.toMarkdown(parsed);
      const existingStructured = this.asRecord(message.structuredOutput);
      const existingStructuredPlan = this.asRecord(existingStructured?.plan);
      const resolvedPlanTitle = this.planManager.resolvePlanTitle({
        plan: {
          title: this.firstNonEmptyString(
            existingStructuredPlan?.title,
            message?.plan?.title,
          ),
        },
        fallback: parsed.goal,
        planFile: extractedPlanFiles[0],
      });
      const fallbackPlanFile = extractedPlanFiles[0];

      // PERSISTENCE: Automatically save the cleaned plan to disk.
      // This ensures handleViewPlan can read it even if the SDK didn't write it.
      // We only persist if it actually looks like a valid plan (has a goal or files/steps).
      if (
        cleanPlanContent.length > 100 &&
        (parsed.goal || parsed.files.length > 0 || parsed.steps.length > 0)
      ) {
        if (!extractedPlanFiles[0]) {
          this.persistPlan(
            cleanPlanContent,
            fallbackPlanFile,
          ).catch((err) => {
            this.logger.error("Failed to auto-persist cleaned plan", {}, err as Error);
          });
        }
      }

      const nextMessage = {
        ...message,
        plan: {
          file: fallbackPlanFile,
          content: cleanPlanContent,
          title: resolvedPlanTitle,
          intro: this.firstNonEmptyString(existingStructuredPlan?.intro, parsed.description),
          summary: parsed.description,
          files:
            extractedPlanFiles.length > 0
              ? extractedPlanFiles
              : fallbackPlanFile
                ? [fallbackPlanFile]
                : undefined,
          fileCount:
            parsed.files.length ||
            extractedPlanFiles.length ||
            (fallbackPlanFile ? 1 : 0),
        },
      };
      const nextStructured: Record<string, unknown> = existingStructured
        ? { ...existingStructured }
        : {};
      nextStructured.responseType = "implementation_plan";
      nextStructured.plan = {
        ...(existingStructuredPlan || {}),
        file:
          fallbackPlanFile ??
          this.firstNonEmptyString(existingStructuredPlan?.file),
        files:
          extractedPlanFiles.length > 0
            ? extractedPlanFiles
            : fallbackPlanFile
              ? [fallbackPlanFile]
              : existingStructuredPlan?.files,
        content: cleanPlanContent,
        title: resolvedPlanTitle,
        intro: this.firstNonEmptyString(existingStructuredPlan?.intro, parsed.description),
        summary:
          parsed.description ||
          this.firstNonEmptyString(existingStructuredPlan?.summary),
      };
      nextMessage.structuredOutput = nextStructured;
      if (message?.structuredOutput?.responseType !== "implementation_plan") {
        const planIntro = this.firstNonEmptyString(
          nextStructured.message,
          this.asRecord(nextStructured.plan)?.intro,
          this.asRecord(nextStructured.plan)?.summary,
        );
        if (planIntro) {
          nextStructured.message = planIntro;
          nextMessage.content = planIntro;
          const parts = Array.isArray(nextMessage.parts)
            ? [...nextMessage.parts]
            : [];
          const textIndex = parts.findIndex(
            (part: any) => this.isRenderableTextPart(part),
          );
          if (textIndex >= 0) {
            parts[textIndex] = {
              ...parts[textIndex],
              type: "text",
              text: planIntro,
            };
          } else {
            parts.push({ type: "text", text: planIntro });
          }
          nextMessage.parts = parts;
        }
      }
      return nextMessage;
    }

    return message;
  }
}
