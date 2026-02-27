# OpenCode Logging System

## Overview

A comprehensive logging system has been implemented across the entire OpenCode VS Code extension codebase. This system provides structured, leveled logging with support for console and file output, automatic log rotation, and rich metadata for debugging and monitoring.

## Features

### Log Levels

- **ERROR**: Errors that prevent functionality
- **WARN**: Warning messages for potential issues
- **INFO**: Informational messages about normal operation
- **DEBUG**: Detailed debugging information

### Structured Logging

All logs are structured as JSON for easy parsing:

```json
{
  "timestamp": "2026-02-26T14:50:00.000Z",
  "level": "info",
  "category": "ChatViewProvider",
  "message": "AI Request Sent",
  "context": {
    "sessionId": "session-123",
    "modelId": "opencode/big-pickle",
    "messageLength": 150,
    "hasImages": false,
    "hasFiles": true
  }
}
```

### Specialized Log Methods

- `aiRequest()`: Logs AI prompt submission
- `aiResponse()`: Logs AI response received
- `aiStreamEvent()`: Logs streaming events
- `tokenUsage()`: Logs token consumption
- `serverEvent()`: Logs server lifecycle events
- `sessionEvent()`: Logs session lifecycle events

## Configuration

### VS Code Settings

Add these to your `settings.json`:

```json
{
  "opencode.logging.level": "info",
  "opencode.logging.enableConsole": true,
  "opencode.logging.enableFile": false,
  "opencode.logging.maxFileSize": 5242880,
  "opencode.logging.maxFiles": 3
}
```

### Settings Description

- `opencode.logging.level`: Minimum log level to output (error, warn, info, debug)
- `opencode.logging.enableConsole`: Enable console output for logs
- `opencode.logging.enableFile`: Enable file output for logs
- `opencode.logging.maxFileSize`: Maximum log file size in bytes before rotation (default: 5MB)
- `opencode.logging.maxFiles`: Maximum number of backup log files to keep (default: 3)

## Instrumented Components

### 1. OpencodeServerManager (`src/services/OpencodeServerManager.ts`)

Logs:
- Server start/stop/restart events
- Connection status changes
- Process lifecycle events
- Errors during server operations
- Port allocation and connection details

Example:
```typescript
log.serverEvent("start", { port: 4097 });
log.serverEvent("connect", { port: 4097 });
log.error("Failed to start server", { port: 4097, error });
```

### 2. ChatViewProvider (`src/providers/ChatViewProvider.ts`)

Logs:
- AI request submission with model, agent, attachments
- AI response reception with timing and size
- API errors and retries
- Session recreation events
- User message sending

Example:
```typescript
log.aiRequest("ChatViewProvider", sessionId, modelId, text, {
  agent: "sisyphus",
  hasFiles: true,
  hasContexts: true
});
log.aiResponse("ChatViewProvider", sessionId, duration, responseLength, {
  messageId: "msg-123"
});
```

### 3. SessionService (`src/services/SessionService.ts`)

Logs:
- Session creation, switching, deletion
- Session loading and persistence
- API errors during session operations
- History merging events

Example:
```typescript
log.sessionEvent("create", sessionId, {
  title: "My Planning Session",
  isNewSession: true
});
log.sessionEvent("switch", sessionId, { title: "Previous Session" });
```

### 4. Extension Lifecycle (`src/extension.ts`)

Logs:
- Extension activation with version and workspace info
- Extension deactivation
- Critical errors during lifecycle

Example:
```typescript
log.info("Extension activating", {
  version: "0.1.0",
  workspaceFolders: 2
});
log.error("Extension activation failed", { error });
```

## File Logging

### Log Location

Logs are stored in the extension's global storage directory:
- Windows: `%APPDATA%\\Code\\User\\globalStorage\\opencode-vscode\\logs\\`
- macOS: `~/Library/Application Support/Code/User/globalStorage/opencode-vscode/logs/`
- Linux: `~/.config/Code/User/globalStorage/opencode-vscode/logs/`

### Log Rotation

Logs automatically rotate when they exceed the configured size:
- Current log: `opencode.log`
- Rotated logs: `opencode.log.1`, `opencode.log.2`, `opencode.log.3`
- Oldest logs are automatically deleted when the limit is reached

## Usage

### Basic Logging

```typescript
import { createLogger } from "../utils/Logger";

const log = createLogger("MyModule");

log.info("Something happened", { detail: "value" });
log.warn("Potential issue detected", { context });
log.error("Operation failed", { attempt: 3 }, error);
log.debug("Detailed debugging info", { state });
```

### Specialized Logging

```typescript
// AI event logging
log.aiRequest("ChatViewProvider", sessionId, modelId, prompt, {
  agent: "sisyphus",
  hasFiles: true
});

log.aiResponse("ChatViewProvider", sessionId, 2.5, 1500, {
  messageId: "msg-123"
});

// Server event logging
log.serverEvent("start", { port: 4097 });
log.serverEvent("connect", { port: 4097 });

// Session event logging
log.sessionEvent("create", sessionId, {
  title: "My Session",
  isNewSession: true
});

// Token usage logging
log.tokenUsage("ChatViewProvider", "opencode", 1000, 500, {
  sessionId: "session-123"
});
```

## Best Practices

1. **Use Appropriate Log Levels**
   - ERROR: When something is broken and needs fixing
   - WARN: When something is unusual but not broken
   - INFO: For normal operation flow
   - DEBUG: For detailed diagnostics during development

2. **Include Relevant Context**
   - Add structured context for better debugging
   - Include IDs (session, message, etc.) for correlation
   - Add timing information for performance analysis

3. **Use Specialized Methods When Possible**
   - `aiRequest()` and `aiResponse()` for AI interactions
   - `serverEvent()` for server lifecycle
   - `sessionEvent()` for session management
   - `tokenUsage()` for quota tracking

4. **Never Log Sensitive Information**
   - Don't log API keys or credentials
   - Redact or truncate large payloads
   - Be cautious with user data

## Troubleshooting

### Logs Not Appearing

1. Check log level: Ensure `opencode.logging.level` is set appropriately
2. Check console output: Ensure `opencode.logging.enableConsole` is true
3. Check file output: Ensure `opencode.logging.enableFile` is true
4. Check VSCode output: View logs in the "Output" panel under "Extension Host"

### Log File Access

1. Open Command Palette (Ctrl/Cmd + Shift + P)
2. Run "Open OpenCode Logs Directory"
3. Alternatively, manually navigate to the global storage path

### Performance Issues

If logging causes performance issues:
- Increase `opencode.logging.maxFileSize` to reduce rotation frequency
- Set `opencode.logging.level` to "warn" or "error" to reduce log volume
- Disable file logging if not needed

## Future Enhancements

Potential improvements to the logging system:
1. Log search and filtering in VSCode
2. Integration with external log aggregators
3. Log export functionality
4. Visual log viewer in the extension UI
5. Automatic error reporting and crash detection
6. Performance metrics dashboard
