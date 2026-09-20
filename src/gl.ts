export class GLError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GLError'
  }
}

export function createGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  })
  if (!gl) {
    throw new GLError('This mixer needs WebGL2. Try a current Chrome, Firefox, or Safari — not a text-only or ancient browser.')
  }
  return gl
}

export function compileProgram(gl: WebGL2RenderingContext, vert: string, frag: string, label: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vert, `${label} vertex`)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag, `${label} fragment`)
  const program = gl.createProgram()
  if (!program) throw new GLError('WebGL2 could not create a shader program.')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown link error'
    throw new GLError(`Paint shader failed to link (${label}): ${log}`)
  }
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  return program
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new GLError('WebGL2 could not create a shader.')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown compile error'
    throw new GLError(`Paint shader failed to compile (${label}): ${log}`)
  }
  return shader
}

export type FloatFormat = {
  internal: number
  format: number
  type: number
  filter: number
}

export function pickFloatFormat(gl: WebGL2RenderingContext): FloatFormat {
  const color32 = gl.getExtension('EXT_color_buffer_float')
  const color16 = gl.getExtension('EXT_color_buffer_half_float')
  const linear32 = gl.getExtension('OES_texture_float_linear')
  const linear16 = gl.getExtension('OES_texture_half_float_linear')

  if (color16) {
    const ok = testColorBuffer(gl, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
    if (ok) {
      return {
        internal: gl.RGBA16F,
        format: gl.RGBA,
        type: gl.HALF_FLOAT,
        filter: linear16 ? gl.LINEAR : gl.NEAREST,
      }
    }
  }
  if (color32) {
    const ok = testColorBuffer(gl, gl.RGBA32F, gl.RGBA, gl.FLOAT)
    if (ok) {
      return {
        internal: gl.RGBA32F,
        format: gl.RGBA,
        type: gl.FLOAT,
        filter: linear32 ? gl.LINEAR : gl.NEAREST,
      }
    }
  }
  throw new GLError(
    'This mixer needs WebGL2 with floating-point color buffers (half or full float). The paint film cannot be drawn on this GPU/driver.',
  )
}

function testColorBuffer(gl: WebGL2RenderingContext, internal: number, format: number, type: number): boolean {
  const tex = gl.createTexture()
  const fbo = gl.createFramebuffer()
  if (!tex || !fbo) return false
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, format, type, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.deleteFramebuffer(fbo)
  gl.deleteTexture(tex)
  return status === gl.FRAMEBUFFER_COMPLETE
}

export function createTexture2D(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  fmt: FloatFormat,
): WebGLTexture {
  const tex = gl.createTexture()
  if (!tex) throw new GLError('WebGL2 ran out of textures.')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, fmt.filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, fmt.filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, width, height, 0, fmt.format, fmt.type, null)
  return tex
}

export function createFbo(gl: WebGL2RenderingContext, attachments: WebGLTexture[]): WebGLFramebuffer {
  const fbo = gl.createFramebuffer()
  if (!fbo) throw new GLError('WebGL2 ran out of framebuffers.')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  const bufs: number[] = []
  for (let i = 0; i < attachments.length; i++) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, attachments[i]!, 0)
    bufs.push(gl.COLOR_ATTACHMENT0 + i)
  }
  gl.drawBuffers(bufs)
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new GLError('WebGL2 could not allocate the paint film buffer.')
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return fbo
}

export function resizeTexture(gl: WebGL2RenderingContext, tex: WebGLTexture, width: number, height: number, fmt: FloatFormat): void {
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, width, height, 0, fmt.format, fmt.type, null)
}
