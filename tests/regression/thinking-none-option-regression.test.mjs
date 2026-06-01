import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const capabilitiesSource = readSource(
  [joinFromRoot("src", "services", "ModelCapabilitiesService.ts")],
  "ModelCapabilitiesService.ts",
);

const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

const managerSource = readSource(
  [joinFromRoot("src", "providers", "chat", "ModelAndAgentManager.ts")],
  "ModelAndAgentManager.ts",
);

// ---------------------------------------------------------------------------
// ModelCapabilitiesService — "none" in KNOWN_THINKING_MODELS
// ---------------------------------------------------------------------------

test("every known thinking model includes 'none' as the first variant", () => {
  // Each entry in KNOWN_THINKING_MODELS should start its variants array with "none"
  const modelEntries = capabilitiesSource.match(
    /variants:\s*\[([^\]]+)\]/g,
  );
  assert.ok(modelEntries, "KNOWN_THINKING_MODELS should contain variant arrays");
  assert.ok(modelEntries.length >= 7, "should define at least 7 model entries");

  for (const entry of modelEntries) {
    // Extract the first quoted string in the variants array
    const firstVariant = entry.match(/\[\s*"([^"]+)"/);
    assert.ok(firstVariant, `every model variant array should contain quoted strings, found: ${entry}`);
    assert.strictEqual(
      firstVariant[1],
      "none",
      `first variant should be "none", found "${firstVariant[1]}" in: ${entry.slice(0, 60)}`,
    );
  }
});

test("known thinking models retain reasoning: true", () => {
  // All entries must still have reasoning enabled
  assert.match(
    capabilitiesSource,
    /"anthropic\/claude-sonnet-4-5-20250929":\s*\{[\s\S]*?reasoning:\s*true[\s\S]*?\}/,
    "claude-sonnet-4-5 should have reasoning: true",
  );
  assert.match(
    capabilitiesSource,
    /"anthropic\/claude-opus-4-5-20251101":\s*\{[\s\S]*?reasoning:\s*true[\s\S]*?\}/,
    "claude-opus-4-5 should have reasoning: true",
  );
  assert.match(
    capabilitiesSource,
    /"anthropic\/claude-3-7-sonnet-20250219":\s*\{[\s\S]*?reasoning:\s*true[\s\S]*?\}/,
    "claude-3-7-sonnet should have reasoning: true",
  );
  assert.match(
    capabilitiesSource,
    /"openai\/o1":\s*\{[\s\S]*?reasoning:\s*true[\s\S]*?\}/,
    "openai/o1 should have reasoning: true",
  );
  assert.match(
    capabilitiesSource,
    /"openai\/o1-mini":\s*\{[\s\S]*?reasoning:\s*true[\s\S]*?\}/,
    "openai/o1-mini should have reasoning: true",
  );
  assert.match(
    capabilitiesSource,
    /"openai\/o3-mini":\s*\{[\s\S]*?reasoning:\s*true[\s\S]*?\}/,
    "openai/o3-mini should have reasoning: true",
  );
  assert.match(
    capabilitiesSource,
    /"deepseek\/deepseek-r1":\s*\{[\s\S]*?reasoning:\s*true[\s\S]*?\}/,
    "deepseek/deepseek-r1 should have reasoning: true",
  );
});

// ---------------------------------------------------------------------------
// ChatViewProvider — resolveCapabilityForModel always includes "none"
// ---------------------------------------------------------------------------

test("resolveCapabilityForModel always prepends 'none' when reasoning is true and variants exist", () => {
  // The return statement should conditionally include "none" when variants exist
  assert.match(
    providerSource,
    /variants\.includes\("none"\)\s*\?\s*variants\s*:\s*\["none",\s*\.\.\.variants\]/,
    "resolveCapabilityForModel should prepend 'none' to variants when not already present",
  );

  // The reasoning flag should still be correct
  assert.match(
    providerSource,
    /reasoning,\s*\n\s*variants:\s*variants\.length\s*>\s*0[\s\S]*includes\("none"\)/,
    "return value should include reasoning flag and variants with 'none'",
  );
});

// ---------------------------------------------------------------------------
// ChatViewProvider — prompt body strips thinking when "none" selected
// ---------------------------------------------------------------------------

test("prompt construction sets variant: null and disables structured output when thinking is 'none' and model supports reasoning", () => {
  assert.match(
    providerSource,
    /const thinkingLevel = this\.modelAndAgentManager\.getEffectiveThinkingLevel\(session\.id\);/,
    "prompt construction should read thinkingLevel",
  );

  // Structured output should only disable when "none" AND model supports reasoning
  assert.match(
    providerSource,
    /const disableThinkingStructuredOutput = thinkingLevel === "none" && modelReasoning;/,
    "structured output should only be disabled when thinking is 'none' AND model supports reasoning",
  );

  assert.match(
    providerSource,
    /!disableThinkingStructuredOutput/,
    "useStructuredOutput should use disableThinkingStructuredOutput guard",
  );

  // When thinkingLevel is "none", variant should be set to null
  assert.match(
    providerSource,
    /if \(thinkingLevel === "none"\) \{[\s\S]*variant = null/,
    "variant should be explicitly set to null when thinkingLevel is 'none'",
  );
});

// ---------------------------------------------------------------------------
// ModelAndAgentManager — resolvePromptVariant returns undefined for "none"
// ---------------------------------------------------------------------------

test("resolvePromptVariant returns undefined for 'none' so no variant is sent in the prompt", () => {
  assert.match(
    managerSource,
    /normalizedLevel === "none"/,
    "resolvePromptVariant should check for 'none' level",
  );

  assert.match(
    managerSource,
    /if \(normalizedLevel === "none"\) return undefined;/,
    "resolvePromptVariant should return undefined for 'none' preventing the variant field from being set",
  );

  // Also verify the upstream guard still exists
  assert.match(
    managerSource,
    /if \(variants\.length === 0 \|\| !variants\.includes\(normalizedLevel\)\) return undefined;/,
    "resolvePromptVariant should still guard against unsupported variants",
  );
});
