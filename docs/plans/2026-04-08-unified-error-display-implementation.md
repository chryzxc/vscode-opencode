# Unified Error Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified error display system that shows actual API error messages (e.g., "Token refresh failed: 401") instead of generic errors, with a single ErrorBuilder utility and enhanced InfoBanner component.

**Architecture:**
- Create ErrorBuilder utility class in provider to extract and normalize errors from `message.info.error.data.message`
- Enhance InfoBanner React component to accept DisplayError objects and render with type-specific styling
- Integrate into ChatViewProvider's error fallback path to populate `message.displayError`

**Tech Stack:** TypeScript, React, VSCode Extension API, existing codebase patterns

---

## Task 1: Create DisplayError TypeScript Interface

**Files:**
- Create: `src/shared/types.ts` (if doesn't exist) OR modify: `src/providers/chat/lib/types.ts`
- Test: Integration test in existing test files

**Step 1: Add DisplayError interface to types**

Add this interface to the appropriate types file:

```typescript
/**
 * Normalized error structure for display in webview
 */
export interface DisplayError {
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

**Step 2: Export interface**

Ensure the interface is exported from the types file:

```typescript
export type { DisplayError };
```

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add DisplayError interface

Adds normalized error structure for unified error display system.
Supports api_error, timeout, structured_output_failure, and unknown types."
```

---

## Task 2: Create ErrorBuilder Utility Class

**Files:**
- Create: `src/providers/chat/ErrorBuilder.ts`
- Test: Create: `tests/unit/providers/error-builder.test.ts`

**Step 1: Write failing tests for ErrorBuilder**

Create test file:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { ErrorBuilder } from '../../src/providers/chat/ErrorBuilder';

test.describe('ErrorBuilder', () => {
  test('extracts API error from message.info.error.data.message', () => {
    const mockLogger = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };

    const mockIsTimeoutError = () => false;

    const errorBuilder = new ErrorBuilder(mockLogger, mockIsTimeoutError);

    const message = {
      info: {
        error: {
          name: 'UnknownError',
          data: {
            message: 'Token refresh failed: 401'
          }
        }
      }
    };

    const result = errorBuilder.extractError(message);

    assert.equal(result?.type, 'api_error');
    assert.equal(result?.message, 'Token refresh failed: 401');
    assert.equal(result?.originalError, 'Token refresh failed: 401');
    assert.equal(result?.canRetry, true);
  });

  test('detects timeout errors', () => {
    const mockLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    const mockIsTimeoutError = (msg: string) => msg.toLowerCase().includes('timeout');

    const errorBuilder = new ErrorBuilder(mockLogger, mockIsTimeoutError);

    const message = {
      error: 'Request timeout: 120000ms exceeded'
    };

    const result = errorBuilder.extractError(message);

    assert.equal(result?.type, 'timeout');
    assert.equal(result?.message, 'Request timed out. Please retry.');
    assert.equal(result?.canRetry, true);
  });

  test('returns null when no error found', () => {
    const mockLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    const mockIsTimeoutError = () => false;

    const errorBuilder = new ErrorBuilder(mockLogger, mockIsTimeoutError);

    const message = {
      content: 'Normal message'
    };

    const result = errorBuilder.extractError(message);

    assert.equal(result, null);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/unit/providers/error-builder.test.ts
```

Expected: FAIL - "Cannot find module '../../src/providers/chat/ErrorBuilder'"

**Step 3: Implement ErrorBuilder class**

Create `src/providers/chat/ErrorBuilder.ts`:

```typescript
import type { DisplayError } from '../../shared/types';
import type { Logger } from '../../utils/Logger';

export class ErrorBuilder {
  constructor(
    private logger: Logger,
    private isLikelyInteractiveAwaitTimeoutError: (message: string) => boolean
  ) {}

  /**
   * Extract and normalize error from message object
   */
  extractError(message: any): DisplayError | null {
    if (!message || typeof message !== 'object') {
      return null;
    }

    // Try API error first (highest priority)
    const apiError = this.extractApiError(message);
    if (apiError) {
      return apiError;
    }

    // Try timeout error
    const timeoutError = this.extractTimeoutError(message);
    if (timeoutError) {
      return timeoutError;
    }

    // Try structured output error
    const structuredOutputError = this.extractStructuredOutputError(message);
    if (structuredOutputError) {
      return structuredOutputError;
    }

    return null;
  }

  /**
   * Extract API error from message.info.error.data.message
   */
  private extractApiError(message: any): DisplayError | null {
    const apiErrorMessage = message?.info?.error?.data?.message;

    if (typeof apiErrorMessage === 'string' && apiErrorMessage.trim().length > 0) {
      return {
        type: 'api_error',
        message: apiErrorMessage.trim(),
        originalError: apiErrorMessage,
        canRetry: true,
        metadata: {
          errorName: message?.info?.error?.name,
          statusCode: message?.info?.error?.data?.statusCode,
        },
      };
    }

    return null;
  }

  /**
   * Extract timeout error using existing timeout detection logic
   */
  private extractTimeoutError(message: any): DisplayError | null {
    // Check message.error and message.info.error for timeout indicators
    const errorMessage = message?.error || message?.info?.error?.data?.message || '';

    if (typeof errorMessage === 'string' &&
        this.isLikelyInteractiveAwaitTimeoutError(errorMessage)) {
      return {
        type: 'timeout',
        message: 'Request timed out. Please retry.',
        originalError: errorMessage,
        canRetry: true,
      };
    }

    return null;
  }

  /**
   * Extract structured output error
   */
  private extractStructuredOutputError(message: any): DisplayError | null {
    // This is handled by existing logic in ChatViewProvider
    // We return null here to let the existing incompatible model checks handle it
    return null;
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- tests/unit/providers/error-builder.test.ts
```

Expected: PASS - All 3 tests pass

**Step 5: Commit**

```bash
git add src/providers/chat/ErrorBuilder.ts tests/unit/providers/error-builder.test.ts
git commit -m "feat(error-builder): add ErrorBuilder utility class

- Extracts API errors from message.info.error.data.message
- Detects timeout errors using existing timeout detection
- Returns normalized DisplayError objects
- Handles api_error, timeout, and structured_output_failure types
- Includes comprehensive unit tests"
```

---

## Task 3: Update ChatViewProvider to Use ErrorBuilder

**Files:**
- Modify: `src/providers/ChatViewProvider.ts:4611-4658`
- Test: Manual testing in VSCode extension

**Step 1: Import ErrorBuilder and DisplayError**

Add imports at the top of ChatViewProvider.ts:

```typescript
import { ErrorBuilder } from './chat/ErrorBuilder';
import type { DisplayError } from '../shared/types';
```

**Step 2: Modify error fallback logic**

Locate the error fallback section around line 4630 and replace:

```typescript
// BEFORE (existing code):
const fallbackText =
  incompatibleModelKey &&
    this.structuredOutputIncompatibleModelKeys.has(incompatibleModelKey)
    ? "Structured output error: this model returned an empty structured payload."
    : "I couldn't produce a valid structured response for this turn. Please retry.";
```

Replace with:

```typescript
// AFTER:
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

**Step 3: Add displayError to message object**

Find the message object creation around line 4636 and modify:

```typescript
const next: any = {
  ...message,
  content: fallbackText,
  error: fallbackText,
  displayError: displayError, // ADD THIS LINE
  retryWithoutStructuredOutput,
};
```

**Step 4: Test manually**

1. Start VSCode with extension
2. Open a chat session
3. Trigger an error (e.g., invalid API token)
4. Verify error message shows actual error instead of generic message

**Step 5: Commit**

```bash
git add src/providers/ChatViewProvider.ts
git commit -m "feat(chat): integrate ErrorBuilder for error display

- Use ErrorBuilder to extract actual error messages from API responses
- Add displayError field to message objects
- Shows raw technical errors (e.g., 'Token refresh failed: 401')
- Falls back to generic message if no specific error found"
```

---

## Task 4: Update Message TypeScript Types

**Files:**
- Modify: `webview/shared/src/chat/lib/types.ts`
- Test: TypeScript compilation check

**Step 1: Add DisplayError to Message interface**

Import DisplayError and add to Message interface:

```typescript
import type { DisplayError } from '../../../../src/shared/types';

export interface Message {
  // ... existing fields
  displayError?: DisplayError;
}
```

**Step 2: Verify TypeScript compilation**

```bash
npm run compile
```

Expected: No TypeScript errors related to displayError field

**Step 3: Commit**

```bash
git add webview/shared/src/chat/lib/types.ts
git add src/shared/types.ts
git commit -m "feat(types): add displayError to Message interface

- Add optional displayError field to Message interface
- Import DisplayError type from shared types"
```

---

## Task 5: Enhance InfoBanner Component

**Files:**
- Modify: `webview/shared/src/chat/MessageComponents.tsx:3516-3540`
- Test: Visual testing in webview

**Step 1: Update InfoBanner component signature**

Modify the InfoBanner component:

```typescript
import type { DisplayError } from '../../../../src/shared/types';
import { AlertCircle, Clock, AlertTriangle, HelpCircle, Info } from 'lucide-react';

interface InfoBannerProps {
  message?: string;
  error?: DisplayError;
  type?: 'info' | 'warning' | 'error';
}

export function InfoBanner({ message, error, type }: InfoBannerProps) {
  // Error type styling configuration
  const errorStyles = {
    api_error: {
      borderColor: 'border-red-500/50',
      bgColor: 'bg-red-500/10',
      textColor: 'text-red-200',
      icon: AlertCircle
    },
    timeout: {
      borderColor: 'border-orange-500/50',
      bgColor: 'bg-orange-500/10',
      textColor: 'text-orange-200',
      icon: Clock
    },
    structured_output_failure: {
      borderColor: 'border-blue-500/50',
      bgColor: 'bg-blue-500/10',
      textColor: 'text-blue-200',
      icon: AlertTriangle
    },
    unknown: {
      borderColor: 'border-gray-500/50',
      bgColor: 'bg-gray-500/10',
      textColor: 'text-gray-200',
      icon: HelpCircle
    }
  };

  // Determine display message and styling
  let displayMessage: string;
  let styles = errorStyles.api_error;
  let Icon = Info;

  if (error) {
    displayMessage = error.message;
    styles = errorStyles[error.type] || errorStyles.unknown;
    Icon = styles.icon;
  } else if (message) {
    displayMessage = typeof message === 'string' && message.trim().length > 0
      ? message.trim()
      : 'Working...';
    styles = errorStyles.api_error; // Default for backward compat
    Icon = Info;
  } else {
    displayMessage = 'Working...';
    styles = errorStyles.api_error;
    Icon = Info;
  }

  return (
    <div className="mb-2 px-4">
      <div className={`flex flex-col gap-2 rounded-lg border ${styles.borderColor} ${styles.bgColor} p-2.5 text-oc-xs ${styles.textColor} shadow-[0_4px_14px_rgba(30,58,138,0.18)] transition-all duration-200`}>
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md border ${styles.borderColor} ${styles.bgColor}`}>
            <Icon className="h-3 w-3" />
          </span>
          <span className="flex-1 font-medium">{displayMessage}</span>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add error banner rendering in message component**

Locate where retry banner is rendered (around line 3085) and add error banner before it:

```typescript
{/* Add new error banner */}
{message?.displayError && (
  <div className="mt-2">
    <InfoBanner error={message.displayError} />
  </div>
)}

{/* Keep existing retry banner */}
{message?.retryState === "retrying_without_structured_output" && (
  <div className="mt-2">
    <InfoBanner
      message={
        message.retryMessage ||
        "Retrying without structured output..."
      }
    />
  </div>
)}
```

**Step 3: Test visually**

1. Start VSCode with extension
2. Trigger different error types (API error, timeout)
3. Verify correct styling and icons for each error type

**Step 4: Commit**

```bash
git add webview/shared/src/chat/MessageComponents.tsx
git commit -m "feat(ui): enhance InfoBanner for error display

- Accept DisplayError objects with type-specific styling
- Support api_error (red), timeout (orange), structured_output_failure (blue)
- Maintain backward compatibility with existing message prop
- Add appropriate icons for each error type
- Render error banner in message components"
```

---

## Task 6: Integration Testing

**Files:**
- Test: Manual integration testing
- Documentation: Update README if needed

**Step 1: Test API error display**

1. Use invalid API credentials
2. Send a message
3. Verify error shows: "Token refresh failed: 401" with red border and alert icon

**Step 2: Test timeout error display**

1. Trigger a timeout (use very short timeout setting)
2. Send a long-running request
3. Verify error shows: "Request timed out. Please retry." with orange border and clock icon

**Step 3: Test backward compatibility**

1. Trigger a structured output error
2. Verify blue banner appears with triangle icon
3. Verify existing retry banners still work

**Step 4: Document new error types**

If needed, update README.md to document the new error display behavior:

```markdown
## Error Display

The extension shows specific error messages from the API instead of generic errors:

- **API Errors** (Red): Raw errors from API responses (e.g., "Token refresh failed: 401")
- **Timeout Errors** (Orange): Request timeout messages
- **Structured Output Errors** (Blue): Model compatibility issues

All errors include appropriate icons and can be retried.
```

**Step 5: Final commit**

```bash
git add README.md (if modified)
git commit -m "docs: document unified error display system

- Document error types and their visual appearance
- Add troubleshooting guidance for common errors"
```

---

## Task 7: Cleanup and Verification

**Files:**
- Test: Full regression test
- Documentation: Update change log

**Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass

**Step 2: Build extension**

```bash
npm run build
```

Expected: Build succeeds without errors

**Step 3: Manual smoke test**

1. Load extension in VSCode
2. Start a new chat session
3. Send normal message - verify works
4. Trigger error - verify specific error message shows
5. Retry failed message - verify works
6. Check browser console for errors

**Step 4: Update CHANGELOG**

Add entry to CHANGELOG.md:

```markdown
## [Unreleased]

### Added
- Unified error display system with ErrorBuilder utility
- Enhanced InfoBanner component with type-specific styling
- Actual API error messages shown to users (e.g., "Token refresh failed: 401")
- Timeout error detection and display
- DisplayError TypeScript interface for error normalization

### Changed
- Error messages now show raw technical errors instead of generic messages
- InfoBanner component accepts both message and error props
```

**Step 5: Final commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for unified error display

- Document new ErrorBuilder utility
- Document enhanced InfoBanner component
- Document new error types and display behavior"
```

---

## Summary

This implementation plan creates a unified error display system through:

1. **ErrorBuilder utility** - Extracts and normalizes errors from multiple sources
2. **Enhanced InfoBanner** - Displays errors with type-specific styling and icons
3. **ChatViewProvider integration** - Uses ErrorBuilder in error fallback path
4. **TypeScript types** - DisplayError interface and Message type updates
5. **Comprehensive testing** - Unit tests, manual testing, and integration testing

The system shows actual error messages to users while maintaining backward compatibility and providing extensible architecture for future error types.

**Estimated Time:** 2-3 hours for full implementation including testing

**Success Criteria:**
- ✅ Users see "Token refresh failed: 401" instead of generic error
- ✅ Timeout errors display with appropriate styling
- ✅ Single InfoBanner component handles all error types
- ✅ All tests pass
- ✅ No regression in existing functionality
