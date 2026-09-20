export type Tube = {
  name: string
  hex: string
}

export const TUBES: Tube[] = [
  { name: 'Cadmium Red', hex: '#d42a1e' },
  { name: 'Quinacridone Magenta', hex: '#c2185b' },
  { name: 'Naples Yellow', hex: '#e8c547' },
  { name: 'Hansa Yellow', hex: '#f0d030' },
  { name: 'Ultramarine', hex: '#2a4bd7' },
  { name: 'Cerulean', hex: '#3d9ad1' },
  { name: 'Phthalo Green', hex: '#0b6e56' },
  { name: 'Burnt Sienna', hex: '#a3542d' },
  { name: 'Titanium White', hex: '#f3eee4' },
  { name: 'Mars Black', hex: '#1c1816' },
]

export type PaintFeel = {
  viscosity: number
  viscosityIters: number
  velocityDissipation: number
  dyeDissipation: number
  heightDissipation: number
  vorticity: number
  splatForce: number
  velocityRadius: number
  dyeRadius: number
  gloss: number
  pressureIters: number
  heightLevel: number
  slope: number
  fingerDepth: number
  fingerRadius: number
  fingerPush: number
}

const WATER: PaintFeel = {
  viscosity: 0.1,
  viscosityIters: 1,
  velocityDissipation: 0.988,
  dyeDissipation: 0.995,
  heightDissipation: 0.997,
  vorticity: 12,
  splatForce: 0.95,
  velocityRadius: 0.042,
  dyeRadius: 0.05,
  gloss: 0.42,
  pressureIters: 16,
  heightLevel: 0.16,
  slope: 0.09,
  fingerDepth: 0.28,
  fingerRadius: 0.046,
  fingerPush: 0.55,
}

const HONEY: PaintFeel = {
  viscosity: 0.78,
  viscosityIters: 7,
  velocityDissipation: 0.945,
  dyeDissipation: 1,
  heightDissipation: 1,
  vorticity: 2.1,
  splatForce: 1.55,
  velocityRadius: 0.058,
  dyeRadius: 0.072,
  gloss: 0.92,
  pressureIters: 20,
  heightLevel: 0.012,
  slope: 0.008,
  fingerDepth: 0.95,
  fingerRadius: 0.062,
  fingerPush: 1.45,
}

const TAR: PaintFeel = {
  viscosity: 0.96,
  viscosityIters: 14,
  velocityDissipation: 0.84,
  dyeDissipation: 1,
  heightDissipation: 1,
  vorticity: 0.08,
  splatForce: 2.05,
  velocityRadius: 0.078,
  dyeRadius: 0.1,
  gloss: 0.7,
  pressureIters: 14,
  heightLevel: 0.006,
  slope: 0.002,
  fingerDepth: 0.92,
  fingerRadius: 0.068,
  fingerPush: 1.7,
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpFeel(a: PaintFeel, b: PaintFeel, t: number): PaintFeel {
  return {
    viscosity: lerp(a.viscosity, b.viscosity, t),
    viscosityIters: Math.round(lerp(a.viscosityIters, b.viscosityIters, t)),
    velocityDissipation: lerp(a.velocityDissipation, b.velocityDissipation, t),
    dyeDissipation: lerp(a.dyeDissipation, b.dyeDissipation, t),
    vorticity: lerp(a.vorticity, b.vorticity, t),
    splatForce: lerp(a.splatForce, b.splatForce, t),
    velocityRadius: lerp(a.velocityRadius, b.velocityRadius, t),
    dyeRadius: lerp(a.dyeRadius, b.dyeRadius, t),
    gloss: lerp(a.gloss, b.gloss, t),
    pressureIters: Math.round(lerp(a.pressureIters, b.pressureIters, t)),
    heightDissipation: lerp(a.heightDissipation, b.heightDissipation, t),
    heightLevel: lerp(a.heightLevel, b.heightLevel, t),
    slope: lerp(a.slope, b.slope, t),
    fingerDepth: lerp(a.fingerDepth, b.fingerDepth, t),
    fingerRadius: lerp(a.fingerRadius, b.fingerRadius, t),
    fingerPush: lerp(a.fingerPush, b.fingerPush, t),
  }
}

export function feelFromViscosity(t: number): PaintFeel {
  const x = Math.min(1, Math.max(0, t))
  if (x < 0.58) return lerpFeel(WATER, HONEY, x / 0.58)
  return lerpFeel(HONEY, TAR, (x - 0.58) / 0.42)
}

export function viscosityName(t: number): string {
  if (t < 0.18) return 'Water'
  if (t < 0.4) return 'Ink'
  if (t < 0.58) return 'Cream'
  if (t < 0.82) return 'Honey'
  return 'Tar'
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = Number.parseInt(h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
