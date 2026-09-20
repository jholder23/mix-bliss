/**
 * 2D MLS-MPM oil on a tray.
 *
 * Solver: Hu et al. SIGGRAPH 2018 MLS-MPM (quadratic B-splines, APIC C,
 * fused P2G stress) with nialltl’s Newtonian-fluid constitutive swap
 * (Tait EOS from gathered density; viscosity from the velocity gradient).
 * Extreme thickness uses Batty & Bridson 2008 implicit viscosity, but the
 * linear system is the cheap decoupled Jacobi form — not variational Stokes.
 *
 * Top-down tray: no in-plane gravity. Sleep freezes the field when the
 * knife is up and speeds fall below a threshold. Pigments ride on particles;
 * overlapping cells mix K/S by mass (km.ts), so folds marble before they homogenize.
 */

import { BANDS, writePigmentSlot, type Pigment } from './km'
import type { PaintFeel } from './paints'

export const GRID = 80
export const MAX_PARTICLES = 24576
export const PAD = 3.4
export const SPLAT_RADIUS = 1.15

const NODES = GRID + 1
const N = NODES * NODES
const SPACING = 0.46
const neighX = { x: 0, y: 0 }
const mixK = new Float32Array(BANDS)
const mixS = new Float32Array(BANDS)

export type KnifeStroke = {
  x: number
  y: number
  dx: number
  dy: number
  length: number
  width: number
  strength: number
}

export class PaintSim {
  readonly px = new Float32Array(MAX_PARTICLES)
  readonly py = new Float32Array(MAX_PARTICLES)
  readonly vx = new Float32Array(MAX_PARTICLES)
  readonly vy = new Float32Array(MAX_PARTICLES)
  readonly mass = new Float32Array(MAX_PARTICLES)
  readonly c00 = new Float32Array(MAX_PARTICLES)
  readonly c01 = new Float32Array(MAX_PARTICLES)
  readonly c10 = new Float32Array(MAX_PARTICLES)
  readonly c11 = new Float32Array(MAX_PARTICLES)
  readonly k = new Float32Array(MAX_PARTICLES * BANDS)
  readonly s = new Float32Array(MAX_PARTICLES * BANDS)
  readonly resid = new Float32Array(MAX_PARTICLES * 3)

  readonly gMass = new Float32Array(N)
  readonly gMx = new Float32Array(N)
  readonly gMy = new Float32Array(N)
  readonly gVx = new Float32Array(N)
  readonly gVy = new Float32Array(N)
  readonly gVxB = new Float32Array(N)
  readonly gVyB = new Float32Array(N)
  readonly gKx = new Float32Array(N)
  readonly gKy = new Float32Array(N)
  readonly gK = new Float32Array(N * BANDS)
  readonly gS = new Float32Array(N * BANDS)

  count = 0
  sleeping = true
  dirty = true
  feel: PaintFeel
  private settle = 0

  constructor(feel: PaintFeel) {
    this.feel = feel
  }

  setFeel(feel: PaintFeel): void {
    this.feel = feel
  }

  clear(): void {
    this.count = 0
    this.sleeping = true
    this.settle = 0
    this.dirty = true
  }

  get full(): boolean {
    return this.count >= MAX_PARTICLES - 64
  }

  glop(cx: number, cy: number, radius: number, pigment: Pigment): number {
    const r = Math.max(1.15, radius)
    const x0 = clamp(cx, PAD + r, GRID - PAD - r)
    const y0 = clamp(cy, PAD + r, GRID - PAD - r)
    const jitter = SPACING * 0.09
    let added = 0
    const rows = Math.ceil((2 * r) / (SPACING * 0.866)) + 1
    const cols = Math.ceil((2 * r) / SPACING) + 1
    for (let j = -rows; j <= rows; j++) {
      const y = j * SPACING * 0.8660254
      const odd = j & 1 ? SPACING * 0.5 : 0
      for (let i = -cols; i <= cols; i++) {
        if (this.count >= MAX_PARTICLES) break
        const x = i * SPACING + odd
        if (x * x + y * y > r * r) continue
        const px = x0 + x + (hash(this.count + i * 13 + j * 91) - 0.5) * jitter
        const py = y0 + y + (hash(this.count + i * 7 + j * 17 + 3) - 0.5) * jitter
        this.spawn(px, py, pigment)
        added++
      }
    }
    if (added > 0) {
      this.sleeping = false
      this.settle = 18
      this.dirty = true
    }
    return added
  }

