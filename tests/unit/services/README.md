# Unit Tests for Services

This directory contains comprehensive unit tests for the VSCode OpenCode extension services.

## Overview

These tests are written using **vitest** and aim for **100% code coverage** across all service files.

### Test Files

- **OpencodeServerManager.test.ts** - Tests for the OpenCode server lifecycle management
- **QuotaService.test.ts** - Tests for the quota monitoring and tracking service

## Running Tests

### Run all unit tests
```bash
npm run test:unit
```

### Run with coverage report
```bash
npm run test:unit:coverage
```

### Watch mode (for development)
```bash
npm run test:unit:watch
```

### UI mode (interactive test runner)
```bash
npm run test:unit:ui
```

## Coverage Goals

The tests are designed to achieve 100% coverage across:
- **Lines**: All executable lines
- **Branches**: All conditional branches
- **Functions**: All functions and methods
- **Statements**: All statements

## Test Structure

### OpencodeServerManager Tests

Tests the server lifecycle management including:
- Server start/stop/restart functionality
- Port management and allocation
- Health checks and connection verification
- Auto-reconnect on unexpected exit
- Cross-platform process cleanup (Windows/Unix)
- Workspace directory handling
- Status management and event emission
- Version fetching
- Disposal and cleanup

### QuotaService Tests

Tests the quota monitoring service including:
- Auto-refresh lifecycle
- Quota data fetching for multiple platforms:
  - OpenAI (ChatGPT)
  - Zhipu AI
  - Z.AI
  - GitHub Copilot
  - Google/Antigravity
- HTTPS request handling
- Token refresh logic
- Error handling and fallbacks
- Data formatting and display
- Event emission
- Disposal and cleanup

## Mocking Strategy

The tests use vi.mock to mock external dependencies:
- `vscode` - VSCode API
- `child_process` - Process spawning
- `net` - Network operations
- `https` - HTTPS requests
- `fs` - File system operations
- `@opencode-ai/sdk` - SDK client

## Configuration

Tests are configured in `vitest.config.ts` at the project root:

```typescript
{
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
}
```

## Writing New Tests

When adding new tests:

1. Follow the existing pattern of `describe` and `it` blocks
2. Use `beforeEach` to set up fresh state
3. Use `afterEach` to clean up
4. Mock all external dependencies
5. Test all branches and error cases
6. Ensure 100% coverage for new code

Example:
```typescript
describe('MyFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should do something', () => {
    // Arrange
    const input = 'test';

    // Act
    const result = myFunction(input);

    // Assert
    expect(result).toBe('expected');
  });
});
```

## CI/CD Integration

These tests can be integrated into CI/CD pipelines:

```yaml
- name: Run unit tests
  run: npm run test:unit:coverage

- name: Upload coverage
  run: # Upload to coverage service
```

## Troubleshooting

### Tests fail with "Cannot find module"
Ensure all dependencies are installed:
```bash
npm install
```

### Coverage is below 100%
Run tests with coverage report to see which lines are missing:
```bash
npm run test:unit:coverage
```

### Mock not working
Check that mocks are declared before importing the module:
```typescript
vi.mock('module-name');
import { functionToTest } from 'module-name';
```

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [VSCode Extension Testing Guide](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Node.js Test Runner](https://nodejs.org/api/test.html)
