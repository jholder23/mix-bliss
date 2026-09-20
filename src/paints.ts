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
  vorticity: number
  splatForce: number
  velocityRadius: number
  dyeRadius: number
  gloss: number
  pressureIters: number
}

const WATER: PaintFeel = {
  viscosity: 0.08,
  viscosityIters: 1,
  velocityDissipation: 0.985,
  dyeDissipation: 0.992,
  vorticity: 18,
  splatForce: 1.15,
  velocityRadius: 0.0016,
  dyeRadius: 0.0034,
  gloss: 0.35,
  pressureIters: 14,
}

const HONEY: PaintFeel = {
  viscosity: 0.72,
  viscosityIters: 6,
  velocityDissipation: 0.94,
  dyeDissipation: 0.999,
  vorticity: 3.2,
  splatForce: 1.85,
  velocityRadius: 0.0038,
  dyeRadius: 0.0075,
  gloss: 0.82,
  pressureIters: 18,
}

const TAR: PaintFeel = {
  viscosity: 0.94,
  viscosityIters: 12,
  velocityDissipation: 0.82,
  dyeDissipation: 1,
  vorticity: 0.15,
  splatForce: 2.4,
  velocityRadius: 0.0065,
  dyeRadius: 0.012,
  gloss: 0.55,
  pressureIters: 12,
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
