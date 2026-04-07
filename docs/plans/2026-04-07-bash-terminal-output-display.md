# Bash Terminal Output Display Design

**Date:** 2026-04-07  
**Status:** Approved  
**Author:** Claude Sonnet 4.6 with user collaboration

## Overview

Display actual terminal output from bash commands in the stepper UI, showing both the command executed and its stdout/stderr output in a terminal-style block.

## Problem Statement

Currently, bash commands in the stepper display only the command text without showing the actual terminal output. Users see:
- Command: `npm run build`
- Output: (empty)

Users expect to see:
- Command: `npm run build`
- Output: 
  ```
  > project@1.0.0 build
  > tsc
  ✓ Built in 2.3s
  ```

## Architecture

### Current Data Flow

```
VSCode Extension → OpenCode Server → AI Model (with tools)
                              ↓
                        AI decides to use bash tool
                              ↓
                    Server executes bash command
                              ↓
                    ❌ NO OUTPUT CAPTURED
                              ↓
              Empty output field in progressUpdates
                              ↓
                Client displays command without output
```

### Target Data Flow

```
VSCode Extension → OpenCode Server → AI Model (with tools)
                              ↓
                        AI decides to use bash tool
                              ↓
                    Server executes bash command
                              ↓
                    ✅ Capture stdout/stderr
                              ↓
              Populate output field in progressUpdates
                              ↓
                Client displays command + output
```

## Data Structures

### Structured Output Schema

**Location:** `src/shared/structuredOutputSchema.ts`

```typescript
progressUpdates: {
  type: "array",
  description: "Execution progress steps. For bash/shell commands, include BOTH the command text in 'command' field AND the terminal output (stdout/stderr) in 'output' field when status is 'done' or 'error'.",
  items: {
    type: "object",
    properties: {
      title: { type: "string", description: "Step title" },
      status: {
        type: "string",
        enum: ["pending", "done", "error"],
        description: "Step status",
      },
      command: {
        type: "string",
        description: "Command text for bash/shell operations (e.g., 'npm run build'). REQUIRED for bash steps.",
      },
      output: {
        type: "string",
        description: "Terminal output (stdout/stderr) from command execution. INCLUDE this for bash steps when status is 'done' or 'error' - show what the command printed to the terminal.",
      },
    },
    required: ["title", "status"],
  },
}
```

### ActivityDetail Interface

**Location:** `webview/shared/src/chat/lib/types.ts`

```typescript
export interface ActivityDetail {
  kind?: "tool_call" | "file_edit" | "command" | "read" | "search" | "other";
  summary?: string;
  command?: string;  // Bash command text
  output?: string;   // Terminal output
  tool?: string;
  query?: string;
  file?: string;
  diffExcerpt?: ActivityDiffExcerpt;
  metadata?: Record<string, string | number | boolean>;
}
```

## Implementation Strategy

### Phase 1: Temporary Workaround (Immediate)

**Objective:** Get some output displaying while server fix is pending

#### 1.1 Enhanced Schema Instructions ✅ (Completed)

**Files Modified:**
- `src/shared/structuredOutputSchema.ts`
- `webview/shared/src/chat/lib/generated/structuredOutputSchema.ts`

**Changes:**
- Added explicit instructions in `description` field
- Enhanced `command` and `output` field descriptions
- Made it clear that output should be included for bash steps

#### 1.2 Component Updates ✅ (Completed)

**Files Modified:**
- `webview/shared/src/components/ui/TerminalBlock.tsx`
- `webview/shared/src/components/ui/StepIndicator.tsx`
- `webview/shared/src/components/ui/ExpandableStep.tsx`
- `webview/shared/src/components/ui/TypingText.tsx`

**Changes:**
- Created TerminalBlock component for terminal-style display
- Integrated with MessageComponents to use `activityDetail.command` and `activityDetail.output`
- Added typing effect for step labels
- Removed collapse functionality (per user request)

#### 1.3 Message Handler Updates ✅ (Completed)

**Files Modified:**
- `webview/shared/src/chat/lib/messageHandler.ts`

**Changes:**
- Updated `upsertStreamingStep` to populate `activityDetail` with command and output
- Lines 5531-5535: Created activityDetail when command or output present
- Lines 5945-5949: Same for streaming path
- Lines 6547-6551: Same for another streaming path

#### 1.4 Display Integration ✅ (Completed)

**Files Modified:**
- `webview/shared/src/chat/MessageComponents.tsx`

**Changes:**
- Lines 2779-2783: TerminalBlock integration for bash steps
- Uses `activityDetail.command` as primary command source
- Uses `activityDetail.output` for terminal output

### Phase 2: Server-Side Fix (Proper Solution)

**Objective:** Implement actual output capture on the server

**Location:** OpenCode server repository (`opencode-ai/server`)

#### 2.1 Command Execution Wrapper

**Required Changes:**

```typescript
// Server-side code (opencode-ai/server)
class BashCommandExecutor {
  async executeWithCapture(command: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    duration: number;
  }> {
    const startTime = Date.now();
    
    // Execute command with output capture
    const { stdout, stderr, exitCode } = await this.exec(command);
    
    return {
      exitCode,
      stdout,
      stderr,
      duration: Date.now() - startTime
    };
  }
}
```

#### 2.2 Structured Output Population

**Required Changes:**

```typescript
// Server-side code (opencode-ai/server)
function populateProgressUpdate(
  update: ProgressUpdate,
  executionResult?: CommandExecutionResult
): ProgressUpdate {
  if (update.command && executionResult) {
    update.output = [
      executionResult.stdout,
      executionResult.stderr
    ].filter(Boolean).join('\n');
    
    // Add duration if available
    if (executionResult.duration) {
      (update as any).duration = executionResult.duration;
    }
  }
  
  return update;
}
```

