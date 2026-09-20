import { GRID, PAD, PaintSim, type KnifeStroke } from './mpm'
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
import { PaintRenderer, pointerToSim, simToUv, type KnifeDraw } from './render'

type Tool = 'glop' | 'scraper'

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
const blankBtn = must(document.querySelector<HTMLButtonElement>('#blank'), 'blank')
const toolButtons: Record<Tool, HTMLButtonElement> = {
  glop: must(document.querySelector<HTMLButtonElement>('#tool-glop'), 'glop'),
  scraper: must(document.querySelector<HTMLButtonElement>('#tool-scraper'), 'scraper'),
}

canvas.addEventListener('contextmenu', (event) => event.preventDefault())

let renderer: PaintRenderer
try {
  renderer = new PaintRenderer(canvas)
} catch (err) {
  fail.hidden = false
  const p = document.createElement('p')
  p.textContent = err instanceof Error ? err.message : 'WebGL2 unavailable'
  fail.replaceChildren(p)
  throw err
}

let viscosity = 0.76
let feel = feelFromSlider(viscosity)
const sim = new PaintSim(feel)
let selected: Tube = TUBES[0] ?? customTube('#d42a1e')
let tool: Tool = 'glop'
let size = 0.52
let customHex = '#7a3cff'
let lastDump: { x: number; y: number } | null = null
let prevPick: { x: number; y: number } | null = null
let pointerId: number | null = null
let scraping = false
let hover: { x: number; y: number } | null = null
let knifeAt: { x: number; y: number } | null = null
let knifePrev: { x: number; y: number } | null = null
let bladeDir = { x: 1, y: 0 }
let framesDrawn = 0
let raf = 0
let lastT = performance.now()

function sizeName(t: number): string {
  if (t < 0.34) return 'Dab'
  if (t < 0.62) return 'Bead'
  if (t < 0.82) return 'Glop'
  return 'Pile'
}

function glopRadius(): number {
  return 1.35 + size * 6.4
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
  if (next === 'glop') tubeName.textContent = `${selected.name} ready to glop.`
  else tubeName.textContent = 'Scraper folds paint. It never dumps color.'
  canvas.style.cursor = next === 'scraper' ? 'none' : 'crosshair'
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
    btn.setAttribute('aria-selected', tube.hex === selected.hex && selected.name === tube.name ? 'true' : 'false')
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

function hideHint(): void {
  hint.classList.add('gone')
}

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.max(1, canvas.clientWidth)
  const h = Math.max(1, canvas.clientHeight)
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
}

function pick(clientX: number, clientY: number): { x: number; y: number } | null {
  return pointerToSim(clientX, clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height)
}

function makeKnife(at: { x: number; y: number }, dx: number, dy: number): { stroke: KnifeStroke; draw: KnifeDraw } {
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
      x: at.x,
      y: at.y,
      dx,
      dy,
      length,
      width,
      strength: 1.45,
    },
    draw: {
      ax: a.u,
      ay: a.v,
      bx: b.u,
      by: b.v,
      width: (width * 0.38) / inner,
    },
  }
}

function onDown(event: PointerEvent): void {
  if (event.button !== 0 && event.pointerType === 'mouse') return
  const at = pick(event.clientX, event.clientY)
  if (!at) return
  canvas.setPointerCapture(event.pointerId)
  pointerId = event.pointerId
  prevPick = at
  hover = at
  hideHint()
  if (tool === 'glop') {
    if (sim.full) {
      tubeName.textContent = 'Tray is full. Blank it to keep mixing.'
      return
    }
    sim.glop(at.x, at.y, glopRadius(), selected.pigment)
    lastDump = at
  } else {
    scraping = true
    knifeAt = at
    knifePrev = at
  }
}

function onMove(event: PointerEvent): void {
  const at = pick(event.clientX, event.clientY)
  if (tool === 'scraper' && at) hover = at
  if (pointerId !== event.pointerId) return
  if (!at || !prevPick) return
  if (tool === 'glop') {
    const spacing = glopRadius() * 1.15
    if (!lastDump || Math.hypot(at.x - lastDump.x, at.y - lastDump.y) > spacing) {
      if (!sim.full) {
        sim.glop(at.x, at.y, glopRadius() * 0.88, selected.pigment)
        lastDump = at
      }
    }
  } else if (scraping) {
    knifeAt = at
  }
  prevPick = at
  hover = at
}

