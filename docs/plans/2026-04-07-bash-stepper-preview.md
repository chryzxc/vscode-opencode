# Bash Stepper Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a small inline preview of bash commands in the stepper for bash-type steps, showing the command even when the step is collapsed.

**Architecture:** Extract bash command from activityDetail, create a compact preview component, and conditionally render it in stepper items for bash steps. The preview should show a truncated version of the command (max 60 chars) with a visual indicator that it's a bash command.

**Tech Stack:** React, TypeScript, existing UI components (TerminalBlock), CSS modules

---

## Task 1: Create BashPreview component

**Files:**
- Create: `webview/shared/src/components/ui/BashPreview.tsx`
- Test: `tests/webview/components/BashPreview.test.mjs`

**Step 1: Write the failing test**

Create `tests/webview/components/BashPreview.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot } from '../../helpers/source-utils.mjs';

const bashPreviewSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'BashPreview.tsx')],
  'BashPreview.tsx'
);

test('BashPreview component exists and is exported', () => {
  assert.match(
    bashPreviewSource,
    /export\s+const\s+BashPreview/,
    'BashPreview should be exported'
  );
});

test('BashPreview has correct props interface', () => {
  assert.match(
    bashPreviewSource,
    /export\s+interface\s+BashPreviewProps/,
    'Should have BashPreviewProps interface'
  );

  assert.match(
    bashPreviewSource,
    /command:\s*string/,
    'Should have command prop of type string'
  );

  assert.match(
    bashPreviewSource,
    /className\?:\s*string/,
    'Should have optional className prop'
  );
});

test('BashPreview truncates long commands', () => {
  assert.match(
    bashPreviewSource,
    /maxLength.*60/,
    'Should have max length of 60 characters for command preview'
  );
});

test('BashPreview uses monospace font', () => {
  assert.match(
    bashPreviewSource,
    /font-mono|font-family.*mono/,
    'Should use monospace font for command text'
  );
});

test('BashPreview has bash prompt indicator', () => {
  assert.match(
    bashPreviewSource,
    /\$|bash|prompt/i,
    'Should have bash prompt indicator'
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/webview/components/BashPreview.test.mjs`
Expected: FAIL with "BashPreview.tsx not found"

**Step 3: Write minimal implementation**

Create `webview/shared/src/components/ui/BashPreview.tsx`:

```typescript
import * as React from "react"
import { cn } from "@/utils"

export interface BashPreviewProps {
  command: string
  className?: string
  maxLength?: number
}

export const BashPreview = React.forwardRef<
  HTMLDivElement,
  BashPreviewProps
>(({ command, className, maxLength = 60 }, ref) => {
  const [copied, setCopied] = React.useState(false)

  // Don't render if command is empty
  if (!command || typeof command !== 'string') {
    return null
  }

  // Truncate command if too long
  const truncatedCommand = command.length > maxLength
    ? `${command.slice(0, maxLength - 3)}...`
    : command

  // Clean up timeout on component unmount or when copied changes
  React.useEffect(() => {
    const timeoutId = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timeoutId)
  }, [copied])

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
    } catch (error) {
      console.error('Failed to copy command:', error)
    }
  }

  return (
    <div
      ref={ref}
      className={cn(
        "oc-bash-preview",
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md",
        "bg-oc-panel-soft border border-oc-border",
        "font-mono text-[10px] text-oc-text-soft",
        "hover:bg-oc-accent-soft hover:border-oc-accent/30",
        "transition-colors duration-150 cursor-pointer group",
        className
      )}
      onClick={handleCopy}
      title={`${command}${copied ? ' (Copied!)' : ' - Click to copy'}`}
    >
      <span className="oc-bash-prompt text-oc-yellow opacity-80">$</span>
      <span className="oc-bash-command truncate max-w-[280px]">
        {truncatedCommand}
      </span>
      {copied ? (
        <span className="text-oc-green text-[9px] uppercase font-semibold">
          Copied!
        </span>
      ) : (
        <span className="opacity-0 group-hover:opacity-60 transition-opacity">
          <Copy size={10} />
        </span>
      )}
    </div>
  )
})

BashPreview.displayName = "BashPreview"
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/webview/components/BashPreview.test.mjs`
Expected: PASS

