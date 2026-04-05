#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const FULL_SUITE_MARKER = "__FULL_SUITE__";

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function parseArgs(argv) {
  const args = {
    changedFiles: [],
    json: false
  };

  for (const token of argv) {
    if (token === "--json") {
      args.json = true;
      continue;
    }

    args.changedFiles.push(normalizePath(token));
  }

  return args;
}

function loadImpactMap() {
  const impactMapPath = path.resolve("scripts", "test-impact-map.json");
  return JSON.parse(fs.readFileSync(impactMapPath, "utf8"));
}

function testExists(testPath) {
  return fs.existsSync(path.resolve(testPath));
}

function matchesRule(filePath, rule) {
  if (Array.isArray(rule.prefixes)) {
    for (const prefix of rule.prefixes) {
      if (filePath.startsWith(prefix)) {
        return true;
      }
    }
  }

  if (Array.isArray(rule.includes)) {
    for (const fragment of rule.includes) {
      if (filePath.includes(fragment)) {
        return true;
      }
    }
  }

  if (Array.isArray(rule.regexes)) {
    for (const expression of rule.regexes) {
      if (new RegExp(expression).test(filePath)) {
        return true;
      }
    }
  }

  return false;
}

function buildSelection(changedFiles, impactMap) {
  let fullSuite = false;
  const selectedTests = new Set();
  const matchedRules = new Set();

  for (const testPath of impactMap.alwaysRunTests || []) {
    if (testExists(testPath)) {
      selectedTests.add(normalizePath(testPath));
    }
  }

  for (const filePath of changedFiles) {
    for (const rule of impactMap.rules || []) {
      if (!matchesRule(filePath, rule)) {
        continue;
      }

      matchedRules.add(rule.name || "unnamed-rule");

      if (rule.fullSuite) {
        fullSuite = true;
      }

      for (const testPath of rule.tests || []) {
        if (testExists(testPath)) {
          selectedTests.add(normalizePath(testPath));
        }
      }
    }
  }

  if (
    typeof impactMap.fullSuiteIfChangedCount === "number" &&
    changedFiles.length >= impactMap.fullSuiteIfChangedCount
  ) {
    fullSuite = true;
  }

  return {
    fullSuite,
    selectedTests: Array.from(selectedTests).sort(),
    matchedRules: Array.from(matchedRules).sort()
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const impactMap = loadImpactMap();
  const changedFiles = args.changedFiles.map(normalizePath);
  const selection = buildSelection(changedFiles, impactMap);

  if (args.json) {
    process.stdout.write(JSON.stringify(selection, null, 2));
    return;
  }

  if (selection.fullSuite) {
    process.stdout.write(`${FULL_SUITE_MARKER}\n`);
    return;
  }

  for (const testPath of selection.selectedTests) {
    process.stdout.write(`${testPath}\n`);
  }
}

main();
