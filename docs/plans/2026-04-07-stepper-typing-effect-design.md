# Stepper Typing Effect Design

**Date:** 2026-04-07
**Status:** Approved
**Author:** Claude (with user approval)

## Overview

This design document outlines a hybrid CSS/JavaScript typing effect for step descriptions/labels in the stepper component. The typing effect provides visual feedback when steps first appear during streaming, creating a more dynamic and engaging user experience while maintaining optimal performance.

**Goals:**
- Add typing animation to step descriptions/labels when they first appear
- Complete animation immediately when step status changes
- Maintain 60fps performance with no main thread blocking
- Zero memory leaks and minimal overhead

## Architecture

### Hybrid Approach

**CSS Layer:** Handles all animation logic using GPU-accelerated transforms
**JavaScript Layer:** Minimal - only toggles CSS classes based on step status

**Why Hybrid?**
- CSS animations run on compositor thread (no main thread blocking)
- Zero layout thrashing during typing
- No timer management complexity
- Immediate completion is just a CSS class toggle
- Best performance with sufficient flexibility

## Component Design

### TypingText Component

**Purpose:** Wrapper component that applies typing animation to text content

**Props Interface:**
```typescript
interface TypingTextProps {
  children: string  // The text to type out
  isTyping?: boolean  // Control typing state (default: true)
  className?: string
}
```

**Behavior:**
- When `isTyping={true}`: Adds CSS class that triggers typing animation
- When `isTyping={false}`: Removes animation class, shows full text immediately
- No timers, intervals, or requestAnimationFrame loops
- Pure CSS animation with JS class toggle

**Implementation:**
```typescript
export const TypingText = React.forwardRef<
  HTMLSpanElement,
  TypingTextProps
>(({ children, isTyping = true, className }, ref) => {
  // Calculate duration based on text length (30ms per char, min 800ms, max 1500ms)
  const duration = Math.min(1500, Math.max(800, children.length * 30))

  return (
    <span 
      ref={ref}
      className={cn(
        "oc-typing-text",
        isTyping && "oc-typing-text--typing",
        className
      )}
      style={{ animationDuration: `${duration}ms` }}
    >
      {children}
    </span>
  )
})
```

## CSS Animation Strategy

### Technique: Mask-Image Animation (Primary)

**Why:** Modern, performant, creates smooth typing effect

```css
.oc-typing-text {
  /* Initially hidden */
  mask-image: linear-gradient(to right, black 50%, transparent 50%);
  mask-size: 200% 100%;
  mask-position: 100% 0;
  /* Fallback for older browsers */
  -webkit-mask-image: linear-gradient(to right, black 50%, transparent 50%);
  -webkit-mask-size: 200% 100%;
  -webkit-mask-position: 100% 0;
}

.oc-typing-text--typing {
  animation: typing-reveal steps(40, end) forwards;
}

@keyframes typing-reveal {
  to {
    mask-position: 0 0;
    -webkit-mask-position: 0 0;
  }
}
```

### Fallback: Max-Width Animation

**For browsers without mask-image support:**

```css
@supports not (mask-image: linear-gradient(to right, black 50%, transparent 50%)) {
  .oc-typing-text {
    display: inline-block;
    overflow: hidden;
    white-space: nowrap;
  }
  
  .oc-typing-text--typing {
    animation: typing-reveal-fallback steps(40, end) forwards;
  }
  
  @keyframes typing-reveal-fallback {
    from {
      max-width: 0;
    }
    to {
      max-width: 100%;
    }
  }
}
```

## Integration with Stepper

### Location in MessageComponents.tsx

**Apply to step labels/descriptions:**

```typescript
// In AssistantMessage component, where step labels are rendered
<TypingText 
  isTyping={event.status === 'pending' || event.status === 'running'}
  className="oc-step-label"
>
  {cleanedLabel || event.label}
</TypingText>
```

**Flow:**
1. Step appears with status "pending" → `isTyping={true}` → CSS animation starts
2. Step status changes to "done" or "error" → `isTyping={false}` → CSS class removed → full text shows instantly
3. No JavaScript timers, no cleanup needed

**Note:** Typing only applies to step labels/descriptions, not to:
- Bash command text (in TerminalBlock)
- File paths
- Diff content
- Other step details

## Performance Optimizations

### 1. GPU Acceleration
- Use `mask-image` property (hardware accelerated)
- No width/height/layout property animations
- `will-change` hint for browser optimization

```css
.oc-typing-text--typing {
  will-change: mask-image, -webkit-mask-image;
}
```

