import { MixAudio } from './audio'
import { PaintEngine } from './engine'
import { TUBES, feelFromViscosity, hexToRgb, viscosityName } from './paints'
import type { Tube } from './paints'

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
const fingerBtn = must(document.querySelector<HTMLButtonElement>('#finger'), 'finger')
const pourBtn = must(document.querySelector<HTMLButtonElement>('#pour'), 'pour')
const scrapeBtn = must(document.querySelector<HTMLButtonElement>('#scrape'), 'scrape')
const soundBtn = must(document.querySelector<HTMLButtonElement>('#sound'), 'sound')

let engine: PaintEngine
try {
  engine = new PaintEngine(canvas, feelFromViscosity(0.72))
} catch {
  fail.hidden = false
  throw new Error('WebGL2 unavailable')
}

const audio = new MixAudio()
let viscosity = 0.72
let feel = feelFromViscosity(viscosity)
let selected: Tube = TUBES[0] ?? { name: 'Cadmium Red', hex: '#d42a1e' }
let loadedFinger = true
let customHex = '#7a3cff'

type Stroke = {
  id: number
  prev: [number, number] | null
  moved: number
  started: number
}

const strokes = new Map<number, Stroke>()
let light: [number, number] = [0.42, 0.68]
let lastFrame = performance.now()

function toUv(event: PointerEvent): [number, number] {
  const rect = canvas.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width
  const y = 1 - (event.clientY - rect.top) / rect.height
  return [x, y]
}

function dropBlob(uv: [number, number], color = hexToRgb(selected.hex), scale = 1): void {
  const radius = feel.dyeRadius * (1.35 + Math.random() * 0.8) * scale
  engine.splatPaint(uv, color, radius, 1.15)
  engine.splatVelocity(uv, [(Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.08], radius * 0.7)
  audio.blob()
  if (navigator.vibrate) navigator.vibrate(8)
}

function pour(): void {
  const count = 7 + Math.floor(Math.random() * 4)
  for (let i = 0; i < count; i++) {
    const tube = TUBES[Math.floor(Math.random() * TUBES.length)]
    const uv: [number, number] = [0.18 + Math.random() * 0.64, 0.22 + Math.random() * 0.52]
    dropBlob(uv, hexToRgb(tube.hex), 0.9 + Math.random() * 1.3)
  }
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
  strokes.set(event.pointerId, { id: event.pointerId, prev: uv, moved: 0, started: performance.now() })
  if (loadedFinger) {
    engine.splatPaint(uv, hexToRgb(selected.hex), feel.dyeRadius * 0.85, 0.55)
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
    stroke.moved += Math.hypot(dx, dy)
    const dt = Math.max(1 / 120, 1 / 60)
    const force = feel.splatForce
    engine.splatVelocity(uv, [(dx / dt) * force, (dy / dt) * force], feel.velocityRadius)
    if (loadedFinger) {
      engine.splatPaint(uv, hexToRgb(selected.hex), feel.dyeRadius * 0.55, 0.42)
    }
    audio.stir(Math.hypot(dx, dy) * 18)
  }
  stroke.prev = uv
})

function endStroke(event: PointerEvent): void {
  const stroke = strokes.get(event.pointerId)
  strokes.delete(event.pointerId)
  if (!stroke) return
  const elapsed = performance.now() - stroke.started
  if (stroke.moved < 0.018 && elapsed < 280) {
    dropBlob(toUv(event))
  }
}

canvas.addEventListener('pointerup', endStroke)
canvas.addEventListener('pointercancel', endStroke)
canvas.addEventListener('contextmenu', (event) => event.preventDefault())

fingerBtn.addEventListener('click', () => {
  loadedFinger = !loadedFinger
  fingerBtn.classList.toggle('on', loadedFinger)
  fingerBtn.setAttribute('aria-pressed', loadedFinger ? 'true' : 'false')
  fingerBtn.textContent = loadedFinger ? 'Finger: loaded' : 'Finger: clean'
})

pourBtn.addEventListener('click', () => {
  pour()
  hideHint()
})

scrapeBtn.addEventListener('click', () => {
  engine.scrape()
  hint.textContent = 'Canvas scraped. Pour, or tap to blob.'
  hint.classList.remove('gone')
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
  engine.step(dt)
  engine.render(light)
  requestAnimationFrame(frame)
}

renderSwatches()
applyViscosity(Number(viscosityEl.value) / 100)
engine.resize()
pour()
requestAnimationFrame(frame)

const fontLink = document.createElement('link')
fontLink.rel = 'stylesheet'
fontLink.href =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,650&family=Outfit:wght@400;500;600&display=swap'
document.head.append(fontLink)
