import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  mixPigments,
  mixPigmentsToSrgb,
  pigmentFromSrgb,
  pigmentToSrgb,
  srgbHueChroma,
} from './km.ts'
import { hexToRgb, mixTubePaints, masstoneSrgb, tubeByName, TUBES } from './paints.ts'

function luma(rgb: readonly [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

function rgbLerp(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function mustTube(name: string) {
  const tube = tubeByName(name)
  assert.ok(tube, name)
  return tube
}

describe('Kubelka-Munk mix', () => {
  it('single-tube masstone matches the swatch hex', () => {
    for (const tube of TUBES) {
      const got = masstoneSrgb(tube)
      const want = hexToRgb(tube.hex)
      const err = Math.max(
        Math.abs(got[0] - want[0]),
        Math.abs(got[1] - want[1]),
        Math.abs(got[2] - want[2]),
      )
      assert.ok(err < 0.012, `${tube.name} err ${err}`)
    }
  })

  it('blue + yellow makes green, not the RGB midpoint gray', () => {
    const blue = mustTube('Ultramarine')
    const yellow = mustTube('Hansa Yellow')
    const mixed = mixTubePaints(blue, yellow, 1, 1)
    const lerp = rgbLerp(hexToRgb(blue.hex), hexToRgb(yellow.hex), 0.5)
    const hue = srgbHueChroma(mixed)
    assert.ok(mixed[1] > mixed[0], `green channel should lead, got ${mixed}`)
    assert.ok(mixed[1] > mixed[2] * 0.85, `not a purple/gray, got ${mixed}`)
    assert.ok(hue.h > 70 && hue.h < 170, `hue ${hue.h} should be green`)
    assert.ok(hue.c > 0.12, `chroma ${hue.c}`)
    assert.ok(Math.abs(lerp[0] - lerp[1]) < 0.05, 'sanity: RGB lerp of these two is grayish')
    assert.ok(mixed[1] - mixed[0] > lerp[1] - lerp[0] + 0.08)
  })

  it('red + yellow makes orange', () => {
    const mixed = mixTubePaints(mustTube('Cadmium Red'), mustTube('Hansa Yellow'), 1, 1)
    const hue = srgbHueChroma(mixed)
    assert.ok(mixed[0] > mixed[2] + 0.25)
    assert.ok(mixed[1] > mixed[2] + 0.08)
    assert.ok(hue.h < 55 || hue.h > 330, `hue ${hue.h}`)
  })

  it('complements go dark brown/olive, not a bright RGB average', () => {
    const red = mustTube('Cadmium Red')
    const green = mustTube('Phthalo Green')
    const mixed = mixTubePaints(red, green, 1, 1)
    const lerp = rgbLerp(hexToRgb(red.hex), hexToRgb(green.hex), 0.5)
    assert.ok(luma(mixed) < luma(lerp) + 0.02, `KM luma ${luma(mixed)} vs lerp ${luma(lerp)}`)
    assert.ok(luma(mixed) < 0.42)
    const hue = srgbHueChroma(mixed)
    assert.ok(hue.c < 0.45, `should neutralize, chroma ${hue.c}`)
  })

  it('red + ultramarine goes purple/maroon, darker than a bright magenta lerp', () => {
    const mixed = mixTubePaints(mustTube('Cadmium Red'), mustTube('Ultramarine'), 1, 1)
    assert.ok(mixed[0] > mixed[1])
    assert.ok(mixed[2] > mixed[1] * 0.7)
    assert.ok(luma(mixed) < 0.45)
  })

  it('transparent phthalo tints white instead of vanishing', () => {
    const mixed = mixTubePaints(mustTube('Titanium White'), mustTube('Phthalo Green'), 8, 1)
    const hue = srgbHueChroma(mixed)
    assert.ok(mixed[1] > mixed[0])
    assert.ok(hue.h > 100 && hue.h < 180, `hue ${hue.h}`)
    assert.ok(luma(mixed) > 0.45)
  })

  it('RYB gold recipe is olive-gold, not muddy gray', () => {
    const gold = mixPigmentsToSrgb([
      { pigment: mustTube('Hansa Yellow').pigment, amount: 8 },
      { pigment: mustTube('Cadmium Red').pigment, amount: 1.2 },
      { pigment: mustTube('Ultramarine').pigment, amount: 0.35 },
    ])
    const hue = srgbHueChroma(gold)
    assert.ok(gold[0] > gold[2] + 0.12)
    assert.ok(gold[1] > gold[2])
    assert.ok(hue.h > 15 && hue.h < 80, `hue ${hue.h}`)
    assert.ok(luma(gold) > 0.28)
  })

  it('mixing a pigment with itself is a no-op', () => {
    const tube = mustTube('Cerulean')
    const mixed = mixPigments([
      { pigment: tube.pigment, amount: 1 },
      { pigment: tube.pigment, amount: 2 },
    ])
    const a = pigmentToSrgb(tube.pigment)
    const b = pigmentToSrgb(mixed)
    const err = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
    assert.ok(err < 1e-4, `${err}`)
  })

  it('custom RGB still round-trips and mixes subtractively', () => {
    const a = pigmentFromSrgb([0, 0.13, 0.52])
    const b = pigmentFromSrgb([0.988, 0.827, 0])
    const back = pigmentToSrgb(a)
    assert.ok(Math.abs(back[2] - 0.52) < 0.04)
    const mixed = mixPigmentsToSrgb([
      { pigment: a, amount: 1 },
      { pigment: b, amount: 1 },
    ])
    assert.ok(mixed[1] > mixed[0])
    assert.ok(mixed[1] > mixed[2] * 0.7)
  })
})
