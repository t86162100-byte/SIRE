const BAR_ID = 'sire-glass-action-bar';

function syncGlassInstrumentLabel() {
  const bar = document.getElementById(BAR_ID);
  if (!bar) return;

  const button = bar.querySelector<HTMLElement>('[data-action="symbol"]');
  const current = bar.querySelector<HTMLElement>('.symbol-current');
  if (!button || !current || button.dataset.swiping === 'true') return;

  const chartName = document.querySelector('.chart-subbar > div:first-child b')?.textContent?.trim();
  if (!chartName || /^no instrument$/i.test(chartName) || /^symbol$/i.test(chartName)) return;

  if (current.textContent !== chartName) {
    current.textContent = chartName;
    current.style.transform = 'translate3d(0,0,0)';
  }

  button.title = `${chartName} · swipe up/down to change instrument`;
  button.setAttribute('aria-label', `Instrument ${chartName}. Swipe up or down to change`);
}

function installBridge() {
  syncGlassInstrumentLabel();
  window.setInterval(syncGlassInstrumentLabel, 400);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installBridge, { once: true });
} else {
  installBridge();
}
