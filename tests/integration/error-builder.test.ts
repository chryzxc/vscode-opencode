import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ErrorBuilder } from "../../src/providers/chat/ErrorBuilder.js";
import { createTestLogger } from "./helpers/test-utils.js";

function createBuilder(
  predicate: (message: string) => boolean = (message) =>
    message.toLowerCase().includes("timeout")
) {
  return new ErrorBuilder(createTestLogger(), predicate);
}

describe("ErrorBuilder", () => {
  describe("extractError", () => {
    it("returns null for non-object or errorless messages", () => {
      const builder = createBuilder();

      assert.equal(builder.extractError(null), null);
      assert.equal(builder.extractError("boom"), null);
      assert.equal(builder.extractError({ info: { error: { data: {} } } }), null);
      assert.equal(builder.extractError({ error: undefined }), null);
    });

    it("extracts API error from info.error.data.message", () => {
      const builder = createBuilder();

      const result = builder.extractError({
        info: {
          error: {
            data: {
              message: "  Token refresh failed  ",
            },
          },
        },
      });

      assert.deepEqual(result, {
        type: "api_error",
        message: "Token refresh failed",
        originalError: "  Token refresh failed  ",
        canRetry: true,
        metadata: {
          errorName: undefined,
          statusCode: undefined,
        },
      });
    });

    it("extracts API error metadata including status code and error name", () => {
      const builder = createBuilder();

      const result = builder.extractError({
        info: {
          error: {
            name: "AuthenticationError",
            data: {
              message: "Unauthorized",
              statusCode: 401,
            },
          },
        },
      });

      assert.equal(result?.type, "api_error");
      assert.equal(result?.message, "Unauthorized");
      assert.equal(result?.metadata?.errorName, "AuthenticationError");
      assert.equal(result?.metadata?.statusCode, 401);
      assert.equal(result?.canRetry, true);
    });

    it("returns null when error data message is missing or blank", () => {
      const builder = createBuilder();

      assert.equal(
        builder.extractError({ info: { error: { data: { message: "   " } } } }),
        null,
      );
      assert.equal(
        builder.extractError({ info: { error: { data: { message: 123 } } } }),
        null,
      );
    });

    it("detects timeout errors from message.error", () => {
      const builder = createBuilder((message) =>
        message.toLowerCase().includes("interactive request timed out")
      );

      const result = builder.extractError({
        error: "Interactive request timed out while waiting for input",
      });

      assert.deepEqual(result, {
        type: "timeout",
        message: "Request timed out. Please retry.",
        originalError: "Interactive request timed out while waiting for input",
        canRetry: true,
      });
    });

    it("returns null when predicate does not recognize the timeout candidate", () => {
      const builder = createBuilder(() => false);

      const result = builder.extractError({
        error: "Request timed out after 30s",
      });

      assert.equal(result, null);
    });

    it("prioritizes API errors over timeout detection", () => {
      const builder = createBuilder((message) => message.toLowerCase().includes("timed out"));

      const result = builder.extractError({
        error: "Request timed out after 30s",
        info: {
          error: {
            name: "GatewayTimeout",
            data: {
              message: "Upstream request timed out",
              statusCode: 504,
            },
          },
        },
      });

      assert.equal(result?.type, "api_error");
      assert.equal(result?.message, "Upstream request timed out");
      assert.equal(result?.originalError, "Upstream request timed out");
      assert.equal(result?.metadata?.statusCode, 504);
    });

    it("returns a DisplayError with the expected API-error shape", () => {
      const builder = createBuilder();

      const result = builder.extractError({
        info: {
          error: {
            name: "RateLimitError",
            data: {
              message: "Rate limit exceeded",
              statusCode: 429,
            },
          },
        },
      });

      assert.ok(result);
      assert.deepEqual(Object.keys(result).sort(), [
        "canRetry",
        "message",
        "metadata",
        "originalError",
        "type",
      ]);
      assert.deepEqual(Object.keys(result.metadata ?? {}).sort(), ["errorName", "statusCode"]);
      assert.equal(typeof result.message, "string");
      assert.equal(typeof result.canRetry, "boolean");
    });
  });
});
