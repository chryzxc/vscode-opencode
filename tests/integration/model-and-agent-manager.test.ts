import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Memento } from "vscode";
import { ModelAndAgentManager } from "../../src/providers/chat/ModelAndAgentManager.js";
import type { ChatModelOption, SessionSettings } from "../../src/providers/chat/types.js";
import {
  captureMessages,
  createOpencodeClientStub,
  createTestLogger,
  createTestMemento,
  firstNonEmptyString,
} from "./helpers/test-utils.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function createCompatibleLogger(): ReturnType<
  typeof import("../../src/utils/Logger.js").createLogger
> {
  const base = createTestLogger();
  const activeFlows = new Map<
    string,
    {
      featureName: string;
      correlationId: string;
      startTime: number;
      metadata: Record<string, unknown>;
    }
  >();

  return {
    error: (message, context, error) => {
      base.error(message, context, error);
    },
    warn: (message, context) => {
      base.warn(message, context);
    },
    info: (message, context) => {
      base.info(message, context);
    },
    debug: (message, context) => {
      base.debug(message, context);
    },
    aiRequest: () => {},
    aiResponse: () => {},
    aiStreamEvent: () => {},
    tokenUsage: () => {},
    serverEvent: () => {},
    sessionEvent: () => {},
    startFeatureFlow: (featureName, metadata) => {
      const correlationId = base.startFeatureFlow(featureName, metadata);
      activeFlows.set(correlationId, {
        featureName,
        correlationId,
        startTime: Date.now(),
        metadata: metadata ?? {},
      });
      return correlationId;
    },
    endFeatureFlow: (id, result) => {
      base.endFeatureFlow(id, result);
      const flow = activeFlows.get(id);
      if (!flow) {
        return undefined;
      }

      activeFlows.delete(id);

      return {
        ...flow,
        duration: Date.now() - flow.startTime,
        result,
      };
    },
    getActiveFeatureFlow: (correlationId) => {
      if (correlationId) {
        return activeFlows.get(correlationId);
      }

      const flows = Array.from(activeFlows.values());
      return flows[flows.length - 1];
    },
    featureStep: (id, step, meta) => {
      base.featureStep(id, step, meta);
    },
    logStateChange: (what, from, to, reason) => {
      base.logStateChange(what, from, to, reason);
    },
    logUIInteraction: (_component, _action, _element, _payload) => {},
    performance: (label, durationMs, meta) => {
      base.performance(label, durationMs, meta);
    },
  };
}

function createCompatibleMemento(): Memento {
  const base = createTestMemento();

  return {
    get: <T>(key: string, defaultValue?: T) => {
      if (arguments.length === 2) {
        return base.get(key, defaultValue as T);
      }

      return base.get<T>(key);
    },
    keys: () => base.keys,
    update: (key, value) => base.update(key, value),
  };
}

type OpencodeClientStub = ReturnType<typeof createOpencodeClientStub>;

type ServerManagerStub = {
  ensureRunning: () => Promise<OpencodeClientStub>;
};

type CreateManagerOptions = {
  selectedModel?: { providerID: string; modelID: string; providerName?: string };
  sessionSettings?: Record<string, SessionSettings>;
  cachedModelList?: ChatModelOption[];
  client?: OpencodeClientStub;
  ensureRunning?: () => Promise<OpencodeClientStub>;
};

function createManager(options: CreateManagerOptions = {}) {
  const globalState = createCompatibleMemento();

  if (options.selectedModel) {
    void globalState.update("selectedModel", options.selectedModel);
  }
  if (options.sessionSettings) {
    void globalState.update("sessionSettings", options.sessionSettings);
  }
  if (options.cachedModelList) {
    void globalState.update("cachedModelList", options.cachedModelList);
  }

  const logger = createCompatibleLogger();
  const messages = captureMessages();
  const client = options.client ?? createOpencodeClientStub();
  const serverManager: ServerManagerStub = {
    ensureRunning: options.ensureRunning ?? (async () => client),
  };
  const modelCapabilitiesService = {
    getCapabilities: async () => null,
    rememberCapabilities: () => {},
  } as unknown as ConstructorParameters<typeof ModelAndAgentManager>[2];

  const manager = new ModelAndAgentManager(
    globalState,
    serverManager as unknown as ConstructorParameters<typeof ModelAndAgentManager>[1],
    modelCapabilitiesService,
    logger,
    asRecord,
    firstNonEmptyString,
  );

  manager.setPostMessage(messages.postMessage);

  return {
    manager,
    globalState,
    client,
    logger,
    messages,
  };
}

