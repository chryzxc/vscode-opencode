Issues encountered during work (append-only)

- ESM/CJS TypeScript errors when importing types from @opencode-ai/sdk in CommonJS files. Error: "Type-only import of an ECMAScript module from a CommonJS module must have a 'resolution-mode' attribute".
  - Mitigation: replaced static imports with dynamic runtime import(...) for createOpencodeClient in OpencodeServerManager and used local type aliases for compile-time references in SessionService.

- npm run build does not exist in this repo. The correct script is npm run compile (esbuild). I ran npm run compile and it succeeded.

- tsc initially reported implicit any callback param in SessionService.forEach; fixed by adding explicit param types.
