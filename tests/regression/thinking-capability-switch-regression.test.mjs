import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("model capability merge helper exists for thinking visibility stability", () => {
  assert.match(
    providerSource,
    /private\s+resolveCapabilityForModel\(/,
    "ChatViewProvider should define resolveCapabilityForModel helper",
  );

  assert.match(
    providerSource,
    /const\s+variants\s*=\s*incomingVariants\.length\s*>\s*0\s*\?\s*incomingVariants\s*:\s*knownVariants;/,
    "helper should prefer incoming variants but fall back to known SDK variants",
  );
});

test("session bootstrap and load paths should not null-out modelCapabilityUpdate payloads", () => {
  assert.match(
    providerSource,
    /const immediateOnLoad = this\.resolveCapabilityForModel\(/,
    "session load should send immediate merged capability from known model metadata",
  );
  assert.match(
    providerSource,
    /const immediateOnBootstrap = this\.resolveCapabilityForModel\(/,
    "bootstrap path should send immediate merged capability from known model metadata",
  );

  assert.doesNotMatch(
    providerSource,
    /capability:\s*capability\s*\?\?\s*null/,
    "provider should not send null capability payloads that hide thinking controls after delayed async updates",
  );
});

test("model switch should merge capabilities and keep thinking selector stable", () => {
  assert.match(
    providerSource,
    /const immediateCapability = this\.resolveCapabilityForModel\(/,
    "model switch should send immediate merged capability using known model variants",
  );
  assert.match(
    providerSource,
    /const merged = this\.resolveCapabilityForModel\(/,
    "async capability responses should be merged instead of replacing known good state",
  );
});

