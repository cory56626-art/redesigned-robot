// Summoner Realms — character preview.
//
// Draws the player sprite into an arbitrary canvas for the customisation screen
// and the character list. It builds a stand-in object with exactly the fields
// `Renderer._drawPlayer` reads and hands it to the *same* code the game uses,
// so the preview cannot drift from what you actually see in the world — which
// is the entire point of a customisation screen.
import { PLAYER_W, PLAYER_H } from '../config.js?v=deep-and-divided-1';

/**
 * @param ctx        a 2D context to draw into
 * @param renderer   the live Renderer (for its player drawing code)
 * @param appearance the look to draw
 * @param opts       { pose, equip, scale, t }
 */
export function drawCharacterPreview(ctx, renderer, appearance, opts = {}) {
  const scale = opts.scale || 5;
  const pose = opts.pose || 'idle';
  const t = opts.t || 0;
  const canvas = ctx.canvas;

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  // Ground shadow, so the figure is standing on something.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, canvas.height / 2 + (PLAYER_H / 2) * scale + 2,
    PLAYER_W * scale * 0.6, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.translate(-PLAYER_W / 2, -PLAYER_H / 2);

  // A stand-in with only the fields the player renderer reads.
  const stub = {
    x: 0, y: 0, w: PLAYER_W, h: PLAYER_H,
    facing: 1,
    vx: pose === 'walk' ? 100 : 0,
    vy: 0,
    onGround: true,
    submerged: false,
    walkAnim: pose === 'walk' ? t * 9 : 0,
    appearance,
    isLocal: false,
    selectedId: null,
    inventory: { equip: opts.equip || null, selectedItem: () => null },
    swing: pose === 'swing'
      ? { time: (t % 0.35), dur: 0.35, angle: -0.25, item: 'rustedShortblade', reach: 26 }
      : null,
    fishing: null,
    hp: 1, maxHp: 1,
    name: '',
  };

  // The preview intentionally goes through the real drawing path.
  renderer._drawPlayer(ctx, stub, { net: null });
  ctx.restore();
}
