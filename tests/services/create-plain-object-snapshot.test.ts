import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createPlainObjectSnapshot } from "../../src/shared/createPlainObjectSnapshot.js";

describe("createPlainObjectSnapshot", () => {
  it("converts built-ins and unsupported values into plain replay-safe data", () => {
    const error = new Error("boom");
    const value = {
      createdAt: new Date("2026-07-11T00:00:00.000Z"),
      mapping: new Map<string, unknown>([["alpha", { ok: true }]]),
      values: new Set([1, "two"]),
      bytes: new Uint8Array([1, 2, 3]),
      nested: {
        count: 42n,
        skip: () => "ignored",
      },
      failure: error,
    };

    const snapshot = createPlainObjectSnapshot(value) as Record<string, any>;

    assert.equal(snapshot.createdAt, "2026-07-11T00:00:00.000Z");
    assert.deepEqual(snapshot.mapping, {
      __type: "Map",
      entries: [["alpha", { ok: true }]],
    });
    assert.deepEqual(snapshot.values, {
      __type: "Set",
      values: [1, "two"],
    });
    assert.deepEqual(snapshot.bytes, {
      __type: "Uint8Array",
      byteLength: 3,
    });
    assert.equal(snapshot.nested.count, "42");
    assert.equal("skip" in snapshot.nested, false);
    assert.equal(snapshot.failure.message, "boom");
  });

  it("breaks circular references without returning the original object graph", () => {
    const root: Record<string, unknown> = { id: "root" };
    root.self = root;

    const snapshot = createPlainObjectSnapshot(root) as Record<string, any>;

    assert.equal(snapshot.id, "root");
    assert.equal(snapshot.self, "[omitted: circular reference]");
    assert.notEqual(snapshot, root);
  });
});
