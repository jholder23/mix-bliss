import { Matrix, PointerEventTypes, Vector3 } from '@babylonjs/core'
import { MixAudio } from './audio'
import { PaintFluid } from './fluid'
import { SHOTS, createStudio } from './studio'
import { TUBES, hexToRgb, simFromViscosity, viscosityName } from './paints'
import type { Tube } from './paints'

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

const { engine, scene, camera, software, lookTo, setToolGhost, setLeftOrbit } = studio
const audio = new MixAudio()
let viscosity = 0.72
let feel = simFromViscosity(viscosity)
let fluid: PaintFluid
try {
  fluid = new PaintFluid(scene, feel, software)
  fluid.setLights(new Vector3(-0.35, -1.15, -0.28), new Vector3(0.2, -1, 0.35), new Vector3(0.55, 0.35, -0.45))
} catch (err) {
  fail.hidden = false
  const p = document.createElement('p')
  p.textContent = err instanceof Error ? err.message : 'Paint engine failed'
  fail.replaceChildren(p)
  throw err
}

let selected: Tube = TUBES[0] ?? { name: 'Cadmium Red', hex: '#d42a1e' }
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

function renderShots(): void {
  shotsEl.replaceChildren()
  for (const shot of SHOTS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'shot'
    btn.textContent = shot.label
    btn.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      lookTo(shot)
      hint.classList.add('gone')
    })
    shotsEl.append(btn)
  }
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
      fluid.glop(at, hexToRgb(selected.hex), size)
      lastDump = at.clone()
      audio.blob()
    }
  } else if (info.type === PointerEventTypes.POINTERMOVE && stirring) {
    const at = pickTray(scene.pointerX, scene.pointerY)
    if (!at || !prevPick) return
    const delta = at.subtract(prevPick)
    if (tool === 'glop') {
      if (!lastDump || Vector3.Distance(at, lastDump) > 0.55 + size * 0.4) {
        fluid.glop(at, hexToRgb(selected.hex), size * 0.85)
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

engine.runRenderLoop(() => scene.render())

renderSwatches()
renderShots()
setTool('glop')
viscLabel.textContent = viscosityName(viscosity)
size = Number(sizeEl.value) / 100
sizeLabel.textContent = sizeName(size)
fluid.setGloss(feel.gloss)

const fontLink = document.createElement('link')
fontLink.rel = 'stylesheet'
fontLink.href =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,650&family=Outfit:wght@400;500;600&display=swap'
document.head.append(fontLink)
