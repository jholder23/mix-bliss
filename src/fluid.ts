import {
  Color3,
  Constants,
  Mesh,
  MeshBuilder,
  RawTexture,
  Texture,
  Vector3,
  VertexBuffer,
  type Scene,
} from '@babylonjs/core'
import {
  BANDS,
  accumulatedKSToSrgb,
  mixKSSlots,
  writePigmentSlot,
  type Pigment,
} from './km'
import { createPaintMaterial } from './paintShader'
import type { SimFeel } from './paints'

export const TRAY_R = 2.28
export const HEIGHT_SCALE = 0.95

function trayHeight(x: number, y: number): number {
  const r = Math.hypot(x, y) / TRAY_R
  if (r > 1.12) return 0.42
  return 0.04 + r * r * 0.2
}

function hypot3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z)
}

/**
 * Viscous FLIP/APIC-inspired paint: particles carry spectral K/S and velocity,
 * a staggered-ish PIC grid solves viscosity, pairwise cohesion makes beads,
 * and a dense cubic-kernel heightfield is the meshed surface.
 */
export class PaintFluid {
  readonly mesh: Mesh
  private pos: Float32Array
  private vel: Float32Array
  private k: Float32Array
  private s: Float32Array
  private resid: Float32Array
  private rad: Float32Array
  private mass: Float32Array
  private live: Uint8Array
  private count = 0
  private cap: number
  private hashHead: Int32Array
  private hashNext: Int32Array
  private hashDim: number
  private cell: number
  private kernel: number
  private gRes: number
  private gMass: Float32Array
  private gVx: Float32Array
  private gVy: Float32Array
  private gVz: Float32Array
  private gVxB: Float32Array
  private gVyB: Float32Array
  private gVzB: Float32Array
  private heights: Float32Array
  private weight: Float32Array
  private kAcc: Float32Array
  private sAcc: Float32Array
  private residAcc: Float32Array
  private cWeight: Float32Array
  private cH: Float32Array
  private colR: Float32Array
  private colG: Float32Array
  private colB: Float32Array
  private rgba: Uint8Array
  private tmpH: Float32Array
  private tmpR: Float32Array
  private tmpG: Float32Array
  private tmpB: Float32Array
  private tmpW: Float32Array
  private blurH: Float32Array
  private blurR: Float32Array
  private blurG: Float32Array
  private blurB: Float32Array
  private blurW: Float32Array
  private base: Float32Array
  private verts: Float32Array
  private map: RawTexture
  private res: number
  private colorRes: number
  private dirty = false
  private sleeping = true
  feel: SimFeel
  software: boolean

  constructor(scene: Scene, feel: SimFeel, software: boolean) {
    this.feel = feel
    this.software = software
    this.cap = software ? 640 : 1800
    this.pos = new Float32Array(this.cap * 3)
    this.vel = new Float32Array(this.cap * 3)
    this.k = new Float32Array(this.cap * BANDS)
    this.s = new Float32Array(this.cap * BANDS)
    this.resid = new Float32Array(this.cap * 3)
    this.rad = new Float32Array(this.cap)
    this.mass = new Float32Array(this.cap)
    this.live = new Uint8Array(this.cap)
    this.hashNext = new Int32Array(this.cap)

    this.hashDim = software ? 48 : 72
    this.hashHead = new Int32Array(this.hashDim * this.hashDim)
    this.hashHead.fill(-1)
    this.cell = (TRAY_R * 2) / this.hashDim
    this.kernel = software ? 0.16 : 0.135

    this.gRes = software ? 48 : 80
    const gn = this.gRes * this.gRes
    this.gMass = new Float32Array(gn)
    this.gVx = new Float32Array(gn)
    this.gVy = new Float32Array(gn)
    this.gVz = new Float32Array(gn)
    this.gVxB = new Float32Array(gn)
    this.gVyB = new Float32Array(gn)
    this.gVzB = new Float32Array(gn)

    this.res = software ? 192 : 288
    this.colorRes = software ? 96 : 144
    const n = this.res * this.res
    const cn = this.colorRes * this.colorRes
    this.heights = new Float32Array(n)
    this.weight = new Float32Array(n)
    this.kAcc = new Float32Array(cn * BANDS)
    this.sAcc = new Float32Array(cn * BANDS)
    this.residAcc = new Float32Array(cn * 3)
    this.cWeight = new Float32Array(cn)
    this.cH = new Float32Array(cn)
    this.colR = new Float32Array(cn)
    this.colG = new Float32Array(cn)
    this.colB = new Float32Array(cn)
    this.rgba = new Uint8Array(n * 4)
    this.tmpH = new Float32Array(n)
    this.tmpR = new Float32Array(n)
    this.tmpG = new Float32Array(n)
    this.tmpB = new Float32Array(n)
    this.tmpW = new Float32Array(n)
    this.blurH = new Float32Array(n)
    this.blurR = new Float32Array(n)
    this.blurG = new Float32Array(n)
    this.blurB = new Float32Array(n)
    this.blurW = new Float32Array(n)

    const subdiv = software ? 96 : 168
    this.mesh = MeshBuilder.CreateGround(
      'paintSurf',
      { width: TRAY_R * 2, height: TRAY_R * 2, subdivisions: subdiv, updatable: true },
      scene,
    )
    const raw = this.mesh.getVerticesData(VertexBuffer.PositionKind)
    if (!raw) throw new Error('Paint surface has no vertices')
    this.base = new Float32Array(raw)
    this.verts = new Float32Array(raw)
    for (let i = 0; i < this.verts.length; i += 3) {
      const x = this.verts[i] ?? 0
      const z = this.verts[i + 2] ?? 0
      this.verts[i + 1] = trayHeight(x, z) - 0.0012
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.verts)
    this.mesh.isPickable = true
    this.mesh.alwaysSelectAsActiveMesh = true
    this.mesh.doNotSyncBoundingInfo = false

    this.map = new RawTexture(
      this.rgba,
      this.res,
      this.res,
      Constants.TEXTUREFORMAT_RGBA,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    )
    this.map.wrapU = Texture.CLAMP_ADDRESSMODE
    this.map.wrapV = Texture.CLAMP_ADDRESSMODE

    const mat = createPaintMaterial(scene, software)
    mat.setTexture('paintMap', this.map)
    mat.setFloat('trayR', TRAY_R)
    mat.setFloat('heightScale', HEIGHT_SCALE)
    this.mesh.material = mat
    this.mesh.isPickable = true
    this.mesh.refreshBoundingInfo()
  }

