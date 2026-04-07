# Stepper UI/UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the stepper component with terminal-inspired bash command display, expandable step sections, and improved status indicators while maintaining backward compatibility.

**Architecture:** Hybrid progressive enhancement - create new specialized components (TerminalBlock, ExpandableStep, StepIndicator) and integrate them into the existing stepper infrastructure without breaking changes.

**Tech Stack:** React, TypeScript, Tailwind CSS, Lucide React icons, existing VSCode extension API

---

## Task 1: Create TerminalBlock Component

**Files:**
- Create: `webview/shared/src/components/ui/TerminalBlock.tsx`
- Modify: `webview/shared/src/components/ui/index.ts` (export new component)
- Test: `tests/webview/components/TerminalBlock.test.mjs` (new file)

### Step 1: Write the failing test

Create `tests/webview/components/TerminalBlock.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '@testing-library/react';
import { TerminalBlock } from '../../webview/shared/src/components/ui/TerminalBlock';

test('TerminalBlock renders command with prompt', () => {
  const { container } = render(<TerminalBlock command="npm test" />);
  const prompt = container.querySelector('.oc-bash-prompt');
  const code = container.querySelector('code');
  
  assert.ok(prompt, 'Prompt element should exist');
  assert.equal(prompt.textContent, '$', 'Prompt should show $ symbol');
  assert.ok(code, 'Code element should exist');
  assert.equal(code.textContent, 'npm test', 'Code should show command');
});

test('TerminalBlock handles empty command gracefully', () => {
  const { container } = render(<TerminalBlock command="" />);
  const block = container.querySelector('.oc-bash-command-block');
  
  assert.equal(block, null, 'Should not render block for empty command');
});

test('TerminalBlock applies custom className', () => {
  const { container } = render(
    <TerminalBlock command="ls -la" className="custom-class" />
  );
  const block = container.querySelector('.custom-class');
  
  assert.ok(block, 'Custom className should be applied');
});

test('TerminalBlock renders optional output when provided', () => {
  const { container } = render(
    <TerminalBlock command="echo hello" output="hello" />
  );
  const outputBlock = container.querySelector('.oc-bash-output');
  
  assert.ok(outputBlock, 'Output block should exist when output prop provided');
  assert.equal(outputBlock.textContent, 'hello', 'Output should match output prop');
});
```

Run: `node --tests tests/webview/components/TerminalBlock.test.mjs`
Expected: FAIL with "Cannot find module '../../webview/shared/src/components/ui/TerminalBlock'"

### Step 2: Create TerminalBlock component

Create `webview/shared/src/components/ui/TerminalBlock.tsx`:

```typescript
import * as React from "react"
import { Copy } from "lucide-react"
import { cn } from "@/utils"

export interface TerminalBlockProps {
  command: string
  output?: string
  className?: string
}

export const TerminalBlock = React.forwardRef<
  HTMLDivElement,
  TerminalBlockProps
>(({ command, output, className }, ref) => {
  const [copied, setCopied] = React.useState(false)
  
  // Don't render if command is empty
  if (!command || typeof command !== 'string') {
    return null
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy command:', error)
    }
  }

  return (
    <div ref={ref} className={cn("oc-bash-command-block", className)}>
      <div className="oc-bash-command-header">
        <span className="oc-bash-prompt">$</span>
        <button
          onClick={handleCopy}
          className="oc-bash-copy-btn"
          aria-label="Copy command"
          title={copied ? "Copied!" : "Copy command"}
        >
          <Copy size={14} />
        </button>
      </div>
      <pre className="oc-bash-command-code">
        <code>{command}</code>
      </pre>
      {output && (
        <div className="oc-bash-output">
          <pre><code>{output}</code></pre>
        </div>
      )}
    </div>
  )
})

TerminalBlock.displayName = "TerminalBlock"
```

### Step 3: Update exports

Modify `webview/shared/src/components/ui/index.ts`:

```typescript
export * from './stepper'
export * from './TerminalBlock'  // Add this line
```

