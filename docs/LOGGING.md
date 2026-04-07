# Logging Documentation

## Overview

The vscode-opencode extension implements comprehensive logging to support debugging, performance monitoring, and feature flow tracking. Logs are categorized by functional area and include correlation IDs for tracking operations across components.

## Features

### Feature Flow Tracking

Track the progression of user-initiated features through the system using correlation IDs. Each feature flow generates a unique correlation ID that allows tracing the operation across all components.

### State Change Logging

Monitor state transitions in components to understand how application state evolves. These logs capture before/after state, change triggers, and component context.

### UI Interaction Logging

Record all user interactions with the UI, including clicks, input changes, and navigation events. This helps diagnose UI-related issues and understand user workflows.

### Performance Logging

Track performance metrics and timing information for critical operations. Allows identification of bottlenecks and performance regressions.

### Server Events

Monitor OpenCode server communication including connection status, request/response times, and error conditions.

### Stream Handler Events

Track SSE stream event processing, including event types, payload sizes, and processing duration

## Configuration

Logging configuration is managed through the extension settings and the logger context. Log levels and categories can be controlled programmatically.

## Usage

Logging can be accessed and analyzed through several methods.

## Log Analysis

### Using the CLI Tool

The extension includes CLI tools for analyzing logs programmatically:

```bash
npm run analyze-logs          # Display all logs
npm run analyze-logs:summary  # Show summary statistics
npm run analyze-logs:flows    # Show feature flows only
npm run analyze-logs:errors   # Show errors only
npm run analyze-logs:perf     # Show performance metrics
```

### Programmatic Analysis

You can analyze logs programmatically using the LogQuery API:

```typescript
import { LogQuery } from "./utils/LogQuery";

const query = new LogQuery();
const results = query
  .findByCategory("CHAT_VIEW")
  .inTimeRange(startTime, endTime);

// Find specific events
const messageFlows = query.findByFeatureFlow("message-sent");
const errors = query.findByLevel("error");

// Aggregate results
const performanceStats = query
  .filterByCategory("STREAM_HANDLER")
  .aggregateByDuration();
```

## Logging Categories

The following logging categories are used throughout the extension:

- **EXTENSION**: Extension lifecycle and initialization
- **CHAT_VIEW**: Chat view provider and message handling
- **SESSION_SERVICE**: Session management and persistence
- **QUEUE_MANAGER**: Message queue and dispatch operations
- **MODEL_AGENT_MANAGER**: Model and agent coordination
- **PLAN_MANAGER**: Implementation plan handling
- **STREAM_HANDLER**: SSE stream event processing
- **SERVER_MANAGER**: OpenCode server lifecycle
- **UI_INTERACTION**: User interface interactions
- **FEATURE_FLOW**: Feature flow tracking and correlation

## Log Format

Logs follow a structured format with timestamp, category, level, message, and optional context:

```json
{
  "timestamp": "2026-04-07T10:30:45.123Z",
  "category": "CHAT_VIEW",
  "level": "info",
  "message": "Message sent",
  "correlationId": "flow-123456",
  "context": { "sessionId": "sess-1" }
}
```

## Debugging Tips

- Use correlation IDs to trace operations across components
- Check the FEATURE_FLOW category for user-initiated operations
- Monitor STREAM_HANDLER logs for server communication issues
- Review SERVER_MANAGER logs for connection problems

## Best Practices

- Always include correlation IDs in feature flows
- Log at appropriate levels (debug, info, warn, error)
- Include relevant context in log messages
- Clean up logs periodically to prevent storage bloat

## File Output

Logs are written to `logs/opencode.log` in the workspace. The file is rotated based on size to prevent it from growing too large.

## Troubleshooting

### Missing Logs

If logs are not appearing:

1. Check that the logs directory exists
2. Verify file permissions
3. Check the extension settings for log level configuration

### Performance Issues

If logging is impacting performance:

1. Reduce log level to 'warn' or 'error'
2. Disable feature flow tracking if not needed
3. Check for excessive logging in loops

## Examples

### Tracing a Message Flow

```bash
npm run analyze-logs:flows | grep "message-sent"
```

### Finding Errors in Time Range

```bash
npm run analyze-logs:errors | grep "2026-04-07T10:30"
```

### Analyzing Performance

```bash
npm run analyze-logs:perf
```