  scrape(): void {
    this.clear()
  }

  step(dt: number, knife: KnifeStroke | null): void {
    const movingKnife = knife && knife.dx * knife.dx + knife.dy * knife.dy > 4e-6
    if (movingKnife) {
      this.sleeping = false
      this.settle = 22
    }
    if (this.sleeping && this.settle <= 0) return
    if (this.count === 0) {
      this.sleeping = true
      this.settle = 0
      return
    }

    const sub = movingKnife ? 3 : 2
    const h = Math.min(0.02, dt / sub)
    for (let s = 0; s < sub; s++) this.advance(h, movingKnife ? knife : null)

    this.homogenize()
    this.maybeSleep(movingKnife ? knife : null)
    this.dirty = true
  }

  private spawn(x: number, y: number, pigment: Pigment): void {
    const i = this.count++
    this.px[i] = clamp(x, PAD, GRID - PAD)
    this.py[i] = clamp(y, PAD, GRID - PAD)
    this.vx[i] = 0
    this.vy[i] = 0
    this.mass[i] = 1
    this.c00[i] = 0
    this.c01[i] = 0
    this.c10[i] = 0
    this.c11[i] = 0
    writePigmentSlot(this.k, this.s, this.resid, i, pigment)
  }

  private advance(dt: number, knife: KnifeStroke | null): void {
    const feel = this.feel
    this.gMass.fill(0)
    this.gMx.fill(0)
    this.gMy.fill(0)

    const count = this.count
    const wx = [0, 0, 0]
    const wy = [0, 0, 0]

    for (let p = 0; p < count; p++) {
      const x = this.px[p]!
      const y = this.py[p]!
      const bx = Math.floor(x - 0.5)
      const by = Math.floor(y - 0.5)
      const fx = x - bx
      const fy = y - by
      weights(fx, wx)
      weights(fy, wy)
      const m = this.mass[p]!
      for (let i = 0; i < 3; i++) {
        const gi = bx + i
        if (gi < 0 || gi >= NODES) continue
        const wix = wx[i]!
        for (let j = 0; j < 3; j++) {
          const gj = by + j
          if (gj < 0 || gj >= NODES) continue
          const w = wix * wy[j]!
          this.gMass[gi * NODES + gj]! += w * m
        }
      }
    }

    for (let p = 0; p < count; p++) {
      const x = this.px[p]!
      const y = this.py[p]!
      const bx = Math.floor(x - 0.5)
      const by = Math.floor(y - 0.5)
      const fx = x - bx
      const fy = y - by
      weights(fx, wx)
      weights(fy, wy)
      let density = 0
      for (let i = 0; i < 3; i++) {
        const gi = bx + i
        if (gi < 0 || gi >= NODES) continue
        const wix = wx[i]!
        for (let j = 0; j < 3; j++) {
          const gj = by + j
          if (gj < 0 || gj >= NODES) continue
          density += this.gMass[gi * NODES + gj]! * wix * wy[j]!
        }
      }
      density = Math.max(density, 0.12)
      const volume = 1 / density
      const ratio = density / feel.restDensity
      const pressure = clamp(feel.stiffness * (ratio * ratio * Math.sqrt(Math.max(ratio, 1e-4)) - 1), -feel.stiffness * 0.45, feel.stiffness * 2.2)

      const m = this.mass[p]!
      const c00 = this.c00[p]!
      const c01 = this.c01[p]!
      const c10 = this.c10[p]!
      const c11 = this.c11[p]!
      const mu = 0.35 + feel.viscosity * 0.002
      const s00 = -pressure + mu * 2 * c00
      const s01 = mu * (c01 + c10)
      const s10 = s01
      const s11 = -pressure + mu * 2 * c11
      const scale = -volume * 4 * dt
      const a00 = scale * s00 + m * c00
      const a01 = scale * s01 + m * c01
      const a10 = scale * s10 + m * c10
      const a11 = scale * s11 + m * c11
      const mvx = this.vx[p]! * m
      const mvy = this.vy[p]! * m

      for (let i = 0; i < 3; i++) {
        const gi = bx + i
        if (gi < 0 || gi >= NODES) continue
        const wix = wx[i]!
        const dposx = i - fx
        for (let j = 0; j < 3; j++) {
          const gj = by + j
          if (gj < 0 || gj >= NODES) continue
          const w = wix * wy[j]!
          const dposy = j - fy
          const idx = gi * NODES + gj
          this.gMx[idx]! += w * (mvx + a00 * dposx + a01 * dposy)
          this.gMy[idx]! += w * (mvy + a10 * dposx + a11 * dposy)
        }
      }
    }

    const massMin = 1e-5
    for (let i = 0; i < N; i++) {
      const mass = this.gMass[i]!
      if (mass > massMin) {
        this.gVx[i] = this.gMx[i]! / mass
        this.gVy[i] = this.gMy[i]! / mass
      } else {
        this.gVx[i] = 0
        this.gVy[i] = 0
      }
    }

    if (knife) this.applyKnife(knife)

    this.implicitViscosity(dt, feel.viscosity, feel.jacobi)
    this.surfaceTension(dt, feel.cohesion)
    this.gridBoundaries()

    const damp = Math.pow(feel.damping, dt * 60)
    const vMax = 12
    for (let p = 0; p < count; p++) {
      const x = this.px[p]!
      const y = this.py[p]!
      const bx = Math.floor(x - 0.5)
      const by = Math.floor(y - 0.5)
      const fx = x - bx
      const fy = y - by
      weights(fx, wx)
      weights(fy, wy)
      let vx = 0
      let vy = 0
      let c00 = 0
      let c01 = 0
      let c10 = 0
      let c11 = 0
      for (let i = 0; i < 3; i++) {
        const gi = bx + i
        if (gi < 0 || gi >= NODES) continue
        const wix = wx[i]!
        const dposx = i - fx
        for (let j = 0; j < 3; j++) {
          const gj = by + j
          if (gj < 0 || gj >= NODES) continue
          const w = wix * wy[j]!
          const idx = gi * NODES + gj
          const gvx = this.gVx[idx]!
          const gvy = this.gVy[idx]!
          const dposy = j - fy
          vx += w * gvx
          vy += w * gvy
          const wgvx = w * gvx * 4
          const wgvy = w * gvy * 4
          c00 += wgvx * dposx
          c01 += wgvx * dposy
          c10 += wgvy * dposx
          c11 += wgvy * dposy
        }
      }
      vx *= damp
      vy *= damp
      const sp2 = vx * vx + vy * vy
      if (sp2 > vMax * vMax) {
        const inv = vMax / Math.sqrt(sp2)
        vx *= inv
        vy *= inv
      }
      this.vx[p] = vx
      this.vy[p] = vy
      this.c00[p] = c00
      this.c01[p] = c01
      this.c10[p] = c10
      this.c11[p] = c11
      let nx = x + dt * vx
      let ny = y + dt * vy
      if (nx < PAD) {
        nx = PAD
        this.vx[p] = Math.max(0, vx)
      } else if (nx > GRID - PAD) {
        nx = GRID - PAD
        this.vx[p] = Math.min(0, vx)
      }
      if (ny < PAD) {
        ny = PAD
        this.vy[p] = Math.max(0, vy)
      } else if (ny > GRID - PAD) {
        ny = GRID - PAD
        this.vy[p] = Math.min(0, vy)
      }
      this.px[p] = nx
      this.py[p] = ny
    }
  }

