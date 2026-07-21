// Primitive mesh builders. Each returns {position, normal, uv, index} typed arrays.
// World convention: Y up. Meshes are centred sensibly for composing figures.

function mesh(position, normal, uv, index) {
  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    uv: new Float32Array(uv),
    index: new Uint16Array(index),
  };
}

// Axis-aligned box centred at origin, size (w,h,d).
export function box(w = 1, h = 1, d = 1) {
  const x = w / 2, y = h / 2, z = d / 2;
  const p = [], n = [], u = [], idx = [];
  const faces = [
    { nrm: [0, 0, 1], v: [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]] },
    { nrm: [0, 0, -1], v: [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]] },
    { nrm: [1, 0, 0], v: [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]] },
    { nrm: [-1, 0, 0], v: [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]] },
    { nrm: [0, 1, 0], v: [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]] },
    { nrm: [0, -1, 0], v: [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]] },
  ];
  faces.forEach((f) => {
    const b = p.length / 3;
    f.v.forEach((vt) => { p.push(...vt); n.push(...f.nrm); });
    u.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return mesh(p, n, u, idx);
}

// UV sphere centred at origin, radius r.
export function sphere(r = 1, seg = 12, ring = 10) {
  const p = [], n = [], u = [], idx = [];
  for (let i = 0; i <= ring; i++) {
    const v = i / ring, phi = v * Math.PI;
    for (let j = 0; j <= seg; j++) {
      const uu = j / seg, theta = uu * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(theta);
      p.push(x * r, y * r, z * r); n.push(x, y, z); u.push(uu, v);
    }
  }
  const row = seg + 1;
  for (let i = 0; i < ring; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * row + j, b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return mesh(p, n, u, idx);
}

// Cylinder along Y, from y=0 to y=h, radius r (top can taper via rTop).
export function cylinder(r = 0.5, h = 1, seg = 12, rTop = null) {
  rTop = rTop == null ? r : rTop;
  const p = [], n = [], u = [], idx = [];
  for (let j = 0; j <= seg; j++) {
    const t = j / seg, ang = t * Math.PI * 2, cx = Math.cos(ang), cz = Math.sin(ang);
    p.push(cx * r, 0, cz * r); n.push(cx, 0.2, cz); u.push(t, 0);
    p.push(cx * rTop, h, cz * rTop); n.push(cx, 0.2, cz); u.push(t, 1);
  }
  for (let j = 0; j < seg; j++) {
    const a = j * 2;
    idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  // top cap
  const cb = p.length / 3;
  p.push(0, h, 0); n.push(0, 1, 0); u.push(0.5, 0.5);
  for (let j = 0; j <= seg; j++) {
    const ang = (j / seg) * Math.PI * 2;
    p.push(Math.cos(ang) * rTop, h, Math.sin(ang) * rTop); n.push(0, 1, 0); u.push(0.5, 0.5);
  }
  for (let j = 0; j < seg; j++) idx.push(cb, cb + 1 + j, cb + 2 + j);
  return mesh(p, n, u, idx);
}

// Flat disk on the XZ plane (y=0), radius r — used for blob shadows and the centre spot.
export function disk(r = 1, seg = 20) {
  const p = [0, 0, 0], n = [0, 1, 0, 0, 1, 0], u = [0.5, 0.5];
  const idx = [];
  for (let j = 0; j <= seg; j++) {
    const ang = (j / seg) * Math.PI * 2;
    p.push(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    n.push(0, 1, 0);
    u.push(0.5 + Math.cos(ang) * 0.5, 0.5 + Math.sin(ang) * 0.5);
  }
  for (let j = 0; j < seg; j++) idx.push(0, j + 1, j + 2);
  return mesh(p, n, u, idx);
}

// Flat plane on the XZ plane centred at origin, size (w,d), facing +Y.
export function plane(w, d) {
  const x = w / 2, z = d / 2;
  return mesh(
    [-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z],
    [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [0, 0, 1, 0, 1, 1, 0, 1],
    [0, 1, 2, 0, 2, 3]
  );
}
