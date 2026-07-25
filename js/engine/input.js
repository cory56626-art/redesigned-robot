// Summoner Realms — unified input.
// Produces a platform-agnostic InputState so PC and mobile drive gameplay and
// networking identically. Keyboard/mouse and touch joysticks both feed the same
// intents: move, jump, aim, primary-use, mine, place, consume.
import { REACH, TILE } from '../config.js?v=realms-2';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'pc';
    this.enabled = true;

    this.state = {
      moveX: 0,
      jumpHeld: false,
      jumpPressed: false,
      aimX: 0,
      aimY: 0,
      aimHeld: false,
      primaryHeld: false,
      primaryPressed: false,
      mineHeld: false,
      placeHeld: false,
      placePressed: false,
      consumePressed: false,
    };

    this.keys = new Set();

    // Keeps very brief keyboard taps visible to the fixed-step game loop.
    this._moveTapX = 0;
    this._moveTapUntil = 0;
    this._lastJumpQueue = 0;
    this._jumpQueuedUntil = 0;
    this._primaryQueuedUntil = 0;

    // Smart Cursor: held on desktop (Left Ctrl), latched by a button on mobile.
    // systems/smartcursor.js reads `smartHeld`; the game's setting decides
    // whether holding is required at all.
    this.smartHeld = false;
    this.smartLatched = false;

    this.aimMode = 'point';
    this.mouseScreen = { x: 0, y: 0 };
    this.aimDir = { x: 1, y: 0 };
    this.aimMagnitude = 1;

    this.actionHandlers = {};
    this._camera = null;

    this._bindKeyboard();
    this._bindMouse();
    this._bindJoysticks();
    this._bindMobileButtons();
  }

  setCamera(cam) {
    this._camera = cam;
  }

  setMode(mode) {
    this.mode = mode;

    const mc = document.getElementById('mobileControls');
    if (mc) mc.classList.toggle('hidden', mode !== 'mobile');

    this.aimMode = mode === 'mobile' ? 'dir' : 'point';
  }

  on(action, handler) {
    this.actionHandlers[action] = handler;
  }

  fire(action, ...args) {
    if (this.actionHandlers[action]) {
      this.actionHandlers[action](...args);
    }
  }

  isTyping() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  _queueJump() {
    // Touchscreens can deliver pointer/touch events between fixed simulation
    // steps. Keep the edge-triggered press latched until the next step so a
    // short tap cannot turn into a jump on release.
    if (this.state.jumpHeld) return;
    const now = performance.now();
    this.state.jumpPressed = true;
    this._jumpQueuedUntil = now + 160;
    this._lastJumpQueue = now;
  }

  _queuePrimary() {
    // Preserve a very short desktop click until the fixed-step simulation
    // observes it. This makes a quick PC summon click as reliable as a hold.
    this.state.primaryPressed = true;
    this._primaryQueuedUntil = performance.now() + 160;
  }

  // ---- Keyboard ----

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (this.isTyping()) {
        if (e.key === 'Escape') {
          this.fire('escapeWhileTyping');
        }
        return;
      }

      const k = e.key.toLowerCase();
      this.keys.add(k);

      // Preserve quick taps long enough for the fixed-step simulation
      // to observe them, even if keyup happens immediately.
      if (k === 'a' || k === 'arrowleft') {
        this._moveTapX = -1;
        this._moveTapUntil = performance.now() + 120;
      } else if (k === 'd' || k === 'arrowright') {
        this._moveTapX = 1;
        this._moveTapUntil = performance.now() + 120;
      }

      // Discrete actions
      if (k === 'e') {
        e.preventDefault();
        this.fire('inventory');
      } else if (k === 'escape') {
        this.fire('pause');
      } else if (k === 'enter' || k === 't') {
        this.fire('chat');
      } else if (k === '/') {
        this.fire('commandPanel');
      } else if (k === 'q') {
        this.state.consumePressed = true;
      } else if (k === 'f') {
        this.fire('interact');
      } else if (k === 'control') {
        this.smartHeld = true;
      } else if (k >= '1' && k <= '9') {
        this.fire('hotbar', parseInt(k, 10) - 1);
      } else if (k === '0') {
        this.fire('hotbar', 9);
      } else if (k === ' ' || k === 'w' || k === 'arrowup') {
        if (!this.state.jumpHeld) {
          this._queueJump();
        }

        this.state.jumpHeld = true;

        if (k === ' ') {
          e.preventDefault();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);

      if (k === 'control') this.smartHeld = false;

      if (k === ' ' || k === 'w' || k === 'arrowup') {
        if (
          !this.keys.has(' ') &&
          !this.keys.has('w') &&
          !this.keys.has('arrowup')
        ) {
          this.state.jumpHeld = false;
        }
      }
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.smartHeld = false;
      this.state.jumpHeld = false;
      this.state.aimHeld = false;
      this.state.primaryHeld = false;
      this.state.primaryPressed = false;
      this._primaryQueuedUntil = 0;
      this.state.mineHeld = false;
      this.state.placeHeld = false;
    });
  }

  _readKeyboardAxis() {
    let x = 0;

    if (this.keys.has('a') || this.keys.has('arrowleft')) {
      x -= 1;
    }

    if (this.keys.has('d') || this.keys.has('arrowright')) {
      x += 1;
    }

    if (x !== 0) {
      // Normal held-key movement.
      this.state.moveX = x;
    } else if (this.mode !== 'mobile') {
      // Movement from a quick individual key press.
      this.state.moveX =
        performance.now() < this._moveTapUntil
          ? this._moveTapX
          : 0;
    }
  }

  // ---- Mouse ----

  _bindMouse() {
    const c = this.canvas;

    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      this.mouseScreen.x = e.clientX;
      this.mouseScreen.y = e.clientY;
    });

    c.addEventListener('mousedown', (e) => {
      if (this.mode === 'mobile') return;

      if (e.button === 0) {
        this.state.primaryHeld = true;
        this._queuePrimary();
      } else if (e.button === 2) {
        this.state.mineHeld = true;
      }

      e.preventDefault();
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.state.primaryHeld = false;
      } else if (e.button === 2) {
        this.state.mineHeld = false;
      }
    });

    window.addEventListener(
      'wheel',
      (e) => {
        if (this.isTyping()) return;
        if (document.querySelector('.overlay:not(.hidden)')) return;

        this.fire(
          'hotbarScroll',
          e.deltaY > 0 ? 1 : -1
        );
      },
      { passive: true }
    );
  }

  // ---- Touch joysticks ----

  _bindJoysticks() {
    this._joy(
      document.getElementById('joyMove'),
      (vx, vy, active) => {
        this.state.moveX = active ? clampAxis(vx) : 0;

        // The movement stick is movement only. Jump is an explicit action on
        // mobile; mapping upward drift to jump caused accidental bunny-hops
        // while simply running across uneven terrain.
        if (!active && this.mode === 'mobile') {
          this.state.jumpHeld =
            this._mobileJumpBtnHeld || false;
        }
      }
    );

    this._joy(
      document.getElementById('joyAim'),
      (vx, vy, active) => {
        // Terraria mobile's Aim & Use behavior: touching the aim stick is
        // itself a held-use input. The player filters this by item type so
        // summon weapons remain manual-use only.
        this.state.aimHeld = active;
        if (active) {
          const len = Math.hypot(vx, vy);
          this.aimMagnitude = Math.min(1, len);
          if (len > 0.001) {
            this.aimDir.x = vx / len;
            this.aimDir.y = vy / len;
          }
        } else {
          // Terraria-style radial cursor: releasing the aim stick recenters
          // the cursor on the player instead of leaving a stale crosshair in
          // the world.
          this.aimMagnitude = 0;
        }
      }
    );
  }

  _joy(el, cb) {
    if (!el) return;

    const knob = el.querySelector('.joy-knob');
    let id = null;
    const radius = 44;

    const reset = () => {
      id = null;
      knob.style.transform = 'translate(-50%,-50%)';
      cb(0, 0, false);
    };

    const onDown = (e) => {
      id = e.pointerId;

      try {
        el.setPointerCapture(id);
      } catch (_) {}

      onMove(e);
    };

    const onMove = (e) => {
      if (e.pointerId !== id) return;

      const r = el.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);

      const len = Math.hypot(dx, dy);
      const cl = Math.min(len, radius);
      const nx = len ? dx / len : 0;
      const ny = len ? dy / len : 0;

      knob.style.transform =
        `translate(calc(-50% + ${nx * cl}px), ` +
        `calc(-50% + ${ny * cl}px))`;

      cb(dx / radius, dy / radius, true);
    };

    const onUp = (e) => {
      if (e.pointerId === id) {
        reset();
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  // ---- Mobile action buttons ----

  _bindMobileButtons() {
    const map = {
      mbJump: () => this._holdBtn('jump'),
      mbAttack: () => this._holdBtn('primary'),
      mbMine: () => this._holdBtn('mine'),
      mbPlace: () => this._holdBtn('place'),
    };

    for (const id in map) {
      map[id]();
    }

    this._tapBtn('mbInv', () => {
      this.fire('inventory');
    });

    this._tapBtn('mbUseItem', () => {
      this.state.consumePressed = true;
    });

    this._tapBtn('mbPause', () => {
      this.fire('pause');
    });

    // Touch has no modifier key, so the Smart Cursor button latches instead.
    this._tapBtn('mbSmart', () => {
      this.smartLatched = !this.smartLatched;
      this.smartHeld = this.smartLatched;
      const el = document.getElementById('mbSmart');
      if (el) el.classList.toggle('on', this.smartLatched);
      this.fire('smartToggle', this.smartLatched);
    });

    this._tapBtn('mbTalk', () => {
      this.fire('interact');
    });
  }

  _holdBtn(intent) {
    const idMap = {
      jump: 'mbJump',
      primary: 'mbAttack',
      mine: 'mbMine',
      place: 'mbPlace',
    };

    const el = document.getElementById(idMap[intent]);
    if (!el) return;

    const down = (e) => {
      e.preventDefault();
      el.classList.add('held');

      if (intent === 'jump') {
        this._mobileJumpBtnHeld = true;

        if (!this.state.jumpHeld) {
          this._queueJump();
        }

        this.state.jumpHeld = true;
      } else if (intent === 'primary') {
        this.state.primaryHeld = true;
        this._queuePrimary();
      } else if (intent === 'mine') {
        this.state.mineHeld = true;
      } else if (intent === 'place') {
        this.state.placeHeld = true;
        this.state.placePressed = true;
      }
    };

    const up = (e) => {
      e.preventDefault();
      el.classList.remove('held');

      if (intent === 'jump') {
        this._mobileJumpBtnHeld = false;
        this.state.jumpHeld = false;
      } else if (intent === 'primary') {
        this.state.primaryHeld = false;
      } else if (intent === 'mine') {
        this.state.mineHeld = false;
      } else if (intent === 'place') {
        this.state.placeHeld = false;
      }
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    // iPad/iPhone Safari can expose the touch edge before the pointer edge.
    // Listen to both so Jump commits on touch-down, never on touch-release.
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
  }

  _tapBtn(id, cb) {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cb();
      el.classList.add('held');
    });

    const clear = () => {
      el.classList.remove('held');
    };

    el.addEventListener('pointerup', clear);
    el.addEventListener('pointercancel', clear);
  }

  // Called each frame after we know the player's centre, to finalise aim coords.
  resolveAim(cx, cy, screenW, screenH) {
    this._readKeyboardAxis();

    if (this.aimMode === 'point' && this._camera) {
      const w = this._camera.screenToWorld(
        this.mouseScreen.x,
        this.mouseScreen.y,
        screenW,
        screenH
      );

      this.state.aimX = w.x;
      this.state.aimY = w.y;
    } else {
      // Mobile aim is a radial cursor: joystick direction chooses the angle,
      // while joystick distance chooses how close the cursor is. Keeping the
      // magnitude was important; normalizing it forced every aim to one ring.
      //
      // With the stick at rest the distance used to collapse to zero, which put
      // the aim point inside the player — so mining targeted the tile you were
      // standing in. It now falls back to a short reach in the facing
      // direction, which is what Smart Cursor then refines.
      if (!this.state.aimHeld && this.state.moveX !== 0) {
        // Resting stick: aim ahead of wherever you're walking.
        this.aimDir.x = Math.sign(this.state.moveX);
        this.aimDir.y = 0;
      }
      const d = this.state.aimHeld
        ? REACH * TILE * 0.8 * this.aimMagnitude
        : TILE * 1.6;

      this.state.aimX = cx + this.aimDir.x * d;
      this.state.aimY = cy + this.aimDir.y * d;
    }
  }

  lateUpdate() {
    if (performance.now() >= this._jumpQueuedUntil) {
      this.state.jumpPressed = false;
    }
    if (performance.now() >= this._primaryQueuedUntil) {
      this.state.primaryPressed = false;
    }
    this.state.placePressed = false;
    this.state.consumePressed = false;
  }

  consumeJumpPress() {
    this.state.jumpPressed = false;
    this._jumpQueuedUntil = 0;
  }

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

function clampAxis(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
