#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function run(command, args) {
  return spawnSync(command, args, {
    stdio: "inherit",
    encoding: "utf8"
  });
}

function main() {
  const insideRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8"
  });

  if ((insideRepo.status ?? 1) !== 0) {
    process.exit(0);
  }

  const setHooksPath = run("git", ["config", "core.hooksPath", ".githooks"]);
  if ((setHooksPath.status ?? 1) !== 0) {
    process.exit(setHooksPath.status ?? 1);
  }

  const makeExecutable = run("git", ["update-index", "--chmod=+x", ".githooks/pre-push"]);
  if ((makeExecutable.status ?? 1) !== 0) {
    // Hook still works without index mode change (especially on Windows).
    process.exit(0);
  }
}

main();
