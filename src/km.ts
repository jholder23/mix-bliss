/**
 * Kubelka–Munk two-constant mixing for thick oil/impasto.
 *
 * Each pigment is a pair of spectral coefficients: absorption K(λ) and
 * scattering S(λ). Mixed paint is a concentration-weighted sum of K and S
 * (not an RGB lerp). Opaque-layer reflectance follows the infinite-thickness
 * KM solution, then the spectrum is integrated to D65/sRGB for the tray.
 */

export const WAVELENGTHS = [420, 460, 500, 540, 580, 620, 660, 700] as const
export const BANDS = WAVELENGTHS.length

const EPS = 1e-6

/** CIE 1931 2° CMFs sampled at WAVELENGTHS. */
const XBAR = [0.13438, 0.2908, 0.0049, 0.2904, 0.9163, 0.85445, 0.1649, 0.011359]
const YBAR = [0.004, 0.06, 0.323, 0.954, 0.87, 0.381, 0.061, 0.004102]
const ZBAR = [0.64588, 1.6692, 0.272, 0.0203, 0.00165, 0.00019, 0, 0]

/** CIE D65 relative SPD at WAVELENGTHS. */
const D65 = [93.4318, 117.812, 109.354, 104.405, 95.788, 87.6987, 80.2669, 71.6091]

/** sRGB / D65 XYZ → linear RGB. */
const XYZ_TO_RGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
] as const

const WHITE_Y = dot(D65, YBAR)

/** d(linear RGB) / d(R(λ_i)) — constant because XYZ is linear in reflectance. */
const RGB_FROM_BAND: number[][] = WAVELENGTHS.map((_, i) => {
  const s = D65[i]! / WHITE_Y
  const X = s * XBAR[i]!
  const Y = s * YBAR[i]!
  const Z = s * ZBAR[i]!
  return [
    XYZ_TO_RGB[0][0] * X + XYZ_TO_RGB[0][1] * Y + XYZ_TO_RGB[0][2] * Z,
    XYZ_TO_RGB[1][0] * X + XYZ_TO_RGB[1][1] * Y + XYZ_TO_RGB[1][2] * Z,
    XYZ_TO_RGB[2][0] * X + XYZ_TO_RGB[2][1] * Y + XYZ_TO_RGB[2][2] * Z,
  ]
})

export type Pigment = {
  K: Float32Array
  S: Float32Array
  /** Linear-sRGB residual so a single-tube masstone matches the swatch hex. */
  residual: [number, number, number]
}

export function newPigment(): Pigment {
  return { K: new Float32Array(BANDS), S: new Float32Array(BANDS), residual: [0, 0, 0] }
}

export function copyPigment(src: Pigment, dst: Pigment): void {
  dst.K.set(src.K)
  dst.S.set(src.S)
  dst.residual[0] = src.residual[0]
  dst.residual[1] = src.residual[1]
  dst.residual[2] = src.residual[2]
}

export function clonePigment(src: Pigment): Pigment {
  const dst = newPigment()
  copyPigment(src, dst)
  return dst
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function linearToSrgb(c: number): number {
  const x = Math.min(1, Math.max(0, c))
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
}

export function srgbToLinearRgb(rgb: readonly [number, number, number]): [number, number, number] {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])]
}

export function linearToSrgbRgb(rgb: readonly [number, number, number]): [number, number, number] {
  return [linearToSrgb(rgb[0]), linearToSrgb(rgb[1]), linearToSrgb(rgb[2])]
}

/** Infinite-thickness KM reflectance from K and S at one band. */
export function kmReflectance(K: number, S: number): number {
  const s = Math.max(S, EPS)
  const x = Math.max(K, 0) / s
  const r = 1 + x - Math.sqrt(x * (x + 2))
  return clamp(r, EPS, 1 - EPS)
}

export function ksToSpectrum(K: ArrayLike<number>, S: ArrayLike<number>, offset = 0, out?: Float32Array): Float32Array {
  const R = out ?? new Float32Array(BANDS)
  for (let i = 0; i < BANDS; i++) {
    R[i] = kmReflectance(K[offset + i] ?? 0, S[offset + i] ?? 0)
  }
  return R
}

