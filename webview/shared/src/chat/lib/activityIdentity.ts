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

function normalized(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Returns the stable identity of one SDK activity across pending, running, and
 * completed snapshots.
 *
 * LOCKED STREAMING INVARIANT: a callID or part ID is the complete identity.
 * Display fields such as title, tool, file path, and output are lifecycle data
 * and must never split one tool call into additional timeline rows.
 */
export function stableActivityIdentity(input: ActivityIdentityInput): string {
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
