# Stepper Typing Effect Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a hybrid CSS/JavaScript typing effect to step labels/descriptions in the stepper component for better visual feedback during streaming.

**Architecture:** Hybrid approach - CSS mask-image animation handles the typing effect (GPU-accelerated, no main thread blocking), JavaScript only toggles CSS classes based on step status changes.

**Tech Stack:** React, TypeScript, CSS mask-image animations, Lucide React icons, existing VSCode extension API

---

## Task 1: Create TypingText Component

**Files:**
- Create: `webview/shared/src/components/ui/TypingText.tsx`
- Modify: `webview/shared/src/components/ui/index.ts` (export new component)
- Test: `tests/webview/components/TypingText.test.mjs` (new file)

### Step 1: Write the failing test

Create `tests/webview/components/TypingText.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '@testing-library/react';
import { TypingText } from '../../webview/shared/src/components/ui/TypingText';

test('TypingText renders children correctly', () => {
  const { container } = render(<TypingText>Test Text</TypingText>);
  const text = container.querySelector('.oc-typing-text');
  
  assert.ok(text, 'TypingText container should exist');
  assert.equal(text.textContent, 'Test Text', 'Should render children text');
});

test('TypingText adds typing class when isTyping is true', () => {
  const { container } = render(<TypingText isTyping={true}>Test</TypingText>);
  const text = container.querySelector('.oc-typing-text');
  
  assert.ok(text?.classList.contains('oc-typing-text--typing'), 'Should have typing class when isTyping is true');
});

test('TypingText removes typing class when isTyping is false', () => {
  const { container } = render(<TypingText isTyping={false}>Test</TypingText>);
  const text = container.querySelector('.oc-typing-text');
  
  assert.equal(text?.classList.contains('oc-typing-text--typing'), false, 'Should not have typing class when isTyping is false');
});

test('TypingText calculates duration based on text length', () => {
  const { container } = render(<TypingText isTyping={true}>Short</TypingText>);
  const text = container.querySelector('.oc-typing-text');
  
  const style = text?.getAttribute('style');
  assert.ok(style, 'Should have inline style for duration');
  assert.match(style, /animation-duration:\s*\d+ms/, 'Should set animation duration in ms');
});

test('TypingText applies custom className', () => {
  const { container } = render(<TypingText className="custom-class">Test</TypingText>);
  const text = container.querySelector('.custom-class');
  
  assert.ok(text, 'Custom className should be applied');
});
```

Run: `node --tests tests/webview/components/TypingText.test.mjs`
Expected: FAIL with "Cannot find module '../../webview/shared/src/components/ui/TypingText'"

### Step 2: Create TypingText component

Create `webview/shared/src/components/ui/TypingText.tsx`:

```typescript
import * as React from "react"
import { cn } from "@/utils"

export interface TypingTextProps {
  children: string
  isTyping?: boolean
  className?: string
}

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

TypingText.displayName = "TypingText"
```

### Step 3: Update exports

Modify `webview/shared/src/components/ui/index.ts`:

```typescript
export * from './stepper'
export * from './TerminalBlock'
export * from './ExpandableStep'
export * from './StepIndicator'
export * from './TypingText'  // Add this line
```

### Step 4: Add CSS styling

Add to `webview/shared/src/chat/index.css` (find where other stepper/UI styles are, around line 2780):

```css
/* TypingText Animation - Modern mask-image approach */
.oc-typing-text {
  mask-image: linear-gradient(to right, black 50%, transparent 50%);
  mask-size: 200% 100%;
  mask-position: 100% 0;
  -webkit-mask-image: linear-gradient(to right, black 50%, transparent 50%);
  -webkit-mask-size: 200% 100%;
  -webkit-mask-position: 100% 0;
}

.oc-typing-text--typing {
  will-change: mask-image, -webkit-mask-image;
  animation: typing-reveal steps(40, end) forwards;
}

@keyframes typing-reveal {
  to {
    mask-position: 0 0;
    -webkit-mask-position: 0 0;
  }
}

/* Fallback for browsers without mask-image support */
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

/* Respect user motion preferences */
@media (prefers-reduced-motion: reduce) {
  .oc-typing-text--typing {
    animation: none !important;
    mask-position: 0 0 !important;
    -webkit-mask-position: 0 0 !important;
  }
}
```

