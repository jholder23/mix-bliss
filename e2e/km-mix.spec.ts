import { expect, test } from '@playwright/test'

function inHueRange(h: number, lo: number, hi: number): boolean {
  if (lo <= hi) return h >= lo && h <= hi
  return h >= lo || h <= hi
}

test('KM harness: red+yellow orange, blue+yellow green, swatch masstone', async ({ page }) => {
  await page.goto('/km-harness.html')
  await page.waitForFunction(() => window.__km?.ready === true, null, { timeout: 20_000 })

  const redYellow = await page.evaluate(() => window.__km!.mix('Cadmium Red', 'Hansa Yellow'))
  expect(redYellow.chroma).toBeGreaterThan(0.22)
  expect(inHueRange(redYellow.hue, 0, 55) || inHueRange(redYellow.hue, 350, 360), `red+yellow hue ${redYellow.hue} rgb=${redYellow.rgb}`).toBe(true)
  expect(redYellow.rgb[0]).toBeGreaterThan(redYellow.rgb[2] + 0.12)

  const blueYellow = await page.evaluate(() => window.__km!.mix('Ultramarine', 'Hansa Yellow'))
  expect(blueYellow.chroma).toBeGreaterThan(0.12)
  expect(inHueRange(blueYellow.hue, 70, 175), `blue+yellow hue ${blueYellow.hue} rgb=${blueYellow.rgb}`).toBe(true)
  expect(blueYellow.rgb[1]).toBeGreaterThan(blueYellow.rgb[0])

  const ceruleanYellow = await page.evaluate(() => window.__km!.mix('Cerulean', 'Hansa Yellow'))
  expect(inHueRange(ceruleanYellow.hue, 70, 175), `cerulean+yellow hue ${ceruleanYellow.hue}`).toBe(true)

  const masstone = await page.evaluate(() => window.__km!.masstone('Cadmium Red'))
  expect(masstone[0]).toBeGreaterThan(0.7)
  expect(masstone[0]).toBeGreaterThan(masstone[1] + 0.3)
})

declare global {
  interface Window {
    __km?: {
      ready: boolean
      mix: (
        a: string,
        b: string,
        amountA?: number,
        amountB?: number,
      ) => { rgb: [number, number, number]; hue: number; chroma: number; lightness: number }
      masstone: (name: string) => [number, number, number]
    }
  }
}