  private applyKnife(knife: KnifeStroke): void {
    const speed = Math.hypot(knife.dx, knife.dy)
    if (speed < 1e-5) return
    const tx = knife.dx / speed
    const ty = knife.dy / speed
    const bx = -ty
    const by = tx
    const halfL = knife.length * 0.5
    const halfW = knife.width * 0.5
    const reach = halfW * 2.4
    const kvx = knife.dx * knife.strength
    const kvy = knife.dy * knife.strength

    for (let i = 1; i < NODES - 1; i++) {
      for (let j = 1; j < NODES - 1; j++) {
        const idx = i * NODES + j
        if (this.gMass[idx]! < 1e-5) continue
        const rx = i - knife.x
        const ry = j - knife.y
        const along = rx * bx + ry * by
        if (along < -halfL || along > halfL) continue
        const across = rx * tx + ry * ty
        const ad = Math.abs(across)
        if (ad > reach) continue
        const alongT = 1 - (Math.abs(along) / (halfL + 0.001)) ** 2
        const fall = smoothstep(reach, halfW * 0.45, ad) * alongT
        if (fall <= 0) continue
        const mix = Math.min(1, fall * 0.96)
        this.gVx[idx] = this.gVx[idx]! * (1 - mix) + kvx * mix
        this.gVy[idx] = this.gVy[idx]! * (1 - mix) + kvy * mix
        const plow = fall * speed * 0.55
        this.gVx[idx]! += tx * plow
        this.gVy[idx]! += ty * plow
        const ridge = Math.sign(along || 1) * fall * speed * 0.22 * (ad < halfW ? 1 : 0.4)
        this.gVx[idx]! += bx * ridge
        this.gVy[idx]! += by * ridge
      }
    }
  }

