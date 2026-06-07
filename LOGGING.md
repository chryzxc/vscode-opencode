# Logging

This project supports extension and webview logging for diagnostics with a centralized structured logger.

## Configuration

Use VS Code settings under `opencode.logging.*`:

- `opencode.logging.level` - Minimum log level to output (error, warn, info, debug)
- `opencode.logging.enableConsole` - Enable console output for logs
- `opencode.logging.enableFile` - Enable file output for logs
- `opencode.logging.maxFileSize` - Maximum log file size in bytes before rotation (default: 5MB)
- `opencode.logging.maxFiles` - Number of backup log files to keep
- `opencode.logging.consoleOutputMode` - Console output format:
  - `pretty` - Colored text with symbols for readability (default)
  - `json` - Structured JSON for parsing by external tools
  - `hybrid` - Both pretty and JSON output
- `opencode.logging.enableColors` - Enable ANSI colors for console output (default: true)

## Console Output Examples

### Pretty Mode (default)
```
[14:23:45.123] ❌ [ERROR] [ServerManager] Failed to connect {"port": 4097}
[14:23:45.456] ⚠️ [WARN] [SessionService] High memory usage
[14:23:46.789] ℹ️ [INFO] [ChatView] Message sent successfully
[14:23:47.012] 🔍 [DEBUG] [StreamHandler] Processing delta
```

### JSON Mode
```json
{"timestamp":"2026-06-07T14:23:45.123Z","level":"error","category":"ServerManager","message":"Failed to connect","context":{"port":4097}}
```

### Hybrid Mode
Both pretty and JSON output are shown for maximum visibility.

## Centralized Logger

All logging goes through the centralized `Logger` singleton in `src/utils/Logger.ts`. Specialized loggers like `DiagnosticsLogger` use this central logger internally.

### Usage

```typescript
import { createLogger } from "./utils/Logger";

// Create a category-scoped logger
const log = createLogger("MyFeature");

// Basic logging
log.info("Feature started");
log.warn("Potential issue detected");
log.error("Operation failed", { errorCode: 500 }, error);
log.debug("Detailed state", { variables });

// Specialized methods
log.aiRequest(sessionId, modelId, prompt);
log.aiResponse(sessionId, responseTime, responseLength);
log.tokenUsage(providerId, inputTokens, outputTokens);
log.performance("databaseQuery", duration, { query });

// Feature flow tracking
const correlationId = log.startFeatureFlow("DataImport", { source: "api" });
log.featureStep(correlationId, "validation", { recordCount: 100 });
log.endFeatureFlow(correlationId, { imported: 100, failed: 0 });

// State change tracking
log.logStateChange("connectionStatus", "disconnected", "connected", "UserAction");

// UI interaction logging
log.logUIInteraction("ChatPanel", "sendMessage", "sendButton");
```

## Notes

- Logs can be inspected with scripts in `scripts/` (see `npm run analyze-logs`).
- Keep log level at `info` or higher for normal usage.
- File logging is useful for debugging and post-mortem analysis.
- JSON mode is ideal for log aggregation and parsing tools.
