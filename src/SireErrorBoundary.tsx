import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

function messageFromUnknown(value: unknown) {
  if (value instanceof Error) return value.message || value.name || 'Unknown application error';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function getSireErrorMessage(value: unknown) {
  return messageFromUnknown(value);
}

export function reportSireFatalError(error: unknown, source = 'Application') {
  const message = messageFromUnknown(error);
  console.error('[SIRE FATAL]', source, error);
  window.dispatchEvent(new CustomEvent('sire:fatal-error', {
    detail: { message, source, stack: error instanceof Error ? error.stack || '' : '' },
  }));
}

export function SireErrorScreen({ source, message, stack }: { source: string; message: string; stack?: string }) {
  const reload = () => window.location.reload();
  const copy = async () => {
    const diagnostic = [
      'SIRE ERROR',
      `Source: ${source}`,
      `Message: ${message}`,
      `URL: ${window.location.href}`,
      `Time: ${new Date().toISOString()}`,
      stack ? `Stack:\n${stack}` : '',
    ].filter(Boolean).join('\n');
    try { await navigator.clipboard?.writeText(diagnostic); } catch {}
  };

  return (
    <main style={{
      minHeight: '100dvh', boxSizing: 'border-box', padding: '24px',
      background: '#07090c', color: '#e8edf2', display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace',
    }}>
      <section style={{
        width: 'min(760px, 100%)', border: '1px solid #6d2630',
        background: '#0d1117', borderRadius: 14, padding: '22px',
        boxShadow: '0 18px 60px rgba(0,0,0,.45)',
      }}>
        <div style={{ color: '#ff6b6b', fontSize: 12, fontWeight: 800, letterSpacing: 1.5 }}>SIRE STARTUP ERROR</div>
        <h1 style={{ margin: '8px 0 14px', fontSize: 22 }}>SIRE could not start</h1>
        <div style={{ color: '#ff9b9b', fontSize: 13, marginBottom: 8 }}>{source}</div>
        <pre style={{
          margin: 0, padding: 14, borderRadius: 9, background: '#05070a',
          color: '#ffd7d7', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          fontSize: 13, lineHeight: 1.55,
        }}>{message}</pre>
        {stack && <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', color: '#aeb9c5' }}>Technical details</summary>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#8f9baa', fontSize: 11, lineHeight: 1.45 }}>{stack}</pre>
        </details>}
        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button type="button" onClick={reload} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #47515c', background: '#18202a', color: '#fff', fontWeight: 700 }}>Reload</button>
          <button type="button" onClick={() => void copy()} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #47515c', background: '#10161d', color: '#d7dee7' }}>Copy error details</button>
        </div>
        <div style={{ marginTop: 16, color: '#7f8b98', fontSize: 11 }}>
          The normal SIRE interface is intentionally blocked until this error is resolved.
        </div>
      </section>
    </main>
  );
}

export class SireErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SIRE RENDER ERROR]', error, info);
  }

  render() {
    if (this.state.error) {
      return <SireErrorScreen source="React render error" message={getSireErrorMessage(this.state.error)} stack={this.state.error.stack} />;
    }
    return this.props.children;
  }
}
