/**
 * HistoryProcessor Module
 *
 * All logic for transforming raw SDK messages into renderable history for the webview.
 *
 * Extracted from ChatViewProvider.ts (~750 lines)
 */

import * as vscode from "vscode";
import type { StructuredOutputProcessor } from "./StructuredOutputProcessor";
import type { StructuredAssistantOutput } from "./types";

export class HistoryProcessor {
  constructor(
    private workspaceState: vscode.Memento,
    private logger: ReturnType<typeof import("../../utils/Logger").createLogger>,
    private structuredOutputProcessor: StructuredOutputProcessor,
    private asRecord: (value: unknown) => Record<string, unknown> | undefined,
    private firstNonEmptyString: (...values: unknown[]) => string | undefined,
    private isLikelyToolCallTranscript: (text: string) => boolean,
    private extractMessageBodyText: (message: any) => string,
    private planManager?: any,
  ) { }

  /**
   * Normalize plan-proceed user messages
   */
  private normalizePlanProceedUserMessage(message: any): any {
    if (!this.planManager) return message;
    return this.planManager.normalizePlanProceedUserMessage(message);
  }

  /**
   * Apply structured output to message
   */
  private applyStructuredOutputToMessage(
    message: any,
    options?: { allowSyntheticFallbackError?: boolean },
  ): any {
    if (!message) return message;

    // Detect abort errors early
    const messageInfoError = message?.info?.error ?? message?.error;
    if (messageInfoError?.name === "MessageAbortedError") {
      return { ...message, aborted: true };
    }

    // Get role
    const role = this.firstNonEmptyString(
      message?.info?.role,
      message?.role,
    )?.toLowerCase();
    const isAssistantLikeRole =
      role === "assistant" ||
      (!role &&
        Boolean(
          this.firstNonEmptyString(
            message?.info?.modelID,
            message?.modelID,
            message?.info?.providerID,
            message?.providerID,
          ),
        ));

    // System messages get a default structured output
    if (role === "system") {
      return {
        ...message,
        responseType: "system",
        structuredOutput: {
          responseType: "system",
        },
      };
    }

    // Extract any structured output from the message
    const structured = this.structuredOutputProcessor.extractStructuredOutput(message);

    if (!structured) {
      // No structured output - return message with default
      const bodyText = this.extractMessageBodyText(message);
      if (isAssistantLikeRole && bodyText) {
        return {
          ...message,
          structuredOutput: {
            responseType: "message",
            message: bodyText,
          },
          content: bodyText,
        };
      }
      return message;
    }

    const originalBodyText = this.extractMessageBodyText(message);

    // Apply the extracted structured output to the message
    const structuredApplied = this.structuredOutputProcessor.applyStructuredOutputToMessage(
      message,
      structured,
    ) || message;

    if (
      isAssistantLikeRole &&
      originalBodyText &&
      !this.extractMessageBodyText(structuredApplied)?.trim() &&
      !Array.isArray(structuredApplied?.parts)
    ) {
      this.logger.info("[HistoryProcessor] Restoring raw assistant body during hydration", {
        messageId: this.extractHistoryMessageId(structuredApplied),
        originalBodyPreview: originalBodyText.slice(0, 240),
        structuredResponseType: this.firstNonEmptyString(
          structuredApplied?.structuredOutput?.responseType,
          structuredApplied?.responseType,
        ),
      });
      return {
        ...structuredApplied,
        content: originalBodyText,
        text: originalBodyText,
        structuredOutput:
          structuredApplied?.structuredOutput &&
          this.firstNonEmptyString(structuredApplied.structuredOutput.responseType)
            ? structuredApplied.structuredOutput
            : {
              responseType: "message",
              message: originalBodyText,
            },
        parts: [
          {
            type: "text",
            text: originalBodyText,
          },
        ],
      };
    }

    return structuredApplied;
  }

  /**
   * Enrich message with plan information
   */
  private async enrichMessageWithPlan(message: any): Promise<any> {
    return await this.structuredOutputProcessor.enrichMessageWithPlan(message);
  }

  /**
   * Get storage key for message overrides
   */
  getMessageOverrideStorageKey(messageId: string): string {
    return `opencode.messageOverride.${messageId}`;
  }

