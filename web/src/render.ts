import { BANDS, RGB_FROM_BAND } from './km'
import {
  compileProgram,
  createFbo,
  createGL,
  createRgba8Texture,
  createTexture2D,
  isSoftwareGL,
  pickFloatFormat,
  resizeTexture,
  type FloatFormat,
} from './gl'
import { GRID, PAD, SPLAT_RADIUS, type PaintSim } from './mpm'

const STRIDE_FLOATS = 24
const PORCELAIN_RES = 1024

const SPLAT_VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_mass;
layout(location=2) in vec3 a_resid;
layout(location=3) in vec4 a_k0;
layout(location=4) in vec4 a_k1;
layout(location=5) in vec4 a_s0;
layout(location=6) in vec4 a_s1;
layout(location=7) in vec2 a_flow;
uniform vec2 u_padGrid;
uniform float u_pointSize;
out float v_mass;
out vec3 v_resid;
out vec4 v_k0;
out vec4 v_k1;
out vec4 v_s0;
out vec4 v_s1;
out vec2 v_flow;
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
  v_flow = a_flow;
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
in vec2 v_flow;
layout(location=0) out vec4 o_mass;
layout(location=1) out vec4 o_k0;
layout(location=2) out vec4 o_k1;
layout(location=3) out vec4 o_s0;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float w = exp(-r2 * 3.2) * v_mass;
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
in vec2 v_flow;
layout(location=0) out vec4 o_s1;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float w = exp(-r2 * 3.2) * v_mass;
  o_s1 = v_s1 * w;
}
`

const SPLAT_FLOW_FRAG = `#version 300 es
precision highp float;
in float v_mass;
in vec3 v_resid;
in vec4 v_k0;
in vec4 v_k1;
in vec4 v_s0;
in vec4 v_s1;
in vec2 v_flow;
layout(location=0) out vec4 o_flow;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float w = exp(-r2 * 3.2) * v_mass;
  o_flow = vec4(v_flow * w, length(v_flow) * w, w);
}
`

const COMPOSE_VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const COMPOSE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_mass;
uniform sampler2D u_k0;
uniform sampler2D u_k1;
uniform sampler2D u_s0;
uniform sampler2D u_s1;
uniform sampler2D u_flow;
uniform sampler2D u_porcelain;
uniform vec3 u_rgbFromBand[8];
uniform vec2 u_texel;
uniform vec2 u_toolA;
uniform vec2 u_toolB;
uniform float u_toolW;
uniform float u_toolKind;
uniform float u_aspect;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float kmR(float K, float S) {
  float s = max(S, 1e-5);
  float x = max(K, 0.0) / s;
  float r = 1.0 + x - sqrt(x * (x + 2.0));
  return clamp(r, 1e-5, 0.999);
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 lo = 12.92 * c;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  bvec3 cut = lessThanEqual(c, vec3(0.0031308));
  return vec3(cut.x ? lo.x : hi.x, cut.y ? lo.y : hi.y, cut.z ? lo.z : hi.z);
}

float D_GGX(float NoH, float rough) {
  float a = max(rough * rough, 0.002);
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (3.14159265 * d * d);
}

float F_Schlick(float VoH, float f0) {
  float u = 1.0 - VoH;
  return f0 + (1.0 - f0) * u * u * u * u * u;
}

float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

vec3 shadeLight(vec3 N, vec3 V, vec3 L, vec3 albedo, float rough, vec3 lightCol, float wrap) {
  vec3 H = normalize(L + V);
  float ndl = clamp(dot(N, L) * (1.0 - wrap) + wrap, 0.0, 1.0);
  float ndh = clamp(dot(N, H), 0.0, 1.0);
  float voh = clamp(dot(V, H), 0.0, 1.0);
  float spec = D_GGX(ndh, rough) * F_Schlick(voh, 0.045);
  return albedo * lightCol * ndl + lightCol * spec * 0.22;
}

out vec4 o_color;

void main() {
  vec2 uv = v_uv;
  vec4 massS = texture(u_mass, uv);
  float mass = massS.x;
  vec4 k0 = texture(u_k0, uv);
  vec4 k1 = texture(u_k1, uv);
  vec4 s0 = texture(u_s0, uv);
  vec4 s1 = texture(u_s1, uv);
  vec4 flowS = texture(u_flow, uv);

  vec4 porc = texture(u_porcelain, uv);
  vec3 tray = porc.rgb;
  float trayRough = mix(0.34, 0.48, porc.a);

  float mL = texture(u_mass, uv - vec2(u_texel.x, 0.0)).x;
  float mR = texture(u_mass, uv + vec2(u_texel.x, 0.0)).x;
  float mD = texture(u_mass, uv - vec2(0.0, u_texel.y)).x;
  float mU = texture(u_mass, uv + vec2(0.0, u_texel.y)).x;
  float mLL = texture(u_mass, uv - vec2(u_texel.x * 2.0, 0.0)).x;
  float mRR = texture(u_mass, uv + vec2(u_texel.x * 2.0, 0.0)).x;
  float mDD = texture(u_mass, uv - vec2(0.0, u_texel.y * 2.0)).x;
  float mUU = texture(u_mass, uv + vec2(0.0, u_texel.y * 2.0)).x;

  float neighbor = max(max(mL, mR), max(mD, mU));
  float contact = smoothstep(0.14, 0.0, mass) * smoothstep(0.0, 0.08, neighbor);
  tray *= 1.0 - 0.16 * contact;
  tray *= 1.0 - 0.05 * smoothstep(0.04, 0.0, mass) * smoothstep(0.0, 0.22, neighbor);

  vec3 Ntray = vec3(0.0, 0.0, 1.0);
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 Lkey = normalize(vec3(-0.18, 0.42, 0.88));
  vec3 Lfill = normalize(vec3(0.38, -0.22, 0.78));
  vec3 Lrim = normalize(vec3(0.02, 0.55, 0.55));
  vec3 Ckey = vec3(1.0, 0.97, 0.92) * 0.95;
  vec3 Cfill = vec3(0.86, 0.90, 0.98) * 0.38;
  vec3 Crim = vec3(1.0, 0.96, 0.9) * 0.22;
  vec3 ambient = vec3(0.78, 0.74, 0.68);

  vec3 trayLit = tray * ambient * 0.72;
  trayLit += shadeLight(Ntray, V, Lkey, tray, trayRough, Ckey, 0.22);
  trayLit += shadeLight(Ntray, V, Lfill, tray, trayRough, Cfill, 0.35);
  float trayFres = 0.03 + 0.08 * pow(1.0 - clamp(dot(Ntray, V), 0.0, 1.0), 5.0);
  trayLit += Ckey * trayFres * 0.18;

  float coverage = smoothstep(0.028, 0.18, mass);
  vec3 col = trayLit;

  if (coverage > 0.0008 && mass > 1e-5) {
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
    lin += massS.yzw * inv * smoothstep(0.05, 0.24, mass);
    lin = max(lin, vec3(0.0));

    float h = mass / (mass + 1.55);
    float gx = (mRR + 2.0 * mR - mLL - 2.0 * mL) * 0.25;
    float gy = (mUU + 2.0 * mU - mDD - 2.0 * mD) * 0.25;
    vec3 N = normalize(vec3(-gx * 2.8, -gy * 2.8 * u_aspect, 0.72));

    float flowW = max(flowS.w, 1e-5);
    vec2 flow = flowS.xy / flowW;
    float streak = clamp(length(flow) * 0.18, 0.0, 1.0);
    vec2 fdir = length(flow) > 1e-4 ? normalize(flow) : vec2(1.0, 0.0);

    float wet = mix(0.22, 0.055, h);
    wet = mix(wet, wet * 0.72, streak);
    float valley = 1.0 - smoothstep(0.12, 0.55, h);
    vec3 body = lin * (0.88 + 0.08 * h) * (1.0 - 0.10 * valley);

    vec3 paint = body * ambient * 0.42;
    paint += shadeLight(N, V, Lkey, body, wet, Ckey, 0.08);
    paint += shadeLight(N, V, Lfill, body, wet + 0.06, Cfill, 0.18);
    paint += shadeLight(N, V, Lrim, body, wet + 0.04, Crim, 0.12);

    vec3 H = normalize(Lkey + V);
    float coat = D_GGX(clamp(dot(N, H), 0.0, 1.0), mix(0.045, 0.12, valley)) * F_Schlick(clamp(dot(V, H), 0.0, 1.0), 0.06);
    float aniso = pow(abs(dot(vec2(N.x, N.y), vec2(-fdir.y, fdir.x))), 2.0);
    coat *= 1.0 + streak * aniso * 0.55;
    paint += vec3(0.96, 0.97, 0.98) * coat * (0.28 + 0.55 * h);

    float edge = smoothstep(0.04, 0.0, mass) * smoothstep(0.0, 0.16, neighbor);
    paint *= 1.0 - 0.12 * edge;

    col = mix(trayLit, paint, coverage);
  }

  if (u_toolKind > 0.5) {
    if (u_toolKind < 1.5) {
      float d = length((uv - u_toolA) * vec2(1.0, u_aspect));
      float disc = 1.0 - smoothstep(u_toolW, u_toolW + 0.008, d);
      float press = 1.0 - smoothstep(u_toolW * 0.35, u_toolW * 1.15, d);
      col *= 1.0 - 0.10 * press;
      col = mix(col, col * vec3(0.92, 0.90, 0.86), disc * 0.18);
    } else {
      float d = sdCapsule(uv, u_toolA, u_toolB, u_toolW);
      float blade = 1.0 - smoothstep(0.0, fwidth(d) * 1.5 + 0.0012, d);
      float shadow = 1.0 - smoothstep(0.0, u_toolW * 2.6 + 0.007, d);
      col *= 1.0 - 0.18 * shadow * (1.0 - blade);
      vec3 metal = vec3(0.58, 0.59, 0.60);
      float glint = pow(clamp(1.0 - abs(d + u_toolW * 0.12) / (u_toolW + 0.002), 0.0, 1.0), 3.0);
      metal += vec3(0.28, 0.28, 0.27) * glint;
      col = mix(col, metal, blade * 0.94);
    }
  }

  float grain = (hash21(uv * vec2(1847.0, 1321.0)) - 0.5) * 0.012;
  col += grain;
  o_color = vec4(linearToSrgb(max(col, vec3(0.0))), 1.0);
}
`

