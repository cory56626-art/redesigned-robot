// Long-running task registry: progress, pause/resume, cancel, background execution.
// Cancellation is real (AbortController + control gate); pause holds between agent phases.
import { EventEmitter } from 'node:events';
import { uid } from '../utils/id.js';

export const taskBus = new EventEmitter();
taskBus.setMaxListeners(0);
const tasks = new Map();

export function createTask({ title, projectId, kind = 'chat', total = 100 }) {
  const controller = new AbortController();
  const task = {
    id: uid('task'), title, projectId, kind,
    status: 'running', progress: 0, total, stage: 'starting',
    createdAt: Date.now(), updatedAt: Date.now(), logs: [],
    _controller: controller, _paused: false,
  };
  tasks.set(task.id, task);
  emit(task);
  return {
    task,
    signal: controller.signal,
    control: {
      get cancelled() { return task.status === 'cancelled'; },
      get paused() { return task._paused; },
      async gate() {
        while (task._paused && task.status !== 'cancelled') await new Promise((r) => setTimeout(r, 200));
        if (task.status === 'cancelled') throw new Error('cancelled');
      },
    },
    update: (patch) => update(task.id, patch),
    finish: (patch = {}) => update(task.id, { status: 'done', progress: task.total, ...patch }),
    fail: (error) => update(task.id, { status: 'error', error }),
  };
}

export function update(id, patch) {
  const t = tasks.get(id);
  if (!t) return null;
  Object.assign(t, patch, { updatedAt: Date.now() });
  if (patch.log) t.logs.push({ ts: Date.now(), text: patch.log });
  emit(t);
  return t;
}

export function control(id, action) {
  const t = tasks.get(id);
  if (!t) return null;
  if (action === 'pause') t._paused = true, t.status = 'paused';
  if (action === 'resume') t._paused = false, t.status = 'running';
  if (action === 'cancel') { t.status = 'cancelled'; t._paused = false; try { t._controller.abort(); } catch { /* noop */ } }
  t.updatedAt = Date.now();
  emit(t);
  return pub(t);
}

export function listTasks(projectId) {
  return [...tasks.values()].filter((t) => !projectId || t.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt).map(pub);
}

function pub(t) {
  const { _controller, _paused, ...rest } = t;
  return rest;
}
function emit(t) { taskBus.emit('task', pub(t)); }