**Step 5: Add CSS styles**

Edit `webview/shared/src/chat/index.css` (add after line 2005):

```css
/* ── Bash Preview ───────────────────────────────────────────────────────── */
.oc-bash-preview {
  user-select: none;
}

.oc-bash-preview:hover .oc-bash-command {
  color: var(--oc-text);
}

.oc-bash-prompt {
  font-weight: 600;
}

.oc-bash-command {
  color: var(--oc-text-soft);
  letter-spacing: 0.02em;
}
```

**Step 6: Commit**

```bash
git add webview/shared/src/components/ui/BashPreview.tsx tests/webview/components/BashPreview.test.mjs webview/shared/src/chat/index.css
git commit -m "feat: add BashPreview component for stepper command preview"
```

---

## Task 2: Export BashPreview from components index

**Files:**
- Modify: `webview/shared/src/components/ui/index.ts`

**Step 1: Write the failing test**

Run: `npm test -- tests/webview/components/BashPreview.test.mjs`
Expected: Current tests pass, but we need to verify export works

**Step 2: Add export to index**

Edit `webview/shared/src/components/ui/index.ts`:

```typescript
export * from './TerminalBlock'
export * from './BashPreview'  // Add this line
export * from './ExpandableStep'
export * from './StepIndicator'
```

**Step 3: Verify export works**

Create a simple test file `tests/webview/components/BashPreview-export.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const indexSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'index.ts')],
  'index.ts'
);

test('BashPreview is exported from components index', () => {
  assert.match(
    indexSource,
    /export\s+\*\s+from\s+['"]\.\/BashPreview['"]/,
    'BashPreview should be exported from index.ts'
  );
});
```

Run: `npm test -- tests/webview/components/BashPreview-export.test.mjs`
Expected: PASS

**Step 4: Commit**

```bash
git add webview/shared/src/components/ui/index.ts tests/webview/components/BashPreview-export.test.mjs
git commit -m "feat: export BashPreview from components index"
```

---

## Task 2.5: Verify bash command data flow (Verification Task)

**Files:**
- None (documentation and verification only)

**Context:**
Before implementing the extraction logic, verify that bash commands are already flowing through the system.

**Step 1: Verify ActivityDetail type has command field**

Run: `grep -A 10 "export interface ActivityDetail" webview/shared/src/chat/lib/types.ts`

Expected output:
```typescript
export interface ActivityDetail {
  kind?: "tool_call" | "file_edit" | "command" | "read" | "search" | "other";
  summary?: string;
  command?: string;  // ✅ This field exists
  tool?: string;
  query?: string;
  file?: string;
  diffExcerpt?: ActivityDiffExcerpt;
  metadata?: Record<string, string | number | boolean>;
}
```

**Step 2: Verify command is populated in messageHandler**

Run: `grep -B 5 -A 5 "command: asOptionalString" webview/shared/src/chat/lib/messageHandler.ts`

Expected: Should find the line `command: asOptionalString(rec.command),` around line 542

**Step 3: Document findings**

Create a brief verification note to confirm:
- ✅ `ActivityDetail.command` field exists in type definition
- ✅ Command is populated from `rec.command` in streaming events
- ✅ Data source: Claude API `tool_use` blocks → streaming events → activityDetail.command
- ✅ No structured output schema updates needed

**Step 4: Update plan documentation**

Add this verification note to the plan summary:

```markdown
**Data Flow Verification:**
Bash commands flow from: Claude API tool_use blocks → streaming events (rec.command)
→ ActivityDetail.command → DisplayEvent.bashCommand → BashPreview component
```

**Step 5: Continue to Task 3**

Since the data is already flowing, proceed with Task 3 to extract it into DisplayEvent.

**No commit needed** - This is a verification task.

---

## Task 3: Add bash command extraction to DisplayEvent processing

**Files:**
- Modify: `webview/shared/src/chat/MessageComponents.tsx`