  private implicitViscosity(dt: number, nu: number, iters: number): void {
    const alpha = Math.max(0, nu * dt)
    if (alpha < 1e-6) return
    const massMin = 1e-5
    for (let it = 0; it < iters; it++) {
      const srcX = it % 2 === 0 ? this.gVx : this.gVxB
      const srcY = it % 2 === 0 ? this.gVy : this.gVyB
      const dstX = it % 2 === 0 ? this.gVxB : this.gVx
      const dstY = it % 2 === 0 ? this.gVyB : this.gVy
      for (let i = 0; i < NODES; i++) {
        for (let j = 0; j < NODES; j++) {
          const idx = i * NODES + j
          const mass = this.gMass[idx]!
          if (mass < massMin) {
            dstX[idx] = 0
            dstY[idx] = 0
            continue
          }
          const selfX = srcX[idx]!
          const selfY = srcY[idx]!
          let sx = 0
          let sy = 0
          sampleVisc(this.gMass, srcX, srcY, i - 1, j, selfX, selfY, massMin)
          sx += neighX.x
          sy += neighX.y
          sampleVisc(this.gMass, srcX, srcY, i + 1, j, selfX, selfY, massMin)
          sx += neighX.x
          sy += neighX.y
          sampleVisc(this.gMass, srcX, srcY, i, j - 1, selfX, selfY, massMin)
          sx += neighX.x
          sy += neighX.y
          sampleVisc(this.gMass, srcX, srcY, i, j + 1, selfX, selfY, massMin)
          sx += neighX.x
          sy += neighX.y
          const denom = 1 + alpha * 4
          dstX[idx] = (selfX + alpha * sx) / denom
          dstY[idx] = (selfY + alpha * sy) / denom
        }
      }
    }
    if (iters % 2 === 1) {
      this.gVx.set(this.gVxB)
      this.gVy.set(this.gVyB)
    }
  }

  private surfaceTension(dt: number, cohesion: number): void {
    const massMin = 0.18
    for (let i = 1; i < NODES - 1; i++) {
      for (let j = 1; j < NODES - 1; j++) {
        const idx = i * NODES + j
        const m = this.gMass[idx]!
        if (m < massMin) continue
        const gx = this.gMass[(i + 1) * NODES + j]! - this.gMass[(i - 1) * NODES + j]!
        const gy = this.gMass[i * NODES + j + 1]! - this.gMass[i * NODES + j - 1]!
        this.gKx[idx] = gx
        this.gKy[idx] = gy
      }
    }
    for (let i = 1; i < NODES - 1; i++) {
      for (let j = 1; j < NODES - 1; j++) {
        const idx = i * NODES + j
        const m = this.gMass[idx]!
        if (m < massMin) continue
        const gx = this.gKx[idx]!
        const gy = this.gKy[idx]!
        const g = Math.hypot(gx, gy)
        if (g < 0.22) continue
        const nx = gx / g
        const ny = gy / g
        const pull = cohesion * dt * smoothstep(0.22, 2.4, g)
        this.gVx[idx]! -= nx * pull
        this.gVy[idx]! -= ny * pull
      }
    }
  }

  private gridBoundaries(): void {
    const lo = 2
    const hi = NODES - 3
    for (let i = 0; i < NODES; i++) {
      for (let j = 0; j < NODES; j++) {
        const idx = i * NODES + j
        if (i <= lo) this.gVx[idx] = Math.max(0, this.gVx[idx]!)
        if (i >= hi) this.gVx[idx] = Math.min(0, this.gVx[idx]!)
        if (j <= lo) this.gVy[idx] = Math.max(0, this.gVy[idx]!)
        if (j >= hi) this.gVy[idx] = Math.min(0, this.gVy[idx]!)
        if (i < 1 || j < 1 || i > NODES - 2 || j > NODES - 2) {
          this.gVx[idx] = 0
          this.gVy[idx] = 0
        }
      }
    }
  }

