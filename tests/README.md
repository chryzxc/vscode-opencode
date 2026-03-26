# Test Organization

This directory contains all tests for the VSCode OpenCode extension, organized by category.

## Directory Structure

```
tests/
├── components/          # UI component tests (dropdowns, panels, indicators)
├── e2e/                # End-to-end integration tests
├── integration/        # Integration tests covering multiple systems
├── providers/          # VSCode provider tests (status bar, config, todo)
├── regression/         # Regression tests for fixed bugs
├── services/           # Backend service tests (quota, session, streaming)
├── unit/              # Unit tests for individual functions and utilities
├── webview/           # Webview component and interaction tests
├── helpers/           # Test utilities and fixtures
└── __mocks__/         # Mock modules for testing
```

## Test Categories

### 📦 components/
Tests for individual UI components that don't involve external dependencies or complex interactions.
- **Examples**: BudgetIndicator, model-dropdown, plan-parser, QuotaMonitor

### 🔄 e2e/
End-to-end tests that verify complete workflows from user action to result.
- **Examples**: todo-e2e-stream (full todo creation and streaming workflow)

### 🔗 integration/
Tests that verify multiple systems working together, but not full end-to-end workflows.
- **Examples**: quota-chat-integration, budget-enforcement, opencode-server-manager

### 🛠️ providers/
Tests for VSCode extension providers (status bar, configuration, etc.).
- **Examples**: config-files-provider, status-bar-provider, todo-provider

### 🐛 regression/
Tests specifically created to verify bug fixes and prevent regressions.
- **Naming convention**: `*-regression.test.mjs` or descriptive bug names
- **Examples**: leak-regression, session-isolation-regression, streaming-progress-regression

### ⚙️ services/
Tests for backend services and business logic.
- **Examples**: quota-service, session-crud, message-stream-service, structured-output-validator

### 🧪 unit/
Tests for individual functions, utilities, or small modules.
- **Examples**: backend-system-message-filtering, mixed-reasoning-separation, system-prompt-history-filter

### 🌐 webview/
Tests for webview components and user interactions in the chat interface.
- **Examples**: active-task-panel, chat-message-flow, interactive-events, mcp-lsp-panels, system-message-streaming

## Running Tests

Run all tests:
```bash
npm test
```

Run specific category:
```bash
npm test -- tests/unit
npm test -- tests/regression
npm test -- tests/webview
```

Run specific test file:
```bash
npm test -- tests/unit/backend-system-message-filtering.test.mjs
```

## Test Naming Conventions

- **Unit tests**: `what-is-being-tested.test.mjs`
- **Regression tests**: `bug-description-regression.test.mjs`
- **Integration tests**: `feature-integration.test.mjs`
- **E2E tests**: `workflow-e2e.test.mjs`

## Adding New Tests

1. **Determine the category** based on what you're testing
2. **Place the file** in the appropriate directory
3. **Follow naming conventions** for consistency
4. **Use helpers** from `helpers/` when possible

### Decision Tree for Test Placement

```
Is it testing a complete user workflow?
├─ Yes → e2e/
└─ No
    ├─ Is it testing multiple systems together?
    │   ├─ Yes → integration/
    │   └─ No
    │       ├─ Is it for a specific bug fix?
    │       │   ├─ Yes → regression/
    │       │   └─ No
    │           ├─ Is it a VSCode provider?
    │           │   ├─ Yes → providers/
    │           │   └─ No
    │               ├─ Is it a backend service?
    │               │   ├─ Yes → services/
    │               │   └─ No
    │                   ├─ Is it a webview component?
    │                   │   ├─ Yes → webview/
    │                   │   └─ No
    │                       └─ Small, isolated unit? → unit/
```

## Test Helpers

Common utilities and fixtures are available in:
- `helpers/` - Test utilities and helper functions
- `__mocks__/` - Mocked modules for isolated testing

## Notes

- Tests use Node.js built-in test runner (`node:test`)
- Tests are written in ESM format (`.mjs`)
- Mock fixtures are provided for VSCode API and other external dependencies
- Regression tests should include comments linking to the original issue/PR when possible