### Phase 3: Monitoring & Refinement

#### 3.1 Success Metrics

- **Primary:** Percentage of bash steps with populated `output` field
- **Target:** >90% of bash steps should have output
- **Measurement:** Add logging to track when output is populated

#### 3.2 Schema Iteration

If AI doesn't comply with schema instructions:
1. Add more explicit examples in schema description
2. Consider making `output` required for bash steps
3. Add validation to alert when output is missing

## Component Specification

### TerminalBlock Component

**Location:** `webview/shared/src/components/ui/TerminalBlock.tsx`

```typescript
interface TerminalBlockProps {
  command: string;    // The bash command to display
  output?: string;    // Optional terminal output
  className?: string;
}

function TerminalBlock({ command, output, className }: TerminalBlockProps) {
  return (
    <div className="oc-bash-command-block">
      <pre className="oc-bash-command-code">
        <code>{command}</code>
      </pre>
      {output && (
        <div className="oc-bash-output">
          <pre><code>{output}</code></pre>
        </div>
      )}
    </div>
  );
}
```

**Styling:**
- Minimal, compact design
- Subtle dark background (no heavy terminal theme)
- Monospace font for command and output
- Border separator between command and output
- Max-height with scroll for long output

## Error Handling

### Scenarios

1. **No Output Available**
   - **Behavior:** Display command only
   - **UI:** No error state, just empty output section

2. **Output Too Large**
   - **Threshold:** >10KB or >100 lines
   - **Behavior:** Truncate with "..." 
   - **Future:** Show full output in modal on click

3. **Command Failed (Error Output)**
   - **Behavior:** Display stderr in output field
   - **UI:** No special styling needed, text is self-explanatory

4. **ANSI Escape Codes**
   - **Current:** Strip or render as-is
   - **Future:** Parse and render colors/formatting

## Testing Strategy

### Unit Tests

**Location:** `tests/webview/components/TerminalBlock.test.mjs`

**Test Cases:**
- ✅ Component exists and is exported
- ✅ Has correct props interface
- ✅ Uses React.forwardRef
- ✅ Handles empty command gracefully
- ✅ Renders correct structure
- ✅ Has displayName
- ✅ Uses cn utility for className merging

### Integration Tests

**Location:** `tests/webview/stepper-autoscroll-and-flow.test.mjs`

**Test Cases:**
- ✅ All 47 stepper tests passing
- ✅ Stepper renders bash steps correctly
- ✅ activityDetail flows through data pipeline

### Manual Testing Checklist

- [ ] Trigger a bash command (e.g., "npm run build")
- [ ] Verify command displays in TerminalBlock
- [ ] Verify output displays below command when available
- [ ] Test with successful command
- [ ] Test with failing command (error output)
- [ ] Test with long output (scrolling)
- [ ] Test with empty output (command only)

## CSS Styling

**Location:** `webview/shared/src/chat/index.css`

**Current Styles:**
```css
.oc-bash-command-block {
  margin: 4px 0;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.oc-bash-command-code {
  margin: 0;
  padding: 6px 8px;
  overflow-x: auto;
  background: transparent;
}

.oc-bash-command-code code {
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--oc-text-soft);
  white-space: pre;
}

.oc-bash-output {
  padding: 8px;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(0, 0, 0, 0.2);
}

.oc-bash-output pre {
  margin: 0;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--oc-text-soft);
}

.oc-bash-output code {
  white-space: pre-wrap;
  word-break: break-all;
}
```

**Design Principles:**
- Minimal and lightweight
- No heavy terminal themes
- Subtle backgrounds (dark, not black)
- Compact spacing (4-8px padding)
- Matches overall stepper aesthetic

## Future Enhancements

### Short-Term
1. **Output Truncation UI**
   - Add "Show more" button for long output
   - Modal to display full output
   - Line numbers for large output

2. **ANSI Code Support**
   - Parse ANSI escape codes
   - Render colors and formatting
   - Better terminal emulation

### Long-Term
1. **Live Output Streaming**
   - Display output as command runs
   - Real-time updates like a real terminal
   - Requires WebSocket/SSE changes

2. **Interactive Terminal**
   - Allow users to run custom commands
   - Terminal emulator in webview
   - Full command execution capabilities

## Migration Notes

### Breaking Changes
- None. All changes are additive.

### Backward Compatibility
- TerminalBlock gracefully handles missing `output` field
- Falls back to command-only display
- Existing bash steps continue to work

## Dependencies

### External
- `lucide-react` (Copy icon - removed in final version)
- React forwardRef pattern

### Internal
- `@/utils` (cn utility)
- `webview/shared/src/chat/lib/types.ts` (ActivityDetail)
- `webview/shared/src/chat/index.css` (styling)

## Success Criteria

### Must Have
- ✅ Bash commands display using TerminalBlock component
- ✅ Command text comes from `activityDetail.command`
- ✅ Output displays when `activityDetail.output` is populated
- ✅ All tests passing (47 stepper tests)
- ✅ Schema enhanced with explicit instructions

### Should Have
- ⏳ Server-side output capture implemented
- ⏳ >90% of bash steps have output populated
- ⏳ Output truncation for very long output

### Nice to Have
- ⏳ ANSI code rendering
- ⏳ Live output streaming
- ⏳ "Show more" modal for full output

## Timeline

**Completed:**
- ✅ 2026-04-07: Design approved
- ✅ 2026-04-07: Schema enhancements
- ✅ 2026-04-07: Component implementation
- ✅ 2026-04-07: Integration and testing

**In Progress:**
- ⏳ Server-side output capture (requires opencode-ai/server changes)

**Future:**
- ⏳ Monitoring and refinement
- ⏳ Enhanced UI features
- ⏳ ANSI code support
