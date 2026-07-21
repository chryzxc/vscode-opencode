import type { Session, Message, Part } from "@opencode-ai/sdk/v2";
import type { QuestionRequest } from "@opencode-ai/sdk/v2";
import type { PermissionRequest } from "@opencode-ai/sdk/v2";
import { OpencodeServerManager } from "./OpencodeServerManager";
import { createLogger } from "../utils/Logger";
import { LoggingCategories } from "../utils/LoggingSchema";
import {
  isPersistedStructuredFormatError,
  SessionStructuredFormatRecovery,
} from "./SessionStructuredFormatRecovery";

export type SessionSnapshot = {
  session: Session;
  messages: Array<{ info: Message; parts: Part[] }>;
  pendingQuestions: QuestionRequest[];
  pendingPermissions: PermissionRequest[];
  children: Array<{ session: Session }>;
};

type SessionMessages = Array<{ info: Message; parts: Part[] }>;

type SdkResponse<T> = {
  data?: T;
  error?: unknown;
  response: { status: number };
};

export class SessionMessagesLoadError extends Error {
  constructor(
    readonly status: number,
    readonly sdkError: unknown,
  ) {
    super(
      `session.messages did not return an array (status ${status}): ${SessionSnapshotLoader.describeSdkError(sdkError)}`,
    );
    this.name = "SessionMessagesLoadError";
  }
}

const log = createLogger(LoggingCategories.SESSION_SERVICE);

export class SessionSnapshotLoader {
  private readonly structuredFormatRecovery = new SessionStructuredFormatRecovery();

  constructor(private readonly serverManager: OpencodeServerManager) {}

  async loadSnapshot(sessionID: string): Promise<SessionSnapshot> {
    log.info("[SDK-DEBUG] loadSnapshot START", { sessionId: sessionID });

    const client = await this.serverManager.ensureRunning();
    const directory = this.serverManager.getWorkspaceDirectory();
    const sessionScope = directory ? { directory } : {};

    const results = await Promise.all([
      this.loadEndpoint("session.get", sessionID, () =>
        client.session.get({ sessionID, ...sessionScope }) as Promise<SdkResponse<Session>>,
      ),
      this.loadEndpoint("session.messages", sessionID, () =>
        client.session.messages({ sessionID, ...sessionScope }) as Promise<SdkResponse<SessionMessages>>,
      ),
      this.loadEndpoint("question.list", sessionID, () =>
        client.question.list() as Promise<SdkResponse<QuestionRequest[]>>,
      ),
      this.loadEndpoint("permission.list", sessionID, () =>
        client.permission.list() as Promise<SdkResponse<PermissionRequest[]>>,
      ),
      this.loadEndpoint("session.children", sessionID, () =>
        client.session.children({ sessionID, ...sessionScope }) as Promise<SdkResponse<Session[]>>,
      ),
    ]);

    const [session, messages, questions, permissions, children] = results;

    const endpointStatuses = {
      session: !!session,
      messages: Array.isArray(messages) ? messages.length : -1,
      questions: Array.isArray(questions) ? questions.length : -1,
      permissions: Array.isArray(permissions) ? permissions.length : -1,
      children: Array.isArray(children) ? children.length : -1,
    };
    log.info("[SDK-DEBUG] loadSnapshot DONE", { sessionId: sessionID, ...endpointStatuses });

    if (!session) {
      throw new Error(`Failed to load session metadata for ${sessionID}`);
    }

    const sdkMessages = messages ?? [];
    if (sdkMessages.length > 0) {
      const sample = sdkMessages[0];
      const sampleKeys = Object.keys(sample);
      const partTypes = sdkMessages.slice(0, 3).map((m) =>
        Array.isArray(m.parts) ? m.parts.map((p: Part) => p.type) : [],
      );
      log.info("[SDK-DEBUG] session.messages response shape", {
        sessionId: sessionID,
        messageCount: sdkMessages.length,
        sampleKeys,
        sampleRole: (sample.info as { role?: string }).role,
        samplePartTypes: partTypes,
        hasParts: sdkMessages.every((m) => Array.isArray(m.parts)),
      });
    }

    return {
      session,
      messages: messages ?? [],
      pendingQuestions: (questions ?? []).filter(
        (question) => question.sessionID === sessionID,
      ),
      pendingPermissions: (permissions ?? []).filter(
        (permission) => permission.sessionID === sessionID,
      ),
      children: (children ?? []).map((childSession) => ({ session: childSession })),
    };
  }