### Step 4: Add CSS styling

Add to `webview/shared/src/chat/index.css` (around line 2125 after existing bash styles):

```css
/* Enhanced TerminalBlock Styling */
.oc-bash-copy-btn {
  background: transparent;
  border: none;
  color: #8b949e;
  cursor: pointer;
  padding: 4px;
  margin-left: auto;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.oc-bash-copy-btn:hover {
  color: #c9d1d9;
  background: rgba(139, 148, 158, 0.1);
}

.oc-bash-copy-btn:active {
  transform: scale(0.95);
}

.oc-bash-output {
  padding: 10px;
  border-top: 1px solid #30363d;
  background: #0d1117;
}

.oc-bash-output pre {
  margin: 0;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #8b949e;
}

.oc-bash-output code {
  white-space: pre-wrap;
  word-break: break-all;
}
```

### Step 5: Run tests to verify they pass

Run: `node --tests tests/webview/components/TerminalBlock.test.mjs`
Expected: PASS all tests

### Step 6: Commit

```bash
git add webview/shared/src/components/ui/TerminalBlock.tsx
git add webview/shared/src/components/ui/index.ts
git add webview/shared/src/chat/index.css
git add tests/webview/components/TerminalBlock.test.mjs
git commit -m "feat: add TerminalBlock component for terminal-inspired command display"
```

---

## Task 2: Create ExpandableStep Component

**Files:**
- Create: `webview/shared/src/components/ui/ExpandableStep.tsx`
- Modify: `webview/shared/src/components/ui/index.ts`
- Test: `tests/webview/components/ExpandableStep.test.mjs`

### Step 1: Write the failing test

Create `tests/webview/components/ExpandableStep.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpandableStep } from '../../webview/shared/src/components/ui/ExpandableStep';

test('ExpandableStep expands important steps by default', () => {
  render(
    <ExpandableStep isImportant={true}>
      <div>Important content</div>
    </ExpandableStep>
  );
  
  const content = screen.queryByText('Important content');
  assert.ok(content, 'Important content should be visible by default');
});

test('ExpandableStep collapses routine steps by default', () => {
  render(
    <ExpandableStep isImportant={false}>
      <div>Routine content</div>
    </ExpandableStep>
  );
  
  const content = screen.queryByText('Routine content');
  assert.equal(content, null, 'Routine content should be hidden by default');
});

test('ExpandableStep toggles on click', () => {
  render(
    <ExpandableStep isImportant={false}>
      <div>Toggle content</div>
    </ExpandableStep>
  );
  
  const content = screen.queryByText('Toggle content');
  assert.equal(content, null, 'Content should be hidden initially');
  
  const toggleButton = screen.getByRole('button');
  fireEvent.click(toggleButton);
  
  const visibleContent = screen.queryByText('Toggle content');
  assert.ok(visibleContent, 'Content should be visible after click');
});

test('ExpandableStep respects defaultExpanded prop', () => {
  render(
    <ExpandableStep defaultExpanded={true} isImportant={false}>
      <div>Forced expanded content</div>
    </ExpandableStep>
  );
  
  const content = screen.queryByText('Forced expanded content');
  assert.ok(content, 'Content should be visible when defaultExpanded is true');
});

test('ExpandableStep is keyboard accessible', () => {
  render(
    <ExpandableStep isImportant={false}>
      <div>Keyboard content</div>
    </ExpandableStep>
  );
  
  const toggleButton = screen.getByRole('button');
  assert.ok(toggleButton, 'Toggle button should be focusable');
  
  fireEvent.keyDown(toggleButton, { key: 'Enter', code: 'Enter' });
  
  const content = screen.queryByText('Keyboard content');
  assert.ok(content, 'Content should expand on Enter key');
});
```

Run: `node --tests tests/webview/components/ExpandableStep.test.mjs`
Expected: FAIL with "Cannot find module '../../webview/shared/src/components/ui/ExpandableStep'"

### Step 2: Create ExpandableStep component

