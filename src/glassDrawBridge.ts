const BAR_ID = 'sire-glass-action-bar';

function openDrawList() {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button[title="Drawing tools"]'))
    .find(candidate => !candidate.closest(`#${BAR_ID}`));

  if (button) {
    button.click();
    return;
  }

  // App.tsx can handle this event directly if the toolbar has not mounted yet.
  window.dispatchEvent(new CustomEvent('sire:open-draw'));
}

function onGlassAction(event: Event) {
  const custom = event as CustomEvent<{ action?: string }>;
  if (custom.detail?.action !== 'draw') return;
  openDrawList();
}

window.addEventListener('sire:glass-action', onGlassAction);
