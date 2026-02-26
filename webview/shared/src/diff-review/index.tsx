import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import DiffReviewShell from './DiffReviewShell';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <DiffReviewShell />
  </StrictMode>
);
