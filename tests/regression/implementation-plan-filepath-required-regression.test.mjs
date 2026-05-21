import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const structuredOutputProcessorSource = readSource(
  [joinFromRoot("src", "providers", "chat", "StructuredOutputProcessor.ts")],
  "StructuredOutputProcessor.ts",
);

const planManagerSource = readSource(
  [joinFromRoot("src", "providers", "chat", "PlanManager.ts")],
  "PlanManager.ts",
);

const validatorSource = readSource(
  [joinFromRoot("src", "shared", "structuredOutputValidator.ts")],
  "structuredOutputValidator.ts",
);

const schemaSource = readSource(
  [joinFromRoot("src", "shared", "structuredOutputSchema.ts")],
  "structuredOutputSchema.ts",
);

test.skip("implementation_plan normalization does not synthesize plan.file path prefixes", () => {
  const normalizeBody = extractFunctionBody(
    structuredOutputProcessorSource,
    "normalizeStructuredOutput(",
  );

  assert.match(
    normalizeBody,
    /canonicalResponseType === "implementation_plan"/,
    "normalizeStructuredOutput should have an implementation_plan normalization branch",
  );
  assert.doesNotMatch(
    normalizeBody,
    /buildGeneratedPlanFilePath\(/,
    "implementation_plan normalization should not invent synthetic plan file paths",
  );
  assert.match(
    normalizeBody,
    /nextPlan:\s*Record<string, unknown>[\s\S]*file:\s*ensuredPlanFile/s,
    "implementation_plan normalization should only normalize an existing plan.file",
  );
});

test.skip("plan persistence requires AI-provided path and does not create synthetic default path", () => {
  const persistBody = extractFunctionBody(
    planManagerSource,
    "async persistPlan(",
  );

  assert.doesNotMatch(
    planManagerSource,
    /buildGeneratedPlanFilePath\(/,
    "PlanManager should not expose generated implementation plan path helper",
  );
  assert.doesNotMatch(
    persistBody,
    /generatedPath/,
    "persistPlan should not derive generated plan paths",
  );
  assert.match(
    persistBody,
    /const resolvedPath = resolvedPreferred;/,
    "persistPlan should only use AI-provided preferred path",
  );
});

test.skip("validator and schema require plan.file for implementation_plan payloads", () => {
  assert.match(
    validatorSource,
    /implementation_plan requires plan\.file string/,
    "validator should require plan.file for implementation_plan",
  );
  assert.match(
    schemaSource,
    /plan:[\s\S]*required:\s*\["title", "file"\]/,
    "schema should require file in plan object",
  );
});