Create `webview/shared/src/components/ui/ExpandableStep.tsx`:

```typescript
import * as React from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/utils"

export interface ExpandableStepProps {
  children: React.ReactNode
  defaultExpanded?: boolean
  isImportant?: boolean
  className?: string
}

export const ExpandableStep = React.forwardRef<
  HTMLDivElement,
  ExpandableStepProps
>(({ children, defaultExpanded, isImportant = false, className }, ref) => {
  // Determine initial expanded state
  const getInitialState = (): boolean => {
    if (defaultExpanded !== undefined) {
      return defaultExpanded
    }
    return isImportant
  }

  const [isExpanded, setIsExpanded] = React.useState(getInitialState)

  const toggleExpanded = () => {
    setIsExpanded(prev => !prev)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleExpanded()
    }
  }

  return (
    <div ref={ref} className={cn("oc-expandable-step", className)}>
      <button
        onClick={toggleExpanded}
        onKeyDown={handleKeyDown}
        className="oc-expandable-toggle"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "Collapse" : "Expand"}
        type="button"
      >
        {isExpanded ? (
          <ChevronDown size={16} className="oc-expandable-chevron" />
        ) : (
          <ChevronRight size={16} className="oc-expandable-chevron" />
        )}
      </button>
      <div 
        className={cn(
          "oc-expandable-content",
          isExpanded ? "oc-expandable-content--expanded" : "oc-expandable-content--collapsed"
        )}
      >
        {children}
      </div>
    </div>
  )
})

ExpandableStep.displayName = "ExpandableStep"
```

### Step 3: Update exports

Modify `webview/shared/src/components/ui/index.ts`:

```typescript
export * from './stepper'
export * from './TerminalBlock'
export * from './ExpandableStep'  // Add this line
```

### Step 4: Add CSS styling

Add to `webview/shared/src/chat/index.css`:

```css
/* ExpandableStep Styling */
.oc-expandable-step {
  position: relative;
}

.oc-expandable-toggle {
  position: absolute;
  left: -20px;
  top: 0;
  background: transparent;
  border: none;
  color: var(--oc-text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.oc-expandable-toggle:hover {
  color: var(--oc-text);
  background: rgba(137, 180, 250, 0.1);
}

.oc-expandable-toggle:focus-visible {
  outline: 2px solid var(--oc-accent);
  outline-offset: 2px;
}

.oc-expandable-chevron {
  transition: transform 0.2s ease;
}

.oc-expandable-content {
  overflow: hidden;
  transition: max-height 0.2s ease, opacity 0.2s ease;
}

.oc-expandable-content--collapsed {
  max-height: 0;
  opacity: 0;
}

.oc-expandable-content--expanded {
  max-height: 2000px; /* Arbitrary large value */
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .oc-expandable-content,
  .oc-expandable-chevron {
    transition: none;
  }
}
```

### Step 5: Run tests to verify they pass

Run: `node --tests tests/webview/components/ExpandableStep.test.mjs`
Expected: PASS all tests

### Step 6: Commit

```bash
git add webview/shared/src/components/ui/ExpandableStep.tsx
git add webview/shared/src/components/ui/index.ts
git add webview/shared/src/chat/index.css
git add tests/webview/components/ExpandableStep.test.mjs
git commit -m "feat: add ExpandableStep component with smart defaults for step content"
```

---

## Task 3: Create StepIndicator Component

**Files:**
- Create: `webview/shared/src/components/ui/StepIndicator.tsx`
- Modify: `webview/shared/src/components/ui/index.ts`
- Test: `tests/webview/components/StepIndicator.test.mjs`

### Step 1: Write the failing test

