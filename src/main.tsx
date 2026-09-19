import { useEffect, useState } from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { SireErrorBoundary, SireErrorScreen, getSireErrorMessage } from './SireErrorBoundary';
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
import './sireTouchDrawingAdapter';

function SireRuntimeGuard() {
  const [fatal, setFatal] = useState<{ source: string; message: string; stack?: string } | null>(null);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      setFatal({
        source: 'Browser runtime error',
        message: event.message || 'A browser runtime error occurred.',
        stack: event.error?.stack,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      setFatal({
        source: 'Unhandled promise rejection',
        message: getSireErrorMessage(event.reason),
        stack: event.reason instanceof Error ? event.reason.stack : undefined,
      });
    };
    const onFatal = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setFatal({
        source: String(detail.source || 'SIRE runtime error'),
        message: String(detail.message || 'Unknown SIRE runtime error'),
        stack: detail.stack ? String(detail.stack) : undefined,
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('sire:fatal-error', onFatal);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('sire:fatal-error', onFatal);
    };
  }, []);

  if (fatal) return <SireErrorScreen {...fatal} />;
  return <SireErrorBoundary><App /></SireErrorBoundary>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SireRuntimeGuard />
  </StrictMode>
);
