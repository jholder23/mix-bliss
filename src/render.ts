import { BANDS, RGB_FROM_BAND } from './km'
import {
  compileProgram,
  createFbo,
  createGL,
  createTexture2D,
  pickFloatFormat,
  resizeTexture,
  type FloatFormat,
} from './gl'
import { GRID, PAD, SPLAT_RADIUS, type PaintSim } from './mpm'

const STRIDE_FLOATS = 24

const SPLAT_VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_mass;
layout(location=2) in vec3 a_resid;
layout(location=3) in vec4 a_k0;
layout(location=4) in vec4 a_k1;
layout(location=5) in vec4 a_s0;
layout(location=6) in vec4 a_s1;
uniform vec2 u_padGrid;
uniform float u_pointSize;
out float v_mass;
out vec3 v_resid;
out vec4 v_k0;
out vec4 v_k1;
out vec4 v_s0;
out vec4 v_s1;
void main() {
  vec2 uv = (a_pos - u_padGrid.x) / u_padGrid.y;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = u_pointSize;
  v_mass = a_mass;
  v_resid = a_resid;
  v_k0 = a_k0;
  v_k1 = a_k1;
  v_s0 = a_s0;
  v_s1 = a_s1;
}
`

const SPLAT_FRAG = `#version 300 es
precision highp float;
in float v_mass;
in vec3 v_resid;
in vec4 v_k0;
in vec4 v_k1;
in vec4 v_s0;
in vec4 v_s1;
layout(location=0) out vec4 o_mass;
layout(location=1) out vec4 o_k0;
layout(location=2) out vec4 o_k1;
layout(location=3) out vec4 o_s0;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float w = exp(-r2 * 3.4) * v_mass;
  o_mass = vec4(w, v_resid * w);
  o_k0 = v_k0 * w;
  o_k1 = v_k1 * w;
  o_s0 = v_s0 * w;
}
`

const SPLAT_S1_FRAG = `#version 300 es
precision highp float;
in float v_mass;
in vec3 v_resid;
in vec4 v_k0;
in vec4 v_k1;
in vec4 v_s0;
in vec4 v_s1;
layout(location=0) out vec4 o_s1;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float w = exp(-r2 * 3.4) * v_mass;
  o_s1 = v_s1 * w;
}
`

const COMPOSE_VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_canvas;
void main() {
  v_canvas = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const COMPOSE_FRAG = `#version 300 es
precision highp float;
in vec2 v_canvas;
uniform sampler2D u_mass;
uniform sampler2D u_k0;
uniform sampler2D u_k1;
uniform sampler2D u_s0;
uniform sampler2D u_s1;
uniform vec3 u_rgbFromBand[8];
uniform vec2 u_texel;
uniform vec2 u_knifeA;
uniform vec2 u_knifeB;
uniform float u_knifeW;
uniform float u_knifeOn;
uniform vec2 u_trayOff;
uniform vec2 u_trayScale;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float kmR(float K, float S) {
  float s = max(S, 1e-5);
  float x = max(K, 0.0) / s;
  float r = 1.0 + x - sqrt(x * (x + 2.0));
  return clamp(r, 1e-5, 1.0 - 1e-5);
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 lo = 12.92 * c;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  bvec3 cut = lessThanEqual(c, vec3(0.0031308));
  return vec3(cut.x ? lo.x : hi.x, cut.y ? lo.y : hi.y, cut.z ? lo.z : hi.z);
}

float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

vec3 porcelain(vec2 uv) {
  float n1 = hash(uv * vec2(19.4, 27.1));
  float n2 = hash(uv * vec2(73.2, 51.8) + 2.7);
  float n3 = hash(floor(uv * 220.0));
  float grain = (n1 * 0.45 + n2 * 0.35 + n3 * 0.2) * 0.035;
  float d = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
  float rim = smoothstep(0.0, 0.042, d);
  float well = smoothstep(0.0, 0.09, d);
  vec3 body = vec3(0.905, 0.872, 0.812);
  body *= 0.96 + grain;
  body *= mix(vec3(0.72, 0.70, 0.66), vec3(1.0), rim);
  body *= mix(0.965, 1.0, well);
  float lip = smoothstep(0.028, 0.01, d) * smoothstep(0.0, 0.018, d);
  body += vec3(0.07, 0.065, 0.055) * lip;
  return body;
}

vec3 tableTop(vec2 uv) {
  float n = hash(uv * 48.0);
  return vec3(0.42, 0.38, 0.32) * (0.94 + n * 0.08);
}

out vec4 o_color;