**Step 1: Identify bash command in DisplayEvent**

The `activityDetail.command` already contains bash commands (verified in Task 2.5). We need to:
1. Check if `event.label === 'bash'` or `event.label.toLowerCase() === 'bash'`
2. Extract command from `event.activityDetail.command`

**Step 2: Add bash command detection to buildDisplayEvents**

Locate the `buildDisplayEvents` function (around line 1526) and add bash command extraction logic. Find where the DisplayEvent object is created (around line 1665) and add bash command detection.

Add this logic before the `rawEvents.push` call:

```typescript
// Extract bash command for preview
const bashCommand =
  (cleanedLabel === 'bash' || parsed.label === 'bash') &&
  activityDetail?.command
    ? activityDetail.command
    : undefined;
```

Then add `bashCommand` to the DisplayEvent object being pushed:

```typescript
rawEvents.push({
  key: event.key,
  kind: "activity",
  label: cleanedLabel,
  summary: summary || cleanedRawTitle || "Activity update",
  description,
  detail: detail || undefined,
  status: event.status,
  source,
  partType,
  internal,
  filePath,
  diffStats,
  activityDetail,
  viewDiffFile,
  bashCommand, // Add this line
  isImportant: Boolean(
    event.status === 'error' ||
    (event.status === 'done' && (filePath || diffStats || viewDiffFile)) ||
    cleanedLabel === 'error'
  ),
  updateCount: 1,
});
```

**Step 3: Update DisplayEvent type**

Locate the DisplayEvent interface definition and add the bashCommand field:

```typescript
interface DisplayEvent {
  key: string;
  kind: "reasoning" | "activity";
  label: string;
  summary: string;
  description?: string;
  detail?: string;
  status: "pending" | "done" | "error";
  source?: "stream" | "final" | "raw_debug";
  partType?: string;
  internal?: boolean;
  filePath?: string;
  diffStats?: { added: number; deleted: number };
  activityDetail?: ActivityDetail;
  viewDiffFile?: string;
  bashCommand?: string; // Add this line
  isImportant: boolean;
  updateCount: number;
}
```

**Step 4: Write test for bash command extraction**

Create `tests/webview/message-components-bash-command.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx'
);

test('DisplayEvent interface includes bashCommand field', () => {
  assert.match(
    messageComponentsSource,
    /bashCommand\?:\s*string/,
    'DisplayEvent should have optional bashCommand field'
  );
});

test('buildDisplayEvents extracts bash command from activityDetail', () => {
  const buildDisplayEventsBody = extractFunctionBody(
    messageComponentsSource,
    'function buildDisplayEvents'
  );

  assert.match(
    buildDisplayEventsBody,
    /bashCommand.*=.*cleanedLabel.*===.*bash.*activityDetail\?\.command/s,
    'Should extract bash command when label is bash'
  );
});
```

**Step 5: Run tests**

Run: `npm test -- tests/webview/message-components-bash-command.test.mjs`
Expected: PASS

**Step 6: Commit**

```bash
git add webview/shared/src/chat/MessageComponents.tsx tests/webview/message-components-bash-command.test.mjs
git commit -m "feat: extract bash command for preview in DisplayEvent"
```

---

## Task 4: Render BashPreview in stepper for bash steps

**Files:**
- Modify: `webview/shared/src/chat/MessageComponents.tsx`

**Step 1: Import BashPreview component**

Add import at the top of the file with other UI component imports:

```typescript
import { BashPreview } from "../components/ui"
```

**Step 2: Add BashPreview rendering in stepper**

Locate the stepper item rendering code (around line 2720-2780). Find where the event label is rendered and add the BashPreview component.

Add this after the label badges (after line 2746, before the event.content span):

```typescript
{/* Bash command preview - show for bash steps */}
{event.kind === "activity" &&
 event.label.toLowerCase() === "bash" &&
 event.bashCommand && (
  <div className="mt-1.5">
    <BashPreview command={event.bashCommand} />
  </div>
)}
```

**Step 3: Write integration test**

