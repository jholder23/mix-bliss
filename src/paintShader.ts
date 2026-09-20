import { Effect, ShaderMaterial, type Scene } from '@babylonjs/core'

const VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 color;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
varying vec3 vV;

void main() {
  mat4 world = mat4(world0, world1, world2, world3);
  vec4 wp = world * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(world) * normal);
  vC = color.rgb;
  vV = cameraPosition - wp.xyz;
  gl_Position = viewProjection * wp;
}
`

const FRAG = `
precision highp float;
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
varying vec3 vV;
uniform vec3 keyDir;
uniform vec3 keyCol;
uniform vec3 fillDir;
uniform vec3 fillCol;
uniform vec3 rimDir;
uniform vec3 windowDir;
uniform float gloss;
uniform vec3 floorCol;

float Dggx(float nh, float a) {
  float a2 = a * a;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * d * d);
}

vec3 Fschlick(float u, vec3 f0) {
  return f0 + (1.0 - f0) * pow(1.0 - clamp(u, 0.0, 1.0), 5.0);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  vec3 albedo = clamp(vC, 0.0, 1.0);
  float rough = mix(0.45, 0.045, gloss);
  vec3 f0 = vec3(0.06);

  vec3 L = normalize(-keyDir);
  vec3 H = normalize(L + V);
  float wrap = clamp(dot(N, L) * 0.42 + 0.62, 0.0, 1.15);
  float ndv = max(dot(N, V), 0.0);
  float spec = Dggx(max(dot(N, H), 0.0), rough) * 0.18;
  vec3 Fs = Fschlick(max(dot(H, V), 0.0), f0);
  vec3 sss = albedo * albedo * (1.0 - max(dot(N, L), 0.0)) * 0.42;
  vec3 col = albedo * wrap * keyCol + sss * 0.85;
  col += spec * Fs * keyCol * (0.4 + 1.6 * gloss);

  float fill = clamp(dot(N, normalize(-fillDir)) * 0.5 + 0.35, 0.0, 1.0);
  col += albedo * fill * fillCol * 0.35;

  float rim = pow(1.0 - ndv, 2.6);
  col += albedo * rim * 0.12;
  col += vec3(0.95, 0.93, 0.88) * rim * gloss * 0.18;

  vec3 R = reflect(-V, N);
  float window = pow(max(dot(normalize(R), normalize(windowDir)), 0.0), 48.0);
  col += vec3(1.0, 0.99, 0.96) * window * (0.22 + 0.55 * gloss);

  float bounce = pow(max(-N.y, 0.0), 1.4);
  col += floorCol * albedo * bounce * 0.16;

  float coat = pow(max(dot(N, normalize(L + V)), 0.0), mix(40.0, 220.0, gloss));
  col += vec3(1.15, 1.1, 1.02) * coat * gloss * 0.28;

  col = col / (col + vec3(1.0));
  col = pow(max(col, 0.0), vec3(0.96));
  gl_FragColor = vec4(col, 1.0);
}
`

let registered = false

export function createPaintMaterial(scene: Scene): ShaderMaterial {
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
      attributes: ['position', 'normal', 'world0', 'world1', 'world2', 'world3', 'color'],
      uniforms: [
        'world',
        'view',
        'projection',
        'viewProjection',
        'cameraPosition',
        'keyDir',
        'keyCol',
        'fillDir',
        'fillCol',
        'rimDir',
        'windowDir',
        'gloss',
        'floorCol',
      ],
      defines: ['#define INSTANCES'],
    },
  )
  mat.backFaceCulling = true
  return mat
}