  setFeel(feel: SimFeel): void {
    this.feel = feel
    this.sleeping = false
    this.dirty = true
  }

  scrape(): void {
    this.live.fill(0)
    this.vel.fill(0)
    this.count = 0
    this.heights.fill(0)
    this.weight.fill(0)
    this.kAcc.fill(0)
    this.sAcc.fill(0)
    this.residAcc.fill(0)
    this.cWeight.fill(0)
    this.cH.fill(0)
    this.k.fill(0)
    this.s.fill(0)
    this.resid.fill(0)
    this.rgba.fill(0)
    this.map.update(this.rgba)
    this.sleeping = true
    this.dirty = true
    this.rebuildSurface()
    this.dirty = false
  }

  get particleCount(): number {
    return this.count
  }

  samplePaint(): { coverage: number; filled: number; meanRgb: [number, number, number]; maxHeight: number } {
    const rgba = this.rgba
    let filled = 0
    let r = 0
    let g = 0
    let b = 0
    let maxH = 0
    for (let i = 0; i < this.heights.length; i++) {
      const o = i * 4
      const a = rgba[o + 3] ?? 0
      if (a < 8) continue
      filled++
      r += rgba[o] ?? 0
      g += rgba[o + 1] ?? 0
      b += rgba[o + 2] ?? 0
      if (a > maxH) maxH = a
    }
    const inv = filled ? 1 / filled / 255 : 0
    return {
      coverage: filled / Math.max(1, this.heights.length),
      filled,
      meanRgb: filled ? [r * inv, g * inv, b * inv] : [0, 0, 0],
      maxHeight: maxH / 255,
    }
  }

  private spawnOne(x: number, y: number, z: number, pigment: Pigment, radius: number): void {
    if (this.count >= this.cap) return
    const slot = this.count++
    const i3 = slot * 3
    this.pos[i3] = x
    this.pos[i3 + 1] = y
    this.pos[i3 + 2] = z
    this.vel[i3] = 0
    this.vel[i3 + 1] = 0
    this.vel[i3 + 2] = 0
    writePigmentSlot(this.k, this.s, this.resid, slot, pigment)
    this.rad[slot] = radius
    this.mass[slot] = radius * radius * radius
    this.live[slot] = 1
  }

  glop(at: Vector3, pigment: Pigment, size: number): void {
    const n = Math.round((this.software ? 36 : 64) + size * (this.software ? 52 : 108))
    const moundR = 0.26 + size * 0.36
    const moundH = 0.2 + size * 0.34
    const pr = 0.05 + size * 0.028
    const gold = Math.PI * (3 - Math.sqrt(5))
    const jitter = pr * 0.18
    for (let i = 0; i < n; i++) {
      if (this.count >= this.cap) break
      const u = (i + 0.5) / n
      const yFrac = Math.pow(1 - u, 0.58)
      const rr = moundR * Math.sqrt(Math.max(0, 1 - yFrac * yFrac))
      const theta = i * gold
      const x = at.x + Math.cos(theta) * rr + (Math.random() - 0.5) * jitter
      const z = at.z + Math.sin(theta) * rr + (Math.random() - 0.5) * jitter
      const y = trayHeight(x, z) + yFrac * moundH + pr * 0.35
      this.spawnOne(x, y, z, pigment, pr * (0.94 + Math.random() * 0.08))
    }
    this.sleeping = false
    this.dirty = true
  }

