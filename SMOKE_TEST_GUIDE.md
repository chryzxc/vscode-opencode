# Smoke Test Guide - Unified Error Display System

## Overview
This guide provides manual testing steps to verify the unified error display system works correctly in a running VS Code extension.

## Prerequisites
- VS Code installed
- Extension loaded in VS Code (F5 or "Run Extension" from debug panel)
- Valid API credentials configured (or ability to trigger errors)

## Test Scenarios

### 1. Normal Chat Flow
**Purpose:** Verify normal operation still works

Steps:
1. Open the extension in VS Code
2. Start a new chat session
3. Send a normal message (e.g., "Hello")
4. **Expected:** Message processes successfully, no error banner appears
5. **Verify:** Chat response appears normally

---

### 2. API Token Refresh Error (401)
**Purpose:** Verify specific error messages display correctly

Steps:
1. Configure invalid/expired API credentials
2. Send a chat message
3. **Expected:** Red error banner appears with message:
   - "Token refresh failed: 401" (or similar specific error)
4. **Verify:**
   - Banner is red (error color)
   - Error icon is visible
   - Message contains actual technical error details
   - NOT a generic "An error occurred" message

---

### 3. Timeout Error
**Purpose:** Verify timeout errors are detected and displayed

Steps:
1. Configure a very short timeout in settings (if possible)
2. Or disconnect network temporarily
3. Send a chat message
4. **Expected:** Orange/yellow error banner appears with timeout message
5. **Verify:**
   - Banner is orange/yellow (warning color)
   - Message indicates timeout occurred
   - Specific timeout details shown

---

### 4. Network Error
**Purpose:** Verify network errors display appropriately

Steps:
1. Disconnect internet connection
2. Send a chat message
3. **Expected:** Error banner appears with network error details
4. **Verify:**
   - Appropriate color (likely red for error)
   - Network error details shown
   - No generic error message

---

### 5. Retry Failed Message
**Purpose:** Verify retry functionality works with error display

Steps:
1. Trigger an error (using scenario 2 or 3)
2. Fix the underlying issue (e.g., restore network, fix credentials)
3. Click retry on the failed message
4. **Expected:** Message retries successfully
5. **Verify:**
   - Error banner disappears
   - Message processes successfully
   - No residual error display

---

### 6. Multiple Errors
**Purpose:** Verify multiple errors display correctly

Steps:
1. Send multiple messages that fail
2. **Expected:** Each message shows its own error banner
3. **Verify:**
   - Errors don't interfere with each other
   - Each error is specific to its message
   - Visual distinction between different error types

---

### 7. Error Banner Styling
**Purpose:** Verify visual design and accessibility

For each error type, check:
- **Color:**
  - Red/orange for errors
  - Yellow for warnings
  - Appropriate contrast ratios
- **Icons:**
  - Error icon visible
  - Icon matches error type
- **Layout:**
  - Banner doesn't break chat flow
  - Text is readable
  - Responsive to window resizing
- **Accessibility:**
  - Screen reader announces error
  - Keyboard navigation works
  - ARIA labels present

---

### 8. Browser Console Check
**Purpose:** Verify no console errors or warnings

Steps:
1. Open VS Code Developer Tools (Help > Toggle Developer Tools)
2. Check Console tab
3. Send messages and trigger errors
4. **Expected:**
   - No uncaught errors in console
   - No warnings about ErrorBuilder or InfoBanner
   - Clean console output

---

## Test Results Checklist

Use this checklist to track test results:

- [ ] Normal chat flow works
- [ ] Token refresh error shows specific message (401)
- [ ] Timeout error displays correctly
- [ ] Network error displays correctly
- [ ] Retry functionality works
- [ ] Multiple errors display properly
- [ ] Error banner styling is correct (colors, icons)
- [ ] No console errors or warnings
- [ ] Accessibility features work (screen reader, keyboard)

---

## Known Issues to Watch For

1. **Generic error messages:** If you see "An error occurred" without details, ErrorBuilder is not being used correctly
2. **Missing error types:** If errors don't have specific handling (timeout, network, etc.)
3. **Color issues:** If error banners don't use appropriate colors
4. **Console errors:** Any uncaught exceptions in browser console
5. **Accessibility issues:** If screen readers don't announce errors properly

---

## Reporting Results

When reporting test results, include:
1. VS Code version
2. Extension version
3. Operating system
4. Which test scenarios passed/failed
5. Screenshots of error banners (if failures)
6. Console output (if errors present)
7. Steps to reproduce any failures

---

## Success Criteria

The smoke test is considered **successful** if:
- All 8 test scenarios pass
- No console errors or warnings
- Error messages are specific and actionable
- Visual design matches specifications
- Accessibility features work correctly
