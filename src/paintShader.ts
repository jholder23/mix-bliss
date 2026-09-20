import { Color3, Effect, ShaderMaterial, type Scene } from '@babylonjs/core'

const VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform vec3 cameraPosition;
varying vec3 vW;
varying vec3 vV;
varying vec2 vUv;

void main() {
  vec4 wp = world * vec4(position, 1.0);
  vW = wp.xyz;
  vUv = uv;
  vV = cameraPosition - wp.xyz;
  gl_Position = worldViewProjection * wp;
}
`

const FRAG = `
precision highp float;
varying vec3 vW;
varying vec3 vV;
varying vec2 vUv;
uniform sampler2D paintMap;
uniform vec3 keyDir;
uniform vec3 keyCol;
uniform vec3 fillDir;
uniform vec3 fillCol;
uniform vec3 windowDir;
uniform float gloss;
uniform vec3 floorCol;
uniform vec3 trayCol;
uniform float trayR;
uniform float heightScale;

const float PI = 3.14159265;
const float IOR = 1.49;
const float F0 = 0.0388;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float Dggx(float nh, float a) {
  float a2 = max(a * a, 1e-4);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

float Gsmith(float nv, float nl, float rough) {
  float r = rough + 1.0;
  float k = (r * r) / 8.0;
  float gV = nv / (nv * (1.0 - k) + k);
  float gL = nl / (nl * (1.0 - k) + k);
  return gV * gL;
}

vec3 Fschlick(float u, vec3 f0) {
  float m = 1.0 - clamp(u, 0.0, 1.0);
  float m2 = m * m;
  return f0 + (1.0 - f0) * (m2 * m2 * m);
}

vec3 studioEnv(vec3 dir) {
  vec3 d = normalize(dir);
  vec3 col = mix(vec3(0.14, 0.12, 0.10), vec3(0.42, 0.39, 0.35), smoothstep(-0.15, 0.38, d.y));
  col = mix(col, vec3(0.88, 0.85, 0.80), smoothstep(0.28, 0.96, d.y));
  float soft = pow(max(dot(d, normalize(vec3(-0.42, 0.72, 0.50))), 0.0), 8.5);
  col += vec3(1.14, 1.06, 0.96) * soft * 2.15;
  float win = pow(max(dot(d, normalize(windowDir)), 0.0), 22.0);
  col += vec3(0.68, 0.82, 1.08) * win * 1.35;
  col += vec3(0.38, 0.26, 0.16) * pow(max(-d.y, 0.0), 1.45) * 0.32;
  return col;
}

vec2 xzToUv(vec2 xz) {
  return vec2(xz.x / (trayR * 2.0) + 0.5, xz.y / (trayR * 2.0) + 0.5);
}

float bowlY(vec2 xz) {
  float r = length(xz) / max(trayR, 0.001);
  return 0.04 + r * r * 0.2;
}

float extraH(vec2 xz) {
  vec2 uv = xzToUv(xz);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  float h = texture2D(paintMap, uv).a * heightScale;
  float bead = smoothstep(0.0015, 0.032, h) * (1.0 - smoothstep(0.034, 0.12, h));
  return h + bead * 0.02;
}

float surfaceY(vec2 xz) {
  return bowlY(xz) + extraH(xz);
}

vec3 heightNormal(vec2 xz) {
  float e = 0.018;
  float hl = surfaceY(xz + vec2(-e, 0.0));
  float hr = surfaceY(xz + vec2(e, 0.0));
  float hb = surfaceY(xz + vec2(0.0, -e));
  float ht = surfaceY(xz + vec2(0.0, e));
  float e2 = 0.055;
  float hl2 = surfaceY(xz + vec2(-e2, 0.0));
  float hr2 = surfaceY(xz + vec2(e2, 0.0));
  float hb2 = surfaceY(xz + vec2(0.0, -e2));
  float ht2 = surfaceY(xz + vec2(0.0, e2));
  vec3 nFine = normalize(vec3(hl - hr, 2.0 * e, hb - ht));
  vec3 nBroad = normalize(vec3(hl2 - hr2, 2.0 * e2, hb2 - ht2));
  return normalize(mix(nBroad, nFine, 0.62));
}

#ifdef SOFTWARE_GL
#define THICK_STEPS 6
#define SHADOW_STEPS 5
#define REFL_STEPS 6
#else
#define THICK_STEPS 14
#define SHADOW_STEPS 12
#define REFL_STEPS 18
#endif

float thicknessTo(vec3 p, vec3 dir) {
  float t = 0.006;
  float inside = 0.0;
  for (int i = 0; i < THICK_STEPS; i++) {
    vec3 q = p + dir * t;
    float h = extraH(q.xz);
    if (h > 0.003 && q.y < surfaceY(q.xz)) inside += 0.014 + float(i) * 0.002;
    t += 0.01 + float(i) * 0.003;
  }
  return inside;
}

float contactShadow(vec3 p, vec3 L) {
  float t = 0.01;
  float h0 = extraH(p.xz);
  for (int i = 0; i < SHADOW_STEPS; i++) {
    vec3 q = p + L * t;
    float h = extraH(q.xz);
    if (h > h0 + 0.008 && q.y < surfaceY(q.xz) + 0.003) {
      return mix(0.18, 1.0, clamp(t * 2.1, 0.0, 1.0));
    }
    t += 0.016 + float(i) * 0.007;
  }
  return 1.0;
}

vec3 marchReflect(vec3 p, vec3 r) {
  float t = 0.02;
  for (int i = 0; i < REFL_STEPS; i++) {
    vec3 q = p + r * t;
    vec2 uv = xzToUv(q.xz);
    float h = extraH(q.xz);
    if (h > 0.01 && q.y <= surfaceY(q.xz)) {
      vec3 alb = texture2D(paintMap, uv).rgb;
      vec3 n = heightNormal(q.xz);
      float wrap = clamp(dot(n, normalize(-keyDir)) * 0.5 + 0.5, 0.0, 1.0);
      return alb * (0.28 + wrap * 0.48);
    }
    if (q.y < bowlY(q.xz) - 0.008 && length(q.xz) < trayR * 1.05) {
      return trayCol * 0.28;
    }
    t += 0.024 + t * 0.09;
  }
  return studioEnv(r);
}

void main() {
  vec4 s = texture2D(paintMap, vUv);
  if (s.a < 0.012) discard;

  vec3 pigment = clamp(s.rgb, 0.0, 1.0);
  float luma = dot(pigment, vec3(0.2126, 0.7152, 0.0722));
  float chroma = max(pigment.r, max(pigment.g, pigment.b)) - min(pigment.r, min(pigment.g, pigment.b));

  float h = s.a * heightScale;
  vec3 N = heightNormal(vW.xz);
  vec3 V = normalize(vV);
  if (dot(N, V) < 0.0) N = -N;

  float thick = smoothstep(0.006, 0.18, h);
  float wet = mix(0.42, 1.0, gloss);
  float stain = clamp((1.0 - luma) * 0.55 + chroma * 0.35, 0.0, 1.0);
  float optical = h * mix(12.0, 36.0, 1.0 - stain * 0.45);
  float cover = 1.0 - exp(-optical);
  vec3 film = mix(trayCol * pigment, pigment, clamp(cover + stain * 0.55, 0.0, 1.0));

  float rough = clamp(mix(0.22, 0.028, gloss) - thick * 0.035, 0.018, 0.38);
  float coatRough = mix(0.07, 0.016, gloss);

  vec3 L = normalize(-keyDir);
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 0.0);
  float ndh = max(dot(N, H), 0.0);
  float hdv = max(dot(H, V), 0.0);

  vec3 f0 = vec3(F0);
  vec3 Fs = Fschlick(hdv, f0);
  float D = Dggx(ndh, rough);
  float G = Gsmith(ndv, ndl, rough);
  vec3 spec = D * G * Fs / max(4.0 * ndv * ndl, 1e-4);

  float wrap = clamp(ndl * 0.34 + 0.68, 0.0, 1.18);
  float od = thicknessTo(vW + N * 0.005, L);
  vec3 sigma = mix(vec3(0.55, 0.95, 1.7), vec3(2.4, 4.8, 8.6), 1.0 - luma) * mix(1.6, 0.55, stain);
  sigma *= mix(pigment.gbr * 0.35 + 0.65, vec3(1.0), 0.4);
  vec3 sss = exp(-sigma * od * mix(1.4, 3.2, thick));
  vec3 diffuse = film * wrap * keyCol * (0.72 + 0.32 * thick);
  vec3 trans = film * sss * keyCol * mix(0.85, 0.38, thick);
  trans += film * vec3(1.15, 0.28, 0.08) * stain * (1.0 - cover) * 0.22 * wrap;

  float coatF = Fschlick(ndv, vec3(0.05)).x * mix(0.52, 1.0, wet) * mix(0.5, 1.0, thick);
  float coatD = Dggx(ndh, coatRough);
  float coatG = Gsmith(ndv, max(ndl, 0.08), coatRough);
  vec3 coat = vec3(coatD * coatG / max(4.0 * ndv * max(ndl, 0.08), 1e-4));
  coat *= Fschlick(hdv, vec3(0.05)) * vec3(1.05, 1.03, 1.0);

  vec3 specTint = mix(vec3(1.0), pigment, 0.07 * (1.0 - thick));
  vec3 specLit = spec * keyCol * specTint * (0.28 + 0.55 * gloss) * mix(0.55, 1.0, thick) * (1.0 - coatF);
  specLit = min(specLit, vec3(2.6));
  vec3 coatLit = min(coat, vec3(7.0)) * keyCol * (0.16 + 0.52 * gloss) * mix(0.4, 1.0, ndl);
  coatLit = min(coatLit, vec3(3.4));

  vec3 col = diffuse * (1.0 - Fs) * (1.0 - coatF * 0.72);
  col += trans * (1.0 - coatF * 0.6) * (1.0 - Fs);
  col += specLit;
  col += coatLit;

  float fillN = clamp(dot(N, normalize(-fillDir)) * 0.5 + 0.44, 0.0, 1.0);
  col += film * fillN * fillCol * 0.34 * (1.0 - coatF);
  float winLit = clamp(dot(N, normalize(windowDir)) * 0.48 + 0.14, 0.0, 1.0);
  col += film * winLit * vec3(0.58, 0.72, 0.98) * 0.24 * (1.0 - coatF);

  vec3 R = reflect(-V, N);
  vec3 refl = marchReflect(vW + N * 0.01, R);
  col += refl * Fschlick(ndv, f0) * mix(0.28, 0.92, gloss) * mix(0.5, 1.0, thick);

  float meniscus = smoothstep(0.004, 0.032, h) * (1.0 - smoothstep(0.04, 0.12, h));
  col += vec3(0.98, 0.96, 0.92) * coatF * meniscus * (0.12 + 0.32 * gloss);

  col *= mix(1.0, contactShadow(vW + N * 0.007, L), 0.58);
  float side = pow(clamp(1.0 - abs(N.y), 0.0, 1.0), 1.12);
  col += film * side * 0.16;
  col += studioEnv(N) * film * 0.11;
  col += floorCol * film * pow(max(-N.y, 0.0), 1.5) * 0.07;
  col = max(col, film * wrap * keyCol * 0.5);

  col += (hash(gl_FragCoord.xy) - 0.5) * 0.002;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`

let registered = false
let registeredSoft = false

export function createPaintMaterial(scene: Scene, software = false): ShaderMaterial {
  const vertName = software ? 'impastoPaintSoft' : 'impastoPaint'
  const fragName = software ? 'impastoPaintSoft' : 'impastoPaint'
  if (software && !registeredSoft) {
    Effect.ShadersStore[`${vertName}VertexShader`] = VERT
    Effect.ShadersStore[`${fragName}FragmentShader`] = '#define SOFTWARE_GL\n' + FRAG
    registeredSoft = true
  } else if (!software && !registered) {
    Effect.ShadersStore[`${vertName}VertexShader`] = VERT
    Effect.ShadersStore[`${fragName}FragmentShader`] = FRAG
    registered = true
  }
  const mat = new ShaderMaterial(
    software ? 'impastoPaintSoft' : 'impastoPaint',
    scene,
    { vertex: vertName, fragment: fragName },
    {
      attributes: ['position', 'normal', 'uv'],
      uniforms: [
        'world',
        'worldViewProjection',
        'view',
        'cameraPosition',
        'keyDir',
        'keyCol',
        'fillDir',
        'fillCol',
        'windowDir',
        'gloss',
        'floorCol',
        'trayCol',
        'trayR',
        'heightScale',
      ],
      samplers: ['paintMap'],
    },
  )
  mat.backFaceCulling = false
  mat.setColor3('trayCol', new Color3(0.92, 0.89, 0.83))
  mat.setColor3('floorCol', new Color3(0.55, 0.44, 0.32))
  mat.setFloat('gloss', 0.86)
  mat.setFloat('heightScale', 0.95)
  mat.onError = (_effect, errors) => {
    const el = document.querySelector('#hint')
    if (el) {
      el.textContent = errors.slice(0, 220)
      el.classList.remove('gone')
    }
  }
  return mat
}