### Step 5: Run tests to verify they pass

Run: `node --tests tests/webview/components/TypingText.test.mjs`
Expected: PASS all tests

### Step 6: Commit

```bash
git add webview/shared/src/components/ui/TypingText.tsx
git add webview/shared/src/components/ui/index.ts
git add webview/shared/src/chat/index.css
git add tests/webview/components/TypingText.test.mjs
git commit -m "feat: add TypingText component with CSS typing animation"
```

---

## Task 2: Integrate TypingText into Stepper Labels

**Files:**
- Modify: `webview/shared/src/chat/MessageComponents.tsx` (AssistantMessage component)
- Test: `tests/webview/stepper-typing-integration.test.mjs` (new file)

### Step 1: Write the failing test

Create `tests/webview/stepper-typing-integration.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node/assert/strict';
import { extractFunctionBody, readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('AssistantMessage imports TypingText component', () => {
  assert.match(
    messageComponentsSource,
    /TypingText/,
    'Should import TypingText component'
  );
});

test('AssistantMessage uses TypingText for step labels', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessage(');
  
  assert.match(
    body,
    /<TypingText/,
    'Should use TypingText component for step labels'
  );
});

test('TypingText isTyping prop is controlled by step status', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessage(');
  
  assert.match(
    body,
    /isTyping.*event\.status|event\.status.*isTyping/,
    'Should tie isTyping to step status'
  );
});
```

Run: `node --tests tests/webview/stepper-typing-integration.test.mjs`
Expected: FAIL with "component imports/usage not found"

### Step 2: Add TypingText import

In `webview/shared/src/chat/MessageComponents.tsx`, add to the imports section (around line 24-26 with other UI components):

```typescript
import { TerminalBlock } from "@/components/ui/TerminalBlock"
import { ExpandableStep } from "@/components/ui/ExpandableStep"
import { StepIndicator } from "@/components/ui/StepIndicator"
import { TypingText } from "@/components/ui/TypingText"  // Add this line
```

### Step 3: Find step label rendering

Search for where step labels are rendered in the stepper. Look for code that displays `event.label` or `cleanedLabel`. This is typically in the StepperItem rendering section, around line 2700-2800.

Find the code that looks like:
```typescript
<span className="oc-step-label">{cleanedLabel || event.label}</span>
```

### Step 4: Wrap step label with TypingText

Replace the label span with:

```typescript
<TypingText 
  isTyping={event.status === 'pending' || event.status === 'running'}
  className="oc-step-label"
>
  {cleanedLabel || event.label}
</TypingText>
```

**Logic:**
- When step is "pending" or "running", typing animation plays
- When step becomes "done" or "error", `isTyping={false}`, animation stops immediately
- Full text shows instantly when step completes

### Step 5: Run tests to verify they pass

Run: `node --tests tests/webview/stepper-typing-integration.test.mjs`
Expected: PASS all tests

### Step 6: Commit

```bash
git add webview/shared/src/chat/MessageComponents.tsx
git add tests/webview/stepper-typing-integration.test.mjs
git commit -m "feat: integrate TypingText component into stepper labels"
```

---

## Task 3: Verify Existing Tests Still Pass

**Files:**
- Test: Run existing stepper test suite
- Modify: Fix any regressions if found

### Step 1: Run existing stepper tests

Run: `node --tests tests/webview/stepper-autoscroll-and-flow.test.mjs`
Expected: PASS all tests (no regressions)

If any tests fail, investigate and fix the regression. The TypingText component should integrate seamlessly.

