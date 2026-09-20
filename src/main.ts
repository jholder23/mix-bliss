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
  const radius = feel.dyeRadius * (0.85 + Math.random() * 0.55) * scale
  engine.splatPaint(uv, color, radius, 1.7)
  const offset: [number, number] = [
    uv[0] + (Math.random() - 0.5) * radius * 0.35,
    uv[1] + (Math.random() - 0.5) * radius * 0.35,
  ]
  engine.splatPaint(offset, color, radius * 0.55, 0.55)
  engine.nudgeRadial(uv, [(Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.06], radius * 0.8, 0.12, 0.4)
  audio.blob()
  if (navigator.vibrate) navigator.vibrate(10)
}

function pour(): void {
  const count = 5 + Math.floor(Math.random() * 3)
  for (let i = 0; i < count; i++) {
    const tube = TUBES[Math.floor(Math.random() * TUBES.length)] ?? { name: 'Cadmium Red', hex: '#d42a1e' }
    const uv: [number, number] = [0.28 + Math.random() * 0.44, 0.34 + Math.random() * 0.36]
    dropBlob(uv, hexToRgb(tube.hex), 1.05 + Math.random() * 1.15)
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
  engine.displaceHeight(uv, feel.fingerRadius, feel.fingerDepth * 0.18)
  engine.nudgeRadial(uv, [0, 0], feel.fingerRadius, feel.fingerPush * 0.35, 0)
  if (loadedFinger) {
    engine.splatPaint(uv, hexToRgb(selected.hex), feel.dyeRadius * 0.45, 0.38)
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
    const steps = Math.max(1, Math.ceil(dist / (feel.fingerRadius * 0.22)))
    const depth = (feel.fingerDepth * 0.2) / steps
    const push = (feel.fingerPush * 0.7) / steps
    const drag = feel.splatForce
    const color = hexToRgb(selected.hex)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const p: [number, number] = [stroke.prev[0] + dx * t, stroke.prev[1] + dy * t]
      engine.displaceHeight(p, feel.fingerRadius, depth)
      engine.nudgeRadial(p, [dx, dy], feel.fingerRadius, push, drag)
      if (loadedFinger) {
        engine.splatPaint(p, color, feel.dyeRadius * 0.32, 0.16 / steps)
      }
    }
    audio.stir(dist * 22)
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
  const fingers: { uv: [number, number]; radius: number }[] = []
  for (const stroke of strokes.values()) {
    if (stroke.prev) fingers.push({ uv: stroke.prev, radius: feel.fingerRadius })
  }
  engine.setFingers(fingers, hexToRgb(selected.hex))
  engine.step(dt)
  engine.render(light, now * 0.001)
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
