import { registerHooks } from "node:module";

const mockPath = new URL("./vscode-mock.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, _context, nextResolve) {
    if (specifier === "vscode") {
      return { url: mockPath, shortCircuit: true, format: "module" };
    }
    return nextResolve(specifier, _context);
  },
});