describe("ModelAndAgentManager", () => {
  beforeEach(() => {
    createTestLogger().clear();
  });

  describe("basic selection state", () => {
    it("uses the default selected model and empty model list initially", () => {
      const { manager } = createManager();

      assert.deepEqual(manager.getSelectedModel(), {
        providerID: "opencode",
        modelID: "big-pickle",
      });
      assert.deepEqual(manager.getAvailableModels(), []);
      assert.equal(manager.getSelectedAgent(), undefined);
    });

    it("persists selected model updates in memory and global state", async () => {
      const { manager, globalState } = createManager();
      const model = {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
        providerName: "Anthropic",
      };

      await manager.setSelectedModel(model);

      assert.deepEqual(manager.getSelectedModel(), model);
      assert.deepEqual(globalState.get("selectedModel"), model);
    });

    it("stores the selected agent in memory", () => {
      const { manager } = createManager();

      manager.setSelectedAgent("plan");
      assert.equal(manager.getSelectedAgent(), "plan");

      manager.setSelectedAgent(undefined);
      assert.equal(manager.getSelectedAgent(), undefined);
    });
  });

  describe("normalizeSlashCommand", () => {
    it("normalizes valid slash command payloads", () => {
      const { manager } = createManager();

      assert.deepEqual(
        manager.normalizeSlashCommand({
          name: "/ship",
          description: "Deploy the branch",
          agent: "build",
          model: "anthropic/claude-sonnet-4-5",
          template: "do the thing",
          source: "project",
          subtask: true,
        }),
        {
          name: "ship",
          description: "Deploy the branch",
          agent: "build",
          model: "anthropic/claude-sonnet-4-5",
          template: "do the thing",
          source: "project",
          subtask: true,
        },
      );
    });

    it("returns null for invalid names and ignores malformed optional fields", () => {
      const { manager } = createManager();

      assert.equal(manager.normalizeSlashCommand(null), null);
      assert.equal(manager.normalizeSlashCommand({ description: "missing name" }), null);
      assert.equal(manager.normalizeSlashCommand({ name: "/" }), null);
      assert.deepEqual(
        manager.normalizeSlashCommand({
          name: "review",
          description: "   ",
          agent: "",
          subtask: "yes",
        }),
        {
          name: "review",
          description: undefined,
          agent: undefined,
          model: undefined,
          template: undefined,
          source: undefined,
          subtask: undefined,
        },
      );
    });
  });

  describe("getSelectedModelFallbackList", () => {
    it("returns a fallback entry derived from the selected model", () => {
      const { manager } = createManager({
        selectedModel: {
          providerID: "openai",
          modelID: "gpt-4.1",
        },
      });

      assert.deepEqual(manager.getSelectedModelFallbackList(), [
        {
          providerID: "openai",
          modelID: "gpt-4.1",
          name: "gpt-4.1",
          providerName: "openai",
        },
      ]);
    });

    it("returns an empty list when the persisted selected model is incomplete", () => {
      const { manager } = createManager({
        selectedModel: {
          providerID: "",
          modelID: "",
        },
      });

      assert.deepEqual(manager.getSelectedModelFallbackList(), []);
    });
  });

  describe("session settings", () => {
    it("returns empty defaults when no settings exist", () => {
      const { manager } = createManager();

      assert.deepEqual(manager.getSessionSettingsMap(), {});
      assert.deepEqual(manager.getSessionSettings("missing-session"), {});
    });

    it("persists merged session settings and applies them back to selections", async () => {
      const { manager } = createManager();

      await manager.persistSessionSettings("session-1", { agent: "plan" });
      await manager.persistSessionSettings("session-1", {
        model: {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-5",
          providerName: "Anthropic",
        },
        thinkingLevel: "high",
      });

      assert.deepEqual(manager.getSessionSettingsMap(), {
        "session-1": {
          agent: "plan",
          model: {
            providerID: "anthropic",
            modelID: "claude-sonnet-4-5",
            providerName: "Anthropic",
          },
          thinkingLevel: "high",
        },
      });

      manager.setSelectedAgent("build");
      await manager.setSelectedModel({
        providerID: "openai",
        modelID: "gpt-4.1",
        providerName: "OpenAI",
      });

      await manager.applySessionSettings("session-1");

      assert.equal(manager.getSelectedAgent(), "plan");
      assert.deepEqual(manager.getSelectedModel(), {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
        providerName: "Anthropic",
      });
    });

    it("ignores incomplete persisted model settings when applying a session", async () => {
      const { manager, globalState } = createManager();

      await manager.setSelectedModel({
        providerID: "openai",
        modelID: "gpt-4.1",
        providerName: "OpenAI",
      });
      manager.setSelectedAgent("build");
      await globalState.update("sessionSettings", {
        "session-1": {
          agent: "plan",
          model: {
            providerID: "anthropic",
          },
        },
      });

      await manager.applySessionSettings("session-1");

      assert.equal(manager.getSelectedAgent(), "plan");
      assert.deepEqual(manager.getSelectedModel(), {
        providerID: "openai",
        modelID: "gpt-4.1",
        providerName: "OpenAI",
      });
    });

    it("migrates old session settings onto a new session without overwriting explicit new values", () => {
      const { manager, globalState } = createManager({
        sessionSettings: {
          "old-session": {
            agent: "plan",
            model: {
              providerID: "anthropic",
              modelID: "claude-sonnet-4-5",
              providerName: "Anthropic",
            },
          },
          "new-session": {
            thinkingLevel: "max",
            agent: "build",
          },
        },
      });

      manager.migrateSessionSettings("old-session", "new-session");

      assert.deepEqual(globalState.get("sessionSettings"), {
        "old-session": {
          agent: "plan",
          model: {
            providerID: "anthropic",
            modelID: "claude-sonnet-4-5",
            providerName: "Anthropic",
          },
        },
        "new-session": {
          agent: "build",
          model: {
            providerID: "anthropic",
            modelID: "claude-sonnet-4-5",
            providerName: "Anthropic",
          },
          thinkingLevel: "max",
        },
      });
    });
  });

  describe("handleGetModels", () => {
    it("loads provider models, normalizes fields, caches them, and posts the list", async () => {
      const client = createOpencodeClientStub({
        provider: {
          list: async () => ({
            data: {
              all: [
                {
                  id: "anthropic",
                  name: "Anthropic",
                  models: {
                    "claude-sonnet": {
                      name: "Claude Sonnet",
                      limit: { context: 200_000 },
                    },
                    "claude-haiku": {
                      limit: { context: 0 },
                    },
                  },
                },
                {
                  id: "openai",
                  models: {
                    "gpt-4.1": {},
                  },
                },
              ],
            },
          }),
        },
        config: {
          providers: async () => ({
            data: {
              providers: [{ id: "anthropic" }, { id: "openai" }],
            },
          }),
        },
      });
      const { manager, messages } = createManager({
        selectedModel: {
          providerID: "anthropic",
          modelID: "claude-sonnet",
          providerName: "Anthropic",
        },
        client,
      });

      const models = await manager.handleGetModels();

      assert.deepEqual(models, [
        {
          providerID: "anthropic",
          modelID: "claude-sonnet",
          name: "Claude Sonnet",
          providerName: "Anthropic",
          contextLimit: 200000,
          reasoning: false,
          variants: [],
        },
        {
          providerID: "anthropic",
          modelID: "claude-haiku",
          name: "claude-haiku",
          providerName: "Anthropic",
          contextLimit: undefined,
          reasoning: false,
          variants: [],
        },
        {
          providerID: "openai",
          modelID: "gpt-4.1",
          name: "gpt-4.1",
          providerName: "openai",
          contextLimit: undefined,
          reasoning: false,
          variants: [],
        },
      ]);
      assert.deepEqual(manager.getAvailableModels(), models);
      assert.deepEqual(messages.getLastMessage(), {
        type: "modelsList",
        models,
        selectedModel: {
          providerID: "anthropic",
          modelID: "claude-sonnet",
          providerName: "Anthropic",
        },
        configuredProviders: ["anthropic", "openai"],
      });
    });

    it("accepts alternate provider payload shapes and deduplicates repeated model ids", async () => {
      const client = createOpencodeClientStub({
        provider: {
          list: async () => ({
            data: {
              providers: [
                {
                  id: "openai",
                  name: "OpenAI",
                  models: {
                    "gpt-5.4": {
                      name: "GPT-5.4",
                      reasoning: true,
                      variants: {
                        high: { disabled: false },
                        low: { disabled: false },
                      },
                    },
                  },
                },
                {
                  id: "openai",
                  name: "OpenAI",
                  models: {
                    "gpt-5.4": {
                      name: "GPT-5.4 duplicate",
                    },
                  },
                },
              ],
              connected: ["openai"],
            },
          }),
        },
      });
      const { manager, messages } = createManager({
        selectedModel: {
          providerID: "openai",
          modelID: "gpt-5.4",
          providerName: "OpenAI",
        },
        client,
      });

      const models = await manager.handleGetModels();

      assert.deepEqual(models, [
        {
          providerID: "openai",
          modelID: "gpt-5.4",
          name: "GPT-5.4",
          providerName: "OpenAI",
          contextLimit: undefined,
          reasoning: true,
          variants: ["high", "low"],
        },
      ]);
      assert.deepEqual(messages.getLastMessage(), {
        type: "modelsList",
        models,
        selectedModel: {
          providerID: "openai",
          modelID: "gpt-5.4",
          providerName: "OpenAI",
        },
        configuredProviders: ["openai"],
      });
    });

    it("falls back to the selected model when the provider list is empty", async () => {
      const client = createOpencodeClientStub({
        provider: {
          list: async () => ({ data: { all: [] } }),
        },
      });
      const { manager, messages } = createManager({
        selectedModel: {
          providerID: "openai",
          modelID: "gpt-4.1",
          providerName: "OpenAI",
        },
        client,
      });

      const models = await manager.handleGetModels();

      assert.deepEqual(models, [
        {
          providerID: "openai",
          modelID: "gpt-4.1",
          name: "gpt-4.1",
          providerName: "OpenAI",
        },
      ]);
      assert.deepEqual(messages.getLastMessage(), {
        type: "modelsList",
        models,
        selectedModel: {
          providerID: "openai",
          modelID: "gpt-4.1",
          providerName: "OpenAI",
        },
      });
    });

    it("reuses cached available models when a later fetch returns no usable data", async () => {
      const successfulModels: ChatModelOption[] = [
        {
          providerID: "anthropic",
          modelID: "claude-sonnet",
          name: "Claude Sonnet",
          providerName: "Anthropic",
          contextLimit: undefined,
          reasoning: false,
          variants: [],
        },
      ];
      let requestCount = 0;
      const client = createOpencodeClientStub({
        provider: {
          list: async () => {
            requestCount += 1;
            if (requestCount === 1) {
              return {
                data: {
                  all: [
                    {
                      id: "anthropic",
                      name: "Anthropic",
                      models: {
                        "claude-sonnet": { name: "Claude Sonnet" },
                      },
                    },
                  ],
                },
              };
            }

            return { data: null };
          },
        },
      });
      const { manager } = createManager({
        selectedModel: {
          providerID: "anthropic",
          modelID: "claude-sonnet",
          providerName: "Anthropic",
        },
        client,
      });

      assert.deepEqual(await manager.handleGetModels(), successfulModels);
      assert.deepEqual(await manager.handleGetModels(), successfulModels);
      assert.deepEqual(manager.getAvailableModels(), successfulModels);
    });

    it("persists the last successful full model list for later fallback", async () => {
      const successfulModels: ChatModelOption[] = [
        {
          providerID: "anthropic",
          modelID: "claude-sonnet",
          name: "Claude Sonnet",
          providerName: "Anthropic",
          contextLimit: undefined,
          reasoning: false,
          variants: [],
        },
        {
          providerID: "openai",
          modelID: "gpt-5.4",
          name: "gpt-5.4",
          providerName: "OpenAI",
          contextLimit: undefined,
          reasoning: true,
          variants: ["high"],
        },
      ];
      const client = createOpencodeClientStub({
        provider: {
          list: async () => ({
            data: {
              all: [
                {
                  id: "anthropic",
                  name: "Anthropic",
                  models: {
                    "claude-sonnet": { name: "Claude Sonnet" },
                  },
                },
                {
                  id: "openai",
                  name: "OpenAI",
                  models: {
                    "gpt-5.4": {
                      capabilities: { reasoning: true },
                      variants: { high: {} },
                    },
                  },
                },
              ],
            },
          }),
        },
      });
      const { manager, globalState } = createManager({ client });

      assert.deepEqual(await manager.handleGetModels(), successfulModels);
      assert.deepEqual(globalState.get("cachedModelList"), successfulModels);
    });

    it("falls back immediately when provider listing times out", async () => {
      const client = createOpencodeClientStub({
        provider: {
          list: async () => new Promise<never>(() => {}),
        },
      });
      const { manager } = createManager({
        selectedModel: {
          providerID: "openai",
          modelID: "gpt-4.1-mini",
          providerName: "OpenAI",
        },
        client,
      });

      const originalSetTimeout = globalThis.setTimeout;
      function immediateSetTimeout(
        handler: TimerHandler,
        _timeout?: number,
        ...arguments_: unknown[]
      ): ReturnType<typeof setTimeout> {
        if (typeof handler === "function") {
          handler(...arguments_);
        }

        return originalSetTimeout(() => {}, 0);
      }
      const immediateSetTimeoutWithPromisify = Object.assign(immediateSetTimeout, {
        __promisify__: originalSetTimeout.__promisify__,
      }) as unknown as typeof setTimeout;
      globalThis.setTimeout = immediateSetTimeoutWithPromisify;

      try {
        const models = await manager.handleGetModels();

        assert.deepEqual(models, [
          {
            providerID: "openai",
            modelID: "gpt-4.1-mini",
            name: "gpt-4.1-mini",
            providerName: "OpenAI",
          },
        ]);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }
    });

    it("restores a persisted full model list when provider listing times out", async () => {
      const cachedModelList: ChatModelOption[] = [
        {
          providerID: "anthropic",
          modelID: "claude-sonnet",
          name: "Claude Sonnet",
          providerName: "Anthropic",
          contextLimit: undefined,
          reasoning: false,
          variants: [],
        },
        {
          providerID: "openai",
          modelID: "gpt-5.4",
          name: "gpt-5.4",
          providerName: "OpenAI",
          contextLimit: undefined,
          reasoning: true,
          variants: ["high"],
        },
      ];
      const client = createOpencodeClientStub({
        provider: {
          list: async () => new Promise<never>(() => {}),
        },
      });
      const { manager, messages } = createManager({
        selectedModel: {
          providerID: "openai",
          modelID: "gpt-5.4",
          providerName: "OpenAI",
        },
        cachedModelList,
        client,
      });

      const originalSetTimeout = globalThis.setTimeout;
      function immediateSetTimeout(
        handler: TimerHandler,
        _timeout?: number,
        ...arguments_: unknown[]
      ): ReturnType<typeof setTimeout> {
        if (typeof handler === "function") {
          handler(...arguments_);
        }

        return originalSetTimeout(() => {}, 0);
      }
      const immediateSetTimeoutWithPromisify = Object.assign(immediateSetTimeout, {
        __promisify__: originalSetTimeout.__promisify__,
      }) as unknown as typeof setTimeout;
      globalThis.setTimeout = immediateSetTimeoutWithPromisify;

      try {
        const models = await manager.handleGetModels();

        assert.deepEqual(models, cachedModelList);
        assert.deepEqual(messages.getLastMessage(), {
          type: "modelsList",
          models: cachedModelList,
          selectedModel: {
            providerID: "openai",
            modelID: "gpt-5.4",
            providerName: "OpenAI",
          },
        });
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }
    });
  });

  describe("handleGetAgents", () => {
    it("merges built-in and SDK agents, filters hidden entries, and chooses a default agent", async () => {
      const client = createOpencodeClientStub({
        app: {
          agents: async () => ({
            data: [
              {
                name: "build",
                description: "Custom build agent",
                mode: "primary",
                builtIn: true,
                color: "#ffcc00",
              },
              {
                name: "explore",
                mode: "all",
                builtIn: false,
                color: "#00ccff",
              },
              {
                name: "summary",
                mode: "primary",
                builtIn: true,
              },
              {
                name: "review",
                mode: "subagent",
                builtIn: false,
              },
            ],
          }),
        },
      });
      const { manager, messages } = createManager({ client });

      await manager.handleGetAgents();

      assert.equal(manager.getSelectedAgent(), "plan");
      assert.deepEqual(messages.getLastMessage(), {
        type: "agentsList",
        agents: [
          {
            id: "plan",
            name: "Plan",
            description: "Restricted agent for planning and analysis without making changes",
            mode: "primary",
            builtIn: true,
          },
          {
            id: "build",
            name: "Build",
            description: "Custom build agent",
            mode: "primary",
            builtIn: true,
            color: "#ffcc00",
          },
          {
            id: "explore",
            name: "Explore",
            description: "OpenCode Explore agent",
            mode: "all",
            builtIn: false,
            color: "#00ccff",
          },
        ],
        selectedAgent: "plan",
      });
    });

    it("falls back to built-in agents when SDK agent discovery is unavailable", async () => {
      const client = createOpencodeClientStub({});
      const { manager, messages } = createManager({ client });

      manager.setSelectedAgent("plan");
      await manager.handleGetAgents();

      assert.deepEqual(messages.getLastMessage(), {
        type: "agentsList",
        agents: [
          {
            id: "build",
            name: "Build",
            description: "Default agent for development work with all tools enabled",
            mode: "primary",
            builtIn: true,
          },
          {
            id: "plan",
            name: "Plan",
            description: "Restricted agent for planning and analysis without making changes",
            mode: "primary",
            builtIn: true,
          },
        ],
        selectedAgent: "plan",
      });
    });

    it("falls back to built-in agents when SDK returns malformed agent data", async () => {
      const client = createOpencodeClientStub({
        app: {
          agents: async () => ({
            data: [{ mode: "primary", builtIn: false }],
          }),
        },
      });
      const { manager, messages } = createManager({ client });

      await manager.handleGetAgents();

      assert.equal(manager.getSelectedAgent(), undefined);
      assert.deepEqual(messages.getLastMessage(), {
        type: "agentsList",
        agents: [
          {
            id: "build",
            name: "Build",
            description: "Default agent for development work with all tools enabled",
            mode: "primary",
            builtIn: true,
          },
          {
            id: "plan",
            name: "Plan",
            description: "Restricted agent for planning and analysis without making changes",
            mode: "primary",
            builtIn: true,
          },
        ],
        selectedAgent: "build",
      });
    });
  });
});
