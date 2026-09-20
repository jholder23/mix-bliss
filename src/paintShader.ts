import { Effect, ShaderMaterial, type Scene } from '@babylonjs/core'

const VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUV;

void main() {
  vec4 wp = world * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(world) * normal);
  vUV = uv;
  gl_Position = viewProjection * wp;
}
`

const FRAG = `
precision highp float;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUV;
uniform sampler2D paintMap;
uniform vec3 cameraPosition;
uniform vec3 keyDir;
uniform vec3 keyCol;
uniform vec3 fillDir;
uniform vec3 fillCol;
uniform vec3 windowDir;
uniform vec3 floorCol;
uniform float gloss;

float Dggx(float nh, float a) {
  float a2 = max(a * a, 0.002);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (3.14159265 * d * d);
}

void main() {
  vec4 paint = texture2D(paintMap, vUV);
  if (paint.a < 0.02) discard;

  vec3 albedo = pow(paint.rgb, vec3(1.0));
  float cover = smoothstep(0.02, 0.12, paint.a);
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  vec3 L = normalize(-keyDir);
  float wrap = clamp(dot(N, L) * 0.4 + 0.68, 0.0, 1.15);
  vec3 sss = albedo * albedo * (1.0 - max(dot(N, L), 0.0)) * 0.38;
  vec3 H = normalize(L + V);
  float spec = Dggx(max(dot(N, H), 0.0), mix(0.4, 0.05, gloss));
  vec3 col = albedo * wrap * keyCol + sss;
  col += spec * keyCol * (0.25 + 0.9 * gloss) * cover;
  col += albedo * fillCol * clamp(dot(N, normalize(-fillDir)) * 0.5 + 0.3, 0.0, 1.0) * 0.32;
  vec3 R = reflect(-V, N);
  float window = pow(max(dot(normalize(R), normalize(windowDir)), 0.0), 42.0);
  col += vec3(1.0, 0.99, 0.96) * window * gloss * 0.45 * cover;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += vec3(0.95, 0.93, 0.88) * fres * 0.16 * gloss;
  col += floorCol * albedo * pow(max(-N.y, 0.0), 1.3) * 0.12;
  col = mix(albedo * 0.92, col, 0.72);
  col = col / (col + vec3(0.85));
  gl_FragColor = vec4(col, 1.0);
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
        'worldView',
        'worldViewProjection',
        'view',
        'projection',
        'viewProjection',
        'cameraPosition',
        'keyDir',
        'keyCol',
        'fillDir',
        'fillCol',
        'windowDir',
        'floorCol',
        'gloss',
        'trayR',
        'heightScale',
      ],
      samplers: ['paintMap'],
      needAlphaTesting: true,
    },
  )
  mat.backFaceCulling = false
  mat.separateCullingPass = false
  return mat
}