Create `tests/webview/stepper-bash-preview.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx'
);

test('BashPreview is imported in MessageComponents', () => {
  assert.match(
    messageComponentsSource,
    /import.*BashPreview.*from.*components\/ui/,
    'BashPreview should be imported'
  );
});

test('Stepper renders BashPreview for bash steps', () => {
  const stepperRenderBody = extractFunctionBody(
    messageComponentsSource,
    /timelineDisplayEvents\.map/  // Find the map function that renders stepper items
  );

  assert.match(
    stepperRenderBody,
    /BashPreview.*command.*event\.bashCommand/s,
    'Should render BashPreview with bashCommand from event'
  );

  assert.match(
    stepperRenderBody,
    /label\.toLowerCase\(\)\s*===\s*['"]bash['"]/,
    'Should check if step label is bash'
  );
});

test('BashPreview is conditionally rendered for bash steps only', () => {
  const stepperRenderBody = extractFunctionBody(
    messageComponentsSource,
    /timelineDisplayEvents\.map/
  );

  assert.match(
    stepperRenderBody,
    /event\.kind\s*===\s*['"]activity['"].*label\.toLowerCase\(\)\s*===\s*['"]bash['"].*event\.bashCommand/s,
    'Should check all three conditions: activity kind, bash label, and bashCommand existence'
  );
});
```

**Step 4: Run tests**

Run: `npm test -- tests/webview/stepper-bash-preview.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add webview/shared/src/chat/MessageComponents.tsx tests/webview/stepper-bash-preview.test.mjs
git commit -m "feat: render BashPreview in stepper for bash steps"
```

---

## Task 5: Add Copy icon import to BashPreview

**Files:**
- Modify: `webview/shared/src/components/ui/BashPreview.tsx`

**Step 1: Add Copy icon import**

Add at the top of the file:

```typescript
import { Copy } from "lucide-react"
```

**Step 2: Verify imports are correct**

Run: `npm test -- tests/webview/components/BashPreview.test.mjs`
Expected: PASS (all tests still pass)

**Step 3: Commit**

```bash
git add webview/shared/src/components/ui/BashPreview.tsx
git commit -m "fix: add Copy icon import to BashPreview"
```

---

## Task 6: Integration test for full bash preview functionality

**Files:**
- Create: `tests/integration/bash-stepper-preview-integration.test.mjs`

**Step 1: Write comprehensive integration test**

Create `tests/integration/bash-stepper-preview-integration.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx'
);

const bashPreviewSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'BashPreview.tsx')],
  'BashPreview.tsx'
);

test('BashPreview component has all required features', () => {
  // Component structure
  assert.match(
    bashPreviewSource,
    /export\s+interface\s+BashPreviewProps/,
    'Should have BashPreviewProps interface'
  );

  assert.match(
    bashPreviewSource,
    /command:\s*string/,
    'Should have command prop'
  );

  // Truncation logic
  assert.match(
    bashPreviewSource,
    /maxLength.*60|slice.*maxLength/,
    'Should truncate commands to max length'
  );

  // Copy functionality
  assert.match(
    bashPreviewSource,
    /handleCopy|clipboard\.writeText/,
    'Should have copy functionality'
  );

  // Styling
  assert.match(
    bashPreviewSource,
    /oc-bash-preview|font-mono/,
    'Should have appropriate styling'
  );

  // Prompt indicator
  assert.match(
    bashPreviewSource,
    /\$.*oc-bash-prompt|oc-bash-prompt.*\$/,
    'Should have bash prompt indicator'
  );
});

test('MessageComponents extracts and passes bash command to BashPreview', () => {
  // DisplayEvent interface includes bashCommand
  assert.match(
    messageComponentsSource,
    /bashCommand\?:\s*string/,
    'DisplayEvent should have bashCommand field'
  );

  // buildDisplayEvents extracts bash command
  const buildDisplayEventsBody = extractFunctionBody(
    messageComponentsSource,
    'function buildDisplayEvents'
  );

  assert.match(
    buildDisplayEventsBody,
    /bashCommand.*=.*cleanedLabel.*bash.*activityDetail/s,
    'Should extract bash command for bash steps'
  );

  // BashPreview is imported
  assert.match(
    messageComponentsSource,
    /import.*BashPreview/s,
    'Should import BashPreview'
  );

  // BashPreview is rendered for bash steps
  const stepperRenderBody = extractFunctionBody(
    messageComponentsSource,
    /timelineDisplayEvents\.map/
  );

  assert.match(
    stepperRenderBody,
    /BashPreview.*command.*event\.bashCommand/s,
    'Should render BashPreview with bashCommand'
  );
});

test('Bash preview only shows for bash steps', () => {
  const stepperRenderBody = extractFunctionBody(
    messageComponentsSource,
    /timelineDisplayEvents\.map/
  );

  // Should check for activity kind
  assert.match(
    stepperRenderBody,
    /event\.kind\s*===\s*['"]activity['"]/,
    'Should check if event kind is activity'
  );

  // Should check for bash label
  assert.match(
    stepperRenderBody,
    /label\.toLowerCase\(\)\s*===\s*['"]bash['"]/,
    'Should check if label is bash'
  );

  // Should check for bashCommand existence
  assert.match(
    stepperRenderBody,
    /event\.bashCommand/,
    'Should check if bashCommand exists'
  );
});

test('BashPreview is exported from components index', () => {
  const indexSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'index.ts')],
    'index.ts'
  );

  assert.match(
    indexSource,
    /export.*from.*BashPreview/s,
    'BashPreview should be exported from index'
  );
});
```

