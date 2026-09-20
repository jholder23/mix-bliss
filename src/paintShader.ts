import { Effect, ShaderMaterial, type Scene } from '@babylonjs/core'

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
uniform float trayR;
uniform float heightScale;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float Dggx(float nh, float a) {
  float a2 = max(a * a, 1e-4);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * d * d);
}

float Gsmith(float nv, float nl, float rough) {
  float r = rough + 1.0;
  float k = (r * r) / 8.0;
  float gV = nv / (nv * (1.0 - k) + k);
  float gL = nl / (nl * (1.0 - k) + k);
  return gV * gL;
}

vec3 Fschlick(float u, vec3 f0) {
  return f0 + (1.0 - f0) * pow(1.0 - clamp(u, 0.0, 1.0), 5.0);
}

vec3 studioEnv(vec3 dir) {
  vec3 d = normalize(dir);
  vec3 col = mix(vec3(0.16, 0.14, 0.12), vec3(0.46, 0.43, 0.39), smoothstep(-0.12, 0.42, d.y));
  col = mix(col, vec3(0.82, 0.79, 0.74), smoothstep(0.32, 0.95, d.y));
  float soft = pow(max(dot(d, normalize(vec3(-0.42, 0.68, 0.52))), 0.0), 10.0);
  col += vec3(1.08, 1.02, 0.94) * soft * 1.85;
  float win = pow(max(dot(d, normalize(windowDir)), 0.0), 28.0);
  col += vec3(0.72, 0.84, 1.05) * win * 1.05;
  col += vec3(0.32, 0.22, 0.14) * pow(max(-d.y, 0.0), 1.5) * 0.28;
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
  float bead = smoothstep(0.002, 0.038, h) * (1.0 - smoothstep(0.04, 0.14, h));
  return h + bead * 0.024;
}

float surfaceY(vec2 xz) {
  return bowlY(xz) + extraH(xz);
}

vec3 heightNormal(vec2 xz) {
  float e = 0.032;
  float hl = surfaceY(xz + vec2(-e, 0.0));
  float hr = surfaceY(xz + vec2(e, 0.0));
  float hb = surfaceY(xz + vec2(0.0, -e));
  float ht = surfaceY(xz + vec2(0.0, e));
  float e2 = 0.07;
  float hl2 = surfaceY(xz + vec2(-e2, 0.0));
  float hr2 = surfaceY(xz + vec2(e2, 0.0));
  float hb2 = surfaceY(xz + vec2(0.0, -e2));
  float ht2 = surfaceY(xz + vec2(0.0, e2));
  vec3 nFine = normalize(vec3(hl - hr, 2.0 * e, hb - ht));
  vec3 nBroad = normalize(vec3(hl2 - hr2, 2.0 * e2, hb2 - ht2));
  return normalize(mix(nBroad, nFine, 0.55));
}

float thicknessTo(vec3 p, vec3 dir) {
  float t = 0.008;
  float inside = 0.0;
  for (int i = 0; i < 12; i++) {
    vec3 q = p + dir * t;
    float h = extraH(q.xz);
    if (h > 0.004 && q.y < surfaceY(q.xz)) inside += 0.016;
    t += 0.012 + float(i) * 0.0035;
  }
  return inside;
}

float contactShadow(vec3 p, vec3 L) {
  float t = 0.012;
  float h0 = extraH(p.xz);
  for (int i = 0; i < 10; i++) {
    vec3 q = p + L * t;
    float h = extraH(q.xz);
    if (h > h0 + 0.01 && q.y < surfaceY(q.xz) + 0.004) {
      return mix(0.22, 1.0, clamp(t * 2.4, 0.0, 1.0));
    }
    t += 0.02 + float(i) * 0.008;
  }
  return 1.0;
}

vec3 marchReflect(vec3 p, vec3 r) {
  float t = 0.025;
  for (int i = 0; i < 14; i++) {
    vec3 q = p + r * t;
    vec2 uv = xzToUv(q.xz);
    float h = extraH(q.xz);
    if (h > 0.012 && q.y <= surfaceY(q.xz)) {
      vec3 alb = texture2D(paintMap, uv).rgb;
      vec3 n = heightNormal(q.xz);
      float wrap = clamp(dot(n, normalize(-keyDir)) * 0.5 + 0.5, 0.0, 1.0);
      return alb * (0.3 + wrap * 0.4);
    }
    if (q.y < bowlY(q.xz) - 0.01 && length(q.xz) < trayR * 1.05) {
      return vec3(0.82, 0.78, 0.7) * 0.22;
    }
    t += 0.03 + t * 0.11;
  }
  return studioEnv(r);
}

