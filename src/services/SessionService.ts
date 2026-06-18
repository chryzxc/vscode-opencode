/**
 * Session Service - Session Management and Persistence
 *
 * Manages chat sessions with persistence and server synchronization.
 * This service implements a "best of both worlds" strategy by combining
 * server-side session data with local caching for offline access.
 *
 * **Architecture Overview:**
 * - Creates and deletes sessions via the OpenCode server
 * - Maintains local cache of session history
 * - Merges server and local data to prevent data loss
 * - Persists messages to workspace storage for offline access
 * - Manages current session state
 *
 * **Merge Strategy (Server + Local):**
 * The service combines data from two sources:
 * 1. **Server Sessions**: Sessions stored on the OpenCode server
 * 2. **Local History**: Sessions cached in VSCode workspace state
 *
 * **Merge Algorithm:**
 * ```
 * 1. Fetch sessions from server via API
 * 2. Load sessions from local workspace state
 * 3. Create a map using session ID as key
 * 4. Add all local sessions to map
 * 5. Add all server sessions to map (overwrites local if same ID)
 * 6. Convert map to array and sort by creation time (newest first)
 * ```
 *
 * **Conflict Resolution:**
 * - Same ID exists locally and server → Server version wins
 * - Only local exists → Kept (offline/local-only session)
 * - Only server exists → Added (new session from another device)
 *
 * **Persistence Layer:**
 * Uses VSCode's `workspaceState` for storage:
 * - `opencode.sessions`: Array of session metadata
 * - `opencode.session.messages.{id}`: Messages per session
 * - `opencode.currentSessionId`: Active session ID
 *
 * **State Initialization:**
 * - Loads persisted state asynchronously in constructor
 * - `getCurrentSession()` waits for initialization before returning
 * - Falls back to local-only session if server unavailable
 *
 *
 * @module SessionService
 * @see OpencodeServerManager for server client access
 * @see ChatViewProvider for session consumption
 */

import * as vscode from "vscode";
import { OpencodeServerManager } from "./OpencodeServerManager";
import type { Session } from "@opencode-ai/sdk";
import { createLogger } from "../utils/Logger";
import { LoggingCategories } from "../utils/LoggingSchema";
import { restoreCheckpointIfPresent } from "./CheckpointRestore";

const log = createLogger(LoggingCategories.SESSION_SERVICE);
const MAX_CACHED_MESSAGES_PER_SESSION = 200;
const MAX_CACHED_SESSION_BYTES = 4 * 1024 * 1024;
const MAX_PERSISTED_STRING_LENGTH = 120_000;
const MAX_PERSISTED_ARRAY_LENGTH = 256;
const MAX_PERSISTED_OBJECT_KEYS = 200;
const MAX_PERSISTED_DEPTH = 8;
const MAX_COMPACT_REASONING_EVENTS = 120;
const MAX_COMPACT_PROGRESS_EVENTS = 200;
const MAX_COMPACT_STEPS = 200;
const MAX_COMPACT_SUBAGENTS = 64;
const MAX_COMPACT_SUBAGENT_EVENTS = 120;
const MAX_COMPACT_INTERACTIVE_EVENTS = 40;

function isDataUrl(value: string): boolean {
  return /^data:[^;]+;base64,/i.test(value);
}

function formatApproxBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

function redactDataUrl(value: string): string {
  const commaIndex = value.indexOf(",");
  const header = commaIndex >= 0 ? value.slice(0, commaIndex) : "data:;base64";
  const base64 = commaIndex >= 0 ? value.slice(commaIndex + 1) : "";
  const approxBytes = Math.floor((base64.length * 3) / 4);
  return `[omitted data URL ${header}; ~${formatApproxBytes(approxBytes)}]`;
}

