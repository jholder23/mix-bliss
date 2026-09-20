import { expect, test, type Page } from '@playwright/test'

async function waitReady(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__impasto?.ready === true, null, { timeout: 20_000 })
  await expect(page.locator('#fail')).toBeHidden()
  await expect(page.locator('#canvas')).toBeVisible()
  await page.evaluate(() => window.__impasto!.waitFrames(12))
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
  await page.evaluate(() => window.__impasto!.waitFrames(4))
}

async function clickDish(page: Page) {
  const { x, y } = await page.evaluate(() => window.__impasto!.getDishScreen())
  await page.mouse.click(x, y)
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
  expect(frame.variance).toBeGreaterThan(40)

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
  await page.evaluate(() => window.__impasto!.waitFrames(10))
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
  await page.evaluate(() => window.__impasto!.waitFrames(10))
  const afterRight = await page.evaluate(() => window.__impasto!.getCamera())
  const rightMoved =
    Math.abs(wrapAngle(afterRight.alpha - preRight.alpha)) > 0.04 || Math.abs(afterRight.beta - preRight.beta) > 0.04
  expect(rightMoved).toBe(true)
})

test('Glop dumps the selected swatch color', async ({ page }, testInfo) => {
  await waitReady(page)
  await page.locator('#scrape').click()
  await page.evaluate(() => window.__impasto!.waitFrames(6))
  await page.locator('#tool-glop').click()
  await page.locator('[data-tube="Cadmium Red"]').click()
  expect((await page.evaluate(() => window.__impasto!.getSelected())).name).toBe('Cadmium Red')

  await clickDish(page)
  await page.evaluate(() => window.__impasto!.waitFrames(18))

  const red = await page.evaluate(() => window.__impasto!.getPaintStats())
  expect(red.filled).toBeGreaterThan(40)
  expect(red.meanRgb[0]).toBeGreaterThan(0.55)
  expect(red.meanRgb[0]).toBeGreaterThan(red.meanRgb[1] + 0.15)
  expect(red.meanRgb[0]).toBeGreaterThan(red.meanRgb[2] + 0.15)
  expect(await page.evaluate(() => window.__impasto!.getParticleCount())).toBeGreaterThan(10)
  await page.screenshot({ path: testInfo.outputPath('glop-red.png') })

  await page.locator('#scrape').click()
  await page.evaluate(() => window.__impasto!.waitFrames(6))
  await page.locator('[data-tube="Ultramarine"]').click()
  await clickDish(page)
  await page.evaluate(() => window.__impasto!.waitFrames(18))
  const blue = await page.evaluate(() => window.__impasto!.getPaintStats())
  expect(blue.filled).toBeGreaterThan(40)
  expect(blue.meanRgb[2]).toBeGreaterThan(0.45)
  expect(blue.meanRgb[2]).toBeGreaterThan(blue.meanRgb[0] + 0.1)
  await page.screenshot({ path: testInfo.outputPath('glop-blue.png') })
})

test('Finger, Knife, and Stick fold paint and never dump color', async ({ page }, testInfo) => {
  await waitReady(page)
  await page.locator('#scrape').click()
  await page.evaluate(() => window.__impasto!.waitFrames(6))

  for (const tool of ['finger', 'knife', 'stick'] as const) {
    await page.locator(`#tool-${tool}`).click()
    expect(await page.evaluate(() => window.__impasto!.getTool())).toBe(tool)
    await clickDish(page)
    const dish = await page.evaluate(() => window.__impasto!.getDishScreen())
    await page.mouse.move(dish.x, dish.y)
    await page.mouse.down()
    await page.mouse.move(dish.x + 40, dish.y + 20, { steps: 5 })
    await page.mouse.up()
    await page.evaluate(() => window.__impasto!.waitFrames(8))
    expect(await page.evaluate(() => window.__impasto!.getParticleCount())).toBe(0)
    expect((await page.evaluate(() => window.__impasto!.getPaintStats())).filled).toBe(0)
  }

  await page.locator('#tool-glop').click()
  await page.locator('[data-tube="Hansa Yellow"]').click()
  await clickDish(page)
  await page.evaluate(() => window.__impasto!.waitFrames(16))
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
  await page.evaluate(() => window.__impasto!.waitFrames(12))
  const afterFold = await page.evaluate(() => ({
    n: window.__impasto!.getParticleCount(),
    paint: window.__impasto!.getPaintStats(),
  }))
  expect(afterFold.n).toBe(afterGlop.n)
  expect(afterFold.paint.filled).toBeGreaterThan(20)
  await page.screenshot({ path: testInfo.outputPath('knife-fold.png') })
})
