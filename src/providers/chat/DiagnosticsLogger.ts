/**
 * DiagnosticsLogger Module
 *
 * Handles all debug logging, render-parity tracing, debug file I/O,
 * and AI diagnostic snapshots.
 *
 * Extracted from ChatViewProvider.ts lines 4586-5090
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";

export class DiagnosticsLogger {
  private renderParityLogWriteChain: Promise<void> = Promise.resolve();
  private renderParityDebugFilePath?: string;
  private didLogRenderParityFilePath = false;
  private readonly promptDebugBySession = new Map<string, Record<string, unknown>>();

  constructor(
    private logger: ReturnType<typeof import("../utils/Logger").createLogger>,
    private asRecord: (value: unknown) => Record<string, unknown> | undefined,
    private firstNonEmptyString: (...values: unknown[]) => string | undefined,
    private extractMessageBodyText: (message: any) => string,
    private historyMessageCreatedAt: (message: any) => number,
    private extractHistoryMessageId: (message: any) => string | undefined,
    private isRenderableHistoryMessage: (message: any) => boolean,
    private historyMessageFingerprint: (message: any) => string,
  ) {}

  /**
   * Log diagnostics for stream events
   */
  logStreamEventDiagnostics(event: any, enrichedEvent?: any): void {
    const eventType = typeof event?.type === "string" ? event.type : "unknown";
    const properties = this.asRecord(event?.properties) || {};
    const part = this.asRecord(properties?.part);
    const info = this.asRecord(properties?.info);

    const sessionID =
      this.firstNonEmptyString(
        properties?.sessionID,
        properties?.sessionId,
        part?.sessionID,
        part?.sessionId,
        info?.sessionID,
        info?.sessionId,
      ) || undefined;
    const messageID =
      this.firstNonEmptyString(
        properties?.messageID,
        properties?.messageId,
        part?.messageID,
        part?.messageId,
        info?.id,
      ) || undefined;

    const structured = this.asRecord(enrichedEvent?.structured);
    const structuredOutput = this.asRecord(enrichedEvent?.structuredOutput);
    const partPreview =
      this.firstNonEmptyString(
        part?.delta,
        part?.text,
        part?.content,
        part?.reasoning,
        part?.thought,
        part?.thinking,
      ) || undefined;
    const eventPreview =
      this.firstNonEmptyString(
        event?.delta,
        event?.text,
        event?.content,
        event?.reasoning,
      ) || undefined;
    const preview = partPreview || eventPreview;
    const summary: Record<string, unknown> = {
      type: eventType,
      source: this.firstNonEmptyString(event?.source),
      directory: this.firstNonEmptyString(event?.directory),
      sessionID,
      messageID,
      partType: this.firstNonEmptyString(part?.type),
      hasProperties: Object.keys(properties).length > 0,
      structuredKind: this.firstNonEmptyString(structured?.kind),
      structuredResponseType: this.firstNonEmptyString(
        structuredOutput?.responseType,
      ),
      hasStructuredOutput: Boolean(structuredOutput),
      preview: preview ? preview.slice(0, 180) : undefined,
      previewLength: preview?.length,
    };

    if (eventType === "server.heartbeat") {
      if (this.shouldVerboseStreamDebug()) {
        console.log("[ChatViewProvider] stream heartbeat", summary);
      }
      return;
    }

    const shouldLogInfo =
      eventType === "message.updated" ||
      eventType === "message.completed" ||
      eventType === "session.completed";
    const shouldPersistFile =
      shouldLogInfo ||
      eventType === "message.part.updated" ||
      eventType === "message.part.added" ||
      eventType === "message.part.created";
    if (shouldPersistFile) {
      this.appendRenderParityDebugLog("stream", summary);
    }
    if (this.shouldVerboseStreamDebug()) {
      console.log("[ChatViewProvider] stream event received", summary);
      return;
    }
    if (shouldLogInfo) {
      this.logger.info("Render parity stream snapshot", summary);
    }
  }

  /**
   * Summarize a render message for debugging
   */
  summarizeRenderMessageForDebug(
    message: any,
    index: number,
  ): Record<string, unknown> {
    const info = this.asRecord(message?.info);
    const structured = this.asRecord(
      message?.structuredOutput ??
      message?.structured_output ??
      info?.structuredOutput ??
      info?.structured,
    );
    const content =
      this.firstNonEmptyString(
        message?.content,
        message?.text,
        this.extractMessageBodyText(message),
      ) || "";
    const createdAt = this.historyMessageCreatedAt(message);
    const id = this.extractHistoryMessageId(message);
    const responseType = this.firstNonEmptyString(
      structured?.responseType,
    )?.toLowerCase();
    return {
      index,
      id,
      role:
        this.firstNonEmptyString(message?.role, info?.role) || "unknown",
      createdAt,
      responseType,
      contentLength: content.length,
      contentPreview: content ? content.slice(0, 160) : undefined,
      hasPlan: Boolean(this.asRecord(message?.plan)),
      subagentCount: Array.isArray(message?.subagents)
        ? message.subagents.length
        : 0,
      interactiveCount: Array.isArray(message?.interactiveEvents)
        ? message.interactiveEvents.length
        : 0,
      partCount: Array.isArray(message?.parts) ? message.parts.length : 0,
      renderable: this.isRenderableHistoryMessage(message),
      fingerprint: this.historyMessageFingerprint(message),
    };
  }

  /**
   * Log history render diagnostics
   */
  logHistoryRenderDiagnostics(
    source: string,
    sessionId: string | undefined,
    rawMessages: any[],
    processedMessages: any[],
  ): void {
    const rawTail = rawMessages.slice(-20);
    const processedTail = processedMessages.slice(-20);
    const rawSummary = rawTail.map((message, index) =>
      this.summarizeRenderMessageForDebug(
        message,
        rawMessages.length - rawTail.length + index,
      ),
    );
    const processedSummary = processedTail.map((message, index) =>
      this.summarizeRenderMessageForDebug(
        message,
        processedMessages.length - processedTail.length + index,
      ),
    );

    const rawIds = new Set(
      rawSummary
        .map((item) => this.firstNonEmptyString(item.id))
        .filter((value): value is string => Boolean(value)),
    );
    const processedIds = new Set(
      processedSummary
        .map((item) => this.firstNonEmptyString(item.id))
        .filter((value): value is string => Boolean(value)),
    );
    const missingProcessedIds = Array.from(rawIds).filter(
      (id) => !processedIds.has(id),
    );

    const summaryContext: Record<string, unknown> = {
      source,
      sessionId,
      rawCount: rawMessages.length,
      processedCount: processedMessages.length,
      droppedCount: rawMessages.length - processedMessages.length,
      missingProcessedIds: missingProcessedIds.slice(0, 20),
      rawLast: rawSummary[rawSummary.length - 1],
      processedLast: processedSummary[processedSummary.length - 1],
    };
    this.appendRenderParityDebugLog("history", {
      ...summaryContext,
      rawTail: rawSummary,
      processedTail: processedSummary,
    });
    this.logger.info("Render parity history snapshot", summaryContext);

    if (this.shouldVerboseStreamDebug()) {
      this.logger.debug("Render parity history raw tail", {
        source,
        sessionId,
        items: rawSummary,
      });
      this.logger.debug("Render parity history processed tail", {
        source,
        sessionId,
        items: processedSummary,
      });
    }
  }

  /**
   * Log prompt response diagnostics
   */
  logPromptResponseDiagnostics(
    sessionId: string,
    responseData: any,
  ): void {
    if (!this.shouldVerboseStreamDebug()) {
      return;
    }

    if (!responseData || typeof responseData !== "object") {
      return;
    }

    const info = this.asRecord(responseData.info);
    const messageId = this.firstNonEmptyString(info?.id, responseData.id);
    const parts = Array.isArray(responseData.parts) ? responseData.parts : [];

    console.log("[ChatViewProvider] Final response diagnostics", {
      sessionId,
      messageId,
      partCount: parts.length,
      partTypes: parts.map((part: any) =>
        typeof part?.type === "string" ? part.type : "unknown",
      ),
      role: this.firstNonEmptyString(info?.role, responseData.role),
      modelID: this.firstNonEmptyString(info?.modelID, responseData.modelID),
      providerID: this.firstNonEmptyString(
        info?.providerID,
        responseData.providerID,
      ),
    });

    parts.forEach((part: any, index: number) => {
      const partRec = this.asRecord(part) || {};
      const preview = this.firstNonEmptyString(
        partRec.delta,
        partRec.text,
        partRec.content,
        partRec.reasoning,
        partRec.message,
      );
      console.log("[ChatViewProvider] Final response part", {
        sessionId,
        messageId,
        index,
        type: this.firstNonEmptyString(partRec.type) || "unknown",
        preview:
          typeof preview === "string" ? preview.slice(0, 220) : undefined,
      });
    });
  }

  /**
   * Sanitize debug payload for logging
   */
  sanitizeDebugPayload(value: unknown): unknown {
    const maxDepth = 6;
    const maxArrayItems = 30;
    const maxObjectKeys = 80;
    const maxStringLength = 4000;
    const seen = new WeakSet<object>();

    const walk = (input: unknown, depth: number): unknown => {
      if (input === null || typeof input === "boolean" || typeof input === "number") {
        return input;
      }
      if (typeof input === "string") {
        if (input.startsWith("data:")) {
          return `<data-url omitted; length=${input.length}>`;
        }
        if (input.length > maxStringLength) {
          const truncatedBy = input.length - maxStringLength;
          return `${input.slice(0, maxStringLength)} ...<truncated ${truncatedBy} chars>`;
        }
        return input;
      }
      if (typeof input === "bigint") {
        return input.toString();
      }
      if (typeof input === "undefined") {
        return undefined;
      }
      if (typeof input === "function") {
        return "<function>";
      }
      if (typeof input !== "object") {
        return String(input);
      }

      if (seen.has(input as object)) {
        return "<circular>";
      }
      seen.add(input as object);

      if (depth >= maxDepth) {
        return "<max-depth>";
      }

      if (Array.isArray(input)) {
        const items = input
          .slice(0, maxArrayItems)
          .map((item) => walk(item, depth + 1));
        if (input.length > maxArrayItems) {
          items.push(
            `<truncated array; omitted ${input.length - maxArrayItems} item(s)>`,
          );
        }
        return items;
      }

      const rec = this.asRecord(input) || {};
      const entries = Object.entries(rec).slice(0, maxObjectKeys);
      const out: Record<string, unknown> = {};
      entries.forEach(([key, val]) => {
        const next = walk(val, depth + 1);
        if (typeof next !== "undefined") {
          out[key] = next;
        }
      });
      if (Object.keys(rec).length > maxObjectKeys) {
        out.__truncatedKeys = `<omitted ${Object.keys(rec).length - maxObjectKeys} key(s)>`;
      }
      return out;
    };

    return walk(value, 0);
  }

  /**
   * Build raw response debug text
   */
  buildRawResponseDebugText(value: unknown): string {
    const maxChars = 30000;
    let text: string;
    try {
      text = JSON.stringify(this.sanitizeDebugPayload(value), null, 2);
    } catch {
      try {
        text = String(value);
      } catch {
        text = "<unserializable response payload>";
      }
    }
    if (!text) {
      return "";
    }
    if (text.length <= maxChars) {
      return text;
    }
    return `${text.slice(0, maxChars)}\n...<truncated ${text.length - maxChars} chars>`;
  }

  /**
   * Get the debug file path
   */
  getDebugFilePath(): string | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder || workspaceFolder.uri.scheme !== "file") {
      return undefined;
    }
    return path.join(
      workspaceFolder.uri.fsPath,
      ".opencode-debug",
      "last-ai-exchange.json",
    );
  }

  /**
   * Get the render parity debug file path
   */
  getRenderParityDebugFilePath(): string {
    if (this.renderParityDebugFilePath) {
      return this.renderParityDebugFilePath;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder?.uri.scheme === "file") {
      this.renderParityDebugFilePath = path.join(
        workspaceFolder.uri.fsPath,
        ".opencode-debug",
        "render-parity.ndjson",
      );
      return this.renderParityDebugFilePath;
    }

    this.renderParityDebugFilePath = path.join(
      os.tmpdir(),
      "opencode-debug",
      "render-parity.ndjson",
    );
    return this.renderParityDebugFilePath;
  }

  /**
   * Append render parity debug log
   */
  appendRenderParityDebugLog(
    channel: "stream" | "history",
    payload: Record<string, unknown>,
  ): void {
    const filePath = this.getRenderParityDebugFilePath();
    const entry = {
      timestamp: new Date().toISOString(),
      channel,
      ...payload,
    };
    const line = `${JSON.stringify(this.sanitizeDebugPayload(entry))}\n`;

    this.renderParityLogWriteChain = this.renderParityLogWriteChain
      .catch(() => undefined)
      .then(async () => {
        try {
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.file(path.dirname(filePath)),
          );
          await fs.appendFile(filePath, line, "utf8");
          if (!this.didLogRenderParityFilePath) {
            this.didLogRenderParityFilePath = true;
            this.logger.info("Render parity debug file active", { filePath });
          }
        } catch (error) {
          if (this.shouldVerboseStreamDebug()) {
            console.warn(
              "[ChatViewProvider] Failed to append render parity debug log",
              {
                filePath,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }
      });
  }

  /**
   * Persist AI debug snapshot
   */
  async persistAiDebugSnapshot(
    snapshot: Record<string, unknown>,
  ): Promise<void> {
    try {
      const filePath = this.getDebugFilePath();
      if (!filePath) return;

      const dirPath = path.dirname(filePath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(filePath),
        new TextEncoder().encode(`${JSON.stringify(snapshot, null, 2)}\n`),
      );
      this.logger.info("AI debug snapshot written", { filePath });
    } catch (error) {
      this.logger.warn("Failed to persist AI debug snapshot", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Log prompt request payload
   */
  async logPromptRequestPayload(
    sessionId: string,
    promptBody: any,
    useStructuredOutput: boolean,
  ): Promise<void> {
    const requestRecord: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      sessionId,
      useStructuredOutput,
      prompt: this.sanitizeDebugPayload(promptBody),
    };
    this.promptDebugBySession.set(sessionId, requestRecord);

    this.logger.info("AI DEBUG request payload", {
      sessionId,
      useStructuredOutput,
      prompt: requestRecord.prompt,
    });
    console.log(
      "[ChatViewProvider][AI_DEBUG][request]",
      JSON.stringify(requestRecord, null, 2),
    );
    await this.persistAiDebugSnapshot({
      phase: "request",
      ...requestRecord,
    });
  }

  /**
   * Log prompt response payload
   */
  async logPromptResponsePayload(
    sessionId: string,
    response: any,
    durationSeconds: number,
    useStructuredOutput: boolean,
  ): Promise<void> {
    const requestRecord = this.promptDebugBySession.get(sessionId);
    const responseRecord: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      sessionId,
      useStructuredOutput,
      durationSeconds,
      status: response?.response?.status,
      hasData: Boolean(response?.data),
      hasError: Boolean(response?.error),
      error: this.sanitizeDebugPayload(response?.error),
      data: this.sanitizeDebugPayload(response?.data),
    };

    const combined: Record<string, unknown> = {
      phase: "response",
      request: requestRecord,
      response: responseRecord,
    };
    this.logger.info("AI DEBUG response payload", {
      sessionId,
      useStructuredOutput,
      status: responseRecord.status,
      hasData: responseRecord.hasData,
      hasError: responseRecord.hasError,
    });
    console.log(
      "[ChatViewProvider][AI_DEBUG][response]",
      JSON.stringify(combined, null, 2),
    );
    await this.persistAiDebugSnapshot(combined);
    this.promptDebugBySession.delete(sessionId);
  }

  /**
   * Check if verbose stream debug is enabled
   */
  private shouldVerboseStreamDebug(): boolean {
    const level = vscode.workspace
      .getConfiguration("opencode.logging")
      .get<string>("level", "info");
    return typeof level === "string" && level.toLowerCase() === "debug";
  }
}
