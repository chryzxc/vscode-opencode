# OpenCode VS Code Extension

A VS Code extension that integrates OpenCode with Antigravity IDE-style implementation planning features.

## Features

- 🤖 **OpenCode Integration**: Full access to OpenCode's AI capabilities
- 📋 **Plan Mode**: Generate and review implementation plans before execution
- 🔨 **Build Mode**: Direct code generation and modification
- 💬 **Chat Interface**: Clean, VS Code-themed chat panel
- ⌨️ **Keyboard Shortcuts**: Quick access with Ctrl+Esc / Cmd+Esc
- 🔄 **Session Management**: Persistent chat history across restarts

## Installation

### Prerequisites

1. Install OpenCode CLI globally:
   ```bash
   npm install -g opencode-ai
   ```

2. Configure OpenCode with your preferred AI provider:
   ```bash
   opencode
   /connect
   ```

### Extension Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile the extension:
   ```bash
   npm run compile
   ```
4. Press F5 in VS Code to launch the Extension Development Host

## Usage

### Quick Start

1. **Open Chat**: Press `Ctrl+Esc` (Windows/Linux) or `Cmd+Esc` (Mac)
2. **New Session**: Press `Ctrl+Shift+Esc` or `Cmd+Shift+Esc`
3. **Send Selection**: Right-click selected code → "Send to OpenCode"

### Plan Mode

1. Click the mode toggle in the chat header to switch to **PLAN** mode
2. Describe what you want to build
3. OpenCode will generate an implementation plan
4. Click "View Implementation Plan" to review
5. Add comments or edits to the plan
6. Click "Proceed" to execute

### Build Mode

In **BUILD** mode, OpenCode directly generates and modifies code based on your prompts.

## Configuration

Access settings via `File > Preferences > Settings > OpenCode`:

- `opencode.serverPort`: Port for OpenCode server (0 = auto-assign)
- `opencode.autoStart`: Automatically start server on activation
- `opencode.persistSessions`: Persist chat sessions across restarts

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (auto-recompile)
npm run watch

# Run tests
npm test

# Lint
npm run lint
```

## Architecture

```
extension/
├── src/
│   ├── extension.ts              # Entry point
│   ├── services/
│   │   ├── OpencodeServerManager.ts  # Server lifecycle
│   │   └── SessionService.ts         # Session management
│   └── providers/
│       ├── ChatViewProvider.ts       # Chat UI
│       └── StatusBarProvider.ts      # Status indicator
└── webview/
    └── chat/
        ├── app.js                # Chat logic
        └── styles.css            # Chat styles
```

## License

MIT

## Credits

Built on top of [OpenCode](https://opencode.ai) by Anomaly.
