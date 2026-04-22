import { InMemoryMemento, Uri, workspace } from "./vscode-mock.js";

export { InMemoryMemento, Uri, workspace };

export interface LogEntry {
  level: string;
  message: string;
  context?: Record<string, unknown>;
}

export function createTestLogger() {
  const entries: LogEntry[] = [];
  let flowCounter = 0;
  const activeFlows: Map<string, Record<string, unknown>> = new Map();

  const logger = {
    error: (message: string, context?: Record<string, unknown>, _error?: Error) =>
      entries.push({ level: "error", message, context }),
    warn: (message: string, context?: Record<string, unknown>) =>
      entries.push({ level: "warn", message, context }),
    info: (message: string, context?: Record<string, unknown>) =>
      entries.push({ level: "info", message, context }),
    debug: (message: string, context?: Record<string, unknown>) =>
      entries.push({ level: "debug", message, context }),
    aiRequest: () => {},
    aiResponse: () => {},
    aiStreamEvent: () => {},
    tokenUsage: () => {},
    serverEvent: () => {},
    sessionEvent: () => {},
    startFeatureFlow: (name: string, meta?: Record<string, unknown>) => {
      const id = `flow-${++flowCounter}`;
      activeFlows.set(id, { name, ...meta });
      return id;
    },
    endFeatureFlow: (id: string, meta?: Record<string, unknown>) => {
      activeFlows.delete(id);
    },
    getActiveFeatureFlow: () => {
      const first = activeFlows.entries().next();
      if (first.done) return undefined;
      return { correlationId: first.value[0], ...first.value[1] };
    },
    featureStep: (_id: string, _step: string, _meta?: Record<string, unknown>) => {},
    logStateChange: (_what: string, _from: unknown, _to: unknown, _reason: string) => {},
    performance: (label: string, durationMs: number, meta?: Record<string, unknown>) =>
      entries.push({ level: "performance", message: label, context: { durationMs, ...meta } }),
    getEntries: () => entries,
    getEntriesByLevel: (level: string) => entries.filter((e) => e.level === level),
    clear: () => { entries.length = 0; activeFlows.clear(); flowCounter = 0; },
  };
  return logger;
}

export function createTestMemento() {
  return new InMemoryMemento();
}

export function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return undefined;
}

export function captureMessages() {
  const messages: unknown[] = [];
  const postMessage = (msg: unknown) => {
    messages.push(msg);
  };
  return {
    postMessage,
    getMessages: () => [...messages],
    getLastMessage: () => messages[messages.length - 1],
    getMessagesByType: (type: string) =>
      messages.filter((m: any) => m?.type === type),
    clear: () => { messages.length = 0; },
  };
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

export function createOpencodeClientStub(overrides?: Record<string, unknown>) {
  const defaultClient = {
    session: {
      create: async () => ({ data: { id: "test-session-1" } }),
      list: async () => ({ data: [] }),
      get: async (id: string) => ({ data: { id, title: "Test Session" } }),
      update: async () => ({ data: {} }),
      delete: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
      children: async () => ({ data: [] }),
    },
    event: {
      subscribe: async () => ({
        stream: (async function* () {})(),
      }),
    },
    model: {
      list: async () => ({ data: [] }),
    },
    agent: {
      list: async () => ({ data: [] }),
    },
    compact: async () => ({ data: {} }),
  };

  return { ...defaultClient, ...overrides };
}