Create `tests/webview/components/StepIndicator.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '@testing-library/react';
import { StepIndicator } from '../../webview/shared/src/components/ui/StepIndicator';

test('StepIndicator shows check icon for done status', () => {
  const { container } = render(<StepIndicator status="done" />);
  const svg = container.querySelector('svg');
  
  assert.ok(svg, 'SVG icon should exist');
  assert.equal(svg.getAttribute('data-lucide'), 'check', 'Should show check icon');
});

test('StepIndicator shows X icon for error status', () => {
  const { container } = render(<StepIndicator status="error" />);
  const svg = container.querySelector('svg');
  
  assert.equal(svg.getAttribute('data-lucide'), 'x', 'Should show X icon');
});

test('StepIndicator shows animated pulse for pending status', () => {
  const { container } = render(<StepIndicator status="pending" />);
  const indicator = container.querySelector('.oc-step-indicator-pending');
  
  assert.ok(indicator, 'Should have pending class');
  assert.ok(indicator.classList.contains('animate-pulse'), 'Should have pulse animation');
});

test('StepIndicator shows loader for running status', () => {
  const { container } = render(<StepIndicator status="running" />);
  const svg = container.querySelector('svg');
  
  assert.equal(svg.getAttribute('data-lucide'), 'loader-2', 'Should show loader icon');
});

test('StepIndicator applies custom className', () => {
  const { container } = render(
    <StepIndicator status="done" className="custom-class" />
  );
  const wrapper = container.querySelector('.custom-class');
  
  assert.ok(wrapper, 'Custom className should be applied');
});
```

Run: `node --tests tests/webview/components/StepIndicator.test.mjs`
Expected: FAIL with "Cannot find module '../../webview/shared/src/components/ui/StepIndicator'"

### Step 2: Create StepIndicator component

Create `webview/shared/src/components/ui/StepIndicator.tsx`:

```typescript
import * as React from "react"
import { Check, X, Loader2 } from "lucide-react"
import { cn } from "@/utils"

export interface StepIndicatorProps {
  status: 'pending' | 'done' | 'error' | 'running'
  className?: string
}

export const StepIndicator = React.forwardRef<
  HTMLDivElement,
  StepIndicatorProps
>(({ status, className }, ref) => {
  const renderIndicator = () => {
    switch (status) {
      case 'pending':
        return (
          <div className="oc-step-indicator-pending animate-pulse" />
        )
      case 'done':
        return <Check size={14} className="oc-step-indicator-done" />
      case 'error':
        return <X size={14} className="oc-step-indicator-error" />
      case 'running':
        return <Loader2 size={14} className="oc-step-indicator-running animate-spin" />
      default:
        return null
    }
  }

  return (
    <div 
      ref={ref} 
      className={cn(
        "oc-step-indicator",
        `oc-step-indicator--${status}`,
        className
      )}
      aria-label={`Step status: ${status}`}
    >
      {renderIndicator()}
    </div>
  )
})

StepIndicator.displayName = "StepIndicator"
```

### Step 3: Update exports

Modify `webview/shared/src/components/ui/index.ts`:

```typescript
export * from './stepper'
export * from './TerminalBlock'
export * from './ExpandableStep'
export * from './StepIndicator'  // Add this line
```

### Step 4: Add CSS styling

Add to `webview/shared/src/chat/index.css`:

```css
/* StepIndicator Styling */
.oc-step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

/* Pending state */
.oc-step-indicator-pending {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: var(--oc-accent);
}

/* Done state */
.oc-step-indicator-done {
  color: var(--oc-green);
  animation: success-bounce 0.3s ease-out;
}

@keyframes success-bounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
}

/* Error state */
.oc-step-indicator-error {
  color: var(--oc-red);
  animation: error-shake 0.3s ease-out;
}

@keyframes error-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-3px); }
  75% { transform: translateX(3px); }
}

/* Running state */
.oc-step-indicator-running {
  color: var(--oc-accent);
}

@media (prefers-reduced-motion: reduce) {
  .oc-step-indicator-done,
  .oc-step-indicator-error,
  .oc-step-indicator-running {
    animation: none;
  }
}
```

### Step 5: Run tests to verify they pass

Run: `node --tests tests/webview/components/StepIndicator.test.mjs`
Expected: PASS all tests

