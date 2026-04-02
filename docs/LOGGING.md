# OpenCode Logging System

## Overview

The OpenCode extension uses a structured logging system that provides comprehensive debugging capabilities, feature flow tracking, and performance monitoring. All logs are output as JSON for easy parsing and analysis.

## Features

- **Structured JSON Logging**: All logs are formatted as JSON for machine parsing
- **Correlation IDs**: Track feature flows from start to end
- **Multiple Log Levels**: error, warn, info, debug
- **Performance Tracking**: Automatic detection of slow operations (>3s)
- **State Change Logging**: Track state transitions with old/new values
- **UI Interaction Logging**: Capture user actions for debugging
- **Feature Flow Tracking**: Monitor multi-step operations with steps

## Configuration

Configure logging in your VSCode settings (`settings.json`):

```json
{
  "opencode.logging.level": "info",
  "opencode.logging.enableConsole": true,
  "opencode.logging.enableFile": false,
  "opencode.logging.maxFileSize": 5242880,
  "opencode.logging.maxFiles": 3
}
```

### Settings

- `opencode.logging.level`: Minimum log level (error, warn, info, debug)
- `opencode.logging.enableConsole`: Enable console output
- `opencode.logging.enableFile`: Enable file output to `logs/opencode.log`
- `opencode.logging.maxFileSize`: Max file size before rotation (default: 5MB)
- `opencode.logging.maxFiles`: Number of backup files to keep (default: 3)

## Usage

### Basic Logging

```typescript
import { createLogger } from "./utils/Logger";

const log = createLogger("MyComponent");

// Basic logging
log.info("Component initialized");
log.error("Failed to load data", { itemId }, error);
log.warn("Deprecated API used", { api: "oldMethod" });
log.debug("Internal state", { value: 42 });
```

### Feature Flow Tracking

Track multi-step operations with correlation IDs:

```typescript
// Start a feature flow
const correlationId = log.startFeatureFlow("UserLogin", {
  userId: "user123",
  method: "oauth"
});

// Log steps within the flow
log.featureStep(correlationId, "validateCredentials", { valid: true });
log.featureStep(correlationId, "generateToken", { tokenLength: 32 });

// End the flow with results
log.endFeatureFlow(correlationId, {
  success: true,
  tokenExpiry: "2026-04-03T14:00:00Z"
});
```

### State Change Logging

Log significant state transitions:

```typescript
log.logStateChange("currentSession", oldSessionId, newSessionId, "switchSession");
```

### UI Interaction Logging

Capture user actions:

```typescript
log.logUIInteraction("ChatPanel", "sendMessage", "input", {
  messageLength: 42,
  hasAttachments: false
});
```

### Performance Logging

Track operation duration:

```typescript
const startTime = Date.now();
// ... perform operation ...
const duration = Date.now() - startTime;

log.performance("databaseQuery", duration, {
  query: "SELECT * FROM users",
  resultCount: 150
});
// Automatically logs a warning if duration > 3000ms
```

### AI-Specific Logging

```typescript
// Log AI requests
log.aiRequest(sessionId, modelId, promptText, {
  hasImages: false,
  hasFiles: true
});

// Log AI responses
log.aiResponse(sessionId, responseTime, responseLength);

// Log streaming events
log.aiStreamEvent(sessionId, "content_delta");

// Log token usage
log.tokenUsage(providerId, inputTokens, outputTokens);
```

## Logging Categories

Use predefined categories from `LoggingCategories` for consistency:

```typescript
import { LoggingCategories } from "./utils/LoggingSchema";

const log = createLogger(LoggingCategories.CHAT_VIEW);
const log2 = createLogger(LoggingCategories.QUEUE_MANAGER);
const log3 = createLogger(LoggingCategories.FEATURE_FLOW);
```

Available categories:
- `EXTENSION` - Extension lifecycle events
- `CHAT_VIEW` - Chat view provider operations
- `SESSION_SERVICE` - Session management
- `QUEUE_MANAGER` - Prompt queue operations
- `MODEL_AGENT_MANAGER` - Model and agent management
- `PLAN_MANAGER` - Plan management
- `STREAM_HANDLER` - Stream event processing
- `SERVER_MANAGER` - Server lifecycle
- `UI_INTERACTION` - User interactions
- `FEATURE_FLOW` - Feature flow tracking

## Log Analysis

### Using the CLI Tool

Analyze logs from the command line:

