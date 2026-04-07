# Stepper UI/UX Improvements Design

**Date:** 2026-04-07
**Status:** Approved
**Author:** Claude (with user approval)

## Overview

This design document outlines comprehensive improvements to the stepper component's UI/UX, focusing on better visual hierarchy, enhanced step content with expandable sections, and a simplified terminal-inspired design for bash commands.

**Goals:**
- Create a simplified terminal-inspired UI for bash commands (shell prompt + monospace)
- Add expandable/collapsible sections for step details with smart defaults
- Improve visual hierarchy with better status indicators and animations
- Enhance layout, spacing, and responsive behavior
- Maintain backward compatibility with existing stepper functionality

## Architecture

### Core Components (Preserved)

**Existing Components to Keep:**
- `Stepper` - Container with auto-scroll functionality
- `StepperItem` - Individual step wrapper with indicators

**Why:** These components are proven, well-tested, and working. No need to replace them.

### New Specialized Components

**Components to Create:**
1. **TerminalBlock** - Simplified terminal-style bash command display
2. **ExpandableStep** - Collapsible wrapper for step content
3. **StepIndicator** - Enhanced status indicators with better icons/animations

**Integration Points:**
- `MessageComponents.tsx` - Wire new components into existing stepper rendering
- `index.css` - Add new CSS classes for enhanced styling
- `types.ts` - Extend step interfaces if needed

### Design Philosophy

- **Non-breaking changes** - Existing behavior preserved
- **Progressive enhancement** - New features opt-in via props
- **Smart defaults** - Expand errors/file changes, collapse routine steps
- **VSCode theme integration** - Use existing CSS variables

## Component Design

### 1. TerminalBlock Component

**Purpose:** Display bash commands in a simplified terminal-inspired style

**Features:**
- Monospace font with shell prompt (`$`)
- Command text in pre/code block
- Optional output section (for future use)
- Copy button for command
- Minimal styling - no chrome/window controls

**Props Interface:**
```typescript
interface TerminalBlockProps {
  command: string
  output?: string  // Optional for future use
  className?: string
}
```

**Visual Style:**
- Dark background matching VSCode terminal
- Colored prompt (`$`) using accent color
- Monospace font (SF Mono, Consolas)
- Same styling as current `.oc-bash-command-block` but refined

**Implementation Notes:**
- Reuse existing `.oc-bash-command-block` CSS with refinements
- No macOS window controls or complex chrome
- Focus on clean, functional display
- Copy button uses clipboard API

---

### 2. ExpandableStep Component

**Purpose:** Collapsible wrapper for step content with smart defaults

**Features:**
- Chevron icon indicating expand/collapse state
- Smooth height transitions
- Smart default expanded state (errors/changes expanded, routine collapsed)
- Click-to-toggle or keyboard accessible
- Persist collapse state in session storage (optional)

**Props Interface:**
```typescript
interface ExpandableStepProps {
  children: React.ReactNode
  defaultExpanded?: boolean
  isImportant?: boolean  // Error, file change, etc.
  className?: string
}
```

**Expansion Logic:**
1. If `defaultExpanded` provided, use it
2. Else if `isImportant` is true, default to expanded
3. Else default to collapsed

**Implementation Notes:**
- Local state for `isExpanded`
- Toggle via onClick handler
- Keyboard accessible (Enter/Space)
- ARIA attributes for expanded/collapsed state
- Smooth CSS transitions for height

---

### 3. StepIndicator Enhancement

**Purpose:** Enhanced status indicators with better visual hierarchy

**States:**
- **Pending** - Animated pulse dot (current behavior, refined)
- **Done** - Green checkmark with subtle success animation
- **Error** - Red X with shake animation
- **Running** - Spinning loader for active execution

**Visual Improvements:**
- Larger, more prominent icons
- Better color contrast using VSCode status colors
- Subtle animations for state changes
- Optional status text label

**Implementation Notes:**
- Pure presentational component
- No internal state
- Receives status via props
- Uses lucide-react icons (Check, X, Loader2)
- CSS animations for pulse, shake, spin

---

### 4. Integration with StepperItem

