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
import './glassTimeframeSafe';
import './glassIndicatorBridge';
import './glassIndicatorIconFix';
import './glassTimeframeStyleFix';
import './glassDrawIconFix';
import './glassDrawBridge';
import './glassToolsBridge';
import './navigationAutoHide';
import './tabLayoutController';
import './quoteLogoHeader';
import './quoteLogoPositionFix';
import './chartDefaults';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
