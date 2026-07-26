import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../webview/shared/src/chat/lib/messageHandler.ts", import.meta.url),
  "utf8",
);

test("centralized event normalization uses SDK event ID before part/call fallbacks", () => {
  assert.match(
    source,
    /function normalizedCentralizedEventIdentity\(event: UnknownRecord\): string \{[\s\S]*?const eventId = firstNonEmptyString\([\s\S]*?if \(eventId\) \{[\s\S]*?return `event:\$\{eventId\}`;[\s\S]*?const eventType = getCentralizedEventType\(event\);/s,
    "mirrored /event and /global/event payloads must collapse by their shared SDK event ID before renderer fallback identity is considered",
  );
});
