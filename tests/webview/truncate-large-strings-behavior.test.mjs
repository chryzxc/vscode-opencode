// Runtime regression tests for webview/shared/src/chat/lib/truncateLargeStrings.ts
//
// Why this file exists:
// - `truncateLargeStrings` had ZERO test coverage (search: grep -rn "truncateLargeStrings" tests/)
// - It is used by both the extension host (`src/providers/ChatViewProvider.ts`) and
//   the webview to cap oversized payloads before logging/postMessage.
// - A silent behavior change (e.g., off-by-one in the slice, missing array branch,
//   maxLen default drift) would corrupt diagnostics across the IPC boundary.
//
// These tests execute the actual TypeScript implementation via `tsx` so they
// catch real behavior regressions, not just source-text drift.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { importWebviewModule } from "../helpers/webview-module.mjs";

const MODULE_PATH = "webview/shared/src/chat/lib/truncateLargeStrings.ts";

const { truncateLargeStrings } = await importWebviewModule(MODULE_PATH);

describe("truncateLargeStrings", () => {
  describe("primitive passthrough", () => {
    it("returns numbers unchanged", () => {
      assert.strictEqual(truncateLargeStrings(42), 42);
      assert.strictEqual(truncateLargeStrings(0), 0);
      assert.strictEqual(truncateLargeStrings(-1.5), -1.5);
      assert.strictEqual(truncateLargeStrings(Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
    });

    it("returns booleans unchanged", () => {
      assert.strictEqual(truncateLargeStrings(true), true);
      assert.strictEqual(truncateLargeStrings(false), false);
    });

    it("returns null and undefined unchanged", () => {
      assert.strictEqual(truncateLargeStrings(null), null);
      assert.strictEqual(truncateLargeStrings(undefined), undefined);
    });

    it("returns short strings unchanged", () => {
      assert.strictEqual(truncateLargeStrings("hello"), "hello");
      assert.strictEqual(truncateLargeStrings(""), "");
      assert.strictEqual(truncateLargeStrings("a"), "a");
    });
  });

  describe("string truncation", () => {
    it("truncates strings exceeding maxLen and appends the truncated-chars marker", () => {
      const input = "0123456789"; // length 10
      const result = truncateLargeStrings(input, 5);
      assert.equal(typeof result, "string");
      assert.ok(result.startsWith("01234"), "truncated string keeps the first maxLen chars");
      assert.match(result, /\n\.\.\.\[truncated 5 chars\]/, "marker reports the number of dropped chars");
    });

    it("does not truncate when length equals maxLen exactly", () => {
      // Source contract: `obj.length > maxLen`, so length === maxLen must pass through.
      const exact = "abcde"; // length 5
      assert.strictEqual(truncateLargeStrings(exact, 5), exact);
    });

    it("defaults maxLen to 200000 when omitted", () => {
      const shortInput = "x".repeat(100);
      assert.strictEqual(truncateLargeStrings(shortInput), shortInput);

      const longInput = "y".repeat(200001);
      const result = truncateLargeStrings(longInput);
      assert.ok(result.startsWith("y".repeat(200000)));
      assert.match(result, /\[truncated 1 chars\]/);
    });

    it("honors a custom maxLen of 0 by truncating every non-empty string", () => {
      const result = truncateLargeStrings("abc", 0);
      // length 3 > 0, so it truncates to empty prefix + marker
      assert.match(result, /^\n\.\.\.\[truncated 3 chars\]/);
    });
  });

  describe("array recursion", () => {
    it("recursively truncates each string element, preserving array shape", () => {
      const input = ["short", "wayyyyyyyyyyy-too-long"];
      const result = truncateLargeStrings(input, 5);
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 2);
      assert.strictEqual(result[0], "short");
      assert.match(result[1], /^wayyy/);
      assert.match(result[1], /\[truncated/);
    });

    it("preserves non-string element types inside arrays", () => {
      const input = [1, true, null, { nested: "x".repeat(20) }];
      const result = truncateLargeStrings(input, 5);
      assert.strictEqual(result[0], 1);
      assert.strictEqual(result[1], true);
      assert.strictEqual(result[2], null);
      assert.equal(typeof result[3], "object");
    });

    it("handles empty arrays", () => {
      const result = truncateLargeStrings([], 5);
      assert.deepEqual(result, []);
    });
  });

  describe("object recursion", () => {
    it("deeply truncates nested object string values", () => {
      const input = {
        outer: "x".repeat(20),
        nested: {
          inner: "y".repeat(20),
          number: 7,
        },
      };
      const result = truncateLargeStrings(input, 5);
      assert.match(result.outer, /^xxxxx/);
      assert.match(result.outer, /\[truncated/);
      assert.match(result.nested.inner, /^yyyyy/);
      assert.match(result.nested.inner, /\[truncated/);
      assert.strictEqual(result.nested.number, 7);
    });

    it("only iterates own enumerable properties (hasOwnProperty guard)", () => {
      // If the implementation dropped the hasOwnProperty check, a prototype
      // property like `toString` would surface as a string and get truncated.
      const input = { a: "short" };
      const result = truncateLargeStrings(input, 5);
      assert.deepEqual(Object.keys(result), ["a"]);
      assert.strictEqual(result.a, "short");
      // Sanity: prototype keys did not leak in
      assert.equal(typeof result.toString, "function");
    });

    it("handles empty objects", () => {
      const result = truncateLargeStrings({}, 5);
      assert.deepEqual(result, {});
    });

    it("preserves null-valued properties (does not treat null as object-to-recurse)", () => {
      // typeof null === "object" but the source contract explicitly checks `obj !== null`
      const input = { keep: null, str: "x".repeat(20) };
      const result = truncateLargeStrings(input, 5);
      assert.strictEqual(result.keep, null);
      assert.match(result.str, /\[truncated/);
    });
  });

  describe("mixed nested structures", () => {
    it("truncates strings inside arrays inside objects inside arrays", () => {
      const input = [
        {
          messages: ["a".repeat(50), "ok"],
        },
        "b".repeat(50),
      ];
      const result = truncateLargeStrings(input, 10);
      assert.ok(Array.isArray(result));
      assert.match(result[0].messages[0], /^aaaaaaaaaa/);
      assert.match(result[0].messages[0], /\[truncated 40 chars\]/);
      assert.strictEqual(result[0].messages[1], "ok");
      assert.match(result[1], /^bbbbbbbbbb/);
    });
  });

  describe("return-value invariants", () => {
    it("never returns the same array reference for nested arrays (defensive copy)", () => {
      const input = ["hello"];
      const result = truncateLargeStrings(input, 100);
      assert.notEqual(result, input);
      assert.deepEqual(result, input);
    });

    it("never returns the same object reference for nested objects (defensive copy)", () => {
      const input = { a: "hello" };
      const result = truncateLargeStrings(input, 100);
      assert.notEqual(result, input);
      assert.deepEqual(result, input);
    });
  });
});
