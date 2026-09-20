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

export class PaintFluid {
  readonly mesh: Mesh
  private pos: Float32Array
  private prev: Float32Array
  private k: Float32Array
  private s: Float32Array
  private rad: Float32Array
  private live: Uint8Array
  private count = 0
  private cap: number
  private hash: number[][] = []
  private cell = 0.2
  private heights: Float32Array
  private weight: Float32Array
  private kAcc: Float32Array
  private sAcc: Float32Array
  private rgba: Uint8Array
  private tmpH: Float32Array
  private tmpR: Float32Array
  private tmpG: Float32Array
  private tmpB: Float32Array
  private tmpW: Float32Array
  private base: Float32Array
  private verts: Float32Array
  private map: RawTexture
  private res: number
  feel: SimFeel
  software: boolean

  constructor(scene: Scene, feel: SimFeel, software: boolean) {
    this.feel = feel
    this.software = software
    this.cap = software ? 220 : 460
    this.pos = new Float32Array(this.cap * 3)
    this.prev = new Float32Array(this.cap * 3)
    this.k = new Float32Array(this.cap * BANDS)
    this.s = new Float32Array(this.cap * BANDS)
    this.rad = new Float32Array(this.cap)
    this.live = new Uint8Array(this.cap)

    this.res = software ? 128 : 192
    const n = this.res * this.res
    this.heights = new Float32Array(n)
    this.weight = new Float32Array(n)
    this.kAcc = new Float32Array(n * BANDS)
    this.sAcc = new Float32Array(n * BANDS)
    this.rgba = new Uint8Array(n * 4)
    this.tmpH = new Float32Array(n)
    this.tmpR = new Float32Array(n)
    this.tmpG = new Float32Array(n)
    this.tmpB = new Float32Array(n)
    this.tmpW = new Float32Array(n)

    const subdiv = software ? 80 : 128
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
      this.verts[i + 1] = trayHeight(x, z)
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
  }

  scrape(): void {
    this.live.fill(0)
    this.count = 0
    this.heights.fill(0)
    this.weight.fill(0)
    this.kAcc.fill(0)
    this.sAcc.fill(0)
    this.k.fill(0)
    this.s.fill(0)
    this.rgba.fill(0)
    this.map.update(this.rgba)
    this.rebuildSurface()
  }

  get particleCount(): number {
    return this.getParticleCount()
  }

  private spawnOne(x: number, y: number, z: number, pigment: Pigment, radius: number): void {
    let slot = -1
    if (this.count < this.cap) {
      slot = this.count++
    } else {
      for (let i = 0; i < this.cap; i++) {
        if (!this.live[i]) {
          slot = i
          break
        }
      }
      if (slot < 0) slot = Math.floor(Math.random() * this.cap)
    }
    const i3 = slot * 3
    this.pos[i3] = x
    this.pos[i3 + 1] = y
    this.pos[i3 + 2] = z
    this.prev[i3] = x
    this.prev[i3 + 1] = y
    this.prev[i3 + 2] = z
    writePigmentSlot(this.k, this.s, slot, pigment)
    this.rad[slot] = radius
    this.live[slot] = 1
  }

