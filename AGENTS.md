# AGENTS.md

This document serves as the primary orientation guide for LLM agents working on the **OpenCode VS Code Extension**. It outlines the system architecture, coding standards, and operational guidelines to ensure consistent and safe development.

## 1. Project Overview

**OpenCode for VS Code** is an extension that integrates local OpenCode server capabilities directly into the editor. It provides:
-   **Chat Interface**: A sidebar panel for conversational coding assistance.
-   **Implementation Planning**: A specialized view for reviewing and executing AI-generated implementation plans.
-   **Local Server Management**: Automatic lifecycle management of the `@opencode-ai/server` process.

## 2. Architecture

The project is split into two primary environments:

### A. Extension Host (Node.js Environment)
-   **Location**: `src/`
-   **Language**: TypeScript
-   **Responsibilities**:
    -   Interacting with the VS Code API (`vscode.*`).
    -   Managing the OpenCode server process (`OpencodeServerManager.ts`).
    -   File system operations.
    -   Communicating with the OpenCode SDK (`Client`).
    -   Provider logic for Webviews (`ChatViewProvider.ts`, `PlanViewProvider.ts`).

### B. Webviews (Browser Environment)
-   **Location**: `webview/`
-   **Language**: Vanilla JavaScript (ES6+), CSS, HTML.
-   **Responsibilities**:
    -   Rendering UI components (Chat bubbles, Plan cards).
    -   Handling user interactions (Clicks, Input).
    -   **Constraint**: No heavy frameworks (React/Vue/Angular) unless explicitly justified. Keep it lightweight and native-feeling.

## 3. Communication Protocol

Communication between the Extension Host and Webviews defines the application logic:

-   **Webview -> Extension**: `vscode.postMessage({ type: 'commandName', payload: ... })`
-   **Extension -> Webview**: `webview.postMessage({ type: 'commandName', payload: ... })`

**Pattern**:
1.  User performs action in Webview (e.g., clicks "Send").
2.  Webview posts message to Extension.
3.  Extension handles logic (e.g., calls SDK).
4.  Extension posts result back to Webview.
5.  Webview updates DOM.

## 4. UI/UX Guidelines

-   **Theming**:
    -   MUST support VS Code themes (Dark, Light, High Contrast).
    -   Use semantic CSS variables (e.g., `var(--vscode-editor-background)`, `var(--vscode-button-background)`).
    -   Do NOT hardcode colors unless defining a specific palette (e.g., "Zinc" for custom components).
-   **Aesthetic**:
    -   Follow the **"Zinc"** design system: Clean, minimalist, gray-scale with subtle accents.
    -   Components should look native to VS Code but modern (rounded corners, subtle borders).

## 5. Development Guidelines

### TypeScript (Extension)
-   **Strictness**: Enabled. No implicit `any`.
-   **Async/Await**: Preferred over Promises/Callback chains.
-   **Typing**: Define interfaces for all message payloads.

### JavaScript (Webviews)
-   **JSDoc**: MANDATORY. Use `@type` annotations to ensure type safety in JS files.
    ```javascript
    /** @type {HTMLElement} */
    const input = document.getElementById('input');
    ```
-   **Linting**: Ensure no unused variables or implicit `any` in JSDoc.
-   **DOM**: Use native DOM APIs (`querySelector`, `createElement`).

## 6. Project Structure

```
/
├── src/                    # Extension Host Code
│   ├── providers/          # Webview Providers (Chat, Plan)
│   ├── services/           # Business Logic (Server, Stream)
│   └── extension.ts        # Entry Point
├── webview/                # Frontend Code
│   ├── chat/               # Chat UI
│   │   ├── app.js
│   │   └── styles.css
│   └── plan/               # Planning UI
│       ├── app.js
│       └── styles.css
├── package.json            # Manifest & Commands
└── AGENTS.md               # This file
```

## 7. Security

-   **Content Security Policy (CSP)**:
    -   Every Webview MUST have a strict CSP meta tag.
    -   Only allow scripts/styles from the extension's local resource root.
    -   Disallow inline scripts (use `nonce`).
-   **Sanitization**:
    -   All user content rendered as HTML must be sanitized (or handled by safe libraries like `marked`).
    -   Never inject raw HTML from untrusted sources without verification.

## 8. Agent Workflow Protocol

When working on this project, follow this loop:

1.  **Read Context**:
    -   Check `task.md` for current objectives.
    -   Check `implementation_plan.md` for architectural decisions.
    -   Review this `AGENTS.md` file.
2.  **Plan**:
    -   Define the changes required.
    -   Identify files involved in the `src` (logic) and `webview` (UI) layers.
3.  **Execute**:
    -   Apply changes.
    -   **Update Documentation**: Keep `task.md` and walkthroughs up to date.
4.  **Verify**:
    -   Check for lint errors.
    -   Verify UI logic (event listeners, state updates).
    -   Confirm build/compilation succeeds.
