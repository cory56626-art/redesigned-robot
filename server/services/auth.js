// Local account creation + sign in. Passwords are scrypt-hashed; sessions are bearer tokens.
import { load, save } from './db.js';
import { AUTH_SALT } from '../config.js';
import { uid, hashPassword, token } from '../utils/id.js';

function users() { return load('users', { list: [] }); }
function sessions() { return load('sessions', { map: {} }); }

export function createAccount({ email, password, name }) {
  if (!email || !password) throw new Error('Email and password are required.');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');
  const db = users();
  if (db.list.some((u) => u.email.toLowerCase() === email.toLowerCase())) throw new Error('An account with that email already exists.');
  const user = {
    id: uid('user'), email, name: name || email.split('@')[0],
    hash: hashPassword(password, AUTH_SALT + email.toLowerCase()),
    createdAt: Date.now(), prefs: {},
  };
  db.list.push(user); save('users', db);
  return signIn({ email, password });
}

export function signIn({ email, password }) {
  const db = users();
  const user = db.list.find((u) => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user || user.hash !== hashPassword(password, AUTH_SALT + email.toLowerCase())) throw new Error('Invalid email or password.');
  const t = token();
  const s = sessions(); s.map[t] = { userId: user.id, createdAt: Date.now() }; save('sessions', s);
  return { token: t, user: publicUser(user) };
}

export function userForToken(t) {
  if (!t) return null;
  const s = sessions().map[t];
  if (!s) return null;
  const user = users().list.find((u) => u.id === s.userId);
  return user ? publicUser(user) : null;
}

export function signOut(t) {
  const s = sessions(); delete s.map[t]; save('sessions', s);
}

export function updatePrefs(userId, prefs) {
  const db = users();
  const user = db.list.find((u) => u.id === userId);
  if (!user) return null;
  user.prefs = { ...user.prefs, ...prefs };
  save('users', db);
  return publicUser(user);
}

function publicUser(u) { return { id: u.id, email: u.email, name: u.name, prefs: u.prefs || {}, createdAt: u.createdAt }; }