void main() {
  vec2 v_uv = (v_canvas - u_trayOff) / u_trayScale;
  if (v_uv.x < -0.045 || v_uv.y < -0.045 || v_uv.x > 1.045 || v_uv.y > 1.045) {
    o_color = vec4(linearToSrgb(tableTop(v_canvas)), 1.0);
    return;
  }

  vec4 massS = texture(u_mass, v_uv);
  float mass = massS.x;
  vec4 k0 = texture(u_k0, v_uv);
  vec4 k1 = texture(u_k1, v_uv);
  vec4 s0 = texture(u_s0, v_uv);
  vec4 s1 = texture(u_s1, v_uv);

  vec3 tray = porcelain(v_uv);
  float mL = texture(u_mass, v_uv - vec2(u_texel.x, 0.0)).x;
  float mR = texture(u_mass, v_uv + vec2(u_texel.x, 0.0)).x;
  float mD = texture(u_mass, v_uv - vec2(0.0, u_texel.y)).x;
  float mU = texture(u_mass, v_uv + vec2(0.0, u_texel.y)).x;
  float contact = smoothstep(0.16, 0.0, mass) * smoothstep(0.0, 0.05, max(max(mL, mR), max(mD, mU)));
  tray *= 1.0 - 0.10 * contact;

  float coverage = smoothstep(0.035, 0.20, mass);
  vec3 paintLin = tray;
  if (coverage > 0.001 && mass > 1e-5) {
    float inv = 1.0 / mass;
    float K[8];
    float S[8];
    K[0]=k0.x*inv; K[1]=k0.y*inv; K[2]=k0.z*inv; K[3]=k0.w*inv;
    K[4]=k1.x*inv; K[5]=k1.y*inv; K[6]=k1.z*inv; K[7]=k1.w*inv;
    S[0]=s0.x*inv; S[1]=s0.y*inv; S[2]=s0.z*inv; S[3]=s0.w*inv;
    S[4]=s1.x*inv; S[5]=s1.y*inv; S[6]=s1.z*inv; S[7]=s1.w*inv;
    vec3 lin = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      lin += u_rgbFromBand[i] * kmR(K[i], S[i]);
    }
    lin += massS.yzw * inv * smoothstep(0.04, 0.22, mass);
    lin = max(lin, vec3(0.0));

    float h = mass / (mass + 1.65);
    vec2 g = vec2(mR - mL, mU - mD);
    vec3 N = normalize(vec3(-g * 3.1, 0.62));
    vec3 L = normalize(vec3(-0.22, 0.38, 0.9));
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);
    float ndl = clamp(dot(N, L), 0.0, 1.0);
    float spec = pow(clamp(dot(N, H), 0.0, 1.0), 56.0);
    float fres = 0.045 + 0.12 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
    vec3 shaded = lin * (0.78 + 0.22 * ndl) + vec3(0.92, 0.94, 0.96) * spec * fres * (0.35 + 0.65 * h);
    paintLin = shaded;
  }

  vec3 col = mix(tray, paintLin, coverage);

  if (u_knifeOn > 0.5) {
    float d = sdCapsule(v_uv, u_knifeA, u_knifeB, u_knifeW);
    float blade = 1.0 - smoothstep(0.0, fwidth(d) * 1.6 + 0.0015, d);
    float shadow = 1.0 - smoothstep(0.0, u_knifeW * 2.4 + 0.006, d);
    col *= 1.0 - 0.16 * shadow * (1.0 - blade);
    vec3 metal = vec3(0.62, 0.63, 0.64);
    float glint = pow(clamp(1.0 - abs(d + u_knifeW * 0.15) / (u_knifeW + 0.002), 0.0, 1.0), 3.0);
    metal += vec3(0.22) * glint;
    col = mix(col, metal, blade * 0.92);
  }

  o_color = vec4(linearToSrgb(col), 1.0);
}
`

export type KnifeDraw = {
  ax: number
  ay: number
  bx: number
  by: number
  width: number
} | null

export class PaintRenderer {
  readonly gl: WebGL2RenderingContext
  private readonly fmt: FloatFormat
  private readonly splat: WebGLProgram
  private readonly splatS1: WebGLProgram
  private readonly compose: WebGLProgram
  private readonly quad: WebGLBuffer
  private readonly vbo: WebGLBuffer
  private readonly vaoSplat: WebGLVertexArrayObject
  private readonly vaoQuad: WebGLVertexArrayObject
  private tMass: WebGLTexture
  private tK0: WebGLTexture
  private tK1: WebGLTexture
  private tS0: WebGLTexture
  private tS1: WebGLTexture
  private fboMain: WebGLFramebuffer
  private fboS1: WebGLFramebuffer
  private fboW = 0
  private fboH = 0
  private filmReady = false
  private upload = new Float32Array(0)
  private readonly rgbFromBand: Float32Array

  constructor(canvas: HTMLCanvasElement) {
    this.gl = createGL(canvas)
    this.fmt = pickFloatFormat(this.gl)
    this.splat = compileProgram(this.gl, SPLAT_VERT, SPLAT_FRAG, 'splat')
    this.splatS1 = compileProgram(this.gl, SPLAT_VERT, SPLAT_S1_FRAG, 'splat-s1')
    this.compose = compileProgram(this.gl, COMPOSE_VERT, COMPOSE_FRAG, 'compose')

    const gl = this.gl
    this.vbo = gl.createBuffer()!
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

    this.vaoSplat = this.makeSplatVao()
    this.vaoQuad = gl.createVertexArray()!
    gl.bindVertexArray(this.vaoQuad)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    this.tMass = createTexture2D(gl, 4, 4, this.fmt)
    this.tK0 = createTexture2D(gl, 4, 4, this.fmt)
    this.tK1 = createTexture2D(gl, 4, 4, this.fmt)
    this.tS0 = createTexture2D(gl, 4, 4, this.fmt)
    this.tS1 = createTexture2D(gl, 4, 4, this.fmt)
    this.fboMain = createFbo(gl, [this.tMass, this.tK0, this.tK1, this.tS0])
    this.fboS1 = createFbo(gl, [this.tS1])

    this.rgbFromBand = new Float32Array(BANDS * 3)
    for (let i = 0; i < BANDS; i++) {
      const w = RGB_FROM_BAND[i]!
      this.rgbFromBand[i * 3] = w[0]!
      this.rgbFromBand[i * 3 + 1] = w[1]!
      this.rgbFromBand[i * 3 + 2] = w[2]!
    }
  }

  private makeSplatVao(): WebGLVertexArrayObject {
    const gl = this.gl
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    const stride = STRIDE_FLOATS * 4
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 8)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 12)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 24)
    gl.enableVertexAttribArray(4)
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 40)
    gl.enableVertexAttribArray(5)
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, stride, 56)
    gl.enableVertexAttribArray(6)
    gl.vertexAttribPointer(6, 4, gl.FLOAT, false, stride, 72)
    gl.bindVertexArray(null)
    return vao
  }

  draw(sim: PaintSim, knife: KnifeDraw, canvasW: number, canvasH: number): void {
    const gl = this.gl
    const size = Math.max(768, Math.min(1536, Math.round(Math.max(canvasW, canvasH))))
    const resized = size !== this.fboW || size !== this.fboH
    if (resized) {
      this.fboW = size
      this.fboH = size
      resizeTexture(gl, this.tMass, size, size, this.fmt)
      resizeTexture(gl, this.tK0, size, size, this.fmt)
      resizeTexture(gl, this.tK1, size, size, this.fmt)
      resizeTexture(gl, this.tS0, size, size, this.fmt)
      resizeTexture(gl, this.tS1, size, size, this.fmt)
      this.filmReady = false
    }

    const needSplat = !this.filmReady || sim.dirty || !sim.sleeping
    if (needSplat) {
      const inner = GRID - 2 * PAD
      const pointSize = Math.max(8, (SPLAT_RADIUS / inner) * size * 2.35)

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboMain)
      gl.viewport(0, 0, size, size)
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3])
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.splatParticles(sim, pointSize, this.splat, true)

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboS1)
      gl.drawBuffers([gl.COLOR_ATTACHMENT0])
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.splatParticles(sim, pointSize, this.splatS1, false)
      this.filmReady = true
      sim.dirty = false
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvasW, canvasH)
    gl.disable(gl.BLEND)
    gl.useProgram(this.compose)
    gl.bindVertexArray(this.vaoQuad)
    this.bindTex(this.compose, 'u_mass', this.tMass, 0)
    this.bindTex(this.compose, 'u_k0', this.tK0, 1)
    this.bindTex(this.compose, 'u_k1', this.tK1, 2)
    this.bindTex(this.compose, 'u_s0', this.tS0, 3)
    this.bindTex(this.compose, 'u_s1', this.tS1, 4)
    const locBand = gl.getUniformLocation(this.compose, 'u_rgbFromBand')
    gl.uniform3fv(locBand, this.rgbFromBand)
    gl.uniform2f(gl.getUniformLocation(this.compose, 'u_texel'), 1 / size, 1 / size)
    const layout = trayLayout(canvasW, canvasH)
    gl.uniform2f(gl.getUniformLocation(this.compose, 'u_trayOff'), layout.offX, layout.offY)
    gl.uniform2f(gl.getUniformLocation(this.compose, 'u_trayScale'), layout.scaleX, layout.scaleY)
    if (knife) {
      gl.uniform2f(gl.getUniformLocation(this.compose, 'u_knifeA'), knife.ax, knife.ay)
      gl.uniform2f(gl.getUniformLocation(this.compose, 'u_knifeB'), knife.bx, knife.by)
      gl.uniform1f(gl.getUniformLocation(this.compose, 'u_knifeW'), knife.width)
      gl.uniform1f(gl.getUniformLocation(this.compose, 'u_knifeOn'), 1)
    } else {
      gl.uniform1f(gl.getUniformLocation(this.compose, 'u_knifeOn'), 0)
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  private splatParticles(sim: PaintSim, pointSize: number, program: WebGLProgram, fourTargets: boolean): void {
    const gl = this.gl
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.useProgram(program)
    gl.uniform2f(gl.getUniformLocation(program, 'u_padGrid'), PAD, GRID - 2 * PAD)
    gl.uniform1f(gl.getUniformLocation(program, 'u_pointSize'), pointSize)
    if (sim.count > 0) {
      this.pack(sim)
      gl.bindVertexArray(this.vaoSplat)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
      gl.bufferData(gl.ARRAY_BUFFER, this.upload.subarray(0, sim.count * STRIDE_FLOATS), gl.STREAM_DRAW)
      gl.drawArrays(gl.POINTS, 0, sim.count)
      gl.bindVertexArray(null)
    }
    gl.disable(gl.BLEND)
    void fourTargets
  }

  private pack(sim: PaintSim): void {
    const need = sim.count * STRIDE_FLOATS
    if (this.upload.length < need) this.upload = new Float32Array(Math.max(need, 1024) * 1)
    const u = this.upload
    const n = sim.count
    for (let p = 0; p < n; p++) {
      const o = p * STRIDE_FLOATS
      const ko = p * BANDS
      u[o] = sim.px[p]!
      u[o + 1] = sim.py[p]!
      u[o + 2] = sim.mass[p]!
      u[o + 3] = sim.resid[p * 3]!
      u[o + 4] = sim.resid[p * 3 + 1]!
      u[o + 5] = sim.resid[p * 3 + 2]!
      u[o + 6] = sim.k[ko]!
      u[o + 7] = sim.k[ko + 1]!
      u[o + 8] = sim.k[ko + 2]!
      u[o + 9] = sim.k[ko + 3]!
      u[o + 10] = sim.k[ko + 4]!
      u[o + 11] = sim.k[ko + 5]!
      u[o + 12] = sim.k[ko + 6]!
      u[o + 13] = sim.k[ko + 7]!
      u[o + 14] = sim.s[ko]!
      u[o + 15] = sim.s[ko + 1]!
      u[o + 16] = sim.s[ko + 2]!
      u[o + 17] = sim.s[ko + 3]!
      u[o + 18] = sim.s[ko + 4]!
      u[o + 19] = sim.s[ko + 5]!
      u[o + 20] = sim.s[ko + 6]!
      u[o + 21] = sim.s[ko + 7]!
    }
  }

  private bindTex(program: WebGLProgram, name: string, tex: WebGLTexture, unit: number): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(gl.getUniformLocation(program, name), unit)
  }
}

export function trayLayout(canvasW: number, canvasH: number): { offX: number; offY: number; scaleX: number; scaleY: number; side: number } {
  const side = Math.min(canvasW, canvasH) * 0.96
  return {
    offX: ((canvasW - side) * 0.5) / canvasW,
    offY: ((canvasH - side) * 0.5) / canvasH,
    scaleX: side / canvasW,
    scaleY: side / canvasH,
    side,
  }
}

export function simToUv(x: number, y: number): { u: number; v: number } {
  const inner = GRID - 2 * PAD
  return { u: (x - PAD) / inner, v: (y - PAD) / inner }
}

export function uvToSim(u: number, v: number): { x: number; y: number } {
  const inner = GRID - 2 * PAD
  return { x: PAD + u * inner, y: PAD + v * inner }
}

export function pointerToSim(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  canvasW: number,
  canvasH: number,
): { x: number; y: number } | null {
  const layout = trayLayout(canvasW, canvasH)
  const nx = (clientX - rect.left) / rect.width
  const ny = 1 - (clientY - rect.top) / rect.height
  const u = (nx - layout.offX) / layout.scaleX
  const v = (ny - layout.offY) / layout.scaleY
  if (u < -0.02 || v < -0.02 || u > 1.02 || v > 1.02) return null
  return uvToSim(clamp01(u), clamp01(v))
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
