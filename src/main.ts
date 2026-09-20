import { MixAudio } from './audio'
import { PaintEngine } from './engine'
import { TUBES, feelFromViscosity, hexToRgb, viscosityName } from './paints'
import type { Tube } from './paints'

type Tool = 'glop' | 'finger' | 'knife' | 'stick'

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
const toolButtons = {
  glop: must(document.querySelector<HTMLButtonElement>('#tool-glop'), 'glop'),
  finger: must(document.querySelector<HTMLButtonElement>('#tool-finger'), 'finger'),
  knife: must(document.querySelector<HTMLButtonElement>('#tool-knife'), 'knife'),
  stick: must(document.querySelector<HTMLButtonElement>('#tool-stick'), 'stick'),
}

let engine: PaintEngine
try {
  engine = new PaintEngine(canvas, feelFromViscosity(0.72))
} catch (err) {
  fail.hidden = false
  const detail = err instanceof Error ? err.message : 'WebGL2 unavailable'
  fail.replaceChildren()
  const p = document.createElement('p')
  p.textContent = detail
  fail.append(p)
  throw err
}

const audio = new MixAudio()
let viscosity = 0.72
let feel = feelFromViscosity(viscosity)
let selected: Tube = TUBES[0] ?? { name: 'Cadmium Red', hex: '#d42a1e' }
let tool: Tool = 'glop'
let size = 0.52
let customHex = '#7a3cff'

type Stroke = {
  id: number
  prev: [number, number] | null
  moved: number
  started: number
  lastDump: [number, number]
  dir: [number, number]
}

const strokes = new Map<number, Stroke>()
let light: [number, number] = [0.42, 0.68]
let lastFrame = performance.now()

function sizeName(t: number): string {
  if (t < 0.34) return 'Dab'
  if (t < 0.62) return 'Medium'
  if (t < 0.82) return 'Glop'
  return 'Dump'
}

function toolRadius(): number {
  if (tool === 'stick') return feel.fingerRadius * 0.32 * (0.55 + size)
  if (tool === 'knife') return feel.fingerRadius * 0.82 * (0.65 + size * 0.45)
  if (tool === 'glop') return feel.dyeRadius * (0.42 + size * 0.88)
  return feel.fingerRadius * (0.62 + size * 0.55)
}

function toUv(event: PointerEvent): [number, number] {
  const rect = canvas.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width
  const y = 1 - (event.clientY - rect.top) / rect.height
  return [x, y]
}

function glopAt(uv: [number, number], strength: number): void {
  engine.splatPaint(uv, hexToRgb(selected.hex), toolRadius(), strength)
}

function mixAt(uv: [number, number], delta: [number, number], steps: number): void {
  const radius = toolRadius()
  const depthScale = tool === 'knife' ? 0.58 : tool === 'stick' ? 0.2 : 0.34
  const pushScale = tool === 'knife' ? 0.16 : tool === 'stick' ? 0.95 : 0.72
  const dragScale = tool === 'knife' ? 0.55 : 0.62
  const depth = (feel.fingerDepth * depthScale) / steps
  const push = (feel.fingerPush * pushScale) / steps
  const drag = feel.splatForce * dragScale
  if (tool === 'knife') {
    const len = radius * 0.82
    const width = radius * 0.16
    engine.displaceBlade(uv, delta, len, width, depth)
    engine.nudgeBlade(uv, delta, delta, len, width, push, drag)
    return
  }
  engine.displaceHeight(uv, radius, depth)
  engine.nudgeRadial(uv, delta, radius, push, drag)
}

function setTool(next: Tool): void {
  tool = next
  for (const [name, btn] of Object.entries(toolButtons)) {
    const on = name === next
    btn.classList.toggle('on', on)
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
  tubeName.textContent =
    next === 'glop' ? `${selected.name} ready to glop.` : `${next} folds paint. It does not dump color.`
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
    selected = { name: 'Custom', hex: customHex }
    renderSwatches()
  })
  wrap.append(picker)
  if (selected.name === 'Custom') wrap.style.borderColor = '#fff'
  swatchesEl.append(wrap)
  if (tool === 'glop') tubeName.textContent = `${selected.name} ready to glop.`
}

function applyViscosity(raw: number): void {
  viscosity = raw
  feel = feelFromViscosity(viscosity)
  engine.setFeel(feel)
  viscLabel.textContent = viscosityName(viscosity)
  audio.setViscosity(viscosity)
}

