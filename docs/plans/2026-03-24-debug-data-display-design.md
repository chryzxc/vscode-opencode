# Debug Data Display Design

**Date:** 2026-03-24
**Status:** Approved
**Author:** Claude Code

## Overview

Add comprehensive debug data display below every activity/step in the AI response UI, showing the full event stream data to enable better debugging of the extension's behavior.

## Problem Statement

Currently, activity events (tool calls, progress updates, etc.) are displayed in the UI with extracted display data, but the full underlying event stream data is not visible. This makes debugging difficult when trying to understand what data is being sent through the event pipeline.

## Solution

Add an inline, collapsible `<details>` element below each activity item that displays the full raw event data as formatted JSON.

## Architecture

### Component Structure

```
AssistantMessageInner
  └─ Activity Section (existing)
      └─ Stepper (existing)
          └─ StepperItem (existing)
              ├─ Activity content (existing)
              └─ NEW: <details> element for debug data
                  ├─ <summary> - "Debug" toggle
                  └─ <pre> - Formatted JSON of event data
```

### Data Flow

```
Backend (SSE)
  → MessageStreamService
  → ChatViewProvider.streamEventEnrich
  → Webview (postMessage)
  → messageHandler.ts (store.addEvent)
  → UI Components (render with debug view)
```

## Implementation Details

### 1. TypeScript Types

**File:** `webview/shared/src/chat/lib/types.ts`

Add `rawEvent` field to `DisplayEvent` interface:

```typescript
interface DisplayEvent {
  id: string;
  rank: number;
  // ... existing display fields ...
  rawEvent: StreamingStep | MessageStep; // NEW: Full event data
}
```

### 2. Store Update

**File:** `webview/shared/src/chat/lib/store.ts`

Modify `addEvent()` to preserve full event object:

```typescript
addEvent(state: State, event: StreamingStep | MessageStep): State {
  const displayEvent: DisplayEvent = {
    // ... existing field mappings ...
    rawEvent: event, // NEW: Preserve full event
  };
  // ... rest of logic ...
}
```

### 3. Component: DebugView

**File:** `webview/shared/src/chat/MessageComponents.tsx`

Create new component:

```tsx
function DebugView({ event }: { event: StreamingStep | MessageStep }) {
  const [debugJson, setDebugJson] = useState<string>('');

  useEffect(() => {
    try {
      setDebugJson(JSON.stringify(event, null, 2));
    } catch (e) {
      console.error('Failed to serialize debug data:', e);
      setDebugJson('[Unable to display debug data]');
    }
  }, [event]);

  return (
    <details className="debug-view">
      <summary>Debug</summary>
      <pre>{debugJson}</pre>
    </details>
  );
}
```

### 4. Integrate into StepperItem

**File:** `webview/shared/src/chat/MessageComponents.tsx`

Add `DebugView` after activity content in `StepperItem`:

```tsx
<div className="stepper-item">
  {/* Existing activity content */}
  <div className="activity-content">...</div>

  {/* NEW: Debug view */}
  <DebugView event={displayEvent.rawEvent} />
</div>
```

### 5. Styling

**File:** `webview/shared/src/chat/index.css`

```css
.debug-view {
  margin-top: 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

.debug-view[open] {
  background: var(--background-secondary);
}

.debug-view summary {
  cursor: pointer;
  padding: 4px 8px;
  font-size: 0.85em;
  color: var(--foreground-muted);
  user-select: none;
}

.debug-view pre {
  margin: 0;
  padding: 8px;
  overflow: auto;
  max-height: 300px;
  font-size: 0.8em;
  font-family: var(--monospace);
}
```

## Edge Cases & Error Handling

### Large Events
- **Issue**: Events with huge payloads (e.g., large file reads)
- **Solution**: CSS `max-height: 300px` with `overflow: auto` for scrollable area

### Circular References
- **Issue**: Event objects might contain circular references
- **Solution**: Try-catch around JSON.stringify with fallback error message

### Sensitive Data
- **Issue**: API keys, tokens, or secrets in event data
- **Solution**: Future enhancement - add optional redaction function

### Performance
- **Issue**: Rendering many debug views could slow down UI
- **Solution**: Default collapsed state minimizes DOM impact; lazy expansion on user interaction

### Missing Fields
- **Issue**: Events with undefined/null values
- **Solution**: JSON.stringify handles these naturally (displays as `null` or omitted)

## UI/UX Design

### Visual Layout

```
┌─ Tool: Edit file ─────────────┐
│ ✅ Completed                  │
│ Modified: src/utils.ts        │
│                               │
│ ▶ Debug [▼]                   │  ← Collapsible (default collapsed)
│   └─────────────────────────  │
│   {                           │
│     "id": "evt_123",          │
│     "kind": "progress",        │
│     "callID": "call_456",      │
│     "structured": { ... },     │  ← Full event JSON
│     "timestamp": 1234567890    │
│   }                           │
└───────────────────────────────┘
```

### Behavior
- **Default state**: Collapsed to avoid clutter
- **Persistent**: State not saved across reloads (always starts collapsed)
- **Accessibility**: Keyboard navigable, proper ARIA attributes on `<details>` element

## Future Enhancements (Optional)

1. **Copy to Clipboard**: Button to copy debug JSON to clipboard
2. **Syntax Highlighting**: Integrate highlight.js for prettier JSON display
3. **Filter/Search**: Add search within debug data
4. **Global Toggle**: Command to show/hide all debug views at once
5. **Redaction**: Configurable redaction of sensitive fields

## Testing Considerations

- Test with large events (>100KB) to ensure scrolling works
- Test with events containing circular references
- Test performance with many activities (50+ events)
- Verify keyboard navigation works (Enter/Space to toggle)
- Test JSON serialization doesn't break UI

## Migration Notes

- No breaking changes to existing functionality
- Debug view is additive only - doesn't modify existing display logic
- No backend changes required - full event data already available

## Success Criteria

1. ✅ Debug data visible below every activity
2. ✅ Shows full raw event data (all fields)
3. ✅ Collapsed by default to avoid clutter
4. ✅ Handles large events gracefully
5. ✅ Doesn't break existing UI functionality
