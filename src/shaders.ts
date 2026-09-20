export const vert = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

export const splatAdd = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTarget;
uniform vec3 uColor;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uAspect;

void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  float r = max(uRadius, 1e-5);
  float splat = exp(-dot(p, p) / (r * r * 0.28));
  vec4 base = texture(uTarget, vUv);
  fragColor = vec4(base.rgb + uColor * splat, base.a);
}
`

export const splatRadial = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec2 uDelta;
uniform float uRadius;
uniform float uAspect;
uniform float uPush;
uniform float uDrag;

void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  float d = length(p);
  float r = max(uRadius, 1e-5);
  float inner = exp(-d * d / (r * r * 0.22));
  vec2 dir = d > 1e-5 ? p / d : vec2(0.0);
  vec2 add = dir * inner * uPush + uDelta * inner * uDrag;
  vec4 base = texture(uTarget, vUv);
  fragColor = vec4(base.xy + add, 0.0, 1.0);
}
`

export const splatPaint = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTarget;
uniform vec3 uColor;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uAspect;
uniform float uStrength;

vec3 kmMix(vec3 a, float wa, vec3 b, float wb) {
  vec3 aa = -log(max(a, vec3(0.045)));
  vec3 ab = -log(max(b, vec3(0.045)));
  float w = max(wa + wb, 1e-5);
  return clamp(exp(-(aa * wa + ab * wb) / w), 0.0, 1.0);
}

void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  float r = max(uRadius, 1e-5);
  float t = clamp(1.0 - length(p) / r, 0.0, 1.0);
  float dome = pow(t, 1.55);
  float add = dome * uStrength;
  vec4 base = texture(uTarget, vUv);
  float newA = min(base.a + add, 3.2);
  vec3 mixed = kmMix(base.rgb, max(base.a, 0.001), uColor, add);
  if (base.a < 0.002) mixed = uColor;
  fragColor = vec4(mixed, newA);
}
`

export const displaceHeight = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uAspect;
uniform float uDepth;

void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  float d = length(p);
  float r = max(uRadius, 1e-5);
  float groove = exp(-d * d / (r * r * 0.28));
  float rim = exp(-pow(d - r * 0.78, 2.0) / (r * r * 0.055));
  vec4 base = texture(uTarget, vUv);
  float h = base.a;
  h = max(0.0, h - groove * uDepth);
  h = min(3.2, h + rim * uDepth * 1.05);
  fragColor = vec4(base.rgb, h);
}
`

export const advection = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform float uDt;
uniform float uDissipation;
uniform float uAlphaDissipation;

void main() {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy;
  vec4 result = texture(uSource, coord);
  fragColor = vec4(result.rgb * uDissipation, result.a * uAlphaDissipation);
}
`

export const divergence = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;

void main() {
  float L = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
  float R = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
  float B = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;
  float T = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;
  float div = 0.5 * (R - L + T - B);
  fragColor = vec4(div, 0.0, 0.0, 1.0);
}
`

export const clearShader = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec4 uValue;
void main() {
  fragColor = uValue;
}
`

export const pressure = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexelSize;

void main() {
  float L = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
  float D = texture(uDivergence, vUv).x;
  fragColor = vec4((L + R + B + T - D) * 0.25, 0.0, 0.0, 1.0);
}
`

export const gradientSubtract = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;

void main() {
  float L = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
  vec2 vel = texture(uVelocity, vUv).xy;
  vel -= vec2(R - L, T - B);
  fragColor = vec4(vel, 0.0, 1.0);
}
`

export const curl = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;

void main() {
  float L = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).y;
  float R = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).y;
  float B = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y)).x;
  float T = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y)).x;
  float vorticity = R - L - T + B;
  fragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`

export const vorticity = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 uTexelSize;
uniform float uCurlAmount;
uniform float uDt;