function onUp(event: PointerEvent): void {
  if (pointerId !== event.pointerId) return
  pointerId = null
  scraping = false
  prevPick = null
  lastDump = null
  knifeAt = null
  knifePrev = null
  try {
    canvas.releasePointerCapture(event.pointerId)
  } catch {
    /* already released */
  }
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
  sim.scrape()
  hint.textContent = 'Tray blanked. Pick a tube and glop a still bead.'
  hint.classList.remove('gone')
  setTool('glop')
})

viscosityEl.addEventListener('input', () => {
  viscosity = Number(viscosityEl.value) / 100
  feel = feelFromSlider(viscosity)
  sim.setFeel(feel)
  viscLabel.textContent = viscosityName(viscosity)
})

sizeEl.addEventListener('input', () => {
  size = Number(sizeEl.value) / 100
  sizeLabel.textContent = sizeName(size)
})

window.addEventListener('resize', resize)

function knifeDraw(): KnifeDraw {
  if (tool !== 'scraper' || !hover) return null
  const dx = scraping && prevPick ? hover.x - prevPick.x : bladeDir.x
  const dy = scraping && prevPick ? hover.y - prevPick.y : bladeDir.y
  return makeKnife(hover, dx, dy).draw
}

function frame(now: number): void {
  raf = requestAnimationFrame(frame)
  const dt = Math.min(0.033, (now - lastT) / 1000)
  lastT = now
  resize()
  if (scraping && knifeAt && knifePrev) {
    const dx = knifeAt.x - knifePrev.x
    const dy = knifeAt.y - knifePrev.y
    sim.step(dt, makeKnife(knifeAt, dx, dy).stroke)
    knifePrev = knifeAt
  } else {
    sim.step(dt, null)
  }
  renderer.draw(sim, knifeDraw(), canvas.width, canvas.height)
  framesDrawn++
}

resize()
renderSwatches()
setTool('glop')
viscLabel.textContent = viscosityName(viscosity)
size = Number(sizeEl.value) / 100
sizeLabel.textContent = sizeName(size)
raf = requestAnimationFrame(frame)

function resolveTube(nameOrHex: string): Tube {
  const named = tubeByName(nameOrHex)
  if (named) return named
  if (nameOrHex.startsWith('#')) return customTube(nameOrHex)
  throw new Error(`Unknown tube ${nameOrHex}`)
}

window.__impasto = {
  ready: true,
  getTool: () => tool,
  getSelected: () => ({ name: selected.name, hex: selected.hex }),
  getParticleCount: () => sim.count,
  sleeping: () => sim.sleeping,
  scrape() {
    sim.scrape()
  },
  glop(name, x, y, dumpSize = 0.55) {
    const tube = resolveTube(name)
    const radius = 1.35 + dumpSize * 6.4
    sim.glop(x, y, radius, tube.pigment)
  },
  stir(x, y, dx, dy) {
    const { length, width } = scraperSize()
    sim.step(1 / 60, { x, y, dx, dy, length, width, strength: 1.45 })
  },
  step(frames = 8) {
    for (let i = 0; i < frames; i++) sim.step(1 / 60, null)
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
  pause() {
    cancelAnimationFrame(raf)
  },
  resume() {
    lastT = performance.now()
    raf = requestAnimationFrame(frame)
  },
}

if (new URLSearchParams(location.search).has('demo')) {
  window.__impasto.glop('Cadmium Red', 28, 48, 0.48)
  window.__impasto.glop('Hansa Yellow', 52, 48, 0.44)
  window.__impasto.glop('Ultramarine', 40, 32, 0.42)
}

declare global {
  interface Window {
    __impasto: {
      ready: boolean
      getTool: () => string
      getSelected: () => { name: string; hex: string }
      getParticleCount: () => number
      sleeping: () => boolean
      scrape: () => void
      glop: (name: string, x: number, y: number, dumpSize?: number) => void
      stir: (x: number, y: number, dx: number, dy: number) => void
      step: (frames?: number) => void
      mix: (
        a: string,
        b: string,
        amountA?: number,
        amountB?: number,
      ) => { rgb: [number, number, number]; hue: number; chroma: number; lightness: number }
      masstone: (name: string) => [number, number, number]
      getFrameCount: () => number
      pause: () => void
      resume: () => void
    }
  }
}
