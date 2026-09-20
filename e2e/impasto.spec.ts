import { writeFile } from 'node:fs/promises'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

async function waitReady(page: Page) {
  await page.addInitScript(() => {
    const ready = Promise.resolve()
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      get: () => ({ ready, status: 'loaded', check: () => true, forEach: () => undefined }),
    })
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => typeof window.__impasto?.lookShot === 'function' && (window.__impasto.getFrameCount?.() ?? 0) >= 1,
    null,
    { timeout: 40_000 },
  )
  await expect(page.locator('#fail')).toBeHidden()
  await expect(page.locator('#canvas')).toBeVisible()
}

async function snap(page: Page, testInfo: TestInfo, name: string) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector('#canvas') as HTMLCanvasElement | null
    if (!canvas) throw new Error('missing canvas')
    return canvas.toDataURL('image/png')
  })
  const encoded = dataUrl.split(',')[1]
  if (!encoded) throw new Error('empty canvas snapshot')
  await writeFile(testInfo.outputPath(name), Buffer.from(encoded, 'base64'))
}

function wrapAngle(a: number): number {
  let d = a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

async function tapChip(page: Page, id: string) {
  await page.evaluate((shotId) => {
    const el = document.querySelector(`[data-shot="${shotId}"]`)
    if (!el) throw new Error(`missing chip ${shotId}`)
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0 }))
    window.__impasto!.lookShot(shotId)
  }, id)
}

function inHueRange(h: number, lo: number, hi: number): boolean {
  if (lo <= hi) return h >= lo && h <= hi
  return h >= lo || h <= hi
}

test.describe.configure({ mode: 'serial' })

test('loads a WebGL 3D scene, not a blank or fail overlay', async ({ page }, testInfo) => {
  await waitReady(page)
  expect(await page.evaluate(() => window.__impasto?.ready === true)).toBe(true)

  const canvasOk = await page.evaluate(() => {
    const canvas = document.querySelector('#canvas') as HTMLCanvasElement | null
    return !!canvas && canvas.width > 8 && canvas.height > 8
  })
  expect(canvasOk).toBe(true)

  const frame = await page.evaluate(() => window.__impasto!.sampleFrame())
  expect(frame.px).toBeGreaterThan(100)
  expect(frame.variance).toBeGreaterThan(8)

  await snap(page, testInfo, 'scene-boot.png')
})

test('camera chips steal the view in every direction', async ({ page }, testInfo) => {
  await waitReady(page)

  await tapChip(page, 'side')
  let cam = await page.evaluate(() => window.__impasto!.getCamera())
  expect(Math.abs(wrapAngle(cam.alpha - 0.05))).toBeLessThan(0.18)
  expect(Math.abs(cam.beta - 1.48)).toBeLessThan(0.18)
  await snap(page, testInfo, 'cam-side.png')

  await tapChip(page, 'top')
  cam = await page.evaluate(() => window.__impasto!.getCamera())
  expect(cam.beta).toBeLessThan(0.35)
  await snap(page, testInfo, 'cam-top.png')

  await tapChip(page, 'under')
  cam = await page.evaluate(() => window.__impasto!.getCamera())
  expect(cam.beta).toBeGreaterThan(2.1)
  await snap(page, testInfo, 'cam-under.png')

  await tapChip(page, 'front')
  cam = await page.evaluate(() => window.__impasto!.getCamera())
  expect(Math.abs(wrapAngle(cam.alpha - -Math.PI / 2))).toBeLessThan(0.2)

  await tapChip(page, 'back')
  cam = await page.evaluate(() => window.__impasto!.getCamera())
  expect(Math.abs(wrapAngle(cam.alpha - 2.35))).toBeLessThan(0.2)

  await tapChip(page, 'three')
})