  stir(at: Vector3, delta: Vector3, radius: number, kind: 'finger' | 'knife' | 'stick'): void {
    const r2 = radius * radius
    const visc = this.feel.viscosity
    const inv = 1 / (1 + visc * 0.48)
    const speed = Math.hypot(delta.x, delta.z) + 1e-6
    const tx = delta.x / speed
    const tz = delta.z / speed
    let force = 1
    let flatten = 0.2
    let swirl = 0
    let ridge = 0
    let blade = 1
    if (kind === 'knife') {
      force = 2.05 * inv
      flatten = 1.28
      ridge = 1.15
      blade = 0.28
    } else if (kind === 'stick') {
      force = 0.62 * inv
      flatten = 0.1
      swirl = 1.35 * inv
      blade = 1
    } else {
      force = 1.12 * inv
      flatten = 0.42
      blade = 0.85
    }
    const n = this.count
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const dx = this.pos[i3] - at.x
      const dy = this.pos[i3 + 1] - at.y
      const dz = this.pos[i3 + 2] - at.z
      const along = dx * tx + dz * tz
      const side = dx * tz - dz * tx
      const d2 = kind === 'knife' ? along * along + (side * side) / (blade * blade) + dy * dy * 0.35 : dx * dx + dy * dy * 0.45 + dz * dz
      if (d2 > r2) continue
      const w = 1 - d2 / r2
      const w2 = w * w
      this.vel[i3] += delta.x * force * w2
      this.vel[i3 + 2] += delta.z * force * w2
      this.vel[i3 + 1] -= flatten * w2 * (this.rad[i] ?? 0.08) * (0.55 + speed * 1.8)
      if (ridge > 0) {
        const sign = side === 0 ? 1 : Math.sign(side)
        this.vel[i3] += -tz * ridge * w2 * sign * speed
        this.vel[i3 + 2] += tx * ridge * w2 * sign * speed
      }
      if (swirl > 0) {
        this.vel[i3] += -dz * swirl * w2
        this.vel[i3 + 2] += dx * swirl * w2
      }
    }
    this.sleeping = false
    this.dirty = true
  }

  step(dt: number): void {
    if (this.count === 0) {
      if (this.dirty) {
        this.splat()
        this.rebuildSurface()
        this.dirty = false
      }
      return
    }
    const capped = Math.min(0.033, Math.max(0.001, dt))
    let vmax = 0.05
    const n = this.count
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const sp = hypot3(this.vel[i3], this.vel[i3 + 1], this.vel[i3 + 2])
      if (sp > vmax) vmax = sp
    }
    const cfl = 0.4 * this.kernel / vmax
    const maxSub = this.software ? 3 : 5
    const nsub = Math.max(1, Math.min(maxSub, Math.ceil(capped / cfl)))
    const sub = capped / nsub
    if (!this.sleeping) {
      for (let s = 0; s < nsub; s++) this.substep(sub)
      this.maybeSleep()
      this.dirty = true
    }
    if (this.dirty) {
      this.splat()
      this.rebuildSurface()
      if (this.sleeping) this.dirty = false
    }
  }

  private substep(dt: number): void {
    this.applyBodyForces(dt)
    this.rebuildHash()
    this.gridViscosity(dt)
    this.contactsAndTension(dt)
    this.integrate(dt)
    this.collide(dt)
    this.mixByStrain(dt)
  }

  private applyBodyForces(dt: number): void {
    const g = this.feel.gravity
    const slope = this.feel.slope
    const n = this.count
    const e = 0.05
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      this.vel[i3 + 1] -= g * dt
      const x = this.pos[i3]
      const z = this.pos[i3 + 2]
      const dHdx = (trayHeight(x + e, z) - trayHeight(x - e, z)) / (2 * e)
      const dHdz = (trayHeight(x, z + e) - trayHeight(x, z - e)) / (2 * e)
      this.vel[i3] -= g * dHdx * slope * dt
      this.vel[i3 + 2] -= g * dHdz * slope * dt
    }
  }

  private cellIndex(x: number, z: number): number {
    const dim = this.hashDim
    const cx = Math.min(dim - 1, Math.max(0, Math.floor((x + TRAY_R) / this.cell)))
    const cz = Math.min(dim - 1, Math.max(0, Math.floor((z + TRAY_R) / this.cell)))
    return cz * dim + cx
  }

  private rebuildHash(): void {
    this.hashHead.fill(-1)
    const n = this.count
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const ci = this.cellIndex(this.pos[i3], this.pos[i3 + 2])
      this.hashNext[i] = this.hashHead[ci] ?? -1
      this.hashHead[ci] = i
    }
  }

  private gridViscosity(dt: number): void {
    const res = this.gRes
    const ncell = res * res
    this.gMass.fill(0)
    this.gVx.fill(0)
    this.gVy.fill(0)
    this.gVz.fill(0)
    const worldTo = res / (TRAY_R * 2)
    const n = this.count
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const gx = (this.pos[i3] + TRAY_R) * worldTo
      const gz = (this.pos[i3 + 2] + TRAY_R) * worldTo
      const x0 = Math.floor(gx)
      const z0 = Math.floor(gz)
      const fx = gx - x0
      const fz = gz - z0
      const m = this.mass[i] ?? 0.001
      const vx = this.vel[i3]
      const vy = this.vel[i3 + 1]
      const vz = this.vel[i3 + 2]
      for (let oz = 0; oz <= 1; oz++) {
        const iz = z0 + oz
        if (iz < 0 || iz >= res) continue
        const wz = oz ? fz : 1 - fz
        for (let ox = 0; ox <= 1; ox++) {
          const ix = x0 + ox
          if (ix < 0 || ix >= res) continue
          const w = m * wz * (ox ? fx : 1 - fx)
          const idx = iz * res + ix
          this.gMass[idx] = (this.gMass[idx] ?? 0) + w
          this.gVx[idx] = (this.gVx[idx] ?? 0) + vx * w
          this.gVy[idx] = (this.gVy[idx] ?? 0) + vy * w
          this.gVz[idx] = (this.gVz[idx] ?? 0) + vz * w
        }
      }
    }
    for (let i = 0; i < ncell; i++) {
      const m = this.gMass[i] ?? 0
      if (m > 1e-8) {
        const inv = 1 / m
        this.gVx[i] = (this.gVx[i] ?? 0) * inv
        this.gVy[i] = (this.gVy[i] ?? 0) * inv
        this.gVz[i] = (this.gVz[i] ?? 0) * inv
      } else {
        this.gVx[i] = 0
        this.gVy[i] = 0
        this.gVz[i] = 0
      }
    }

    const nu = this.feel.viscosity
    const lam = Math.min(12, nu * dt * 18)
    const iters = this.software ? Math.min(4, this.feel.iterations) : this.feel.iterations
    for (let k = 0; k < iters; k++) {
      const srcX = k % 2 === 0 ? this.gVx : this.gVxB
      const srcY = k % 2 === 0 ? this.gVy : this.gVyB
      const srcZ = k % 2 === 0 ? this.gVz : this.gVzB
      const dstX = k % 2 === 0 ? this.gVxB : this.gVx
      const dstY = k % 2 === 0 ? this.gVyB : this.gVy
      const dstZ = k % 2 === 0 ? this.gVzB : this.gVz
      for (let z = 0; z < res; z++) {
        for (let x = 0; x < res; x++) {
          const i = z * res + x
          if ((this.gMass[i] ?? 0) <= 1e-8) {
            dstX[i] = 0
            dstY[i] = 0
            dstZ[i] = 0
            continue
          }
          let sx = 0
          let sy = 0
          let sz = 0
          let wsum = 0
          for (let oz = -1; oz <= 1; oz++) {
            const iz = z + oz
            if (iz < 0 || iz >= res) continue
            for (let ox = -1; ox <= 1; ox++) {
              if (!ox && !oz) continue
              const ix = x + ox
              if (ix < 0 || ix >= res) continue
              const j = iz * res + ix
              const wm = this.gMass[j] ?? 0
              if (wm <= 1e-8) continue
              const ww = wm * (ox && oz ? 0.707 : 1)
              sx += (srcX[j] ?? 0) * ww
              sy += (srcY[j] ?? 0) * ww
              sz += (srcZ[j] ?? 0) * ww
              wsum += ww
            }
          }
          const selfX = srcX[i] ?? 0
          const selfY = srcY[i] ?? 0
          const selfZ = srcZ[i] ?? 0
          if (wsum < 1e-8) {
            dstX[i] = selfX
            dstY[i] = selfY
            dstZ[i] = selfZ
          } else {
            const inv = 1 / (1 + lam)
            dstX[i] = (selfX + lam * (sx / wsum)) * inv
            dstY[i] = (selfY + lam * (sy / wsum)) * inv
            dstZ[i] = (selfZ + lam * (sz / wsum)) * inv
          }
        }
      }
    }
    const even = iters % 2 === 0
    const outX = even ? this.gVx : this.gVxB
    const outY = even ? this.gVy : this.gVyB
    const outZ = even ? this.gVz : this.gVzB
    if (!even) {
      this.gVx.set(outX)
      this.gVy.set(outY)
      this.gVz.set(outZ)
    }

    const pic = this.feel.picBlend
    const flip = 1 - pic
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const gx = (this.pos[i3] + TRAY_R) * worldTo
      const gz = (this.pos[i3 + 2] + TRAY_R) * worldTo
      const x0 = Math.floor(gx)
      const z0 = Math.floor(gz)
      const fx = gx - x0
      const fz = gz - z0
      let vx = 0
      let vy = 0
      let vz = 0
      let wsum = 0
      for (let oz = 0; oz <= 1; oz++) {
        const iz = z0 + oz
        if (iz < 0 || iz >= res) continue
        const wz = oz ? fz : 1 - fz
        for (let ox = 0; ox <= 1; ox++) {
          const ix = x0 + ox
          if (ix < 0 || ix >= res) continue
          const w = wz * (ox ? fx : 1 - fx)
          const idx = iz * res + ix
          if ((this.gMass[idx] ?? 0) <= 1e-8) continue
          vx += (this.gVx[idx] ?? 0) * w
          vy += (this.gVy[idx] ?? 0) * w
          vz += (this.gVz[idx] ?? 0) * w
          wsum += w
        }
      }
      if (wsum < 1e-6) continue
      const inv = 1 / wsum
      vx *= inv
      vy *= inv
      vz *= inv
      this.vel[i3] = vx * pic + this.vel[i3] * flip
      this.vel[i3 + 1] = vy * pic + this.vel[i3 + 1] * flip
      this.vel[i3 + 2] = vz * pic + this.vel[i3 + 2] * flip
    }
  }

  private contactsAndTension(dt: number): void {
    const feel = this.feel
    const n = this.count
    const dim = this.hashDim
    const h = this.kernel
    const h2 = h * h
    const pullK = feel.cohesion * dt * 2.4
    const sep = 0.42
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const px = this.pos[i3]
      const py = this.pos[i3 + 1]
      const pz = this.pos[i3 + 2]
      const ri = this.rad[i] ?? 0.06
      const cx = Math.min(dim - 1, Math.max(0, Math.floor((px + TRAY_R) / this.cell)))
      const cz = Math.min(dim - 1, Math.max(0, Math.floor((pz + TRAY_R) / this.cell)))
      for (let oz = -1; oz <= 1; oz++) {
        const iz = cz + oz
        if (iz < 0 || iz >= dim) continue
        for (let ox = -1; ox <= 1; ox++) {
          const ix = cx + ox
          if (ix < 0 || ix >= dim) continue
          let j = this.hashHead[iz * dim + ix] ?? -1
          while (j >= 0) {
            if (j > i && this.live[j]) {
              const j3 = j * 3
              const dx = this.pos[j3] - px
              const dy = this.pos[j3 + 1] - py
              const dz = this.pos[j3 + 2] - pz
              const d2 = dx * dx + dy * dy + dz * dz
              if (d2 < h2 && d2 > 1e-10) {
                const dist = Math.sqrt(d2)
                const invd = 1 / dist
                const nx = dx * invd
                const ny = dy * invd
                const nz = dz * invd
                const rj = this.rad[j] ?? 0.06
                const rest = (ri + rj) * feel.rest
                if (dist < rest) {
                  const push = (rest - dist) * 0.5 * sep
                  this.pos[i3] -= nx * push
                  this.pos[i3 + 1] -= ny * push * 0.55
                  this.pos[i3 + 2] -= nz * push
                  this.pos[j3] += nx * push
                  this.pos[j3 + 1] += ny * push * 0.55
                  this.pos[j3 + 2] += nz * push
                  const reln =
                    (this.vel[j3] - this.vel[i3]) * nx +
                    (this.vel[j3 + 1] - this.vel[i3 + 1]) * ny +
                    (this.vel[j3 + 2] - this.vel[i3 + 2]) * nz
                  if (reln < 0) {
                    const corr = reln * 0.5
                    this.vel[i3] += nx * corr
                    this.vel[i3 + 1] += ny * corr
                    this.vel[i3 + 2] += nz * corr
                    this.vel[j3] -= nx * corr
                    this.vel[j3 + 1] -= ny * corr
                    this.vel[j3 + 2] -= nz * corr
                  }
                } else {
                  const w = 1 - dist / h
                  const pull = pullK * w * w
                  this.vel[i3] += nx * pull
                  this.vel[i3 + 1] += ny * pull * 1.05
                  this.vel[i3 + 2] += nz * pull
                  this.vel[j3] -= nx * pull
                  this.vel[j3 + 1] -= ny * pull * 1.05
                  this.vel[j3 + 2] -= nz * pull
                }
              }
            }
            j = this.hashNext[j] ?? -1
          }
        }
      }
    }
  }

  private integrate(dt: number): void {
    const damp = Math.pow(this.feel.damping, dt * 60)
    const n = this.count
    const vmax = 2.8
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      this.vel[i3] *= damp
      this.vel[i3 + 1] *= damp
      this.vel[i3 + 2] *= damp
      const sp = hypot3(this.vel[i3], this.vel[i3 + 1], this.vel[i3 + 2])
      if (sp > vmax) {
        const s = vmax / sp
        this.vel[i3] *= s
        this.vel[i3 + 1] *= s
        this.vel[i3 + 2] *= s
      }
      this.pos[i3] += this.vel[i3] * dt
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt
    }
  }

  private collide(dt: number): void {
    const n = this.count
    const mu = this.feel.friction
    const stick = Math.exp(-mu * dt)
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const ri = this.rad[i] ?? 0.06
      let x = this.pos[i3]
      let y = this.pos[i3 + 1]
      let z = this.pos[i3 + 2]
      const floor = trayHeight(x, z) + ri * 0.52
      if (y < floor) {
        this.pos[i3 + 1] = floor
        if (this.vel[i3 + 1] < 0) this.vel[i3 + 1] = 0
        this.vel[i3] *= stick
        this.vel[i3 + 2] *= stick
        y = floor
      }
      const rr = Math.hypot(x, z)
      const lim = TRAY_R - ri * 0.85 - 0.04
      if (rr > lim) {
        const sc = lim / rr
        this.pos[i3] = x * sc
        this.pos[i3 + 2] = z * sc
        const nx = x / rr
        const nz = z / rr
        const vn = this.vel[i3] * nx + this.vel[i3 + 2] * nz
        if (vn > 0) {
          this.vel[i3] -= nx * vn
          this.vel[i3 + 2] -= nz * vn
        }
      }
    }
  }

  private mixByStrain(dt: number): void {
    const rate = this.feel.mix * dt * 3.4
    if (rate <= 1e-8) return
    const n = this.count
    const dim = this.hashDim
    const h = this.kernel * 1.05
    const h2 = h * h
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const px = this.pos[i3]
      const py = this.pos[i3 + 1]
      const pz = this.pos[i3 + 2]
      const mi = this.mass[i] ?? 0.001
      const cx = Math.min(dim - 1, Math.max(0, Math.floor((px + TRAY_R) / this.cell)))
      const cz = Math.min(dim - 1, Math.max(0, Math.floor((pz + TRAY_R) / this.cell)))
      for (let oz = -1; oz <= 1; oz++) {
        const iz = cz + oz
        if (iz < 0 || iz >= dim) continue
        for (let ox = -1; ox <= 1; ox++) {
          const ix = cx + ox
          if (ix < 0 || ix >= dim) continue
          let j = this.hashHead[iz * dim + ix] ?? -1
          while (j >= 0) {
            if (j > i && this.live[j]) {
              const j3 = j * 3
              const dx = this.pos[j3] - px
              const dy = this.pos[j3 + 1] - py
              const dz = this.pos[j3 + 2] - pz
              const d2 = dx * dx + dy * dy + dz * dz
              if (d2 < h2 && d2 > 1e-10) {
                const dist = Math.sqrt(d2)
                const dvx = this.vel[j3] - this.vel[i3]
                const dvy = this.vel[j3 + 1] - this.vel[i3 + 1]
                const dvz = this.vel[j3 + 2] - this.vel[i3 + 2]
                const strain = hypot3(dvx, dvy, dvz)
                const w = 1 - dist / h
                const t = rate * (0.04 + strain * 2.8) * w
                if (t > 1e-6) {
                  const mj = this.mass[j] ?? 0.001
                  mixKSSlots(this.k, this.s, this.resid, i, j, mi, mj, Math.min(0.45, t))
                }
              }
            }
            j = this.hashNext[j] ?? -1
          }
        }
      }
    }
  }

  private maybeSleep(): void {
    const n = this.count
    let ke = 0
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      ke += this.vel[i3] * this.vel[i3] + this.vel[i3 + 1] * this.vel[i3 + 1] + this.vel[i3 + 2] * this.vel[i3 + 2]
    }
    const thresh = 0.00009 * Math.max(1, n)
    if (ke < thresh) {
      this.vel.fill(0)
      this.sleeping = true
    } else {
      this.sleeping = false
    }
  }

  private splat(): void {
    this.heights.fill(0)
    this.weight.fill(0)
    this.kAcc.fill(0)
    this.sAcc.fill(0)
    this.residAcc.fill(0)
    this.cWeight.fill(0)
    this.cH.fill(0)
    const res = this.res
    const cres = this.colorRes
    const worldTo = res / (TRAY_R * 2)
    const colorTo = cres / (TRAY_R * 2)
    const n = this.count
    const sigmaH = this.software ? 0.12 : 0.09
    const sigmaC = this.software ? 0.16 : 0.13
    const rH = sigmaH * 2.45
    const rH2 = rH * rH
    const rC = sigmaC * 2.35
    const rC2 = rC * rC
    const invTwoH = 1 / (2 * sigmaH * sigmaH)
    const invTwoC = 1 / (2 * sigmaC * sigmaC)
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const px = this.pos[i3]
      const py = this.pos[i3 + 1]
      const pz = this.pos[i3 + 2]
      const rad = this.rad[i] ?? 0.06
      const mass = this.mass[i] ?? 0.001
      const kOff = i * BANDS
      const rOff = i * 3

      const tx = (px + TRAY_R) * worldTo
      const tz = (pz + TRAY_R) * worldTo
      const pr = rH * worldTo
      const x0 = Math.max(0, Math.floor(tx - pr - 1))
      const x1 = Math.min(res - 1, Math.ceil(tx + pr + 1))
      const z0 = Math.max(0, Math.floor(tz - pr - 1))
      const z1 = Math.min(res - 1, Math.ceil(tz + pr + 1))
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const wx = ix / worldTo - TRAY_R
          const wz = iz / worldTo - TRAY_R
          const dx = wx - px
          const dz = wz - pz
          const d2 = dx * dx + dz * dz
          if (d2 > rH2) continue
          if (Math.hypot(wx, wz) > TRAY_R - 0.05) continue
          const g = Math.exp(-d2 * invTwoH)
          const extra = Math.max(0, py + rad * 0.92 * g - trayHeight(wx, wz))
          if (extra <= 1e-5) continue
          const idx = iz * res + ix
          const m = mass * g
          const peak = extra * g
          if (peak > (this.heights[idx] ?? 0)) this.heights[idx] = peak
          this.weight[idx] = (this.weight[idx] ?? 0) + m
        }
      }

      const ctx = (px + TRAY_R) * colorTo
      const ctz = (pz + TRAY_R) * colorTo
      const cpr = rC * colorTo
      const cx0 = Math.max(0, Math.floor(ctx - cpr - 1))
      const cx1 = Math.min(cres - 1, Math.ceil(ctx + cpr + 1))
      const cz0 = Math.max(0, Math.floor(ctz - cpr - 1))
      const cz1 = Math.min(cres - 1, Math.ceil(ctz + cpr + 1))
      for (let iz = cz0; iz <= cz1; iz++) {
        for (let ix = cx0; ix <= cx1; ix++) {
          const wx = ix / colorTo - TRAY_R
          const wz = iz / colorTo - TRAY_R
          const d2 = (wx - px) * (wx - px) + (wz - pz) * (wz - pz)
          if (d2 > rC2) continue
          const g = Math.exp(-d2 * invTwoC)
          const extra = Math.max(0, py + rad * 0.85 * g - trayHeight(wx, wz))
          if (extra <= 1e-5) continue
          const idx = iz * cres + ix
          const m = mass * g
          this.cWeight[idx] = (this.cWeight[idx] ?? 0) + m
          if (extra > (this.cH[idx] ?? 0)) this.cH[idx] = extra
          const acc = idx * BANDS
          for (let b = 0; b < BANDS; b++) {
            this.kAcc[acc + b] = (this.kAcc[acc + b] ?? 0) + (this.k[kOff + b] ?? 0) * m
            this.sAcc[acc + b] = (this.sAcc[acc + b] ?? 0) + (this.s[kOff + b] ?? 0) * m
          }
          const ar = idx * 3
          this.residAcc[ar] = (this.residAcc[ar] ?? 0) + (this.resid[rOff] ?? 0) * m
          this.residAcc[ar + 1] = (this.residAcc[ar + 1] ?? 0) + (this.resid[rOff + 1] ?? 0) * m
          this.residAcc[ar + 2] = (this.residAcc[ar + 2] ?? 0) + (this.resid[rOff + 2] ?? 0) * m
        }
      }
    }

    this.reconstructField()
    const rgba = this.rgba
    const invH = 1 / HEIGHT_SCALE
    for (let i = 0; i < this.heights.length; i++) {
      const w = this.tmpW[i] ?? 0
      const o = i * 4
      if (w > 1e-5) {
        rgba[o] = Math.min(255, Math.round((this.tmpR[i] ?? 0) * 255))
        rgba[o + 1] = Math.min(255, Math.round((this.tmpG[i] ?? 0) * 255))
        rgba[o + 2] = Math.min(255, Math.round((this.tmpB[i] ?? 0) * 255))
        rgba[o + 3] = Math.min(255, Math.round((this.tmpH[i] ?? 0) * invH * 255))
      } else {
        rgba[o] = 0
        rgba[o + 1] = 0
        rgba[o + 2] = 0
        rgba[o + 3] = 0
      }
    }
    this.map.update(this.rgba)
  }

  private reconstructField(): void {
    const cres = this.colorRes
    for (let i = 0; i < this.cWeight.length; i++) {
      const w = this.cWeight[i] ?? 0
      if (w > 1e-6) {
        const rgb = accumulatedKSToSrgb(this.kAcc, this.sAcc, this.residAcc, i, w, this.cH[i] ?? 0.08)
        this.colR[i] = rgb[0]
        this.colG[i] = rgb[1]
        this.colB[i] = rgb[2]
      } else {
        this.colR[i] = 0
        this.colG[i] = 0
        this.colB[i] = 0
      }
    }

    const res = this.res
    const srcH = this.heights
    const srcW = this.weight
    const cellArea = (TRAY_R * 2) / res
    const hScale = 0.028 / Math.max(cellArea * cellArea, 1e-6)
    const scale = (cres - 1) / Math.max(1, res - 1)
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const i = z * res + x
        const w = srcW[i] ?? 0
        if (w > 1e-6) {
          const massH = w * hScale
          const peak = srcH[i] ?? 0
          const h = Math.max(peak * 0.62 + massH * 0.38, peak * 0.75)
          const u = x * scale
          const v = z * scale
          const x0 = Math.min(cres - 2, Math.max(0, Math.floor(u)))
          const z0 = Math.min(cres - 2, Math.max(0, Math.floor(v)))
          const fx = u - x0
          const fz = v - z0
          const i00 = z0 * cres + x0
          const sx = fx * fx * (3 - 2 * fx)
          const sz = fz * fz * (3 - 2 * fz)
          const w00 = (1 - sx) * (1 - sz) * ((this.cWeight[i00] ?? 0) > 1e-8 ? 1 : 0)
          const w10 = sx * (1 - sz) * ((this.cWeight[i00 + 1] ?? 0) > 1e-8 ? 1 : 0)
          const w01 = (1 - sx) * sz * ((this.cWeight[i00 + cres] ?? 0) > 1e-8 ? 1 : 0)
          const w11 = sx * sz * ((this.cWeight[i00 + cres + 1] ?? 0) > 1e-8 ? 1 : 0)
          const den = w00 + w10 + w01 + w11
          if (den > 1e-6) {
            const invC = 1 / den
            this.tmpR[i] =
              ((this.colR[i00] ?? 0) * w00 +
                (this.colR[i00 + 1] ?? 0) * w10 +
                (this.colR[i00 + cres] ?? 0) * w01 +
                (this.colR[i00 + cres + 1] ?? 0) * w11) *
              invC
            this.tmpG[i] =
              ((this.colG[i00] ?? 0) * w00 +
                (this.colG[i00 + 1] ?? 0) * w10 +
                (this.colG[i00 + cres] ?? 0) * w01 +
                (this.colG[i00 + cres + 1] ?? 0) * w11) *
              invC
            this.tmpB[i] =
              ((this.colB[i00] ?? 0) * w00 +
                (this.colB[i00 + 1] ?? 0) * w10 +
                (this.colB[i00 + cres] ?? 0) * w01 +
                (this.colB[i00 + cres + 1] ?? 0) * w11) *
              invC
          } else {
            this.tmpR[i] = 0
            this.tmpG[i] = 0
            this.tmpB[i] = 0
            this.tmpH[i] = 0
            this.tmpW[i] = 0
            continue
          }
          this.tmpH[i] = h
          this.tmpW[i] = w
        } else {
          this.tmpR[i] = 0
          this.tmpG[i] = 0
          this.tmpB[i] = 0
          this.tmpH[i] = 0
          this.tmpW[i] = 0
        }
      }
    }

    this.holeFill()
    this.holeFill()
    this.closePinholes()
    this.blurPass(true)
    this.blurPass(false)
    this.blurPass(true)
    this.blurPass(false)
    this.meniscus()
    this.heights.set(this.tmpH)
  }

  private holeFill(): void {
    const res = this.res
    for (let z = 1; z < res - 1; z++) {
      for (let x = 1; x < res - 1; x++) {
        const i = z * res + x
        if ((this.tmpW[i] ?? 0) > 1e-5) continue
        let n = 0
        let hs = 0
        let rs = 0
        let gs = 0
        let bs = 0
        let ws = 0
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oz) continue
            const j = (z + oz) * res + (x + ox)
            const w = this.tmpW[j] ?? 0
            if (w <= 1e-5) continue
            n++
            hs += this.tmpH[j] ?? 0
            rs += this.tmpR[j] ?? 0
            gs += this.tmpG[j] ?? 0
            bs += this.tmpB[j] ?? 0
            ws += w
          }
        }
        if (n >= 3) {
          this.tmpH[i] = (hs / n) * 0.88
          this.tmpR[i] = rs / n
          this.tmpG[i] = gs / n
          this.tmpB[i] = bs / n
          this.tmpW[i] = ws / n
        }
      }
    }
  }

  private closePinholes(): void {
    const res = this.res
    for (let z = 1; z < res - 1; z++) {
      for (let x = 1; x < res - 1; x++) {
        const i = z * res + x
        const h = this.tmpH[i] ?? 0
        let maxN = 0
        let rs = 0
        let gs = 0
        let bs = 0
        let n = 0
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oz) continue
            const j = (z + oz) * res + (x + ox)
            const hn = this.tmpH[j] ?? 0
            if (hn > maxN) maxN = hn
            if ((this.tmpW[j] ?? 0) > 1e-5) {
              n++
              rs += this.tmpR[j] ?? 0
              gs += this.tmpG[j] ?? 0
              bs += this.tmpB[j] ?? 0
            }
          }
        }
        if (maxN > 0.028 && h < maxN * 0.22 && n >= 4) {
          this.tmpH[i] = maxN * 0.62
          this.tmpW[i] = Math.max(this.tmpW[i] ?? 0, 1)
          this.tmpR[i] = rs / n
          this.tmpG[i] = gs / n
          this.tmpB[i] = bs / n
        }
      }
    }
  }

  private blurPass(horizontal: boolean): void {
    const res = this.res
    const srcH = this.tmpH
    const srcR = this.tmpR
    const srcG = this.tmpG
    const srcB = this.tmpB
    const srcW = this.tmpW
    const dstH = this.blurH
    const dstR = this.blurR
    const dstG = this.blurG
    const dstB = this.blurB
    const dstW = this.blurW
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const i = z * res + x
        const selfW = srcW[i] ?? 0
        if (selfW <= 1e-6) {
          dstH[i] = 0
          dstR[i] = 0
          dstG[i] = 0
          dstB[i] = 0
          dstW[i] = 0
          continue
        }
        let hs = (srcH[i] ?? 0) * 0.5
        let rs = (srcR[i] ?? 0) * 0.5
        let gs = (srcG[i] ?? 0) * 0.5
        let bs = (srcB[i] ?? 0) * 0.5
        let ws = selfW * 0.5
        let tw = 0.5
        const taps = [
          [horizontal ? -1 : 0, horizontal ? 0 : -1, 0.25],
          [horizontal ? 1 : 0, horizontal ? 0 : 1, 0.25],
        ] as const
        for (const [dx, dz, k] of taps) {
          const xx = x + dx
          const zz = z + dz
          if (xx < 0 || zz < 0 || xx >= res || zz >= res) continue
          const j = zz * res + xx
          const wj = srcW[j] ?? 0
          if (wj <= 1e-6) continue
          hs += (srcH[j] ?? 0) * k
          rs += (srcR[j] ?? 0) * k
          gs += (srcG[j] ?? 0) * k
          bs += (srcB[j] ?? 0) * k
          ws += wj * k
          tw += k
        }
        const inv = 1 / tw
        dstH[i] = hs * inv
        dstR[i] = rs * inv
        dstG[i] = gs * inv
        dstB[i] = bs * inv
        dstW[i] = ws * inv
      }
    }
    this.tmpH.set(dstH)
    this.tmpR.set(dstR)
    this.tmpG.set(dstG)
    this.tmpB.set(dstB)
    this.tmpW.set(dstW)
  }

  private meniscus(): void {
    const res = this.res
    for (let z = 1; z < res - 1; z++) {
      for (let x = 1; x < res - 1; x++) {
        const i = z * res + x
        const h = this.tmpH[i] ?? 0
        if (h < 0.002 || h > 0.12) continue
        const wC = this.tmpW[i] ?? 0
        const wL = this.tmpW[i - 1] ?? 0
        const wR = this.tmpW[i + 1] ?? 0
        const wB = this.tmpW[i - res] ?? 0
        const wT = this.tmpW[i + res] ?? 0
        const edge = Math.abs(wL - wR) + Math.abs(wB - wT) + Math.abs(wC - (wL + wR + wB + wT) * 0.25)
        const bead = Math.min(0.028, edge * 0.045) * (1 - Math.min(1, h / 0.11))
        this.tmpH[i] = h + bead
      }
    }
  }

  private sampleHeight(x: number, z: number): number {
    const res = this.res
    const u = ((x + TRAY_R) / (TRAY_R * 2)) * (res - 1)
    const v = ((z + TRAY_R) / (TRAY_R * 2)) * (res - 1)
    const x0 = Math.floor(u)
    const z0 = Math.floor(v)
    if (x0 < 0 || z0 < 0 || x0 >= res - 1 || z0 >= res - 1) return 0
    const fx = u - x0
    const fz = v - z0
    const i00 = z0 * res + x0
    const h00 = this.heights[i00] ?? 0
    const h10 = this.heights[i00 + 1] ?? 0
    const h01 = this.heights[i00 + res] ?? 0
    const h11 = this.heights[i00 + res + 1] ?? 0
    const sx = fx * fx * (3 - 2 * fx)
    const sz = fz * fz * (3 - 2 * fz)
    return h00 * (1 - sx) * (1 - sz) + h10 * sx * (1 - sz) + h01 * (1 - sx) * sz + h11 * sx * sz
  }

  private rebuildSurface(): void {
    const v = this.verts
    const b = this.base
    for (let i = 0; i < v.length; i += 3) {
      const x = b[i] ?? 0
      const z = b[i + 2] ?? 0
      v[i] = x
      v[i + 2] = z
      const h = this.sampleHeight(x, z)
      if (h < 0.0018) {
        v[i + 1] = trayHeight(x, z) - 0.0012
      } else {
        v[i + 1] = trayHeight(x, z) + h
      }
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, v, false)
    this.mesh.refreshBoundingInfo()
  }

  setGloss(gloss: number): void {
    const mat = this.mesh.material
    if (mat && 'setFloat' in mat) {
      ;(mat as ReturnType<typeof createPaintMaterial>).setFloat('gloss', gloss)
    }
  }

  setLights(key: Vector3, fill: Vector3, windowDir: Vector3): void {
    const mat = this.mesh.material as ReturnType<typeof createPaintMaterial> | null
    if (!mat || !('setVector3' in mat)) return
    mat.setVector3('keyDir', key)
    mat.setColor3('keyCol', new Color3(1.08, 1.01, 0.92))
    mat.setVector3('fillDir', fill)
    mat.setColor3('fillCol', new Color3(0.5, 0.62, 0.86))
    mat.setVector3('windowDir', windowDir)
    mat.setColor3('floorCol', new Color3(0.55, 0.44, 0.32))
    mat.setColor3('trayCol', new Color3(0.92, 0.89, 0.83))
    mat.setVector3('cameraPosition', Vector3.Zero())
  }

  getParticleCount(): number {
    return this.count
  }

  liveCount(): number {
    return this.count
  }

  getPaintStats(): { coverage: number; filled: number; meanRgb: [number, number, number]; maxHeight: number } {
    return this.samplePaint()
  }

  sampleSplat(x: number, z: number): { r: number; g: number; b: number; a: number } {
    const res = this.res
    const ix = Math.round(((x + TRAY_R) / (TRAY_R * 2)) * (res - 1))
    const iz = Math.round(((z + TRAY_R) / (TRAY_R * 2)) * (res - 1))
    if (ix < 0 || iz < 0 || ix >= res || iz >= res) return { r: 0, g: 0, b: 0, a: 0 }
    const o = (iz * res + ix) * 4
    return {
      r: (this.rgba[o] ?? 0) / 255,
      g: (this.rgba[o + 1] ?? 0) / 255,
      b: (this.rgba[o + 2] ?? 0) / 255,
      a: (this.rgba[o + 3] ?? 0) / 255,
    }
  }
}