### Step 6: Commit

```bash
git add webview/shared/src/components/ui/StepIndicator.tsx
git add webview/shared/src/components/ui/index.ts
git add webview/shared/src/chat/index.css
git add tests/webview/components/StepIndicator.test.mjs
git commit -m "feat: add StepIndicator component with enhanced status icons and animations"
```

---

## Task 4: Add isImportant flag to display events

**Files:**
- Modify: `webview/shared/src/chat/MessageComponents.tsx` (buildDisplayEvents function)
- Test: `tests/webview/message-components-build-display-events.test.mjs` (new file)

### Step 1: Write the failing test

Create `tests/webview/message-components-build-display-events.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('buildDisplayEvents adds isImportant flag for error events', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');
  assert.ok(body, 'buildDisplayEvents should exist');
  
  assert.match(
    body,
    /status\s*===\s*['"]error['"]/,
    'Should check for error status when determining importance'
  );
});

test('buildDisplayEvents adds isImportant flag for events with filePath', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');
  
  assert.match(
    body,
    /filePath.*isImportant|isImportant.*filePath/,
    'Should check for filePath when determining importance'
  );
});

test('buildDisplayEvents adds isImportant flag for events with diffStats', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');
  
  assert.match(
    body,
    /diffStats.*isImportant|isImportant.*diffStats/,
    'Should check for diffStats when determining importance'
  );
});
```

Run: `node --tests tests/webview/message-components-build-display-events.test.mjs`
Expected: FAIL with "isImportant checks not found in buildDisplayEvents"

### Step 2: Modify buildDisplayEvents to add isImportant flag

In `webview/shared/src/chat/MessageComponents.tsx`, locate the `buildDisplayEvents` function and add the `isImportant` computation:

Find the section where display event objects are created (around line 1600-1700) and add:

```typescript
// Inside buildDisplayEvents, where display event objects are created
const displayEvent = {
  // ... existing properties
  isImportant: Boolean(
    block.status === 'error' ||
    block.status === 'done' && (block.filePath || block.diffStats || block.viewDiffFile) ||
    block.label === 'error'
  ),
}
```

### Step 3: Run tests to verify they pass

Run: `node --tests tests/webview/message-components-build-display-events.test.mjs`
Expected: PASS all tests

### Step 4: Commit

```bash
git add webview/shared/src/chat/MessageComponents.tsx
git add tests/webview/message-components-build-display-events.test.mjs
git commit -m "feat: add isImportant flag to display events for smart expansion defaults"
```

---

## Task 5: Integrate new components into stepper rendering

**Files:**
- Modify: `webview/shared/src/chat/MessageComponents.tsx` (AssistantMessage component, stepper rendering)
- Test: `tests/webview/stepper-integration.test.mjs` (new file)

### Step 1: Write the failing test

Create `tests/webview/stepper-integration.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('AssistantMessage imports new UI components', () => {
  assert.match(
    messageComponentsSource,
    /from ['"]@\/components\/ui['"].*TerminalBlock|TerminalBlock.*from ['"]@\/components\/ui['"]/,
    'Should import TerminalBlock'
  );
  
  assert.match(
    messageComponentsSource,
    /ExpandableStep/,
    'Should import ExpandableStep'
  );
  
  assert.match(
    messageComponentsSource,
    /StepIndicator/,
    'Should import StepIndicator'
  );
});

test('AssistantMessage uses StepIndicator for step indicators', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessage(');
  
  assert.match(
    body,
    /<StepIndicator/,
    'Should use StepIndicator component'
  );
});

test('AssistantMessage wraps command content in TerminalBlock', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessage(');
  
  assert.match(
    body,
    /activityDetail\.command.*<TerminalBlock|<TerminalBlock.*activityDetail\.command/,
    'Should render TerminalBlock for commands'
  );
});

test('AssistantMessage wraps step content in ExpandableStep', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessage(');
  
  assert.match(
    body,
    /<ExpandableStep/,
    'Should use ExpandableStep component'
  );
});
```

