import type { ModuleInitializeHook } from "node:module";

const initialize: ModuleInitializeHook = ({ mockPath } = {}) => {
  const resolvedMockPath = mockPath as string;
  return {
    resolve(specifier, context, nextResolve) {
      if (specifier === "vscode") {
        return { url: resolvedMockPath, shortCircuit: true, format: "module" };
      }
      return nextResolve(specifier, context);
    },
  };
};

export { initialize };