export function spectrumToLinearRgb(R: ArrayLike<number>): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < BANDS; i++) {
    const refl = R[i] ?? 0
    const w = RGB_FROM_BAND[i]!
    r += w[0]! * refl
    g += w[1]! * refl
    b += w[2]! * refl
  }
  return [r, g, b]
}

export function spectrumToSrgb(R: ArrayLike<number>): [number, number, number] {
  return linearToSrgbRgb(spectrumToLinearRgb(R))
}

export function pigmentToLinearRgb(p: Pigment): [number, number, number] {
  const lin = spectrumToLinearRgb(ksToSpectrum(p.K, p.S))
  return [lin[0] + p.residual[0], lin[1] + p.residual[1], lin[2] + p.residual[2]]
}

export function pigmentToSrgb(p: Pigment): [number, number, number] {
  return linearToSrgbRgb(pigmentToLinearRgb(p))
}

/** Shift residual so KM masstone display equals the tube swatch. */
export function matchSwatch(p: Pigment, srgb: readonly [number, number, number]): Pigment {
  const body = spectrumToLinearRgb(ksToSpectrum(p.K, p.S))
  const want = srgbToLinearRgb(srgb)
  p.residual[0] = want[0] - body[0]
  p.residual[1] = want[1] - body[1]
  p.residual[2] = want[2] - body[2]
  return p
}

/**
 * Two-constant mix: K and S combine by concentration (paint mass).
 * Amounts are relative; they do not need to sum to 1.
 */
export function mixPigments(parts: readonly { pigment: Pigment; amount: number }[]): Pigment {
  const out = newPigment()
  let total = 0
  for (const part of parts) {
    if (part.amount <= 0) continue
    total += part.amount
    out.residual[0] += part.pigment.residual[0] * part.amount
    out.residual[1] += part.pigment.residual[1] * part.amount
    out.residual[2] += part.pigment.residual[2] * part.amount
    for (let i = 0; i < BANDS; i++) {
      out.K[i] += (part.pigment.K[i] ?? 0) * part.amount
      out.S[i] += (part.pigment.S[i] ?? 0) * part.amount
    }
  }
  const inv = 1 / Math.max(total, EPS)
  out.residual[0] *= inv
  out.residual[1] *= inv
  out.residual[2] *= inv
  for (let i = 0; i < BANDS; i++) {
    out.K[i] *= inv
    out.S[i] *= inv
  }
  // Swatch residual is a display correction for one tube. Fade it once K/S
  // spectra actually differ so mixes stay subtractive (blue+yellow → green).
  let diverge = 0
  for (const part of parts) {
    if (part.amount <= 0) continue
    for (let i = 0; i < BANDS; i++) {
      const k0 = out.K[i] ?? 0
      const k1 = part.pigment.K[i] ?? 0
      diverge += Math.abs(k1 - k0) / (Math.abs(k0) + 0.08)
    }
  }
  const fade = 1 - clamp(diverge / (BANDS * 1.35), 0, 1)
  out.residual[0] *= fade
  out.residual[1] *= fade
  out.residual[2] *= fade
  return out
}

export function mixPigmentsToSrgb(parts: readonly { pigment: Pigment; amount: number }[]): [number, number, number] {
  return pigmentToSrgb(mixPigments(parts))
}

/**
 * Homogenize two particle slots toward their mass-weighted KM mix.
 * `t` is the exchanged fraction (0 = none, 1 = both become the blend).
 * Total K·mass and S·mass are conserved.
 */
