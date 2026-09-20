import { Matrix, PointerEventTypes, Vector3 } from '@babylonjs/core'
import { MixAudio } from './audio'
import './debug'
import { PaintFluid } from './fluid'
import { FILL_DIR, KEY_DIR, SHOTS, WINDOW_DIR, createStudio } from './studio'
import { TUBES, customTube, masstoneSrgb, mixTubePaints, simFromViscosity, tubeByName, viscosityName } from './paints'
import type { Tube } from './paints'
import { srgbHueChroma } from './km'

type Tool = 'glop' | 'finger' | 'knife' | 'stick' | 'look'

function must<T>(el: T | null, name: string): T {
  if (!el) throw new Error(`Missing ${name}`)
  return el
}

const canvas = must(document.querySelector<HTMLCanvasElement>('#canvas'), 'canvas')
const fail = must(document.querySelector<HTMLDivElement>('#fail'), 'fail')
const hint = must(document.querySelector<HTMLParagraphElement>('#hint'), 'hint')
const swatchesEl = must(document.querySelector<HTMLDivElement>('#swatches'), 'swatches')
const viscosityEl = must(document.querySelector<HTMLInputElement>('#viscosity'), 'viscosity')
const viscLabel = must(document.querySelector<HTMLElement>('#visc-label'), 'visc-label')
const sizeEl = must(document.querySelector<HTMLInputElement>('#size'), 'size')
const sizeLabel = must(document.querySelector<HTMLElement>('#size-label'), 'size-label')
const tubeName = must(document.querySelector<HTMLParagraphElement>('#tube-name'), 'tube-name')
const scrapeBtn = must(document.querySelector<HTMLButtonElement>('#scrape'), 'scrape')
const soundBtn = must(document.querySelector<HTMLButtonElement>('#sound'), 'sound')
const shotsEl = must(document.querySelector<HTMLDivElement>('#shots'), 'shots')
const toolButtons: Record<Tool, HTMLButtonElement> = {
  glop: must(document.querySelector<HTMLButtonElement>('#tool-glop'), 'glop'),
  finger: must(document.querySelector<HTMLButtonElement>('#tool-finger'), 'finger'),
  knife: must(document.querySelector<HTMLButtonElement>('#tool-knife'), 'knife'),
  stick: must(document.querySelector<HTMLButtonElement>('#tool-stick'), 'stick'),
  look: must(document.querySelector<HTMLButtonElement>('#tool-look'), 'look'),
}

canvas.addEventListener('contextmenu', (event) => event.preventDefault())

let studio: ReturnType<typeof createStudio>
try {
  studio = createStudio(canvas)
} catch (err) {
  fail.hidden = false
  const p = document.createElement('p')
  p.textContent = err instanceof Error ? err.message : 'WebGL2 unavailable'
  fail.replaceChildren(p)
  throw err
}

const { engine, scene, camera, software, lookTo, isSettling, setToolGhost, setLeftOrbit, addShadowCaster } = studio
const audio = new MixAudio()
let viscosity = 0.72
let feel = simFromViscosity(viscosity)
let fluid: PaintFluid
try {
  fluid = new PaintFluid(scene, feel, software)
  fluid.setLights(KEY_DIR, FILL_DIR, WINDOW_DIR)
  addShadowCaster(fluid.mesh)
} catch (err) {
  fail.hidden = false
  const p = document.createElement('p')
  p.textContent = err instanceof Error ? err.message : 'Paint engine failed'
  fail.replaceChildren(p)
  throw err
}

let selected: Tube = TUBES[0] ?? customTube('#d42a1e')
let tool: Tool = 'glop'
let size = 0.52
let customHex = '#7a3cff'
let lastDump: Vector3 | null = null
let prevPick: Vector3 | null = null
let stirring = false

function sizeName(t: number): string {
  if (t < 0.34) return 'Dab'
  if (t < 0.62) return 'Medium'
  if (t < 0.82) return 'Glop'
  return 'Dump'
}

function toolRadius(): number {
  if (tool === 'stick') return 0.28 + size * 0.18
  if (tool === 'knife') return 0.55 + size * 0.4
  return 0.42 + size * 0.45
}

