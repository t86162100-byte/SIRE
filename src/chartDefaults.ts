const INSTALL_ID = 'sire-chart-defaults';

function install() {
  if (document.getElementById(INSTALL_ID)) return;
  const marker = document.createElement('meta');
  marker.id = INSTALL_ID;
  document.head.appendChild(marker);

  // Let React finish mounting, then use the existing chart controls so the
  // controller changes the real chart state instead of duplicating it.
  window.setTimeout(() => {
    const timeframe = Array.from(document.querySelectorAll<HTMLButtonElement>('.timeframes button'))
      .find(button => button.textContent?.trim() === '15m');
    if (timeframe && !timeframe.classList.contains('tool-active')) timeframe.click();

    const crosshair = document.querySelector<HTMLButtonElement>('.chart-tools button[title="Crosshair"]');
    if (crosshair?.classList.contains('tool-active')) crosshair.click();
  }, 120);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
