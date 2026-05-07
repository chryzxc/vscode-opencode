# Logging

This project supports extension and webview logging for diagnostics.

## Configuration

Use VS Code settings under `opencode.logging.*`:

- `opencode.logging.level`
- `opencode.logging.enableConsole`
- `opencode.logging.enableFile`
- `opencode.logging.maxFileSize`
- `opencode.logging.maxFiles`

## Notes

- Logs can be inspected with scripts in `scripts/` (see `npm run analyze-logs`).
- Keep log level at `info` or higher for normal usage.