### Step 2: Run all webview tests

Run: `node --tests tests/webview/`
Expected: PASS all tests

### Step 3: Commit any fixes (if needed)

```bash
git add .
git commit -m "fix: resolve test regressions from typing effect integration"
```

---

## Task 4: Performance Testing and Verification

**Files:**
- Test: Manual performance verification
- Modify: Add performance optimizations if needed

### Step 1: Manual performance verification

**Test with multiple steps:**
1. Open the extension and trigger a conversation with 10+ steps
2. Verify animation stays smooth at 60fps
3. Check browser DevTools Performance tab:
   - No long tasks (>50ms)
   - Main thread blocking minimal
   - FPS stays at 60 during animations

### Step 2: Memory leak verification

**Test for memory leaks:**
1. Open browser DevTools Memory profiler
2. Trigger multiple conversations with typing effects
3. Take heap snapshots before and after
4. Verify no detached DOM nodes or increasing memory

### Step 3: Cross-browser testing

**Test in browsers:**
- Chrome/Edge (Chromium)
- Firefox (mask-image support)
- Safari (webkit-mask-image support)

Verify animation works in all browsers (fallback should work in older browsers).

### Step 4: Accessibility verification

**Test with reduced motion:**
1. Enable "prefers-reduced-motion" in OS settings
2. Reload the extension
3. Verify typing animation is disabled
4. Text should appear instantly

### Step 5: Document results

Create brief notes on performance test results:
- FPS during typing: ____
- Memory impact: ____
- Browser compatibility: ____
- Any issues found: ____

### Step 6: Commit optimizations (if needed)

If performance issues found, add optimizations and commit:

```bash
git add webview/shared/src/components/ui/TypingText.tsx
git add webview/shared/src/chat/index.css
git commit -m "perf: optimize TypingText animation performance"
```

---

## Task 5: Final Polish and Documentation

**Files:**
- Modify: Update relevant documentation
- Create: Update design doc if needed

### Step 1: Update ARCHITECTURE.md (if exists)

Add a section about the TypingText component if there's an architecture document.

### Step 2: Run full test suite

Run: `node --tests tests/webview/`
Expected: PASS all tests

### Step 3: Final verification

**Manual testing checklist:**
- [ ] Typing effect works on step labels when they appear
- [ ] Typing completes immediately when step status changes
- [ ] Multiple steps can animate simultaneously
- [ ] No jank or lag during animations
- [ ] Reduced motion preference is respected
- [ ] Works in dark and light themes

### Step 4: Final commit

```bash
git add docs/
git commit -m "docs: add TypingText component documentation"
```

---

## Success Criteria Verification

After completing all tasks, verify:

✅ **Functional:**
- [ ] Step labels type out when first appearing during streaming
- [ ] Animation completes immediately when step status changes
- [ ] Works for all step statuses (pending, running, done, error)

✅ **Performance:**
- [ ] Maintains 60fps during animations
- [ ] No main thread blocking
- [ ] No memory leaks
- [ ] Minimal CPU usage

✅ **User Experience:**
- [ ] Smooth, natural typing feel
- [ ] Fast typing speed (20-30ms per character)
- [ ] Respects user motion preferences
- [ ] Works in dark and light themes

## Rollback Plan

If issues arise:
1. Remove TypingText component usage from MessageComponents.tsx
2. Delete TypingText.tsx and related files
3. Revert CSS changes in index.css
4. All existing stepper functionality will work without TypingText

## References

- Design doc: `docs/plans/2026-04-07-stepper-typing-effect-design.md`
- Component: `webview/shared/src/components/ui/TypingText.tsx`
- Integration: `webview/shared/src/chat/MessageComponents.tsx`
- Tests: `tests/webview/components/TypingText.test.mjs`
- CSS Mask-Image: https://developer.mozilla.org/en-US/docs/Web/CSS/mask-image
