Changes made and verification for selectedModel providerName addition

- Added providerName?: string to selectedModel shape in webview types and ChatViewProvider runtime state.
- Replaced a static import of @opencode-ai/sdk with dynamic runtime imports in OpencodeServerManager to avoid ESM/CJS type resolution errors.
- Replaced type-only import in SessionService with a local alias to avoid ESM/CJS type-only import errors during tsc.
- Ensured savedModel loading/persistence in ChatViewProvider maps providerName into this.selectedModel when available.
- Ran npx tsc --noEmit during development; fixed reported issues; final tsc run returned clean.
- Ran npm run compile (project uses compile, not build) — build succeeded: "Build complete!".

Decision:
- Using dynamic import(...) for runtime SDK creation is an acceptable short-term workaround to avoid converting the repo to ESM or changing package.json type. It's minimal, runtime-safe, and reversible.

Next steps (optional):
- Add defensive normalization when persisting selectedModel to ensure providerName is always present (providerName = providerName || providerID).