void main() {
  float L = texture(uCurl, vUv - vec2(uTexelSize.x, 0.0)).x;
  float R = texture(uCurl, vUv + vec2(uTexelSize.x, 0.0)).x;
  float B = texture(uCurl, vUv - vec2(0.0, uTexelSize.y)).x;
  float T = texture(uCurl, vUv + vec2(0.0, uTexelSize.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  float len = length(force) + 1e-5;
  force = force / len * uCurlAmount * C;
  force.y *= -1.0;
  vec2 vel = texture(uVelocity, vUv).xy;
  fragColor = vec4(vel + force * uDt, 0.0, 1.0);
}
`

export const viscosity = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
uniform float uAmount;

void main() {
  vec4 c = texture(uVelocity, vUv);
  vec4 L = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0));
  vec4 R = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0));
  vec4 B = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y));
  vec4 T = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y));
  fragColor = mix(c, (L + R + B + T) * 0.25, clamp(uAmount, 0.0, 1.0));
}
`

export const levelHeight = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uDye;
uniform vec2 uTexelSize;
uniform float uAmount;

void main() {
  vec4 c = texture(uDye, vUv);
  float L = texture(uDye, vUv - vec2(uTexelSize.x, 0.0)).a;
  float R = texture(uDye, vUv + vec2(uTexelSize.x, 0.0)).a;
  float B = texture(uDye, vUv - vec2(0.0, uTexelSize.y)).a;
  float T = texture(uDye, vUv + vec2(0.0, uTexelSize.y)).a;
  float avg = (L + R + B + T) * 0.25;
  c.a = mix(c.a, avg, clamp(uAmount, 0.0, 1.0));
  fragColor = c;
}
`

export const slopeForce = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform sampler2D uDye;
uniform vec2 uTexelSize;
uniform float uSlope;

void main() {
  float L = texture(uDye, vUv - vec2(uTexelSize.x, 0.0)).a;
  float R = texture(uDye, vUv + vec2(uTexelSize.x, 0.0)).a;
  float B = texture(uDye, vUv - vec2(0.0, uTexelSize.y)).a;
  float T = texture(uDye, vUv + vec2(0.0, uTexelSize.y)).a;
  vec2 vel = texture(uVelocity, vUv).xy;
  vel -= vec2(R - L, T - B) * uSlope;
  fragColor = vec4(vel, 0.0, 1.0);
}
`

export const display = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uDye;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
uniform vec2 uLight;
uniform float uGloss;
uniform float uTime;
uniform float uAspect;
uniform vec4 uFinger0;
uniform vec4 uFinger1;
uniform vec4 uFinger2;
uniform vec3 uFingerTint;

const float PI = 3.14159265;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.07 + 13.1;
    a *= 0.52;
  }
  return v;
}

float heightAt(vec2 uv) {
  return texture(uDye, uv).a;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float D_GGX(float NdotH, float rough) {
  float a = max(rough * rough, 0.0025);
  float a2 = a * a;
  float d = (NdotH * NdotH * (a2 - 1.0) + 1.0);
  return a2 / (PI * d * d);
}

float G_Smith(float NdotV, float NdotL, float rough) {
  float r = rough + 1.0;
  float k = (r * r) / 8.0;
  float gV = NdotV / (NdotV * (1.0 - k) + k);
  float gL = NdotL / (NdotL * (1.0 - k) + k);
  return gV * gL;
}

vec3 F_Schlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
}

vec3 studioEnv(vec3 dir) {
  vec3 d = normalize(dir);
  vec3 col = mix(vec3(0.16, 0.11, 0.08), vec3(0.42, 0.38, 0.34), smoothstep(-0.2, 0.35, d.z));
  col = mix(col, vec3(0.92, 0.89, 0.84), smoothstep(0.45, 1.0, d.z));
  float softbox = pow(max(dot(d, normalize(vec3(-0.28, 0.62, 0.72))), 0.0), 18.0);
  col += vec3(1.35, 1.24, 1.08) * softbox * 4.2;
  float window = pow(max(dot(d, normalize(vec3(0.55, 0.15, 0.55))), 0.0), 42.0);
  col += vec3(0.75, 0.88, 1.15) * window * 2.4;
  float ground = pow(max(-d.z, 0.0), 2.0);
  col += vec3(0.28, 0.18, 0.1) * ground * 0.35;
  return col;
}

vec3 shadeFinger(vec3 n, vec3 v, vec3 l, vec3 wetTint, float wet) {
  vec3 skin = vec3(0.86, 0.62, 0.48);
  vec3 H = normalize(l + v);
  float wrap = clamp(dot(n, l) * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = skin * (0.22 + 0.85 * wrap);
  col += vec3(0.55, 0.16, 0.08) * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 1.8) * 0.45;
  col += pow(clamp(dot(n, H), 0.0, 1.0), 64.0) * vec3(1.0, 0.94, 0.88) * mix(0.18, 0.85, wet);
  float nail = smoothstep(0.22, 0.72, n.z) * smoothstep(0.15, -0.05, n.y);
  col = mix(col, vec3(0.93, 0.82, 0.78), nail * 0.55);
  col += nail * pow(clamp(dot(n, H), 0.0, 1.0), 120.0) * 0.35;
  col = mix(col, mix(col * 0.7, wetTint, 0.8), wet * 0.9);
  return col;
}

