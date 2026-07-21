// Self-contained WebGL match renderer. Consumes a MatchEngine state each frame and draws a
// 3D stadium scene with a broadcast follow-camera. No external libraries.
import { mat4, mat3create } from './glmath.js';
import { box, sphere, cylinder, disk, plane } from './geometry.js';
import { makePitchTexture, makeCrowdTexture } from './pitchtex.js';
import { PITCH } from '../sim/const.js';
import { clamp, lerp } from '../core/util.js';

const VERT = `
attribute vec3 aPosition; attribute vec3 aNormal; attribute vec2 aUV;
uniform mat4 uProj, uView, uModel; uniform mat3 uNormalMat;
varying vec3 vNormal; varying vec2 vUV; varying vec3 vWorld;
void main(){
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz; vNormal = uNormalMat * aNormal; vUV = aUV;
  gl_Position = uProj * uView * world;
}`;

const FRAG = `
precision mediump float;
varying vec3 vNormal; varying vec2 vUV; varying vec3 vWorld;
uniform vec3 uColor; uniform float uUseTex; uniform sampler2D uTex;
uniform vec3 uLightDir; uniform float uAmbient; uniform float uAlpha;
void main(){
  vec3 base = uUseTex > 0.5 ? texture2D(uTex, vUV).rgb : uColor;
  float diff = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
  float light = uAmbient + diff * (1.0 - uAmbient);
  vec3 col = base * light;
  // subtle distance fog toward the sky colour
  float fog = clamp((length(vWorld) - 70.0) / 120.0, 0.0, 0.55);
  col = mix(col, vec3(0.09, 0.12, 0.2), fog);
  gl_FragColor = vec4(col, uAlpha);
}`;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    const opts = { antialias: true, alpha: false, powerPreference: 'high-performance' };
    this.gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!this.gl) throw new Error('WebGL unavailable');
    const gl = this.gl;
    this.prog = this._program(VERT, FRAG);
    this.attr = {
      aPosition: gl.getAttribLocation(this.prog, 'aPosition'),
      aNormal: gl.getAttribLocation(this.prog, 'aNormal'),
      aUV: gl.getAttribLocation(this.prog, 'aUV'),
    };
    this.uni = {};
    ['uProj', 'uView', 'uModel', 'uNormalMat', 'uColor', 'uUseTex', 'uTex', 'uLightDir', 'uAmbient', 'uAlpha']
      .forEach((n) => (this.uni[n] = gl.getUniformLocation(this.prog, n)));

    this.meshes = {
      box: this._mesh(box(1, 1, 1)),
      torso: this._mesh(box(0.52, 0.72, 0.34)),
      leg: this._mesh(box(0.18, 0.62, 0.22)),
      head: this._mesh(sphere(0.19, 10, 8)),
      ball: this._mesh(sphere(0.42, 14, 10)),
      shadow: this._mesh(disk(1, 18)),
      post: this._mesh(box(0.16, 1, 0.16)),
      pitch: this._mesh(plane(PITCH.W + PITCH.MARGIN * 2, PITCH.L + PITCH.MARGIN * 2)),
      field: this._mesh(plane(PITCH.W, PITCH.L)),
      stand: this._mesh(plane(1, 1)),
      net: this._mesh(plane(1, 1)),
    };
    this.pitchTex = this._texture(makePitchTexture());
    this.crowdTex = this._texture(makeCrowdTexture());

    this.proj = mat4.create();
    this.view = mat4.create();
    this.model = mat4.create();
    this.nmat = mat3create();
    this.camX = 0; this.camZ = 0; this.camZoom = 1;
    this.mode = 'broadcast';

    gl.enable(gl.DEPTH_TEST);
    // Culling disabled: the hand-built meshes have mixed winding and the scene is small.
    this.resize();
  }

  _program(vs, fs) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    return p;
  }

  _mesh(geo) {
    const gl = this.gl;
    const mk = (data, target = gl.ARRAY_BUFFER) => {
      const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b;
    };
    return {
      position: mk(geo.position), normal: mk(geo.normal), uv: mk(geo.uv),
      index: mk(geo.index, gl.ELEMENT_ARRAY_BUFFER), count: geo.index.length,
    };
  }

  _texture(canvas) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  resize() {
    const gl = this.gl, c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, (c.clientWidth || c.width) * dpr) | 0;
    const h = Math.max(1, (c.clientHeight || c.height) * dpr) | 0;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, c.width, c.height);
    this.aspect = c.width / c.height;
  }

  setMode(m) { this.mode = m; }

  _bind(mesh) {
    const gl = this.gl, a = this.attr;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position); gl.enableVertexAttribArray(a.aPosition); gl.vertexAttribPointer(a.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal); gl.enableVertexAttribArray(a.aNormal); gl.vertexAttribPointer(a.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv); gl.enableVertexAttribArray(a.aUV); gl.vertexAttribPointer(a.aUV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
  }

  _draw(mesh, color, alpha = 1, tex = null) {
    const gl = this.gl;
    mat4.normalFromMat4(this.nmat, this.model);
    gl.uniformMatrix4fv(this.uni.uModel, false, this.model);
    gl.uniformMatrix3fv(this.uni.uNormalMat, false, this.nmat);
    gl.uniform1f(this.uni.uAlpha, alpha);
    if (tex) {
      gl.uniform1f(this.uni.uUseTex, 1); gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(this.uni.uTex, 0);
    } else {
      gl.uniform1f(this.uni.uUseTex, 0);
      gl.uniform3f(this.uni.uColor, color[0], color[1], color[2]);
    }
    this._bind(mesh);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }

  // World mapping: sim(x:0..W, y:0..L, z=height) -> world(x - W/2, z, y - L/2)
  render(state, dt) {
    const gl = this.gl;
    this.resize();
    const ball = state.ball;
    const bwx = ball.x - PITCH.W / 2, bwz = ball.y - PITCH.L / 2;
    this.camX = lerp(this.camX, bwx, 0.06);
    this.camZ = lerp(this.camZ, bwz, 0.06);

    // Camera (positioned to look over the near stands into the pitch)
    let eye, target;
    if (this.mode === 'high') {
      eye = [this.camX * 0.35, 70, this.camZ - 26];
      target = [this.camX * 0.25, 0, this.camZ + 6];
    } else if (this.mode === 'end') {
      const dir = this.camZ >= 0 ? 1 : -1;
      eye = [this.camX * 0.5, 32, dir * (PITCH.L / 2 + 30)];
      target = [this.camX * 0.35, 1, this.camZ * 0.5];
    } else { // broadcast (side)
      eye = [-(PITCH.W / 2 + 16), 37, this.camZ * 0.68];
      target = [this.camX * 0.28, 1, this.camZ];
    }
    mat4.perspective(this.proj, 0.75, this.aspect, 0.6, 520);
    mat4.lookAt(this.view, eye, target, [0, 1, 0]);

    gl.clearColor(0.07, 0.1, 0.17, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.uni.uProj, false, this.proj);
    gl.uniformMatrix4fv(this.uni.uView, false, this.view);
    gl.uniform3f(this.uni.uLightDir, 0.4, 0.9, 0.25);
    gl.uniform1f(this.uni.uAmbient, 0.62);

    this._drawStadium();
    this._drawField();
    this._drawGoals();

    // Shadows first (blended, no depth write)
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    for (const p of state.players) this._drawShadow(p.pos.x - PITCH.W / 2, p.pos.y - PITCH.L / 2, 1.05);
    this._drawShadow(bwx, bwz, 0.5 + ball.z * 0.06);
    gl.depthMask(true); gl.disable(gl.BLEND);

    // Players
    for (const p of state.players) this._drawPlayer(state, p, dt);

    // Ball
    mat4.compose(this.model, bwx, ball.z + 0.42, bwz, 0, 0, 1, 1, 1);
    this._draw(this.meshes.ball, [0.97, 0.97, 0.99]);
  }

  _drawField() {
    mat4.compose(this.model, 0, 0.01, 0, 0, 0, 1, 1, 1);
    this._draw(this.meshes.field, [1, 1, 1], 1, this.pitchTex);
  }

  _drawShadow(wx, wz, r) {
    mat4.compose(this.model, wx, 0.03, wz, 0, 0, r, 1, r);
    this._draw(this.meshes.shadow, [0, 0, 0], 0.28);
  }

  _drawStadium() {
    const W = PITCH.W, L = PITCH.L, m = PITCH.MARGIN;
    // Ground apron (surrounds the pitch)
    mat4.compose(this.model, 0, -0.04, 0, 0, 0, 1, 1, 1);
    this._draw(this.meshes.pitch, [0.12, 0.16, 0.13]);

    // Four raised crowd stands as boxes forming a bowl around the pitch.
    const depth = 22, height = 15, y = height / 2 + 0.5;
    const extra = 30;
    const stands = [
      { x: W / 2 + m + depth / 2, z: 0, sx: depth, sz: L + 2 * m + extra },
      { x: -(W / 2 + m + depth / 2), z: 0, sx: depth, sz: L + 2 * m + extra },
      { x: 0, z: L / 2 + m + depth / 2, sx: W + 2 * m + extra, sz: depth },
      { x: 0, z: -(L / 2 + m + depth / 2), sx: W + 2 * m + extra, sz: depth },
    ];
    for (const s of stands) {
      // concrete base
      mat4.compose(this.model, s.x, height * 0.28, s.z, 0, 0, s.sx, height * 0.56, s.sz);
      this._draw(this.meshes.box, [0.14, 0.16, 0.22]);
      // crowd tier (slightly inset, raised)
      const inset = 0.7;
      mat4.compose(this.model, s.x, y, s.z, 0, 0, s.sx * inset, height * 0.9, s.sz * inset);
      this._draw(this.meshes.box, [1, 1, 1], 1, this.crowdTex);
    }
  }

  _drawGoals() {
    const W = PITCH.W, L = PITCH.L, gw = PITCH.GOAL_W, gh = PITCH.GOAL_H;
    for (const end of [-1, 1]) {
      const z = end * (L / 2);
      // posts
      for (const sx of [-1, 1]) {
        mat4.compose(this.model, sx * gw / 2, gh / 2, z, 0, 0, 1, gh, 1);
        this._draw(this.meshes.post, [0.96, 0.96, 0.98]);
      }
      // crossbar
      mat4.compose(this.model, 0, gh, z, 0, 0, gw / 0.16, 1, 1);
      this._draw(this.meshes.post, [0.96, 0.96, 0.98]);
      // net (blended)
      this.gl.enable(this.gl.BLEND); this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
      mat4.compose(this.model, 0, gh / 2, z + end * 1.1, 0, 0, gw, 1, gh);
      this._draw(this.meshes.net, [0.8, 0.85, 0.95], 0.16);
      this.gl.disable(this.gl.BLEND);
    }
  }

  _drawPlayer(state, p, dt) {
    const wx = p.pos.x - PITCH.W / 2, wz = p.pos.y - PITCH.L / 2;
    const sp = Math.hypot(p.vel.x, p.vel.y);
    p._stride = (p._stride || 0) + sp * dt * 1.9;
    const moving = clamp(sp / 6, 0, 1);
    const swing = Math.sin(p._stride) * moving * 0.32;
    const bob = Math.abs(Math.sin(p._stride)) * moving * 0.07;
    // facing in world: sim vel (x,y) -> world (x,z)
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const px = -fz, pz = fx; // perpendicular (lateral)
    const ry = Math.atan2(fx, fz);
    const kit = state.teams[p.team].colors;
    const jersey = p._c || (p._c = hexToRgb(kit[0]));
    const shorts = p._c2 || (p._c2 = hexToRgb(kit[1] === '#ffffff' ? '#1a2233' : kit[1] || '#1a2233'));
    const skin = [0.86, 0.68, 0.54];
    const celebrating = p.action === 'celebrate';
    const jump = celebrating ? Math.abs(Math.sin(p._stride * 2)) * 0.4 : 0;

    // legs (stepping)
    for (const s of [1, -1]) {
      const lx = wx + px * 0.13 * s + fx * swing * s;
      const lz = wz + pz * 0.13 * s + fz * swing * s;
      mat4.compose(this.model, lx, 0.31 + jump, lz, ry, 0, 1, 1, 1);
      this._draw(this.meshes.leg, shorts);
    }
    // torso
    mat4.compose(this.model, wx, 1.06 + bob + jump, wz, ry, 0, 1, 1, 1);
    this._draw(this.meshes.torso, jersey);
    // head
    mat4.compose(this.model, wx, 1.58 + bob + jump, wz, ry, 0, 1, 1, 1);
    this._draw(this.meshes.head, skin);
    if (p.isGK) {
      // gloves hint: small bright shoulders (draw a thin box across)
      mat4.compose(this.model, wx, 1.28 + bob, wz, ry, 0, 1.05, 0.22, 1.05);
      this._draw(this.meshes.torso, [0.95, 0.85, 0.2]);
    }
  }

  dispose() {
    const gl = this.gl;
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch {}
  }
}
