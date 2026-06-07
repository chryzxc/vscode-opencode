import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { createLogger } from "../utils/Logger";
import { LoggingCategories } from "../utils/LoggingSchema";

const log = createLogger(LoggingCategories.CHECKPOINT_RESTORE);

export type CheckpointPayload = {
  sessions?: unknown[];
  currentSessionId?: string | null;
  messages?: Record<string, unknown[]>;
  // allow additional diagnostic metadata to be present
  [k: string]: unknown;
};

/**
 * If a workspace-level checkpoint file exists at .sisyphus/checkpoint.json,
 * load it and write its contents into VSCode workspaceState using the same
 * keys SessionService expects. This enables restoring session+message state
 * after offline compaction or manual export/import.
 *
 * Behavior:
 * - Looks for checkpoint at: <first workspace folder>/.sisyphus/checkpoint.json
 * - Validates top-level shape (sessions array and messages map)
 * - Writes: 'opencode.sessions', 'opencode.currentSessionId',
 *   and 'opencode.session.messages.{sessionId}' keys into workspaceState
 * - On success, moves the checkpoint file to .sisyphus/checkpoint.restored.<ts>.json
 *
 * This function is safe to call during extension activation; it silently
 * no-ops when no workspace is open or the checkpoint file is missing/invalid.
 */
export async function restoreCheckpointIfPresent(
  context: vscode.ExtensionContext,
): Promise<{ restored: boolean; details?: { sessions?: number; messages?: number } }>
{
  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      log.debug("No workspace folder open; skipping checkpoint restore");
      return { restored: false };
    }

    const checkpointPath = path.join(folder.uri.fsPath, ".sisyphus", "checkpoint.json");
    if (!fs.existsSync(checkpointPath)) {
      log.debug(`No checkpoint file found at ${checkpointPath}`);
      return { restored: false };
    }

    const raw = await fs.promises.readFile(checkpointPath, { encoding: "utf8" });
    let payload: CheckpointPayload;
    try {
      payload = JSON.parse(raw) as CheckpointPayload;
    } catch (err) {
      log.warn("Invalid JSON in checkpoint file, skipping restore", { err });
      return { restored: false };
    }

    const sessions = Array.isArray(payload.sessions) ? payload.sessions : undefined;
    const messages = payload.messages && typeof payload.messages === "object"
      ? (payload.messages as Record<string, unknown[]>)
      : undefined;

    // Basic validation: at least sessions or messages must exist
    if (!sessions && !messages) {
      log.warn("Checkpoint payload missing sessions and messages; nothing to restore");
      return { restored: false };
    }

    // Validate messages/subagent shapes minimally so SubagentTracker can parse them
    if (messages) {
      const invalidEntries: Array<{ sessionId: string; problem: string }> = [];
      for (const [sessionId, msgs] of Object.entries(messages)) {
        if (!Array.isArray(msgs)) {
          invalidEntries.push({ sessionId, problem: "messages not an array" });
          continue;
        }
        for (const msg of msgs) {
          if (!msg || typeof msg !== "object") continue;
          const rec = msg as Record<string, unknown>;
          const subs = Array.isArray(rec.subagents) ? rec.subagents : [];
          for (const sub of subs) {
            if (!sub || typeof sub !== "object") continue;
            const sid = (sub as Record<string, unknown>).id;
            const pm = (sub as Record<string, unknown>).parentMessageId;
            if (typeof sid !== "string" || sid.length === 0) {
              invalidEntries.push({ sessionId, problem: `subagent missing id in message ${(rec.info && (rec.info as Record<string, unknown>).id) || (rec.id as string) || "<unknown>"}` });
            }
            if (typeof pm !== "string" || pm.length === 0) {
              invalidEntries.push({ sessionId, problem: `subagent missing parentMessageId in message ${(rec.info && (rec.info as Record<string, unknown>).id) || (rec.id as string) || "<unknown>"}` });
            }
          }
        }
      }
      if (invalidEntries.length > 0) {
        log.warn("Checkpoint contains subagents with missing required fields; some subagents may be ignored by SubagentTracker", { sample: invalidEntries.slice(0, 5) });
      }
    }

    // Persist session list if present
    if (sessions) {
      await context.workspaceState.update("opencode.sessions", sessions);
      log.info(`Restored ${sessions.length} sessions from checkpoint`);
    }

    // Persist messages per session if present
    let messagesCount = 0;
    if (messages) {
      for (const [sessionId, msgs] of Object.entries(messages)) {
        if (!sessionId) continue;
        const arr = Array.isArray(msgs) ? msgs : [];
        await context.workspaceState.update(
          `opencode.session.messages.${sessionId}`,
          arr,
        );
        messagesCount += arr.length;
      }
      log.info(`Restored messages for ${Object.keys(messages).length} sessions (≈${messagesCount} messages)`);
    }

    // Persist current session id if present
    if (typeof payload.currentSessionId === "string") {
      await context.workspaceState.update("opencode.currentSessionId", payload.currentSessionId);
      log.info(`Restored currentSessionId=${payload.currentSessionId}`);
    }

    // Move the checkpoint file out-of-the-way so we don't re-apply it repeatedly.
    try {
      const stamped = Date.now();
      const restoredName = path.join(folder.uri.fsPath, ".sisyphus", `checkpoint.restored.${stamped}.json`);
      await fs.promises.rename(checkpointPath, restoredName);
      log.info(`Moved checkpoint to ${restoredName}`);
    } catch (err) {
      log.warn("Failed to move checkpoint file after restore; leaving it in place", { err });
    }

    return { restored: true, details: { sessions: sessions?.length, messages: messagesCount } };
  } catch (err) {
    log.error("Unexpected error during checkpoint restore", { err });
    return { restored: false };
  }
}