export function mixKSSlots(
  k: Float32Array,
  s: Float32Array,
  resid: Float32Array,
  indexA: number,
  indexB: number,
  massA: number,
  massB: number,
  t: number,
): void {
  const ma = Math.max(massA, EPS)
  const mb = Math.max(massB, EPS)
  const inv = 1 / (ma + mb)
  const blendT = clamp(t, 0, 1)
  if (blendT <= 0) return
  const oa = indexA * BANDS
  const ob = indexB * BANDS
  for (let i = 0; i < BANDS; i++) {
    const ka = k[oa + i] ?? 0
    const kb = k[ob + i] ?? 0
    const sa = s[oa + i] ?? 0
    const sb = s[ob + i] ?? 0
    const kBlend = (ma * ka + mb * kb) * inv
    const sBlend = (ma * sa + mb * sb) * inv
    k[oa + i] = ka + (kBlend - ka) * blendT
    k[ob + i] = kb + (kBlend - kb) * blendT
    s[oa + i] = sa + (sBlend - sa) * blendT
    s[ob + i] = sb + (sBlend - sb) * blendT
  }
  const ra = indexA * 3
  const rb = indexB * 3
  for (let c = 0; c < 3; c++) {
    const va = resid[ra + c] ?? 0
    const vb = resid[rb + c] ?? 0
    const mean = (ma * va + mb * vb) * inv
    resid[ra + c] = va + (mean - va) * blendT
    resid[rb + c] = vb + (mean - vb) * blendT
  }
  const kDiff = Math.abs((k[oa] ?? 0) - (k[ob] ?? 0)) + Math.abs((k[oa + 3] ?? 0) - (k[ob + 3] ?? 0))
  const fade = clamp(1 - kDiff * 0.15 * blendT, 0, 1)
  for (let c = 0; c < 3; c++) {
    resid[ra + c] = (resid[ra + c] ?? 0) * fade
    resid[rb + c] = (resid[rb + c] ?? 0) * fade
  }
}

export function writePigmentSlot(k: Float32Array, s: Float32Array, resid: Float32Array, index: number, pigment: Pigment): void {
  const o = index * BANDS
  k.set(pigment.K, o)
  s.set(pigment.S, o)
  const r = index * 3
  resid[r] = pigment.residual[0]
  resid[r + 1] = pigment.residual[1]
  resid[r + 2] = pigment.residual[2]
}

const scratchSpec = new Float32Array(BANDS)

/** Convert accumulated K·mass / S·mass at a heightfield cell into display sRGB. */
export function accumulatedKSToSrgb(
  kAcc: Float32Array,
  sAcc: Float32Array,
  residAcc: Float32Array,
  cell: number,
  mass: number,
): [number, number, number] {
  const inv = 1 / Math.max(mass, EPS)
  const o = cell * BANDS
  for (let i = 0; i < BANDS; i++) {
    scratchSpec[i] = kmReflectance((kAcc[o + i] ?? 0) * inv, (sAcc[o + i] ?? 0) * inv)
  }
  const lin = spectrumToLinearRgb(scratchSpec)
  const r = cell * 3
  return linearToSrgbRgb([
    lin[0] + (residAcc[r] ?? 0) * inv,
    lin[1] + (residAcc[r + 1] ?? 0) * inv,
    lin[2] + (residAcc[r + 2] ?? 0) * inv,
  ])
}

function reflectanceToKS(R: ArrayLike<number>, scatter: number, kOut: Float32Array, sOut: Float32Array): void {
  const S = Math.max(scatter, 0.05)
  for (let i = 0; i < BANDS; i++) {
    const r = clamp(R[i] ?? 0.5, EPS, 1 - EPS)
    sOut[i] = S
    kOut[i] = (S * (1 - r) * (1 - r)) / (2 * r)
  }
}

export function pigmentFromReflectance(R: ArrayLike<number>, scatter: number): Pigment {
  const p = newPigment()
  reflectanceToKS(R, scatter, p.K, p.S)
  return p
}

export function pigmentFromReflectanceMatching(
  R: ArrayLike<number>,
  scatter: number,
  srgb: readonly [number, number, number],
): Pigment {
  return matchSwatch(pigmentFromReflectance(R, scatter), srgb)
}

/**
 * Nudge a template reflectance so KM(masstone) matches a display sRGB swatch,
 * while staying close to the physically-based curve that gives the mix hues.
 */
