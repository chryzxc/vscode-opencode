const MAX_SNAPSHOT_DEPTH = 12;

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotUnknown(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (depth >= MAX_SNAPSHOT_DEPTH) {
    return "[omitted: max depth reached]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => snapshotUnknown(item, depth + 1, seen));
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[omitted: circular reference]";
  }
  seen.add(value);

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof RegExp) {
    return value.toString();
  }

  if (value instanceof URL) {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (ArrayBuffer.isView(value)) {
    return {
      __type: value.constructor.name,
      byteLength: value.byteLength,
    };
  }

  if (value instanceof ArrayBuffer) {
    return {
      __type: "ArrayBuffer",
      byteLength: value.byteLength,
    };
  }

  if (value instanceof Map) {
    return {
      __type: "Map",
      entries: Array.from(value.entries(), ([key, entryValue]) => [
        snapshotUnknown(key, depth + 1, seen),
        snapshotUnknown(entryValue, depth + 1, seen),
      ]),
    };
  }

  if (value instanceof Set) {
    return {
      __type: "Set",
      values: Array.from(value.values(), (entryValue) =>
        snapshotUnknown(entryValue, depth + 1, seen),
      ),
    };
  }

  if (!isPlainObject(value)) {
    const constructorName = value.constructor?.name;
    return constructorName && constructorName !== "Object"
      ? `[omitted non-plain object: ${constructorName}]`
      : "[omitted non-plain object]";
  }

  const snapshot: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalized = snapshotUnknown(nestedValue, depth + 1, seen);
    if (typeof normalized !== "undefined") {
      snapshot[key] = normalized;
    }
  }
  return snapshot;
}

export function createPlainObjectSnapshot<T>(value: T): T {
  let candidate: unknown = value;

  if (typeof structuredClone === "function") {
    try {
      candidate = structuredClone(value);
    } catch {
      // Fall through to JSON/manual snapshotting so we never keep the original
      // runtime-owned object graph when cloning fails.
    }
  }

  try {
    return JSON.parse(JSON.stringify(candidate)) as T;
  } catch {
    return snapshotUnknown(candidate, 0, new WeakSet<object>()) as T;
  }
}

/**
 * Hot-path clone variant for values that are already JSON-safe
 * (e.g. SDK SSE event payloads). Skips the JSON round-trip performed by
 * {@link createPlainObjectSnapshot}. Caller MUST guarantee the input
 * contains no Date/Map/Set/TypedArray/class instances.
 */
export function createPlainObjectSnapshotFast<T>(value: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON/manual snapshotting.
    }
  }

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return snapshotUnknown(value, 0, new WeakSet<object>()) as T;
  }
}