function hideHint(): void {
  hint.classList.add('gone')
}

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  canvas.setPointerCapture(event.pointerId)
  const uv = toUv(event)
  light = uv
  strokes.set(event.pointerId, {
    id: event.pointerId,
    prev: uv,
    moved: 0,
    started: performance.now(),
    lastDump: uv,
    dir: [1, 0],
  })
  canvas.style.cursor = 'none'
  if (tool === 'glop') {
    glopAt(uv, 1.7 + size * 0.95)
    audio.blob()
    if (navigator.vibrate) navigator.vibrate(8)
  }
  hideHint()
})

canvas.addEventListener('pointermove', (event) => {
  if (!strokes.has(event.pointerId)) return
  event.preventDefault()
  const stroke = strokes.get(event.pointerId)
  if (!stroke) return
  const uv = toUv(event)
  light = uv
  if (stroke.prev) {
    const dx = uv[0] - stroke.prev[0]
    const dy = uv[1] - stroke.prev[1]
    const dist = Math.hypot(dx, dy)
    stroke.moved += dist
    if (dist > 1e-5) stroke.dir = [dx, dy]
    const radius = toolRadius()
    const steps = Math.max(1, Math.ceil(dist / (radius * 0.28)))
    if (tool === 'glop') {
      const gap = Math.hypot(uv[0] - stroke.lastDump[0], uv[1] - stroke.lastDump[1])
      if (gap > toolRadius() * 0.85) {
        glopAt(uv, 1.35 + size * 0.7)
        stroke.lastDump = uv
        audio.blob()
      }
    } else if (dist > 0.003) {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const p: [number, number] = [stroke.prev[0] + dx * t, stroke.prev[1] + dy * t]
        mixAt(p, [dx, dy], steps)
      }
      audio.stir(dist * 22)
    }
  }
  stroke.prev = uv
})

function endStroke(event: PointerEvent): void {
  strokes.delete(event.pointerId)
  if (strokes.size === 0) canvas.style.cursor = 'crosshair'
}

canvas.addEventListener('pointerup', endStroke)
canvas.addEventListener('pointercancel', endStroke)
canvas.addEventListener('contextmenu', (event) => event.preventDefault())

for (const name of Object.keys(toolButtons) as Tool[]) {
  toolButtons[name].addEventListener('click', () => setTool(name))
}

scrapeBtn.addEventListener('click', () => {
  engine.scrape()
  hint.textContent = 'Tray scraped. Pick a color and glop.'
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
  applyViscosity(Number(viscosityEl.value) / 100)
})

sizeEl.addEventListener('input', () => {
  size = Number(sizeEl.value) / 100
  sizeLabel.textContent = sizeName(size)
})

window.addEventListener(
  'touchmove',
  (event) => {
    event.preventDefault()
  },
  { passive: false },
)

window.addEventListener('resize', () => engine.resize())

function frame(now: number): void {
  const dt = Math.min(0.033, (now - lastFrame) / 1000)
  lastFrame = now
  const fingers: { uv: [number, number]; radius: number }[] = []
  let overlayKind = 0
  let overlayUv: [number, number] = [0, 0]
  let overlayRadius = 0
  let overlayDir: [number, number] = [1, 0]
  if (tool === 'finger') {
    for (const stroke of strokes.values()) {
      if (stroke.prev) fingers.push({ uv: stroke.prev, radius: toolRadius() })
    }
  } else if (tool === 'knife' || tool === 'stick') {
    for (const stroke of strokes.values()) {
      if (!stroke.prev) continue
      overlayKind = tool === 'knife' ? 2 : 3
      overlayUv = stroke.prev
      overlayRadius = toolRadius()
      overlayDir = stroke.dir
      break
    }
  }
  engine.setFingers(fingers, hexToRgb(selected.hex))
  engine.setTool(overlayKind, overlayUv, overlayRadius, overlayDir)
  engine.step(dt)
  engine.render(light, now * 0.001)
  requestAnimationFrame(frame)
}

renderSwatches()
applyViscosity(Number(viscosityEl.value) / 100)
size = Number(sizeEl.value) / 100
sizeLabel.textContent = sizeName(size)
engine.resize()
requestAnimationFrame(frame)

const fontLink = document.createElement('link')
fontLink.rel = 'stylesheet'
fontLink.href =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,650&family=Outfit:wght@400;500;600&display=swap'
document.head.append(fontLink)
