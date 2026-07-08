import crypto from 'node:crypto';

export function uid(prefix = '') {
  return (prefix ? prefix + '_' : '') + crypto.randomBytes(9).toString('base64url');
}

export function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

export function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 32).toString('hex');
}

export function token() {
  return crypto.randomBytes(24).toString('base64url');
}