float fingerHit(vec4 finger, vec2 uv, out vec3 n, out float wet) {
  if (finger.w < 0.5) {
    n = vec3(0.0);
    wet = 0.0;
    return 0.0;
  }
  vec2 center = finger.xy;
  float radius = finger.z * 1.45;
  vec2 p = uv - center;
  p.x *= uAspect;
  float d = length(p);
  if (d > radius) {
    n = vec3(0.0);
    wet = 0.0;
    return 0.0;
  }
  float z = sqrt(max(radius * radius - d * d, 0.0));
  n = normalize(vec3(p.x, p.y, z));
  wet = smoothstep(radius * 0.45, 0.0, z);
  return 1.0;
}

void main() {
  vec4 dye = texture(uDye, vUv);
  float h = dye.a;
  vec2 px = uTexelSize;

  float tl = heightAt(vUv + vec2(-px.x, px.y));
  float t  = heightAt(vUv + vec2(0.0, px.y));
  float tr = heightAt(vUv + vec2(px.x, px.y));
  float l  = heightAt(vUv + vec2(-px.x, 0.0));
  float r  = heightAt(vUv + vec2(px.x, 0.0));
  float bl = heightAt(vUv + vec2(-px.x, -px.y));
  float b  = heightAt(vUv + vec2(0.0, -px.y));
  float br = heightAt(vUv + vec2(px.x, -px.y));

  float dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float dy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
  float relief = 11.5 + h * 5.5;
  vec3 N = normalize(vec3(-dx * relief, -dy * relief, 0.82));

  float grain = (fbm(vUv * vec2(uAspect, 1.0) * 90.0 + 8.0) - 0.5);
  float peel = (fbm(vUv * vec2(uAspect, 1.0) * 220.0) - 0.5);
  N = normalize(N + vec3(grain * 0.42, peel * 0.38, 0.0) * smoothstep(0.04, 0.4, h));

  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 key = normalize(vec3(-0.32 + sin(uTime * 0.17) * 0.05, 0.58, 0.74));
  vec3 fill = normalize(vec3(0.62, -0.12, 0.55));
  vec3 fingerL = normalize(vec3(uLight - vUv, 0.62));

  float cover = smoothstep(0.0, 0.045, h);
  float thick = smoothstep(0.08, 1.35, h);
  float cavity = clamp(1.0 - ((l + r + b + t) * 0.25 - h) * 4.4, 0.28, 1.0);

  vec3 pigment = mix(dye.rgb, pow(max(dye.rgb, vec3(0.0)), vec3(1.28)), 0.4);
  pigment *= mix(1.0, 0.78, thick * 0.35);

  float rough = mix(0.32, 0.045, uGloss);
  rough = mix(rough, 0.16, peel * 0.5 + 0.5);
  rough = mix(0.48, rough, cover);
  rough = clamp(rough - thick * 0.06, 0.03, 0.62);

  vec3 F0 = mix(vec3(0.04), mix(vec3(0.06), pigment * 0.18, 0.25), cover);

  vec3 color = vec3(0.0);

  vec3 lights[3];
  lights[0] = key;
  lights[1] = fill;
  lights[2] = fingerL;
  float intens[3];
  intens[0] = 2.05;
  intens[1] = 0.28;
  intens[2] = 0.72;

  for (int i = 0; i < 3; i++) {
    vec3 L = lights[i];
    vec3 H = normalize(L + V);
    float NdotL = clamp(dot(N, L), 0.0, 1.0);
    float NdotV = clamp(dot(N, V), 0.0, 1.0);
    float NdotH = clamp(dot(N, H), 0.0, 1.0);
    float HdotV = clamp(dot(H, V), 0.0, 1.0);
    vec3 F = F_Schlick(HdotV, F0);
    float D = D_GGX(NdotH, rough);
    float G = G_Smith(NdotV, NdotL, rough);
    vec3 spec = D * G * F / max(4.0 * NdotV * NdotL, 1e-4);
    vec3 diff = (1.0 - F) * pigment / PI;
    vec3 lightCol = (i == 1) ? vec3(0.85, 0.78, 0.7) : vec3(1.05, 0.98, 0.9);
    if (i == 2) lightCol = vec3(1.1, 1.04, 0.95);
    color += (diff + spec * (0.9 + 1.8 * uGloss)) * NdotL * lightCol * intens[i];
  }

  vec3 R = reflect(-V, N);
  vec3 env = studioEnv(R);
  float NdotV = clamp(dot(N, V), 0.0, 1.0);
  vec3 Fr = F_Schlick(NdotV, F0);
  color += env * Fr * mix(0.22, 1.15, uGloss) * mix(0.12, 1.0, cover);

  float coatRough = 0.028;
  vec3 Hc = normalize(key + V);
  float coat = D_GGX(clamp(dot(N, Hc), 0.0, 1.0), coatRough);
  coat *= F_Schlick(NdotV, vec3(0.1)).x;
  color += coat * vec3(1.35, 1.26, 1.12) * (0.4 + 1.6 * uGloss) * thick;

  vec2 flow = texture(uVelocity, vUv).xy;
  float flowLen = length(flow);
  if (flowLen > 1e-4) {
    vec2 tdir = flow / flowLen;
    float aniso = pow(abs(dot(N.xy, tdir)), 2.0);
    color += aniso * flowLen * 2.2 * vec3(1.0, 0.97, 0.92) * thick * uGloss * 0.18;
  }

  color *= cavity;
  color += pigment * vec3(1.0, 0.25, 0.08) * pow(1.0 - NdotV, 2.4) * 0.12 * thick;

  float nPaper = 0.92 + 0.06 * fbm(vUv * vec2(uAspect, 1.0) * 38.0);
  float weave = 0.97 + 0.03 * sin(gl_FragCoord.x * 0.47) * sin(gl_FragCoord.y * 0.47);
  vec3 ceramic = vec3(0.90, 0.86, 0.78) * nPaper * weave;
  ceramic *= 0.55 + 0.45 * clamp(dot(vec3(0.0, 0.0, 1.0), key), 0.0, 1.0);
  float rimAO = smoothstep(0.28, 0.0, h) * smoothstep(0.0, 0.1, h);
  ceramic *= 1.0 - rimAO * 0.28;
  ceramic *= 1.0 - (1.0 - cavity) * 0.25 * cover;

  vec3 painted = mix(ceramic, color, cover);
  painted += env * 0.04 * (1.0 - cover);

  vec3 fn = vec3(0.0);
  float wet = 0.0;
  float hit = fingerHit(uFinger0, vUv, fn, wet);
  if (hit < 0.5) hit = fingerHit(uFinger1, vUv, fn, wet);
  if (hit < 0.5) hit = fingerHit(uFinger2, vUv, fn, wet);

  if (hit > 0.5) {
    vec3 fcol = shadeFinger(fn, V, key, mix(uFingerTint, dye.rgb, cover * 0.6), wet);
    float edge = pow(clamp(fn.z, 0.0, 1.0), 0.35);
    painted = mix(painted * 0.18, fcol, edge);
    painted += pow(clamp(fn.z, 0.0, 1.0), 16.0) * vec3(1.0, 0.95, 0.9) * 0.28;
  } else {
    float shadow = 0.0;
    if (uFinger0.w > 0.5) {
      shadow += smoothstep(uFinger0.z * 2.2, uFinger0.z * 0.65, length(vec2((vUv.x - uFinger0.x) * uAspect, vUv.y - uFinger0.y))) * 0.32;
    }
    if (uFinger1.w > 0.5) {
      shadow += smoothstep(uFinger1.z * 2.2, uFinger1.z * 0.65, length(vec2((vUv.x - uFinger1.x) * uAspect, vUv.y - uFinger1.y))) * 0.32;
    }
    if (uFinger2.w > 0.5) {
      shadow += smoothstep(uFinger2.z * 2.2, uFinger2.z * 0.65, length(vec2((vUv.x - uFinger2.x) * uAspect, vUv.y - uFinger2.y))) * 0.32;
    }
    painted *= 1.0 - clamp(shadow, 0.0, 0.45);
  }

  vec2 q = vUv - 0.5;
  painted *= 1.0 - dot(q, q) * 0.22;
  painted *= 0.96 + 0.04 * hash(gl_FragCoord.xy);

  painted = aces(painted * 1.32);
  painted = pow(painted, vec3(0.96));
  fragColor = vec4(painted, 1.0);
}
`
