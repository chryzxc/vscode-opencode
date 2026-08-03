import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";
import type { McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk/v2";

const STORAGE_KEY = "opencode.managedMcpProfiles.v1";
const SECRET_PREFIX = "opencode.managedMcp.v1";
const MAX_TIMEOUT_MS = 10 * 60 * 1000;

export type ManagedMcpKind = "local" | "remote";

export interface ManagedMcpProfile {
  id: string;
  name: string;
  kind: ManagedMcpKind;
  createdAt: number;
  updatedAt: number;
  local?: { command: string[]; cwd?: string; environmentKeys: string[]; timeout?: number };
  remote?: { url: string; headerKeys: string[]; oauth?: { clientId?: string; scope?: string; callbackPort?: number; redirectUri?: string } | false; timeout?: number };
}

export type ManagedMcpDraft =
  | { name: string; kind: "local"; command: string[]; cwd?: string; environment: Record<string, string>; timeout?: number }
  | { name: string; kind: "remote"; url: string; headers: Record<string, string>; oauth?: { clientId?: string; clientSecret?: string; scope?: string; callbackPort?: number; redirectUri?: string } | false; timeout?: number };

export type McpClient = {
  mcp: {
    status(parameters?: { directory?: string }): Promise<{ data?: Record<string, unknown> }>;
    add(parameters: { name: string; config: McpLocalConfig | McpRemoteConfig; directory?: string }): Promise<unknown>;
    connect(parameters: { name: string; directory?: string }): Promise<unknown>;
    disconnect(parameters: { name: string; directory?: string }): Promise<unknown>;
  };
};

export class McpServerService {
  private readonly rehydratedClients = new WeakSet<object>();
  private readonly mutationChains = new Map<string, Promise<unknown>>();
  private readonly removedNames = new Set<string>();

  public constructor(
    private readonly context: Pick<vscode.ExtensionContext, "workspaceState" | "secrets">,
    private readonly getWorkspaceDirectory: () => string | undefined,
    private readonly getClient: () => Promise<McpClient>,
    private readonly log: { info(message: string, data?: Record<string, unknown>): void; warn(message: string, data?: Record<string, unknown>): void },
  ) {}

  public profiles(): ManagedMcpProfile[] {
    return this.readProfiles().sort((a, b) => a.createdAt - b.createdAt);
  }

  public profileForName(name: string): ManagedMcpProfile | undefined {
    return this.profiles().find((profile) => profile.name === name);
  }

  public async add(draft: ManagedMcpDraft): Promise<void> {
    if (!this.getWorkspaceDirectory()) throw new Error("Open a file-based workspace before adding an extension-managed MCP server.");
    const profile = this.validateAndCreateProfile(draft);
    const existing = this.profiles().some((item) => item.name.toLowerCase() === profile.name.toLowerCase());
    if (existing) throw new Error(`An MCP server named "${profile.name}" is already managed.`);

    await this.withServerLock(profile.name, async () => {
      await this.context.workspaceState.update(STORAGE_KEY, [...this.profiles(), profile]);
      try {
        await this.writeSecrets(profile.id, draft);
        const client = await this.getClient();
        await this.addToClient(client, profile, draft);
        this.removedNames.delete(profile.name);
      } catch (error) {
        await this.removeProfileData(profile);
        throw error;
      }
    });
  }

  public async connect(name: string): Promise<void> {
    if (!this.profileForName(name)) throw new Error("That MCP server is not managed by this extension.");
    await this.withServerLock(name, async () => {
      await (await this.getClient()).mcp.connect(this.scope({ name }));
    });
  }

  public async disconnect(name: string): Promise<void> {
    if (!this.profileForName(name)) throw new Error("That MCP server is not managed by this extension.");
    await this.withServerLock(name, async () => {
      await (await this.getClient()).mcp.disconnect(this.scope({ name }));
    });
  }

  public async remove(name: string, profileId?: string): Promise<void> {
    const profile = this.profiles().find((item) => profileId ? item.id === profileId : item.name === name);
    if (!profile) throw new Error("That MCP server is not managed by this extension.");
    await this.withServerLock(name, async () => {
      try { await (await this.getClient()).mcp.disconnect(this.scope({ name })); } catch (error) {
        this.log.warn("MCP disconnect before removal failed", { name, error: this.safeError(error) });
      }
      await this.removeProfileData(profile);
      this.removedNames.add(profile.name);
    });
  }

  public wasRemoved(name: string): boolean {
    return this.removedNames.has(name);
  }

  public async rehydrate(client: McpClient): Promise<void> {
    if (!this.getWorkspaceDirectory() || this.rehydratedClients.has(client as object)) return;
    this.rehydratedClients.add(client as object);
    for (const profile of this.profiles()) {
      try {
        const draft = await this.draftFromProfile(profile);
        await this.addToClient(client, profile, draft);
      } catch (error) {
        this.log.warn("Failed to rehydrate managed MCP server", { name: profile.name, error: this.safeError(error) });
      }
    }
  }

  public async status(client: McpClient): Promise<Record<string, unknown>> {
    await this.rehydrate(client);
    const managedNames = this.profiles().map((profile) => profile.name);
    let servers: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await client.mcp.status(this.scope());
      servers = response.data ?? {};
      const allManagedVisible = managedNames.every((name) => Object.prototype.hasOwnProperty.call(servers, name));
      if (allManagedVisible || attempt === 2) return servers;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return servers;
  }

  private async addToClient(client: McpClient, profile: ManagedMcpProfile, draft: ManagedMcpDraft): Promise<void> {
    await client.mcp.add({ ...this.scope({ name: profile.name }), config: await this.toSdkConfig(profile, draft) });
  }

  private async toSdkConfig(profile: ManagedMcpProfile, draft: ManagedMcpDraft): Promise<McpLocalConfig | McpRemoteConfig> {
    if (draft.kind === "local") {
      return { type: "local", command: draft.command, cwd: draft.cwd, environment: draft.environment, timeout: draft.timeout };
    }
    const oauth = draft.oauth
      ? { clientId: draft.oauth.clientId, clientSecret: draft.oauth.clientSecret, scope: draft.oauth.scope, callbackPort: draft.oauth.callbackPort, redirectUri: draft.oauth.redirectUri }
      : draft.oauth;
    return { type: "remote", url: draft.url, headers: draft.headers, oauth, timeout: draft.timeout };
  }

  private validateAndCreateProfile(draft: ManagedMcpDraft): ManagedMcpProfile {
    const name = draft.name.trim();
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(name)) throw new Error("MCP server names must start with a letter and contain only letters, numbers, '.', '_' or '-'.");
    if (draft.kind === "local") {
      if (!draft.command.length || draft.command.some((item) => typeof item !== "string" || !item.trim())) throw new Error("Local MCP command must contain an executable and non-empty arguments.");
      if (draft.cwd && (!path.isAbsolute(draft.cwd) || !fs.existsSync(draft.cwd) || !fs.statSync(draft.cwd).isDirectory())) throw new Error("Local MCP working directory must be an existing absolute directory.");
      this.validateRows(draft.environment, "environment");
    } else {
      let url: URL;
      try { url = new URL(draft.url); } catch { throw new Error("Remote MCP URL must be a valid absolute HTTPS URL."); }
      if (url.protocol !== "https:") throw new Error("Remote MCP URL must use HTTPS.");
      this.validateRows(draft.headers, "header");
      if (draft.oauth && draft.oauth.callbackPort !== undefined && (!Number.isInteger(draft.oauth.callbackPort) || draft.oauth.callbackPort < 1 || draft.oauth.callbackPort > 65535)) throw new Error("OAuth callback port must be between 1 and 65535.");
    }
    if (draft.timeout !== undefined && (!Number.isInteger(draft.timeout) || draft.timeout < 1 || draft.timeout > MAX_TIMEOUT_MS)) throw new Error(`Timeout must be a positive integer no greater than ${MAX_TIMEOUT_MS} milliseconds.`);
    const now = Date.now();
    return draft.kind === "local"
      ? { id: crypto.randomUUID(), name, kind: "local", createdAt: now, updatedAt: now, local: { command: draft.command, cwd: draft.cwd, environmentKeys: Object.keys(draft.environment), timeout: draft.timeout } }
      : { id: crypto.randomUUID(), name, kind: "remote", createdAt: now, updatedAt: now, remote: { url: draft.url, headerKeys: Object.keys(draft.headers), oauth: draft.oauth === false ? false : draft.oauth ? { clientId: draft.oauth.clientId, scope: draft.oauth.scope, callbackPort: draft.oauth.callbackPort, redirectUri: draft.oauth.redirectUri } : undefined, timeout: draft.timeout } };
  }

  private validateRows(rows: Record<string, string>, label: string): void {
    const keys = Object.keys(rows);
    if (keys.some((key) => !key.trim()) || new Set(keys.map((key) => key.toLowerCase())).size !== keys.length || Object.values(rows).some((value) => typeof value !== "string")) throw new Error(`${label} names must be non-empty, unique case-insensitively, and values must be strings.`);
  }

  private async writeSecrets(id: string, draft: ManagedMcpDraft): Promise<void> {
    const values = draft.kind === "local" ? draft.environment : draft.headers;
    await Promise.all(Object.entries(values).map(([key, value]) => this.context.secrets.store(this.secretKey(id, draft.kind === "local" ? "environment" : "header", key), value)));
    if (draft.kind === "remote" && draft.oauth && draft.oauth.clientSecret) await this.context.secrets.store(this.secretKey(id, "oauth", "clientSecret"), draft.oauth.clientSecret);
  }

  private async draftFromProfile(profile: ManagedMcpProfile): Promise<ManagedMcpDraft> {
    if (profile.kind === "local" && profile.local) return { name: profile.name, kind: "local", command: profile.local.command, cwd: profile.local.cwd, timeout: profile.local.timeout, environment: await this.readSecrets(profile.id, "environment", profile.local.environmentKeys) };
    if (profile.remote) return { name: profile.name, kind: "remote", url: profile.remote.url, timeout: profile.remote.timeout, headers: await this.readSecrets(profile.id, "header", profile.remote.headerKeys), oauth: profile.remote.oauth ? { ...profile.remote.oauth, clientSecret: await this.context.secrets.get(this.secretKey(profile.id, "oauth", "clientSecret")) } : profile.remote.oauth };
    throw new Error("Managed MCP profile is incomplete.");
  }

  private async readSecrets(id: string, kind: string, keys: string[]): Promise<Record<string, string>> {
    const entries = await Promise.all(keys.map(async (key) => [key, await this.context.secrets.get(this.secretKey(id, kind, key)) ?? ""] as const));
    return Object.fromEntries(entries);
  }

  private readProfiles(): ManagedMcpProfile[] { return this.context.workspaceState.get<ManagedMcpProfile[]>(STORAGE_KEY) ?? []; }
  private async removeProfileData(profile: ManagedMcpProfile): Promise<void> {
    await this.context.workspaceState.update(STORAGE_KEY, this.profiles().filter((item) => item.id !== profile.id));
    const keys = [...(profile.local?.environmentKeys ?? []).map((key) => this.secretKey(profile.id, "environment", key)), ...(profile.remote?.headerKeys ?? []).map((key) => this.secretKey(profile.id, "header", key)), this.secretKey(profile.id, "oauth", "clientSecret")];
    await Promise.all(keys.map((key) => this.context.secrets.delete(key)));
  }
  private secretKey(id: string, kind: string, key: string): string { return `${SECRET_PREFIX}.${id}.${kind}.${key}`; }
  private scope<T extends Record<string, unknown>>(extra?: T): T & { directory?: string } { return { ...(extra ?? {}), directory: this.getWorkspaceDirectory() } as T & { directory?: string }; }
  private safeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : "MCP operation failed"; }
  private async withServerLock<T>(name: string, operation: () => Promise<T>): Promise<T> { const previous = this.mutationChains.get(name) ?? Promise.resolve(); const current = previous.then(operation, operation); this.mutationChains.set(name, current); try { return await current; } finally { if (this.mutationChains.get(name) === current) this.mutationChains.delete(name); } }
}