```bash
# Generate a summary
npm run analyze-logs:summary

# Show all feature flows
npm run analyze-logs:flows

# Show errors only
npm run analyze-logs:errors

# Show performance issues
npm run analyze-logs:perf
```

For custom queries, you can run the script directly with tsx:

```bash
npx tsx scripts/analyze-logs.ts logs/opencode.log --category QUEUE_MANAGER
npx tsx scripts/analyze-logs.ts logs/opencode.log --correlation abc123
npx tsx scripts/analyze-logs.ts logs/opencode.log --session sess-456
```

### Programmatic Analysis

Use the `LogQuery` utility class:

```typescript
import { LogQuery } from "./utils/LogQuery";

// Load logs
const logs = await LogQuery.loadLogFile("logs/opencode.log");

// Filter by category
const chatLogs = LogQuery.filterByCategory(logs, "CHAT_VIEW");

// Extract feature flows
const flows = LogQuery.extractFeatureFlows(logs);
flows.forEach(flow => {
  console.log(`Flow: ${flow.featureName} (${flow.duration}ms)`);
});

// Generate debug summary
const summary = LogQuery.generateDebugSummary(logs);
console.log(`Total logs: ${summary.totalLogs}`);
console.log(`Errors: ${summary.errorCount}`);
console.log(`Performance issues: ${summary.performanceIssues.length}`);
```

## Log Format

All logs follow this structure:

```json
{
  "timestamp": "2026-04-02T14:30:00.000Z",
  "level": "info",
  "category": "CHAT_VIEW",
  "message": "Feature started: UserLogin",
  "context": {
    "correlationId": "CHAT_VIEW-1712051400000-abc123",
    "featureName": "UserLogin",
    "userId": "user123"
  }
}
```

### Feature Flow Logs

Feature flows generate multiple log entries:

1. **Start**: `Feature started: {featureName}`
2. **Steps**: `Feature step: {stepName}`
3. **End**: `Feature ended: {featureName}` with duration

All entries share the same `correlationId` for tracking.

## Debugging Tips

### 1. Trace a Feature Flow

```bash
npm run analyze-logs:flows
```

Look for the correlation ID, then filter by it:

```bash
npm run analyze-logs -- --correlation CHAT_VIEW-1712051400000-abc123
```

### 2. Find Performance Issues

```bash
npm run analyze-logs:perf
```

Shows operations taking >3 seconds.

### 3. Debug State Changes

Use LogQuery to extract state changes:

```typescript
const changes = LogQuery.extractStateChanges(logs);
changes.filter(c => c.stateKey === "currentSession");
```

### 4. Analyze UI Interactions

```typescript
const interactions = LogQuery.extractUIInteractions(logs);
interactions.filter(i => i.component === "ChatPanel");
```

## Best Practices

1. **Use Appropriate Levels**:
   - `error`: Failures that prevent functionality
   - `warn`: Potential issues that don't stop execution
   - `info`: Normal operation (default)
   - `debug`: Detailed diagnostics

2. **Feature Flows for Multi-Step Operations**:
   - Always use for operations spanning multiple async steps
   - Include meaningful metadata in `startFeatureFlow`
   - Log important intermediate steps with `featureStep`
   - Always call `endFeatureFlow` (use try/finally)

3. **State Changes for Significant Transitions**:
   - Session switches
   - Mode changes
   - Model/agent changes
   - Queue state changes

4. **Performance Logging**:
   - Wrap database queries, API calls, file operations
   - Automatic warnings for >3s operations
   - Include operation metadata for analysis

5. **UI Interactions**:
   - Log user-initiated actions
   - Include component and action names
   - Add relevant payload data

## File Output

When file logging is enabled, logs are written to:

```
logs/opencode.log           # Current log file
logs/opencode.log.1         # Most recent backup
logs/opencode.log.2         # Second backup
logs/opencode.log.3         # Third backup
```

Files are rotated when they reach `maxFileSize` (default: 5MB).

## Troubleshooting

### No logs appearing

Check your log level setting:
```json
{
  "opencode.logging.level": "debug"
}
```

### Logs not written to file

Ensure file logging is enabled:
```json
{
  "opencode.logging.enableFile": true
}
```

Check the file path in the extension host logs.

### Too many logs

Reduce the log level to "warn" or "error":
```json
{
  "opencode.logging.level": "warn"
}
```

## Examples

See `docs/LOGGING_EXAMPLES.md` for comprehensive examples of logging patterns in real-world scenarios.