  glop(at: Vector3, pigment: Pigment, size: number): void {
    const n = Math.round(42 + size * 68)
    const moundR = 0.3 + size * 0.4
    const moundH = 0.26 + size * 0.4
    const pr = 0.12 + size * 0.05
    const gold = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n
      const yFrac = Math.pow(1 - u, 0.62)
      const rr = moundR * Math.sqrt(Math.max(0, 1 - yFrac * yFrac))
      const theta = i * gold
      const x = at.x + Math.cos(theta) * rr
      const z = at.z + Math.sin(theta) * rr
      const y = trayHeight(x, z) + yFrac * moundH + pr * 0.45
      this.spawnOne(x, y, z, pigment, pr * (0.9 + Math.random() * 0.14))
    }
  }

  stir(at: Vector3, delta: Vector3, radius: number, kind: 'finger' | 'knife' | 'stick'): void {
    const r2 = radius * radius
    const force = kind === 'knife' ? 1.45 : kind === 'stick' ? 0.58 : 0.95
    const flatten = kind === 'knife' ? 0.62 : kind === 'finger' ? 0.22 : 0.1
    for (let i = 0; i < this.count; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const dx = this.pos[i3] - at.x
      const dy = this.pos[i3 + 1] - at.y
      const dz = this.pos[i3 + 2] - at.z
      const d2 = dx * dx + dy * dy * 0.4 + dz * dz
      if (d2 > r2) continue
      const w = 1 - d2 / r2
      this.pos[i3] += delta.x * force * w
      this.pos[i3 + 2] += delta.z * force * w
      this.pos[i3 + 1] -= flatten * w * (this.rad[i] ?? 0.1)
      if (kind === 'knife') {
        const side = dx * delta.z - dz * delta.x
        const sign = side === 0 ? 1 : Math.sign(side)
        this.pos[i3] += -delta.z * 0.42 * w * sign
        this.pos[i3 + 2] += delta.x * 0.42 * w * sign
      }
    }
  }

  step(dt: number): void {
    const feel = this.feel
    const n = this.count
    const g = feel.gravity * dt
    const damp = feel.damping
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const vx = (this.pos[i3] - this.prev[i3]) * damp
      const vy = (this.pos[i3 + 1] - this.prev[i3 + 1]) * damp
      const vz = (this.pos[i3 + 2] - this.prev[i3 + 2]) * damp
      this.prev[i3] = this.pos[i3]
      this.prev[i3 + 1] = this.pos[i3 + 1]
      this.prev[i3 + 2] = this.pos[i3 + 2]
      this.pos[i3] += vx
      this.pos[i3 + 1] += vy - g
      this.pos[i3 + 2] += vz
    }

    this.rebuildHash()
    const iters = this.software ? Math.min(5, feel.iterations) : feel.iterations
    for (let k = 0; k < iters; k++) this.solve()
    this.blendPigment()
    this.viscousBlend()
    this.splat()
    this.rebuildSurface()
  }

  private rebuildHash(): void {
    const cells = 48
    if (this.hash.length !== cells * cells) {
      this.hash = Array.from({ length: cells * cells }, () => [])
    } else {
      for (const bucket of this.hash) bucket.length = 0
    }
    const n = this.count
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const cx = Math.min(47, Math.max(0, Math.floor((this.pos[i3] + 3.2) / this.cell)))
      const cz = Math.min(47, Math.max(0, Math.floor((this.pos[i3 + 2] + 3.2) / this.cell)))
      this.hash[cx * 48 + cz]?.push(i)
    }
  }

  private neighbors(i: number, out: number[]): void {
    out.length = 0
    const i3 = i * 3
    const cx = Math.min(47, Math.max(0, Math.floor((this.pos[i3] + 3.2) / this.cell)))
    const cz = Math.min(47, Math.max(0, Math.floor((this.pos[i3 + 2] + 3.2) / this.cell)))
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const x = cx + ox
        const z = cz + oz
        if (x < 0 || z < 0 || x > 47 || z > 47) continue
        const bucket = this.hash[x * 48 + z]
        if (!bucket) continue
        for (const j of bucket) if (j !== i) out.push(j)
      }
    }
  }

  private solve(): void {
    const feel = this.feel
    const n = this.count
    const near: number[] = []
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const ri = this.rad[i] ?? 0.1
      const floor = trayHeight(this.pos[i3], this.pos[i3 + 2]) + ri * 0.55
      if (this.pos[i3 + 1] < floor) this.pos[i3 + 1] = floor
      const rr = Math.hypot(this.pos[i3], this.pos[i3 + 2])
      const lim = TRAY_R - ri * 0.8
      if (rr > lim) {
        const scale = lim / rr
        this.pos[i3] *= scale
        this.pos[i3 + 2] *= scale
      }

      this.neighbors(i, near)
      for (const j of near) {
        if (j <= i || !this.live[j]) continue
        const j3 = j * 3
        const dx = this.pos[j3] - this.pos[i3]
        const dy = this.pos[j3 + 1] - this.pos[i3 + 1]
        const dz = this.pos[j3 + 2] - this.pos[i3 + 2]
        const dist = Math.hypot(dx, dy, dz) + 1e-6
        const rj = this.rad[j] ?? 0.1
        const rest = (ri + rj) * feel.rest
        if (dist < rest) {
          const push = (rest - dist) * 0.5
          const nx = dx / dist
          const ny = dy / dist
          const nz = dz / dist
          this.pos[i3] -= nx * push
          this.pos[i3 + 1] -= ny * push * 0.65
          this.pos[i3 + 2] -= nz * push
          this.pos[j3] += nx * push
          this.pos[j3 + 1] += ny * push * 0.65
          this.pos[j3 + 2] += nz * push
          const mix = feel.mix * (1 - dist / rest)
          mixKSSlots(this.k, this.s, i, j, ri * ri * ri, rj * rj * rj, mix)
        } else if (dist < rest * 2.55) {
          const pull = feel.cohesion * (dist - rest) * 0.07
          const nx = dx / dist
          const ny = dy / dist
          const nz = dz / dist
          this.pos[i3] += nx * pull
          this.pos[i3 + 1] += ny * pull * 1.15
          this.pos[i3 + 2] += nz * pull
          this.pos[j3] -= nx * pull
          this.pos[j3 + 1] -= ny * pull * 1.15
          this.pos[j3 + 2] -= nz * pull
        }
      }
    }
  }

  /** Fold pigment in K/S space — mix tools never spawn paint, they only homogenize. */
  private blendPigment(): void {
    const rate = this.feel.mix * 0.32
    if (rate <= 1e-6) return
    const near: number[] = []
    for (let i = 0; i < this.count; i++) {
      if (!this.live[i]) continue
      this.neighbors(i, near)
      const ri = this.rad[i] ?? 0.1
      const i3 = i * 3
      for (const j of near) {
        if (j <= i || !this.live[j]) continue
        const j3 = j * 3
        const dx = (this.pos[j3] ?? 0) - (this.pos[i3] ?? 0)
        const dy = (this.pos[j3 + 1] ?? 0) - (this.pos[i3 + 1] ?? 0)
        const dz = (this.pos[j3 + 2] ?? 0) - (this.pos[i3 + 2] ?? 0)
        const dist = Math.hypot(dx, dy, dz) + 1e-6
        const rj = this.rad[j] ?? 0.1
        const reach = (ri + rj) * 1.85
        if (dist > reach) continue
        mixKSSlots(this.k, this.s, i, j, ri * ri * ri, rj * rj * rj, rate * (1 - dist / reach))
      }
    }
  }

  private viscousBlend(): void {
    const amt = 0.16 + this.feel.damping * 0.18
    const near: number[] = []
    for (let i = 0; i < this.count; i++) {
      if (!this.live[i]) continue
      this.neighbors(i, near)
      if (near.length === 0) continue
      const i3 = i * 3
      const vx = this.pos[i3] - this.prev[i3]
      const vy = this.pos[i3 + 1] - this.prev[i3 + 1]
      const vz = this.pos[i3 + 2] - this.prev[i3 + 2]
      let ax = 0
      let ay = 0
      let az = 0
      let c = 0
      for (const j of near) {
        if (!this.live[j]) continue
        const j3 = j * 3
        ax += this.pos[j3] - this.prev[j3]
        ay += this.pos[j3 + 1] - this.prev[j3 + 1]
        az += this.pos[j3 + 2] - this.prev[j3 + 2]
        c++
      }
      if (!c) continue
      ax /= c
      ay /= c
      az /= c
      this.prev[i3] = this.pos[i3] - (vx + (ax - vx) * amt)
      this.prev[i3 + 1] = this.pos[i3 + 1] - (vy + (ay - vy) * amt)
      this.prev[i3 + 2] = this.pos[i3 + 2] - (vz + (az - vz) * amt)
    }
  }

  private splat(): void {
    this.heights.fill(0)
    this.weight.fill(0)
    this.kAcc.fill(0)
    this.sAcc.fill(0)
    const res = this.res
    const worldTo = res / (TRAY_R * 2)
    const n = this.count
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const px = this.pos[i3]
      const py = this.pos[i3 + 1]
      const pz = this.pos[i3 + 2]
      const rad = this.rad[i] ?? 0.1
      const r = rad * 2.25
      const r2 = r * r
      const tx = (px + TRAY_R) * worldTo
      const tz = (pz + TRAY_R) * worldTo
      const pr = r * worldTo
      const x0 = Math.max(0, Math.floor(tx - pr - 1))
      const x1 = Math.min(res - 1, Math.ceil(tx + pr + 1))
      const z0 = Math.max(0, Math.floor(tz - pr - 1))
      const z1 = Math.min(res - 1, Math.ceil(tz + pr + 1))
      const kOff = i * BANDS
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const wx = ix / worldTo - TRAY_R
          const wz = iz / worldTo - TRAY_R
          const d2 = (wx - px) * (wx - px) + (wz - pz) * (wz - pz)
          if (d2 > r2) continue
          const t = 1 - d2 / r2
          const extra = Math.max(0, py + rad * 1.15 * t - trayHeight(wx, wz))
          if (extra <= 0) continue
          if (Math.hypot(wx, wz) > TRAY_R - 0.04) continue
          const idx = iz * res + ix
          if (extra > (this.heights[idx] ?? 0)) this.heights[idx] = extra
          const mass = extra
          this.weight[idx] = (this.weight[idx] ?? 0) + mass
          const acc = idx * BANDS
          for (let b = 0; b < BANDS; b++) {
            this.kAcc[acc + b] = (this.kAcc[acc + b] ?? 0) + (this.k[kOff + b] ?? 0) * mass
            this.sAcc[acc + b] = (this.sAcc[acc + b] ?? 0) + (this.s[kOff + b] ?? 0) * mass
          }
        }
      }
    }

    this.softenField()
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

  private softenField(): void {
    const res = this.res
    const srcH = this.heights
    const srcW = this.weight
    for (let i = 0; i < srcH.length; i++) {
      const w = srcW[i] ?? 0
      if (w > 1e-5) {
        const rgb = accumulatedKSToSrgb(this.kAcc, this.sAcc, i, w)
        this.tmpR[i] = rgb[0]
        this.tmpG[i] = rgb[1]
        this.tmpB[i] = rgb[2]
        this.tmpH[i] = srcH[i] ?? 0
        this.tmpW[i] = w
      } else {
        this.tmpR[i] = 0
        this.tmpG[i] = 0
        this.tmpB[i] = 0
        this.tmpH[i] = 0
        this.tmpW[i] = 0
      }
    }

    for (let z = 1; z < res - 1; z++) {
      for (let x = 1; x < res - 1; x++) {
        const i = z * res + x
        if ((srcW[i] ?? 0) > 1e-5) continue
        let n = 0
        let hs = 0
        let rs = 0
        let gs = 0
        let bs = 0
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oz) continue
            const j = (z + oz) * res + (x + ox)
            if ((srcW[j] ?? 0) <= 1e-5) continue
            n++
            hs += this.tmpH[j] ?? 0
            rs += this.tmpR[j] ?? 0
            gs += this.tmpG[j] ?? 0
            bs += this.tmpB[j] ?? 0
          }
        }
        if (n >= 4) {
          this.tmpH[i] = (hs / n) * 0.78
          this.tmpR[i] = rs / n
          this.tmpG[i] = gs / n
          this.tmpB[i] = bs / n
          this.tmpW[i] = 1
        }
      }
    }

    this.heights.set(this.tmpH)
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
    return h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz
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
      v[i + 1] = trayHeight(x, z) + h
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
    mat.setColor3('keyCol', new Color3(1.02, 0.97, 0.9))
    mat.setVector3('fillDir', fill)
    mat.setColor3('fillCol', new Color3(0.46, 0.58, 0.8))
    mat.setVector3('windowDir', windowDir)
    mat.setColor3('floorCol', new Color3(0.5, 0.4, 0.3))
    mat.setVector3('cameraPosition', Vector3.Zero())
  }

  getParticleCount(): number {
    let n = 0
    for (let i = 0; i < this.count; i++) if (this.live[i]) n++
    return n
  }

  getPaintStats(): {
    coverage: number
    filled: number
    meanRgb: [number, number, number]
    maxHeight: number
  } {
    const rgba = this.rgba
    let filled = 0
    let r = 0
    let g = 0
    let b = 0
    let maxH = 0
    for (let i = 0; i < this.heights.length; i++) {
      const a = rgba[i * 4 + 3] ?? 0
      if (a < 8) continue
      filled++
      r += (rgba[i * 4] ?? 0) / 255
      g += (rgba[i * 4 + 1] ?? 0) / 255
      b += (rgba[i * 4 + 2] ?? 0) / 255
      maxH = Math.max(maxH, this.heights[i] ?? 0)
    }
    const inv = filled ? 1 / filled : 0
    return {
      coverage: filled / Math.max(1, this.heights.length),
      filled,
      meanRgb: [r * inv, g * inv, b * inv],
      maxHeight: maxH,
    }
  }

  samplePaint(): {
    coverage: number
    filled: number
    meanRgb: [number, number, number]
    maxHeight: number
  } {
    return this.getPaintStats()
  }

  sampleSplat(x: number, z: number): { r: number; g: number; b: number; a: number } {
    const res = this.res
    const ix = Math.min(res - 1, Math.max(0, Math.round(((x + TRAY_R) / (TRAY_R * 2)) * (res - 1))))
    const iz = Math.min(res - 1, Math.max(0, Math.round(((z + TRAY_R) / (TRAY_R * 2)) * (res - 1))))
    const o = (iz * res + ix) * 4
    return {
      r: (this.rgba[o] ?? 0) / 255,
      g: (this.rgba[o + 1] ?? 0) / 255,
      b: (this.rgba[o + 2] ?? 0) / 255,
      a: (this.rgba[o + 3] ?? 0) / 255,
    }
  }
}
