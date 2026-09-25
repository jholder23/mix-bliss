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
 * Templates carry mixing character, not an RGB lerp:
 *   cadmium absorbs green/blue so 1:1 with hansa is orange, not pink
 *   ultramarine keeps a cyan tail so blue+yellow goes olive-green
 *   cerulean is a green-blue, so the same yellow mixes a brighter green
 *   quin + phthalo complements masstone near-black (undertone stays magenta)
 * Scatter S is KM two-constant opacity: cadmiums/white cover; quin/phthalo stain.
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
    reflectance: [0.04, 0.035, 0.045, 0.08, 0.28, 0.78, 0.88, 0.9],
  },
  {
    name: 'Quinacridone Magenta',
    hex: '#c2185b',
    scatter: 0.4,
    // Strong green-yellow absorption so a 1:1 with phthalo goes near-black
    // (Javaherian: quinacridone + phthalo green masstone, undertone stays magenta).
    reflectance: [0.14, 0.08, 0.03, 0.025, 0.06, 0.58, 0.76, 0.42],
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
    scatter: 0.52,
    reflectance: [0.34, 0.82, 0.28, 0.06, 0.035, 0.04, 0.07, 0.12],
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
    scatter: 0.3,
    // Transparent stainer: high K in yellow-red, so complements neutralize
    // instead of making additive yellow. Yellow leak kept low for a dark masstone.
    reflectance: [0.03, 0.055, 0.26, 0.44, 0.08, 0.025, 0.016, 0.014],
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

/** Oil-paint feel for the MLS-MPM tray. Slider is never water. */
export type PaintFeel = {
  /** Implicit kinematic viscosity on the grid (Batty–Bridson Jacobi). */
  viscosity: number
  /** Tait/EOS stiffness. Low = holds a bead; high = spreads. */
  stiffness: number
  /** Surface contraction so glops stay rounded. */
  cohesion: number
  /** Per-step lerp of particle K/S toward the mass-weighted cell mix. */
  mixRate: number
  restDensity: number
  sleepSpeed: number
  jacobi: number
  damping: number
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function feelFromSlider(t: number): PaintFeel {
  const x = Math.min(1, Math.max(0, t))
  const x2 = x * x
  return {
    viscosity: lerp(28, 420, x2 * 0.55 + x * 0.45),
    stiffness: lerp(22, 7.5, x),
    cohesion: lerp(1.8, 5.4, x),
    mixRate: lerp(0.012, 0.00035, x),
    restDensity: lerp(4.6, 5.8, x),
    sleepSpeed: lerp(0.55, 0.22, x),
    jacobi: Math.round(lerp(8, 16, x)),
    damping: lerp(0.965, 0.912, x),
  }
}

export function viscosityName(t: number): string {
  if (t < 0.28) return 'Soft oil'
  if (t < 0.55) return 'Heavy oil'
  if (t < 0.8) return 'Impasto'
  return 'Tar'
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = Number.parseInt(h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
