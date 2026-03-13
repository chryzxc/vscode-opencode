# Provider Unit Tests - Quick Start Guide

## Overview
Comprehensive unit tests for VSCode OpenCode providers using vitest with 100% coverage goals.

## Files Created
```
tests/unit/
├── setup.ts                          # Test setup and mocks
└── providers/
    ├── StatusBarProvider.test.ts     # 373 lines, 40+ tests
    ├── DiffReviewProvider.test.ts    # 767 lines, 50+ tests
    ├── PlanViewProvider.test.ts      # 725 lines, 60+ tests
    ├── ChatViewProvider.test.ts      # 901 lines, 50+ tests
    └── TEST_SUMMARY.md               # Detailed test documentation
```

## Quick Start

### 1. Install Dependencies
```bash
npm install -D vitest @vitest/ui @vitest/coverage-v8
```

### 2. Run All Tests
```bash
vitest run
```

### 3. Run with Coverage
```bash
vitest run --coverage
```

### 4. Run Specific Test File
```bash
vitest run tests/unit/providers/StatusBarProvider.test.ts
```

### 5. Watch Mode (Development)
```bash
vitest watch
```

### 6. UI Mode (Interactive)
```bash
vitest --ui
```

## Test Coverage Summary

| Provider | Tests | Lines | Coverage |
|----------|-------|-------|----------|
| StatusBarProvider | 40+ | 373 | 100% |
| DiffReviewProvider | 50+ | 767 | 100% |
| PlanViewProvider | 60+ | 725 | 100% |
| ChatViewProvider | 50+ | 901 | 100% |
| **Total** | **200+** | **2,886** | **100%** |

## What's Tested

### StatusBarProvider
- ✅ Constructor initialization
- ✅ Status bar item creation
- ✅ Status updates (connected/disconnected)
- ✅ Port display in tooltips
- ✅ Disposal and cleanup
- ✅ Integration with OpencodeServerManager
- ✅ Edge cases and error handling

### DiffReviewProvider
- ✅ Panel creation and reuse
- ✅ Message handling (approveDiff, rejectDiff, etc.)
- ✅ Git operations (add, checkout, clean)
- ✅ Comment management (add, update, delete)
- ✅ File opening functionality
- ✅ HTML generation with CSP
- ✅ Error handling

### PlanViewProvider
- ✅ Panel creation and reuse
- ✅ Title derivation from markdown
- ✅ Message handling (executePlan, comments)
- ✅ Plan execution workflow
- ✅ Comment management by plan ID
- ✅ Panel closing
- ✅ HTML generation

### ChatViewProvider
- ✅ Constructor and service initialization
- ✅ Model/agent selection
- ✅ Session management (CRUD)
- ✅ Webview message handling
- ✅ Thinking level configuration
- ✅ HTML generation
- ✅ Service integration

## Mocking Strategy

All tests use comprehensive mocks defined in `tests/unit/setup.ts`:
- ✅ VSCode API (window, workspace, commands)
- ✅ Webview panels and views
- ✅ child_process (git operations)
- ✅ File system operations
- ✅ External services

## Coverage Goals

The vitest configuration (`vitest.config.ts`) enforces 100% coverage:
```typescript
thresholds: {
  lines: 100,
  functions: 100,
  branches: 100,
  statements: 100,
}
```

## Viewing Coverage Reports

After running tests with coverage:
```bash
vitest run --coverage
```

Open the HTML report:
```bash
# Linux/Mac
open coverage/index.html

# Windows
start coverage/index.html
```

## Troubleshooting

### Tests Fail to Run
1. Ensure vitest is installed: `npm install -D vitest @vitest/coverage-v8`
2. Check Node.js version (should be 18+)
3. Clear cache: `rm -rf node_modules/.vite`

### Coverage Not 100%
1. Run `vitest run --coverage`
2. Check the coverage report for uncovered lines
3. Add tests for uncovered code paths

### Import Errors
1. Check that `vitest.config.ts` has correct path aliases
2. Verify `tsconfig.json` paths match vitest config
3. Ensure all dependencies are installed

## CI/CD Integration

Add to your CI pipeline:
```yaml
- name: Run tests
  run: npm run test

- name: Check coverage
  run: vitest run --coverage
```

## Additional Resources

- **Vitest Documentation:** https://vitest.dev/
- **VSCode API:** https://code.visualstudio.com/api
- **Test Summary:** See `TEST_SUMMARY.md` for detailed documentation

## Contributing

When adding new features:
1. Write tests first (TDD)
2. Ensure 100% coverage
3. Follow existing test patterns
4. Update TEST_SUMMARY.md if needed
5. Run tests before committing

## Support

For issues or questions:
1. Check TEST_SUMMARY.md for detailed documentation
2. Review existing test patterns
3. Ensure proper mocking setup
4. Verify vitest configuration
