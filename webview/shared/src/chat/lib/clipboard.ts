import vscode from './vscode';

/**
 * Copy text from a webview without allowing VS Code's restricted Clipboard API
 * to create an unhandled promise rejection. The extension host is the reliable
 * fallback for file:// webviews and windows that are not focused.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    try {
      vscode.postMessage({ type: 'copyToClipboard', text });
      return true;
    } catch {
      return false;
    }
  }
}
