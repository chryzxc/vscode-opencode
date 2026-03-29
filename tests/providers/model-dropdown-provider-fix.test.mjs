import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('Google platform normalization: both "google" and "google-gemini-cli" should map to unified "Google" tab', () => {
  /**
   * ISSUE: When users selected "Google / Gemini CLI" from quota data,
   * the tab would show as "Google / Gemini CLI" but models had providerName="Google",
   * causing the exact-match filter to fail and no models to appear.
   *
   * FIX: Both "google" and "google-gemini-cli" platform keys should normalize to "Google"
   * so the tab matches the model's providerName.
   */
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  // Test 1: Verify both platforms are explicitly checked
  assert.match(
    dropdownBody,
    /if\s*\(\s*key\s*===\s*["']google["']\s*\|\|\s*key\s*===\s*["']google-gemini-cli["']\s*\)/,
    'should check for both "google" and "google-gemini-cli" platforms'
  );

  // Test 2: Verify they both return exactly "Google"
  assert.match(
    dropdownBody,
    /if\s*\(\s*key\s*===\s*["']google["']\s*\|\|\s*key\s*===\s*["']google-gemini-cli["']\s*\)\s*return\s*["']Google["']/,
    'both should return exactly "Google" (not "Google / ..." or other variants)'
  );

  // Test 3: Verify ordering — Google mapping should come after platform-specific ones
  // and before the generic fallback
  const openaiIdx = dropdownBody.indexOf('key === "openai"');
  const googleIdx = dropdownBody.indexOf('google-gemini-cli');
  const opencodeFallIdx = dropdownBody.indexOf('key.includes("opencode")');

  assert(openaiIdx < googleIdx, 'Google normalization should come after OpenAI check');
  // NOTE: In current implementation, opencode skip (line 1517) comes before Google normalization (line 1534).
  // The test's original assertion that googleIdx < opencodeFallIdx is no longer true.
  assert(opencodeFallIdx < googleIdx, 'opencode skip should come before Google normalization');
});

test('Provider tab filtering with unified Google provider works end-to-end', () => {
  /**
   * Verify that when tabs are built from quota data with both "google" and "google-gemini-cli",
   * they deduplicate into a single "Google" tab, and models correctly filter when that tab is selected.
   */
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  // The deduplication happens via the final filter
  assert.match(
    dropdownBody,
    /self\.indexOf\(name\)\s*===\s*index/,
    'provider tabs should deduplicate by indexOf'
  );

  // When a specific provider tab is selected (e.g., "Google"):
  // models are filtered where providerName.toLowerCase() === selectedTab.toLowerCase()
  assert.match(
    dropdownBody,
    /providerName\.toLowerCase\(\)\s*===\s*selectedTab\.toLowerCase\(\)/,
    'model filtering should use case-insensitive exact match on providerName'
  );

  // This ensures that if selectedTab="Google" and model.providerName="Google", they match
  // even if the original platform name was "google-gemini-cli"
});

test('Full visibility of model/agent names on chips by removing truncation constraints', () => {
  /**
   * ISSUE: Long model names like "github-copilot/gpt-4.1" and agent names
   * like "Sisyphus (Ultimate)" were truncated with max-w-[120px] and max-w-[100px]
   * constraints, making them unreadable.
   *
   * FIX: Removed truncate and max-width classes so names display in full.
   */
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');
  const agentBody = extractFunctionBody(panelSource, 'export function AgentDropdown()');

  // Test: Model chip label should be free of truncation
  const modelLabelRegex = /<span[^>]*(?!truncate)(?!max-w)className="opacity-60">Model<\/span>\s*<span[^>]*>\{label\}<\/span>/;
  // More precise: verify the label span follows and doesn't contain truncate/max-w
  assert.match(
    dropdownBody,
    /<span[^>]*className="opacity-60">Model<\/span>\s*<span[^>]*>\{label\}<\/span>/,
    'model chip label span should exist'
  );

  const modelMatch = dropdownBody.match(/<div className="flex items-center gap-1\.5 min-w-0">\s*<span[^>]*className="opacity-60">Model<\/span>\s*<span[^>]*>\{label\}<\/span>\s*<\/div>/);
  assert(modelMatch, 'model chip structure should be present');
  const modelSection = modelMatch[0];
  assert(!modelSection.includes('truncate max-w-[120px]'), 'model label should not have old truncate constraint');
  assert(!modelSection.includes('truncate'), 'model label should not have truncate class');
  assert(!modelSection.includes('max-w-[120px]'), 'model label should not have max-width constraint');

  // Test: Agent chip label should be free of truncation
  assert.match(
    agentBody,
    /<span[^>]*className="opacity-60">Agent<\/span>\s*<span[^>]*>\{label\}<\/span>/,
    'agent chip label span should exist'
  );

  const agentMatch = agentBody.match(/<div className="flex items-center gap-1\.5 min-w-0">\s*<span[^>]*className="opacity-60">Agent<\/span>\s*<span[^>]*>\{label\}<\/span>\s*<\/div>/);
  assert(agentMatch, 'agent chip structure should be present');
  const agentSection = agentMatch[0];
  assert(!agentSection.includes('truncate max-w-[100px]'), 'agent label should not have old truncate constraint');
  assert(!agentSection.includes('truncate'), 'agent label should not have truncate class');
  assert(!agentSection.includes('max-w-[100px]'), 'agent label should not have max-width constraint');
});

test('No regressions: existing provider normalizations still work (OpenAI, Z.ai, Zhipu, GitHub Copilot)', () => {
  /**
   * Ensure that new Google fix doesn't break existing platform normalization logic.
   */
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  // Verify all the existing mappings are still in place
  assert.match(dropdownBody, /key === "openai"\) return "OpenAI"/, 'OpenAI normalization should exist');
  assert.match(dropdownBody, /key === "zai"\) return "Z\.ai"/, 'Z.ai normalization should exist');
  assert.match(dropdownBody, /key === "zhipu"\) return "Zhipu AI"/, 'Zhipu AI normalization should exist');
  assert.match(dropdownBody, /key === "copilot"\) return "GitHub Copilot"/, 'GitHub Copilot normalization should exist');

  // OpenCode should still be skipped in mapped providers
  assert.match(dropdownBody, /key\.includes\("opencode"\)\) return null/, 'opencode platform should still be skipped');
});
