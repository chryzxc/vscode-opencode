declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

function getVsCodeApi() {
  // Reuse on window to avoid multiple acquisitions which throw in VS Code
  // @ts-expect-error - augmenting global for webview runtime
  if ((window as any).__vscode_api) return (window as any).__vscode_api;
  try {
    // @ts-expect-error - acquireVsCodeApi provided by VS Code
    (window as any).__vscode_api = acquireVsCodeApi();
  } catch (e) {
    // ignore - if already acquired, it should be on window.__vscode_api
  }
  return (window as any).__vscode_api;
}

const vscode = getVsCodeApi();

export default vscode;