void main() {
  vec4 s = texture2D(paintMap, vUv);
  if (s.a < 0.02) discard;

  vec3 pigment = clamp(s.rgb, 0.0, 1.0);
  float luma = dot(pigment, vec3(0.299, 0.587, 0.114));

  float h = s.a * heightScale;
  vec3 N = heightNormal(vW.xz);
  vec3 V = normalize(vV);
  if (dot(N, V) < 0.0) N = -N;

  float thick = smoothstep(0.008, 0.2, h);
  float wet = mix(0.4, 1.0, gloss);
  float rough = clamp(mix(0.24, 0.03, gloss) - thick * 0.04, 0.022, 0.4);
  float coatRough = mix(0.08, 0.02, gloss);

  vec3 L = normalize(-keyDir);
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 0.0);
  float ndh = max(dot(N, H), 0.0);
  float hdv = max(dot(H, V), 0.0);

  vec3 f0 = vec3(0.04);
  vec3 Fs = Fschlick(hdv, f0);
  float D = Dggx(ndh, rough);
  float G = Gsmith(ndv, ndl, rough);
  vec3 spec = D * G * Fs / max(4.0 * ndv * ndl, 1e-4);

  float wrap = clamp(ndl * 0.38 + 0.64, 0.0, 1.15);
  float od = thicknessTo(vW + N * 0.006, L);
  vec3 sigma = mix(vec3(1.05, 2.2, 4.4), vec3(3.6, 6.4, 10.5), 1.0 - luma);
  vec3 sss = exp(-sigma * od * 2.4);
  vec3 diffuse = pigment * wrap * keyCol * (0.78 + 0.28 * thick);
  vec3 trans = pigment * sss * keyCol * (0.48 + 0.72 * thick);
  trans += pigment * vec3(1.2, 0.32, 0.1) * (1.0 - luma) * thick * 0.14 * wrap;

  vec3 right = cross(V, vec3(0.0, 1.0, 0.0));
  if (dot(right, right) < 1e-5) right = vec3(1.0, 0.0, 0.0);
  else right = normalize(right);
  vec3 Hstretch = normalize(H - right * dot(H, right) * 0.4);
  float ndhCoat = max(dot(N, Hstretch), 0.0);

  float coatF = Fschlick(ndv, vec3(0.05)).x * mix(0.5, 1.0, wet) * mix(0.55, 1.0, thick);
  float coatD = Dggx(ndhCoat, coatRough);
  float coatG = Gsmith(ndv, max(ndl, 0.08), coatRough);
  vec3 coat = vec3(coatD * coatG / max(4.0 * ndv * max(ndl, 0.08), 1e-4));
  coat *= Fschlick(hdv, vec3(0.05)) * vec3(1.06, 1.03, 0.99);

  vec3 specLit = spec * keyCol * (0.22 + 0.4 * gloss) * thick * (1.0 - coatF);
  specLit = min(specLit, vec3(2.2));
  vec3 coatLit = min(coat, vec3(6.0)) * keyCol * (0.12 + 0.38 * gloss) * mix(0.35, 1.0, ndl);
  coatLit = min(coatLit, vec3(2.8));

  vec3 col = diffuse * (1.0 - Fs) * (1.0 - coatF * 0.65);
  col += trans * (1.0 - coatF * 0.65) * 0.85;
  col += specLit;
  col += coatLit;

  float fillN = clamp(dot(N, normalize(-fillDir)) * 0.5 + 0.42, 0.0, 1.0);
  col += pigment * fillN * fillCol * 0.3 * (1.0 - coatF);
  float winLit = clamp(dot(N, normalize(windowDir)) * 0.45 + 0.12, 0.0, 1.0);
  col += pigment * winLit * vec3(0.55, 0.68, 0.92) * 0.2 * (1.0 - coatF);

  vec3 R = reflect(-V, N);
  vec3 refl = marchReflect(vW + N * 0.012, R);
  col += refl * Fschlick(ndv, f0) * mix(0.22, 0.84, gloss) * mix(0.45, 1.0, thick);

  float meniscus = smoothstep(0.006, 0.04, h) * (1.0 - smoothstep(0.045, 0.13, h));
  col += vec3(0.96, 0.94, 0.9) * coatF * meniscus * (0.1 + 0.26 * gloss);

  col *= mix(1.0, contactShadow(vW + N * 0.008, L), 0.55);
  float side = pow(clamp(1.0 - abs(N.y), 0.0, 1.0), 1.15);
  col += pigment * side * 0.14;
  col += studioEnv(N) * pigment * 0.09;
  col += floorCol * pigment * pow(max(-N.y, 0.0), 1.6) * 0.06;
  col = max(col, pigment * wrap * keyCol * 0.62);

  col += (hash(gl_FragCoord.xy) - 0.5) * 0.003;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`

let registered = false

export function createPaintMaterial(scene: Scene, _software = false): ShaderMaterial {
  if (!registered) {
    Effect.ShadersStore['impastoPaintVertexShader'] = VERT
    Effect.ShadersStore['impastoPaintFragmentShader'] = FRAG
    registered = true
  }
  const mat = new ShaderMaterial(
    'impastoPaint',
    scene,
    { vertex: 'impastoPaint', fragment: 'impastoPaint' },
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
        'trayR',
        'heightScale',
      ],
      samplers: ['paintMap'],
    },
  )
  mat.backFaceCulling = false
  mat.onError = (_effect, errors) => {
    const el = document.querySelector('#hint')
    if (el) {
      el.textContent = errors.slice(0, 220)
      el.classList.remove('gone')
    }
  }
  return mat
}