export type ToolDraw = {
  kind: 'finger' | 'scraper'
  ax: number
  ay: number
  bx: number
  by: number
  width: number
} | null

export class PaintRenderer {
  readonly gl: WebGL2RenderingContext
  readonly software: boolean
  private readonly fmt: FloatFormat
  private readonly splat: WebGLProgram
  private readonly splatS1: WebGLProgram
  private readonly splatFlow: WebGLProgram
  private readonly compose: WebGLProgram
  private readonly quad: WebGLBuffer
  private readonly vbo: WebGLBuffer
  private readonly vaoSplat: WebGLVertexArrayObject
  private readonly vaoQuad: WebGLVertexArrayObject
  private readonly porcelain: WebGLTexture
  private tMass: WebGLTexture
  private tK0: WebGLTexture
  private tK1: WebGLTexture
  private tS0: WebGLTexture
  private tS1: WebGLTexture
  private tFlow: WebGLTexture
  private fboMain: WebGLFramebuffer
  private fboS1: WebGLFramebuffer
  private fboFlow: WebGLFramebuffer
  private fboW = 0
  private fboH = 0
  private filmReady = false
  private upload = new Float32Array(0)
  private readonly rgbFromBand: Float32Array

  constructor(canvas: HTMLCanvasElement) {
    this.gl = createGL(canvas)
    this.software = isSoftwareGL(this.gl)
    this.fmt = pickFloatFormat(this.gl)
    this.splat = compileProgram(this.gl, SPLAT_VERT, SPLAT_FRAG, 'splat')
    this.splatS1 = compileProgram(this.gl, SPLAT_VERT, SPLAT_S1_FRAG, 'splat-s1')
    this.splatFlow = compileProgram(this.gl, SPLAT_VERT, SPLAT_FLOW_FRAG, 'splat-flow')
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
    this.tFlow = createTexture2D(gl, 4, 4, this.fmt)
    this.fboMain = createFbo(gl, [this.tMass, this.tK0, this.tK1, this.tS0])
    this.fboS1 = createFbo(gl, [this.tS1])
    this.fboFlow = createFbo(gl, [this.tFlow])
    this.porcelain = createRgba8Texture(gl, PORCELAIN_RES, PORCELAIN_RES, makePorcelain(PORCELAIN_RES))

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
    gl.enableVertexAttribArray(7)
    gl.vertexAttribPointer(7, 2, gl.FLOAT, false, stride, 88)
    gl.bindVertexArray(null)
    return vao
  }

