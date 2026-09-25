import { GRID, PAD, PaintSim, type Stroke } from './mpm'
import {
  TUBES,
  customTube,
  feelFromSlider,
  masstoneSrgb,
  mixTubePaints,
  tubeByName,
  viscosityName,
  type Tube,
} from './paints'
import { srgbHueChroma } from './km'
import { PaintRenderer, pointerToSim, simToUv, type ToolDraw } from './render'

type Tool = 'finger' | 'scraper'

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
const statusEl = must(document.querySelector<HTMLParagraphElement>('#status'), 'status')
const blankBtn = must(document.querySelector<HTMLButtonElement>('#blank'), 'blank')
const toolButtons: Record<Tool, HTMLButtonElement> = {
  finger: must(document.querySelector<HTMLButtonElement>('#tool-finger'), 'finger'),
  scraper: must(document.querySelector<HTMLButtonElement>('#tool-scraper'), 'scraper'),
}

canvas.addEventListener('contextmenu', (event) => event.preventDefault())
preventPageGestures()

let renderer: PaintRenderer
try {
  renderer = new PaintRenderer(canvas)
} catch (err) {
  fail.hidden = false
  const message = err instanceof Error ? err.message : 'WebGL2 unavailable'
  fail.replaceChildren(
    Object.assign(document.createElement('h1'), { textContent: 'Mix Bliss needs WebGL2' }),
    Object.assign(document.createElement('p'), { textContent: message }),
  )
  throw err
}

let viscosity = Number(viscosityEl.value) / 100
let feel = feelFromSlider(viscosity)
const sim = new PaintSim(feel)
let selected: Tube = TUBES[0] ?? customTube('#d42a1e')
let tool: Tool = 'finger'
let size = Number(sizeEl.value) / 100
let pointerId: number | null = null
let smearing = false
let pendingDump: { x: number; y: number } | null = null
let holdTimer = 0
let hover: { x: number; y: number } | null = null
let strokeAt: { x: number; y: number } | null = null
let strokePrev: { x: number; y: number } | null = null
let downClient = { x: 0, y: 0 }
let bladeDir = { x: 1, y: 0 }
let framesDrawn = 0
let raf = 0
let lastT = performance.now()
let statusDirty = true

function sizeName(t: number): string {
  if (t < 0.34) return 'Dab'
  if (t < 0.62) return 'Bead'
  if (t < 0.82) return 'Glop'
  return 'Pile'
}

function glopRadius(): number {
  return 1.35 + size * 6.4
}

function fingerRadius(): number {
  return 1.7 + size * 3.6
}

function scraperSize(): { length: number; width: number } {
  return {
    length: 4.4 + size * 8.2,
    width: 0.52 + size * 0.92,
  }
}

function setTool(next: Tool): void {
  tool = next
  for (const [name, btn] of Object.entries(toolButtons)) {
    const on = name === next
    btn.classList.toggle('on', on)
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
  canvas.style.cursor = next === 'scraper' ? 'none' : 'crosshair'
  statusDirty = true
}

function renderSwatches(): void {
  swatchesEl.replaceChildren()
  for (const tube of TUBES) {
    const btn = document.createElement('button')
    btn.className = 'swatch'
    btn.type = 'button'
    btn.title = tube.name
    btn.setAttribute('role', 'option')
    btn.setAttribute('aria-label', tube.name)
    btn.setAttribute('data-tube', tube.name)
    btn.setAttribute('aria-selected', tube.name === selected.name ? 'true' : 'false')
    btn.style.background = tube.hex
    btn.addEventListener('click', () => {
      selected = tube
      renderSwatches()
      statusDirty = true
    })
    swatchesEl.append(btn)
  }
  statusDirty = true
}

function hideHint(): void {
  hint.classList.add('gone')
}

function writeStatus(): void {
  if (!statusDirty) return
  const feelName = viscosityName(viscosity)
  const motion = sim.count === 0 ? 'blank tray' : sim.sleeping ? 'still' : 'wet'
  const toolLine = tool === 'finger' ? 'finger smears, never dumps' : 'scraper folds, never dumps'
  statusEl.textContent = `${selected.name} · ${feelName} · ${motion} · ${toolLine}`
  statusDirty = false
}

function resize(): boolean {
  const cap = renderer.software ? 1 : Math.min(2, window.devicePixelRatio || 1)
  const w = Math.max(1, canvas.clientWidth)
  const h = Math.max(1, canvas.clientHeight)
  const pw = Math.round(w * cap)
  const ph = Math.round(h * cap)
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
    return true
  }
  return false
}

function pick(clientX: number, clientY: number): { x: number; y: number } {
  return pointerToSim(clientX, clientY, canvas.getBoundingClientRect())
}

