# Logging Best Practices Guide

This guide provides best practices for structured logging in the OpenCode VSCode extension to ensure logs are readable, searchable, and useful for debugging.

## Core Principles

### 1. Use Structured Messages
❌ **Bad:** `Session ${session.id}: ${existingMessages.length} existing messages`  
✅ **Good:** `"Session message context loaded"` with context `{ sessionId, existingMessageCount, isNewSession }`

**Why:** Structured messages are parseable by log analysis tools and easier to search.

### 2. Keep Messages Action-Oriented
❌ **Bad:** `"handleGetMcpStatus error"`  
✅ **Good:** `"Failed to get MCP server status"`

**Why:** Action-oriented messages clearly describe what happened or what failed.

### 3. Move Dynamic Data to Context
❌ **Bad:** `log.error("Failed to read file ${filePath}", { filePath })`  
✅ **Good:** `log.error("Failed to read attached file", { filePath, error })`

**Why:** Keeps message format consistent and makes logs easier to parse.

### 4. Use Appropriate Log Levels
- **error**: Operation failed and functionality is broken
- **warn**: Potential issue but operation continues (fallbacks, retries)
- **info**: Normal operation milestones and state changes
- **debug**: Detailed diagnostic information for troubleshooting

### 5. Include Relevant Context
Always include relevant identifiers and metadata:
```typescript
log.error("Failed to abort active request", {
  sessionId: resolvedSessionId,
  error: error instanceof Error ? error.message : String(error),
}, error as Error);
```

### 6. Use Feature Flow Tracking
For multi-step operations, use feature flow tracking:
```typescript
const flow = log.startFeatureFlow('DataImport', { source: 'api' });
log.featureStep(flow, 'validation', { valid: 95, invalid: 5 });
log.endFeatureFlow(flow, { success: true, imported: 95 });
```

## Message Format Patterns

### Error Messages
**Pattern:** `"Failed to <action> <target>"`
```typescript
log.error("Failed to read attached image", {
  filePath: uri.fsPath,
  error: error.message,
}, error);
```

### Warning Messages
**Pattern:** `"<target> failed, <fallback action>"` or `"Failed to <action>, <consequence>"`
```typescript
log.warn("SDK file search failed, using VS Code fallback", {
  query,
  error: error.message,
});
```

### Info Messages
**Pattern:** `"<target> <action> past tense>"` or `"<action> <target>"`
```typescript
log.info("MCP server status sent to webview", {
  serverCount: Object.keys(servers).length,
  toolCount: toolIds.length,
});
```

### Debug Messages
**Pattern:** `"<component> <state/detailed action>"` or `"<action> completed"`
```typescript
log.debug("Session message context loaded", {
  sessionId: session.id,
  existingMessageCount: existingMessages.length,
  isNewSession,
});
```

## Context Object Guidelines

### Always Include
- **Identifiers**: `sessionId`, `filePath`, `messageId`, `correlationId`
- **Error details**: `error: error.message` (if Error object)
- **Counts/quantities**: `count`, `duration`, `size`

### Naming Convention
Use **camelCase** for context keys:
```typescript
✅ { sessionId, existingMessageCount, isNewSession }
❌ { session_id, existing_message_count, is_new_session }
```

### Derived Data
Calculate and include relevant derived values:
```typescript
log.debug("AI response received", {
  sessionId: session.id,
  durationSeconds: duration,  // Calculated value
  hasData: Boolean(responseData),
  status: response.response?.status,
});
```

## Error Handling Patterns

### With Error Object
```typescript
} catch (error) {
  log.error("Failed to read attached file", {
    filePath,
    error: error instanceof Error ? error.message : String(error),
  }, error as Error);
}
```

### Without Error Object
```typescript
} catch (error) {
  log.error("Failed to abort active request", {
    sessionId: resolvedSessionId,
    error: error instanceof Error ? error.message : String(error),
  }, error as Error);
}
```

## Feature Flow Examples

### Simple Flow
```typescript
const flow = log.startFeatureFlow('FileSearch', { query });
try {
  const results = await searchFiles(query);
  log.endFeatureFlow(flow, { 
    result: 'completed', 
    resultCount: results.length 
  });
} catch (error) {
  log.endFeatureFlow(flow, { 
    result: 'failed', 
    error: String(error) 
  });
}
```

### Multi-Step Flow
```typescript
const flow = log.startFeatureFlow('DataImport', { source: 'api' });
log.featureStep(flow, 'validation', { valid: 95, invalid: 5 });
log.featureStep(flow, 'transformation', { transformed: 95 });
log.featureStep(flow, 'loading', { loaded: 95 });
log.endFeatureFlow(flow, { success: true, imported: 95 });
```

## Searchable Logs

Good logs make it easy to:
1. **Find errors:** Search for "Failed" or "error" level
2. **Track sessions:** Search for specific `sessionId`
3. **Measure performance:** Search for "duration" or "performance"
4. **Debug features:** Search for feature names in feature flows

## Console Output Examples

### Pretty Mode (default)
```
[14:23:45.123] ❌ [ERROR] [ChatView] Failed to read attached file {"filePath":"src/app.ts","error":"ENOENT"}
[14:23:45.456] ⚠️ [WARN] [ChatView] SDK file search failed, using VS Code fallback {"query":"test"}
[14:23:46.789] ℹ️ [INFO] [ChatView] MCP server status sent to webview {"serverCount":3,"toolCount":15}
[14:23:47.012] 🔍 [DEBUG] [ChatView] Session message context loaded {"sessionId":"abc-123","existingMessageCount":42}
```

### JSON Mode
```json
{"timestamp":"2026-06-07T14:23:45.123Z","level":"error","category":"ChatView","message":"Failed to read attached file","context":{"filePath":"src/app.ts","error":"ENOENT"}}
```

## Common Mistakes to Avoid

1. **Embedding data in messages:** Don't use template strings for dynamic values
2. **Vague messages:** Avoid "error occurred" or "failed" without context
3. **Missing identifiers:** Always include relevant IDs (sessionId, filePath, etc.)
4. **Inconsistent naming:** Use the same terminology across logs
5. **Wrong log levels:** Don't use `error` for recoverable issues

## Testing Your Logs

1. **Enable JSON mode** and verify logs parse correctly
2. **Search for specific patterns** to ensure they're found
3. **Check console output** in both pretty and hybrid modes
4. **Verify error context** includes all relevant information