  /**
   * Load session message overrides
   */
  async loadSessionMessageOverrides(sessionId: string): Promise<Record<string, any>> {
    const key = `opencode.session.messageOverrides.${sessionId}`;
    const raw = this.workspaceState.get<Record<string, any>>(key);
    return raw || {};
  }

  /**
   * Persist session message override
   */
  async persistSessionMessageOverride(
    sessionId: string,
    override: any,
  ): Promise<void> {
    const overrides = await this.loadSessionMessageOverrides(sessionId);
    const messageId = this.extractHistoryMessageId(override);
    if (messageId) {
      overrides[messageId] = override;
    }
    const key = `opencode.session.messageOverrides.${sessionId}`;
    await this.workspaceState.update(key, overrides);
  }

  /**
   * Persist the final assistant debug message override for session hydration parity.
   * Ensures rawResponse is retained on reload so the hydrated view matches the live session view.
   */
  async handleSendMessage(session: { id: string }, debugMessage: any, duration: number): Promise<void> {
    await this.persistSessionMessageOverride(session.id, {
      ...debugMessage,
      timing: {
        duration: duration,
      },
    });
  }

  /**
   * Apply session message overrides to messages
   */
  async applySessionMessageOverrides(
    sessionId: string,
    messages: any[],
  ): Promise<any[]> {
    const overrides = await this.loadSessionMessageOverrides(sessionId);
    if (Object.keys(overrides).length === 0) {
      console.log("[CLIENT FACING] applySessionMessageOverrides NO_OVERRIDES", { sessionId, messageCount: messages.length });
      return messages;
    }

    console.log("[CLIENT FACING] applySessionMessageOverrides LOADED", {
      sessionId,
      overrideKeys: Object.keys(overrides),
      messageIds: messages.map(m => this.extractHistoryMessageId(m)),
      messageCount: messages.length,
    });

    return messages.map((message) => {
      const messageId = this.extractHistoryMessageId(message);
      const override = overrides[messageId];
      if (!messageId || !override) {
        return message;
      }

      console.log("[CLIENT FACING] applySessionMessageOverrides APPLIED", {
        messageId,
        hasRawResponseBefore: !!message?.rawResponse,
        hasRawResponseOverride: !!override?.rawResponse,
        contentBefore: String(message?.content).slice(0, 100),
      });

      return {
        ...message,
        ...override,
        id: messageId,
      };
    });
  }

  /**
   * Clear session message overrides
   */
  async clearSessionMessageOverrides(sessionId: string): Promise<void> {
    const key = `opencode.session.messageOverrides.${sessionId}`;
    await this.workspaceState.update(key, undefined);
  }

  /**
   * Process history messages for rendering.
   * Canonical pipeline: normalize → structured output → filter → dedup → coalesce.
   */
  async processHistoryMessages(rawMessages: any[], sessionId: string): Promise<any[]> {
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return [];
    }

    const processedMessages = await Promise.all(
      rawMessages.map(async (rawMessage: any) => {
        const message =
          rawMessage && typeof rawMessage === "object"
            ? { ...rawMessage }
            : rawMessage;
        const normalizedMessage = this.normalizePlanProceedUserMessage(message);
        const structured = this.applyStructuredOutputToMessage(normalizedMessage, {
          allowSyntheticFallbackError: false,
        });
        return await this.enrichMessageWithPlan(structured);
      })
    );

    const processed = processedMessages.filter((message) =>
      this.isRenderableHistoryMessage(message)
    );