**Step 2: Run integration tests**

Run: `npm test -- tests/integration/bash-stepper-preview-integration.test.mjs`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/integration/bash-stepper-preview-integration.test.mjs
git commit -m "test: add integration tests for bash stepper preview"
```

---

## Task 7: Manual testing and visual verification

**Files:**
- None (manual testing)

**Step 1: Build the project**

Run: `npm run build`

**Step 2: Load the extension in VS Code**

Run: `npm run watch` or press F5 in VS Code to launch the extension host

**Step 3: Test bash command preview**

1. Open a chat in the extension
2. Ask Claude to run a bash command, e.g., "List the files in the current directory"
3. Verify that:
   - A bash step appears in the stepper
   - The bash command preview is shown below the bash label
   - The command is truncated if too long (max 60 chars)
   - Hovering shows the full command in a tooltip
   - Clicking the preview copies the full command to clipboard
   - "Copied!" indicator appears briefly after clicking

**Step 4: Test edge cases**

1. Test with very long commands (> 60 chars) - verify truncation
2. Test with short commands - verify no truncation
3. Test with multiple bash steps - verify each shows correct command
4. Test with non-bash steps - verify no bash preview appears
5. Test copy functionality - verify full command is copied, not truncated

**Step 5: Document any issues**

Create a file `docs/plans/2026-04-07-bash-stepper-preview-testing-notes.md` with any issues found during manual testing.

**Step 6: Commit testing notes**

```bash
git add docs/plans/2026-04-07-bash-stepper-preview-testing-notes.md
git commit -m "docs: add manual testing notes for bash stepper preview"
```

---

## Summary

This plan implements a bash command preview feature in the stepper by:

1. Creating a new `BashPreview` component that displays a truncated bash command with copy functionality
2. **Verifying** that bash commands already flow from streaming events (no schema updates needed)
3. Extracting bash commands from `activityDetail.command` in the `buildDisplayEvents` function
4. Adding the `bashCommand` field to the `DisplayEvent` interface
5. Conditionally rendering `BashPreview` in stepper items for bash steps
6. Adding comprehensive tests at unit, integration, and manual levels

**Data Flow:**
```
Claude API tool_use blocks
  → Streaming events (rec.command)
  → ActivityDetail.command (messageHandler.ts:542)
  → DisplayEvent.bashCommand (Task 3 extraction)
  → BashPreview component rendering
```

The implementation follows the existing patterns in the codebase (similar to `TerminalBlock`) and integrates seamlessly with the current stepper architecture. No structured output schema updates are needed since bash command data comes from raw streaming events, not from the structured JSON response.
