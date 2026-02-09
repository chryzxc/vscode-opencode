Suggested Branch Name: feat/ui-task-card-updates
Suggested Commit Message (Conventional Commit): feat(webview): add task card UI and enhance message header

# Enhance WebView UI with Task Cards and Detailed Headers

## Features
- Introduced a new "Task Card" component to the chat UI for structured progress visualization.
- Added detailed token usage and response time statistics to AI response headers.
- Implemented a collapsible "Thought Section" for AI reasoning.
- Enhanced message history visualization with a more consistent SF-standard font stack.

## What's New
- Files:
  - `webview/index.css`: Added extensive styles for `.task-card`, `.task-header`, `.thought-section`, `.progress-section`, and `.file-pill`.
  - `webview/app.js`: Updated message rendering logic to support task state updates and detailed metadata.
- Components:
  - Task headers with dynamic token usage display (`input`, `output`, `cache`).
  - Progress steps list with status indicators (`done`, `error`).
  - File edit chips showing added/deleted line counts.

## Environment / Config Changes
- Updated `opencode_config.json`:
  - Added `context_tokens_limit` (50,000).
  - Increased `per_file_context_limit` to 10,000.
  - Set `enable_context_coalescing` to `true`.
  - Added `ui_settings` block for `show_token_usage`, `enable_task_view`, and `theme`.
- Updated `webview/plan/styles.css`:
  - Simplified `--font-sans` to use system defaults.

## Testing
- _Not visible in staged changes_

## Before / After
- Before: AI responses had a simple label and basic markdown body. Font was set to "Geist".
  After: AI responses now feature a detailed header with token stats, a dedicated task card for progress tracking, and a collapsible thought section. Font stack is now standard system sans-serif.
- Before: Configuration was limited to basic model and provider settings.
  After: Configuration includes UI preferences and expanded token/context limits.
