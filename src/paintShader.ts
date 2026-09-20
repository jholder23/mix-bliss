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
  vec3 col = mix(vec3(0.1, 0.09, 0.08), vec3(0.4, 0.38, 0.35), smoothstep(-0.1, 0.45, d.y));
  col = mix(col, vec3(0.88, 0.86, 0.82), smoothstep(0.38, 0.96, d.y));
  float soft = pow(max(dot(d, normalize(vec3(-0.35, 0.72, 0.48))), 0.0), 18.0);
  col += vec3(1.12, 1.08, 1.0) * soft * 2.4;
  float win = pow(max(dot(d, normalize(windowDir)), 0.0), 40.0);
  col += vec3(0.95, 0.97, 1.0) * win * 1.2;
  col += vec3(0.28, 0.18, 0.1) * pow(max(-d.y, 0.0), 1.5) * 0.32;
  return col;
}

vec2 xzToUv(vec2 xz) {
  return vec2(xz.x / (trayR * 2.0) + 0.5, xz.z / (trayR * 2.0) + 0.5);
}

float bowlY(vec2 xz) {
  float r = length(xz) / max(trayR, 0.001);
  return 0.04 + r * r * 0.2;
}

float extraH(vec2 xz) {
  vec2 uv = xzToUv(xz);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return texture2D(paintMap, uv).a * heightScale;
}

float surfaceY(vec2 xz) {
  return bowlY(xz) + extraH(xz);
}

vec3 heightNormal(vec2 xz) {
  float e = 0.02;
  float hl = surfaceY(xz + vec2(-e, 0.0));
  float hr = surfaceY(xz + vec2(e, 0.0));
  float hb = surfaceY(xz + vec2(0.0, -e));
  float ht = surfaceY(xz + vec2(0.0, e));
  return normalize(vec3(hl - hr, 2.0 * e, hb - ht));
}

float thicknessTo(vec3 p, vec3 dir) {
  float t = 0.008;
  float inside = 0.0;
  for (int i = 0; i < 10; i++) {
    vec3 q = p + dir * t;
    float h = extraH(q.xz);
    if (h > 0.004 && q.y < surfaceY(q.xz)) inside += 0.014;
    t += 0.014 + float(i) * 0.004;
  }
  return inside;
}

float contactShadow(vec3 p, vec3 L) {
  float t = 0.012;
  float h0 = extraH(p.xz);
  for (int i = 0; i < 10; i++) {
    vec3 q = p + L * t;
    float h = extraH(q.xz);
    if (h > h0 + 0.012 && q.y < surfaceY(q.xz) + 0.004) {
      return mix(0.32, 1.0, clamp(t * 2.2, 0.0, 1.0));
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
  if (s.a < 0.03) discard;

  vec3 pigment = clamp(s.rgb, 0.0, 1.0);
  float h = s.a * heightScale;
  vec3 N = heightNormal(vW.xz);
  vec3 V = normalize(vV);
  if (dot(N, V) < 0.0) N = -N;

  float thick = smoothstep(0.01, 0.2, h);
  float luma = dot(pigment, vec3(0.299, 0.587, 0.114));
  float rough = mix(0.32, 0.04, gloss);
  rough = clamp(rough - thick * 0.05, 0.03, 0.5);
  vec3 f0 = vec3(0.05);

  vec3 L = normalize(-keyDir);
  vec3 H = normalize(L + V);
  float ndl = clamp(dot(N, L), 0.0, 1.0);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float ndh = clamp(dot(N, H), 0.0, 1.0);
  float wrap = clamp(ndl * 0.3 + 0.76, 0.0, 1.25);
  vec3 Fs = Fschlick(clamp(dot(H, V), 0.0, 1.0), f0);
  float D = Dggx(ndh, rough);
  float G = Gsmith(ndv, ndl, rough);
  vec3 spec = D * G * Fs / max(4.0 * ndv * ndl, 1e-4);

  vec3 col = pigment * wrap * keyCol;
  col += spec * keyCol * (0.85 + 1.5 * gloss) * thick;

  float fill = clamp(dot(N, normalize(-fillDir)) * 0.5 + 0.4, 0.0, 1.0);
  col += pigment * fill * fillCol * 0.38;

  float od = thicknessTo(vW + N * 0.006, L);
  vec3 sigma = mix(vec3(1.5, 3.2, 5.8), vec3(5.2, 8.5, 13.0), 1.0 - luma);
  sigma *= vec3(0.62, 1.0, 1.32);
  vec3 trans = exp(-sigma * od * 3.2) * pigment;
  col += trans * pow(wrap, 1.2) * (0.5 + 0.65 * thick);
  col += pigment * vec3(1.1, 0.45, 0.18) * (1.0 - luma) * thick * 0.1;

  vec3 R = reflect(-V, N);
  vec3 refl = marchReflect(vW + N * 0.01, R);
  col += refl * Fschlick(ndv, f0) * mix(0.2, 0.82, gloss) * mix(0.4, 1.0, thick);

  float coat = Dggx(clamp(dot(N, normalize(L + V)), 0.0, 1.0), 0.03);
  coat *= Fschlick(ndv, vec3(0.08)).x;
  col += coat * vec3(1.16, 1.12, 1.06) * (0.5 + 1.6 * gloss) * thick;

  col *= mix(1.0, contactShadow(vW + N * 0.008, L), 0.45);
  float side = pow(clamp(1.0 - abs(N.y), 0.0, 1.0), 1.2);
  col = max(col, pigment * mix(0.74, 0.94, luma));
  col += pigment * side * 0.28;
  col += studioEnv(N) * pigment * 0.08;
  col += floorCol * pigment * pow(max(-N.y, 0.0), 1.4) * 0.1;

  col = col / (col + vec3(1.0));
  col = pow(max(col, 0.0), vec3(0.96));
  col += (hash(gl_FragCoord.xy) - 0.5) * 0.01;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
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
  mat.backFaceCulling = true
  mat.onError = (_effect, errors) => {
    const el = document.querySelector('#hint')
    if (el) {
      el.textContent = errors.slice(0, 280)
      el.classList.remove('gone')
    }
    const fail = document.querySelector('#fail')
    if (fail instanceof HTMLElement) {
      fail.hidden = false
      fail.replaceChildren()
      const p = document.createElement('p')
      p.textContent = errors
      fail.append(p)
    }
  }
  return mat
}
