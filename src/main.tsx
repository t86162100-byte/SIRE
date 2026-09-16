import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './mobile.css';
import './tabNavigation';
import './navigationAutoHide';
import './tabLayoutController';
import './quoteLogoHeader';
import './quoteLogoPositionFix';
import './quoteInstrumentCards';
import './quoteListFullHeight';
import './sireLoadingOverlay';
import './sireChatLoader';
import './glassActionBar';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
