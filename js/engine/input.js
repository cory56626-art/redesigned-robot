// Summoner Realms — unified input.
// Produces a platform-agnostic InputState so PC and mobile drive gameplay and
// networking identically. Keyboard/mouse and touch joysticks both feed the same
// intents: move, jump, aim, primary-use, mine, place, consume.
import { REACH, TILE } from '../config.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'pc';
    this.enabled = true; // false while a modal/typing has focus for world actions

    this.state = {
      moveX: 0,
      jumpHeld: false,
      jumpPressed: false,
      aimX: 0,
      aimY: 0,
      primaryHeld: false,
      primaryPressed: false,
      mineHeld: false,
      placeHeld: false,
      placePressed: false,
      consumePressed: false,
    };

    // Raw key state.
    this.keys = new Set();
    // Aim source: PC uses absolute world point via mouse; mobile uses a direction.
    this.aimMode = 'point';
    this.mouseScreen = { x: 0, y: 0 };
    this.aimDir = { x: 1, y: 0 };

    this.actionHandlers = {}; // discrete actions: inventory, pause, chat, hotbar, etc.
    this._camera = null;

    this._bindKeyboard();
    this._bindMouse();
    this._bindJoysticks();
    this._bindMobileButtons();
  }

  setCamera(cam) { this._camera = cam; }

  setMode(mode) {
    this.mode = mode;
    const mc = document.getElementById('mobileControls');
    if (mc) mc.classList.toggle('hidden', mode !== 'mobile');
    if (mode === 'mobile') this.aimMode = 'dir';
    else this.aimMode = 'point';
  }

  on(action, handler) { this.actionHandlers[action] = handler; }
  fire(action, ...args) { if (this.actionHandlers[action]) this.actionHandlers[action](...args); }

  isTyping() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  // ---- Keyboard ----
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (this.isTyping()) {
        // Allow Enter/Escape to bubble to chat/command handlers.
        if (e.key === 'Escape') this.fire('escapeWhileTyping');
        return;
      }
      const k = e.key.toLowerCase();
      this.keys.add(k);

      // Discrete actions
      if (k === 'e') { e.preventDefault(); this.fire('inventory'); }
      else if (k === 'escape') { this.fire('pause'); }
      else if (k === 'enter' || k === 't') { this.fire('chat'); }
      else if (k === '/') { this.fire('commandPanel'); }
      else if (k === 'q') { this.state.consumePressed = true; }
      else if (k >= '1' && k <= '9') { this.fire('hotbar', parseInt(k, 10) - 1); }
      else if (k === '0') { this.fire('hotbar', 9); }
      else if (k === ' ' || k === 'w' || k === 'arrowup') {
        if (!this.state.jumpHeld) this.state.jumpPressed = true;
        this.state.jumpHeld = true;
        if (k === ' ') e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === ' ' || k === 'w' || k === 'arrowup') {
        // Only release jump if no other jump key held.
        if (!this.keys.has(' ') && !this.keys.has('w') && !this.keys.has('arrowup')) {
          this.state.jumpHeld = false;
        }
      }
    });

    window.addEventListener('blur', () => { this.keys.clear(); this.state.jumpHeld = false; this.state.primaryHeld = false; this.state.mineHeld = false; });
  }

  _readKeyboardAxis() {
    let x = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    // Keyboard drives movement in EVERY control mode — including mobile, for
    // hybrid tablet+keyboard setups or a wrong auto-detect (a common cause of
    // "left/right doesn't work"). When no movement key is held we leave moveX
    // alone in mobile mode so the on-screen joystick still supplies it.
    if (x !== 0) this.state.moveX = x;
    else if (this.mode !== 'mobile') this.state.moveX = 0;
  }

  // ---- Mouse ----
  _bindMouse() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      this.mouseScreen.x = e.clientX;
      this.mouseScreen.y = e.clientY;
    });
    c.addEventListener('mousedown', (e) => {
      if (this.mode === 'mobile') return;
      if (e.button === 0) { this.state.primaryHeld = true; this.state.primaryPressed = true; }
      else if (e.button === 2) { this.state.mineHeld = true; }
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.state.primaryHeld = false;
      else if (e.button === 2) this.state.mineHeld = false;
    });
    // Scroll wheel changes hotbar selection.
    window.addEventListener('wheel', (e) => {
      if (this.isTyping()) return;
      if (document.querySelector('.overlay:not(.hidden)')) return;
      this.fire('hotbarScroll', e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
  }

  // ---- Touch joysticks ----
  _bindJoysticks() {
    this._joy(document.getElementById('joyMove'), (vx, vy, active) => {
      this.state.moveX = active ? clampAxis(vx) : 0;
      // Pushing up on the move stick also jumps.
      if (active && vy < -0.6) { if (!this.state.jumpHeld) this.state.jumpPressed = true; this.state.jumpHeld = true; }
      else if (this.mode === 'mobile') { this.state.jumpHeld = this._mobileJumpBtnHeld || false; }
    });
    this._joy(document.getElementById('joyAim'), (vx, vy, active) => {
      if (active && (vx || vy)) {
        const len = Math.hypot(vx, vy) || 1;
        this.aimDir.x = vx / len;
        this.aimDir.y = vy / len;
      }
    });
  }

  _joy(el, cb) {
    if (!el) return;
    const knob = el.querySelector('.joy-knob');
    let id = null;
    const radius = 44;
    const reset = () => { id = null; knob.style.transform = 'translate(-50%,-50%)'; cb(0, 0, false); };
    const onDown = (e) => {
      id = e.pointerId;
      try { el.setPointerCapture(id); } catch (_) {}
      onMove(e);
    };
    const onMove = (e) => {
      if (e.pointerId !== id) return;
      const r = el.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      const cl = Math.min(len, radius);
      const nx = len ? (dx / len) : 0;
      const ny = len ? (dy / len) : 0;
      knob.style.transform = `translate(calc(-50% + ${nx * cl}px), calc(-50% + ${ny * cl}px))`;
      cb(dx / radius, dy / radius, true);
    };
    const onUp = (e) => { if (e.pointerId === id) reset(); };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    // NOTE: intentionally NOT listening for pointerout/pointerleave here.
    // With setPointerCapture the element keeps receiving moves, but the pointer
    // still emits pointerout as soon as the knob is dragged past the joystick's
    // small bounds — which previously reset the stick mid-drag and made the
    // player stop moving the instant you pushed the stick to the edge. We only
    // release on an actual pointerup/pointercancel now.
  }

  // ---- Mobile action buttons ----
  _bindMobileButtons() {
    const map = {
      mbJump: () => this._holdBtn('jump'),
      mbAttack: () => this._holdBtn('primary'),
      mbMine: () => this._holdBtn('mine'),
      mbPlace: () => this._holdBtn('place'),
    };
    for (const id in map) map[id]();

    // Tap buttons (discrete).
    this._tapBtn('mbInv', () => this.fire('inventory'));
    this._tapBtn('mbUseItem', () => { this.state.consumePressed = true; });
    this._tapBtn('mbPause', () => this.fire('pause'));
  }

  _holdBtn(intent) {
    // intent -> which held flag to toggle
    const idMap = { jump: 'mbJump', primary: 'mbAttack', mine: 'mbMine', place: 'mbPlace' };
    const el = document.getElementById(idMap[intent]);
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      el.classList.add('held');
      if (intent === 'jump') { this._mobileJumpBtnHeld = true; if (!this.state.jumpHeld) this.state.jumpPressed = true; this.state.jumpHeld = true; }
      else if (intent === 'primary') { this.state.primaryHeld = true; this.state.primaryPressed = true; }
      else if (intent === 'mine') { this.state.mineHeld = true; }
      else if (intent === 'place') { this.state.placeHeld = true; this.state.placePressed = true; }
    };
    const up = (e) => {
      e.preventDefault();
      el.classList.remove('held');
      if (intent === 'jump') { this._mobileJumpBtnHeld = false; this.state.jumpHeld = false; }
      else if (intent === 'primary') { this.state.primaryHeld = false; }
      else if (intent === 'mine') { this.state.mineHeld = false; }
      else if (intent === 'place') { this.state.placeHeld = false; }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  _tapBtn(id, cb) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); cb(); el.classList.add('held'); });
    const clear = () => el.classList.remove('held');
    el.addEventListener('pointerup', clear);
    el.addEventListener('pointercancel', clear);
  }

  // Called each frame after we know the player's centre, to finalise aim coords.
  resolveAim(cx, cy, screenW, screenH) {
    this._readKeyboardAxis();
    if (this.aimMode === 'point' && this._camera) {
      const w = this._camera.screenToWorld(this.mouseScreen.x, this.mouseScreen.y, screenW, screenH);
      this.state.aimX = w.x;
      this.state.aimY = w.y;
    } else {
      // Direction-based (mobile): aim a fixed reach in front.
      const d = REACH * TILE * 0.8;
      this.state.aimX = cx + this.aimDir.x * d;
      this.state.aimY = cy + this.aimDir.y * d;
    }
  }

  // Clear per-frame pressed edges after update consumes them.
  lateUpdate() {
    this.state.jumpPressed = false;
    this.state.primaryPressed = false;
    this.state.placePressed = false;
    this.state.consumePressed = false;
  }

  // Snapshot the transmittable input (for networking).
  snapshot(selectedSlot) {
    const s = this.state;
    return {
      moveX: s.moveX,
      jump: s.jumpHeld,
      aimX: Math.round(s.aimX),
      aimY: Math.round(s.aimY),
      primary: s.primaryHeld,
      mine: s.mineHeld,
      place: s.placeHeld,
      slot: selectedSlot,
    };
  }
}

function clampAxis(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }
