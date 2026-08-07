#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
);
const ignoredPatterns = fs.readFileSync(path.join(repositoryRoot, ".gitignore"), "utf8");
const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const errors = [];

if (rootPackage.dependencies?.vite) {
  errors.push("vite is build tooling and must not be a root runtime dependency");
}

for (const pattern of ["*.bak", "*.map"]) {
  if (!ignoredPatterns.split(/\r?\n/).includes(pattern)) {
    errors.push(`.gitignore must include ${pattern}`);
  }
}

const generatedArtifacts = trackedFiles.filter(
  (file) => file.endsWith(".bak") || file.endsWith(".map"),
);
if (generatedArtifacts.length > 0) {
  errors.push(
    `backup or source-map artifacts must not be tracked:\n${generatedArtifacts
      .map((file) => `  - ${file}`)
      .join("\n")}`,
  );
}

if (errors.length > 0) {
  process.stderr.write(`Repository hygiene check failed:\n${errors.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Repository hygiene check passed.\n");
