import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts')],
  'ModelAndAgentManager.ts',
);

test('model and agent accessors preserve in-memory selections and persist selected model', () => {
  const setSelectedModelBody = extractFunctionBody(
    source,
    'async setSelectedModel(model: { providerID: string; modelID: string; providerName?: string }): Promise<void> {',
  );

  assert.match(source, /getSelectedModel\(\): \{ providerID: string; modelID: string; providerName\?: string \}\s*\{\s*return this\.selectedModel;/, 'getSelectedModel should return the stored selected model');
  assert.match(setSelectedModelBody, /this\.selectedModel = model;/, 'setSelectedModel should update the in-memory selection');
  assert.match(setSelectedModelBody, /await this\.globalState\.update\("selectedModel", model\);/, 'setSelectedModel should persist the selected model to globalState');
  assert.match(source, /setSelectedAgent\(agent: string \| undefined\): void\s*\{\s*this\.selectedAgent = agent;/, 'setSelectedAgent should store the selected agent');
  assert.match(source, /getAvailableModels\(\): ChatModelOption\[\]\s*\{\s*return this\.availableModels;/, 'getAvailableModels should expose the cached model list');
});

test('handleGetModels uses single-flight fetch, provider timeout, and fallback model publication', () => {
  const handleGetModelsBody = extractFunctionBody(
    source,
    'async handleGetModels(): Promise<ChatModelOption[]> {',
  );

  assert.match(handleGetModelsBody, /if \(this\.modelsFetchPromise\) \{[\s\S]*return this\.modelsFetchPromise;/, 'handleGetModels should reuse an in-flight fetch promise');
  assert.match(handleGetModelsBody, /const providerListTimeoutMs = 8000;/, 'handleGetModels should enforce an 8 second provider list timeout');
  assert.match(handleGetModelsBody, /Promise\.race\(\[[\s\S]*client\.provider\.list\(\),[\s\S]*timeoutPromise,[\s\S]*\]\)/, 'handleGetModels should race provider listing against the timeout promise');
  assert.match(handleGetModelsBody, /const fallbackModels = cachedModels\.length > 0 \? cachedModels : this\.getSelectedModelFallbackList\(\);/, 'handleGetModels should fall back to cached or selected-model-derived options');
  assert.match(handleGetModelsBody, /this\.postMessage\(\{[\s\S]*type: "modelsList",[\s\S]*models: fallbackModels,[\s\S]*selectedModel: this\.selectedModel,[\s\S]*\}\);/, 'handleGetModels should publish fallback model state to the webview');
});

test('default model resolution shells out to CLI config and reconciliation upgrades legacy selections', () => {
  const resolveDefaultModelBody = extractFunctionBody(
    source,
    'async resolveDefaultModel(models: ChatModelOption[]): Promise<void> {',
  );
  const reconcileBody = extractFunctionBody(
    source,
    'async reconcileSelectedModelSelection(models: ChatModelOption[]): Promise<void> {',
  );

  assert.match(resolveDefaultModelBody, /await execAsync\("opencode config get default_model"\);/, 'resolveDefaultModel should read the CLI default_model value');
  assert.match(resolveDefaultModelBody, /const providerModelMatch = defaultId\.match\(/, 'resolveDefaultModel should parse provider-qualified CLI defaults');
  assert.match(resolveDefaultModelBody, /\^\(\[\^\/:\\s\]\+\)\[\/:\]\(\.\+\)\$/, 'resolveDefaultModel should support provider\/model and provider:model formats');
  assert.match(resolveDefaultModelBody, /await this\.globalState\.update\("selectedModel", this\.selectedModel\);/, 'resolveDefaultModel should persist the reconciled default selection');
  assert.match(reconcileBody, /const isLegacyGenericProvider =[\s\S]*this\.selectedModel\.providerID === "opencode";/, 'reconcileSelectedModelSelection should detect legacy generic provider selections');
  assert.match(reconcileBody, /const candidates = models\.filter\(\(m\) => m\.modelID === this\.selectedModel\.modelID\);/, 'reconcileSelectedModelSelection should search by modelID when upgrading legacy selections');
  assert.match(reconcileBody, /if \(candidates\.length === 1\) \{[\s\S]*await this\.globalState\.update\("selectedModel", this\.selectedModel\);/, 'reconcileSelectedModelSelection should persist an unambiguous provider upgrade');
});

test('agent and slash-command discovery keep built-ins, use caching, and normalize command names', () => {
  const handleGetAgentsBody = extractFunctionBody(
    source,
    'async handleGetAgents(): Promise<void> {',
  );
  const loadCommandCatalogBody = extractFunctionBody(
    source,
    'async loadCommandCatalog(forceRefresh = false): Promise<ChatSlashCommand[]> {',
  );
  const normalizeSlashCommandBody = extractFunctionBody(
    source,
    'normalizeSlashCommand(item: SdkCommand | unknown): ChatSlashCommand | null {',
  );

  assert.match(handleGetAgentsBody, /const HIDDEN_SYSTEM_AGENTS = new Set\(\["compaction", "title", "summary"\]\);/, 'handleGetAgents should suppress hidden system agents');
  assert.match(handleGetAgentsBody, /id: "build"[\s\S]*id: "plan"/, 'handleGetAgents should guarantee build and plan built-ins');
  assert.match(handleGetAgentsBody, /typeof \(client as any\)\.app\?\.agents !== 'function'/, 'handleGetAgents should fall back when the SDK lacks app.agents');
  assert.match(loadCommandCatalogBody, /Date\.now\(\) - this\.commandCatalogFetchedAt < this\.COMMAND_CATALOG_TTL_MS/, 'loadCommandCatalog should use a TTL-based cache freshness check');
  assert.match(loadCommandCatalogBody, /if \(this\.commandCatalogFetchPromise\) \{[\s\S]*return this\.commandCatalogFetchPromise;/, 'loadCommandCatalog should use a single-flight fetch promise');
  assert.match(normalizeSlashCommandBody, /const name = rawName\.replace\(\/\^\\\/\/, ""\);/, 'normalizeSlashCommand should strip a leading slash from command names');
  assert.match(normalizeSlashCommandBody, /subtask: typeof rec\.subtask === "boolean" \? rec\.subtask : undefined,/, 'normalizeSlashCommand should preserve boolean subtask flags only');
  assert.doesNotMatch(normalizeSlashCommandBody, /name:\s*rawName/, 'normalizeSlashCommand should not return the unnormalized raw slash name');
});

test('session settings persistence and prompt variant resolution remain session-scoped', () => {
  const persistSettingsBody = extractFunctionBody(
    source,
    'async persistSessionSettings(\n    sessionId: string,\n    partial: Partial<SessionSettings>,\n  ): Promise<void> {',
  );
  const applySessionSettingsBody = extractFunctionBody(
    source,
    'async applySessionSettings(sessionId: string): Promise<void> {',
  );
  const migrateSessionSettingsBody = extractFunctionBody(
    source,
    'migrateSessionSettings(oldSessionId: string, newSessionId: string): void {',
  );
  const resolvePromptVariantBody = extractFunctionBody(
    source,
    'async resolvePromptVariant(sessionId: string): Promise<string | undefined> {',
  );

  assert.match(source, /getSessionSettingsMap\(\): Record<string, SessionSettings> \{\s*return this\.globalState\.get<Record<string, SessionSettings>>\("sessionSettings"\) \?\? \{\};/, 'getSessionSettingsMap should default to an empty persisted settings map');
  assert.match(source, /getSessionSettings\(sessionId: string\): SessionSettings \{\s*return this\.getSessionSettingsMap\(\)\[sessionId\] \?\? \{\};/, 'getSessionSettings should scope settings to the requested session');
  assert.match(persistSettingsBody, /map\[sessionId\] = \{ \.\.\.map\[sessionId\], \.\.\.partial \};/, 'persistSessionSettings should merge partial updates into the session entry');
  assert.match(applySessionSettingsBody, /if \(settings\.agent\) \{[\s\S]*this\.selectedAgent = settings\.agent;/, 'applySessionSettings should restore per-session agent selection');
  assert.match(applySessionSettingsBody, /if \(settings\.model\?\.providerID && settings\.model\?\.modelID\) \{[\s\S]*this\.selectedModel = settings\.model;/, 'applySessionSettings should restore per-session model selection');
  assert.match(migrateSessionSettingsBody, /map\[newSessionId\] = \{ \.\.\.oldSettings, \.\.\.map\[newSessionId\] \};/, 'migrateSessionSettings should carry settings forward to the new session id');
  assert.match(resolvePromptVariantBody, /this\.getEffectiveThinkingLevel\(sessionId\)/, 'resolvePromptVariant should derive the level from effective per-model preferences');
  assert.match(resolvePromptVariantBody, /if \(variants\.length === 0 \|\| !variants\.includes\(normalizedLevel\)\) return undefined;/, 'resolvePromptVariant should only return variants supported by the selected model');
});
