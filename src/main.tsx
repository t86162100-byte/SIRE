import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './mobile.css';
import './tabNavigation';
import './chartToolbarCleanup';
import './removeMobileChartControls';
import './glassActionBar';
import './glassInstrumentBridge';
import './glassInstrumentSwipeFix';
import './glassInstrumentHold';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