  filmSize(canvasW: number, canvasH: number): number {
    const longSide = Math.max(canvasW, canvasH)
    if (this.software) return Math.max(512, Math.min(768, Math.round(longSide * 0.7)))
    return Math.max(896, Math.min(1600, Math.round(longSide)))
  }

  draw(sim: PaintSim, tool: ToolDraw, canvasW: number, canvasH: number, forceSplat = false): void {
    const gl = this.gl
    const size = this.filmSize(canvasW, canvasH)
    const resized = size !== this.fboW || size !== this.fboH
    if (resized) {
      this.fboW = size
      this.fboH = size
      resizeTexture(gl, this.tMass, size, size, this.fmt)
      resizeTexture(gl, this.tK0, size, size, this.fmt)
      resizeTexture(gl, this.tK1, size, size, this.fmt)
      resizeTexture(gl, this.tS0, size, size, this.fmt)
      resizeTexture(gl, this.tS1, size, size, this.fmt)
      resizeTexture(gl, this.tFlow, size, size, this.fmt)
      this.filmReady = false
    }

    const needSplat = forceSplat || !this.filmReady || sim.dirty || !sim.sleeping
    if (needSplat) {
      const inner = GRID - 2 * PAD
      const pointSize = Math.max(7, (SPLAT_RADIUS / inner) * size * 2.45)

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboMain)
      gl.viewport(0, 0, size, size)
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3])
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.splatParticles(sim, pointSize, this.splat)

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboS1)
      gl.drawBuffers([gl.COLOR_ATTACHMENT0])
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.splatParticles(sim, pointSize, this.splatS1)

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboFlow)
      gl.drawBuffers([gl.COLOR_ATTACHMENT0])
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.splatParticles(sim, pointSize, this.splatFlow)

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
    this.bindTex(this.compose, 'u_flow', this.tFlow, 5)
    this.bindTex(this.compose, 'u_porcelain', this.porcelain, 6)
    gl.uniform3fv(gl.getUniformLocation(this.compose, 'u_rgbFromBand'), this.rgbFromBand)
    gl.uniform2f(gl.getUniformLocation(this.compose, 'u_texel'), 1 / size, 1 / size)
    gl.uniform1f(gl.getUniformLocation(this.compose, 'u_aspect'), canvasW / Math.max(canvasH, 1))
    if (tool) {
      gl.uniform2f(gl.getUniformLocation(this.compose, 'u_toolA'), tool.ax, tool.ay)
      gl.uniform2f(gl.getUniformLocation(this.compose, 'u_toolB'), tool.bx, tool.by)
      gl.uniform1f(gl.getUniformLocation(this.compose, 'u_toolW'), tool.width)
      gl.uniform1f(gl.getUniformLocation(this.compose, 'u_toolKind'), tool.kind === 'finger' ? 1 : 2)
    } else {
      gl.uniform1f(gl.getUniformLocation(this.compose, 'u_toolKind'), 0)
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  private splatParticles(sim: PaintSim, pointSize: number, program: WebGLProgram): void {
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
  }

  private pack(sim: PaintSim): void {
    const need = sim.count * STRIDE_FLOATS
    if (this.upload.length < need) this.upload = new Float32Array(Math.max(need, 1024))
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
      u[o + 22] = sim.vx[p]!
      u[o + 23] = sim.vy[p]!
    }
  }

  private bindTex(program: WebGLProgram, name: string, tex: WebGLTexture, unit: number): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(gl.getUniformLocation(program, name), unit)
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

