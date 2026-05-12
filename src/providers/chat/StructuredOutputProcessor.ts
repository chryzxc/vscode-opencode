/**
 * StructuredOutputProcessor Module
 *
 * Handles all structured output parsing, normalization, validation,
 * and message enrichment.
 *
 * Extracted from ChatViewProvider.ts (~900 lines across multiple sections)
 */

import * as vscode from "vscode";
import type {
  StructuredAssistantOutput,
} from "./types";
import {
  structuredOutputSchema,
} from "../../shared/structuredOutputSchema";
import {
  sanitizeStructuredOutput,
  validateStructuredOutput,
} from "../../shared/structuredOutputValidator";
import { STRUCTURED_RESPONSE_TYPES } from "./types";
import type { PlanManager } from "./PlanManager";
import { PlanParser } from "../../services/PlanParser";

export class StructuredOutputProcessor {
  private structuredOutputMode: "format" | "outputFormat" | "disabled" = "format";
  private readonly structuredValidationFailureCounters = new Map<string, number>();
  private readonly structuredOutputIncompatibleModelKeys = new Set<string>();

  constructor(
    private logger: ReturnType<typeof import("../../utils/Logger").createLogger>,
    private asRecord: (value: unknown) => Record<string, unknown> | undefined,
    private firstNonEmptyString: (...values: unknown[]) => string | undefined,
    private planManager: PlanManager,
  ) { }

  private persistPlan(
    content: string,
    preferredPath?: string,
  ): Promise<string | undefined> {
    return this.planManager.persistPlan(content, preferredPath);
  }