    const ordered = this.orderHistoryMessagesChronologically(processed);
    const dedupedUserMessages = this.dedupeUserMessagesByContent(ordered);
    const deduped = this.dedupeMirrorHistoryMessages(dedupedUserMessages);
    const mergedActivity = this.mergeAdjacentAssistantActivityMessages(deduped);
    const merged = this.mergeConsecutiveAssistantBursts(mergedActivity);
    return this.cleanupGarbledEventMessages(merged);
  }

  private cleanupGarbledEventMessages(messages: any[]): any[] {
    const result: any[] = [];
    for (let i = 0; i < messages.length; i++) {
      const current = messages[i];
      const currentRole = this.firstNonEmptyString(current?.role, current?.info?.role);
      if (currentRole?.toLowerCase() !== "assistant") {
        result.push(current);
        continue;
      }
      const currentId = String(current?.id || "");
      const currentContent = String(current?.content || "").trim();
      const currentStructMsg = String(current?.structuredOutput?.message || "").trim();
      const currentBody = currentContent || currentStructMsg;
      const isGarbled = currentId.startsWith("evt_") && currentBody.length > 0 && currentBody.length < 200;
      if (!isGarbled) {
        result.push(current);
        continue;
      }
      const prev = result.length > 0 ? result[result.length - 1] : null;
      const prevRole = prev ? this.firstNonEmptyString(prev?.role, prev?.info?.role) : null;
      const prevBody = String(prev?.content || "").trim();
      const prevHasGoodContent = prevRole?.toLowerCase() === "assistant" && prevBody.length > 20 && prevBody !== currentBody;
      if (prevHasGoodContent) {
        console.log("[CLIENT FACING] cleanupGarbledEventMessages SKIPPED", {
          currentId, currentBody: currentBody.slice(0, 150),
          prevId: String(prev?.id || "").slice(0, 50), prevBody: prevBody.slice(0, 150),
        });
        continue;
      }
      const next = i + 1 < messages.length ? messages[i + 1] : null;
      const nextRole = next ? this.firstNonEmptyString(next?.role, next?.info?.role) : null;
      const nextBody = String(next?.content || "").trim();
      const nextHasGoodContent = nextRole?.toLowerCase() === "assistant" && nextBody.length > 20 && nextBody !== currentBody;
      if (nextHasGoodContent) {
        console.log("[CLIENT FACING] cleanupGarbledEventMessages SKIPPED", {
          currentId, currentBody: currentBody.slice(0, 150),
          nextId: String(next?.id || "").slice(0, 50), nextBody: nextBody.slice(0, 150),
        });
        continue;
      }
      result.push(current);
    }
    return result;
  }

  private orderHistoryMessagesChronologically(messages: any[]): any[] {
    if (!Array.isArray(messages) || messages.length <= 1) {
      return messages;
    }

    const decorated = messages.map((message, index) => ({
      message,
      index,
      createdAt: this.historyMessageCreatedAt(message),
      role: this.firstNonEmptyString(
        message?.role,
        message?.info?.role,
        message?.sender,
      )?.toLowerCase(),
    }));

    decorated.sort((a, b) => {
      if (
        typeof a.createdAt === "number" &&
        Number.isFinite(a.createdAt) &&
        typeof b.createdAt === "number" &&
        Number.isFinite(b.createdAt)
      ) {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt - b.createdAt;
        }

        // For same-timestamp turns, keep user input ahead of assistant output.
        if (a.role === "user" && b.role === "assistant") {
          return -1;
        }
        if (a.role === "assistant" && b.role === "user") {
          return 1;
        }
      }

      // Preserve original order when timestamps are unavailable/ambiguous.
      return a.index - b.index;
    });

    return decorated.map((entry) => entry.message);
  }

  /**
   * Merge adjacent assistant activity messages
   */
  public mergeAdjacentAssistantActivityMessages(messages: any[]): any[] {
    const result: any[] = [];
    for (const message of messages) {
      if (!this.isActivityOnlyAssistantMessage(message)) {
        result.push(message);
        continue;
      }

      const last = result[result.length - 1];
      const lastId = this.extractHistoryMessageId(last);
      const currentId = this.extractHistoryMessageId(message);
      if (
        last &&
        this.isActivityOnlyAssistantMessage(last) &&
        lastId &&
        currentId &&
        lastId === currentId
      ) {
        const merged = this.mergeMessageParts([last, message]);
        result[result.length - 1] = merged;
      } else {
        result.push(message);
      }
    }
    return result;
  }

  /**
   * Merge consecutive assistant bursts
   */
  public mergeConsecutiveAssistantBursts(messages: any[]): any[] {
    const result: any[] = [];
    let currentBurst: any[] = [];

    for (const message of messages) {
      const role = this.firstNonEmptyString(
        message?.role,
        message?.info?.role,
        message?.sender,
      )?.toLowerCase();
      const isAssistant = role === "assistant";
      if (!isAssistant) {
        if (currentBurst.length > 0) {
          result.push(this.coalesceAssistantBurst(currentBurst));
          currentBurst = [];
        }
        result.push(message);
        continue;
      }

      const previous = currentBurst[currentBurst.length - 1];
      if (
        previous &&
        !this.shouldMergeAssistantBurstMessages(previous, message)
      ) {
        result.push(this.coalesceAssistantBurst(currentBurst));
        currentBurst = [];
      }

      currentBurst.push(message);
    }

    if (currentBurst.length > 0) {
      result.push(this.coalesceAssistantBurst(currentBurst));
    }

    return result;
  }

  private shouldMergeAssistantBurstMessages(previous: any, next: any): boolean {
    if (!previous || !next) {
      return false;
    }
    const previousActivityOnly = this.isActivityOnlyAssistantMessage(previous);
    const nextActivityOnly = this.isActivityOnlyAssistantMessage(next);
    // Never collapse distinct user-facing assistant replies into one message.
    if (!previousActivityOnly && !nextActivityOnly) {
      return false;
    }

    const previousId = this.extractHistoryMessageId(previous);
    const nextId = this.extractHistoryMessageId(next);
    return Boolean(previousId && nextId && previousId === nextId);
  }

  /**
   * Coalesce assistant burst into single message
   */
  private coalesceAssistantBurst(burst: any[]): any {
    if (burst.length === 0) return null;
    if (burst.length === 1) return burst[0];

    const base = { ...(burst[burst.length - 1] || burst[0] || {}) };
    const visibleBodyText = (() => {
      for (let index = burst.length - 1; index >= 0; index -= 1) {
        const candidate = this.extractMessageBodyText(burst[index]);
        if (candidate && candidate.trim().length > 0) {
          return candidate;
        }
      }
      return "";
    })();

    const appendUnique = (target: any[], incoming: any[]): void => {
      if (!Array.isArray(incoming) || incoming.length === 0) {
        return;
      }
      const seen = new Set(target.map((entry) => JSON.stringify(entry)));
      for (const item of incoming) {
        const key = JSON.stringify(item);
        if (!seen.has(key)) {
          seen.add(key);
          target.push(item);
        }
      }
    };

    const mergeInfoRecord = (preferredInfo: any, fallbackInfo: any): any => {
      const preferred =
        preferredInfo && typeof preferredInfo === "object" ? preferredInfo : {};
      const fallback =
        fallbackInfo && typeof fallbackInfo === "object" ? fallbackInfo : {};

      const merged: any = {
        ...fallback,
        ...preferred,
      };

      const preferredTokens =
        preferred.tokens && typeof preferred.tokens === "object"
          ? preferred.tokens
          : undefined;
      const fallbackTokens =
        fallback.tokens && typeof fallback.tokens === "object"
          ? fallback.tokens
          : undefined;
      if (preferredTokens || fallbackTokens) {
        merged.tokens = {
          ...(fallbackTokens || {}),
          ...(preferredTokens || {}),
          cache: {
            ...((fallbackTokens?.cache &&
              typeof fallbackTokens.cache === "object")
              ? fallbackTokens.cache
              : {}),
            ...((preferredTokens?.cache &&
              typeof preferredTokens.cache === "object")
              ? preferredTokens.cache
              : {}),
          },
        };
      }

      const preferredTime =
        preferred.time && typeof preferred.time === "object"
          ? preferred.time
          : undefined;
      const fallbackTime =
        fallback.time && typeof fallback.time === "object"
          ? fallback.time
          : undefined;
      if (preferredTime || fallbackTime) {
        merged.time = {
          ...(fallbackTime || {}),
          ...(preferredTime || {}),
        };
      }

      const preferredError =
        preferred.error && typeof preferred.error === "object"
          ? preferred.error
          : undefined;
      const fallbackError =
        fallback.error && typeof fallback.error === "object"
          ? fallback.error
          : undefined;
      if (preferredError || fallbackError) {
        merged.error = {
          ...(fallbackError || {}),
          ...(preferredError || {}),
        };
      }

      return merged;
    };

    base.parts = Array.isArray(base.parts) ? [...base.parts] : [];
    base.subagents = Array.isArray(base.subagents) ? [...base.subagents] : [];
    base.interactiveEvents = Array.isArray(base.interactiveEvents)
      ? [...base.interactiveEvents]
      : [];
    base.progressUpdates = Array.isArray(base.progressUpdates)
      ? [...base.progressUpdates]
      : [];
    base.progressEvents = Array.isArray(base.progressEvents)
      ? [...base.progressEvents]
      : [];
    base.reasoningEvents = Array.isArray(base.reasoningEvents)
      ? [...base.reasoningEvents]
      : [];
    base.steps = Array.isArray(base.steps) ? [...base.steps] : [];
    base.reasoning = Array.isArray(base.reasoning) ? [...base.reasoning] : [];
    base.info = mergeInfoRecord(base.info, undefined);

    let latestRawResponse: unknown = base.rawResponse;

    for (const message of burst) {
      appendUnique(base.parts, Array.isArray(message?.parts) ? message.parts : []);
      appendUnique(
        base.subagents,
        Array.isArray(message?.subagents) ? message.subagents : [],
      );
      appendUnique(
        base.interactiveEvents,
        Array.isArray(message?.interactiveEvents)
          ? message.interactiveEvents
          : [],
      );
      appendUnique(
        base.progressUpdates,
        Array.isArray(message?.progressUpdates) ? message.progressUpdates : [],
      );
      appendUnique(
        base.progressEvents,
        Array.isArray(message?.progressEvents) ? message.progressEvents : [],
      );
      appendUnique(
        base.reasoningEvents,
        Array.isArray(message?.reasoningEvents) ? message.reasoningEvents : [],
      );
      appendUnique(base.steps, Array.isArray(message?.steps) ? message.steps : []);
      appendUnique(
        base.reasoning,
        Array.isArray(message?.reasoning) ? message.reasoning : [],
      );
      base.info = mergeInfoRecord(base.info, message?.info);

      if (
        (!base.providerID || !base.modelID) &&
        (message?.providerID || message?.modelID)
      ) {
        base.providerID = base.providerID || message.providerID;
        base.modelID = base.modelID || message.modelID;
      }
      if (!base.variant && message?.variant) {
        base.variant = message.variant;
      }
      if (
        (!base.timing || typeof base.timing !== "object") &&
        message?.timing &&
        typeof message.timing === "object"
      ) {
        base.timing = { ...message.timing };
      }
      if (
        typeof base.duration !== "number" &&
        typeof message?.duration === "number"
      ) {
        base.duration = message.duration;
      }
      if (!base.reasoningPayload && message?.reasoningPayload) {
        base.reasoningPayload = message.reasoningPayload;
      }

      const structured = this.structuredOutputProcessor.extractStructuredOutput(message);
      if (structured) {
        base.structuredOutput = structured;
      }
      if (message && "rawResponse" in message) {
        latestRawResponse = message.rawResponse;
      }
    }

    base.rawResponse = latestRawResponse;
    base.content = visibleBodyText || this.extractMessageBodyText(base);
    if (typeof base.text === "string" || visibleBodyText) {
      base.text = visibleBodyText || this.firstNonEmptyString(base.text);
    }
    return base;
  }

  /**
   * Merge message parts
   */
  private mergeMessageParts(messages: any[]): any {
    if (messages.length === 0) return null;
    if (messages.length === 1) return messages[0];

    const first = messages[0];
    const merged: any = { ...first };

    merged.parts = messages.flatMap((m) => m.parts || []);
    merged.content = this.extractMessageBodyText(merged);

    return merged;
  }

  /**
   * Get history part fingerprint
   */
  private historyPartFingerprint(part: any): string | undefined {
    if (!part) return undefined;
    const text = this.firstNonEmptyString(part.text, part.content);
    if (typeof text !== "string" || !text) return undefined;
    return `${part.type || "text"}:${text.slice(0, 100)}`;
  }

  /**
   * Check if message is assistant history message
   */
  private isAssistantHistoryMessage(message: any): boolean {
    return message?.role === "assistant" || message?.sender === "assistant";
  }

  /**
   * Check if message is activity-only assistant message
   */
  private isActivityOnlyAssistantMessage(message: any): boolean {
    if (!this.isAssistantHistoryMessage(message)) return false;

    const hasRenderableText = Boolean(
      this.extractMessageBodyText(message)?.trim()
    );
    if (hasRenderableText) return false;

    const hasActivity =
      (Array.isArray(message.subagents) && message.subagents.length > 0) ||
      (Array.isArray(message.interactiveEvents) && message.interactiveEvents.length > 0) ||
      (Array.isArray(message.progressUpdates) && message.progressUpdates.length > 0);

    return hasActivity;
  }

  /**
   * Check if message has renderable history payload
   */
  private hasRenderableHistoryPayload(message: any): boolean {
    if (!message || typeof message !== "object") return false;
    if (this.isInternalSystemReminderMessage(message)) {
      return false;
    }

    // FIX: Check assistant messages with parts FIRST, before any other checks.
    // This ensures question-type messages with parts but no text content are preserved.
    // Prevents regression where assistant messages disappear after session restart.
    const role = message.role || message.info?.role;
    if (role === "assistant" && Array.isArray(message.parts) && message.parts.length > 0) {
      return true;
    }

    if (this.extractMessageBodyText(message)?.trim()) return true;
    if (message.structuredOutput) return true;
    if (Array.isArray(message.subagents) && message.subagents.length > 0) return true;
    if (Array.isArray(message.interactiveEvents) && message.interactiveEvents.length > 0) return true;
    if (Array.isArray(message.progressUpdates) && message.progressUpdates.length > 0) return true;
    return false;
  }

  /**
   * Check if message is internal system reminder
   */
  private isInternalSystemReminderMessage(message: any): boolean {
    if (!message || typeof message !== "object") return false;

    const role = this.firstNonEmptyString(
      message?.role,
      message?.info?.role,
    )?.toLowerCase().trim();
    if (role !== "user" && role !== "system") return false;

    const text = this.extractMessageBodyText(message);
    if (!text) return false;

    if (this.isPlanProceedMessageText(text)) {
      return false;
    }

    const normalized = text.trim().toLowerCase();

    // Check for square-bracketed system messages at the start (e.g., [analyze-mode], [background task completed])
    const bracketPattern = /^\[[a-z][a-z0-9_\- ]*\]/i;
    const hasBracketPrefix = bracketPattern.test(text.trim());

    return (
      normalized.includes("<system-reminder>") ||
      normalized.includes("<auto-slash-command>") ||
      normalized.includes("<!-- omo_internal_initiator -->") ||
      hasBracketPrefix ||
      (normalized.includes("[search-model]") && normalized.includes("maximize search effort")) ||
      normalized.startsWith("system reminder") ||
      normalized.startsWith("internal reminder") ||
      normalized.includes("reminder: you can")
    );
  }

  /**
   * Check if text is plan-proceed message
   */
  private isPlanProceedMessageText(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase().trim();
    return lower === "proced" || lower === "proceed" || lower === "let's proceed" || lower === "ok, proceed";
  }

  /**
   * Check if message is renderable history message
   */
  isRenderableHistoryMessage(message: any): boolean {
    if (!message) return false;
    // Don't filter out system reminder messages - they will be converted to system role
    // and rendered with the SystemMessage component
    if (this.isInternalSystemReminderMessage(message)) return true;
    return this.hasRenderableHistoryPayload(message);
  }

  /**
   * Dedupe mirror history messages
   */
  public dedupeMirrorHistoryMessages(messages: any[]): any[] {
    const seen = new Set<string>();
    return messages.filter((message) => {
      const fingerprint = this.historyMessageFingerprint(message);
      if (!fingerprint) return true;

      if (seen.has(fingerprint)) {
        return false;
      }
      seen.add(fingerprint);
      return true;
    });
  }

  /**
   * Dedupe user messages with identical content
   * This fixes duplicate "Plan Approved" messages that may occur during hydration
   */
  private dedupeUserMessagesByContent(messages: any[]): any[] {
    if (!Array.isArray(messages) || messages.length <= 1) {
      return messages;
    }

    const deduped: any[] = [];
    const seenUserContents = new Set<string>();

    for (const message of messages) {
      const role = this.firstNonEmptyString(
        message?.role,
        message?.info?.role,
        message?.sender,
      )?.toLowerCase();

      if (role !== "user") {
        deduped.push(message);
        continue;
      }

      const content = this.extractMessageBodyText(message);
      if (!content) {
        deduped.push(message);
        continue;
      }

      const normalizedContent = content.trim();
      if (seenUserContents.has(normalizedContent)) {
        this.logger.debug("[HistoryProcessor] Skipping duplicate user message", {
          content: normalizedContent.substring(0, 100),
          totalSkipped: seenUserContents.size,
        });
        continue;
      }

      seenUserContents.add(normalizedContent);
      deduped.push(message);
    }

    if (deduped.length < messages.length) {
      this.logger.debug("[HistoryProcessor] User message deduplication complete", {
        inputCount: messages.length,
        outputCount: deduped.length,
        duplicatesRemoved: messages.length - deduped.length,
      });
    }

    return deduped;
  }

  /**
   * Check if messages are mirror history messages (i.e., represent the same logical message).
   * Preserves intentional idless repeats by returning false when both have no ID.
   */
  private areMirrorHistoryMessages(a: any, b: any): boolean {
    const existingId = this.extractHistoryMessageId(a);
    const incomingId = this.extractHistoryMessageId(b);

    if (existingId && incomingId) {
      if (existingId === incomingId) return true;
      // Both have non-synthetic IDs that differ — not mirrors
      if (!this.isSyntheticLocalMessageId(existingId) && !this.isSyntheticLocalMessageId(incomingId)) {
        return false;
      }
      // At least one is synthetic — fall through to timestamp proximity check
    } else if (!existingId && !incomingId) {
      // Both idless — do not collapse intentional idless repeats
      return false;
    }

    const existingCreatedAt = this.historyMessageCreatedAt(a);
    const incomingCreatedAt = this.historyMessageCreatedAt(b);
    if (
      typeof existingCreatedAt !== "number" ||
      typeof incomingCreatedAt !== "number"
    ) {
      return false;
    }
    return Math.abs(existingCreatedAt - incomingCreatedAt) <= 15_000;
  }

  /**
   * Extract history message ID
   */
  extractHistoryMessageId(message: any): string | undefined {
    return this.firstNonEmptyString(
      message?.id,
      message?.messageId,
      message?.info?.id,
    );
  }

  /**
   * Get history message created at timestamp
   */
  private historyMessageCreatedAt(message: any): number | undefined {
    const info = this.asRecord(message?.info);
    const infoTime = this.asRecord(info?.time);
    const time = this.asRecord(message?.time);

    const numericCandidates = [
      infoTime?.created,
      time?.created,
      info?.createdAt,
      info?.timestamp,
      message?.createdAt,
      message?.timestamp,
    ];
    for (const candidate of numericCandidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
    }

    const stringCandidates = [
      this.firstNonEmptyString(
        info?.createdAt,
        info?.timestamp,
        message?.createdAt,
        message?.timestamp,
      ),
    ];
    for (const candidate of stringCandidates) {
      if (!candidate) {
        continue;
      }
      const parsed = new Date(candidate).getTime();
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return undefined;
  }

  /**
   * Get history message fingerprint
   */
  historyMessageFingerprint(message: any): string | undefined {
    const id = this.extractHistoryMessageId(message);
    const role = this.firstNonEmptyString(message?.role, message?.sender);
    const rawContent = this.extractMessageBodyText(message);
    const content = typeof rawContent === "string" ? rawContent.slice(0, 200) : undefined;

    if (!id && !role && !content) return undefined;

    const parts = [];
    if (id) parts.push(`id:${id}`);
    if (role) parts.push(`role:${role}`);
    if (typeof content === "string" && content) parts.push(`content:${content.slice(0, 100)}`);

    return parts.join("|");
  }

  /**
   * Get history message richness score
   */
  private historyMessageRichnessScore(message: any): number {
    let score = 0;

    const content = this.extractMessageBodyText(message);
    if (content) score += Math.min(content.length / 100, 10);

    if (Array.isArray(message.subagents)) score += message.subagents.length * 2;
    if (Array.isArray(message.interactiveEvents)) score += message.interactiveEvents.length * 2;
    if (Array.isArray(message.progressUpdates)) score += message.progressUpdates.length;
    if (message.structuredOutput) score += 5;
    if (Array.isArray(message.reasoning)) score += message.reasoning.length * 0.5;

    return score;
  }

  /**
   * Pick richer history message
   */
  private pickRicherHistoryMessage(a: any, b: any): any {
    const scoreA = this.historyMessageRichnessScore(a);
    const scoreB = this.historyMessageRichnessScore(b);
    return scoreA >= scoreB ? a : b;
  }

  /**
   * Pick canonical history message ID from a group of messages.
   * Prefers non-synthetic IDs when available.
   */
  private pickCanonicalHistoryMessageId(messages: any[]): string | undefined {
    const ids = messages
      .map((m) => this.extractHistoryMessageId(m))
      .filter((id): id is string => Boolean(id));

    if (ids.length === 0) return undefined;

    // Prefer a non-synthetic ID
    const preferred = ids.find((id) => !this.isSyntheticLocalMessageId(id));
    return preferred ?? ids[0];
  }

  /**
   * Check if message ID is synthetic
   */
  private isSyntheticLocalMessageId(id: string): boolean {
    if (!id) return false;
    return id.startsWith("msg_local_") || id.startsWith("local-");
  }

  /**
   * Get latest assistant history marker
   */
  public getLatestAssistantHistoryMarker(messages: any[]): {
    id?: string;
    fingerprint?: string;
    createdAt?: number;
    richness: number;
  } {
    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        id: undefined,
        fingerprint: undefined,
        createdAt: undefined,
        richness: -1,
      };
    }

    let latest: any = null;
    let latestScore = -1;

    for (const message of messages) {
      if (!this.isAssistantHistoryMessage(message)) continue;

      const richness = this.historyMessageRichnessScore(message);
      if (richness <= latestScore) continue;

      latest = message;
      latestScore = richness;
    }

    return {
      id: this.extractHistoryMessageId(latest),
      fingerprint: this.historyMessageFingerprint(latest),
      createdAt: latest ? this.historyMessageCreatedAt(latest) : undefined,
      richness: latestScore,
    };
  }

  /**
   * Check if assistant history has advanced
   */
  public hasAssistantHistoryAdvanced(
    currentMessages: any[] | { id?: string; fingerprint?: string; createdAt?: number; richness?: number } | undefined,
    previousMessages: any[] | { id?: string; fingerprint?: string; createdAt?: number; richness?: number } | undefined,
  ): boolean {
    const asMarker = (
      value:
        | any[]
        | { id?: string; fingerprint?: string; createdAt?: number; richness?: number }
        | undefined,
    ): { id?: string; fingerprint?: string; createdAt?: number; richness: number } | undefined => {
      if (!value) {
        return undefined;
      }
      if (Array.isArray(value)) {
        const marker = this.getLatestAssistantHistoryMarker(value);
        return marker.id || marker.fingerprint || typeof marker.createdAt === "number"
          ? marker
          : undefined;
      }
      if (typeof value === "object") {
        return {
          id: typeof value.id === "string" ? value.id : undefined,
          fingerprint:
            typeof value.fingerprint === "string" ? value.fingerprint : undefined,
          createdAt:
            typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
              ? value.createdAt
              : undefined,
          richness:
            typeof value.richness === "number" && Number.isFinite(value.richness)
              ? value.richness
              : 0,
        };
      }
      return undefined;
    };

    const currentMarker = asMarker(currentMessages);
    const previousMarker = asMarker(previousMessages);

    if (!currentMarker) {
      return false;
    }
    if (!previousMarker) {
      return true;
    }

    if (currentMarker.id && previousMarker.id && currentMarker.id !== previousMarker.id) {
      return true;
    }
    if (currentMarker.id && !previousMarker.id) {
      return true;
    }
    if (
      currentMarker.fingerprint &&
      previousMarker.fingerprint &&
      currentMarker.fingerprint !== previousMarker.fingerprint
    ) {
      return true;
    }
    if (currentMarker.fingerprint && !previousMarker.fingerprint) {
      return true;
    }
    if (
      typeof currentMarker.createdAt === "number" &&
      typeof previousMarker.createdAt === "number" &&
      currentMarker.createdAt > previousMarker.createdAt + 1000
    ) {
      return true;
    }

    return currentMarker.richness > previousMarker.richness + 12;
  }
}