  async loadMessagesOnly(sessionID: string): Promise<SessionMessages> {
    const client = await this.serverManager.ensureRunning();
    const directory = this.serverManager.getWorkspaceDirectory();
    // LOCKED CONTRACT — REHYDRATION SOURCE OF TRUTH
    // This must call the OpenCode SDK server for every hydration. Do not read
    // workspaceState, SessionService caches, persisted event tapes, or a
    // webview-owned snapshot as a fallback. `session.messages()` is the only
    // authoritative source for rehydratedSdkMessages and rendered history.
    // Do not use the tolerant multi-endpoint loader here. This is the single
    // authoritative transcript source, and collapsing a failed SDK request
    // into `[]` makes a transport error indistinguishable from a genuinely
    // empty OpenCode session.
    let response = await client.session.messages({
      sessionID,
      ...(directory ? { directory } : {}),
    });
    if (
      response.error &&
      isPersistedStructuredFormatError(response.error) &&
      await this.structuredFormatRecovery.repair(sessionID)
    ) {
      response = await client.session.messages({
        sessionID,
        ...(directory ? { directory } : {}),
      });
    }
    if (response.error || !Array.isArray(response.data)) {
      log.warn("[SDK-DEBUG] session.messages returned no usable data", {
        sessionId: sessionID,
        status: response.response.status,
        error: response.error,
        hasData: response.data !== undefined,
        directory,
      });
      throw new SessionMessagesLoadError(
        response.response.status,
        response.error,
      );
    }
    const messages = response.data;

    // Temporary SDK inspection mode: keep this as the unmodified `data` array
    // returned by OpenCode. Do not run it through the event-tape normalizer or
    // write it to workspaceState. This is intentionally verbose so the
    // Extension Host log can show exactly what OpenCode returned.
    log.info("[SDK-DEBUG] session.messages RAW data", {
      sessionId: sessionID,
      status: response.response.status,
      directory,
      messages,
    });

    return messages;
  }

  async loadSessionMeta(sessionID: string): Promise<Session> {
    const client = await this.serverManager.ensureRunning();
    const session = await this.loadEndpoint("session.get", sessionID, () =>
      client.session.get({ sessionID }) as Promise<SdkResponse<Session>>,
    );

    if (!session) {
      throw new Error(`Failed to load session metadata for ${sessionID}`);
    }

    return session;
  }

  private async loadEndpoint<T>(
    endpoint: string,
    sessionID: string,
    request: () => Promise<SdkResponse<T>>,
  ): Promise<T | undefined> {
    try {
      const response = await request();
      if (response.data === undefined) {
        log.warn("Session snapshot endpoint returned no data", {
          endpoint,
          sessionId: sessionID,
          status: response.response.status,
          error: response.error,
        });
        return undefined;
      }

      if (response.error) {
        log.warn("Session snapshot endpoint returned data with error", {
          endpoint,
          sessionId: sessionID,
          status: response.response.status,
          error: response.error,
        });
      }

      return response.data;
    } catch (error) {
      log.warn("Session snapshot endpoint failed", {
        endpoint,
        sessionId: sessionID,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  static describeSdkError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    try {
      return JSON.stringify(error) ?? "unknown SDK error";
    } catch {
      return "unserializable SDK error";
    }
  }

  private describeSdkError(error: unknown): string {
    return SessionSnapshotLoader.describeSdkError(error);
  }
}
