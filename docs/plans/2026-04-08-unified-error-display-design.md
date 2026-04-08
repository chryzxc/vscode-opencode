# Unified Error Display System Design

**Date:** 2026-04-08
**Status:** Approved
**Author:** Claude Code + User

## Overview

This design creates a unified error display system that shows actual error messages (e.g., "Token refresh failed: 401") instead of generic errors (e.g., "I couldn't produce a valid structured response for this turn. Please retry.").

The system handles multiple error types:
- **API Errors** - Raw errors from API responses
- **Timeout Errors** - Request timeouts
- **Structured Output Failures** - Model incompatibilities

## Architecture

### Components

1. **ErrorBuilder Utility** (`src/providers/chat/ErrorBuilder.ts`)
   - Extracts and normalizes errors from multiple sources
   - Returns structured `DisplayError` objects
   - Handles API errors, timeouts, and structured output failures

2. **Enhanced InfoBanner** (`webview/shared/src/chat/MessageComponents.tsx`)
   - Extends existing `InfoBanner` component
   - Accepts `DisplayError` objects
   - Displays errors with appropriate styling and icons
   - Maintains backward compatibility

### Integration Flow

```
ChatViewProvider (error fallback)
  → ErrorBuilder.extractError(message)
  → Returns DisplayError object
  → Set as message.displayError
  → Webview reads message.displayError
  → Enhanced InfoBanner renders error
```

## Data Structures

### DisplayError Interface

```typescript
interface DisplayError {
  type: 'api_error' | 'timeout' | 'structured_output_failure' | 'unknown';
  message: string;
  originalError?: string; // Raw error for debugging
  canRetry: boolean;
  retryWithoutStructuredOutput?: boolean;
  metadata?: {
    statusCode?: number;
    errorName?: string;
    provider?: string;
    model?: string;
  };
}
```

### ErrorBuilder Class

```typescript
class ErrorBuilder {
  constructor(
    private logger: Logger,
    private isLikelyInteractiveAwaitTimeoutError: (msg: string) => boolean
  ) {}

  // Main extraction method
  extractError(message: any): DisplayError | null;

  // Private helpers
  private extractApiError(message: any): DisplayError | null;
  private extractTimeoutError(message: any): DisplayError | null;
  private extractStructuredOutputError(message: any): DisplayError | null;
  private buildGenericError(): DisplayError;
}
```

## Error Extraction Logic

### Priority Order

1. **API Error** - Check `message.info.error.data.message` first
2. **Timeout** - Use existing `isLikelyInteractiveAwaitTimeoutError()` check
3. **Structured Output** - Check for incompatible model keys or empty payloads
4. **Fallback** - Return generic error with `canRetry: true`

### Error Type Examples

- **API Error:** "Token refresh failed: 401"
- **Timeout:** "Request timed out. Please retry."
- **Structured Output:** "Structured output error: this model returned an empty structured payload."

## Enhanced InfoBanner Component

### Component Signature

```typescript
interface InfoBannerProps {
  message?: string;
  error?: DisplayError;
  type?: 'info' | 'warning' | 'error';
}

export function InfoBanner({ message, error, type }: InfoBannerProps)
```

### Error Type Styling

| Error Type | Border Color | Background | Text Color | Icon |
|------------|-------------|------------|------------|------|
| `api_error` | Red | Red-500/10 | Red-200 | AlertCircle |
| `timeout` | Orange | Orange-500/10 | Orange-200 | Clock |
| `structured_output_failure` | Blue | Blue-500/10 | Blue-200 | AlertTriangle |
| `unknown` | Gray | Gray-500/10 | Gray-200 | HelpCircle |

### Conditional Rendering Logic

```typescript
// If error object provided, use it
if (error) {
  displayMessage = error.message;
  styles = errorStyles[error.type] || errorStyles.unknown;
  Icon = styles.icon;
}
// Otherwise fall back to message prop
else if (message) {
  displayMessage = message;
  styles = errorStyles.api_error; // Default for backward compat
  Icon = Info;
}
```

## Implementation Changes

### 1. ChatViewProvider.ts (~line 4630)

