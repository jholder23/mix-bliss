import { expect, test, type Page } from '@playwright/test'

async function waitReady(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__impasto?.ready === true, null, { timeout: 25_000 })
  await expect(page.locator('#fail')).toBeHidden()
  await expect(page.locator('#canvas')).toBeVisible()
  await page.evaluate(() => window.__impasto!.waitFrames(2))
}

function wrapAngle(a: number): number {
  let d = a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

async function waitSettled(page: Page) {
  await page.waitForFunction(() => {
    const cam = window.__impasto?.getCamera()
    return !!cam && cam.settling === false
  }, null, { timeout: 8_000 })
  await page.evaluate(() => window.__impasto!.waitFrames(1))
}

async function clickDish(page: Page) {
  const { x, y } = await page.evaluate(() => window.__impasto!.getDishScreen())
  await page.mouse.click(x, y)
}

function inHueRange(h: number, lo: number, hi: number): boolean {
  if (lo <= hi) return h >= lo && h <= hi
  return h >= lo || h <= hi
}

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

  await page.screenshot({ path: testInfo.outputPath('scene-boot.png'), fullPage: true })
})

test('camera chips steal the view in every direction', async ({ page }, testInfo) => {
  await waitReady(page)

  await page.locator('[data-shot="side"]').click()
  await waitSettled(page)
  let cam = await page.evaluate(() => window.__impasto!.getCamera())
  expect(Math.abs(wrapAngle(cam.alpha - 0.05))).toBeLessThan(0.18)
  expect(Math.abs(cam.beta - 1.48)).toBeLessThan(0.18)
  await page.screenshot({ path: testInfo.outputPath('cam-side.png') })

  await page.locator('[data-shot="top"]').click()
  await waitSettled(page)
  cam = await page.evaluate(() => window.__impasto!.getCamera())
  expect(cam.beta).toBeLessThan(0.35)
  await page.screenshot({ path: testInfo.outputPath('cam-top.png') })

  await page.locator('[data-shot="under"]').click()
  await waitSettled(page)
  cam = await page.evaluate(() => window.__impasto!.getCamera())
  expect(cam.beta).toBeGreaterThan(2.2)
  await page.screenshot({ path: testInfo.outputPath('cam-under.png') })

  await page.locator('[data-shot="front"]').click()
  await waitSettled(page)
  cam = await page.evaluate(() => window.__impasto!.getCamera())
  expect(Math.abs(wrapAngle(cam.alpha - -Math.PI / 2))).toBeLessThan(0.2)

  await page.locator('[data-shot="back"]').click()
  await waitSettled(page)
  cam = await page.evaluate(() => window.__impasto!.getCamera())
  expect(Math.abs(wrapAngle(cam.alpha - 2.35))).toBeLessThan(0.2)

  await page.locator('[data-shot="three"]').click()
  await waitSettled(page)
})

