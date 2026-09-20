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
  float splat = exp(-dot(p, p) / max(uRadius, 1e-6));
  vec4 base = texture(uTarget, vUv);
  fragColor = vec4(base.rgb + uColor * splat, base.a);
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

void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  float splat = exp(-dot(p, p) / max(uRadius, 1e-6)) * uStrength;
  vec4 base = texture(uTarget, vUv);
  float newA = base.a + splat;
  vec3 mixed = (base.rgb * base.a + uColor * splat) / max(newA, 1e-5);
  fragColor = vec4(mixed, min(newA, 1.85));
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

void main() {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy;
  vec4 result = texture(uSource, coord);
  fragColor = vec4(result.rgb * uDissipation, result.a * mix(1.0, uDissipation, 0.25));
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

export const display = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uDye;
uniform vec2 uTexelSize;
uniform vec2 uLight;
uniform float uGloss;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec4 dye = texture(uDye, vUv);
  float h = dye.a;
  float hL = texture(uDye, vUv - vec2(uTexelSize.x, 0.0)).a;
  float hR = texture(uDye, vUv + vec2(uTexelSize.x, 0.0)).a;
  float hB = texture(uDye, vUv - vec2(0.0, uTexelSize.y)).a;
  float hT = texture(uDye, vUv + vec2(0.0, uTexelSize.y)).a;

  vec3 N = normalize(vec3((hL - hR) * 2.8, (hB - hT) * 2.8, 0.26));
  vec3 L = normalize(vec3(uLight - vUv, 0.9));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);

  float nDotL = clamp(dot(N, L), 0.0, 1.0);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), mix(22.0, 96.0, uGloss));
  float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);

  vec3 pigment = dye.rgb;
  pigment = mix(pigment, pigment * pigment * 1.05, 0.1);

  vec3 lit = pigment * (0.34 + 0.66 * nDotL);
  lit += spec * vec3(1.0, 0.975, 0.93) * (0.48 + 0.85 * uGloss) * smoothstep(0.03, 0.26, h);
  lit += fresnel * mix(pigment, vec3(1.0), 0.35) * 0.16;
  lit *= mix(1.0, 0.86, smoothstep(0.55, 1.5, h));

  float grain = 0.84 + 0.08 * hash(gl_FragCoord.xy * 0.65);
  float weave = 0.975 + 0.025 * sin(gl_FragCoord.x * 0.52) * sin(gl_FragCoord.y * 0.52);
  vec3 linen = vec3(0.925, 0.875, 0.78) * grain * weave;

  float cover = smoothstep(0.0, 0.14, h);
  vec3 color = mix(linen, lit, cover);

  vec2 q = vUv - 0.5;
  color *= 1.0 - dot(q, q) * 0.32;

  fragColor = vec4(color, 1.0);
}
`
