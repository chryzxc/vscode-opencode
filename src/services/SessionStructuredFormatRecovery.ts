import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile as execFileCallback } from "child_process";
import { promisify } from "util";

import { createLogger } from "../utils/Logger";
import { LoggingCategories } from "../utils/LoggingSchema";

const execFile = promisify(execFileCallback);
const log = createLogger(LoggingCategories.SESSION_SERVICE);

/**
 * OpenCode 1.18.x persists `format: { type: "json_schema" }` on a user
 * message, but rejects that exact persisted shape when it later rehydrates
 * `/session/:id/message`. Remove only this server-invalid transport field.
 */
export class SessionStructuredFormatRecovery {
  async repair(sessionID: string): Promise<boolean> {
    const databasePath = this.findDatabasePath();
    if (!databasePath) {
      log.warn("Could not locate the OpenCode database for structured-format recovery", { sessionId: sessionID });
      return false;
    }

    try {
      const sql = [
        "BEGIN IMMEDIATE;",
        "UPDATE message",
        "SET data = json_remove(data, '$.format')",
        `WHERE session_id = ${quoteSql(sessionID)}`,
        "  AND json_extract(data, '$.format.type') = 'json_schema';",
        "SELECT changes();",
        "COMMIT;",
      ].join("\n");
      const { stdout } = await execFile("sqlite3", ["-cmd", ".timeout 2000", databasePath, sql], { timeout: 5_000 });
      const repairedCount = Number.parseInt(stdout.trim().split(/\s+/).pop() || "0", 10);
      log.info("Recovered OpenCode session from persisted structured-output format", {
        sessionId: sessionID,
        databasePath,
        repairedCount: Number.isFinite(repairedCount) ? repairedCount : 0,
      });
      return Number.isFinite(repairedCount) && repairedCount > 0;
    } catch (error) {
      log.warn("Failed to recover persisted structured-output format", {
        sessionId: sessionID,
        databasePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private findDatabasePath(): string | undefined {
    const home = os.homedir();
    const candidates = [
      process.env.OPENCODE_DATA_DIR && path.join(process.env.OPENCODE_DATA_DIR, "opencode.db"),
      process.env.XDG_DATA_HOME && path.join(process.env.XDG_DATA_HOME, "opencode", "opencode.db"),
      path.join(home, ".local", "share", "opencode", "opencode.db"),
      path.join(home, "Library", "Application Support", "opencode", "opencode.db"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => fs.existsSync(candidate));
  }
}

export function isPersistedStructuredFormatError(error: unknown): boolean {
  const text = JSON.stringify(error || "").toLowerCase();
  return text.includes("expected outputformatjsonschema") && text.includes("json_schema");
}

function quoteSql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
