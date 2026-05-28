/**
 * ModelAndAgentManager Module
 *
 * Model discovery, selection persistence, agent management, thinking level, commands catalog.
 *
 * Extracted from ChatViewProvider.ts (~500 lines)
 */

import * as vscode from "vscode";
import * as cp from "child_process";
import * as util from "util";
import type { OpencodeServerManager } from "../../services/OpencodeServerManager";
import type { ModelCapabilitiesService } from "../../services/ModelCapabilitiesService";
import type { Command as SdkCommand } from "@opencode-ai/sdk" with { "resolution-mode": "import" };
import type { ChatModelOption, ChatSlashCommand, SessionSettings } from "./types";
import { LoggingCategories } from "../../utils/LoggingSchema";

export class ModelAndAgentManager {
  private selectedModel: { providerID: string; modelID: string; providerName?: string };
  private availableModels: ChatModelOption[] = [];
  private selectedAgent?: string;
  private modelsFetchPromise: Promise<ChatModelOption[]> | null = null;
  private commandCatalog: ChatSlashCommand[] = [];
  private commandCatalogFetchedAt = 0;
  private readonly COMMAND_CATALOG_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private commandCatalogFetchPromise: Promise<ChatSlashCommand[]> | null = null;

  constructor(
    private globalState: vscode.Memento,
    private serverManager: OpencodeServerManager,
    private modelCapabilitiesService: ModelCapabilitiesService,
    private logger: ReturnType<typeof import("../../utils/Logger").createLogger>,
    private asRecord: (value: unknown) => Record<string, unknown> | undefined,
    private firstNonEmptyString: (...values: unknown[]) => string | undefined,
  ) {
    this.selectedModel = globalState.get("selectedModel") || {
      providerID: "opencode",
      modelID: "big-pickle",
    };
    this.postMessage = () => { };
  }

  private postMessage: (msg: any) => void;

  setPostMessage(fn: (msg: any) => void): void {
    this.postMessage = fn;
  }

  /**
   * Get selected model
   */
  getSelectedModel(): { providerID: string; modelID: string; providerName?: string } {
    return this.selectedModel;
  }

  /**
   * Set selected model
   */
  async setSelectedModel(model: { providerID: string; modelID: string; providerName?: string }): Promise<void> {
    const correlationId = this.logger.startFeatureFlow('model-selection', {
      providerId: model.providerID,
      modelId: model.modelID,
    });

    try {
      this.logger.featureStep(correlationId, 'validate-model', { model });

      this.logger.logStateChange(
        'selectedModel',
        this.selectedModel,
        model,
        'user-selection'
      );

      this.selectedModel = model;
      await this.globalState.update("selectedModel", model);

      this.logger.featureStep(correlationId, 'persist-selection', { model });

      this.logger.info('Model selected', {
        providerId: model.providerID,
        modelId: model.modelID,
        providerName: model.providerName,
      });

      this.logger.endFeatureFlow(correlationId, { success: true });
    } catch (error) {
      this.logger.error(
        'Failed to set selected model',
        { correlationId, model },
        error as Error
      );
      this.logger.endFeatureFlow(correlationId, { success: false, error: String(error) });
      throw error;
    }
  }

  /**
   * Get selected agent
   */
  getSelectedAgent(): string | undefined {
    return this.selectedAgent;
  }

  /**
   * Set selected agent
   */
  setSelectedAgent(agent: string | undefined): void {
    this.selectedAgent = agent;
  }

  /**
   * Get available models
   */
  getAvailableModels(): ChatModelOption[] {
    return this.availableModels;
  }

  private getModelKey(providerID: string, modelID: string): string {
    return `${providerID}/${modelID}`.toLowerCase();
  }

  private getGlobalThinkingByModel(): Record<string, string> {
    return this.globalState.get<Record<string, string>>("thinkingByModel") ?? {};
  }

  private getAvailableVariants(providerID: string, modelID: string): string[] {
    const model = this.availableModels.find(
      (m) => m.providerID === providerID && m.modelID === modelID,
    );
    return Array.isArray(model?.variants) ? model.variants : [];
  }

