import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const messageHandlerSource = readFileSync(
  new URL(
    "../../webview/shared/src/chat/lib/messageHandler.ts",
    import.meta.url,
  ),
  "utf8",
);

test("message-part reasoning updates retain the SDK part and message identity", () => {
  const partEventHandler = messageHandlerSource.slice(
    messageHandlerSource.indexOf("case 'message.part.updated':"),
    messageHandlerSource.indexOf("case 'message.updated':"),
  );

  assert.match(
    partEventHandler,
    /type:\s*["']UPDATE_STREAMING_REASONING["'][\s\S]*?partID:\s*reasoningPartID,[\s\S]*?messageID:\s*messageId\s*\|\|\s*undefined/s,
    "live reasoning must carry the IDs used to replace it with its finalized counterpart",
  );
});
