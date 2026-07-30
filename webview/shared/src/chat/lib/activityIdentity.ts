export interface ActivityIdentityInput {
  callID?: string;
  partID?: string;
  id?: string;
  messageID?: string;
  tool?: string;
  label?: string;
  title?: string;
  filePath?: string;
  key?: string;
  partType?: string;
}

const VOLATILE_ACTIVITY_TIMING_KEYS = new Set([
  "time",
  "timestamp",
  "starttime",
  "endtime",
  "startedat",
  "endedat",
  "starttimestamp",
  "endtimestamp",
]);

function normalized(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

/** Produces a bounded deterministic fingerprint for activity payload text. */
export function activityTextFingerprint(value: string): string {
  let hash = 2166136261;
  const maximumSampleLength = 8_192;
  const sample = value.length <= maximumSampleLength
    ? value
    : `${value.slice(0, maximumSampleLength / 2)}\n…\n${value.slice(-maximumSampleLength / 2)}`;
  let previousWasWhitespace = true;
  for (let index = 0; index < sample.length; index += 1) {
    const character = sample[index];
    if (/\s/u.test(character)) {
      if (previousWasWhitespace) continue;
      previousWasWhitespace = true;
      hash ^= 32;
      hash = Math.imul(hash, 16777619);
      continue;
    }
    previousWasWhitespace = false;
    hash ^= character.toLowerCase().charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}:${(hash >>> 0).toString(36)}`;
}

/** A stable, order-independent fingerprint for SDK tool input objects. */
export function activityValueFingerprint(value: unknown, depth = 0): string {
  if (depth > 8) return "depth";
  if (typeof value === "string") return `text:${activityTextFingerprint(value)}`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => activityValueFingerprint(item, depth + 1)).join(",")}]`;
  }
  if (typeof value !== "object") return "unknown";
  const record = value as Record<string, unknown>;
  // SDK tool snapshots often carry lifecycle timestamps inside the input
  // envelope. They describe when the same action was observed, not which
  // action the user sees. Exclude only explicit timing keys; fields such as
  // Read's `lineStart`, `lineEnd`, `offset`, and `limit` remain semantic input.
  return `{${Object.keys(record)
    .sort()
    .filter((key) => !VOLATILE_ACTIVITY_TIMING_KEYS.has(key.trim().toLowerCase()))
    .map((key) => `${key}:${activityValueFingerprint(record[key], depth + 1)}`)
    .join(",")}}`;
}

/**
 * The one semantic identity for an activity action. Lifecycle output is not
 * included because it changes while the same SDK action is running.
 */
export function canonicalActivityActionIdentity(
  toolValue: unknown,
  input: unknown,
): string {
  const tool = typeof toolValue === "string" ? normalized(toolValue) : "";
  if (!tool || input == null) return "";
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : undefined;

  // `/event` and `/global/event` can describe the same call with slightly
  // different transport metadata (notably `workdir`). Identity must describe
  // the action that a reader sees, not every incidental SDK field.
  const actionInput = (() => {
    if (!record) return input;
    if (tool === "bash" || tool === "shell" || tool === "command") {
      const command = record.command ?? record.CommandLine ?? record.cmd;
      return command == null ? input : { command };
    }
    if (tool === "read" || tool === "read_file") {
      const file = record.filePath ?? record.file ?? record.path;
      // A repeated snapshot of the same range is one visible activity even if
      // a provider gives it another callID. Different ranges of the same file
      // remain distinct work and are shown with their line range in the UI.
      const offset = record.offset;
      const limit = record.limit;
      return file == null ? input : { file, offset, limit };
    }
    if (tool === "grep" || tool === "glob" || tool === "search") {
      const query = record.pattern ?? record.query ?? record.search;
      const path = record.path ?? record.filePath ?? record.cwd;
      return query == null && path == null ? input : { query, path };
    }
    return input;
  })();

  return ["action", tool, activityValueFingerprint(actionInput)].join(":");
}

/**
 * Returns the stable identity of one SDK activity across pending, running, and
 * completed snapshots.
 *
 * LOCKED STREAMING INVARIANT: a part ID or callID is the complete identity.
 * Display fields such as title, tool, file path, and output are lifecycle data
 * and must never split one tool call into additional timeline rows.
 */
export function stableActivityIdentity(input: ActivityIdentityInput): string {
  // The call ID is the strongest cross-envelope identity. A rehydrated part
  // and a live/sync mirror can expose different part/event IDs while still
  // describing the same tool call; keying by those changing IDs creates two
  // visible Grep/Read/Bash rows for one action.
  const callID = normalized(input.callID);
  if (callID) {
    return `call:${callID}`;
  }

  const partID = normalized(input.partID || input.id);
  if (partID) {
    return `part:${partID}`;
  }

  const messageID = normalized(input.messageID);
  const activity = normalized(input.tool || input.label || input.title);
  const filePath = normalized(input.filePath);
  if (messageID) {
    return ["message", messageID, activity, filePath].join(":");
  }

  const key = normalized(input.key);
  if (key) {
    return ["key", key, normalized(input.partType), activity, filePath].join(":");
  }

  return "";
}
