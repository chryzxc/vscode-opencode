// Webview wrapper around the generated shared validator contract.
// Source of truth lives in src/shared/* and is synced by
// scripts/sync-structured-output-contract.mjs.

export {
  isWalkthroughNarrativeDistinct,
  sanitizeStructuredOutput,
  validateStructuredOutput,
  type StructuredOutputValidationResult,
} from "./generated/structuredOutputValidator";