test('Look tool and right-drag orbit the tray', async ({ page }) => {
  await waitReady(page)
  await page.evaluate(() => window.__impasto!.setToolName('look'))
  expect(await page.evaluate(() => window.__impasto!.getTool())).toBe('look')

  const box = await page.locator('#canvas').boundingBox()
  if (!box) throw new Error('canvas has no box')
  const x = box.x + box.width * 0.62
  const y = box.y + box.height * 0.38

  const before = await page.evaluate(() => window.__impasto!.getCamera())
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 120, y + 70, { steps: 1 })
  await page.mouse.up()
  await page.evaluate(() => window.__impasto!.waitFrames(2))
  const afterLook = await page.evaluate(() => window.__impasto!.getCamera())
  const lookMoved =
    Math.abs(wrapAngle(afterLook.alpha - before.alpha)) > 0.03 || Math.abs(afterLook.beta - before.beta) > 0.03
  expect(lookMoved).toBe(true)

  await page.evaluate(() => window.__impasto!.setToolName('glop'))
  const buttons = await page.evaluate(() => window.__impasto!.getOrbitButtons())
  expect(buttons.includes(2)).toBe(true)
  const preRight = await page.evaluate(() => window.__impasto!.getCamera())
  await page.evaluate(() => window.__impasto!.nudgeOrbit(160, 90))
  await page.evaluate(() => window.__impasto!.waitFrames(2))
  const afterRight = await page.evaluate(() => window.__impasto!.getCamera())
  const rightMoved =
    Math.abs(wrapAngle(afterRight.alpha - preRight.alpha)) > 0.03 || Math.abs(afterRight.beta - preRight.beta) > 0.03
  expect(rightMoved).toBe(true)
})

test('Glop dumps the selected swatch color', async ({ page }, testInfo) => {
  await waitReady(page)
  await page.evaluate(() => {
    const api = window.__impasto!
    api.scrape()
    api.setToolName('glop')
    api.glop('Cadmium Red', 0, 0, 0.55)
    api.step(10)
  })

  const red = await page.evaluate(() => window.__impasto!.getPaintStats())
  expect(red.filled).toBeGreaterThan(40)
  expect(red.meanRgb[0]).toBeGreaterThan(0.55)
  expect(red.meanRgb[0]).toBeGreaterThan(red.meanRgb[1] + 0.15)
  expect(red.meanRgb[0]).toBeGreaterThan(red.meanRgb[2] + 0.15)
  expect(await page.evaluate(() => window.__impasto!.getParticleCount())).toBeGreaterThan(10)
  await snap(page, testInfo, 'glop-red.png')

  await page.evaluate(() => {
    const api = window.__impasto!
    api.scrape()
    api.glop('Ultramarine', 0, 0, 0.55)
    api.step(10)
  })
  const blue = await page.evaluate(() => window.__impasto!.getPaintStats())
  expect(blue.filled).toBeGreaterThan(40)
  expect(blue.meanRgb[2]).toBeGreaterThan(0.45)
  expect(blue.meanRgb[2]).toBeGreaterThan(blue.meanRgb[0] + 0.1)
  await snap(page, testInfo, 'glop-blue.png')
})

test('Finger, Knife, and Stick fold paint and never dump color', async ({ page }, testInfo) => {
  await waitReady(page)
  await page.evaluate(() => window.__impasto!.scrape())
  await page.evaluate(() => window.__impasto!.step(2))

  for (const tool of ['finger', 'knife', 'stick'] as const) {
    await page.evaluate((kind) => {
      const api = window.__impasto!
      api.setToolName(kind)
      api.stir(0, 0, 0.25, 0.1, kind)
      api.step(4)
    }, tool)
    expect(await page.evaluate(() => window.__impasto!.getTool())).toBe(tool)
    expect(await page.evaluate(() => window.__impasto!.getParticleCount())).toBe(0)
    expect((await page.evaluate(() => window.__impasto!.getPaintStats())).filled).toBe(0)
  }

  await page.evaluate(() => {
    const api = window.__impasto!
    api.setToolName('glop')
    api.glop('Hansa Yellow', 0, 0, 0.55)
    api.step(10)
  })
  const afterGlop = await page.evaluate(() => ({
    n: window.__impasto!.getParticleCount(),
    paint: window.__impasto!.getPaintStats(),
  }))
  expect(afterGlop.n).toBeGreaterThan(10)
  expect(afterGlop.paint.meanRgb[0]).toBeGreaterThan(0.7)
  expect(afterGlop.paint.meanRgb[1]).toBeGreaterThan(0.55)

  await page.evaluate(() => {
    const api = window.__impasto!
    api.setToolName('knife')
    api.stir(0, 0, 0.4, 0.05, 'knife')
    api.step(8)
  })
  const afterFold = await page.evaluate(() => ({
    n: window.__impasto!.getParticleCount(),
    paint: window.__impasto!.getPaintStats(),
  }))
  expect(afterFold.n).toBe(afterGlop.n)
  expect(afterFold.paint.filled).toBeGreaterThan(20)
  await snap(page, testInfo, 'knife-fold.png')
})