export function fitReflectanceToSrgb(
  template: ArrayLike<number>,
  srgb: readonly [number, number, number],
  prior = 0.12,
): Float32Array {
  const target = srgbToLinearRgb(srgb)
  const R0 = new Float32Array(BANDS)
  for (let i = 0; i < BANDS; i++) R0[i] = clamp(template[i] ?? 0.2, EPS, 1 - EPS)
  let R = new Float32Array(R0)

  for (let iter = 0; iter < 8; iter++) {
    const A = zeros(BANDS * BANDS)
    const b = new Float32Array(BANDS)
    for (let i = 0; i < BANDS; i++) {
      A[i * BANDS + i] += prior
      b[i] += prior * (R0[i] ?? 0)
    }
    for (let i = 0; i < BANDS; i++) {
      const ci = RGB_FROM_BAND[i]!
      for (let j = 0; j < BANDS; j++) {
        const cj = RGB_FROM_BAND[j]!
        A[i * BANDS + j] += ci[0]! * cj[0]! + ci[1]! * cj[1]! + ci[2]! * cj[2]!
      }
      b[i] += ci[0]! * target[0] + ci[1]! * target[1] + ci[2]! * target[2]
    }
    const next = solveLinear(A, b, BANDS)
    for (let i = 0; i < BANDS; i++) R[i] = clamp(next[i] ?? 0.2, EPS, 1 - EPS)

    const got = spectrumToLinearRgb(R)
    const err =
      Math.abs(got[0] - target[0]) + Math.abs(got[1] - target[1]) + Math.abs(got[2] - target[2])
    if (err < 0.004) break
  }
  return R
}

export function pigmentFromSrgb(
  srgb: readonly [number, number, number],
  scatter?: number,
  template?: ArrayLike<number>,
): Pigment {
  const lin = srgbToLinearRgb(srgb)
  const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
  const S = scatter ?? 0.35 + Y * 0.95
  const base = template ?? rgbLobeGuess(lin)
  const R = fitReflectanceToSrgb(base, srgb, 0.55)
  return matchSwatch(pigmentFromReflectance(R, S), srgb)
}

/** Smooth RGB→spectrum guess used for custom swatches (then fitted to the hex). */
function rgbLobeGuess(lin: readonly [number, number, number]): Float32Array {
  const R = new Float32Array(BANDS)
  for (let i = 0; i < BANDS; i++) {
    const l = WAVELENGTHS[i]!
    const blue = gauss(l, 450, 32)
    const green = gauss(l, 540, 38)
    const red = gauss(l, 630, 42)
    R[i] = clamp(lin[0] * red + lin[1] * green + lin[2] * blue, 0.02, 0.98)
  }
  return R
}

export function srgbHueChroma(rgb: readonly [number, number, number]): { h: number; c: number; l: number } {
  const r = rgb[0]
  const g = rgb[1]
  const b = rgb[2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const c = max - min
  const l = (max + min) * 0.5
  if (c < 1e-6) return { h: 0, c: 0, l }
  let h = 0
  if (max === r) h = 60 * (((g - b) / c) % 6)
  else if (max === g) h = 60 * ((b - r) / c + 2)
  else h = 60 * ((r - g) / c + 4)
  if (h < 0) h += 360
  return { h, c, l }
}

function gauss(x: number, mu: number, sigma: number): number {
  const d = (x - mu) / sigma
  return Math.exp(-0.5 * d * d)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0)
  return s
}

function zeros(n: number): Float32Array {
  return new Float32Array(n)
}

function solveLinear(A: Float32Array, b: Float32Array, n: number): Float32Array {
  const M = new Float64Array(n * n)
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = b[i] ?? 0
    for (let j = 0; j < n; j++) M[i * n + j] = A[i * n + j] ?? 0
  }
  for (let k = 0; k < n; k++) {
    let piv = k
    let best = 0
    for (let i = k; i < n; i++) {
      const v = Math.abs(M[i * n + k] ?? 0)
      if (v > best) {
        best = v
        piv = i
      }
    }
    if (best < 1e-12) {
      M[k * n + k] = 1e-12
    } else if (piv !== k) {
      for (let j = 0; j < n; j++) {
        const tmp = M[k * n + j]!
        M[k * n + j] = M[piv * n + j]!
        M[piv * n + j] = tmp
      }
      const tx = x[k]!
      x[k] = x[piv]!
      x[piv] = tx
    }
    const diag = M[k * n + k]!
    for (let i = k + 1; i < n; i++) {
      const f = M[i * n + k]! / diag
      M[i * n + k] = f
      for (let j = k + 1; j < n; j++) M[i * n + j] -= f * M[k * n + j]!
      x[i] -= f * x[k]!
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let acc = x[i]!
    for (let j = i + 1; j < n; j++) acc -= M[i * n + j]! * x[j]!
    x[i] = acc / M[i * n + i]!
  }
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = x[i]!
  return out
}
