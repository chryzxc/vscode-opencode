import test from "node:test";
import assert from "node:assert/strict";

import {
  joinFromRoot,
  readSource,
} from "../helpers/source-utils.mjs";

const planViewProviderSource = readSource(
  [joinFromRoot("src", "providers", "PlanViewProvider.ts")],
  "PlanViewProvider.ts",
);

test("PlanViewProvider loads plan content from sourceFile when payload content is empty", () => {
  assert.match(
    planViewProviderSource,
    /private static async resolvePlanContent\(/,
    "plan view provider should define a source-file content resolver",
  );

  assert.match(
    planViewProviderSource,
    /const content = await this\.resolvePlanContent\(\s*context,\s*typeof payload === 'string' \? payload : payload\?\.content \?\? '',\s*sourceFile,\s*\)/s,
    "plan view show flow should resolve content from sourceFile before rendering the panel",
  );

  assert.match(
    planViewProviderSource,
    /const fileBytes = await vscode\.workspace\.fs\.readFile\([\s\S]*path\.normalize\(candidatePath\)[\s\S]*\);/s,
    "file-backed plan view should read markdown directly from disk",
  );
});
