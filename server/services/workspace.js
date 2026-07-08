// Projects (workspaces) and their memory: conversation history, file summaries,
// task history and agent context. Backed by the JSON store, keyed per project.
import { load, save } from './db.js';
import { uid } from '../utils/id.js';
import { getSandbox } from '../sandbox/sandbox.js';

function db() { return load('workspace', { projects: [], memory: {} }); }

export function listProjects() {
  const d = db();
  if (!d.projects.length) createProject('Untitled Project', d);
  return d.projects;
}

export function createProject(name, existing) {
  const d = existing || db();
  const project = { id: uid('proj'), name: name || 'New Project', createdAt: Date.now() };
  d.projects.push(project);
  d.memory[project.id] = { history: [], summaries: {}, tasks: [], notes: [], agentContext: [] };
  save('workspace', d);
  getSandbox(project.id); // materialize sandbox dir
  return project;
}

export function renameProject(id, name) {
  const d = db();
  const p = d.projects.find((x) => x.id === id);
  if (p) { p.name = name; save('workspace', d); }
  return p;
}

export function deleteProject(id) {
  const d = db();
  d.projects = d.projects.filter((p) => p.id !== id);
  delete d.memory[id];
  save('workspace', d);
}

export function getMemory(projectId) {
  const d = db();
  if (!d.memory[projectId]) { d.memory[projectId] = { history: [], summaries: {}, tasks: [], notes: [], agentContext: [] }; save('workspace', d); }
  return d.memory[projectId];
}

export function appendHistory(projectId, role, content, meta = {}) {
  const d = db();
  const mem = getMemory(projectId);
  mem.history.push({ id: uid('msg'), role, content, ts: Date.now(), ...meta });
  if (mem.history.length > 400) mem.history = mem.history.slice(-400);
  save('workspace', d);
}

export function recordAgentContext(projectId, entry) {
  const d = db();
  const mem = getMemory(projectId);
  mem.agentContext.unshift({ ts: Date.now(), ...entry });
  mem.agentContext = mem.agentContext.slice(0, 100);
  save('workspace', d);
}

export function setSummary(projectId, path, summary) {
  const d = db();
  const mem = getMemory(projectId);
  mem.summaries[path] = { summary, ts: Date.now() };
  save('workspace', d);
}

export function addNote(projectId, text) {
  const d = db();
  const mem = getMemory(projectId);
  mem.notes.unshift({ id: uid('note'), text, ts: Date.now() });
  save('workspace', d);
}
