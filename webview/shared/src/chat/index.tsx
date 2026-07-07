import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import ChatShell from './ChatShell';
import { ErrorBoundary } from './components/ErrorBoundary';

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
