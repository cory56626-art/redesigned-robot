export function dist3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function distSq3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function horizontalDist(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Normalized horizontal (x,z) facing direction from a yaw in degrees. */
export function directionFromYaw(yawDeg) {
  const rad = (yawDeg * Math.PI) / 180;
  return { x: -Math.sin(rad), z: Math.cos(rad) };
}

export function normalize3(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-6) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function add3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale3(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Dot product between two vectors ignoring Y (for horizontal FOV checks). */
export function dotHorizontalNormalized(a, b) {
  const alen = Math.sqrt(a.x * a.x + a.z * a.z);
  const blen = Math.sqrt(b.x * b.x + b.z * b.z);
  if (alen < 1e-6 || blen < 1e-6) return 1;
  return (a.x * b.x + a.z * b.z) / (alen * blen);
}

export function round(n) {
  return Math.round(n);
}