function truncateString(value: string): string {
  if (isDataUrl(value)) {
    return redactDataUrl(value);
  }

  if (value.length <= MAX_PERSISTED_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_PERSISTED_STRING_LENGTH)}...[truncated ${value.length - MAX_PERSISTED_STRING_LENGTH} chars]`;
}

function sanitizeForPersistence(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value == null) return value;

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value === "string" ? truncateString(value) : value;
  }

  if (depth >= MAX_PERSISTED_DEPTH) {
    return "[omitted: max depth reached]";
  }

  if (Array.isArray(value)) {
    const limited = value.slice(0, MAX_PERSISTED_ARRAY_LENGTH);
    const sanitized = limited.map((item) =>
      sanitizeForPersistence(item, depth + 1, seen),
    );
    if (value.length > limited.length) {
      sanitized.push(`[omitted ${value.length - limited.length} items]`);
    }
    return sanitized;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) {
      return "[omitted: circular reference]";
    }
    seen.add(obj);

    const result: Record<string, unknown> = {};
    const entries = Object.entries(obj).slice(0, MAX_PERSISTED_OBJECT_KEYS);
    for (const [key, nested] of entries) {
      result[key] = sanitizeForPersistence(nested, depth + 1, seen);
    }
    if (Object.keys(obj).length > entries.length) {
      result.__truncatedKeys = Object.keys(obj).length - entries.length;
    }
    if (!Object.prototype.hasOwnProperty.call(result, "rawResponse") &&
      Object.prototype.hasOwnProperty.call(obj, "rawResponse")) {
      result.rawResponse = sanitizeForPersistence(
        obj.rawResponse,
        depth + 1,
        seen,
      );
    }
    if (
      !Object.prototype.hasOwnProperty.call(result, "rawSdkEventPayloads") &&
      Object.prototype.hasOwnProperty.call(obj, "rawSdkEventPayloads")
    ) {
      result.rawSdkEventPayloads = sanitizeForPersistence(
        obj.rawSdkEventPayloads,
        depth + 1,
        seen,
      );
    }
    return result;
  }

  return String(value);
}

function estimateSerializedBytes(value: unknown): number {
  try {
    return Buffer.RbyteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function compactReasoningEventForPersistence(event: unknown): unknown {
  if (!event || typeof event !== "object") {
    return sanitizeForPersistence(event);
  }

  const rec = event as Record<string, unknown>;
  const compact: Record<string, unknown> = {};

  if (typeof rec.id === "string") compact.id = rec.id;
  if (typeof rec.text === "string") compact.text = truncateString(rec.text);
  if (typeof rec.createdAt === "number") compact.createdAt = rec.createdAt;
  if (typeof rec.messageID === "string") compact.messageID = rec.messageID;
  if (typeof rec.partID === "string") compact.partID = rec.partID;

  if (Object.keys(compact).length === 0) {
    return sanitizeForPersistence(event);
  }
  return compact;
}

function compactProgressEventForPersistence(event: unknown): unknown {
  if (!event || typeof event !== "object") {
    return sanitizeForPersistence(event);
  }

  const rec = event as Record<string, unknown>;
  const compact: Record<string, unknown> = {};

  if (typeof rec.id === "string") compact.id = rec.id;
  if (typeof rec.type === "string") compact.type = rec.type;
  if (typeof rec.title === "string") compact.title = truncateString(rec.title);
  if (typeof rec.content === "string") compact.content = truncateString(rec.content);
  if (typeof rec.status === "string") compact.status = rec.status;
  if (typeof rec.meta === "string") compact.meta = truncateString(rec.meta);
  if (typeof rec.filePath === "string") compact.filePath = rec.filePath;
  if (typeof rec.callID === "string") compact.callID = rec.callID;
  if (typeof rec.createdAt === "number") compact.createdAt = rec.createdAt;
  if (typeof rec.messageID === "string") compact.messageID = rec.messageID;
  if (typeof rec.partID === "string") compact.partID = rec.partID;

  const diffStats =
    rec.diffStats && typeof rec.diffStats === "object"
      ? (rec.diffStats as Record<string, unknown>)
      : null;
  if (diffStats) {
    compact.diffStats = {
      added:
        typeof diffStats.added === "number" ? Math.max(0, diffStats.added) : 0,
      deleted:
        typeof diffStats.deleted === "number"
          ? Math.max(0, diffStats.deleted)
          : 0,
    };
  }

  if (Object.keys(compact).length === 0) {
    return sanitizeForPersistence(event);
  }
  return compact;
}

function compactSubagentForPersistence(subagent: unknown): unknown {
  if (!subagent || typeof subagent !== "object") {
    return sanitizeForPersistence(subagent);
  }

  const rec = subagent as Record<string, unknown>;
  const compact: Record<string, unknown> = {};

  if (typeof rec.id === "string") compact.id = rec.id;
  if (typeof rec.parentSessionId === "string") {
    compact.parentSessionId = rec.parentSessionId;
  }
  if (typeof rec.parentMessageId === "string") {
    compact.parentMessageId = rec.parentMessageId;
  }
  if (typeof rec.childSessionId === "string") {
    compact.childSessionId = rec.childSessionId;
  }
  if (typeof rec.agentId === "string") compact.agentId = rec.agentId;
  if (typeof rec.name === "string") compact.name = rec.name;
  if (typeof rec.providerID === "string") compact.providerID = rec.providerID;
  if (typeof rec.modelID === "string") compact.modelID = rec.modelID;
  if (typeof rec.status === "string") compact.status = rec.status;
  if (typeof rec.latestActivity === "string") {
    compact.latestActivity = truncateString(rec.latestActivity);
  }
  if (typeof rec.description === "string") {
    compact.description = truncateString(rec.description);
  }
  if (typeof rec.progress === "number") compact.progress = rec.progress;
  if (typeof rec.startedAt === "number") compact.startedAt = rec.startedAt;
  if (typeof rec.endedAt === "number") compact.endedAt = rec.endedAt;
  if (typeof rec.durationMs === "number") compact.durationMs = rec.durationMs;
  if (typeof rec.errorText === "string") {
    compact.errorText = truncateString(rec.errorText);
  }
  if (typeof rec.hydrationUnavailable === "boolean") {
    compact.hydrationUnavailable = rec.hydrationUnavailable;
  }

  if (Array.isArray(rec.references)) {
    compact.references = rec.references
      .slice(-MAX_COMPACT_SUBAGENT_EVENTS)
      .map((item) => sanitizeForPersistence(item));
  }
  if (Array.isArray(rec.thinkingEvents)) {
    compact.thinkingEvents = rec.thinkingEvents
      .slice(-MAX_COMPACT_SUBAGENT_EVENTS)
      .map((item) => compactReasoningEventForPersistence(item));
  }
  if (Array.isArray(rec.conversationEvents)) {
    compact.conversationEvents = rec.conversationEvents
      .slice(-MAX_COMPACT_SUBAGENT_EVENTS)
      .map((item) => sanitizeForPersistence(item));
  }
  if (Array.isArray(rec.progressEvents)) {
    compact.progressEvents = rec.progressEvents
      .slice(-MAX_COMPACT_SUBAGENT_EVENTS)
      .map((item) => compactProgressEventForPersistence(item));
  }
  if (Array.isArray(rec.timelineEvents)) {
    compact.timelineEvents = rec.timelineEvents
      .slice(-MAX_COMPACT_SUBAGENT_EVENTS)
      .map((item) => sanitizeForPersistence(item));
  }
  if (rec.tokenUsage && typeof rec.tokenUsage === "object") {
    compact.tokenUsage = sanitizeForPersistence(rec.tokenUsage);
  }

  if (Object.keys(compact).length === 0) {
    return sanitizeForPersistence(subagent);
  }

  return compact;
}

function compactMessageForPersistence(message: unknown): unknown {
  if (!message || typeof message !== "object") {
    return sanitizeForPersistence(message);
  }

  const rec = message as Record<string, unknown>;
  const compact: Record<string, unknown> = {};

  if (typeof rec.id === "string") compact.id = rec.id;
  if (typeof rec.messageID === "string") compact.messageID = rec.messageID;
  if (typeof rec.role === "string") compact.role = rec.role;
  if (typeof rec.content === "string") compact.content = truncateString(rec.content);
  if (typeof rec.text === "string") compact.text = truncateString(rec.text);
  if (typeof rec.plainTextFallback === "boolean") {
    compact.plainTextFallback = rec.plainTextFallback;
  }
  if (typeof rec.plainTextFallbackMessage === "string") {
    compact.plainTextFallbackMessage = truncateString(rec.plainTextFallbackMessage);
  }
  if (typeof rec.plainTextFallbackReason === "string") {
    compact.plainTextFallbackReason = truncateString(rec.plainTextFallbackReason);
  }
  if (rec.time) compact.time = sanitizeForPersistence(rec.time);
  if (rec.info) compact.info = sanitizeForPersistence(rec.info);

  if (Array.isArray(rec.parts)) {
    compact.parts = (rec.parts as unknown[])
      .slice(0, 16)
      .map((part) => sanitizeForPersistence(part));
  }

  if (Array.isArray(rec.rawSdkEventPayloads)) {
    // Preserve the raw SDK event tape so rehydrated debug views can inspect
    // the exact event payloads that drove the assistant turn.
    compact.rawSdkEventPayloads = (rec.rawSdkEventPayloads as unknown[])
      .slice(-200)
      .map((item) => sanitizeForPersistence(item));
  }

  if (Array.isArray(rec.reasoningEvents)) {
    compact.reasoningEvents = (rec.reasoningEvents as unknown[])
      .slice(-MAX_COMPACT_REASONING_EVENTS)
      .map((event) => compactReasoningEventForPersistence(event));
  }

  if (Array.isArray(rec.progressEvents)) {
    compact.progressEvents = (rec.progressEvents as unknown[])
      .slice(-MAX_COMPACT_PROGRESS_EVENTS)
      .map((event) => compactProgressEventForPersistence(event));
  }

  if (Array.isArray(rec.steps)) {
    compact.steps = (rec.steps as unknown[])
      .slice(-MAX_COMPACT_STEPS)
      .map((step) => compactProgressEventForPersistence(step));
  }

  if (Array.isArray(rec.edits)) {
    compact.edits = (rec.edits as unknown[]).slice(0, 32).map((edit) => {
      const editRec =
        edit && typeof edit === "object"
          ? (edit as Record<string, unknown>)
          : null;
      if (editRec?.file && typeof editRec.file === "string") {
        return { file: editRec.file };
      }
      return sanitizeForPersistence(edit);
    });
  }

  if (Array.isArray(rec.images)) {
    compact.images = (rec.images as unknown[]).map((img) =>
      typeof img === "string" ? redactDataUrl(img) : sanitizeForPersistence(img),
    );
  }

  if (Array.isArray(rec.subagents)) {
    compact.subagents = (rec.subagents as unknown[])
      .slice(0, MAX_COMPACT_SUBAGENTS)
      .map((subagent) => compactSubagentForPersistence(subagent));
  }

  if (Array.isArray(rec.interactiveEvents)) {
    compact.interactiveEvents = (rec.interactiveEvents as unknown[])
      .slice(-MAX_COMPACT_INTERACTIVE_EVENTS)
      .map((event) => sanitizeForPersistence(event));
  }

  if (rec.plan && typeof rec.plan === "object") {
    compact.plan = sanitizeForPersistence(rec.plan);
  }

  if (rec.structuredOutput && typeof rec.structuredOutput === "object") {
    compact.structuredOutput = sanitizeForPersistence(rec.structuredOutput);
  }

  if (Object.keys(compact).length === 0) {
    return sanitizeForPersistence(message);
  }

  return compact;
}

function normalizeSessionId(id: unknown): string | null {
  if (typeof id !== "string") {
    return null;
  }

  const normalized = id.trim();
  return normalized.length > 0 ? normalized : null;
}

function getSessionCreatedTime(session: Session | null | undefined): number {
  const created = session?.time?.created;
  return typeof created === "number" && Number.isFinite(created) ? created : 0;
}

function mergeSessionRecords(existing: Session, incoming: Session): Session {
  const existingCreated = getSessionCreatedTime(existing);
  const incomingCreated = getSessionCreatedTime(incoming);
  const preferred = incomingCreated >= existingCreated ? incoming : existing;
  const fallback = preferred === incoming ? existing : incoming;

  return {
    ...fallback,
    ...preferred,
    id: preferred.id || fallback.id,
    title: preferred.title || fallback.title,
    time: preferred.time ?? fallback.time,
  };
}

function getMessageCreatedTime(message: unknown): number {
  if (!message || typeof message !== "object") {
    return 0;
  }

  const rec = message as Record<string, unknown>;
  const messageTime =
    rec.time && typeof rec.time === "object"
      ? (rec.time as Record<string, unknown>)
      : undefined;
  const info =
    rec.info && typeof rec.info === "object"
      ? (rec.info as Record<string, unknown>)
      : undefined;
  const infoTime =
    info?.time && typeof info.time === "object"
      ? (info.time as Record<string, unknown>)
      : undefined;

  const numericCandidates = [
    messageTime?.created,
    infoTime?.created,
    rec.createdAt,
    rec.timestamp,
    info?.createdAt,
    info?.timestamp,
  ];
  for (const candidate of numericCandidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  const stringCandidates = [
    rec.createdAt,
    rec.timestamp,
    info?.createdAt,
    info?.timestamp,
  ];
  for (const candidate of stringCandidates) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      continue;
    }
    const parsed = new Date(candidate).getTime();
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function getMessageRoleForSignature(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const rec = message as Record<string, unknown>;
  if (typeof rec.role === "string" && rec.role.trim().length > 0) {
    return rec.role;
  }
  const info = rec.info;
  if (info && typeof info === "object") {
    const infoRole = (info as Record<string, unknown>).role;
    if (typeof infoRole === "string" && infoRole.trim().length > 0) {
      return infoRole;
    }
  }
  return "";
}

function getMessageSessionIdForSignature(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const rec = message as Record<string, unknown>;
  const directCandidates = [
    rec.sessionID,
    rec.sessionId,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  const info =
    rec.info && typeof rec.info === "object"
      ? (rec.info as Record<string, unknown>)
      : undefined;
  const infoCandidates = [
    info?.sessionID,
    info?.sessionId,
  ];
  for (const candidate of infoCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return "";
}

function getMessageTextForSignature(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const rec = message as Record<string, unknown>;
  const content =
    typeof rec.content === "string" ? rec.content : "";
  const text =
    typeof rec.text === "string" ? rec.text : "";
  const direct = content || text;
  if (direct.trim().length > 0) {
    return direct.slice(0, 300);
  }

  const parts = Array.isArray(rec.parts) ? rec.parts : [];
  const partText = parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const partRec = part as Record<string, unknown>;
      const type = typeof partRec.type === "string" ? partRec.type : "";
      if (
        type === "reasoning" ||
        type === "thinking" ||
        type === "thought"
      ) {
        return "";
      }
      const piece =
        typeof partRec.text === "string"
          ? partRec.text
          : typeof partRec.content === "string"
            ? partRec.content
            : "";
      return piece;
    })
    .join("")
    .trim();
  return partText.slice(0, 300);
}

function getMessageSignature(message: unknown): string {
  if (!message || typeof message !== "object") {
    return `primitive:${String(message)}`;
  }

  const rec = message as Record<string, unknown>;
  const info = rec.info;
  if (info && typeof info === "object") {
    const infoId = (info as Record<string, unknown>).id;
    if (typeof infoId === "string" && infoId.length > 0) {
      return `id:${infoId}`;
    }
  }

  const rootId = rec.id;
  if (typeof rootId === "string" && rootId.length > 0) {
    return `id:${rootId}`;
  }

  const role = getMessageRoleForSignature(message);
  const body = getMessageTextForSignature(message).slice(0, 200);
  const created = getMessageCreatedTime(message);
  return `fallback:${role}|${created}|${body}`;
}

function normalizeSignatureText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function getMessageFallbackSignature(message: unknown): string {
  if (!message || typeof message !== "object") {
    return `fallback:${String(message)}`;
  }

  const role = getMessageRoleForSignature(message);
  const body = getMessageTextForSignature(message).slice(0, 300);
  const created = getMessageCreatedTime(message);
  return `fallback:${role}|${created}|${body}`;
}

function getAssistantContentAliasSignatures(message: unknown): string[] {
  if (!message || typeof message !== "object") {
    return [];
  }

  const role = getMessageRoleForSignature(message).toLowerCase();
  if (role !== "assistant") {
    return [];
  }

  const body = normalizeSignatureText(getMessageTextForSignature(message));
  if (!body) {
    return [];
  }

  const created = getMessageCreatedTime(message);
  const createdPart = created > 0 ? String(Math.floor(created / 15_000)) : "unknown";
  const sessionId = getMessageSessionIdForSignature(message) || "unknown";
  const truncated = body.slice(0, 500);
  const aliases: string[] = [];

  aliases.push(`assistant-activity:any|${createdPart}|${truncated}`);
  if (sessionId !== "unknown") {
    aliases.push(`assistant-activity:${sessionId}|${createdPart}|${truncated}`);
  }

  return aliases;
}

/**
 * Narrows a raw message object to the centralized SDK UserMessage shape.
 *
 * The server wraps SDK messages as `{ info: UserMessage | AssistantMessage, parts: [...] }`.
 * Locally-appended optimistic messages are plain `{ role: "user", content: string, ... }`
 * with no `info` envelope.
 */
function extractUserMessageRecord(
  message: unknown,
): (UserMessage & Record<string, unknown>) | (Record<string, unknown> & { role: "user" }) | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const rec = message as Record<string, unknown>;

  if (rec.info && typeof rec.info === "object") {
    const info = rec.info as SdkMessage & Record<string, unknown>;
    if (info.role === "user") {
      return info as UserMessage & Record<string, unknown>;
    }
    return undefined;
  }

  if (rec.role === "user") {
    return rec as Record<string, unknown> & { role: "user" };
  }

  return undefined;
}

/**
 * Extracts the canonical text body of a user message.
 */
function getUserMessageBody(userRec: Record<string, unknown>): string {
  const candidates: unknown[] = [
    userRec["content"],
    userRec["text"],
    ...(Array.isArray(userRec["parts"])
      ? (userRec["parts"] as unknown[]).flatMap((part) => {
          if (!part || typeof part !== "object") return [];
          const p = part as Record<string, unknown>;
          if (p["type"] !== "text") return [];
          return [p["text"] ?? p["content"]];
        })
      : []),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return "";
}

/**
 * Returns content-only alias signatures for user-role messages.
 */
function getUserMessageContentAliasSignatures(message: unknown): string[] {
  const userRec = extractUserMessageRecord(message);
  if (!userRec) {
    return [];
  }

  const rawBody = getUserMessageBody(userRec);
  const body = normalizeSignatureText(rawBody);
  if (!body) {
    return [];
  }

  const truncated = body.slice(0, 500);
  const aliases: string[] = [];

  aliases.push(`user-content:any|${truncated}`);

  const sessionId: string =
    (typeof (userRec as Record<string, unknown>)["sessionID"] === "string"
      ? ((userRec as Record<string, unknown>)["sessionID"] as string)
      : "") ||
    (typeof (userRec as Record<string, unknown>)["sessionId"] === "string"
      ? ((userRec as Record<string, unknown>)["sessionId"] as string)
      : "");
      
  if (sessionId) {
    aliases.push(`user-content:${sessionId}|${truncated}`);
  }

  return aliases;
}

function getMessageSignaturesForMerge(message: unknown): string[] {
  const signatures = new Set<string>();
  const primary = getMessageSignature(message);
  signatures.add(primary);

  const fallback = getMessageFallbackSignature(message);
  if (fallback !== primary) {
    signatures.add(fallback);
  }

  for (const alias of getAssistantContentAliasSignatures(message)) {
    signatures.add(alias);
  }

  for (const alias of getUserMessageContentAliasSignatures(message)) {
    signatures.add(alias);
  }

  return Array.from(signatures.values());
}

function messageRichnessScore(message: unknown): number {
  if (!message || typeof message !== "object") {
    return 0;
  }

  const rec = message as Record<string, unknown>;
  let score = 0;

  const content =
    typeof rec.content === "string"
      ? rec.content
      : typeof rec.text === "string"
        ? rec.text
        : "";
  score += Math.min(400, Math.floor(content.length / 20));

  const partsCount = Array.isArray(rec.parts) ? rec.parts.length : 0;
  const reasoningEventsCount = Array.isArray(rec.reasoningEvents)
    ? rec.reasoningEvents.length
    : 0;
  const progressEventsCount = Array.isArray(rec.progressEvents)
    ? rec.progressEvents.length
    : 0;
  const stepsCount = Array.isArray(rec.steps) ? rec.steps.length : 0;
  const editsCount = Array.isArray(rec.edits) ? rec.edits.length : 0;
  const subagentsCount = Array.isArray(rec.subagents) ? rec.subagents.length : 0;

  score += partsCount * 2;
  score += reasoningEventsCount * 12;
  score += progressEventsCount * 10;
  score += stepsCount * 8;
  score += editsCount * 4;
  score += subagentsCount * 16;

  const planRec =
    rec.plan && typeof rec.plan === "object"
      ? (rec.plan as Record<string, unknown>)
      : null;
  const planContent = planRec?.content;
  if (typeof planContent === "string" && planContent.trim().length > 0) {
    score += Math.min(180, Math.floor(planContent.length / 120));
  }

  if (rec.structuredOutput && typeof rec.structuredOutput === "object") {
    score += 20;
  }

  return score;
}

function mergeSubagentArray(
  preferred: unknown[] | undefined,
  fallback: unknown[] | undefined,
): unknown[] | undefined {
  const preferredList = Array.isArray(preferred) ? preferred : [];
  const fallbackList = Array.isArray(fallback) ? fallback : [];
  if (preferredList.length === 0 && fallbackList.length === 0) {
    return undefined;
  }
  if (preferredList.length === 0) {
    return [...fallbackList];
  }
  if (fallbackList.length === 0) {
    return [...preferredList];
  }

  const byId = new Map<string, unknown>();
  const pushEntry = (entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const rec = entry as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!id) {
      return;
    }
    const existing = byId.get(id);
    if (!existing || typeof existing !== "object") {
      byId.set(id, entry);
      return;
    }
    byId.set(id, {
      ...(existing as Record<string, unknown>),
      ...rec,
    });
  };

  preferredList.forEach(pushEntry);
  fallbackList.forEach(pushEntry);

  const merged = Array.from(byId.values());
  if (merged.length > 0) {
    return merged;
  }

  return [...preferredList, ...fallbackList];
}

function mergeRicherMessageFields(
  preferred: unknown,
  fallback: unknown,
): unknown {
  if (!preferred || typeof preferred !== "object") {
    return preferred;
  }
  if (!fallback || typeof fallback !== "object") {
    return preferred;
  }

  const preferredRec = preferred as Record<string, unknown>;
  const fallbackRec = fallback as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...preferredRec };

  const backfillArrayField = (field: string, mergeSubagents = false) => {
    const preferredArray = Array.isArray(preferredRec[field])
      ? (preferredRec[field] as unknown[])
      : undefined;
    const fallbackArray = Array.isArray(fallbackRec[field])
      ? (fallbackRec[field] as unknown[])
      : undefined;

    if (mergeSubagents) {
      const mergedSubagents = mergeSubagentArray(preferredArray, fallbackArray);
      if (mergedSubagents && mergedSubagents.length > 0) {
        merged[field] = mergedSubagents;
      }
      return;
    }

    if ((!preferredArray || preferredArray.length === 0) && fallbackArray) {
      merged[field] = fallbackArray;
    }
  };

  backfillArrayField("reasoningEvents");
  backfillArrayField("progressEvents");
  backfillArrayField("steps");
  backfillArrayField("edits");
  backfillArrayField("interactiveEvents");
  backfillArrayField("rawSdkEventPayloads");
  backfillArrayField("parts");
  backfillArrayField("subagents", true);
  backfillArrayField("images");
  backfillArrayField("attachments");

  if (!merged.plan && fallbackRec.plan) {
    merged.plan = fallbackRec.plan;
  }
  if (!merged.structuredOutput && fallbackRec.structuredOutput) {
    merged.structuredOutput = fallbackRec.structuredOutput;
  }
  if (!merged.rawResponse && fallbackRec.rawResponse) {
    merged.rawResponse = fallbackRec.rawResponse;
  }
  if (!merged.rawSdkEventPayloads && fallbackRec.rawSdkEventPayloads) {
    merged.rawSdkEventPayloads = fallbackRec.rawSdkEventPayloads;
  }
  if (!merged.info && fallbackRec.info) {
    merged.info = fallbackRec.info;
  }
  if (
    (typeof merged.content !== "string" || merged.content.length === 0) &&
    typeof fallbackRec.content === "string" &&
    fallbackRec.content.length > 0
  ) {
    merged.content = fallbackRec.content;
  }
  if (
    (typeof merged.text !== "string" || merged.text.length === 0) &&
    typeof fallbackRec.text === "string" &&
    fallbackRec.text.length > 0
  ) {
    merged.text = fallbackRec.text;
  }

  return merged;
}

function pickRicherMessage(existing: unknown, incoming: unknown): unknown {
  const existingScore = messageRichnessScore(existing);
  const incomingScore = messageRichnessScore(incoming);
  const preferred = incomingScore > existingScore ? incoming : existing;
  const fallback = preferred === incoming ? existing : incoming;
  if (incomingScore > existingScore) {
    return mergeRicherMessageFields(preferred, fallback);
  }
  if (incomingScore < existingScore) {
    return mergeRicherMessageFields(preferred, fallback);
  }

  const existingBytes = estimateSerializedBytes(existing);
  const incomingBytes = estimateSerializedBytes(incoming);
  const bytePreferred = incomingBytes > existingBytes ? incoming : existing;
  const byteFallback = bytePreferred === incoming ? existing : incoming;
  return mergeRicherMessageFields(bytePreferred, byteFallback);
}

function mergeConversationMessages(messageGroups: unknown[][]): unknown[] {
  const flattened: Array<{ message: unknown; created: number; order: number }> =
    [];
  let order = 0;

  for (const group of messageGroups) {
    for (const message of group) {
      flattened.push({
        message,
        created: getMessageCreatedTime(message),
        order: order++,
      });
    }
  }

  flattened.sort((a, b) =>
    a.created === b.created ? a.order - b.order : a.created - b.created,
  );

  const merged: unknown[] = [];
  const indexBySignature = new Map<string, number>();
  for (const item of flattened) {
    const signatures = getMessageSignaturesForMerge(item.message);
    const existingIndex = signatures
      .map((signature) => indexBySignature.get(signature))
      .find((index): index is number => typeof index === "number");
    if (existingIndex === undefined) {
      const nextIndex = merged.length;
      merged.push(item.message);
      signatures.forEach((signature) => {
        indexBySignature.set(signature, nextIndex);
      });
      continue;
    }
    merged[existingIndex] = pickRicherMessage(
      merged[existingIndex],
      item.message,
    );
    const mergedSignatures = getMessageSignaturesForMerge(merged[existingIndex]);
    mergedSignatures.forEach((signature) => {
      indexBySignature.set(signature, existingIndex);
    });
  }

  return merged;
}

function summarizePotentialAssistantDuplicates(messages: unknown[]): {
  totalAssistantMessages: number;
  duplicateGroups: number;
  duplicateMessages: number;
  samples: string[];
} {
  const buckets = new Map<string, number>();
  let totalAssistantMessages = 0;

  for (const message of messages) {
    if (getMessageRoleForSignature(message).toLowerCase() !== "assistant") {
      continue;
    }
    totalAssistantMessages += 1;
    const alias = getAssistantContentAliasSignature(message);
    if (!alias) {
      continue;
    }
    buckets.set(alias, (buckets.get(alias) ?? 0) + 1);
  }

  const duplicateEntries = Array.from(buckets.entries()).filter(([, count]) => count > 1);
  return {
    totalAssistantMessages,
    duplicateGroups: duplicateEntries.length,
    duplicateMessages: duplicateEntries.reduce((sum, [, count]) => sum + count, 0),
    samples: duplicateEntries.slice(0, 5).map(([key, count]) => `${count}x ${key.slice(0, 160)}`),
  };
}

function hasSessionAliasConflicts(
  aliasesByCanonicalId: Map<string, string[]>,
): boolean {
  for (const [canonicalId, aliases] of Array.from(aliasesByCanonicalId.entries())) {
    if (aliases.some((alias) => alias !== canonicalId)) {
      return true;
    }
  }
  return false;
}

function coalesceSessionsById(sessions: Session[]): {
  sessions: Session[];
  aliasesByCanonicalId: Map<string, string[]>;
  hadChanges: boolean;
} {
  const byCanonicalId = new Map<string, Session>();
  const aliasSets = new Map<string, Set<string>>();
  let hadChanges = false;

  for (const session of sessions) {
    const rawId = typeof session?.id === "string" ? session.id : "";
    const canonicalId = normalizeSessionId(rawId);
    if (!canonicalId) {
      hadChanges = true;
      continue;
    }

    const aliases = aliasSets.get(canonicalId) ?? new Set<string>();
    aliases.add(canonicalId);
    if (rawId) {
      aliases.add(rawId);
    }
    aliasSets.set(canonicalId, aliases);

    const normalizedSession =
      canonicalId === rawId ? session : { ...session, id: canonicalId };
    if (canonicalId !== rawId) {
      hadChanges = true;
    }

    const existing = byCanonicalId.get(canonicalId);
    if (!existing) {
      byCanonicalId.set(canonicalId, normalizedSession);
      continue;
    }

    byCanonicalId.set(
      canonicalId,
      mergeSessionRecords(existing, normalizedSession),
    );
    hadChanges = true;
  }

  const dedupedSessions = Array.from(byCanonicalId.values()).sort((a, b) => {
    return getSessionCreatedTime(b) - getSessionCreatedTime(a);
  });

  if (dedupedSessions.length !== sessions.length) {
    hadChanges = true;
  }

  const aliasesByCanonicalId = new Map<string, string[]>();
  for (const [canonicalId, aliasSet] of Array.from(aliasSets.entries())) {
    aliasesByCanonicalId.set(canonicalId, Array.from(aliasSet));
  }

  return {
    sessions: dedupedSessions,
    aliasesByCanonicalId,
    hadChanges,
  };
}

/**
 * Manages chat sessions with persistence and server synchronization.
 *
 * This service provides:
 * - Session CRUD operations (create, read, update, delete)
 * - Message persistence with server fallback
 * - Server-local merge strategy for data resilience
 * - State restoration across VSCode restarts
 *
 * **Usage Pattern:**
 * ```typescript
 * const service = new SessionService(context, serverManager);
 *
 * // Get or create current session (auto-creates if needed)
 * const session = await service.getCurrentSession();
 *
 * // List all sessions (merged from server + local)
 * const sessions = await service.listSessions();
 *
 * // Switch to a different session
 * await service.switchSession(otherSessionId);
 *
 * // Switch to a different session
 * await service.switchSession(otherSessionId);
 * ```
 *
 * **Persistence Configuration:**
 * Session persistence can be disabled via settings:
 * ```json
 * {
 *   "opencode.persistSessions": false
 * }
 * ```
 *
 * **Thread Safety:**
 * This class is not thread-safe. All methods should be called from the
 * main VSCode extension host thread.
 *
 * **Storage Keys:**
 * All keys use the "opencode." prefix to avoid collisions with other extensions.
 * Message keys use dynamic suffix based on session ID.
 */
export class SessionService {
  /** Currently active session (null if none selected) */
  private currentSession: Session | null = null;

  /** In-memory cache of session history (merged from server + local) */
  private sessionHistory: Session[] = [];

  /** Promise that resolves when initialization completes */
  private initializationPromise: Promise<void> | null = null;

  /** Track last logged session ID for deduplication */
  private lastLoggedSessionId: string | null = null;

  /** In-memory cache of raw SDK event payloads by session for atomic appends */
  private rawSdkEventPayloadCache = new Map<string, unknown[]>();

  /** In-memory cache of raw SDK message payloads by session */
  private rawMessageCache = new Map<string, unknown[]>();

  /** Per-session debounce timer for raw SDK event payload persistence */
  private rawSdkEventPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private cloneRawSdkEventPayload<T>(value: T): T {
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  private shouldPersistRawSdkEventPayload(event: unknown): boolean {
    if (!event || typeof event !== "object") {
      return true;
    }
    const record = event as Record<string, unknown>;
    // Temporary debug alignment: keep the persisted tape on the same
    // session-scoped shape the centralized panel shows while we test the
    // rehydration contract.
    return record.source !== "/global/event";
  }

  private filterPersistedRawSdkEventPayloads(events: unknown[] | undefined): unknown[] {
    if (!Array.isArray(events) || events.length === 0) {
      return [];
    }
    return events.filter((event) => this.shouldPersistRawSdkEventPayload(event));
  }

  // ============================================================================
  // PERSISTENCE KEYS
  // ============================================================================
  // These keys are used for VSCode workspaceState storage.
  // All keys use "opencode." prefix to avoid collisions.

  /** Key for storing session list array */
  private static readonly SESSIONS_KEY = "opencode.sessions";

  /** Prefix for storing messages per session (appended with session ID) */
  private static readonly MESSAGES_PREFIX = "opencode.session.messages.";

  /** Prefix for storing raw SDK payloads per session (appended with session ID) */
  private static readonly RAW_MESSAGES_PREFIX = "opencode.session.raw-messages.";

  /** Prefix for storing raw SDK event payloads per session (appended with session ID) */
  private static readonly RAW_SDK_EVENT_PAYLOADS_PREFIX =
    "opencode.session.raw-sdk-event-payloads.";

  /** Key for storing current session ID */
  private static readonly SESSION_ID_KEY = "opencode.currentSessionId";

  /**
   * Fallback ID for messages without a session.
   *
   * Used when messages need to be stored but no session context exists.
   * This is rare and typically indicates an edge case during initialization.
   */
  public static readonly MESSAGE_FALLBACK_ID = "opencode.fallback";

  /**
   * Creates a new session service instance.
   *
   * **Initialization Behavior:**
   * - Constructor starts asynchronous state loading
   * - `getCurrentSession()` waits for initialization before returning
   * - This prevents race conditions during extension startup
   *
   * **State Loading:**
   * - Loads session history from workspace state
   * - Restores current session ID
   * - Tries to reconnect to server for current session
   *
   * **Lazy Initialization:**
   * Server connection is NOT established in constructor.
   * It's established on-demand when methods call `ensureRunning()`.
   *
   * @param context - VSCode extension context for workspace storage access
   * @param serverManager - Server manager for creating server client
   */
  constructor(
    private context: vscode.ExtensionContext,
    private serverManager: OpencodeServerManager,
  ) {
    // Start loading persisted state asynchronously
    // This ensures state is ready before we need it
    // Try restoring any workspace-level checkpoint first (safe no-op)
    this.initializationPromise = (async () => {
      try {
        await restoreCheckpointIfPresent(this.context);
      } catch (e) {
        // proceed even if restore fails; loadPersistedState will handle existing workspaceState
        // We intentionally do not throw here to avoid breaking activation
      }
      await this.loadPersistedState();
    })();
  }

  /**
   * Creates a new session on the server.
   *
   * **Creation Flow:**
   * 1. Ensures server is running
   * 2. Calls server API to create session with provided title
   * 3. Updates current session reference
   * 4. Adds to local history (if not duplicate)
   * 5. Persists state to workspace storage
   *
   * **Title Handling:**
   * - If title provided: Sends it to OpenCode explicitly
   * - If no title: Omits the title so OpenCode owns title generation
   *
   * **Error Handling:**
   * - Throws if server returns error response
   * - Extracts error message from response (handles multiple formats)
   * - Logs detailed error for debugging
   *
   * **Duplicate Handling:**
   * If session with same ID already exists in history, doesn't add duplicate.
   * This can happen if server returns session we already know about.
   *
   * @param title - Optional explicit title for the session
   * @returns Promise resolving to the created session
   * @throws {Error} If server fails to create session
   *
   * @example
   * ```typescript
   * const session = await service.createNewSession("My Planning Session");
   * console.log('Created session:', session.id);
   * ```
   */
  async createNewSession(title?: string): Promise<Session> {
    const flow = log.startFeatureFlow('CreateSession', { title });

    const client = await this.serverManager.ensureRunning();
    log.featureStep(flow, 'server_ready');

    const createOptions = title ? { body: { title } } : {};
    const response = await client.session.create(createOptions);

    if (!response.data) {
      const errorDetails = JSON.stringify(response.error || {}, null, 2);
      log.error("Failed to create session", {
        status: response.response.status,
        error: response.error,
      });
      const em = (response.error || {}) as {
        message?: string;
        errors?: Array<{ message?: string }>;
      };
      const msg =
        em?.message ||
        (Array.isArray(em?.errors) ? em.errors[0]?.message : undefined) ||
        "Unknown error";
      log.endFeatureFlow(flow, { status: 'failed', error: msg });
      throw new Error(`Failed to create session: ${msg}`);
    }

    const session = response.data;
    this.currentSession = session;
    log.featureStep(flow, 'session_created', { sessionId: session.id });

    // Check if session already exists in history
    const exists = this.sessionHistory.some((s) => s.id === session.id);
    if (!exists) {
      this.sessionHistory.unshift(session);
    }

    log.sessionEvent("create", session.id, {
      title: session.title,
      isNewSession: !exists,
    });

    this.persistState();
    log.endFeatureFlow(flow, {
      status: 'completed',
      sessionId: session.id,
      title: session.title,
      wasNew: !exists,
    });
    return session;
  }

  /**
   * Gets the current active session, creating one if needed.
   *
   * This is the primary method for accessing the current session.
   * It implements the "ensure exists" pattern for convenience.
   *
   * **Behavior:**
   * 1. Waits for initialization to complete (if still loading)
   * 2. Returns current session if exists
   * 3. Creates new session if none exists
   *
   * **Initialization Wait:**
   * The constructor loads state asynchronously. This method waits
   * for that to complete before checking for a current session.
   * This prevents returning a stale session during startup.
   *
   * **Auto-Creation:**
   * If no current session exists (first launch or all deleted),
   * automatically creates a new session. This provides a better
   * user experience than requiring manual session creation.
   *
   * @returns Promise resolving to the current (or newly created) session
   *
   * @example
   * ```typescript
   * // Always returns a valid session
   * const session = await service.getCurrentSession();
   * await service.sendMessage(session.id, "Hello!");
   * ```
   *
   * @see createNewSession for session creation logic
   * @see initializationPromise for async initialization
   */
  async getCurrentSession(): Promise<Session> {
    // Wait for initialization to complete if it's running
    if (this.initializationPromise) {
      await this.initializationPromise;
    }

    if (this.currentSession) {
      return this.currentSession;
    }

    return this.createNewSession();
  }

  /**
   * Lists all sessions with server-local merge strategy.
   *
   * This is a key method that implements the merge algorithm for combining
   * server and local session data. This ensures no data loss when working
   * offline or across multiple devices.
   *
   * **Merge Algorithm:**
   * ```
   * Step 1: Fetch sessions from server via API
   * Step 2: Load sessions from local workspace state
   * Step 3: Create a map using session ID as key
   * Step 4: Add all local sessions to map
   * Step 5: Add all server sessions to map (overwrites local if same ID)
   * Step 6: Convert map to array and sort by creation time (newest first)
   * Step 7: Update in-memory cache and persist
   * ```
   *
   * **Conflict Resolution:**
   * - Same ID exists locally and server → Server version wins (most recent)
   * - Only local exists → Kept (offline/local-only session)
   * - Only server exists → Added (new session from another device)
   *
   * **Sorting:**
   * Sessions are sorted by creation time (descending) so newest
   * sessions appear first in the UI.
   *
   * **Error Handling:**
   * - If server fetch fails: Falls back to local-only sessions
   * - Errors are logged but don't throw (graceful degradation)
   * - Returns whatever data is available
   *
   * **Data Flow:**
   * Server → Merge with Local → Sort → Update Cache → Persist → Return
   *
   * @returns Promise resolving to sorted array of all sessions (server + local)
   *
   * @example
   * ```typescript
   * const sessions = await service.listSessions();
   * // Returns merged list from server + local storage
   * console.log(`Found ${sessions.length} sessions`);
   * ```
   *
   * @see switchSession for loading a specific session
   * @see persistState for how data is saved
   */
  async listSessions(): Promise<Session[]> {
    // Ensure persisted local history is loaded before we merge with server data.
    // Without this wait, early startup calls can clobber workspace history.
    if (this.initializationPromise) {
      await this.initializationPromise;
    }

    try {
      const client = await this.serverManager.ensureRunning();
      const response = await client.session.list();

      if (response.data) {
        // Merge server sessions with local history
        const serverSessions = response.data;
        const localSessions = this.sessionHistory;

        // Use a map to merge by ID, prioritizing server data but keeping local-only ones
        const mergedMap = new Map<string, Session>();
        localSessions.forEach((s) => {
          mergedMap.set(s.id, s);
        });
        serverSessions.forEach((s) => {
          mergedMap.set(s.id, s);
        });

        const mergedSessions = Array.from(mergedMap.values());
        const normalized = coalesceSessionsById(mergedSessions);
        if (hasSessionAliasConflicts(normalized.aliasesByCanonicalId)) {
          await this.mergeMessagesForSessionAliases(
            normalized.aliasesByCanonicalId,
          );
        }

        this.sessionHistory = normalized.sessions;

        this.persistState();
      }
    } catch (error) {
      log.error("Failed to fetch sessions from server", {}, error as Error);
      // Fallback to local history
      const normalizedLocal = coalesceSessionsById(this.sessionHistory);
      if (hasSessionAliasConflicts(normalizedLocal.aliasesByCanonicalId)) {
        await this.mergeMessagesForSessionAliases(
          normalizedLocal.aliasesByCanonicalId,
        );
      }
      if (normalizedLocal.hadChanges) {
        this.sessionHistory = normalizedLocal.sessions;
        this.persistState();
      }
    }

    return this.sessionHistory;
  }

  /**
   * Switches to a different session by ID.
   *
   * Fetches the session from the server and sets it as the current session.
   * This is used when the user selects a different session from the history.
   *
   * **Behavior:**
   * 1. Fetches session from server by ID
   * 2. Updates current session reference
   * 3. Persists current session ID to workspace state
   *
   * **Error Handling:**
   * - Throws if session not found on server
   * - Use try-catch when calling this method
   *
   * @param sessionId - The ID of the session to switch to
   * @returns Promise resolving to the loaded session
   * @throws {Error} If session not found on server
   *
   * @example
   * ```typescript
   * try {
   *   const session = await service.switchSession('session-123');
   *   console.log('Switched to:', session.title);
   * } catch (e) {
   *   console.error('Session not found');
   * }
   * ```
   */
  async switchSession(sessionId: string): Promise<Session> {
    const flow = log.startFeatureFlow('SwitchSession', { sessionId });

    try {
      const currentSessionId = this.currentSession?.id;
      if (currentSessionId && currentSessionId !== sessionId) {
        await this.flushRawSdkEventPayloads(currentSessionId);
      }
      const client = await this.serverManager.ensureRunning();
      log.featureStep(flow, 'fetching_session_from_server');

      const response = await client.session.get({
        path: { id: sessionId },
      });

      if (!response.data) {
        throw new Error("Session not found");
      }

      this.currentSession = response.data;
      this.persistState();

      log.sessionEvent("switch", sessionId, {
        title: response.data.title,
        source: 'server',
      });
      log.endFeatureFlow(flow, {
        status: 'completed',
        sessionId,
        title: response.data.title,
        source: 'server',
      });
      return response.data;
    } catch (error) {
      log.featureStep(flow, 'server_fetch_failed', { error: String(error) });
      const localSession = this.sessionHistory.find((s) => s.id === sessionId);
      if (!localSession) {
        log.endFeatureFlow(flow, { status: 'failed', error: 'Session not found' });
        throw error;
      }

      this.currentSession = localSession;
      this.persistState();

      log.sessionEvent("switch", sessionId, {
        title: localSession.title,
        source: 'local',
      });
      log.endFeatureFlow(flow, {
        status: 'completed',
        sessionId,
        title: localSession.title,
        source: 'local_fallback',
      });
      return localSession;
    }
  }

  /**
   * Deletes a session from the server and local cache.
   *
   * **Behavior:**
   * 1. Calls server API to delete session
   * 2. Clears current session reference if deleting active session
   * 3. Removes session from local history
   * 4. Persists updated state
   *
   * **Note:**
   * Cached local messages are also removed from workspace storage
   * to prevent orphaned data from consuming disk space.
   *
   * **State Update:**
   * If deleting the current session, `currentSession` becomes null.
   * Next call to `getCurrentSession()` will create a new session.
   *
   * @param sessionId - The ID of the session to delete
   * @returns Promise that resolves when deletion is complete
   *
   * @example
   * ```typescript
   * await service.deleteSession('session-123');
   * // Session is now deleted from server and local cache
   * ```
   */
  async deleteSession(sessionId: string): Promise<void> {
    const deleteStart = Date.now();
    const wasCurrent = this.currentSession?.id === sessionId;

    try {
      const client = await this.serverManager.ensureRunning();
      await client.session.delete({
        path: { id: sessionId },
      });
    } catch (error) {
      log.warn("Server delete failed, continuing with local cleanup", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (wasCurrent) {
      this.currentSession = null;
      log.debug("Cleared current session (was deleted)", { sessionId });
    }

    await this.flushRawSdkEventPayloads(sessionId);
    this.sessionHistory = this.sessionHistory.filter((s) => s.id !== sessionId);
    await this.context.workspaceState.update(
      `${SessionService.MESSAGES_PREFIX}${sessionId}`,
      undefined,
    );
    this.persistState();

    log.sessionEvent("delete", sessionId, {
      wasCurrent,
      durationMs: Date.now() - deleteStart,
    });
  }

  /**
   * Renames a session by updating its title.
   *
   * **Behavior:**
   * 1. Calls server API to update session title
   * 2. Updates the session in local history
   * 3. Updates current session reference if renaming active session
   * 4. Persists updated state to workspace storage
   *
   * **Error Handling:**
   * - Throws if server returns error response
   * - Updates local state even if server update fails (optimistic update)
   *
   * @param sessionId - The ID of the session to rename
   * @param newTitle - The new title for the session
   * @returns Promise resolving to the updated session
   * @throws {Error} If server fails to update session
   *
   * @example
   * ```typescript
   * const session = await service.renameSession('session-123', 'My New Title');
   * console.log('Renamed session:', session.title);
   * ```
   */
  updateLocalSessionTitle(sessionId: string, title: string): void {
    const localSession = this.sessionHistory.find((s) => s.id === sessionId);
    if (localSession) {
      localSession.title = title;
    }

    if (this.currentSession?.id === sessionId) {
      this.currentSession.title = title;
    }

    this.persistState();
  }

  async renameSession(sessionId: string, newTitle: string): Promise<Session> {
    try {
      const client = await this.serverManager.ensureRunning();
      const response = await client.session.update({
        path: { id: sessionId },
        body: { title: newTitle },
      });

      if (!response.data) {
        const errorDetails = JSON.stringify(response.error || {}, null, 2);
        log.error("Failed to rename session", {
          sessionId,
          newTitle,
          status: response.response.status,
          error: response.error,
        });
        const em = (response.error || {}) as {
          message?: string;
          errors?: Array<{ message?: string }>;
        };
        const msg =
          em?.message ||
          (Array.isArray(em?.errors) ? em.errors[0]?.message : undefined) ||
          "Unknown error";
        throw new Error(`Failed to rename session: ${msg}`);
      }

      const updatedSession = response.data;

      // Update in session history
      const index = this.sessionHistory.findIndex((s) => s.id === sessionId);
      if (index !== -1) {
        this.sessionHistory[index] = updatedSession;
      }

      // Update current session if it's the one being renamed
      if (this.currentSession?.id === sessionId) {
        this.currentSession = updatedSession;
      }

      log.sessionEvent("rename", sessionId, {
        newTitle: updatedSession.title,
      });

      this.persistState();
      return updatedSession;
    } catch (error) {
      // If server update fails, still update local state (optimistic update)
      log.warn(`Server rename failed for session ${sessionId}, updating local state only:`, { error: String(error) });

      const localSession = this.sessionHistory.find((s) => s.id === sessionId);
      if (localSession) {
        localSession.title = newTitle;

        if (this.currentSession?.id === sessionId) {
          this.currentSession.title = newTitle;
        }

        this.persistState();
        return localSession;
      }

      throw error;
    }
  }

  /**
   * Gets messages for a session, with server fallback to local storage.
   *
   * **Retrieval Strategy:**
   * 1. Try fetching from server first (most up-to-date)
   * 2. If server succeeds: Map to flat format, persist locally, return
   * 3. If server fails: Fall back to local storage
   * 4. Return whatever data is available
   *
   * **Message Format Mapping:**
   * Server returns nested format: `{ info: {...}, parts: [...] }`
   * We flatten it: `{ ...info, parts: [...] }`
   * This makes it easier to work with in the UI.
   *
   * **Offline Support:**
   * If server is unreachable, returns cached local messages.
   * This allows viewing chat history without network connection.
   *
   * **Local Storage:**
   * Messages are cached to workspace state for offline access.
   * Key format: `opencode.session.messages.{sessionId}`
   *
   * @param sessionId - The ID of the session to fetch messages for
   * @returns Promise resolving to array of messages (server or cached)
   *
   * @example
   * ```typescript
   * const messages = await service.getMessages('session-123');
   * console.log(`Found ${messages.length} messages`);
   * ```
   *
   * @see saveSessionMessages for persistence
   * @see loadSessionMessages for loading cached messages
   */
  async getMessages(sessionId: string): Promise<unknown[]> {
    const fetchStart = Date.now();
    log.debug("Fetching messages for session", { sessionId });
    const localMessages = await this.loadSessionMessages(sessionId);

    try {
      const client = await this.serverManager.ensureRunning();
      const response = await client.session.messages({
        path: {
          id: sessionId,
        },
      });

      if (response.data && response.data.length > 0) {
        const serverDuplicateSummary = summarizePotentialAssistantDuplicates(response.data);
        log.info("Fetched messages from server", {
          sessionId,
          serverCount: response.data.length,
          localCount: localMessages.length,
          rawAssistantDuplicateGroups: serverDuplicateSummary.duplicateGroups,
          rawAssistantDuplicateMessages: serverDuplicateSummary.duplicateMessages,
          durationMs: Date.now() - fetchStart,
        });
        const mergedMessages =
          localMessages.length > 0
            ? mergeConversationMessages([localMessages, response.data])
            : response.data;
        const mergedDuplicateSummary =
          summarizePotentialAssistantDuplicates(mergedMessages);
        if (
          serverDuplicateSummary.duplicateGroups > 0 ||
          mergedDuplicateSummary.duplicateGroups > serverDuplicateSummary.duplicateGroups
        ) {
          log.warn("Assistant duplicate analysis for session history hydration", {
            sessionId,
            localCount: localMessages.length,
            serverCount: response.data.length,
            mergedCount: mergedMessages.length,
            serverDuplicateGroups: serverDuplicateSummary.duplicateGroups,
            serverDuplicateMessages: serverDuplicateSummary.duplicateMessages,
            mergedDuplicateGroups: mergedDuplicateSummary.duplicateGroups,
            mergedDuplicateMessages: mergedDuplicateSummary.duplicateMessages,
            serverSamples: serverDuplicateSummary.samples,
            mergedSamples: mergedDuplicateSummary.samples,
          });
        }
        // Keep the nested info structure from server for proper type compatibility
        // Server returns: { info: {...}, parts: [...] } which matches Message interface
        await this.saveSessionMessages(sessionId, mergedMessages);
        return mergedMessages;
      }
    } catch (error) {
      log.warn("Error fetching messages from server, using local cache", {
        sessionId,
        localCount: localMessages.length,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - fetchStart,
      });
    }

    log.debug("Returning local messages", {
      sessionId,
      count: localMessages.length,
    });
    return localMessages;
  }

  /**
   * Saves messages for a specific session to local workspace storage.
   *
   * **Storage Key Format:**
   * `opencode.session.messages.{sessionId}`
   *
   * **Usage:**
   * Called automatically after fetching messages from server.
   * Can also be called manually to cache new messages.
   *
   * **Persistence:**
   * Stored in VSCode workspaceState, which persists across
   * VSCode restarts but is specific to the workspace.
   *
   * @param sessionId - The ID of the session
   * @param messages - Array of messages to persist
   *
   * @example
   * ```typescript
   * await service.saveSessionMessages('session-123', messages);
   * // Messages are now cached locally
   * ```
   *
   * @see loadSessionMessages for retrieval
   */
  async saveSessionMessages(
    sessionId: string,
    messages: unknown[],
  ): Promise<void> {
    let wasCompacted = false;
    let persisted = messages.map((message) => sanitizeForPersistence(message));

    if (persisted.length > MAX_CACHED_MESSAGES_PER_SESSION) {
      wasCompacted = true;
      persisted = persisted.slice(-MAX_CACHED_MESSAGES_PER_SESSION);
    }

    let estimatedSize = estimateSerializedBytes(persisted);
    if (estimatedSize > MAX_CACHED_SESSION_BYTES) {
      // Keep recent messages first when trimming for storage pressure.
      while (
        persisted.length > 1 &&
        estimatedSize > MAX_CACHED_SESSION_BYTES
      ) {
        wasCompacted = true;
        const trimCount = Math.max(1, Math.ceil(persisted.length * 0.1));
        persisted = persisted.slice(trimCount);
        estimatedSize = estimateSerializedBytes(persisted);
      }
    }

    if (estimatedSize > MAX_CACHED_SESSION_BYTES) {
      wasCompacted = true;
      persisted = persisted.map((message) => compactMessageForPersistence(message));
      estimatedSize = estimateSerializedBytes(persisted);
    }

    if (estimatedSize > MAX_CACHED_SESSION_BYTES) {
      while (
        persisted.length > 1 &&
        estimatedSize > MAX_CACHED_SESSION_BYTES
      ) {
        wasCompacted = true;
        persisted = persisted.slice(1);
        estimatedSize = estimateSerializedBytes(persisted);
      }
    }

    if (wasCompacted) {
      log.warn("Cached messages were compacted", {
        sessionId,
        itemCount: persisted.length,
        sizeKB: Math.round(estimatedSize / 1024),
      });
    }

    await this.context.workspaceState.update(
      `${SessionService.MESSAGES_PREFIX}${sessionId}`,
      persisted,
    );
  }

  /**
   * Saves raw SDK payloads for a specific session to local workspace storage.
   *
   * This intentionally preserves the original payload shape as much as possible
   * so debug and recovery flows can inspect the untouched SDK data.
   */
  async saveSessionRawMessages(
    sessionId: string,
    messages: unknown[],
  ): Promise<void> {
    const persisted = Array.isArray(messages) ? [...messages] : [];
    this.rawMessageCache.set(sessionId, persisted);
    await this.context.workspaceState.update(
      `${SessionService.RAW_MESSAGES_PREFIX}${sessionId}`,
      persisted,
    );
  }

  /**
   * Loads messages for a specific session from local storage.
   *
   * **Fallback Behavior:**
   * Returns empty array if no messages are cached.
   * This is used by `getMessages()` when server is unavailable.
   *
   * **Storage Key Format:**
   * `opencode.session.messages.{sessionId}`
   *
   * @param sessionId - The ID of the session to load messages for
   * @returns Promise resolving to array of cached messages (empty if none)
   *
   * @example
   * ```typescript
   * const messages = await service.loadSessionMessages('session-123');
   * console.log(`Found ${messages.length} cached messages`);
   * ```
   *
   * @see saveSessionMessages for persistence
   * @see getMessages for server-fetching with fallback
   */
  async loadSessionMessages(sessionId: string): Promise<unknown[]> {
    const value = this.context.workspaceState.get<unknown[]>(
      `${SessionService.MESSAGES_PREFIX}${sessionId}`,
    );
    return Array.isArray(value) ? value : [];
  }

  /**
   * Loads raw SDK payloads for a specific session from local workspace storage.
   */
  async loadSessionRawMessages(sessionId: string): Promise<unknown[]> {
    const cached = this.rawMessageCache.get(sessionId);
    if (Array.isArray(cached)) {
      return [...cached];
    }
    const value = this.context.workspaceState.get<unknown[]>(
      `${SessionService.RAW_MESSAGES_PREFIX}${sessionId}`,
    );
    const raw = Array.isArray(value) ? value : [];
    this.rawMessageCache.set(sessionId, [...raw]);
    return raw;
  }

  /**
   * Saves raw SDK event payloads for a specific session to local workspace storage.
   *
   * This stores the untouched event tape so rehydrated sessions can replay the
   * same raw stream and append future events without normalization.
   */
  async saveSessionRawSdkEventPayloads(
    sessionId: string,
    events: unknown[],
  ): Promise<void> {
    const persisted = this.filterPersistedRawSdkEventPayloads(events).map((event) =>
      this.cloneRawSdkEventPayload(event),
    );
    this.rawSdkEventPayloadCache.set(sessionId, persisted);
    const existingTimer = this.rawSdkEventPersistTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.rawSdkEventPersistTimers.delete(sessionId);
    }
    await this.context.workspaceState.update(
      `${SessionService.RAW_SDK_EVENT_PAYLOADS_PREFIX}${sessionId}`,
      persisted,
    );
  }

  /**
   * Loads raw SDK event payloads for a specific session from local storage.
   */
  async loadSessionRawSdkEventPayloads(sessionId: string): Promise<unknown[]> {
    const cached = this.rawSdkEventPayloadCache.get(sessionId);
    if (Array.isArray(cached)) {
      return [...cached];
    }
    const value = this.context.workspaceState.get<unknown[]>(
      `${SessionService.RAW_SDK_EVENT_PAYLOADS_PREFIX}${sessionId}`,
    );
    const raw = this.filterPersistedRawSdkEventPayloads(Array.isArray(value) ? value : []);
    this.rawSdkEventPayloadCache.set(sessionId, [...raw]);
    return raw;
  }

  /**
   * Convenience method that loads both raw messages and raw SDK event payloads
   * for a session in parallel.
   *
   * Called from ChatViewProvider and SessionHandler when rehydrating a session
   * into the webview chat UI (chatHistory message).
   *
   * @param sessionId - The ID of the session to load data for
   * @returns Object containing rawMessages and rawSdkEventPayloads arrays
   */
  async loadCentralizedSessionData(sessionId: string): Promise<{
    rawMessages: unknown[];
    rawSdkEventPayloads: unknown[];
  }> {
    // Load both data sources in parallel for efficiency
    const [rawMessages, rawSdkEventPayloads] = await Promise.all([
      this.loadSessionRawMessages(sessionId),
      this.loadSessionRawSdkEventPayloads(sessionId),
    ]);
    return { rawMessages, rawSdkEventPayloads };
  }


  /**
   * Appends a new message to the local message history for a session.
   *
   * **Use Case:**
   * Called when a new message is sent or received.
   * Adds the message to the existing cached messages.
   *
   * **Performance:**
   * Loads all messages, appends one, saves all back.
   * Not optimal for large histories, but sufficient for typical usage.
   *
   * **Note:**
   * This only updates local cache. Server has its own storage.
   * The local cache is used for offline access and quick loading.
   *
   * @param sessionId - The ID of the session
   * @param message - The message object to append
   *
   * @example
   * ```typescript
   * await service.appendMessage('session-123', {
   *   role: 'user',
   *   content: 'Hello!'
   * });
   * ```
   */
  async appendMessage(sessionId: string, message: unknown): Promise<void> {
    const messages = await this.loadSessionMessages(sessionId);
    messages.push(message);
    log.debug("Appending message to session", {
      sessionId,
      newTotal: messages.length,
      role: (message as Record<string, unknown>)?.role,
    });
    await this.saveSessionMessages(sessionId, messages);
  }

  async upsertMessage(sessionId: string, message: unknown): Promise<void> {
    const messages = await this.loadSessionMessages(sessionId);
    const incomingSignatures = getMessageSignaturesForMerge(message);
    const existingIndex = messages.findIndex((candidate) => {
      const candidateSignatures = getMessageSignaturesForMerge(candidate);
      return incomingSignatures.some((signature) =>
        candidateSignatures.includes(signature),
      );
    });
    if (existingIndex >= 0) {
      messages[existingIndex] = pickRicherMessage(
        messages[existingIndex],
        message,
      );
      log.debug("Upserted existing message in session", {
        sessionId,
        index: existingIndex,
        totalMessages: messages.length,
      });
    } else {
      messages.push(message);
      log.debug("Appended new message to session via upsert", {
        sessionId,
        totalMessages: messages.length,
      });
    }
    await this.saveSessionMessages(sessionId, messages);
  }

  async appendRawMessage(sessionId: string, message: unknown): Promise<void> {
    const messages = await this.loadSessionRawMessages(sessionId);
    messages.push(message);
    log.debug("Appending raw message to session", {
      sessionId,
      newTotal: messages.length,
      role: (message as Record<string, unknown>)?.role,
    });
    await this.saveSessionRawMessages(sessionId, messages);
  }

  async appendRawSdkEventPayload(sessionId: string, event: unknown): Promise<void> {
    if (!this.shouldPersistRawSdkEventPayload(event)) {
      return;
    }
    const events = await this.loadSessionRawSdkEventPayloads(sessionId);
    const snapshot = this.cloneRawSdkEventPayload(event);
    const eventRecord = event as Record<string, unknown>;
    const eventId = typeof eventRecord?.id === "string" ? eventRecord.id : undefined;
    if (eventId) {
      const alreadyExists = events.some((existing) => {
        const existingRecord = existing as Record<string, unknown>;
        return typeof existingRecord?.id === "string" && existingRecord.id === eventId;
      });
      if (alreadyExists) {
        return;
      }
    }
    events.push(snapshot);
    this.rawSdkEventPayloadCache.set(sessionId, events);

    const existingTimer = this.rawSdkEventPersistTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.rawSdkEventPersistTimers.set(
      sessionId,
      setTimeout(() => {
        void this.flushRawSdkEventPayloads(sessionId);
        this.rawSdkEventPersistTimers.delete(sessionId);
      }, 250),
    );
  }

  async flushRawSdkEventPayloads(sessionId: string): Promise<void> {
    const events = this.rawSdkEventPayloadCache.get(sessionId);
    if (!Array.isArray(events)) {
      return;
    }
    const existingTimer = this.rawSdkEventPersistTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.rawSdkEventPersistTimers.delete(sessionId);
    }
    await this.context.workspaceState.update(
      `${SessionService.RAW_SDK_EVENT_PAYLOADS_PREFIX}${sessionId}`,
      [...events],
    );
  }

  async flushAllRawSdkEventPayloads(): Promise<void> {
    const sessionIds = Array.from(this.rawSdkEventPayloadCache.keys());
    for (const sessionId of sessionIds) {
      await this.flushRawSdkEventPayloads(sessionId);
    }
  }

  async dispose(): Promise<void> {
    await this.flushAllRawSdkEventPayloads();
    for (const timer of this.rawSdkEventPersistTimers.values()) {
      clearTimeout(timer);
    }
    this.rawSdkEventPersistTimers.clear();
  }

  private async mergeMessagesForSessionAliases(
    aliasesByCanonicalId: Map<string, string[]>,
  ): Promise<void> {
    log.debug("Starting session alias message merge", {
      aliasGroupCount: aliasesByCanonicalId.size,
    });

    for (const [canonicalId, aliases] of Array.from(aliasesByCanonicalId.entries())) {
      const normalizedCanonicalId = normalizeSessionId(canonicalId);
      if (!normalizedCanonicalId) {
        continue;
      }

      const uniqueAliases = Array.from(
        new Set(
          aliases.filter(
            (alias): alias is string =>
              typeof alias === "string" && alias.length > 0,
          ),
        ),
      );

      if (!uniqueAliases.includes(normalizedCanonicalId)) {
        uniqueAliases.push(normalizedCanonicalId);
      }

      if (uniqueAliases.every((alias) => alias === normalizedCanonicalId)) {
        continue;
      }

      const messageGroups: unknown[][] = [];
      for (const alias of uniqueAliases) {
        const cached = await this.loadSessionMessages(alias);
        if (cached.length > 0) {
          messageGroups.push(cached);
        }
      }

      if (messageGroups.length > 0) {
        const merged = mergeConversationMessages(messageGroups);
        await this.saveSessionMessages(normalizedCanonicalId, merged);
      }

      for (const alias of uniqueAliases) {
        if (alias === normalizedCanonicalId) {
          continue;
        }
        await this.context.workspaceState.update(
          `${SessionService.MESSAGES_PREFIX}${alias}`,
          undefined,
        );
      }
    }
  }

  /**
   * Loads persisted state from workspace storage.
   *
   * This method is called asynchronously in the constructor to restore
   * the extension state from the previous VSCode session.
   *
   ** What Gets Restored:**
   * - Session history list
   * - Current session ID
   * - Selected model
   *
   * **Configuration Check:**
   * If `opencode.persistSessions` is false, returns immediately
   * without loading anything (fresh start).
   *
   * **Session Restoration:**
   * If a current session ID was saved, tries to reconnect to it
   * on the server. If the session no longer exists on the server,
   * falls back to the local stub from history.
   *
   * **Initialization Pattern:**
   * This runs asynchronously in the constructor. Other methods
   * wait for `initializationPromise` before accessing state.
   *
   * @private
   *
   * @see persistState for the corresponding save method
   */
  private async loadPersistedState(): Promise<void> {
    const config = vscode.workspace.getConfiguration("opencode");
    if (!config.get("persistSessions", true)) {
      log.info("Session persistence disabled, skipping state load");
      return;
    }

    const loadStart = Date.now();
    const persistedSessions = this.context.workspaceState.get<Session[]>(
      SessionService.SESSIONS_KEY,
      [],
    );
    const normalizedSessions = coalesceSessionsById(persistedSessions);
    this.sessionHistory = normalizedSessions.sessions;

    log.debug("Loaded persisted sessions", {
      rawCount: persistedSessions.length,
      normalizedCount: normalizedSessions.sessions.length,
      hadChanges: normalizedSessions.hadChanges,
      aliasConflicts: hasSessionAliasConflicts(normalizedSessions.aliasesByCanonicalId),
    });

    if (hasSessionAliasConflicts(normalizedSessions.aliasesByCanonicalId)) {
      log.info("Merging messages for session aliases");
      await this.mergeMessagesForSessionAliases(
        normalizedSessions.aliasesByCanonicalId,
      );
    }

    if (normalizedSessions.hadChanges) {
      this.persistState();
    }

    const persistedSessionId = this.context.workspaceState.get<string>(
      SessionService.SESSION_ID_KEY,
    );
    const sessionId = normalizeSessionId(persistedSessionId);

    if (sessionId && persistedSessionId !== sessionId) {
      log.debug("Normalized persisted session ID", {
        original: persistedSessionId,
        normalized: sessionId,
      });
      await this.context.workspaceState.update(
        SessionService.SESSION_ID_KEY,
        sessionId,
      );
    }

    if (sessionId) {
      try {
        await this.switchSession(sessionId);
        log.sessionEvent("restore", sessionId, {
          title: this.currentSession?.title,
          durationMs: Date.now() - loadStart,
        });
      } catch (e) {
        log.debug("Session not found on server, keeping local stub", {
          sessionId,
        });
        const stub = this.sessionHistory.find((s) => s.id === sessionId);
        if (stub) {
          this.currentSession = stub;
          log.debug("Restored session from local history stub", {
            sessionId,
            title: stub.title,
          });
        }
      }
    } else {
      log.debug("No persisted session ID found, will create on demand");
    }

    log.info("Persisted state loaded", {
      sessionCount: this.sessionHistory.length,
      hasCurrentSession: Boolean(this.currentSession),
      durationMs: Date.now() - loadStart,
    });
  }

  /**
   * Persists current state to workspace storage.
   *
   * This method is called automatically whenever state changes to ensure
   * data survives VSCode restarts.
   *
   ** What Gets Persisted:**
   * - Session history list (all sessions)
   * - Current session ID (for restoration on restart)
   * - Selected model
   *
   * **Configuration Check:**
   * If `opencode.persistSessions` is false, returns immediately
   * without saving (state is not persisted).
   *
   * **Storage Locations:**
   * - `opencode.sessions`: Session history array
   * - `opencode.currentSessionId`: Active session ID
   *
   * **When Called:**
   * - After creating a new session
   * - After switching sessions
   * - After deleting a session
   * - After listing sessions from server
   *
   * **Storage Scope:**
   * Uses VSCode's `workspaceState` which is specific to each
   * workspace. Different workspaces have separate session histories.
   *
   * @private
   *
   * @see loadPersistedState for the corresponding load method
   */
  private persistState(): void {
    const config = vscode.workspace.getConfiguration("opencode");
    if (!config.get("persistSessions", true)) {
      return;
    }

    this.context.workspaceState.update(
      SessionService.SESSIONS_KEY,
      this.sessionHistory,
    );

    if (this.currentSession) {
      this.context.workspaceState.update(
        SessionService.SESSION_ID_KEY,
        this.currentSession.id,
      );
    }

    const currentSessionId = this.currentSession?.id ?? "none";
    // Only log when session ID changes to avoid duplicate logs
    if (currentSessionId !== this.lastLoggedSessionId) {
      log.sessionEvent("persist", currentSessionId, {
        sessionCount: this.sessionHistory.length,
      });
      this.lastLoggedSessionId = currentSessionId;
    }
  }
}
