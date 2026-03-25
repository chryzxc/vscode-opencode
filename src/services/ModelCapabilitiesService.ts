import { createLogger } from "../utils/Logger";
const log = createLogger("ModelCapabilitiesService");

export interface ModelCapability {
  reasoning: boolean;
  variants?: string[];
  thinkingConfig?: Record<string, unknown> | null;
}

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;
const MODELS_DEV_URL = "https://models.dev/api.json";

export class ModelCapabilitiesService {
  // Static known mapping (checked before any network fetch)
  public static KNOWN_THINKING_MODELS: Record<string, ModelCapability> = {
    "anthropic/claude-sonnet-4-5-20250929": {
      reasoning: true,
      variants: ["high", "max"],
    },
    "anthropic/claude-opus-4-5-20251101": {
      reasoning: true,
      variants: ["high", "max"],
    },
    "anthropic/claude-3-7-sonnet-20250219": {
      reasoning: true,
      variants: ["low", "medium", "high", "max"],
    },
    "openai/o1": { reasoning: true, variants: ["low", "minimal", "high"] },
    "openai/o1-mini": { reasoning: true, variants: ["low", "minimal", "high"] },
    "openai/o3-mini": { reasoning: true, variants: ["low", "minimal", "high"] },
    "deepseek/deepseek-r1": {
      reasoning: true,
      variants: ["low", "medium", "high"],
    },
  };

  // Simple in-memory TTL cache for API-derived capabilities
  private apiCache: Map<string, { data: ModelCapability; timestamp: number }>; 

  constructor() {
    this.apiCache = new Map();
  }

  // Public API: get capabilities (static map first, then cache, then models.dev)
  public async getCapabilities(
    providerID: string,
    modelID: string,
  ): Promise<ModelCapability | null> {
    const key = `${providerID}/${modelID}`;

    // Static known models checked first
    const staticCap = ModelCapabilitiesService.KNOWN_THINKING_MODELS[key];
    if (staticCap) {
      return { ...staticCap };
    }

    // Check API cache
    const cached = this.apiCache.get(key);
    if (cached && Date.now() - cached.timestamp <= CACHE_TTL_MS) {
      return { ...cached.data };
    }

    // Fetch models.dev as fallback
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const resp = await fetch(MODELS_DEV_URL, { signal: controller.signal });
      clearTimeout(timeout);

      if (!resp.ok) {
        log.error("ModelCapabilitiesService: models.dev non-OK response", { status: resp.status });
        return null;
      }

      const json = await resp.json();

      // models.dev returns an array of model descriptors; iterate and try to match
      if (Array.isArray(json)) {
        for (const entry of json) {
          // Determine candidate id strings
          const maybeId = (entry && (entry.id || entry.modelId || entry.name)) as string | undefined;
          const candidate = maybeId ? maybeId.toLowerCase() : undefined;
          const normalizedKey = key.toLowerCase();

          if (candidate === normalizedKey || (entry.provider && `${entry.provider}/${entry.id}` === normalizedKey)) {
            const capability = this.parseEntryToCapability(entry);

            // Cache result for the exact key
            this.apiCache.set(key, { data: capability, timestamp: Date.now() });
            return capability;
          }
        }
      }

      // No match — store a negative cache entry to avoid refetch storms
      const negative: ModelCapability = { reasoning: false };
      this.apiCache.set(key, { data: negative, timestamp: Date.now() });
      return negative;
    } catch (err: unknown) {
      // On failure, log and return static result if available, otherwise null
      const errName = err instanceof Error ? err.name : String(err);
      const errMsg = err instanceof Error ? err.message : "";
      log.error("ModelCapabilitiesService: failed fetching models.dev", { errName, errMsg });
      // return cached static if any (we checked above), but to be safe return null
      return null;
    }
  }

  public async supportsReasoning(providerID: string, modelID: string): Promise<boolean> {
    const cap = await this.getCapabilities(providerID, modelID);
    return Boolean(cap && cap.reasoning);
  }

  public async getVariants(providerID: string, modelID: string): Promise<string[]> {
    const cap = await this.getCapabilities(providerID, modelID);
    return cap && Array.isArray(cap.variants) ? cap.variants : [];
  }

  private parseEntryToCapability(entry: unknown): ModelCapability {
    const e = entry as Record<string, unknown>;
    const tags: string[] = Array.isArray(e.tags) ? (e.tags as unknown[]).map(String) : [];

    const capabilities = e.capabilities as Record<string, unknown> | undefined;
    const reasoning =
      Boolean(capabilities?.reasoning) ||
      tags.some((t) => /reasoning|thinking|chain/.test(t.toLowerCase()));

    const variants: string[] = [];
    if (Array.isArray(e.variants)) {
      for (const v of e.variants as unknown[]) {
        if (typeof v === "string") variants.push(v);
        else if (v && typeof (v as Record<string, unknown>).name === "string") {
          variants.push((v as Record<string, unknown>).name as string);
        }
      }
    }
    // fallbacks
    if (variants.length === 0 && Array.isArray(e.configs)) {
      for (const c of e.configs as unknown[]) {
        if (c && typeof (c as Record<string, unknown>).name === "string") {
          variants.push((c as Record<string, unknown>).name as string);
        }
      }
    }

    const thinkingConfig = (e.thinkingConfig as Record<string, unknown> | null | undefined) ?? null;

    return { reasoning: Boolean(reasoning), variants, thinkingConfig };
  }
}

export default ModelCapabilitiesService;
