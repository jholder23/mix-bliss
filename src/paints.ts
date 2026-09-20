export type Tube = {
  name: string
  hex: string
}

export const TUBES: Tube[] = [
  { name: 'Cadmium Red', hex: '#d42a1e' },
  { name: 'Quinacridone Magenta', hex: '#c2185b' },
  { name: 'Naples Yellow', hex: '#e8c547' },
  { name: 'Hansa Yellow', hex: '#ffd84a' },
  { name: 'Ultramarine', hex: '#2a4bd7' },
  { name: 'Cerulean', hex: '#3d9ad1' },
  { name: 'Phthalo Green', hex: '#0b6e56' },
  { name: 'Burnt Sienna', hex: '#a3542d' },
  { name: 'Titanium White', hex: '#f3eee4' },
  { name: 'Mars Black', hex: '#1c1816' },
]

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
    damping: lerp(0.9, 0.992, x),
    gravity: lerp(2.4, 0.42, x),
    cohesion: lerp(0.06, 0.62, x),
    mix: lerp(0.28, 0.018, x),
    iterations: Math.round(lerp(3, 9, x)),
    gloss: lerp(0.38, 0.94, x),
    rest: lerp(0.86, 0.72, x),
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