Run: `node --tests tests/webview/stepper-integration.test.mjs`
Expected: FAIL with "component imports/usage not found"

### Step 2: Add imports to MessageComponents

In `webview/shared/src/chat/MessageComponents.tsx`, add to the imports section (around line 22-23):

```typescript
import { Stepper, StepperItem } from "@/components/ui/stepper"
import { TerminalBlock } from "@/components/ui/TerminalBlock"
import { ExpandableStep } from "@/components/ui/ExpandableStep"
import { StepIndicator } from "@/components/ui/StepIndicator"
```

### Step 3: Replace indicator rendering with StepIndicator

Find the section where indicators are rendered (around line 2700-2800) and replace the existing indicator logic:

**Before:**
```typescript
const indicator = event.status === 'pending' ? (
  <div className="animate-pulse" />
) : event.status === 'error' ? (
  <X />
) : (
  <Check />
)
```

**After:**
```typescript
const indicator = <StepIndicator status={event.status} />
```

### Step 4: Wrap command content in TerminalBlock

Find the bash command rendering section (around line 2773-2782) and replace:

**Before:**
```typescript
{event.activityDetail.command && (
  <div className="oc-bash-command-block">
    <div className="oc-bash-command-header">
      <span className="oc-bash-prompt">$</span>
    </div>
    <pre className="oc-bash-command-code">
      <code>{event.activityDetail.command}</code>
    </pre>
  </div>
)}
```

**After:**
```typescript
{event.activityDetail.command && (
  <TerminalBlock command={event.activityDetail.command} />
)}
```

### Step 5: Wrap step content in ExpandableStep

Find the StepperItem rendering section (around line 2700) and wrap the content:

**Before:**
```typescript
<StepperItem indicator={indicator} isLast={isLast}>
  {/* existing content */}
</StepperItem>
```

**After:**
```typescript
<StepperItem indicator={indicator} isLast={isLast}>
  <ExpandableStep isImportant={event.isImportant}>
    {/* existing content */}
  </ExpandableStep>
</StepperItem>
```

### Step 6: Run tests to verify they pass

Run: `node --tests tests/webview/stepper-integration.test.mjs`
Expected: PASS all tests

### Step 7: Commit

```bash
git add webview/shared/src/chat/MessageComponents.tsx
git add tests/webview/stepper-integration.test.mjs
git commit -m "feat: integrate new UI components into stepper rendering"
```

---

## Task 6: Verify existing stepper tests still pass

**Files:**
- Test: Run existing stepper test suite
- Modify: Fix any regressions if found

### Step 1: Run existing stepper tests

Run: `node --tests tests/webview/stepper-autoscroll-and-flow.test.mjs`
Expected: PASS all tests (no regressions)

If any tests fail, investigate and fix the regression. The new components should be backward compatible.

### Step 2: Run all webview tests

Run: `node --tests tests/webview/`
Expected: PASS all tests

### Step 3: Commit any fixes (if needed)

```bash
git add .
git commit -m "fix: resolve test regressions from stepper UI enhancements"
```

---

## Task 7: Add accessibility attributes

**Files:**
- Modify: `webview/shared/src/components/ui/ExpandableStep.tsx`
- Modify: `webview/shared/src/components/ui/StepIndicator.tsx`
- Test: `tests/webview/accessibility/stepper-a11y.test.mjs` (new file)

### Step 1: Write accessibility tests

Create `tests/webview/accessibility/stepper-a11y.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, fireEvent } from '@testing-library/react';
import { ExpandableStep } from '../../webview/shared/src/components/ui/ExpandableStep';
import { StepIndicator } from '../../webview/shared/src/components/ui/StepIndicator';

test('ExpandableStep has proper ARIA attributes', () => {
  render(
    <ExpandableStep isImportant={true}>
      <div>Content</div>
    </ExpandableStep>
  );
  
  const button = screen.getByRole('button');
  assert.equal(button.getAttribute('aria-expanded'), 'true', 'Should be marked as expanded');
});

test('StepIndicator has aria-label', () => {
  const { container } = render(<StepIndicator status="done" />);
  const indicator = container.querySelector('.oc-step-indicator');
  
  assert.ok(indicator?.getAttribute('aria-label'), 'Should have aria-label');
  assert.match(
    indicator.getAttribute('aria-label'),
    /done/i,
    'Should mention status in label'
  );
});
```