  /**
   * Get the structured output format for API requests
   */
  getStructuredOutputFormat(): Record<string, unknown> {
    const topLevel = structuredOutputSchema as unknown as Record<string, unknown>;
    const schemaRecord = this.asRecord(topLevel.schema);
    const properties = this.asRecord(schemaRecord?.properties) ?? {};
    const required = Array.isArray(schemaRecord?.required)
      ? (schemaRecord?.required as string[]).filter(
        (item) => typeof item === "string" && item.trim().length > 0,
      )
      : ["responseType"];
    const allOf = Array.isArray(schemaRecord?.allOf)
      ? schemaRecord.allOf
      : undefined;

    // Send a docs-style minimal JSON schema to maximize compatibility across providers.
    return {
      type: "json_schema",
      retryCount:
        typeof topLevel.retryCount === "number" ? topLevel.retryCount : 1,
      schema: {
        type: "object",
        properties,
        required,
        ...(allOf ? { allOf } : {}),
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

  /**
   * Get the structured output model key
   */
  getStructuredOutputModelKey(modelKey: string): string {
    if (this.structuredOutputMode === "outputFormat") {
      return modelKey;
    }
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
    return str === "question" || str === "interactive" || str === "confirm";
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
      (Array.isArray(rec.interactiveEvents) ? rec.interactiveEvents : undefined) ||
      (Array.isArray(rec.question) ? [{ type: "question", question: rec.question }] : undefined);

    if (!interactiveEvents || interactiveEvents.length === 0) {
      return false;
    }

    const hasQuestion = interactiveEvents.some(
      (event: any) => event.type === "question" || event.type === "confirm"
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
      cancelled: "error",
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
    const responseType = this.firstNonEmptyString(canonicalRec.responseType);
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

  /**
   * Normalize structured output from raw response
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

    const sanitizedRec = sanitizeStructuredOutput(rec);

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
      sanitizedRec.responseType,
      rec.type,
      rec.kind,
      rec.category,
    );
    const responseTypeHint = responseTypeHintRaw?.toLowerCase();

    const strictMessageCandidate =
      this.firstNonEmptyString(sanitizedRec.message) ||
      (typeof rec.message === "string" ? rec.message : undefined);
    const aliasMessageCandidate = this.firstNonEmptyString(
      strictMessageCandidate,
      sanitizedRec.content,
      rec.content,
      sanitizedRec.text,
      rec.text,
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
      responseType: responseTypeRaw,
    };
    if (
      messageCandidate &&
      !this.firstNonEmptyString(canonicalRec.message)
    ) {
      canonicalRec.message = messageCandidate;
    }

    const canonicalResponseType = this.firstNonEmptyString(
      canonicalRec.responseType,
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
    if (!validation.valid && messageCandidate) {
      canonicalRec = {
        responseType: "message",
        message: messageCandidate,
      };
      validation = validateStructuredOutput(canonicalRec);
    }
    if (!validation.valid) {
      this.logger.warn("Structured output validation failed", {
        errors: validation.errors,
        source: diagnostics?.source,
        providerID: diagnostics?.providerID,
        modelID: diagnostics?.modelID,
      });
      this.recordStructuredValidationFailure(
        canonicalRec,
        validation.errors,
        diagnostics,
      );
      return undefined;
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
      sanitizedCanonicalRec.responseType,
    );
    if (!responseType) {
      return undefined;
    }

    return sanitizedCanonicalRec as StructuredAssistantOutput;
  }

  /**
   * Create fallback message from structured output
   */
  createFallbackMessage(
    structured: StructuredAssistantOutput,
  ): string | undefined {
    if (!structured.responseType) return undefined;

    const { responseType, progressUpdates, interactiveEvents, plan } =
      structured;

    switch (responseType) {
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
      case "question": {
        const questionRecord = this.asRecord(structured.question);
        const displayPrompt = this.firstNonEmptyString(
          questionRecord?.displayPrompt,
        );
        if (displayPrompt) {
          return displayPrompt;
        }
        const questionPrompt = this.firstNonEmptyString(
          questionRecord?.question,
          questionRecord?.message,
          questionRecord?.content,
        );
        if (questionPrompt) {
          return questionPrompt;
        }
        if (interactiveEvents && interactiveEvents.length > 0) {
          const firstEvent = interactiveEvents[0];
          const firstEventRecord = this.asRecord(firstEvent);
          const eventDisplayPrompt = this.firstNonEmptyString(
            firstEventRecord?.displayPrompt,
          );
          if (eventDisplayPrompt) {
            return eventDisplayPrompt;
          }
          if (firstEvent.type === "question" && firstEvent.question) {
            return firstEvent.question;
          } else if (firstEvent.type === "confirm" && firstEvent.question) {
            return firstEvent.question;
          } else if (firstEvent.type === "message" && firstEvent.message) {
            return firstEvent.message;
          }
        }
        return "❓ Question for you";
      }
      case "subagents":
        return "🤖 Spawned subagents...";
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
        .join("")
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

    const candidates = [
      message.structuredOutput,
      message.structured_output,
      message.info?.structuredOutput,
      message.info?.structured_output,
      message.info?.structured,
    ];

    for (const candidate of candidates) {
      if (candidate) {
        const normalized = this.normalizeStructuredOutput(candidate);
        if (normalized) {
          return normalized;
        }
      }
    }

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

    if (structured.message && !updated.message) {
      updated.message = structured.message;
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

    if (structured.question && !updated.question) {
      updated.question = structured.question;
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
  async enrichMessageWithPlan(message: any): Promise<any> {
    if (!message) return message;

    const role = message?.info?.role || message?.role;
    if (typeof role === "string" && role.toLowerCase() !== "assistant") {
      return message;
    }

    const structured = this.extractStructuredOutput(message);

    const structuredResponseType = this.firstNonEmptyString(
      structured?.responseType,
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

    if (structured) {
      const structuredPlanRecord = this.asRecord(structured.plan);
      const structuredPlanContent = this.firstNonEmptyString(
        structuredPlanRecord?.content,
      );
      const structuredPlanFiles =
        this.planManager.collectPlanFileCandidatesFromStructuredPlan(structuredPlanRecord);
      const structuredPlanFile = structuredPlanFiles[0];

      this.logger.debug("Structured plan data", {
        structuredPlanRecord,
        structuredPlanFiles,
        structuredPlanFile,
        hasFile: !!structuredPlanRecord?.file,
        rawStructuredPlan: structured.plan,
        allStructuredKeys: Object.keys(structured || {}),
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
    // heuristics below so we can promote into `implementation_plan`.
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
      /implementation_plan\.md/i.test(fullContent) ||
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