**Before:**
```typescript
const fallbackText = incompatibleModelKey &&
  this.structuredOutputIncompatibleModelKeys.has(incompatibleModelKey)
    ? "Structured output error: this model returned an empty structured payload."
    : "I couldn't produce a valid structured response for this turn. Please retry.";
```

**After:**
```typescript
const errorBuilder = new ErrorBuilder(
  this.logger,
  this.isLikelyInteractiveAwaitTimeoutError.bind(this)
);
const displayError = errorBuilder.extractError(message);
const fallbackText = displayError?.message ||
  (incompatibleModelKey && this.structuredOutputIncompatibleModelKeys.has(incompatibleModelKey)
    ? "Structured output error: this model returned an empty structured payload."
    : "I couldn't produce a valid structured response for this turn. Please retry.");
```

### 2. Add displayError to message object (~line 4636)

```typescript
const next: any = {
  ...message,
  content: fallbackText,
  error: fallbackText,
  displayError: displayError, // NEW
  retryWithoutStructuredOutput,
};
```

### 3. Update TypeScript types (lib/types.ts)

```typescript
interface Message {
  // ... existing fields
  displayError?: DisplayError;
}
```

### 4. Update MessageComponents.tsx (~line 3085)

```typescript
// Add new error banner before retry banner
{message?.displayError && (
  <div className="mt-2">
    <InfoBanner error={message.displayError} />
  </div>
)}

// Keep existing retry banner
{message?.retryState === "retrying_without_structured_output" && (
  <div className="mt-2">
    <InfoBanner message={message.retryMessage || "Retrying without structured output..."} />
  </div>
)}
```

## Complete Error Flow Example

```
1. API Error Occurs
   ↓
2. Message received with info.error.data.message = "Token refresh failed: 401"
   ↓
3. ChatViewProvider.applyStructuredOutputToMessage() (line 4611)
   ↓
4. ErrorBuilder.extractError(message) called
   ├─→ Checks message.info.error.data.message → FOUND
   └─→ Returns DisplayError { type: 'api_error', message: "Token refresh failed: 401", ... }
   ↓
5. Set next.displayError = errorResult
   ↓
6. Set next.content = errorResult.message
   ↓
7. Message sent to webview
   ↓
8. MessageComponents.tsx reads message.displayError
   ↓
9. InfoBanner rendered with error prop
   ↓
10. User sees: "Token refresh failed: 401" (red border, alert icon)
```

## Key Design Decisions

1. **Single Error Component** - Enhanced InfoBanner becomes the single source for all error displays
2. **Unified Logic** - ErrorBuilder centralizes all error extraction/detection logic
3. **Extensibility** - Easy to add new error types (rate limits, network errors, etc.) in one place
4. **Maintainability** - Clear separation: provider builds errors, webview displays them
5. **Testability** - ErrorBuilder can be unit tested with mock error data
6. **Backward Compatibility** - Existing InfoBanner usage continues to work
7. **Raw Technical Errors** - Users see exact error messages from APIs

## Future Enhancements

- Error analytics tracking
- User feedback on error helpfulness
- Expandable error details for debugging
- Error recovery suggestions
- Integration with error monitoring services

## Testing Strategy

1. **Unit Tests** - ErrorBuilder with mock error data
2. **Integration Tests** - Error flow from provider to webview
3. **Visual Tests** - InfoBanner rendering for each error type
4. **E2E Tests** - User sees correct error messages in chat

## Files Modified

1. `src/providers/chat/ErrorBuilder.ts` (NEW)
2. `src/providers/ChatViewProvider.ts` (error fallback logic)
3. `src/shared/types.ts` (DisplayError interface)
4. `webview/shared/src/chat/MessageComponents.tsx` (InfoBanner enhancement)
5. `webview/shared/src/chat/lib/types.ts` (Message interface)

## Success Criteria

- ✅ Users see actual error messages (e.g., "Token refresh failed: 401")
- ✅ Timeout errors are properly detected and displayed
- ✅ Single component (InfoBanner) handles all error types
- ✅ Backward compatibility maintained
- ✅ Extensible for future error types