The enhanced `StepperItem` will remain structurally similar but content will be wrapped:

```tsx
<StepperItem indicator={<StepIndicator status={event.status} />}>
  <ExpandableStep isImportant={event.status === 'error' || event.filePath}>
    {event.activityDetail?.command ? (
      <TerminalBlock command={event.activityDetail.command} />
    ) : (
      // Existing content rendering
    )}
  </ExpandableStep>
</StepperItem>
```

**Key Points:**
- Minimal changes to existing StepperItem structure
- New components wrap existing content
- Backward compatible with current step rendering

## Data Flow & State Management

### Step Data Flow

**Current Flow (Preserved):**
```
streaming.steps / message.parts
  → progressItemsFromStreaming/Message
  → buildTimeline
  → buildDisplayEvents
  → timelineDisplayEvents
  → StepperItem rendering
```

**Enhanced Flow:**
```
Same data pipeline
  → Add smart expansion flags to display events
  → Pass through to new wrapper components
  → TerminalBlock receives command string
  → ExpandableStep receives isImportant flag
```

**Key Points:**
- No changes to data pipeline - purely additive
- Expansion state computed in `buildDisplayEvents`
- `isImportant` determined from event properties

### Expansion State Logic

**Computed in `buildDisplayEvents`:**

```typescript
// Add to display event object
isImportant:
  event.status === 'error' ||
  Boolean(event.filePath) ||
  Boolean(event.diffStats) ||
  Boolean(event.viewDiffFile) ||
  event.label === 'error'
```

**Why Here?**
- Centralized logic, easy to test
- Based on event data, not UI state
- Consistent between streaming and hydration

### Component State (Local)

**ExpandableStep:**
- `isExpanded` state (boolean)
- Initialized from props (defaultExpanded, isImportant)
- Toggle via onClick handler
- Optional: persist to session storage for user preference

**No Global State Needed:**
- Expansion is UI-only, ephemeral
- Doesn't affect message data or persistence
- Each step independent

### TerminalBlock State

**Pure Presentational Component:**
- No internal state
- Receives command via props
- Copy button can use standard clipboard API
- Output rendering optional for future

## Error Handling & Edge Cases

### Component Error Boundaries

**TerminalBlock:**
- Empty command → render nothing or placeholder
- Malformed command → still render, log warning
- Copy failure → show tooltip error, don't break UI

**ExpandableStep:**
- Missing children → render empty expanded section
- Toggle failure → fallback to always expanded
- Animation issues → disable transitions gracefully

**StepIndicator:**
- Unknown status → default to pending/loading
- Missing status prop → show neutral indicator
- Animation performance issues → disable animations

### Data Validation

**Command Display:**
```typescript
// In TerminalBlock
if (!command || typeof command !== 'string') {
  return null // or placeholder
}
```

**Expansion Logic:**
```typescript
// Defensive checks in buildDisplayEvents
isImportant: Boolean(
  event?.status === 'error' ||
  event?.filePath ||
  event?.diffStats ||
  event?.viewDiffFile
)
```

### Accessibility Edge Cases

**Keyboard Navigation:**
- ExpandableStep must be keyboard accessible (Enter/Space)
- TerminalBlock copy button must be focusable
- Stepper indicators need aria-labels

**Screen Readers:**
- Expanded/collapsed state announced
- Status indicators have text alternatives
- Command blocks marked as `<code>` or `<pre>`

**Reduced Motion:**
- Respect `prefers-reduced-motion`
- Disable animations for pulse, shake, transitions
- Still show visual states, just without motion

### Performance Edge Cases

**Many Steps:**
- Existing `MAX_VISIBLE_COMPLETED_ACTIVITY = 5` still applies
- Expansion state only for visible steps
- Don't animate off-screen steps

**Large Command Output:**
- Terminal output truncated with "show more" (future)
- Virtual scrolling if needed (future)
- Currently, no output rendering (commands only)

## Testing Strategy

### Unit Tests

**TerminalBlock:**
- Renders command correctly
- Shows prompt symbol
- Handles empty/missing command
- Copy button functionality
- CSS classes applied correctly

