export type ImpastoDebug = {
  ready: boolean
  software: boolean
  getCamera: () => { alpha: number; beta: number; radius: number; settling: boolean }
  getTool: () => string
  getSelected: () => { name: string; hex: string }
  getParticleCount: () => number
  getPaintStats: () => {
    coverage: number
    filled: number
    meanRgb: [number, number, number]
    maxHeight: number
  }
  getDishScreen: () => { x: number; y: number }
  sampleFrame: () => Promise<{ mean: [number, number, number]; variance: number; px: number }>
  waitFrames: (n: number) => Promise<void>
  getFrameCount: () => number
  mix: (
    a: string,
    b: string,
    amountA?: number,
    amountB?: number,
  ) => { rgb: [number, number, number]; hue: number; chroma: number; lightness: number }
  masstone: (name: string) => [number, number, number]
  scrape: () => void
  glop: (name: string, x: number, z: number, size?: number) => void
  stir: (x: number, z: number, dx: number, dz: number, kind?: 'finger' | 'knife' | 'stick') => void
  step: (frames?: number) => void
  sample: (x: number, z: number) => { r: number; g: number; b: number; a: number }
  liveCount: () => number
  pause: () => void
  resume: () => void
  lookShot: (id: string) => void
  setToolName: (name: string) => void
  getOrbitButtons: () => number[]
  nudgeOrbit: (dx: number, dy: number) => void
}

declare global {
  interface Window {
    __impasto?: ImpastoDebug
  }
}

export {}
