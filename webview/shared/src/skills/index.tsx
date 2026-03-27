import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../chat/index.css';

import { SkillsShell } from './SkillsShell';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <SkillsShell />
  </StrictMode>
);
