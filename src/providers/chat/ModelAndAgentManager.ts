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

const CACHED_MODEL_LIST_STATE_KEY = "cachedModelList";

export class ModelAndAgentManager {
  private selectedModel: { providerID: string; modelID: string; providerName?: string };
  private availableModels: ChatModelOption[] = [];
  private persistedModelList: ChatModelOption[] = [];
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
    this.persistedModelList = this.loadPersistedModelList();
    this.postMessage = () => { };
  }

  private postMessage: (msg: any) => void;

  setPostMessage(fn: (msg: any) => void): void {
    this.postMessage = fn;
  }

  private postErrorToast(message: string): void {
    const normalized = message.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return;
    }
    this.postMessage({
      type: "errorToast",
      message: normalized,
    });
  }

  private buildModelFetchToastMessage(
    error: unknown,
    diagnostics: Record<string, unknown>,
  ): string {
    const primary =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    const configProbe = this.asRecord(diagnostics.configProvidersProbe);
    const suffix: string[] = [];

    const serverStatus = this.firstNonEmptyString(diagnostics.serverStatus);
    if (serverStatus) {
      suffix.push(`server=${serverStatus}`);
    }

    const serverPort =
      typeof diagnostics.serverPort === "number" ? diagnostics.serverPort : null;
    if (serverPort && serverPort > 0) {
      suffix.push(`port=${serverPort}`);
    }

    const probeError = this.firstNonEmptyString(configProbe?.error);
    if (probeError) {
      suffix.push(`config.providers=${probeError}`);
    }

    return suffix.length > 0
      ? `Failed to fetch models: ${primary} (${suffix.join(", ")})`
      : `Failed to fetch models: ${primary}`;
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

  private normalizePersistedModelList(
    value: unknown,
  ): ChatModelOption[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const deduped = new Map<string, ChatModelOption>();
    for (const item of value) {
      const rec = this.asRecord(item);
      const providerID = this.firstNonEmptyString(rec?.providerID);
      const modelID = this.firstNonEmptyString(rec?.modelID);
      const providerName = this.firstNonEmptyString(rec?.providerName);
      const name = this.firstNonEmptyString(rec?.name);
      if (!providerID || !modelID || !providerName || !name) {
        continue;
      }

      const contextLimitRaw = rec?.contextLimit;
      const contextLimit =
        typeof contextLimitRaw === "number" &&
        Number.isFinite(contextLimitRaw) &&
        contextLimitRaw > 0
          ? Math.floor(contextLimitRaw)
          : undefined;
      const variants = Array.isArray(rec?.variants)
        ? rec.variants.filter((variant): variant is string => typeof variant === "string")
        : [];

      deduped.set(`${providerID}/${modelID}`.toLowerCase(), {
        providerID,
        modelID,
        providerName,
        name,
        contextLimit,
        reasoning: Boolean(rec?.reasoning),
        variants,
      });
    }

    return Array.from(deduped.values());
  }

  private loadPersistedModelList(): ChatModelOption[] {
    return this.normalizePersistedModelList(
      this.globalState.get(CACHED_MODEL_LIST_STATE_KEY, []),
    );
  }

  private async persistModelList(models: ChatModelOption[]): Promise<void> {
    const normalized = this.normalizePersistedModelList(models);
    this.persistedModelList = normalized;
    await this.globalState.update(CACHED_MODEL_LIST_STATE_KEY, normalized);
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

  private getProviderEntries(response: unknown): Array<Record<string, unknown>> {
    const responseRec = this.asRecord(response);
    const dataRec = this.asRecord(responseRec?.data);

    const candidateLists = [
      dataRec?.all,
      dataRec?.providers,
      responseRec?.all,
      responseRec?.providers,
    ];

    for (const candidate of candidateLists) {
      if (Array.isArray(candidate)) {
        return candidate
          .map((entry) => this.asRecord(entry))
          .filter((entry): entry is Record<string, unknown> => Boolean(entry));
      }
    }

    return [];
  }

  private getConnectedProviderIds(response: unknown): string[] {
    const responseRec = this.asRecord(response);
    const dataRec = this.asRecord(responseRec?.data);
    const candidates = [dataRec?.connected, responseRec?.connected];

    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }

      const ids = candidate
        .map((entry) => {
          if (typeof entry === "string") {
            return entry.trim();
          }
          const rec = this.asRecord(entry);
          return this.firstNonEmptyString(rec?.id, rec?.providerID);
        })
        .filter((value): value is string => Boolean(value));

      if (ids.length > 0) {
        return ids;
      }
    }

    return [];
  }

  private summarizeProviderResponse(response: unknown): Record<string, unknown> {
    const responseRec = this.asRecord(response);
    const dataRec = this.asRecord(responseRec?.data);
    const providerEntries = this.getProviderEntries(response);
    const connected = this.getConnectedProviderIds(response);
    const defaultRec =
      this.asRecord(dataRec?.default) ?? this.asRecord(responseRec?.default);

    return {
      topLevelKeys: responseRec ? Object.keys(responseRec) : [],
      dataKeys: dataRec ? Object.keys(dataRec) : [],
      providerCount: providerEntries.length,
      providerIds: providerEntries
        .map((provider) => this.firstNonEmptyString(provider.id, provider.name))
        .filter((value): value is string => Boolean(value))
        .slice(0, 20),
      modelCountsByProvider: providerEntries.reduce<Record<string, number>>((acc, provider) => {
        const providerId =
          this.firstNonEmptyString(provider.id, provider.name) || "unknown";
        const modelsRec = this.asRecord(provider.models);
        acc[providerId] = modelsRec ? Object.keys(modelsRec).length : 0;
        return acc;
      }, {}),
      connectedProviders: connected,
      defaultProviders: defaultRec ? Object.keys(defaultRec) : [],
    };
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`${label} timeout`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async collectModelFetchDiagnostics(
    client: any,
    error: unknown,
    startedAt: number,
  ): Promise<Record<string, unknown>> {
    const diagnostics: Record<string, unknown> = {
      elapsedMs: Date.now() - startedAt,
      serverStatus: this.serverManager.getStatus(),
      serverVersion: this.serverManager.getVersion(),
      serverPort: this.serverManager.getPort(),
      selectedModel: this.selectedModel,
      cachedModelCount: this.availableModels.length,
      errorMessage: error instanceof Error ? error.message : String(error),
    };

    try {
      const configResponse = await this.withTimeout(
        client.config.providers(),
        3000,
        "config.providers probe",
      );
      const configData = this.asRecord(this.asRecord(configResponse)?.data);
      const configProviders = Array.isArray(configData?.providers)
        ? configData.providers
        : [];
      diagnostics.configProvidersProbe = {
        ok: true,
        count: configProviders.length,
        providers: configProviders
          .map((provider) => {
            const rec = this.asRecord(provider);
            return this.firstNonEmptyString(rec?.id, rec?.providerID, rec?.name);
          })
          .filter((value): value is string => Boolean(value))
          .slice(0, 20),
      };
    } catch (probeError) {
      diagnostics.configProvidersProbe = {
        ok: false,
        error:
          probeError instanceof Error ? probeError.message : String(probeError),
      };
    }

    return diagnostics;
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
        const response = (await this.withTimeout(
          client.provider.list(),
          providerListTimeoutMs,
          "Provider list",
        )) as any;

        const responseSummary = this.summarizeProviderResponse(response);
        this.logger.debug("Provider list response summary", {
          correlationId,
          ...responseSummary,
        });

        const providerEntries = this.getProviderEntries(response);
        const models: ChatModelOption[] = [];
        const seenModelKeys = new Set<string>();
        const duplicateModelKeys: string[] = [];

        for (const provider of providerEntries) {
          const providerID = this.firstNonEmptyString(provider.id);
          if (!providerID) {
            this.logger.warn("Skipping provider entry without id", {
              correlationId,
              provider,
            });
            continue;
          }

          const providerName =
            this.firstNonEmptyString(provider.name, provider.id) || providerID;
          const providerModels = this.asRecord(provider.models);
          if (!providerModels) {
            this.logger.warn("Provider entry missing models map", {
              correlationId,
              providerID,
              providerName,
              providerKeys: Object.keys(provider),
            });
            continue;
          }

          for (const [modelID, modelConfig] of Object.entries(providerModels)) {
            const modelRec = this.asRecord(modelConfig);
            const modelKey = `${providerID}/${modelID}`;
            if (seenModelKeys.has(modelKey)) {
              duplicateModelKeys.push(modelKey);
              continue;
            }
            seenModelKeys.add(modelKey);

            const limitRec = this.asRecord(modelRec?.limit);
            const contextLimitRaw = limitRec?.context;
            const contextLimit =
              typeof contextLimitRaw === "number" &&
              Number.isFinite(contextLimitRaw) &&
              contextLimitRaw > 0
                ? Math.floor(contextLimitRaw)
                : undefined;
            const capabilitiesRec = this.asRecord(modelRec?.capabilities);
            const reasoning = Boolean(
              capabilitiesRec?.reasoning ?? modelRec?.reasoning,
            );
            const rawVariants = this.asRecord(modelRec?.variants);
            const variants = rawVariants
              ? Object.entries(rawVariants)
                  .filter(([, variantConfig]) => {
                    const rec = this.asRecord(variantConfig);
                    return rec?.disabled !== true;
                  })
                  .map(([name]) => name)
              : [];

            models.push({
              providerID,
              modelID,
              name: this.firstNonEmptyString(modelRec?.name) || modelID,
              providerName,
              contextLimit,
              reasoning,
              variants,
            });
            this.modelCapabilitiesService.rememberCapabilities(
              providerID,
              modelID,
              { reasoning, variants },
            );
          }
        }

        if (duplicateModelKeys.length > 0) {
          this.logger.warn("Deduplicated duplicate provider/model entries", {
            correlationId,
            duplicateCount: duplicateModelKeys.length,
            duplicates: duplicateModelKeys.slice(0, 20),
          });
        }

        if (models.length > 0) {
          this.logger.info("Discovered models across all providers", {
            count: models.length,
          });
          this.availableModels = models;
          await this.persistModelList(models);
          await this.resolveDefaultModel(models);

          // Fetch configured/connected providers
          let configuredProviders = this.getConnectedProviderIds(response);
          if (configuredProviders.length > 0) {
            this.logger.info("Using connected providers from provider.list response", {
              count: configuredProviders.length,
              providers: configuredProviders,
            });
          }
          try {
            if (configuredProviders.length === 0) {
              const configResponse = (await client.config.providers()) as any;
              const configProviders = Array.isArray(configResponse?.data?.providers)
                ? configResponse.data.providers
                : [];
              configuredProviders = configProviders
                .map((p: any) => this.firstNonEmptyString(p?.id, p?.providerID))
                .filter((id: any): id is string => typeof id === "string" && id.length > 0)
                .filter((id: string) => id.toLowerCase() !== "opencode");
              this.logger.info("Fetched configured providers", {
                count: configuredProviders.length,
                providers: configuredProviders,
              });
            }
          } catch (configError) {
            this.logger.warn("Failed to fetch configured providers", {
              error:
                configError instanceof Error
                  ? configError.message
                  : String(configError),
            });
          }

          this.postMessage({
            type: "modelsList",
            models,
            selectedModel: this.selectedModel,
            configuredProviders, // Send connected providers for badge filtering
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

        this.logger.warn("Provider list returned no usable models", {
          correlationId,
          selectedModel: this.selectedModel,
          ...responseSummary,
        });
      } catch (error) {
        this.modelsFetchPromise = null;
        let diagnostics: Record<string, unknown> = { correlationId };

        try {
          const client = this.serverManager.getClient();
          if (client) {
            diagnostics = {
              ...diagnostics,
              ...(await this.collectModelFetchDiagnostics(client as any, error, startTime)),
            };
          } else {
            diagnostics = {
              ...diagnostics,
              elapsedMs: Date.now() - startTime,
              serverStatus: this.serverManager.getStatus(),
              serverVersion: this.serverManager.getVersion(),
              serverPort: this.serverManager.getPort(),
              selectedModel: this.selectedModel,
              cachedModelCount: this.availableModels.length,
            };
          }
        } catch (diagnosticError) {
          diagnostics = {
            ...diagnostics,
            diagnosticCollectionError:
              diagnosticError instanceof Error
                ? diagnosticError.message
                : String(diagnosticError),
          };
        }

        this.logger.error(
          'Failed to fetch models',
          diagnostics,
          error as Error
        );
        this.postErrorToast(this.buildModelFetchToastMessage(error, diagnostics));

        this.logger.endFeatureFlow(correlationId, {
          success: false,
          error: String(error),
        });

        this.logger.error("Failed to get models", {}, error as Error);
      }

      const cachedModels = Array.isArray(this.availableModels) ? this.availableModels : [];
      const persistedModels = Array.isArray(this.persistedModelList)
        ? this.persistedModelList
        : [];
      const fallbackModels =
        cachedModels.length > 0
          ? cachedModels
          : persistedModels.length > 0
            ? persistedModels
            : this.getSelectedModelFallbackList();
      this.availableModels = fallbackModels;

      if (fallbackModels.length === 0) {
        this.logger.warn("No provider models discovered");
      } else {
        this.logger.warn("Using fallback models", {
          count: fallbackModels.length,
          source:
            cachedModels.length > 0
              ? "memory"
              : persistedModels.length > 0
                ? "persisted-cache"
                : "selected-model",
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
    if (settings.model?.providerID && settings.model?.modelID) {
      this.selectedModel = settings.model;
      this.logger.debug("Restored model for session", {
        sessionId,
        modelId: settings.model.modelID,
        providerId: settings.model.providerID,
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