test('Look tool and right-drag orbit the tray', async ({ page }) => {
  await waitReady(page)
  await page.locator('#tool-look').click()
  expect(await page.evaluate(() => window.__impasto!.getTool())).toBe('look')

  const before = await page.evaluate(() => window.__impasto!.getCamera())
  const dish = await page.evaluate(() => window.__impasto!.getDishScreen())
  await page.mouse.move(dish.x, dish.y)
  await page.mouse.down()
  await page.mouse.move(dish.x + 90, dish.y + 50, { steps: 8 })
  await page.mouse.up()
  await page.evaluate(() => window.__impasto!.waitFrames(2))
  const afterLook = await page.evaluate(() => window.__impasto!.getCamera())
  const lookMoved =
    Math.abs(wrapAngle(afterLook.alpha - before.alpha)) > 0.04 || Math.abs(afterLook.beta - before.beta) > 0.04
  expect(lookMoved).toBe(true)

  await page.locator('#tool-glop').click()
  const preRight = await page.evaluate(() => window.__impasto!.getCamera())
  await page.mouse.move(dish.x - 40, dish.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(dish.x + 70, dish.y - 30, { steps: 8 })
  await page.mouse.up({ button: 'right' })
  await page.evaluate(() => window.__impasto!.waitFrames(2))
  const afterRight = await page.evaluate(() => window.__impasto!.getCamera())
  const rightMoved =
    Math.abs(wrapAngle(afterRight.alpha - preRight.alpha)) > 0.04 || Math.abs(afterRight.beta - preRight.beta) > 0.04
  expect(rightMoved).toBe(true)
})

test('Glop dumps the selected swatch color', async ({ page }, testInfo) => {
  await waitReady(page)
  await page.locator('#scrape').click()
  await page.locator('#tool-glop').click()
  await page.locator('[data-tube="Cadmium Red"]').click()
  expect((await page.evaluate(() => window.__impasto!.getSelected())).name).toBe('Cadmium Red')

  await clickDish(page)
  await page.evaluate(() => window.__impasto!.step(10))
  await page.evaluate(() => window.__impasto!.waitFrames(2))

  const red = await page.evaluate(() => window.__impasto!.getPaintStats())
  expect(red.filled).toBeGreaterThan(40)
  expect(red.meanRgb[0]).toBeGreaterThan(0.55)
  expect(red.meanRgb[0]).toBeGreaterThan(red.meanRgb[1] + 0.15)
  expect(red.meanRgb[0]).toBeGreaterThan(red.meanRgb[2] + 0.15)
  expect(await page.evaluate(() => window.__impasto!.getParticleCount())).toBeGreaterThan(10)
  await page.screenshot({ path: testInfo.outputPath('glop-red.png') })

  await page.locator('#scrape').click()
  await page.locator('[data-tube="Ultramarine"]').click()
  await clickDish(page)
  await page.evaluate(() => window.__impasto!.step(10))
  await page.evaluate(() => window.__impasto!.waitFrames(2))
  const blue = await page.evaluate(() => window.__impasto!.getPaintStats())
  expect(blue.filled).toBeGreaterThan(40)
  expect(blue.meanRgb[2]).toBeGreaterThan(0.45)
  expect(blue.meanRgb[2]).toBeGreaterThan(blue.meanRgb[0] + 0.1)
  await page.screenshot({ path: testInfo.outputPath('glop-blue.png') })
})

test('Finger, Knife, and Stick fold paint and never dump color', async ({ page }, testInfo) => {
  await waitReady(page)
  await page.locator('#scrape').click()
  await page.evaluate(() => window.__impasto!.step(2))

  for (const tool of ['finger', 'knife', 'stick'] as const) {
    await page.locator(`#tool-${tool}`).click()
    expect(await page.evaluate(() => window.__impasto!.getTool())).toBe(tool)
    await clickDish(page)
    const dish = await page.evaluate(() => window.__impasto!.getDishScreen())
    await page.mouse.move(dish.x, dish.y)
    await page.mouse.down()
    await page.mouse.move(dish.x + 40, dish.y + 20, { steps: 5 })
    await page.mouse.up()
    await page.evaluate(() => window.__impasto!.step(4))
    expect(await page.evaluate(() => window.__impasto!.getParticleCount())).toBe(0)
    expect((await page.evaluate(() => window.__impasto!.getPaintStats())).filled).toBe(0)
  }

  await page.locator('#tool-glop').click()
  await page.locator('[data-tube="Hansa Yellow"]').click()
  await clickDish(page)
  await page.evaluate(() => window.__impasto!.step(10))
  const afterGlop = await page.evaluate(() => ({
    n: window.__impasto!.getParticleCount(),
    paint: window.__impasto!.getPaintStats(),
  }))
  expect(afterGlop.n).toBeGreaterThan(10)
  expect(afterGlop.paint.meanRgb[0]).toBeGreaterThan(0.7)
  expect(afterGlop.paint.meanRgb[1]).toBeGreaterThan(0.55)

  await page.locator('#tool-knife').click()
  const dish = await page.evaluate(() => window.__impasto!.getDishScreen())
  await page.mouse.move(dish.x - 20, dish.y)
  await page.mouse.down()
  await page.mouse.move(dish.x + 50, dish.y + 10, { steps: 6 })
  await page.mouse.up()
  await page.evaluate(() => window.__impasto!.step(8))
  const afterFold = await page.evaluate(() => ({
    n: window.__impasto!.getParticleCount(),
    paint: window.__impasto!.getPaintStats(),
  }))
  expect(afterFold.n).toBe(afterGlop.n)
  expect(afterFold.paint.filled).toBeGreaterThan(20)
  await page.screenshot({ path: testInfo.outputPath('knife-fold.png') })
})

test('KM mixing is subtractive: red+yellow orange, blue+yellow green', async ({ page }) => {
  await waitReady(page)

  const redYellow = await page.evaluate(() => window.__impasto!.mix('Cadmium Red', 'Hansa Yellow'))
  expect(redYellow.chroma).toBeGreaterThan(0.22)
  expect(inHueRange(redYellow.hue, 0, 50) || inHueRange(redYellow.hue, 350, 360), `red+yellow hue ${redYellow.hue} rgb=${redYellow.rgb}`).toBe(true)
  expect(redYellow.rgb[0]).toBeGreaterThan(redYellow.rgb[2] + 0.12)
  expect(redYellow.rgb[0]).toBeGreaterThan(redYellow.rgb[1])

  const blueYellow = await page.evaluate(() => window.__impasto!.mix('Ultramarine', 'Hansa Yellow'))
  expect(blueYellow.chroma).toBeGreaterThan(0.12)
  expect(inHueRange(blueYellow.hue, 70, 175), `blue+yellow hue ${blueYellow.hue} rgb=${blueYellow.rgb}`).toBe(true)
  expect(blueYellow.rgb[1]).toBeGreaterThan(blueYellow.rgb[0])

  const ceruleanYellow = await page.evaluate(() => window.__impasto!.mix('Cerulean', 'Hansa Yellow'))
  expect(inHueRange(ceruleanYellow.hue, 70, 175), `cerulean+yellow hue ${ceruleanYellow.hue}`).toBe(true)

  const redBlue = await page.evaluate(() => window.__impasto!.mix('Cadmium Red', 'Ultramarine'))
  expect(redBlue.lightness).toBeLessThan(0.48)
  expect(redBlue.rgb[0]).toBeGreaterThan(redBlue.rgb[1] * 0.85)
  expect(inHueRange(redBlue.hue, 0, 45) || inHueRange(redBlue.hue, 250, 360), `red+blue hue ${redBlue.hue}`).toBe(true)

  const violet = await page.evaluate(() => window.__impasto!.mix('Quinacridone Magenta', 'Ultramarine'))
  expect(inHueRange(violet.hue, 260, 340) || violet.rgb[2] > violet.rgb[1], `violet hue ${violet.hue} rgb=${violet.rgb}`).toBe(true)

  const blackish = await page.evaluate(() => window.__impasto!.mix('Quinacridone Magenta', 'Phthalo Green'))
  expect(blackish.lightness, `quin+phthalo should go dark, rgb=${blackish.rgb}`).toBeLessThan(0.4)
  expect(blackish.chroma).toBeLessThan(0.22)
  expect(blackish.rgb[1]).toBeLessThan(0.4)

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
  await page.screenshot({ path: testInfo.outputPath('km-red-yellow-overlap.png') })

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
  await page.screenshot({ path: testInfo.outputPath('km-blue-yellow-overlap.png') })

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
