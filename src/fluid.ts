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
  private col: Float32Array
  private rad: Float32Array
  private live: Uint8Array
  private count = 0
  private cap: number
  private hash: number[][] = []
  private cell = 0.22
  private heights: Float32Array
  private weight: Float32Array
  private cr: Float32Array
  private cg: Float32Array
  private cb: Float32Array
  private rgba: Uint8Array
  private base: Float32Array
  private verts: Float32Array
  private map: RawTexture
  private res: number
  feel: SimFeel
  software: boolean

  constructor(scene: Scene, feel: SimFeel, software: boolean) {
    this.feel = feel
    this.software = software
    this.cap = software ? 180 : 380
    this.pos = new Float32Array(this.cap * 3)
    this.prev = new Float32Array(this.cap * 3)
    this.col = new Float32Array(this.cap * 3)
    this.rad = new Float32Array(this.cap)
    this.live = new Uint8Array(this.cap)

    this.res = software ? 112 : 176
    const n = this.res * this.res
    this.heights = new Float32Array(n)
    this.weight = new Float32Array(n)
    this.cr = new Float32Array(n)
    this.cg = new Float32Array(n)
    this.cb = new Float32Array(n)
    this.rgba = new Uint8Array(n * 4)

    const subdiv = software ? 72 : 118
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
    this.rgba.fill(0)
    this.map.update(this.rgba)
    this.rebuildSurface()
  }

  private spawnOne(x: number, y: number, z: number, rgb: [number, number, number], radius: number): void {
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
    this.col[i3] = rgb[0]
    this.col[i3 + 1] = rgb[1]
    this.col[i3 + 2] = rgb[2]
    this.rad[slot] = radius
    this.live[slot] = 1
  }

  glop(at: Vector3, rgb: [number, number, number], size: number): void {
    const n = Math.round(28 + size * 52)
    const moundR = 0.26 + size * 0.4
    const pr = 0.1 + size * 0.055
    const gold = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n
      const rr = moundR * Math.sqrt(u)
      const theta = i * gold
      const x = at.x + Math.cos(theta) * rr
      const z = at.z + Math.sin(theta) * rr
      const dome = Math.sqrt(Math.max(0, 1 - (rr / moundR) * (rr / moundR)))
      const y = trayHeight(x, z) + dome * (0.28 + size * 0.38) + pr * 0.35
      this.spawnOne(x, y, z, rgb, pr * (0.88 + Math.random() * 0.18))
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
        const s = side === 0 ? 1 : Math.sign(side)
        this.pos[i3] += -delta.z * 0.42 * w * s
        this.pos[i3 + 2] += delta.x * 0.42 * w * s
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
    const iters = this.software ? Math.min(4, feel.iterations) : feel.iterations
    for (let k = 0; k < iters; k++) this.solve()
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
        const s = lim / rr
        this.pos[i3] *= s
        this.pos[i3 + 2] *= s
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
          this.col[i3] += (this.col[j3] - this.col[i3]) * mix
          this.col[i3 + 1] += (this.col[j3 + 1] - this.col[i3 + 1]) * mix
          this.col[i3 + 2] += (this.col[j3 + 2] - this.col[i3 + 2]) * mix
          this.col[j3] += (this.col[i3] - this.col[j3]) * mix
          this.col[j3 + 1] += (this.col[i3 + 1] - this.col[j3 + 1]) * mix
          this.col[j3 + 2] += (this.col[i3 + 2] - this.col[j3 + 2]) * mix
        } else if (dist < rest * 2.0) {
          const pull = feel.cohesion * (dist - rest) * 0.02
          const nx = dx / dist
          const ny = dy / dist
          const nz = dz / dist
          this.pos[i3] += nx * pull
          this.pos[i3 + 1] += ny * pull
          this.pos[i3 + 2] += nz * pull
          this.pos[j3] -= nx * pull
          this.pos[j3 + 1] -= ny * pull
          this.pos[j3 + 2] -= nz * pull
        }
      }
    }
  }

  private splat(): void {
    this.heights.fill(0)
    this.weight.fill(0)
    this.cr.fill(0)
    this.cg.fill(0)
    this.cb.fill(0)
    const res = this.res
    const worldTo = res / (TRAY_R * 2)
    const n = this.count
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const px = this.pos[i3]
      const py = this.pos[i3 + 1]
      const pz = this.pos[i3 + 2]
      const r = (this.rad[i] ?? 0.1) * 1.55
      const r2 = r * r
      const tx = (px + TRAY_R) * worldTo
      const tz = (pz + TRAY_R) * worldTo
      const pr = r * worldTo
      const x0 = Math.max(0, Math.floor(tx - pr - 1))
      const x1 = Math.min(res - 1, Math.ceil(tx + pr + 1))
      const z0 = Math.max(0, Math.floor(tz - pr - 1))
      const z1 = Math.min(res - 1, Math.ceil(tz + pr + 1))
      const prr = this.col[i3] ?? 1
      const pgg = this.col[i3 + 1] ?? 1
      const pbb = this.col[i3 + 2] ?? 1
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const wx = ix / worldTo - TRAY_R
          const wz = iz / worldTo - TRAY_R
          const d2 = (wx - px) * (wx - px) + (wz - pz) * (wz - pz)
          if (d2 > r2) continue
          const env = Math.sqrt(r2 - d2)
          const yTop = py + env
          const extra = Math.max(0, yTop - trayHeight(wx, wz))
          if (Math.hypot(wx, wz) > TRAY_R - 0.04) continue
          const idx = iz * res + ix
          if (extra > (this.heights[idx] ?? 0)) this.heights[idx] = extra
          const w = env
          this.weight[idx] = (this.weight[idx] ?? 0) + w
          this.cr[idx] = (this.cr[idx] ?? 0) + prr * w
          this.cg[idx] = (this.cg[idx] ?? 0) + pgg * w
          this.cb[idx] = (this.cb[idx] ?? 0) + pbb * w
        }
      }
    }

    const rgba = this.rgba
    const inv = 1 / HEIGHT_SCALE
    for (let i = 0; i < this.heights.length; i++) {
      const w = this.weight[i] ?? 0
      const o = i * 4
      if (w > 1e-5) {
        rgba[o] = Math.min(255, Math.round(((this.cr[i] ?? 0) / w) * 255))
        rgba[o + 1] = Math.min(255, Math.round(((this.cg[i] ?? 0) / w) * 255))
        rgba[o + 2] = Math.min(255, Math.round(((this.cb[i] ?? 0) / w) * 255))
        rgba[o + 3] = Math.min(255, Math.round((this.heights[i] ?? 0) * inv * 255))
      } else {
        rgba[o] = 0
        rgba[o + 1] = 0
        rgba[o + 2] = 0
        rgba[o + 3] = 0
      }
    }
    this.map.update(this.rgba)
  }

  private sampleHeight(x: number, z: number): number {
    const res = this.res
    const u = (x + TRAY_R) / (TRAY_R * 2) * (res - 1)
    const v = (z + TRAY_R) / (TRAY_R * 2) * (res - 1)
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
    mat.setColor3('keyCol', new Color3(1.05, 1.0, 0.95))
    mat.setVector3('fillDir', fill)
    mat.setColor3('fillCol', new Color3(0.55, 0.62, 0.72))
    mat.setVector3('windowDir', windowDir)
    mat.setColor3('floorCol', new Color3(0.55, 0.48, 0.38))
    mat.setVector3('cameraPosition', Vector3.Zero())
  }
}
