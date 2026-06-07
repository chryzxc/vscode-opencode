declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

import logger from './logger';

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

const rawVscodeApi = getVsCodeApi();

// Wrap postMessage to add error logging
const vscode = {
  postMessage: (msg: unknown) => {
    try {
      rawVscodeApi.postMessage(msg);
    } catch (error) {
      logger.error('Error sending message to extension', {
        type: (msg as { type?: string })?.type,
        error: String(error)
      });
      throw error;
    }
  },
  getState: () => rawVscodeApi.getState(),
  setState: (state: unknown) => rawVscodeApi.setState(state),
};

export default vscode;
