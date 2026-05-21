/**
 * ModelCapabilitiesService Regression Tests
 *
 * These tests prevent regressions in model capability detection functionality.
 * Model capabilities are critical for reasoning mode and variant selection.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const modelCapabilitiesSource = readSource(
  [joinFromRoot('src', 'services', 'ModelCapabilitiesService.ts')],
  'ModelCapabilitiesService.ts',
);

test.describe.skip('ModelCapabilitiesService - Static Capability Cache', () => {

  test.skip('has static mapping for known thinking models', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /KNOWN_THINKING_MODELS.*Record<string.*ModelCapability>/s,
      'must define static mapping of known thinking models'
    );
  });

  test.skip('includes Claude models in static cache', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /claude-sonnet-4-5|claude-opus-4-5|claude-3-7-sonnet/s,
      'must include Claude models in known models cache'
    );
  });

  test.skip('includes OpenAI reasoning models in static cache', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /openai\/o1|openai\/o1-mini|openai\/o3-mini/s,
      'must include OpenAI reasoning models in known models cache'
    );
  });

  test.skip('includes DeepSeek reasoning models in static cache', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /deepseek\/deepseek-r1/s,
      'must include DeepSeek reasoning models'
    );
  });

  test.skip('static models have reasoning flag', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /KNOWN_THINKING_MODELS[\s\S]*reasoning:\s*true/s,
      'must mark known models with reasoning capability'
    );
  });

  test.skip('static models include variants', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /KNOWN_THINKING_MODELS[\s\S]*variants:.*\[.*\]/s,
      'must define variants for reasoning models'
    );
  });

});

test.describe.skip('ModelCapabilitiesService - API Cache', () => {

  test.skip('has in-memory TTL cache', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /apiCache.*Map<string.*\{.*data.*timestamp.*\}>/s,
      'must maintain in-memory cache with timestamps'
    );
  });

  test.skip('cache has TTL expiration', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /CACHE_TTL_MS.*60_000|Date\.now\(\).*timestamp.*CACHE_TTL_MS/s,
      'must implement 60-second cache TTL'
    );
  });

  test.skip('checks cache before network fetch', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /getCapabilities[\s\S]*apiCache\.get|cached.*timestamp/s,
      'must check API cache before fetching from network'
    );
  });

  test.skip('returns cached data if valid', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /cached.*Date\.now\(\).*timestamp.*<=.*CACHE_TTL_MS.*return.*\{.*cached\.data/s,
      'must return cached data if not expired'
    );
  });

  test.skip('caches fetched capabilities', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /apiCache\.set\(key.*data:\s*capability.*timestamp:\s*Date\.now\(\)/s,
      'must store fetched capabilities in cache'
    );
  });

  test.skip('caches negative results', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /No match.*negative.*reasoning:\s*false.*apiCache\.set/s,
      'must cache negative results to prevent refetch storms'
    );
  });

});

test.describe.skip('ModelCapabilitiesService - Capability Resolution', () => {

  test.skip('checks static cache first', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /getCapabilities[\s\S]*staticCap.*KNOWN_THINKING_MODELS\[key\]/s,
      'must check static known models before any other lookup'
    );
  });

  test.skip('returns static capability if found', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /staticCap.*return.*\{.*\.\.\.staticCap/s,
      'must return static capability immediately if found'
    );
  });

  test.skip('falls back to API cache', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /apiCache\.get\(key\)/s,
      'must fall back to API cache if not in static cache'
    );
  });

  test.skip('falls back to models.dev API', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /fetch.*MODELS_DEV_URL|models\.dev|fetch.*api\.json/s,
      'must fetch from models.dev API as final fallback'
    );
  });

});

test.describe.skip('ModelCapabilitiesService - Network Fetching', () => {

  test.skip('has fetch timeout', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /FETCH_TIMEOUT_MS.*5_000|AbortController.*setTimeout.*controller\.abort/s,
      'must implement 5-second fetch timeout'
    );
  });

  test.skip('handles fetch errors gracefully', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /catch.*err.*log\.error.*return\s+null/s,
      'must log fetch errors and return null on failure'
    );
  });

  test.skip('handles non-OK responses', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /resp\.ok.*log\.error.*models\.dev non-OK.*return\s+null/s,
      'must handle non-OK HTTP responses'
    );
  });

  test.skip('parses JSON response', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /await resp\.json\(\)|Array\.isArray\(json\)/s,
      'must parse JSON response from models.dev'
    );
  });

  test.skip('matches model by provider/id format', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /entry\.provider.*entry\.id.*normalizedKey|candidate.*===.*normalizedKey/s,
      'must match models by provider/id format'
    );
  });

});

test.describe.skip('ModelCapabilitiesService - Variant Parsing', () => {

  test.skip('extracts variants from entry.variants array', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /Array\.isArray\(e\.variants\).*for.*const v.*variants/s,
      'must extract variants from variants array'
    );
  });

  test.skip('handles string variants', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /typeof v === "string".*variants\.push\(v\)/s,
      'must handle string variant entries'
    );
  });

  test.skip('handles object variants with name property', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /typeof v === 'object'.*name.*variants\.push/s,
      'must handle object variant entries with name property'
    );
  });

  test.skip('falls back to configs array', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /variants\.length === 0.*Array\.isArray\(e\.configs\)/s,
      'must fall back to configs array if variants empty'
    );
  });

});

test.describe.skip('ModelCapabilitiesService - Reasoning Detection', () => {

  test.skip('detects reasoning from capabilities.reasoning flag', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /capabilities\?\.reasoning/s,
      'must detect reasoning from capabilities.reasoning flag'
    );
  });

  test.skip('detects reasoning from tags', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /tags\.some.*reasoning|thinking|chain/s,
      'must detect reasoning from tags'
    );
  });

  test.skip('supportsReasoning returns boolean', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /supportsReasoning.*async.*getCapabilities.*Boolean\(cap.*cap\.reasoning\)/s,
      'must return boolean for reasoning support'
    );
  });

});

test.describe.skip('ModelCapabilitiesService - Public API', () => {

  test.skip('provides getCapabilities method', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /getCapabilities.*async.*providerID.*modelID.*Promise<ModelCapability/s,
      'must provide getCapabilities method returning capabilities'
    );
  });

  test.skip('provides supportsReasoning method', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /supportsReasoning.*async.*providerID.*modelID.*Promise<boolean>/s,
      'must provide supportsReasoning convenience method'
    );
  });

  test.skip('provides getVariants method', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /getVariants.*async.*providerID.*modelID.*Promise<string\[\]>/s,
      'must provide getVariants method returning variant array'
    );
  });

  test.skip('clones cached data before returning', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /return.*\{.*\.\.\.staticCap\s*\}|return.*\{.*\.\.\.cached\.data\s*\}/s,
      'must clone cached data to prevent mutation'
    );
  });

});

test.describe.skip('ModelCapabilitiesService - Logging', () => {

  test.skip('logs fetch errors', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /log\.error.*failed fetching models\.dev|non-OK response/s,
      'must log fetch errors with context'
    );
  });

  test.skip('includes error details in logs', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /errName.*errMsg.*log\.error/s,
      'must include error name and message in logs'
    );
  });

});

test.describe.skip('ModelCapabilitiesService - Cache Key Construction', () => {

  test.skip('constructs key from providerID and modelID', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /const key = .*`\$\{providerID\}/\$\{modelID\}`/s,
      'must construct cache key from provider and model IDs'
    );
  });

  test.skip('normalizes keys for comparison', () => {
    const source = modelCapabilitiesSource;

    assert.match(
      source,
      /normalizedKey.*toLowerCase\(\)|candidate.*toLowerCase\(\)/s,
      'must normalize keys for case-insensitive comparison'
    );
  });

});