function makeStroke(at: { x: number; y: number }, dx: number, dy: number): { stroke: Stroke; draw: ToolDraw } {
  if (tool === 'finger') {
    const radius = fingerRadius()
    const uv = simToUv(at.x, at.y)
    const inner = GRID - 2 * PAD
    return {
      stroke: {
        kind: 'finger',
        x: at.x,
        y: at.y,
        dx,
        dy,
        strength: 1.2,
        length: 0,
        width: 0,
        radius,
      },
      draw: {
        kind: 'finger',
        ax: uv.u,
        ay: uv.v,
        bx: uv.u,
        by: uv.v,
        width: (radius * 0.42) / inner,
      },
    }
  }

  const { length, width } = scraperSize()
  const speed = Math.hypot(dx, dy)
  if (speed > 1e-4) {
    bladeDir.x = dx / speed
    bladeDir.y = dy / speed
  }
  const bx = -bladeDir.y
  const by = bladeDir.x
  const a = simToUv(at.x - bx * length * 0.5, at.y - by * length * 0.5)
  const b = simToUv(at.x + bx * length * 0.5, at.y + by * length * 0.5)
  const inner = GRID - 2 * PAD
  return {
    stroke: {
      kind: 'scraper',
      x: at.x,
      y: at.y,
      dx,
      dy,
      strength: 1.45,
      length,
      width,
      radius: 0,
    },
    draw: {
      kind: 'scraper',
      ax: a.u,
      ay: a.v,
      bx: b.u,
      by: b.v,
      width: (width * 0.38) / inner,
    },
  }
}

function dumpAt(at: { x: number; y: number }): void {
  if (sim.full) {
    statusEl.textContent = 'Tray is full. Blank it to keep mixing.'
    statusDirty = false
    return
  }
  sim.glop(at.x, at.y, glopRadius(), selected.pigment)
  hideHint()
  statusDirty = true
  wake()
}

function cancelHold(): void {
  if (holdTimer) {
    window.clearTimeout(holdTimer)
    holdTimer = 0
  }
}

function onDown(event: PointerEvent): void {
  if (event.button !== 0 && event.pointerType === 'mouse') return
  event.preventDefault()
  const at = pick(event.clientX, event.clientY)
  canvas.setPointerCapture(event.pointerId)
  pointerId = event.pointerId
  hover = at
  downClient = { x: event.clientX, y: event.clientY }
  pendingDump = at
  smearing = false
  strokeAt = at
  strokePrev = at
  cancelHold()
  holdTimer = window.setTimeout(() => {
    if (pendingDump && !smearing) {
      dumpAt(pendingDump)
      pendingDump = null
    }
    holdTimer = 0
  }, 110)
  wake()
}

function onMove(event: PointerEvent): void {
  const at = pick(event.clientX, event.clientY)
  hover = at
  if (pointerId !== event.pointerId) {
    if (tool === 'scraper') wake()
    return
  }
  const drag = Math.hypot(event.clientX - downClient.x, event.clientY - downClient.y)
  if (drag > 8) {
    smearing = true
    pendingDump = null
    cancelHold()
    hideHint()
  }
  strokeAt = at
  wake()
}

function onUp(event: PointerEvent): void {
  if (pointerId !== event.pointerId) return
  if (pendingDump && !smearing) dumpAt(pendingDump)
  pointerId = null
  smearing = false
  pendingDump = null
  strokeAt = null
  strokePrev = null
  cancelHold()
  try {
    canvas.releasePointerCapture(event.pointerId)
  } catch {
    /* already released */
  }
  statusDirty = true
  wake()
}

canvas.addEventListener('pointerdown', onDown)
canvas.addEventListener('pointermove', onMove)
canvas.addEventListener('pointerup', onUp)
canvas.addEventListener('pointercancel', onUp)
canvas.addEventListener('pointerleave', () => {
  if (pointerId === null) hover = null
})

for (const name of Object.keys(toolButtons) as Tool[]) {
  toolButtons[name].addEventListener('click', () => setTool(name))
}

blankBtn.addEventListener('click', () => {
  sim.clear()
  hint.textContent = 'Tray blanked. Pick a tube and tap a still bead onto the porcelain.'
  hint.classList.remove('gone')
  statusDirty = true
  wake()
})

viscosityEl.addEventListener('input', () => {
  viscosity = Number(viscosityEl.value) / 100
  feel = feelFromSlider(viscosity)
  sim.setFeel(feel)
  viscLabel.textContent = viscosityName(viscosity)
  statusDirty = true
})

sizeEl.addEventListener('input', () => {
  size = Number(sizeEl.value) / 100
  sizeLabel.textContent = sizeName(size)
})

