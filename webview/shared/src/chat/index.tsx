import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import ChatShell from './ChatShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import vscode from './lib/vscode';

window.addEventListener('error', (event) => {
  try {
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:red;color:white;z-index:99999;padding:2rem;font-family:monospace;white-space:pre-wrap;overflow:auto;';
    errDiv.innerText = 'CRASH REPORT:\n\n' + event.message + '\n\n' + event.error?.stack;
    document.body.appendChild(errDiv);
    vscode.postMessage({ type: "webviewError", message: event.message, stack: event.error?.stack });
  } catch(e) {}
});

window.addEventListener('unhandledrejection', (event) => {
  try {
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:red;color:white;z-index:99999;padding:2rem;font-family:monospace;white-space:pre-wrap;overflow:auto;';
    errDiv.innerText = 'UNHANDLED REJECTION:\n\n' + String(event.reason) + '\n\n' + event.reason?.stack;
    document.body.appendChild(errDiv);
    vscode.postMessage({ type: "webviewError", message: "Unhandled Rejection: " + String(event.reason), stack: event.reason?.stack });
  } catch(e) {}
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <ChatShell />
    </ErrorBoundary>
  </StrictMode>,
);