function setTool(next: Tool): void {
  tool = next
  for (const [name, btn] of Object.entries(toolButtons)) {
    const on = name === next
    btn.classList.toggle('on', on)
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
  if (next === 'glop') tubeName.textContent = `${selected.name} ready to glop.`
  else if (next === 'look') tubeName.textContent = 'Look: drag any direction. Right-drag always orbits.'
  else tubeName.textContent = `${next} folds paint. It does not dump color.`
  canvas.style.cursor = next === 'look' ? 'grab' : 'crosshair'
  setLeftOrbit(next === 'look')
}

function renderSwatches(): void {
  swatchesEl.replaceChildren()
  for (const tube of TUBES) {
    const btn = document.createElement('button')
    btn.className = 'swatch'
    btn.type = 'button'
    btn.title = tube.name
    btn.dataset.tube = tube.name
    btn.setAttribute('role', 'option')
    btn.setAttribute('aria-label', tube.name)
    btn.setAttribute('data-tube', tube.name)
    btn.setAttribute('aria-selected', tube.hex === selected.hex ? 'true' : 'false')
    btn.style.background = tube.hex
    btn.addEventListener('click', () => {
      selected = tube
      renderSwatches()
    })
    swatchesEl.append(btn)
  }
  const wrap = document.createElement('label')
  wrap.className = 'swatch custom'
  wrap.title = 'Custom color'
  const picker = document.createElement('input')
  picker.type = 'color'
  picker.value = customHex
  picker.setAttribute('aria-label', 'Custom color')
  picker.style.opacity = '0'
  picker.style.width = '100%'
  picker.style.height = '100%'
  picker.style.cursor = 'pointer'
  picker.addEventListener('input', () => {
    customHex = picker.value
    selected = customTube(customHex)
    renderSwatches()
  })
  wrap.append(picker)
  if (selected.name === 'Custom') wrap.style.borderColor = '#fff'
  swatchesEl.append(wrap)
  if (tool === 'glop') tubeName.textContent = `${selected.name} ready to glop.`
}

function markShot(id: string): void {
  for (const btn of shotsEl.querySelectorAll('.shot')) {
    btn.classList.toggle('on', btn.getAttribute('data-shot') === id)
  }
}

function renderShots(): void {
  shotsEl.replaceChildren()
  for (const shot of SHOTS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'shot'
    btn.dataset.shot = shot.id
    btn.textContent = shot.label
    const pick = () => {
      lookTo(shot)
      markShot(shot.id)
      hint.classList.add('gone')
    }
    btn.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      pick()
    })
    btn.addEventListener('click', (event) => {
      event.preventDefault()
      pick()
    })
    shotsEl.append(btn)
  }
  markShot('three')
}

function pickTray(px: number, py: number): Vector3 | null {
  const ray = scene.createPickingRay(px, py, Matrix.Identity(), camera)
  const n = new Vector3(0, 1, 0)
  const denom = Vector3.Dot(ray.direction, n)
  if (Math.abs(denom) < 1e-5) return null
  const dist = Vector3.Dot(new Vector3(0, 0.12, 0).subtract(ray.origin), n) / denom
  if (dist < 0) return null
  return ray.origin.add(ray.direction.scale(dist))
}

function hideHint(): void {
  hint.classList.add('gone')
}

function dishScreen(): { x: number; y: number } {
  const w = engine.getRenderWidth()
  const h = engine.getRenderHeight()
  const p = Vector3.Project(new Vector3(0, 0.18, 0), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(w, h))
  const rect = canvas.getBoundingClientRect()
  return {
    x: rect.left + (p.x / w) * rect.width,
    y: rect.top + (p.y / h) * rect.height,
  }
}

function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let left = Math.max(1, n)
    let done = false
    const finish = () => {
      if (done) return
      done = true
      scene.onAfterRenderObservable.remove(obs)
      resolve()
    }
    const obs = scene.onAfterRenderObservable.add(() => {
      if (--left <= 0) finish()
    })
    window.setTimeout(finish, 2500)
  })
}

async function sampleFrame(): Promise<{ mean: [number, number, number]; variance: number; px: number }> {
  const sw = 80
  const sh = 80
  const rw = engine.getRenderWidth()
  const rh = engine.getRenderHeight()
  const x = Math.max(0, Math.floor(rw / 2 - sw / 2))
  const y = Math.max(0, Math.floor(rh / 2 - sh / 2))
  const buf = await engine.readPixels(x, y, sw, sh, true, true)
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer)
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i + 2 < data.length; i += 4) {
    r += data[i] ?? 0
    g += data[i + 1] ?? 0
    b += data[i + 2] ?? 0
    n++
  }
  if (!n) return { mean: [0, 0, 0], variance: 0, px: 0 }
  const mr = r / n
  const mg = g / n
  const mb = b / n
  let v = 0
  for (let i = 0; i + 2 < data.length; i += 4) {
    const dr = (data[i] ?? 0) - mr
    const dg = (data[i + 1] ?? 0) - mg
    const db = (data[i + 2] ?? 0) - mb
    v += dr * dr + dg * dg + db * db
  }
  return { mean: [mr / 255, mg / 255, mb / 255], variance: v / n, px: n }
}

scene.onPointerObservable.add((info) => {
  const evt = info.event
  if ('button' in evt && evt.button !== 0) return
  if (tool === 'look') return

  if (info.type === PointerEventTypes.POINTERDOWN) {
    const at = pickTray(scene.pointerX, scene.pointerY)
    if (!at) return
    stirring = true
    prevPick = at
    hideHint()
    if (tool === 'glop') {
      fluid.glop(at, selected.pigment, size)
      lastDump = at.clone()
      audio.blob()
    }
  } else if (info.type === PointerEventTypes.POINTERMOVE && stirring) {
    const at = pickTray(scene.pointerX, scene.pointerY)
    if (!at || !prevPick) return
    const delta = at.subtract(prevPick)
    if (tool === 'glop') {
      if (!lastDump || Vector3.Distance(at, lastDump) > 0.55 + size * 0.4) {
        fluid.glop(at, selected.pigment, size * 0.85)
        lastDump = at.clone()
        audio.blob()
      }
    } else {
      const dist = delta.length()
      if (dist > 0.004) {
        fluid.stir(at, delta, toolRadius(), tool)
        audio.stir(dist * 8)
        setToolGhost(tool === 'finger' ? 1 : tool === 'knife' ? 2 : 3, at, delta)
      }
    }
    prevPick = at
  } else if (info.type === PointerEventTypes.POINTERUP) {
    stirring = false
    prevPick = null
    setToolGhost(0, null, Vector3.Zero())
  }
})

