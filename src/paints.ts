import {
  type Pigment,
  mixPigmentsToSrgb,
  pigmentFromReflectanceMatching,
  pigmentFromSrgb,
  pigmentToSrgb,
} from './km'

export type Tube = {
  name: string
  hex: string
  pigment: Pigment
}

/**
 * Artist-tube masstone hex plus a spectral reflectance template.
 * Templates carry the mixing character (cadmium red absorbs green/blue,
 * hansa yellow reflects green-yellow, ultramarine keeps a cyan tail so
 * blue+yellow can go green). Scatter S is the KM two-constant scale:
 * cadmiums/white are more opaque; quinacridone/phthalo stain more.
 */
type TubeSpec = {
  name: string
  hex: string
  scatter: number
  /** Reflectance at 420, 460, 500, 540, 580, 620, 660, 700 nm. */
  reflectance: readonly number[]
}

const TUBE_SPECS: readonly TubeSpec[] = [
  {
    name: 'Cadmium Red',
    hex: '#d42a1e',
    scatter: 0.92,
    reflectance: [0.04, 0.035, 0.04, 0.055, 0.16, 0.72, 0.86, 0.88],
  },
  {
    name: 'Quinacridone Magenta',
    hex: '#c2185b',
    scatter: 0.42,
    reflectance: [0.16, 0.1, 0.05, 0.045, 0.12, 0.55, 0.72, 0.48],
  },
  {
    name: 'Naples Yellow',
    hex: '#e8c547',
    scatter: 0.95,
    reflectance: [0.1, 0.12, 0.28, 0.72, 0.9, 0.88, 0.84, 0.8],
  },
  {
    name: 'Hansa Yellow',
    hex: '#ffd84a',
    scatter: 0.86,
    reflectance: [0.04, 0.05, 0.22, 0.86, 0.97, 0.96, 0.93, 0.9],
  },
  {
    name: 'Ultramarine',
    hex: '#2a4bd7',
    scatter: 0.55,
    reflectance: [0.28, 0.78, 0.42, 0.1, 0.045, 0.04, 0.055, 0.08],
  },
  {
    name: 'Cerulean',
    hex: '#3d9ad1',
    scatter: 0.8,
    reflectance: [0.12, 0.48, 0.72, 0.38, 0.1, 0.06, 0.05, 0.045],
  },
  {
    name: 'Phthalo Green',
    hex: '#0b6e56',
    scatter: 0.34,
    reflectance: [0.04, 0.08, 0.28, 0.42, 0.18, 0.05, 0.03, 0.025],
  },
  {
    name: 'Burnt Sienna',
    hex: '#a3542d',
    scatter: 0.7,
    reflectance: [0.05, 0.05, 0.08, 0.16, 0.32, 0.52, 0.48, 0.4],
  },
  {
    name: 'Titanium White',
    hex: '#f3eee4',
    scatter: 1.35,
    reflectance: [0.9, 0.92, 0.94, 0.95, 0.95, 0.94, 0.93, 0.92],
  },
  {
    name: 'Mars Black',
    hex: '#1c1816',
    scatter: 0.48,
    reflectance: [0.04, 0.038, 0.036, 0.035, 0.038, 0.042, 0.048, 0.05],
  },
]

function makeTube(spec: TubeSpec): Tube {
  const target = hexToRgb(spec.hex)
  return {
    name: spec.name,
    hex: spec.hex,
    pigment: pigmentFromReflectanceMatching(spec.reflectance, spec.scatter, target),
  }
}

export const TUBES: Tube[] = TUBE_SPECS.map(makeTube)

export function tubeByName(name: string): Tube | undefined {
  return TUBES.find((t) => t.name === name)
}

export function customTube(hex: string): Tube {
  return {
    name: 'Custom',
    hex,
    pigment: pigmentFromSrgb(hexToRgb(hex)),
  }
}

export function masstoneSrgb(tube: Tube): [number, number, number] {
  return pigmentToSrgb(tube.pigment)
}

export function mixTubePaints(
  a: Tube,
  b: Tube,
  amountA: number,
  amountB: number,
): [number, number, number] {
  return mixPigmentsToSrgb([
    { pigment: a.pigment, amount: amountA },
    { pigment: b.pigment, amount: amountB },
  ])
}

export type SimFeel = {
  damping: number
  gravity: number
  cohesion: number
  mix: number
  iterations: number
  gloss: number
  rest: number
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function simFromViscosity(t: number): SimFeel {
  const x = Math.min(1, Math.max(0, t))
  return {
    damping: lerp(0.91, 0.994, x),
    gravity: lerp(1.7, 0.26, x),
    cohesion: lerp(0.14, 0.88, x),
    mix: lerp(0.28, 0.016, x),
    iterations: Math.round(lerp(4, 10, x)),
    gloss: lerp(0.4, 0.96, x),
    rest: lerp(0.8, 0.66, x),
  }
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
