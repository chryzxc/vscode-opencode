import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

test("repository hygiene policy rejects shipped backup artifacts and runtime build tooling", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/repository-hygiene-check.mjs"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.match(output, /Repository hygiene check passed/);
});