export function pointerToSim(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
  const u = clamp01((clientX - rect.left) / Math.max(rect.width, 1))
  const v = clamp01(1 - (clientY - rect.top) / Math.max(rect.height, 1))
  return uvToSim(u, v)
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = fade(x - x0)
  const fy = fade(y - y0)
  const a = hash2(x0, y0)
  const b = hash2(x0 + 1, y0)
  const c = hash2(x0, y0 + 1)
  const d = hash2(x0 + 1, y0 + 1)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

function fbm(x: number, y: number): number {
  let s = 0
  let a = 0.5
  let f = 1
  for (let i = 0; i < 5; i++) {
    s += valueNoise(x * f, y * f) * a
    a *= 0.5
    f *= 2.05
  }
  return s
}

function makePorcelain(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const kiln = fbm(u * 3.2, v * 3.2)
      const glaze = fbm(u * 18.0 + 4.1, v * 18.0 + 1.7)
      const speck = hash2(x * 0.37, y * 0.41)
      const scratch =
        Math.pow(Math.abs(valueNoise(u * 90.0, v * 4.2) - 0.5) * 2, 8) * 0.035 +
        Math.pow(Math.abs(valueNoise(u * 5.5, v * 70.0) - 0.5) * 2, 10) * 0.028
      const dust = speck > 0.992 ? 0.03 : speck > 0.97 ? 0.01 : 0
      const bodyR = 0.905 + kiln * 0.03 + glaze * 0.018 - scratch - dust
      const bodyG = 0.868 + kiln * 0.026 + glaze * 0.014 - scratch * 0.9 - dust
      const bodyB = 0.804 + kiln * 0.02 + glaze * 0.01 - scratch * 0.75 - dust * 0.8
      const edge = Math.min(Math.min(u, v), Math.min(1 - u, 1 - v))
      const lip = fade(clamp01(edge / 0.045))
      const r = bodyR * (0.9 + 0.1 * lip)
      const g = bodyG * (0.9 + 0.1 * lip)
      const b = bodyB * (0.9 + 0.1 * lip)
      const rough = clamp01(0.22 + glaze * 0.35 + scratch * 4.0)
      const i = (y * size + x) * 4
      data[i] = Math.round(linearToByte(r))
      data[i + 1] = Math.round(linearToByte(g))
      data[i + 2] = Math.round(linearToByte(b))
      data[i + 3] = Math.round(rough * 255)
    }
  }
  return data
}

function linearToByte(c: number): number {
  const x = Math.min(1, Math.max(0, c))
  const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
  return s * 255
}