  private homogenize(): void {
    const rate = this.feel.mixRate
    if (rate <= 0 || this.count === 0) return
    this.gMass.fill(0)
    this.gK.fill(0)
    this.gS.fill(0)
    const wx = [0, 0, 0]
    const wy = [0, 0, 0]
    const count = this.count

    for (let p = 0; p < count; p++) {
      const x = this.px[p]!
      const y = this.py[p]!
      const bx = Math.floor(x - 0.5)
      const by = Math.floor(y - 0.5)
      const fx = x - bx
      const fy = y - by
      weights(fx, wx)
      weights(fy, wy)
      const m = this.mass[p]!
      const ko = p * BANDS
      for (let i = 0; i < 3; i++) {
        const gi = bx + i
        if (gi < 0 || gi >= NODES) continue
        const wix = wx[i]!
        for (let j = 0; j < 3; j++) {
          const gj = by + j
          if (gj < 0 || gj >= NODES) continue
          const w = wix * wy[j]! * m
          const idx = gi * NODES + gj
          this.gMass[idx]! += w
          const go = idx * BANDS
          for (let b = 0; b < BANDS; b++) {
            this.gK[go + b]! += w * this.k[ko + b]!
            this.gS[go + b]! += w * this.s[ko + b]!
          }
        }
      }
    }

    for (let p = 0; p < count; p++) {
      const x = this.px[p]!
      const y = this.py[p]!
      const bx = Math.floor(x - 0.5)
      const by = Math.floor(y - 0.5)
      const fx = x - bx
      const fy = y - by
      weights(fx, wx)
      weights(fy, wy)
      mixK.fill(0)
      mixS.fill(0)
      let mm = 0
      for (let i = 0; i < 3; i++) {
        const gi = bx + i
        if (gi < 0 || gi >= NODES) continue
        const wix = wx[i]!
        for (let j = 0; j < 3; j++) {
          const gj = by + j
          if (gj < 0 || gj >= NODES) continue
          const w = wix * wy[j]!
          const idx = gi * NODES + gj
          mm += this.gMass[idx]! * w
          const go = idx * BANDS
          for (let b = 0; b < BANDS; b++) {
            mixK[b]! += this.gK[go + b]! * w
            mixS[b]! += this.gS[go + b]! * w
          }
        }
      }
      if (mm < 1e-6) continue
      const inv = 1 / mm
      const ko = p * BANDS
      for (let b = 0; b < BANDS; b++) {
        this.k[ko + b] = this.k[ko + b]! + (mixK[b]! * inv - this.k[ko + b]!) * rate
        this.s[ko + b] = this.s[ko + b]! + (mixS[b]! * inv - this.s[ko + b]!) * rate
      }
    }
  }

  private maybeSleep(knife: KnifeStroke | null): void {
    if (knife) return
    let vmax2 = 0
    const count = this.count
    for (let p = 0; p < count; p++) {
      const s2 = this.vx[p]! * this.vx[p]! + this.vy[p]! * this.vy[p]!
      if (s2 > vmax2) vmax2 = s2
    }
    const thresh = this.feel.sleepSpeed
    if (vmax2 < thresh * thresh) {
      if (this.settle > 0) this.settle--
      if (this.settle <= 0) {
        this.vx.fill(0)
        this.vy.fill(0)
        this.c00.fill(0)
        this.c01.fill(0)
        this.c10.fill(0)
        this.c11.fill(0)
        this.sleeping = true
      }
    } else {
      this.settle = Math.max(this.settle, 4)
    }
  }
}

function weights(fx: number, w: number[]): void {
  w[0] = 0.5 * (1.5 - fx) * (1.5 - fx)
  const d = fx - 1
  w[1] = 0.75 - d * d
  const e = fx - 0.5
  w[2] = 0.5 * e * e
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function sampleVisc(
  mass: Float32Array,
  vx: Float32Array,
  vy: Float32Array,
  i: number,
  j: number,
  selfX: number,
  selfY: number,
  massMin: number,
): void {
  if (i < 0 || j < 0 || i >= NODES || j >= NODES) {
    neighX.x = selfX
    neighX.y = selfY
    return
  }
  const idx = i * NODES + j
  if (mass[idx]! < massMin) {
    neighX.x = selfX
    neighX.y = selfY
    return
  }
  neighX.x = vx[idx]!
  neighX.y = vy[idx]!
}
