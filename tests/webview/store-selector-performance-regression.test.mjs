import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);

test("useAppState selector hook does not subscribe through AppStateContext", () => {
  const hookBody = extractFunctionBody(
    storeSource,
    "export function useAppState<T>(",
  );

  assert.ok(hookBody.length > 0, "expected to locate useAppState implementation");
  assert.doesNotMatch(
    hookBody,
    /useContext\(AppStateContext\)/,
    "selector consumers should not read AppStateContext because that forces every component to rerender on each state update",
  );
});

test("AppProvider does not wrap children in AppStateContext.Provider", () => {
  const providerBody = extractFunctionBody(
    storeSource,
    "export function AppProvider({ children }: { children: React.ReactNode }) {",
  );

  assert.ok(providerBody.length > 0, "expected to locate AppProvider implementation");
  assert.doesNotMatch(
    providerBody,
    /AppStateContext\.Provider/,
    "AppProvider should expose the external store and dispatch without routing renders through a full-state React context",
  );
});
