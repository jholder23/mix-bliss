import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Vector3,
  type Scene,
} from '@babylonjs/core'
import { createPaintMaterial } from './paintShader'
import type { SimFeel } from './paints'

export const TRAY_R = 2.28
export const MAX_PARTICLES = 280

function trayHeight(x: number, z: number): number {
  const r = Math.hypot(x, z) / TRAY_R
  if (r > 1.12) return 0.42
  const bowl = r * r * 0.2
  return 0.04 + bowl
}

export class PaintFluid {
  readonly mesh: Mesh
  private pos: Float32Array
  private prev: Float32Array
  private col: Float32Array
  private rad: Float32Array
  private live: Uint8Array
  private count = 0
  private matrices: Float32Array
  private colors: Float32Array
  private tmp = Matrix.Identity()
  private q = Quaternion.Identity()
  private scaling = new Vector3(1, 1, 1)
  private position = new Vector3()
  private hash: number[][] = []
  private cell = 0.22
  feel: SimFeel
  software: boolean

  constructor(scene: Scene, feel: SimFeel, software: boolean) {
    this.feel = feel
    this.software = software
    const cap = MAX_PARTICLES
    this.pos = new Float32Array(cap * 3)
    this.prev = new Float32Array(cap * 3)
    this.col = new Float32Array(cap * 3)
    this.rad = new Float32Array(cap)
    this.live = new Uint8Array(cap)
    this.matrices = new Float32Array(cap * 16)
    this.colors = new Float32Array(cap * 4)

    const subdiv = software ? 1 : 2
    this.mesh = MeshBuilder.CreateIcoSphere(
      'paint',
      { radius: 1, subdivisions: subdiv, flat: false },
      scene,
    )
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false)
    this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false)
    this.mesh.thinInstanceCount = 0
    this.mesh.isPickable = false
    this.mesh.alwaysSelectAsActiveMesh = true
    this.mesh.material = createPaintMaterial(scene)
  }

  setFeel(feel: SimFeel): void {
    this.feel = feel
  }

  scrape(): void {
    this.live.fill(0)
    this.count = 0
    this.mesh.thinInstanceCount = 0
  }

  private spawnOne(x: number, y: number, z: number, rgb: [number, number, number], radius: number): void {
    let slot = -1
    if (this.count < MAX_PARTICLES) {
      slot = this.count++
    } else {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (!this.live[i]) {
          slot = i
          break
        }
      }
      if (slot < 0) slot = Math.floor(Math.random() * MAX_PARTICLES)
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
    const n = Math.round(14 + size * 38)
    const spread = 0.18 + size * 0.42
    const pr = 0.09 + size * 0.09
    const baseY = trayHeight(at.x, at.z) + pr
    for (let i = 0; i < n; i++) {
      const u = Math.random()
      const v = Math.random()
      const theta = u * Math.PI * 2
      const phi = Math.acos(2 * v - 1)
      const mag = spread * Math.cbrt(Math.random())
      const x = at.x + Math.sin(phi) * Math.cos(theta) * mag
      const z = at.z + Math.sin(phi) * Math.sin(theta) * mag
      const y = baseY + Math.abs(Math.cos(phi)) * mag * 0.85 + pr * 0.4
      this.spawnOne(x, y, z, rgb, pr * (0.82 + Math.random() * 0.28))
    }
  }

  stir(at: Vector3, delta: Vector3, radius: number, kind: 'finger' | 'knife' | 'stick'): void {
    const r2 = radius * radius
    const force = kind === 'knife' ? 1.35 : kind === 'stick' ? 0.55 : 0.9
    const flatten = kind === 'knife' ? 0.55 : kind === 'finger' ? 0.18 : 0.08
    for (let i = 0; i < this.count; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const dx = this.pos[i3] - at.x
      const dy = this.pos[i3 + 1] - at.y
      const dz = this.pos[i3 + 2] - at.z
      const d2 = dx * dx + dy * dy * 0.45 + dz * dz
      if (d2 > r2) continue
      const w = 1 - d2 / r2
      this.pos[i3] += delta.x * force * w
      this.pos[i3 + 2] += delta.z * force * w
      this.pos[i3 + 1] -= flatten * w * this.rad[i]
      if (kind === 'knife') {
        const side = dx * delta.z - dz * delta.x
        const s = side === 0 ? 1 : Math.sign(side)
        this.pos[i3] += (-delta.z) * 0.35 * w * s
        this.pos[i3 + 2] += delta.x * 0.35 * w * s
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
      let vx = (this.pos[i3] - this.prev[i3]) * damp
      let vy = (this.pos[i3 + 1] - this.prev[i3 + 1]) * damp
      let vz = (this.pos[i3 + 2] - this.prev[i3 + 2]) * damp
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
    this.pushToGpu()
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
      const floor = trayHeight(this.pos[i3], this.pos[i3 + 2]) + ri * 0.92
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
          this.pos[i3 + 1] -= ny * push * 0.7
          this.pos[i3 + 2] -= nz * push
          this.pos[j3] += nx * push
          this.pos[j3 + 1] += ny * push * 0.7
          this.pos[j3 + 2] += nz * push
          const mix = feel.mix * (1 - dist / rest)
          this.col[i3] += (this.col[j3] - this.col[i3]) * mix
          this.col[i3 + 1] += (this.col[j3 + 1] - this.col[i3 + 1]) * mix
          this.col[i3 + 2] += (this.col[j3 + 2] - this.col[i3 + 2]) * mix
          this.col[j3] += (this.col[i3] - this.col[j3]) * mix
          this.col[j3 + 1] += (this.col[i3 + 1] - this.col[j3 + 1]) * mix
          this.col[j3 + 2] += (this.col[i3 + 2] - this.col[j3 + 2]) * mix
        } else if (dist < rest * 2.1) {
          const pull = feel.cohesion * (dist - rest) * 0.018
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

  private pushToGpu(): void {
    let w = 0
    const n = this.count
    for (let i = 0; i < n; i++) {
      if (!this.live[i]) continue
      const i3 = i * 3
      const r = this.rad[i] ?? 0.1
      this.position.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2])
      this.scaling.set(r, r, r)
      Matrix.ComposeToRef(this.scaling, this.q, this.position, this.tmp)
      this.tmp.copyToArray(this.matrices, w * 16)
      const c4 = w * 4
      this.colors[c4] = this.col[i3] ?? 1
      this.colors[c4 + 1] = this.col[i3 + 1] ?? 1
      this.colors[c4 + 2] = this.col[i3 + 2] ?? 1
      this.colors[c4 + 3] = 1
      w++
    }
    this.mesh.thinInstanceCount = w
    if (w === 0) return
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false)
    this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false)
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
    mat.setVector3('rimDir', new Vector3(0.4, -0.2, 0.6))
    mat.setVector3('windowDir', windowDir)
    mat.setColor3('floorCol', new Color3(0.55, 0.48, 0.38))
    mat.setVector3('cameraPosition', Vector3.Zero())
  }
}