Run: `node --tests tests/webview/accessibility/stepper-a11y.test.mjs`
Expected: FAIL with "accessibility tests not passing"

### Step 2: Ensure ExpandableStep has proper ARIA

Update `webview/shared/src/components/ui/ExpandableStep.tsx` to ensure:

```typescript
<button
  onClick={toggleExpanded}
  onKeyDown={handleKeyDown}
  className="oc-expandable-toggle"
  aria-expanded={isExpanded}
  aria-label={isExpanded ? "Collapse step details" : "Expand step details"}
  type="button"
>
```

### Step 3: Ensure StepIndicator has aria-label

Update `webview/shared/src/components/ui/StepIndicator.tsx`:

```typescript
<div 
  ref={ref} 
  className={cn(...)}
  aria-label={`Step ${status}`}
  role="status"
>
  {renderIndicator()}
</div>
```

### Step 4: Run tests to verify they pass

Run: `node --tests tests/webview/accessibility/stepper-a11y.test.mjs`
Expected: PASS all tests

### Step 5: Commit

```bash
git add webview/shared/src/components/ui/ExpandableStep.tsx
git add webview/shared/src/components/ui/StepIndicator.tsx
git add tests/webview/accessibility/stepper-a11y.test.mjs
git commit -m "a11y: add proper ARIA attributes to stepper components"
```

---

## Task 8: Visual regression testing

**Files:**
- Test: `tests/webview/visual/stepper-visual.test.mjs` (new file)

### Step 1: Create visual regression tests

Create `tests/webview/visual/stepper-visual.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '@testing-library/react';
import { TerminalBlock } from '../../webview/shared/src/components/ui/TerminalBlock';
import { ExpandableStep } from '../../webview/shared/src/components/ui/ExpandableStep';
import { StepIndicator } from '../../webview/shared/src/components/ui/StepIndicator';

test('TerminalBlock has correct CSS classes', () => {
  const { container } = render(<TerminalBlock command="npm test" />);
  const block = container.querySelector('.oc-bash-command-block');
  
  assert.ok(block, 'Should have bash command block class');
});

test('ExpandableStep has correct CSS classes for expanded state', () => {
  const { container } = render(
    <ExpandableStep isImportant={true}>
      <div>Content</div>
    </ExpandableStep>
  );
  
  const content = container.querySelector('.oc-expandable-content--expanded');
  assert.ok(content, 'Should have expanded class when important');
});

test('StepIndicator applies status-specific classes', () => {
  const { container: doneContainer } = render(<StepIndicator status="done" />);
  const doneIndicator = doneContainer.querySelector('.oc-step-indicator--done');
  assert.ok(doneIndicator, 'Should apply done status class');
  
  const { container: errorContainer } = render(<StepIndicator status="error" />);
  const errorIndicator = errorContainer.querySelector('.oc-step-indicator--error');
  assert.ok(errorIndicator, 'Should apply error status class');
});
```

Run: `node --tests tests/webview/visual/stepper-visual.test.mjs`
Expected: PASS all tests

### Step 2: Manual visual verification

Open the extension and verify:
1. Terminal blocks look correct in dark theme
2. Expansion animations are smooth
3. Status indicators have good contrast
4. Layout is responsive

### Step 3: Commit

```bash
git add tests/webview/visual/stepper-visual.test.mjs
git commit -m "test: add visual regression tests for stepper components"
```

---

## Task 9: Performance testing

**Files:**
- Test: Manual performance verification
- Modify: Add performance optimizations if needed

### Step 1: Test with many steps

