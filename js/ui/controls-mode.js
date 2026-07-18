// Summoner Realms — PC / mobile control mode switching.
export function detectDefaultMode() {
  const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const smallish = Math.min(window.innerWidth, window.innerHeight) < 820;
  return touch && smallish ? 'mobile' : 'pc';
}

export function applyControlMode(game, mode) {
  game.controlMode = mode;
  game.input.setMode(mode);
  // Update the segmented control in the main menu.
  const seg = document.getElementById('controlModeSeg');
  if (seg) seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  // Mobile controls only show while playing.
  const mc = document.getElementById('mobileControls');
  if (mc) mc.classList.toggle('hidden', !(mode === 'mobile' && game.state === 'playing'));
}
