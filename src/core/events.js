// Minimal event bus.

class Emitter {
  constructor() {
    this._handlers = new Map();
  }
  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    this._handlers.get(type)?.delete(fn);
  }
  emit(type, payload) {
    this._handlers.get(type)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error('event handler error', type, e);
      }
    });
  }
}

export const bus = new Emitter();
export { Emitter };