Create a test message with 20+ steps and verify:
- No lag when rendering
- Expansion animations remain smooth
- Auto-scroll still works efficiently

### Step 2: Profile with React DevTools

Check for:
- Unnecessary re-renders
- Large component sizes
- Memory leaks

### Step 3: Add React.memo if needed

If performance issues found, add memoization to components:

```typescript
export const TerminalBlock = React.memo(TerminalBlockRaw)
export const ExpandableStep = React.memo(ExpandableStepRaw)
export const StepIndicator = React.memo(StepIndicatorRaw)
```

### Step 4: Commit optimizations (if needed)

```bash
git add webview/shared/src/components/ui/TerminalBlock.tsx
git add webview/shared/src/components/ui/ExpandableStep.tsx
git add webview/shared/src/components/ui/StepIndicator.tsx
git commit -m "perf: add memoization to stepper components"
```

---

## Task 10: Documentation and final cleanup

**Files:**
- Create: `docs/knowledge-base/stepper-ui-enhancements.md` (new file)
- Modify: Update relevant docs

### Step 1: Create documentation

Create `docs/knowledge-base/stepper-ui-enhancements.md`:

```markdown
# Stepper UI Enhancements

## Overview

The stepper component has been enhanced with three new components for better UX:

- **TerminalBlock** - Terminal-inspired display for bash commands
- **ExpandableStep** - Collapsible wrapper with smart defaults
- **StepIndicator** - Enhanced status indicators with animations

## Usage

### TerminalBlock

```tsx
import { TerminalBlock } from "@/components/ui/TerminalBlock"

<TerminalBlock command="npm test" />
<TerminalBlock command="git status" output="On branch main" />
```

### ExpandableStep

```tsx
import { ExpandableStep } from "@/components/ui/ExpandableStep"

<ExpandableStep isImportant={true}>
  <div>This will be expanded by default</div>
</ExpandableStep>
```

### StepIndicator

```tsx
import { StepIndicator } from "@/components/ui/StepIndicator"

<StepIndicator status="done" />
<StepIndicator status="pending" />
<StepIndicator status="error" />
<StepIndicator status="running" />
```

## Smart Expansion Rules

Steps are automatically expanded based on:
- Error status
- File operations (filePath exists)
- File changes (diffStats exists)
- Important actions (viewDiffFile exists)

## Accessibility

All components are keyboard accessible and include proper ARIA attributes.

## Theme Support

Components use VSCode CSS variables for seamless theme integration.
```

### Step 2: Update ARCHITECTURE.md if needed

Add a section about the new stepper components.

### Step 3: Final test run

Run: `node --tests tests/webview/`
Expected: PASS all tests

### Step 4: Final commit

```bash
git add docs/
git commit -m "docs: add documentation for stepper UI enhancements"
```

---

## Success Criteria Verification

After completing all tasks, verify:

✅ **Functional:**
- [ ] Bash commands display in terminal-inspired style
- [ ] Steps expand/collapse with smart defaults
- [ ] Status indicators are clear and accessible
- [ ] All existing functionality preserved

✅ **Quality:**
- [ ] All tests pass (unit, integration, visual regression, accessibility)
- [ ] Accessibility standards met (WCAG AA)
- [ ] No performance regression
- [ ] Bundle size increase minimal

✅ **User Experience:**
- [ ] Clear visual hierarchy
- [ ] Smooth animations and transitions
- [ ] Keyboard accessible
- [ ] Works in dark and light themes

## Rollback Plan

If issues arise:
1. Revert to commit before Task 5 (integration)
2. Components can be used independently if integration fails
3. CSS changes are additive, easy to revert
4. Feature flags can be added to disable enhancements

## References

- Design doc: `docs/plans/2026-04-07-stepper-ui-ux-improvements-design.md`
- Component tests: `tests/webview/components/`
- Integration tests: `tests/webview/stepper-integration.test.mjs`
- Accessibility tests: `tests/webview/accessibility/stepper-a11y.test.mjs`