window.addEventListener('resize', () => {
  wake()
})

function toolDraw(): ToolDraw {
  if (!hover) return null
  if (tool === 'finger' && !smearing && pointerId === null) return null
  const dx = smearing && strokePrev ? hover.x - strokePrev.x : bladeDir.x
  const dy = smearing && strokePrev ? hover.y - strokePrev.y : bladeDir.y
  return makeStroke(hover, dx, dy).draw
}

function frame(now: number): void {
  raf = 0
  const dt = Math.min(0.033, (now - lastT) / 1000)
  lastT = now
  const resized = resize()
  let stroke: Stroke | null = null
  if (smearing && strokeAt && strokePrev) {
    const dx = strokeAt.x - strokePrev.x
    const dy = strokeAt.y - strokePrev.y
    stroke = makeStroke(strokeAt, dx, dy).stroke
    strokePrev = strokeAt
  }
  sim.step(dt, stroke)
  renderer.draw(sim, toolDraw(), canvas.width, canvas.height, resized)
  framesDrawn++
  statusDirty = true
  writeStatus()

  const live = !sim.sleeping || smearing || pointerId !== null || (tool === 'scraper' && hover !== null)
  if (live) {
    raf = requestAnimationFrame(frame)
  }
}

function wake(): void {
  statusDirty = true
  if (raf) return
  lastT = performance.now()
  raf = requestAnimationFrame(frame)
}

function preventPageGestures(): void {
  const block = (event: Event) => event.preventDefault()
  document.addEventListener('gesturestart', block, { passive: false })
  document.addEventListener('gesturechange', block, { passive: false })
  document.addEventListener('gestureend', block, { passive: false })
  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1) event.preventDefault()
    },
    { passive: false },
  )
  document.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) event.preventDefault()
    },
    { passive: false },
  )
}

resize()
renderSwatches()
setTool('finger')
viscLabel.textContent = viscosityName(viscosity)
sizeLabel.textContent = sizeName(size)
writeStatus()
wake()

function resolveTube(nameOrHex: string): Tube {
  const named = tubeByName(nameOrHex)
  if (named) return named
  if (nameOrHex.startsWith('#')) return customTube(nameOrHex)
  throw new Error(`Unknown tube ${nameOrHex}`)
}

window.__mixbliss = {
  ready: true,
  getTool: () => tool,
  getSelected: () => ({ name: selected.name, hex: selected.hex }),
  getParticleCount: () => sim.count,
  sleeping: () => sim.sleeping,
  blank() {
    sim.clear()
    statusDirty = true
    wake()
  },
  glop(name, x, y, dumpSize = 0.55) {
    const tube = resolveTube(name)
    const radius = 1.35 + dumpSize * 6.4
    sim.glop(x, y, radius, tube.pigment)
    statusDirty = true
    wake()
  },
  smear(x, y, dx, dy) {
    sim.step(1 / 60, {
      kind: tool,
      x,
      y,
      dx,
      dy,
      strength: tool === 'finger' ? 1.2 : 1.45,
      length: scraperSize().length,
      width: scraperSize().width,
      radius: fingerRadius(),
    })
    wake()
  },
  step(frames = 8) {
    for (let i = 0; i < frames; i++) sim.step(1 / 60, null)
    wake()
  },
  mix(a, b, amountA = 1, amountB = 1) {
    const rgb = mixTubePaints(resolveTube(a), resolveTube(b), amountA, amountB)
    const hc = srgbHueChroma(rgb)
    return { rgb, hue: hc.h, chroma: hc.c, lightness: hc.l }
  },
  masstone(name) {
    return masstoneSrgb(resolveTube(name))
  },
  getFrameCount: () => framesDrawn,
}

if (new URLSearchParams(location.search).has('demo')) {
  window.__mixbliss.glop('Cadmium Red', 28, 48, 0.48)
  window.__mixbliss.glop('Hansa Yellow', 52, 48, 0.44)
  window.__mixbliss.glop('Ultramarine', 40, 32, 0.42)
}

declare global {
  interface Window {
    __mixbliss: {
      ready: boolean
      getTool: () => string
      getSelected: () => { name: string; hex: string }
      getParticleCount: () => number
      sleeping: () => boolean
      blank: () => void
      glop: (name: string, x: number, y: number, dumpSize?: number) => void
      smear: (x: number, y: number, dx: number, dy: number) => void
      step: (frames?: number) => void
      mix: (
        a: string,
        b: string,
        amountA?: number,
        amountB?: number,
      ) => { rgb: [number, number, number]; hue: number; chroma: number; lightness: number }
      masstone: (name: string) => [number, number, number]
      getFrameCount: () => number
    }
  }
}
