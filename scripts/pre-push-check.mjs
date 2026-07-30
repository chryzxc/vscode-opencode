#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const FULL_SUITE_MARKER = "__FULL_SUITE__";
const NODE_BIN = process.execPath;
const NPM_BIN = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8"
  });

  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    return {
      status: 1,
      stdout: "",
      stderr: result.error.message
    };
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function mustSucceed(command, args) {
  const result = run(command, args);
  if (result.status !== 0) {
    process.exit(result.status);
  }
}

function readChangedFilesFromUpstream() {
  const upstream = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { capture: true });
  if (upstream.status !== 0) {
    return [];
  }

  const ref = upstream.stdout.trim();
  if (!ref) {
    return [];
  }

  const diff = run("git", ["diff", "--name-only", `${ref}...HEAD`], { capture: true });
  if (diff.status !== 0) {
    return [];
  }

  return diff.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, "/"));
}

function readChangedFilesFromLastCommit() {
  const hasParent = run("git", ["rev-parse", "--verify", "HEAD~1"], { capture: true });
  if (hasParent.status !== 0) {
    const trackedFiles = run("git", ["ls-files"], { capture: true });
    if (trackedFiles.status !== 0) {
      return [];
    }

    return trackedFiles.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/\\/g, "/"));
  }

  const diff = run("git", ["diff", "--name-only", "HEAD~1..HEAD"], { capture: true });
  if (diff.status !== 0) {
    return [];
  }

  return diff.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, "/"));
}

function getChangedFiles() {
  const upstreamFiles = readChangedFilesFromUpstream();
  if (upstreamFiles.length > 0) {
    return upstreamFiles;
  }

  const fallbackFiles = readChangedFilesFromLastCommit();
  if (fallbackFiles.length > 0) {
    return fallbackFiles;
  }

  return [];
}

function shouldBuildWebview(changedFiles) {
  return changedFiles.some((filePath) => filePath.startsWith("webview/shared/"));
}

function resolveImpactedTests(changedFiles) {
  const args = ["scripts/select-tests.mjs", ...changedFiles];
  const selection = run(NODE_BIN, args, { capture: true });
  if (selection.status !== 0) {
    process.exit(selection.status);
  }

  return selection.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function runTests(changedFiles, testsOnly) {
  const impacted = resolveImpactedTests(changedFiles);

  if (impacted.includes(FULL_SUITE_MARKER)) {
    mustSucceed(NPM_BIN, ["test"]);
    return;
  }

  if (impacted.length === 0) {
    mustSucceed(NPM_BIN, ["test"]);
    return;
  }

  mustSucceed(NODE_BIN, ["--test", ...impacted]);

  if (!testsOnly) {
    const smokeFile = "tests/regression/chat-css-regression.test.mjs";
    if (fs.existsSync(smokeFile) && !impacted.includes(smokeFile)) {
      mustSucceed(NODE_BIN, ["--test", smokeFile]);
    }
  }
}

function runStreamingContractGuard(changedFiles) {
  const result = run(NODE_BIN, ["scripts/streaming-contract-check.mjs", ...changedFiles]);
  if (result.status !== 0) {
    process.exit(result.status);
  }
}

function main() {
  const testsOnly = process.argv.includes("--tests-only");
  const changedFiles = getChangedFiles();

  runStreamingContractGuard(changedFiles);

  if (!testsOnly) {
    mustSucceed(NPM_BIN, ["run", "structured-output:check"]);
    mustSucceed(NPM_BIN, ["run", "compile"]);

    if (shouldBuildWebview(changedFiles)) {
      mustSucceed(NPM_BIN, ["run", "webview:build"]);
    }

    mustSucceed(NPM_BIN, ["run", "lint"]);
  }

  runTests(changedFiles, testsOnly);
}

main();