test('KM mixing is subtractive: red+yellow orange, blue+yellow green', async ({ page }) => {
  await waitReady(page)

  const redYellow = await page.evaluate(() => window.__impasto!.mix('Cadmium Red', 'Hansa Yellow'))
  expect(redYellow.chroma).toBeGreaterThan(0.22)
  expect(inHueRange(redYellow.hue, 12, 55), `red+yellow hue ${redYellow.hue} rgb=${redYellow.rgb}`).toBe(true)
  expect(redYellow.rgb[0]).toBeGreaterThan(redYellow.rgb[2] + 0.12)

  const blueYellow = await page.evaluate(() => window.__impasto!.mix('Ultramarine', 'Hansa Yellow'))
  expect(blueYellow.chroma).toBeGreaterThan(0.12)
  expect(inHueRange(blueYellow.hue, 70, 165), `blue+yellow hue ${blueYellow.hue} rgb=${blueYellow.rgb}`).toBe(true)
  expect(blueYellow.rgb[1]).toBeGreaterThan(blueYellow.rgb[0])

  const ceruleanYellow = await page.evaluate(() => window.__impasto!.mix('Cerulean', 'Hansa Yellow'))
  expect(inHueRange(ceruleanYellow.hue, 70, 170), `cerulean+yellow hue ${ceruleanYellow.hue}`).toBe(true)

  const masstone = await page.evaluate(() => window.__impasto!.masstone('Cadmium Red'))
  expect(masstone[0]).toBeGreaterThan(0.7)
  expect(masstone[0]).toBeGreaterThan(masstone[1] + 0.3)
})

test('overlapping glops KM-mix in the paint map by mass, mix tools dump nothing', async ({ page }, testInfo) => {
  await waitReady(page)
  await page.evaluate(() => {
    const api = window.__impasto!
    api.scrape()
    api.step(2)
    api.glop('Cadmium Red', -0.12, 0, 0.62)
    api.glop('Hansa Yellow', 0.12, 0, 0.62)
    api.step(18)
  })

  const overlap = await page.evaluate(() => window.__impasto!.sample(0, 0))
  expect(overlap.a).toBeGreaterThan(0.04)
  const chroma = Math.max(overlap.r, overlap.g, overlap.b) - Math.min(overlap.r, overlap.g, overlap.b)
  expect(chroma).toBeGreaterThan(0.12)
  expect(overlap.r).toBeGreaterThan(overlap.b + 0.05)
  expect(overlap.g).toBeGreaterThan(overlap.b)
  await snap(page, testInfo, 'km-red-yellow-overlap.png')

  await page.evaluate(() => {
    const api = window.__impasto!
    api.scrape()
    api.step(2)
    api.glop('Ultramarine', -0.1, 0, 0.62)
    api.glop('Hansa Yellow', 0.1, 0, 0.62)
    api.step(18)
  })
  const greenMix = await page.evaluate(() => window.__impasto!.sample(0, 0))
  expect(greenMix.a).toBeGreaterThan(0.04)
  expect(greenMix.g).toBeGreaterThan(greenMix.r)
  await snap(page, testInfo, 'km-blue-yellow-overlap.png')

  await page.evaluate(() => window.__impasto!.scrape())
  await page.evaluate(() => window.__impasto!.step(2))
  for (const tool of ['finger', 'knife', 'stick'] as const) {
    await page.evaluate((kind) => {
      window.__impasto!.stir(0, 0, 0.2, 0.1, kind)
      window.__impasto!.step(4)
    }, tool)
    expect(await page.evaluate(() => window.__impasto!.liveCount())).toBe(0)
    expect((await page.evaluate(() => window.__impasto!.sample(0, 0))).a).toBe(0)
  }
})
