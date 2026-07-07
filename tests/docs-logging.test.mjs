/**
 * Tests for Task 8: Package.json Scripts and Documentation
 *
 * Tests verify:
 * 1. NPM scripts exist in package.json
 * 2. Documentation files exist
 * 3. Documentation contains required sections
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = resolve(__dirname, "..");

// Test utilities
const readJson = (relativePath) =>
  JSON.parse(readFileSync(resolve(rootDir, relativePath), "utf8"));
const readText = (relativePath) =>
  readFileSync(resolve(rootDir, relativePath), "utf8");

// Load files once
const packageJson = readJson("package.json");
const loggingDocs = readText("docs/LOGGING.md");
const readme = readText("README.md");

test("NPM scripts: analyze-logs script exists", () => {
  assert.equal(
    packageJson.scripts["analyze-logs"],
    "npx tsx scripts/analyze-logs.ts logs/opencode.log",
    "analyze-logs script should use tsx and point to analyze-logs.ts"
  );
});

test("NPM scripts: analyze-logs:summary script exists", () => {
  assert.equal(
    packageJson.scripts["analyze-logs:summary"],
    "npx tsx scripts/analyze-logs.ts logs/opencode.log --summary",
    "analyze-logs:summary should include --summary flag"
  );
});

test("NPM scripts: analyze-logs:flows script exists", () => {
  assert.equal(
    packageJson.scripts["analyze-logs:flows"],
    "npx tsx scripts/analyze-logs.ts logs/opencode.log --flows",
    "analyze-logs:flows should include --flows flag"
  );
});

test("NPM scripts: analyze-logs:errors script exists", () => {
  assert.equal(
    packageJson.scripts["analyze-logs:errors"],
    "npx tsx scripts/analyze-logs.ts logs/opencode.log --errors",
    "analyze-logs:errors should include --errors flag"
  );
});

test("NPM scripts: analyze-logs:perf script exists", () => {
  assert.equal(
    packageJson.scripts["analyze-logs:perf"],
    "npx tsx scripts/analyze-logs.ts logs/opencode.log --performance",
    "analyze-logs:perf should include --performance flag"
  );
});

test("LOGGING.md: file exists and is not empty", () => {
  assert.ok(loggingDocs.length > 0, "LOGGING.md should not be empty");
});

test("LOGGING.md: contains Overview section", () => {
  assert.ok(loggingDocs.includes("## Overview"), "LOGGING.md should have Overview section");
});

test("LOGGING.md: contains Features section", () => {
  assert.ok(loggingDocs.includes("## Features"), "LOGGING.md should have Features section");
});

test("LOGGING.md: contains Configuration section", () => {
  assert.ok(loggingDocs.includes("## Configuration"), "LOGGING.md should have Configuration section");
});

test("LOGGING.md: contains Usage section", () => {
  assert.ok(loggingDocs.includes("## Usage"), "LOGGING.md should have Usage section");
});

test("LOGGING.md: documents Feature Flow Tracking", () => {
  assert.ok(
    loggingDocs.includes("### Feature Flow Tracking"),
    "LOGGING.md should document Feature Flow Tracking"
  );
});

test("LOGGING.md: documents State Change Logging", () => {
  assert.ok(
    loggingDocs.includes("### State Change Logging"),
    "LOGGING.md should document State Change Logging"
  );
});

test("LOGGING.md: documents UI Interaction Logging", () => {
  assert.ok(
    loggingDocs.includes("### UI Interaction Logging"),
    "LOGGING.md should document UI Interaction Logging"
  );
});

test("LOGGING.md: documents Performance Logging", () => {
  assert.ok(
    loggingDocs.includes("### Performance Logging"),
    "LOGGING.md should document Performance Logging"
  );
});

test("LOGGING.md: documents Logging Categories", () => {
  assert.ok(
    loggingDocs.includes("## Logging Categories"),
    "LOGGING.md should document Logging Categories"
  );
});

test("LOGGING.md: lists all 10 logging categories", () => {
  const categories = [
    "EXTENSION",
    "CHAT_VIEW",
    "SESSION_SERVICE",
    "QUEUE_MANAGER",
    "MODEL_AGENT_MANAGER",
    "PLAN_MANAGER",
    "STREAM_HANDLER",
    "SERVER_MANAGER",
    "UI_INTERACTION",
    "FEATURE_FLOW",
  ];

  for (const category of categories) {
    assert.ok(
      loggingDocs.includes(category),
      `LOGGING.md should include ${category} category`
    );
  }
});

test("LOGGING.md: contains Log Analysis section", () => {
  assert.ok(loggingDocs.includes("## Log Analysis"), "LOGGING.md should have Log Analysis section");
});

test("LOGGING.md: documents CLI tool usage", () => {
  assert.ok(
    loggingDocs.includes("### Using the CLI Tool"),
    "LOGGING.md should document CLI tool usage"
  );
});

test("LOGGING.md: documents programmatic analysis", () => {
  assert.ok(
    loggingDocs.includes("### Programmatic Analysis"),
    "LOGGING.md should document programmatic analysis with LogQuery"
  );
});

test("LOGGING.md: contains Log Format section", () => {
  assert.ok(loggingDocs.includes("## Log Format"), "LOGGING.md should have Log Format section");
});

test("LOGGING.md: contains Debugging Tips section", () => {
  assert.ok(
    loggingDocs.includes("## Debugging Tips"),
    "LOGGING.md should have Debugging Tips section"
  );
});

test("LOGGING.md: contains Best Practices section", () => {
  assert.ok(
    loggingDocs.includes("## Best Practices"),
    "LOGGING.md should have Best Practices section"
  );
});

test("LOGGING.md: contains File Output section", () => {
  assert.ok(loggingDocs.includes("## File Output"), "LOGGING.md should have File Output section");
});

test("LOGGING.md: contains Troubleshooting section", () => {
  assert.ok(
    loggingDocs.includes("## Troubleshooting"),
    "LOGGING.md should have Troubleshooting section"
  );
});

test("LOGGING.md: contains Examples section", () => {
  assert.ok(loggingDocs.includes("## Examples"), "LOGGING.md should have Examples section");
});

test("LOGGING.md: includes correlation ID documentation", () => {
  assert.ok(
    loggingDocs.toLowerCase().includes("correlation id"),
    "LOGGING.md should explain correlation IDs"
  );
});

test("LOGGING.md: includes npm script examples", () => {
  assert.ok(
    loggingDocs.includes("npm run analyze-logs:summary"),
    "LOGGING.md should include npm script examples"
  );
});

test("LOGGING.md: includes LogQuery code examples", () => {
  assert.ok(
    loggingDocs.includes('import { LogQuery } from "./utils/LogQuery"'),
    "LOGGING.md should include LogQuery usage examples"
  );
});

test("README.md: contains Logging section", () => {
  assert.ok(readme.includes("## Logging"), "README.md should have Logging section");
});

test("README.md: mentions feature flow tracking", () => {
  assert.ok(
    readme.toLowerCase().includes("feature flow tracking"),
    "README.md should mention feature flow tracking"
  );
});

test("README.md: mentions correlation IDs", () => {
  assert.ok(
    readme.toLowerCase().includes("correlation ids"),
    "README.md should mention correlation IDs"
  );
});

test("README.md: mentions performance monitoring", () => {
  assert.ok(
    readme.toLowerCase().includes("performance monitoring"),
    "README.md should mention performance monitoring"
  );
});

test("README.md: includes npm script examples", () => {
  assert.ok(
    readme.includes("npm run analyze-logs:summary"),
    "README.md should include npm script examples"
  );
});

test("README.md: links to LOGGING.md", () => {
  assert.ok(
    readme.includes("LOGGING.md"),
    "README.md should reference LOGGING.md documentation"
  );
});

test("README.md: includes correlation ID debugging example", () => {
  assert.ok(
    readme.toLowerCase().includes("correlation"),
    "README.md should mention correlation ID functionality"
  );
});

test("README.md: mentions slow operation warnings", () => {
  assert.ok(
    readme.toLowerCase().includes("slow") || readme.toLowerCase().includes("performance") || readme.toLowerCase().includes("timeout"),
    "README.md should mention performance/slow operation behavior"
  );
});
