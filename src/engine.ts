import * as S from './shaders'
import type { PaintFeel } from './paints'

type Fbo = {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
  texel: [number, number]
}

type DoubleFbo = {
  read: Fbo
  write: Fbo
  swap: () => void
}

type Program = {
  id: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

type Format = {
  internal: number
  format: number
  type: number
  filter: number
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown'
    gl.deleteShader(shader)
    throw new Error(log)
  }
  return shader
}

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const prog = gl.createProgram()
  if (!prog) throw new Error('Could not create program')
  const v = compile(gl, gl.VERTEX_SHADER, vs)
  const f = compile(gl, gl.FRAGMENT_SHADER, fs)
  gl.attachShader(prog, v)
  gl.attachShader(prog, f)
  gl.linkProgram(prog)
  gl.deleteShader(v)
  gl.deleteShader(f)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? 'unknown'
    gl.deleteProgram(prog)
    throw new Error(log)
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(prog, i)
    if (!info) continue
    uniforms[info.name] = gl.getUniformLocation(prog, info.name)
  }
  return { id: prog, uniforms }
}

function supportFormat(
  gl: WebGL2RenderingContext,
  internal: number,
  format: number,
  type: number,
): boolean {
  const tex = gl.createTexture()
  if (!tex) return false
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, 8, 8, 0, format, type, null)
  const fb = gl.createFramebuffer()
  if (!fb) return false
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.deleteFramebuffer(fb)
  gl.deleteTexture(tex)
  return ok
}

function pickFormat(gl: WebGL2RenderingContext): Format {
  gl.getExtension('EXT_color_buffer_float')
  gl.getExtension('EXT_color_buffer_half_float')
  const linearFloat = gl.getExtension('OES_texture_float_linear')
  const linearHalf = gl.getExtension('OES_texture_half_float_linear')
  const candidates: Format[] = [
    {
      internal: gl.RGBA16F,
      format: gl.RGBA,
      type: gl.HALF_FLOAT,
      filter: linearHalf || linearFloat ? gl.LINEAR : gl.NEAREST,
    },
    {
      internal: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      filter: linearFloat ? gl.LINEAR : gl.NEAREST,
    },
    {
      internal: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
    },
  ]
  for (const c of candidates) {
    if (supportFormat(gl, c.internal, c.format, c.type)) return c
  }
  throw new Error('No renderable color format')
}

function createFbo(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  fmt: Format,
  filter: number,
): Fbo {
  const tex = gl.createTexture()
  const fbo = gl.createFramebuffer()
  if (!tex || !fbo) throw new Error('Could not create FBO')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, fmt.type, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  return { tex, fbo, w, h, texel: [1 / w, 1 / h] }
}

function createDouble(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  fmt: Format,
  filter: number,
): DoubleFbo {
  let read = createFbo(gl, w, h, fmt, filter)
  let write = createFbo(gl, w, h, fmt, filter)
  return {
    get read() {
      return read
    },
    get write() {
      return write
    },
    swap() {
      const tmp = read
      read = write
      write = tmp
    },
  }
}

function getResolution(width: number, height: number, resolution: number): { w: number; h: number } {
  let aspect = width / height
  if (aspect < 1) aspect = 1 / aspect
  const min = Math.round(resolution)
  const max = Math.round(resolution * aspect)
  if (width > height) return { w: max, h: min }
  return { w: min, h: max }
}

export class PaintEngine {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private fmt: Format
  private feel: PaintFeel
  private aspect = 1
  private lastLight: [number, number] = [0.42, 0.68]

  private velocity!: DoubleFbo
  private dye!: DoubleFbo
  private divergenceFbo!: Fbo
  private curlFbo!: Fbo
  private pressure!: DoubleFbo