### 2. Animation Suspension
Respect user's motion preferences:

```css
@media (prefers-reduced-motion: reduce) {
  .oc-typing-text--typing {
    animation: none;
    mask-position: 0 0;
    -webkit-mask-position: 0 0;
  }
}
```

### 3. Minimal DOM Manipulation
- One class toggle per step (add/remove `oc-typing-text--typing`)
- No character-by-character DOM updates
- No re-renders during animation
- Zero JavaScript overhead during animation

### 4. Automatic Cleanup
- CSS animations stop automatically when element removed
- No interval/RAF cleanup needed
- No memory leaks possible

## Duration Calculation

**Dynamic Duration Formula:**
```typescript
const duration = Math.min(1500, Math.max(800, text.length * 30))
```

**Rationale:**
- **30ms per character:** Fast typing speed (user preference)
- **800ms minimum:** Even short labels (1-2 chars) have noticeable animation
- **1500ms maximum:** Long labels don't feel too slow

**Examples:**
- "Done" (4 chars): 120ms
- "Running tests" (13 chars): 390ms  
- "Installing dependencies and building project" (42 chars): 1260ms (capped at 1500ms)

## Testing Strategy

### Unit Tests

**File:** `tests/webview/components/TypingText.test.mjs`

**Test Cases:**
1. Component renders text correctly
2. `isTyping={true}` adds CSS class
3. `isTyping={false}` removes CSS class
4. Duration calculated correctly based on text length
5. No memory leaks (verify no timers/intervals)
6. `displayName` is set

### Integration Tests

**File:** `tests/webview/stepper-typing-integration.test.mjs`

**Test Cases:**
1. Step labels use TypingText component
2. Typing starts when step appears
3. Typing completes when status changes
4. Multiple steps can animate simultaneously
5. No interference with existing stepper functionality

### Visual Tests

**Manual verification:**
1. Animation plays smoothly at 60fps
2. No layout shifts during typing
3. Immediate completion works when status changes
4. Multiple steps typing simultaneously perform well
5. Dark/light theme compatibility

### Performance Tests

**Metrics:**
- No jank when 10+ steps typing
- No memory leaks over extended sessions
- Smooth 60fps during animation
- Main thread blocking < 16ms per frame

## Implementation Phases

### Phase 1: Component Creation
1. Create `TypingText.tsx` component
2. Add CSS animations to `index.css`
3. Write unit tests
4. Verify animations work

### Phase 2: Integration
1. Add `TypingText` to step label rendering in `MessageComponents.tsx`
2. Wire up `isTyping` prop to step status
3. Write integration tests
4. Test in development environment

### Phase 3: Polish & Testing
1. Performance profiling
2. Cross-browser testing
3. Reduced motion verification
4. Bug fixes and refinements

## Success Criteria

✅ **Functional:**
- Step labels type out when first appearing
- Animation completes immediately on status change
- Works for all step statuses (pending, running, done, error)

✅ **Performance:**
- Maintains 60fps during animations
- No main thread blocking
- No memory leaks
- Minimal CPU usage

✅ **User Experience:**
- Smooth, natural typing feel
- Fast typing speed (20-30ms per character)
- Respects user motion preferences
- Works in dark and light themes

## Fallback Strategy

**For Older Browsers:**
- Detect `mask-image` support using `@supports`
- Fall back to `max-width` animation
- Graceful degradation (no animation if neither supported)

**Feature Detection:**
```css
@supports (mask-image: linear-gradient(to right, black 50%, transparent 50%)) {
  /* Modern mask-image approach */
}
@supports not (mask-image: linear-gradient(to right, black 50%, transparent 50%)) {
  /* Fallback max-width approach */
}
```

## Future Enhancements

**Out of scope for initial implementation:**
1. Configurable typing speed (user preference)
2. Typing sound effects
3. Variable/random typing speed for more human feel
4. Typing effect for other content (commands, file paths)
5. Cursor blinking effect

## References

- CSS Mask-Image: https://developer.mozilla.org/en-US/docs/Web/CSS/mask-image
- CSS Animation Performance: https://web.dev/animations-guide/
- CSS steps() timing function: https://developer.mozilla.org/en-US/docs/Web/CSS/animation-timing-function
- Existing stepper: `webview/shared/src/components/ui/stepper.tsx`
- MessageComponents: `webview/shared/src/chat/MessageComponents.tsx`

---

**Document Status:** Approved and ready for implementation planning.