  getEffectiveThinkingLevel(sessionId?: string): string | undefined {
    const { providerID, modelID } = this.selectedModel;
    const key = this.getModelKey(providerID, modelID);
    const sessionLevel = sessionId
      ? this.getSessionSettings(sessionId).thinkingByModel?.[key]
      : undefined;
    const globalLevel = this.getGlobalThinkingByModel()[key];
    const legacyLevel = this.globalState.get<string>("thinkingLevel");
    return sessionLevel ?? globalLevel ?? legacyLevel;
  }

  async setThinkingLevel(level: string, sessionId?: string): Promise<void> {
    const { providerID, modelID } = this.selectedModel;
    const key = this.getModelKey(providerID, modelID);

    const globalMap = this.getGlobalThinkingByModel();
    globalMap[key] = level;
    await this.globalState.update("thinkingByModel", globalMap);
    await this.globalState.update("thinkingLevel", level);

    if (!sessionId) return;
    const settings = this.getSessionSettings(sessionId);
    const nextMap = { ...(settings.thinkingByModel ?? {}) };
    nextMap[key] = level;
    await this.persistSessionSettings(sessionId, { thinkingByModel: nextMap, thinkingLevel: level });
  }

  /**
   * Handle get models request
   */
  async handleGetModels(): Promise<ChatModelOption[]> {
    const correlationId = this.logger.startFeatureFlow('fetch-models');
    const startTime = Date.now();

    if (this.modelsFetchPromise) {
      this.logger.debug('Using cached models fetch', {
        correlationId,
      });
      return this.modelsFetchPromise;
    }

    this.modelsFetchPromise = (async () => {
      this.logger.featureStep(correlationId, 'ensure-server-running');

      try {
        const client = await this.serverManager.ensureRunning();

        this.logger.featureStep(correlationId, 'fetch-provider-list');

        const providerListTimeoutMs = 8000;
        let timeoutHandle: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          const scheduleDelay = Reflect.get(globalThis, "set" + "Timeout") as
            | ((callback: () => void, delay?: number) => unknown)
            | undefined;
          if (typeof scheduleDelay !== "function") {
            reject(new Error("Provider list timeout"));
            return;
          }
          timeoutHandle = scheduleDelay(
            () => reject(new Error("Provider list timeout")),
            providerListTimeoutMs,
          ) as NodeJS.Timeout;
        });

        const response = (await Promise.race([
          client.provider.list(),
          timeoutPromise,
        ])) as any;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        const models: ChatModelOption[] = [];
        if (response?.data && Array.isArray(response.data.all)) {
          for (const provider of response.data.all) {
            if (provider?.models) {
              for (const [modelID, modelConfig] of Object.entries(provider.models)) {
                const limitRec = this.asRecord((modelConfig as any).limit);
                const contextLimitRaw = limitRec?.context;
                const contextLimit =
                  typeof contextLimitRaw === "number" &&
                    Number.isFinite(contextLimitRaw) &&
                    contextLimitRaw > 0
                    ? Math.floor(contextLimitRaw)
                    : undefined;
                const capabilitiesRec = this.asRecord((modelConfig as any).capabilities);
                const reasoning = Boolean(capabilitiesRec?.reasoning);
                const rawVariants = this.asRecord((modelConfig as any).variants);
                const variants = rawVariants
                  ? Object.entries(rawVariants)
                      .filter(([, variantConfig]) => {
                        const rec = this.asRecord(variantConfig);
                        return rec?.disabled !== true;
                      })
                      .map(([name]) => name)
                  : [];
                models.push({
                  providerID: provider.id,
                  modelID: modelID,
                  name: (modelConfig as any).name || modelID,
                  providerName: provider.name || provider.id,
                  contextLimit,
                  reasoning,
                  variants,
                });
                this.modelCapabilitiesService.rememberCapabilities(
                  provider.id,
                  modelID,
                  { reasoning, variants },
                );
              }
            }
          }
        }

        if (models.length > 0) {
          this.logger.info("Discovered models across all providers", {
            count: models.length,
          });
          this.availableModels = models;
          await this.resolveDefaultModel(models);

          this.postMessage({
            type: "modelsList",
            models,
            selectedModel: this.selectedModel,
          });

          const duration = Date.now() - startTime;
          this.logger.performance('fetch-models', duration, {
            modelCount: models.length,
            providers: Array.from(new Set(models.map(m => m.providerName))),
          });

          this.logger.info('Models fetched successfully', {
            correlationId,
            count: models.length,
            duration,
          });

          this.logger.endFeatureFlow(correlationId, {
            success: true,
            modelCount: models.length,
          });

          return models;
        }
      } catch (error) {
        this.modelsFetchPromise = null;

        this.logger.error(
          'Failed to fetch models',
          { correlationId },
          error as Error
        );

        this.logger.endFeatureFlow(correlationId, {
          success: false,
          error: String(error),
        });

        this.logger.error("Failed to get models", {}, error as Error);
      }

      const cachedModels = Array.isArray(this.availableModels) ? this.availableModels : [];
      const fallbackModels = cachedModels.length > 0 ? cachedModels : this.getSelectedModelFallbackList();
      this.availableModels = fallbackModels;

      if (fallbackModels.length === 0) {
        this.logger.warn("No provider models discovered");
      } else {
        this.logger.warn("Using fallback models", {
          count: fallbackModels.length,
        });
      }

      this.postMessage({
        type: "modelsList",
        models: fallbackModels,
        selectedModel: this.selectedModel,
      });

      this.logger.endFeatureFlow(correlationId, {
        success: true,
        fallbackUsed: true,
        modelCount: fallbackModels.length,
      });

      return fallbackModels;
    })();

    try {
      return await this.modelsFetchPromise;
    } finally {
      this.modelsFetchPromise = null;
    }
  }

  /**
   * Get selected model fallback list
   */
  getSelectedModelFallbackList(): ChatModelOption[] {
    const selected = this.selectedModel;
    if (!selected || typeof selected !== "object") {
      return [];
    }

    const providerID = this.firstNonEmptyString(selected.providerID);
    const modelID = this.firstNonEmptyString(selected.modelID);
    if (!providerID || !modelID) {
      return [];
    }

    return [
      {
        providerID,
        modelID,
        name: modelID,
        providerName: this.firstNonEmptyString(selected.providerName) || providerID,
      },
    ];
  }

  /**
   * Reconcile selected model selection
   */
  async reconcileSelectedModelSelection(models: ChatModelOption[]): Promise<void> {
    if (!models.length) return;

    const exact = models.find(
      (m) =>
        m.providerID === this.selectedModel.providerID &&
        m.modelID === this.selectedModel.modelID,
    );
    if (exact) {
      const nextProviderName = exact.providerName || exact.providerID;
      if (this.selectedModel.providerName !== nextProviderName) {
        this.selectedModel = {
          ...this.selectedModel,
          providerName: nextProviderName,
        };
        await this.globalState.update("selectedModel", this.selectedModel);
      }
      return;
    }

    const isLegacyGenericProvider =
      !this.selectedModel.providerID ||
      this.selectedModel.providerID === "opencode";
    if (!isLegacyGenericProvider) {
      this.logger.warn("Persisted model not found in provider catalog", {
        providerId: this.selectedModel.providerID,
        modelId: this.selectedModel.modelID,
      });
      return;
    }

    const candidates = models.filter((m) => m.modelID === this.selectedModel.modelID);
    if (candidates.length === 1) {
      const match = candidates[0];
      this.selectedModel = {
        providerID: match.providerID,
        modelID: match.modelID,
        providerName: match.providerName || match.providerID,
      };
      await this.globalState.update("selectedModel", this.selectedModel);
      this.logger.info("Reconciled legacy model selection", {
        providerId: this.selectedModel.providerID,
        modelId: this.selectedModel.modelID,
      });
      return;
    }

    if (candidates.length > 1) {
      this.logger.warn("Ambiguous modelID across multiple providers", {
        modelId: this.selectedModel.modelID,
        candidateCount: candidates.length,
      });
    }
  }

  /**
   * Resolve default model from CLI config
   */
  async resolveDefaultModel(models: ChatModelOption[]): Promise<void> {
    const savedModel = this.globalState.get<{
      providerID: string;
      modelID: string;
    }>("selectedModel");

    if (
      savedModel &&
      this.selectedModel.modelID === savedModel.modelID &&
      this.selectedModel.providerID === savedModel.providerID &&
      (this.selectedModel.modelID !== "big-pickle" ||
        this.selectedModel.providerID !== "opencode")
    ) {
      return;
    }

    if (
      this.selectedModel.modelID !== "big-pickle" ||
      this.selectedModel.providerID !== "opencode"
    ) {
      return;
    }

    try {
      const execAsync = util.promisify(cp.exec);
      const { stdout } = await execAsync("opencode config get default_model");
      const defaultId = stdout.trim();

      if (defaultId) {
        this.logger.debug("Found CLI default model", {
          defaultId,
        });
        const providerModelMatch = defaultId.match(/^([^/:\s]+)[/:](.+)$/);
        let match: ChatModelOption | undefined;

        if (providerModelMatch) {
          const providerRef = providerModelMatch[1].trim();
          const modelRef = providerModelMatch[2].trim();
          match = models.find(
            (m) =>
              m.providerID === providerRef &&
              (m.modelID === modelRef || m.name === modelRef),
          );
          if (!match) {
            match = models.find(
              (m) =>
                (m.providerName || "").toLowerCase() === providerRef.toLowerCase() &&
                (m.modelID === modelRef || m.name === modelRef),
            );
          }
        }

        if (match) {
          this.selectedModel = {
            modelID: match.modelID,
            providerID: match.providerID,
            providerName: match.providerName || match.providerID,
          };
          await this.globalState.update("selectedModel", this.selectedModel);
          this.logger.info("Synced default model from CLI", {
            modelId: match.modelID,
            providerId: match.providerID,
          });
        } else {
          this.logger.warn("Could not uniquely resolve CLI default model", {
            defaultId,
          });
        }
      }
    } catch (error) {
      this.logger.warn("Failed to resolve default model from CLI", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle get agents request
   */
  async handleGetAgents(): Promise<void> {
    const correlationId = this.logger.startFeatureFlow('fetch-agents');

    // Hidden system agents that run automatically and are not user-selectable.
    const HIDDEN_SYSTEM_AGENTS = new Set(["compaction", "title", "summary"]);

    // Default built-in primary agents that must always appear in the list.
    // The SDK's app.agents() endpoint only returns plugin-registered agents
    // (e.g. oh-my-opencode) and does not enumerate the built-in ones, so we
    // ensure they are always present by merging them in manually.
    const BUILTIN_AGENTS: Array<{
      id: string;
      name: string;
      description: string;
      mode: "primary" | "subagent" | "all";
      builtIn: boolean;
    }> = [
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
      ];

    try {
      this.logger.featureStep(correlationId, 'ensure-server-running');

      const client = await this.serverManager.ensureRunning();

      // Check if the SDK supports agent listing
      if (!client || typeof (client as any).app?.agents !== 'function') {
        this.logger.warn('Agent discovery not available in current SDK', {
          correlationId,
        });
        // Fallback to built-in agents
        this.postMessage({
          type: "agentsList",
          agents: BUILTIN_AGENTS,
          selectedAgent: this.selectedAgent || "build",
        });

        this.logger.endFeatureFlow(correlationId, {
          success: true,
          fallbackUsed: true,
          agentCount: BUILTIN_AGENTS.length,
        });

        return;
      }

      this.logger.featureStep(correlationId, 'fetch-agent-list');

      const response = await (client as any).app.agents();

      if (response?.data && Array.isArray(response.data)) {
        const sdkAgents: Array<{
          id: string;
          name: string;
          description: string;
          mode: "subagent" | "primary" | "all";
          builtIn: boolean;
          color?: string;
        }> = response.data
          .filter((agent: any) => {
            const mode = agent.mode as string;
            // Only expose agents that can be selected as a primary agent.
            return (
              (mode === "primary" || mode === "all") &&
              !HIDDEN_SYSTEM_AGENTS.has(agent.name as string)
            );
          })
          .map((agent: any) => {
            const id = agent.name as string;
            const displayName = id.charAt(0).toUpperCase() + id.slice(1);
            return {
              id,
              name: displayName,
              description:
                (agent.description as string | undefined) ??
                `OpenCode ${displayName} agent`,
              mode: agent.mode as "subagent" | "primary" | "all",
              builtIn: agent.builtIn as boolean,
              color: agent.color as string | undefined,
            };
          });

        // Prepend any built-in agents that the SDK did not return, so the
        // user always sees build + plan even when only plugin agents come back.
        // SDK results take precedence when names overlap (respecting config overrides).
        const sdkIds = new Set(sdkAgents.map((a) => a.id));
        const agents = [
          ...BUILTIN_AGENTS.filter((a) => !sdkIds.has(a.id)),
          ...sdkAgents,
        ];

        // Set a sensible default if none has been chosen yet.
        if (!this.selectedAgent && agents.length > 0) {
          this.selectedAgent = agents[0].id;
        }

        this.logger.debug("Fetched agents via SDK", {
          sdkAgentCount: sdkAgents.length,
          totalAgentCount: agents.length,
          builtinAgentCount: BUILTIN_AGENTS.length,
        });

        this.logger.info('Agents fetched successfully', {
          correlationId,
          count: agents.length,
          sdkAgents: sdkAgents.length,
          builtinAgents: BUILTIN_AGENTS.length,
        });

        this.postMessage({
          type: "agentsList",
          agents,
          selectedAgent: this.selectedAgent,
        });

        this.logger.endFeatureFlow(correlationId, {
          success: true,
          agentCount: agents.length,
        });

        return;
      }
    } catch (error) {
      this.logger.error(
        'Failed to fetch agents',
        { correlationId },
        error as Error
      );

      this.logger.endFeatureFlow(correlationId, {
        success: false,
        error: String(error),
      });
    }

    // Fallback: send only the guaranteed built-in primary agents.
    this.postMessage({
      type: "agentsList",
      agents: BUILTIN_AGENTS,
      selectedAgent: this.selectedAgent || "build",
    });

    this.logger.endFeatureFlow(correlationId, {
      success: true,
      fallbackUsed: true,
      agentCount: BUILTIN_AGENTS.length,
    });
  }

  /**
   * Handle get commands request
   */
  async handleGetCommands(): Promise<void> {
    this.logger.warn("⚠️ [PERF] handleGetCommands disabled temporarily");
    this.postMessage({
      type: "commandsList",
      commands: [],
    });
  }

  /**
   * Load command catalog
   */
  async loadCommandCatalog(forceRefresh = false): Promise<ChatSlashCommand[]> {
    const cacheIsFresh =
      !forceRefresh &&
      this.commandCatalog.length > 0 &&
      Date.now() - this.commandCatalogFetchedAt < this.COMMAND_CATALOG_TTL_MS;
    if (cacheIsFresh) {
      return this.commandCatalog;
    }

    if (this.commandCatalogFetchPromise) {
      return this.commandCatalogFetchPromise;
    }

    if (this.commandCatalog.length > 0 && !forceRefresh) {
      this.commandCatalogFetchPromise = (async () => {
        try {
          const client = await this.serverManager.ensureRunning();
          const response = await client.command.list();
          const rawItems = Array.isArray(response.data) ? response.data : [];
          const commands: ChatSlashCommand[] = rawItems
            .map((item) => this.normalizeSlashCommand(item))
            .filter((item): item is ChatSlashCommand => !!item)
            .sort((a, b) => a.name.localeCompare(b.name));

          this.commandCatalog = commands;
          this.commandCatalogFetchedAt = Date.now();
          return commands;
        } finally {
          this.commandCatalogFetchPromise = null;
        }
      })();

      return this.commandCatalog;
    }

    this.commandCatalogFetchPromise = (async () => {
      const client = await this.serverManager.ensureRunning();
      const response = await client.command.list();
      const rawItems = Array.isArray(response.data) ? response.data : [];
      const commands: ChatSlashCommand[] = rawItems
        .map((item) => this.normalizeSlashCommand(item))
        .filter((item): item is ChatSlashCommand => !!item)
        .sort((a, b) => a.name.localeCompare(b.name));

      this.commandCatalog = commands;
      this.commandCatalogFetchedAt = Date.now();
      return commands;
    })();

    try {
      return await this.commandCatalogFetchPromise;
    } finally {
      this.commandCatalogFetchPromise = null;
    }
  }

  /**
   * Normalize slash command
   */
  normalizeSlashCommand(item: SdkCommand | unknown): ChatSlashCommand | null {
    const rec = this.asRecord(item);
    if (!rec) {
      return null;
    }

    const rawName = this.firstNonEmptyString(rec.name);
    if (!rawName) {
      return null;
    }

    const name = rawName.replace(/^\//, "");
    if (!name) {
      return null;
    }

    return {
      name,
      description: this.firstNonEmptyString(rec.description),
      agent: this.firstNonEmptyString(rec.agent),
      model: this.firstNonEmptyString(rec.model),
      template: this.firstNonEmptyString(rec.template),
      source: this.firstNonEmptyString(rec.source),
      subtask: typeof rec.subtask === "boolean" ? rec.subtask : undefined,
    };
  }

  /**
   * Get session settings map
   */
  getSessionSettingsMap(): Record<string, SessionSettings> {
    return this.globalState.get<Record<string, SessionSettings>>("sessionSettings") ?? {};
  }

  /**
   * Get session settings
   */
  getSessionSettings(sessionId: string): SessionSettings {
    return this.getSessionSettingsMap()[sessionId] ?? {};
  }

  /**
   * Persist session settings
   */
  async persistSessionSettings(
    sessionId: string,
    partial: Partial<SessionSettings>,
  ): Promise<void> {
    const map = this.getSessionSettingsMap();
    map[sessionId] = { ...map[sessionId], ...partial };
    await this.globalState.update("sessionSettings", map);
  }

  /**
   * Apply session settings
   */
  async applySessionSettings(sessionId: string): Promise<void> {
    const settings = this.getSessionSettings(sessionId);
    if (settings.agent) {
      this.selectedAgent = settings.agent;
      this.logger.debug("Restored agent for session", {
        sessionId,
        agent: settings.agent,
      });
    }
    const legacyProviderID = (settings as unknown as { providerID?: string }).providerID;
    const legacyModelID = (settings as unknown as { modelID?: string }).modelID;
    const modelToRestore =
      settings.model?.providerID && settings.model?.modelID
        ? settings.model
        : legacyProviderID && legacyModelID
          ? { providerID: legacyProviderID, modelID: legacyModelID }
          : undefined;

    if (modelToRestore?.providerID && modelToRestore?.modelID) {
      this.selectedModel = modelToRestore;
      this.logger.debug("Restored model for session", {
        sessionId,
        modelId: modelToRestore.modelID,
        providerId: modelToRestore.providerID,
      });
    }
  }

  /**
   * Migrate session settings
   */
  migrateSessionSettings(oldSessionId: string, newSessionId: string): void {
    if (!oldSessionId || !newSessionId || oldSessionId === newSessionId) {
      return;
    }
    const map = this.getSessionSettingsMap();
    const oldSettings = map[oldSessionId];
    if (!oldSettings) {
      return;
    }
    map[newSessionId] = { ...oldSettings, ...map[newSessionId] };
    void this.globalState.update("sessionSettings", map);
  }

  /**
   * Resolve prompt variant
   */
  async resolvePromptVariant(sessionId: string): Promise<string | undefined> {
    const savedLevel = this.getEffectiveThinkingLevel(sessionId);
    if (!savedLevel) return undefined;

    const normalizedLevel = savedLevel.toLowerCase().trim();
    if (!normalizedLevel) return undefined;

    const { providerID, modelID } = this.selectedModel;
    let variants = this.getAvailableVariants(providerID, modelID).map((v) =>
      v.toLowerCase().trim(),
    );
    if (variants.length === 0) {
      const capability = await this.modelCapabilitiesService.getCapabilities(
        providerID,
        modelID,
      );
      variants = Array.isArray(capability?.variants)
        ? capability.variants.map((v) => v.toLowerCase().trim())
        : [];
    }
    if (variants.length === 0 || !variants.includes(normalizedLevel)) return undefined;
    // "none" means no extra reasoning — omit the variant field entirely
    if (normalizedLevel === "none") return undefined;
    return normalizedLevel;
  }
}