  private splatAdd!: Program
  private splatRadialProg!: Program
  private splatBladeVelProg!: Program
  private splatPaintProg!: Program
  private displaceHeightProg!: Program
  private displaceBladeProg!: Program
  private advection!: Program
  private divergenceProg!: Program
  private clearProg!: Program
  private pressureProg!: Program
  private gradientProg!: Program
  private curlProg!: Program
  private vorticityProg!: Program
  private viscosityProg!: Program
  private levelProg!: Program
  private slopeProg!: Program
  private displayProg!: Program
  private fingers: [number, number, number, number][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  private fingerTint: [number, number, number] = [0.83, 0.22, 0.16]
  private tool = { uv: [0, 0] as [number, number], radius: 0, dir: [1, 0] as [number, number], kind: 0 }
  private software = false
  private time = 0

  constructor(canvas: HTMLCanvasElement, feel: PaintFeel) {
    this.canvas = canvas
    this.feel = feel
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    this.fmt = pickFormat(gl)
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : ''
    this.software = /swiftshader|llvmpipe|softpipe|microsoft basic|software/i.test(renderer)

    const vao = gl.createVertexArray()
    const buf = gl.createBuffer()
    if (!vao || !buf) throw new Error('Could not create geometry')
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    this.splatAdd = createProgram(gl, S.vert, S.splatAdd)
    this.splatRadialProg = createProgram(gl, S.vert, S.splatRadial)
    this.splatBladeVelProg = createProgram(gl, S.vert, S.splatBladeVel)
    this.splatPaintProg = createProgram(gl, S.vert, S.splatPaint)
    this.displaceHeightProg = createProgram(gl, S.vert, S.displaceHeight)
    this.displaceBladeProg = createProgram(gl, S.vert, S.displaceBlade)
    this.advection = createProgram(gl, S.vert, S.advection)
    this.divergenceProg = createProgram(gl, S.vert, S.divergence)
    this.clearProg = createProgram(gl, S.vert, S.clearShader)
    this.pressureProg = createProgram(gl, S.vert, S.pressure)
    this.gradientProg = createProgram(gl, S.vert, S.gradientSubtract)
    this.curlProg = createProgram(gl, S.vert, S.curl)
    this.vorticityProg = createProgram(gl, S.vert, S.vorticity)
    this.viscosityProg = createProgram(gl, S.vert, S.viscosity)
    this.levelProg = createProgram(gl, S.vert, S.levelHeight)
    this.slopeProg = createProgram(gl, S.vert, S.slopeForce)
    this.displayProg = createProgram(gl, S.vert, S.display)

    this.rebuildTargets()
  }

  setFeel(feel: PaintFeel): void {
    this.feel = feel
  }

  resize(): void {
    const dpr = this.software ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr))
    if (this.canvas.width === w && this.canvas.height === h) return
    this.canvas.width = w
    this.canvas.height = h
    this.aspect = w / h
    this.rebuildTargets()
  }

  private deleteFbo(target?: Fbo): void {
    if (!target) return
    const gl = this.gl
    gl.deleteFramebuffer(target.fbo)
    gl.deleteTexture(target.tex)
  }

  private deleteDouble(target?: DoubleFbo): void {
    if (!target) return
    this.deleteFbo(target.read)
    this.deleteFbo(target.write)
  }

  private rebuildTargets(): void {
    const gl = this.gl
    this.deleteDouble(this.velocity)
    this.deleteDouble(this.dye)
    this.deleteFbo(this.divergenceFbo)
    this.deleteFbo(this.curlFbo)
    this.deleteDouble(this.pressure)
    const coarse =
      this.software || window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 720
    const sim = getResolution(this.canvas.width, this.canvas.height, this.software ? 160 : coarse ? 256 : 384)
    const dye = getResolution(this.canvas.width, this.canvas.height, this.software ? 384 : coarse ? 640 : 960)
    const velFilter = this.fmt.filter
    this.velocity = createDouble(gl, sim.w, sim.h, this.fmt, velFilter)
    this.dye = createDouble(gl, dye.w, dye.h, this.fmt, this.fmt.filter)
    this.divergenceFbo = createFbo(gl, sim.w, sim.h, this.fmt, gl.NEAREST)
    this.curlFbo = createFbo(gl, sim.w, sim.h, this.fmt, gl.NEAREST)
    this.pressure = createDouble(gl, sim.w, sim.h, this.fmt, gl.NEAREST)
  }

  private blit(target: Fbo | null): void {
    const gl = this.gl
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
      gl.viewport(0, 0, target.w, target.h)
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  splatVelocity(uv: [number, number], vel: [number, number], radius: number): void {
    const gl = this.gl
    const p = this.splatAdd
    gl.useProgram(p.id)
    gl.uniform1i(p.uniforms.uTarget, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
    gl.uniform2f(p.uniforms.uPoint, uv[0], uv[1])
    gl.uniform3f(p.uniforms.uColor, vel[0], vel[1], 0)
    gl.uniform1f(p.uniforms.uRadius, radius)
    gl.uniform1f(p.uniforms.uAspect, this.aspect)
    this.blit(this.velocity.write)
    this.velocity.swap()
  }

  splatPaint(uv: [number, number], color: [number, number, number], radius: number, strength: number): void {
    const gl = this.gl
    const p = this.splatPaintProg
    gl.useProgram(p.id)
    gl.uniform1i(p.uniforms.uTarget, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.dye.read.tex)
    gl.uniform2f(p.uniforms.uPoint, uv[0], uv[1])
    gl.uniform3f(p.uniforms.uColor, color[0], color[1], color[2])
    gl.uniform1f(p.uniforms.uRadius, radius)
    gl.uniform1f(p.uniforms.uAspect, this.aspect)
    gl.uniform1f(p.uniforms.uStrength, strength)
    this.blit(this.dye.write)
    this.dye.swap()
  }

  displaceBlade(uv: [number, number], dir: [number, number], length: number, width: number, depth: number): void {
    const gl = this.gl
    const p = this.displaceBladeProg
    gl.useProgram(p.id)
    gl.uniform1i(p.uniforms.uTarget, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.dye.read.tex)
    gl.uniform2f(p.uniforms.uPoint, uv[0], uv[1])
    gl.uniform2f(p.uniforms.uDir, dir[0], dir[1])
    gl.uniform1f(p.uniforms.uLength, length)
    gl.uniform1f(p.uniforms.uWidth, width)
    gl.uniform1f(p.uniforms.uAspect, this.aspect)
    gl.uniform1f(p.uniforms.uDepth, depth)
    this.blit(this.dye.write)
    this.dye.swap()
  }

  displaceHeight(uv: [number, number], radius: number, depth: number): void {
    const gl = this.gl
    const p = this.displaceHeightProg
    gl.useProgram(p.id)
    gl.uniform1i(p.uniforms.uTarget, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.dye.read.tex)
    gl.uniform2f(p.uniforms.uPoint, uv[0], uv[1])
    gl.uniform1f(p.uniforms.uRadius, radius)
    gl.uniform1f(p.uniforms.uAspect, this.aspect)
    gl.uniform1f(p.uniforms.uDepth, depth)
    this.blit(this.dye.write)
    this.dye.swap()
  }

  nudgeRadial(uv: [number, number], delta: [number, number], radius: number, push: number, drag: number): void {
    const gl = this.gl
    const p = this.splatRadialProg
    gl.useProgram(p.id)
    gl.uniform1i(p.uniforms.uTarget, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
    gl.uniform2f(p.uniforms.uPoint, uv[0], uv[1])
    gl.uniform2f(p.uniforms.uDelta, delta[0], delta[1])
    gl.uniform1f(p.uniforms.uRadius, radius)
    gl.uniform1f(p.uniforms.uAspect, this.aspect)
    gl.uniform1f(p.uniforms.uPush, push)
    gl.uniform1f(p.uniforms.uDrag, drag)
    this.blit(this.velocity.write)
    this.velocity.swap()
  }

  nudgeBlade(
    uv: [number, number],
    delta: [number, number],
    dir: [number, number],
    length: number,
    width: number,
    push: number,
    drag: number,
  ): void {
    const gl = this.gl
    const p = this.splatBladeVelProg
    gl.useProgram(p.id)
    gl.uniform1i(p.uniforms.uTarget, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
    gl.uniform2f(p.uniforms.uPoint, uv[0], uv[1])
    gl.uniform2f(p.uniforms.uDelta, delta[0], delta[1])
    gl.uniform2f(p.uniforms.uDir, dir[0], dir[1])
    gl.uniform1f(p.uniforms.uLength, length)
    gl.uniform1f(p.uniforms.uWidth, width)
    gl.uniform1f(p.uniforms.uAspect, this.aspect)
    gl.uniform1f(p.uniforms.uPush, push)
    gl.uniform1f(p.uniforms.uDrag, drag)
    this.blit(this.velocity.write)
    this.velocity.swap()
  }

  setFingers(list: { uv: [number, number]; radius: number }[], tint: [number, number, number]): void {
    this.fingerTint = tint
    for (let i = 0; i < 3; i++) {
      const f = list[i]
      if (f) this.fingers[i] = [f.uv[0], f.uv[1], f.radius, 1]
      else this.fingers[i] = [0, 0, 0, 0]
    }
  }

  setTool(kind: number, uv: [number, number], radius: number, dir: [number, number]): void {
    this.tool = { uv, radius, dir, kind }
  }

  scrape(): void {
    const gl = this.gl
    gl.useProgram(this.clearProg.id)
    gl.uniform4f(this.clearProg.uniforms.uValue, 0, 0, 0, 0)
    this.blit(this.dye.write)
    this.dye.swap()
    this.blit(this.velocity.write)
    this.velocity.swap()
    this.blit(this.pressure.write)
    this.pressure.swap()
  }

  step(dt: number): void {
    const gl = this.gl
    const feel = this.feel
    const texel = this.velocity.read.texel
    const clamped = Math.min(Math.max(dt, 1 / 144), 1 / 30)

    if (feel.vorticity > 0.01) {
      gl.useProgram(this.curlProg.id)
      gl.uniform1i(this.curlProg.uniforms.uVelocity, 0)
      gl.uniform2f(this.curlProg.uniforms.uTexelSize, texel[0], texel[1])
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
      this.blit(this.curlFbo)

      gl.useProgram(this.vorticityProg.id)
      gl.uniform1i(this.vorticityProg.uniforms.uVelocity, 0)
      gl.uniform1i(this.vorticityProg.uniforms.uCurl, 1)
      gl.uniform2f(this.vorticityProg.uniforms.uTexelSize, texel[0], texel[1])
      gl.uniform1f(this.vorticityProg.uniforms.uCurlAmount, feel.vorticity)
      gl.uniform1f(this.vorticityProg.uniforms.uDt, clamped)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.curlFbo.tex)
      this.blit(this.velocity.write)
      this.velocity.swap()
    }

    const viscIters = this.software ? Math.min(2, Math.max(1, feel.viscosityIters)) : Math.max(1, feel.viscosityIters)
    gl.useProgram(this.viscosityProg.id)
    gl.uniform1i(this.viscosityProg.uniforms.uVelocity, 0)
    gl.uniform2f(this.viscosityProg.uniforms.uTexelSize, texel[0], texel[1])
    gl.uniform1f(this.viscosityProg.uniforms.uAmount, feel.viscosity)
    for (let i = 0; i < viscIters; i++) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
      this.blit(this.velocity.write)
      this.velocity.swap()
    }

    gl.useProgram(this.advection.id)
    gl.uniform1i(this.advection.uniforms.uVelocity, 0)
    gl.uniform1i(this.advection.uniforms.uSource, 1)
    gl.uniform1f(this.advection.uniforms.uDt, clamped)
    gl.uniform1f(this.advection.uniforms.uDissipation, feel.velocityDissipation)
    gl.uniform1f(this.advection.uniforms.uAlphaDissipation, 1)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
    this.blit(this.velocity.write)
    this.velocity.swap()

    gl.useProgram(this.divergenceProg.id)
    gl.uniform1i(this.divergenceProg.uniforms.uVelocity, 0)
    gl.uniform2f(this.divergenceProg.uniforms.uTexelSize, texel[0], texel[1])
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
    this.blit(this.divergenceFbo)

    gl.useProgram(this.clearProg.id)
    gl.uniform4f(this.clearProg.uniforms.uValue, 0, 0, 0, 1)
    this.blit(this.pressure.write)
    this.pressure.swap()

    gl.useProgram(this.pressureProg.id)
    gl.uniform1i(this.pressureProg.uniforms.uPressure, 0)
    gl.uniform1i(this.pressureProg.uniforms.uDivergence, 1)
    gl.uniform2f(this.pressureProg.uniforms.uTexelSize, texel[0], texel[1])
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.divergenceFbo.tex)
    const iters = this.software ? 8 : Math.max(8, feel.pressureIters)
    for (let i = 0; i < iters; i++) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.tex)
      this.blit(this.pressure.write)
      this.pressure.swap()
    }

    gl.useProgram(this.gradientProg.id)
    gl.uniform1i(this.gradientProg.uniforms.uPressure, 0)
    gl.uniform1i(this.gradientProg.uniforms.uVelocity, 1)
    gl.uniform2f(this.gradientProg.uniforms.uTexelSize, texel[0], texel[1])
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.tex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
    this.blit(this.velocity.write)
    this.velocity.swap()

    gl.useProgram(this.advection.id)
    gl.uniform1i(this.advection.uniforms.uVelocity, 0)
    gl.uniform1i(this.advection.uniforms.uSource, 1)
    gl.uniform1f(this.advection.uniforms.uDt, clamped)
    gl.uniform1f(this.advection.uniforms.uDissipation, feel.dyeDissipation)
    gl.uniform1f(this.advection.uniforms.uAlphaDissipation, feel.heightDissipation)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.dye.read.tex)
    this.blit(this.dye.write)
    this.dye.swap()

    if (feel.heightLevel > 0.001) {
      gl.useProgram(this.levelProg.id)
      gl.uniform1i(this.levelProg.uniforms.uDye, 0)
      gl.uniform2f(this.levelProg.uniforms.uTexelSize, this.dye.read.texel[0], this.dye.read.texel[1])
      gl.uniform1f(this.levelProg.uniforms.uAmount, feel.heightLevel)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.dye.read.tex)
      this.blit(this.dye.write)
      this.dye.swap()
    }

    if (feel.slope > 0.0005) {
      gl.useProgram(this.slopeProg.id)
      gl.uniform1i(this.slopeProg.uniforms.uVelocity, 0)
      gl.uniform1i(this.slopeProg.uniforms.uDye, 1)
      gl.uniform2f(this.slopeProg.uniforms.uTexelSize, this.velocity.read.texel[0], this.velocity.read.texel[1])
      gl.uniform1f(this.slopeProg.uniforms.uSlope, feel.slope)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.dye.read.tex)
      this.blit(this.velocity.write)
      this.velocity.swap()
    }
  }

  render(light?: [number, number], time = 0): void {
    if (light) this.lastLight = light
    this.time = time
    const gl = this.gl
    const p = this.displayProg
    gl.useProgram(p.id)
    gl.uniform1i(p.uniforms.uDye, 0)
    gl.uniform1i(p.uniforms.uVelocity, 1)
    gl.uniform2f(p.uniforms.uTexelSize, this.dye.read.texel[0], this.dye.read.texel[1])
    gl.uniform2f(p.uniforms.uLight, this.lastLight[0], this.lastLight[1])
    gl.uniform1f(p.uniforms.uGloss, this.feel.gloss)
    gl.uniform1f(p.uniforms.uTime, this.time)
    gl.uniform1f(p.uniforms.uAspect, this.aspect)
    gl.uniform4f(
      p.uniforms.uFinger0,
      this.fingers[0]?.[0] ?? 0,
      this.fingers[0]?.[1] ?? 0,
      this.fingers[0]?.[2] ?? 0,
      this.fingers[0]?.[3] ?? 0,
    )
    gl.uniform4f(
      p.uniforms.uFinger1,
      this.fingers[1]?.[0] ?? 0,
      this.fingers[1]?.[1] ?? 0,
      this.fingers[1]?.[2] ?? 0,
      this.fingers[1]?.[3] ?? 0,
    )
    gl.uniform4f(
      p.uniforms.uFinger2,
      this.fingers[2]?.[0] ?? 0,
      this.fingers[2]?.[1] ?? 0,
      this.fingers[2]?.[2] ?? 0,
      this.fingers[2]?.[3] ?? 0,
    )
    gl.uniform3f(p.uniforms.uFingerTint, this.fingerTint[0], this.fingerTint[1], this.fingerTint[2])
    gl.uniform4f(p.uniforms.uTool, this.tool.uv[0], this.tool.uv[1], this.tool.radius, this.tool.kind)
    gl.uniform2f(p.uniforms.uToolDir, this.tool.dir[0], this.tool.dir[1])
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.dye.read.tex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex)
    this.blit(null)
  }
}