for (const name of Object.keys(toolButtons) as Tool[]) {
  toolButtons[name].addEventListener('click', () => setTool(name))
}

scrapeBtn.addEventListener('click', () => {
  fluid.scrape()
  hint.textContent = 'Tray scraped. Pick a color and glop, or switch a camera angle.'
  hint.classList.remove('gone')
  setTool('glop')
})

soundBtn.addEventListener('click', async () => {
  const next = !audio.enabled
  await audio.setEnabled(next)
  soundBtn.classList.toggle('on', next)
  soundBtn.setAttribute('aria-pressed', next ? 'true' : 'false')
})

viscosityEl.addEventListener('input', () => {
  viscosity = Number(viscosityEl.value) / 100
  feel = simFromViscosity(viscosity)
  fluid.setFeel(feel)
  viscLabel.textContent = viscosityName(viscosity)
  audio.setViscosity(viscosity)
  fluid.setGloss(feel.gloss)
})

sizeEl.addEventListener('input', () => {
  size = Number(sizeEl.value) / 100
  sizeLabel.textContent = sizeName(size)
})

window.addEventListener('resize', () => engine.resize())

scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(0.033, engine.getDeltaTime() / 1000)
  fluid.step(dt)
  fluid.setGloss(feel.gloss)
  const mat = fluid.mesh.material
  if (mat && 'setVector3' in mat) {
    ;(mat as { setVector3: (n: string, v: Vector3) => void }).setVector3('cameraPosition', camera.position)
  }
})

let framesDrawn = 0
engine.runRenderLoop(() => {
  framesDrawn++
  scene.render()
})

renderSwatches()
renderShots()
setTool('glop')
viscLabel.textContent = viscosityName(viscosity)
size = Number(sizeEl.value) / 100
sizeLabel.textContent = sizeName(size)
fluid.setGloss(feel.gloss)

function resolveTube(nameOrHex: string): Tube {
  const named = tubeByName(nameOrHex)
  if (named) return named
  if (nameOrHex.startsWith('#')) return customTube(nameOrHex)
  throw new Error(`Unknown tube ${nameOrHex}`)
}

window.__impasto = {
  ready: true,
  software,
  getCamera: () => ({
    alpha: camera.alpha,
    beta: camera.beta,
    radius: camera.radius,
    settling: isSettling(),
  }),
  getTool: () => tool,
  getSelected: () => ({ name: selected.name, hex: selected.hex }),
  getParticleCount: () => fluid.particleCount,
  getPaintStats: () => fluid.samplePaint(),
  getDishScreen: () => dishScreen(),
  sampleFrame,
  waitFrames,
  getFrameCount: () => framesDrawn,
  mix(a, b, amountA = 1, amountB = 1) {
    const rgb = mixTubePaints(resolveTube(a), resolveTube(b), amountA, amountB)
    const hc = srgbHueChroma(rgb)
    return { rgb, hue: hc.h, chroma: hc.c, lightness: hc.l }
  },
  masstone(name) {
    return masstoneSrgb(resolveTube(name))
  },
  scrape() {
    fluid.scrape()
  },
  glop(name, x, z, dumpSize = 0.55) {
    fluid.glop(new Vector3(x, 0.12, z), resolveTube(name).pigment, dumpSize)
  },
  stir(x, z, dx, dz, kind = 'finger') {
    fluid.stir(new Vector3(x, 0.12, z), new Vector3(dx, 0, dz), 0.85, kind)
  },
  step(frames = 8) {
    for (let i = 0; i < frames; i++) fluid.step(1 / 60)
  },
  sample(x, z) {
    return fluid.sampleSplat(x, z)
  },
  liveCount() {
    return fluid.liveCount()
  },
  pause() {
    engine.stopRenderLoop()
  },
  resume() {
    engine.runRenderLoop(() => {
      framesDrawn++
      scene.render()
    })
  },
}

if (new URLSearchParams(location.search).has('demo')) {
  window.__impasto.glop('Cadmium Red', -0.95, 0.55, 0.48)
  window.__impasto.glop('Hansa Yellow', 0.9, 0.5, 0.44)
  window.__impasto.glop('Ultramarine', 0.15, -1.05, 0.42)
  window.__impasto.glop('Titanium White', -0.85, -0.85, 0.36)
  window.__impasto.glop('Phthalo Green', 1.05, -0.55, 0.38)
  window.__impasto.step(6)
}

const fontLink = document.createElement('link')
fontLink.rel = 'stylesheet'
fontLink.href =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,650&family=Outfit:wght@400;500;600&display=swap'
document.head.append(fontLink)
