declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

import logger from './logger';

type VsCodeApi = {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

function createFallbackVsCodeApi(): VsCodeApi {
  return {
    postMessage: () => {},
    getState: () => undefined,
    setState: () => {},
  };
}

function getVsCodeApi() {
  const globalWindow =
    typeof window !== 'undefined'
      ? (window as any)
      : typeof globalThis !== 'undefined'
        ? (globalThis as any)
        : undefined;
  if (!globalWindow) {
    return createFallbackVsCodeApi();
  }
  // Reuse on window to avoid multiple acquisitions which throw in VS Code
  // @ts-expect-error - augmenting global for webview runtime
  if (globalWindow.__vscode_api) return globalWindow.__vscode_api;
  try {
    // @ts-expect-error - acquireVsCodeApi provided by VS Code
    globalWindow.__vscode_api = acquireVsCodeApi();
  } catch (e) {
    // ignore - if already acquired, it should be on window.__vscode_api
  }
  return globalWindow.__vscode_api ?? createFallbackVsCodeApi();
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