**ExpandableStep:**
- Default expansion states (important vs routine)
- Toggle functionality
- Keyboard accessibility
- ARIA attributes
- Smooth transitions

**StepIndicator:**
- All status states (pending, done, error, running)
- Correct icons for each state
- Animations applied/removed
- Accessibility labels

### Integration Tests

**Stepper Integration:**
- TerminalBlock renders within StepperItem
- ExpandableStep wraps content correctly
- Smart expansion logic works
- Auto-scroll still functions
- Existing stepper tests still pass

**Message Pipeline:**
- `buildDisplayEvents` adds `isImportant` flag
- Expansion flags computed correctly
- No regression in step deduplication
- Streaming vs hydration parity

### Visual Regression Tests

**CSS Changes:**
- Terminal styling matches VSCode theme
- Expansion animations work
- Responsive behavior
- Dark/light theme compatibility

**Component Snapshots:**
- TerminalBlock snapshots
- ExpandableStep expanded/collapsed
- StepIndicator all states
- Full stepper with new components

### Accessibility Tests

**Keyboard Navigation:**
- Tab order logical
- Enter/Space toggles expandable steps
- Focus indicators visible

**Screen Reader:**
- NVDA/JAWS announce expanded state
- Status labels read correctly
- Command blocks identified as code

**Contrast & Motion:**
- WCAG AA contrast ratios
- Reduced motion respected
- Text sizing respects user preferences

### Performance Tests

**Rendering:**
- No performance regression with many steps
- Expansion animations don't block main thread
- Smooth 60fps animations

**Bundle Size:**
- Measure added component sizes
- Ensure no significant bundle increase
- Tree-shaking works for new components

## Implementation Phases

### Phase 1: Foundation (Week 1)
1. Create `TerminalBlock` component
2. Add CSS for terminal styling
3. Write unit tests
4. Integrate into MessageComponents

### Phase 2: Expandability (Week 1-2)
1. Create `ExpandableStep` component
2. Add expansion logic to `buildDisplayEvents`
3. Implement smart defaults
4. Write unit and integration tests

### Phase 3: Enhanced Indicators (Week 2)
1. Create `StepIndicator` component
2. Add enhanced animations
3. Improve visual hierarchy
4. Write unit tests

### Phase 4: Polish & Testing (Week 2-3)
1. Accessibility audit
2. Performance testing
3. Visual regression testing
4. Bug fixes and refinements

## Success Criteria

✅ **Functional:**
- Bash commands display in terminal-inspired style
- Steps expand/collapse with smart defaults
- Status indicators are clear and accessible
- All existing functionality preserved

✅ **Quality:**
- All tests pass (unit, integration, visual regression)
- Accessibility standards met (WCAG AA)
- No performance regression
- Bundle size increase minimal (< 5KB)

✅ **User Experience:**
- Clear visual hierarchy
- Smooth animations and transitions
- Keyboard accessible
- Works in dark and light themes

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance regression with many steps | High | Use existing condensed view, limit expansion animations |
| Breaking existing stepper functionality | High | Minimal changes to core components, comprehensive testing |
| Bundle size increase | Medium | Tree-shaking, code splitting, measure impact |
| Accessibility issues | Medium | Built-in from start, audit before completion |
| Theme compatibility issues | Low | Use VSCode CSS variables, test both themes |

## Future Enhancements

Out of scope for this design but worth considering:

1. **Terminal Output Rendering** - Show command output in TerminalBlock
2. **Command History** - Navigate previous commands in terminal
3. **Step Search/Filter** - Filter steps by type or content
4. **Step Grouping** - Group related steps together
5. **User Preferences** - Remember expansion preferences across sessions
6. **Diff Viewer Integration** - Better diff preview in expandable steps

## References

- Existing stepper implementation: `webview/shared/src/components/ui/stepper.tsx`
- MessageComponents rendering: `webview/shared/src/chat/MessageComponents.tsx`
- Current CSS: `webview/shared/src/chat/index.css` (lines 2088-2333)
- Test suite: `tests/webview/stepper-autoscroll-and-flow.test.mjs`

---

**Document Status:** Approved and ready for implementation planning.
