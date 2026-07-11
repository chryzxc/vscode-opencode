import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const loggerSource = readSource(
  [joinFromRoot("src", "utils", "Logger.ts")],
  "Logger.ts",
);

test("logger sanitizes context and console-bound errors before output", () => {
  assert.match(
    loggerSource,
    /import \{ createPlainObjectSnapshot \} from "\.\.\/shared\/createPlainObjectSnapshot";/,
    "Logger should import the shared plain-object snapshot helper",
  );
  assert.match(
    loggerSource,
    /private sanitizeConsoleValue<T>\(value: T\): T \{[\s\S]*?return createPlainObjectSnapshot\(value\);[\s\S]*?\}/,
    "Logger should define a reusable sanitizer for console-bound values",
  );
  assert.match(
    loggerSource,
    /const sanitizedContext = context\s*\?\s*this\.sanitizeConsoleValue\(context\)\s*:\s*undefined;[\s\S]*?context:\s*sanitizedContext,/s,
    "Logger should sanitize structured context before creating log entries",
  );
  assert.match(
    loggerSource,
    /console\.error\(\s*"Failed to write logs to file:",\s*this\.sanitizeConsoleValue\(error\),\s*\);/s,
    "Logger should sanitize raw file-write errors before passing them to console.error",
  );
});
