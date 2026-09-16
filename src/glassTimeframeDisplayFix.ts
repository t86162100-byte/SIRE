const BAR_ID = 'sire-glass-action-bar';

function installTimeframeDisplay() {
  const bar = document.getElementById(BAR_ID);
  const button = bar?.querySelector<HTMLElement>('[data-action="time"]');
  if (!button) return;

  if (!button.querySelector('.timeframe-viewport')) {
    button.innerHTML = '<span class="glass-action-icon" aria-hidden="true">◷</span><span class="timeframe-viewport"><span class="glass-action-label timeframe-current"></span><span class="glass-action-label timeframe-next"></span></span>';
  }

  const current = button.querySelector<HTMLElement>('.timeframe-current');
  const next = button.querySelector<HTMLElement>('.timeframe-next');
  if (!current || !next) return;

  const frames = Array.from(document.querySelectorAll<HTMLElement>('.timeframes button'))
    .map(item => item.textContent?.trim() || '')
    .filter(Boolean);
  if (!frames.length) return;

  const active = document.querySelector<HTMLElement>('.timeframes button.tool-active')?.textContent?.trim() || frames[0];
  const index = Math.max(0, frames.indexOf(active));
  current.textContent = active;
  next.textContent = frames[(index + 1) % frames.length] || '';
  button.title = `Timeframe ${active} · swipe up/down to change`;
  button.setAttribute('aria-label', `Timeframe ${active}. Swipe up or down to change`);
}

function install() {
  installTimeframeDisplay();
  window.setTimeout(installTimeframeDisplay, 200);
  window.setTimeout(installTimeframeDisplay, 700);
  window.setInterval(installTimeframeDisplay, 500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();

new MutationObserver(installTimeframeDisplay).observe(document.documentElement, { childList: true, subtree: true });
