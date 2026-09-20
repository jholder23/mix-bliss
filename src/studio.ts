import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  ColorCurves,
  DefaultRenderingPipeline,
  DepthOfFieldEffectBlurLevel,
  DirectionalLight,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  ReflectionProbe,
  SSAO2RenderingPipeline,
  SSRRenderingPipeline,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector2,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core'
import { TRAY_R } from './fluid'

export type CameraShot = {
  id: string
  label: string
  alpha: number
  beta: number
  radius: number
}

/** Macro 3/4 is the default YouTube paint-mix angle: close, slightly above, dish filling the frame. */
export const SHOTS: CameraShot[] = [
  { id: 'three', label: '3/4', alpha: -0.88, beta: 0.92, radius: 5.2 },
  { id: 'top', label: 'Top', alpha: -0.95, beta: 0.08, radius: 5.7 },
  { id: 'front', label: 'Front', alpha: -Math.PI / 2, beta: 1.08, radius: 5.05 },
  { id: 'side', label: 'Side', alpha: 0.05, beta: 1.48, radius: 5.25 },
  { id: 'low', label: 'Low', alpha: -0.55, beta: 1.36, radius: 4.6 },
  { id: 'back', label: 'Back', alpha: 2.35, beta: 0.92, radius: 5.3 },
  { id: 'under', label: 'Under', alpha: -0.85, beta: 2.48, radius: 5.8 },
]

/** Softbox sits camera-left and high; light travels toward the tray. */
export const KEY_DIR = new Vector3(0.36, -0.78, -0.63)
/** Cooler window fill from camera-right. */
export const FILL_DIR = new Vector3(-0.62, -0.38, 0.42)
export const WINDOW_DIR = new Vector3(0.74, 0.34, -0.4)

function shortestAngle(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return from + d
}

export function detectSoftware(engine: Engine): boolean {
  try {
    const info = engine.getGlInfo()
    return /swiftshader|llvmpipe|softpipe|microsoft basic|software/i.test(info.renderer)
  } catch {
    return false
  }
}

function porcelain(scene: Scene, name: string): PBRMaterial {
  const mat = new PBRMaterial(name, scene)
  mat.albedoColor = new Color3(0.94, 0.91, 0.86)
  mat.metallic = 0.02
  mat.roughness = 0.34
  mat.environmentIntensity = 0.9
  mat.enableSpecularAntiAliasing = true
  mat.backFaceCulling = false
  mat.clearCoat.isEnabled = true
  mat.clearCoat.intensity = 0.22
  mat.clearCoat.roughness = 0.38
  return mat
}

function attachCinematicLook(scene: Scene, camera: ArcRotateCamera, software: boolean): void {
  if (software) {
    const ip = scene.imageProcessingConfiguration
    ip.toneMappingEnabled = true
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
    ip.contrast = 1.08
    ip.exposure = 1.02
    ip.vignetteEnabled = true
    ip.vignetteWeight = 1.1
    return
  }
  const pipe = new DefaultRenderingPipeline('macroLook', true, scene, [camera])
  pipe.fxaaEnabled = software
  pipe.samples = software ? 1 : 4
  pipe.sharpenEnabled = !software
  if (pipe.sharpen) {
    pipe.sharpen.edgeAmount = 0.18
    pipe.sharpen.colorAmount = 1
  }

  pipe.bloomEnabled = true
  pipe.bloomThreshold = 0.93
  pipe.bloomWeight = 0.07
  pipe.bloomKernel = 24
  pipe.bloomScale = software ? 0.35 : 0.5

  pipe.imageProcessingEnabled = true
  const ip = pipe.imageProcessing
  if (ip) {
    ip.toneMappingEnabled = true
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
    ip.contrast = 1.16
    ip.exposure = 0.94
    ip.ditheringEnabled = true
    ip.vignetteEnabled = true
    ip.vignetteWeight = 1.35
    ip.vignetteStretch = 0.28
    ip.vignetteColor = new Color4(0.07, 0.05, 0.04, 0)
    ip.vignetteCameraFov = camera.fov
    const curves = new ColorCurves()
    curves.globalSaturation = 6
    curves.midtonesSaturation = 5
    curves.highlightsSaturation = -10
    curves.highlightsExposure = -14
    curves.shadowsSaturation = 4
    curves.globalExposure = 0
    ip.colorCurves = curves
    ip.colorCurvesEnabled = true
  }

  pipe.grainEnabled = true
  pipe.grain.intensity = software ? 7.2 : 4.8
  pipe.grain.animated = true

  pipe.chromaticAberrationEnabled = true
  pipe.chromaticAberration.aberrationAmount = software ? 6 : 12
  pipe.chromaticAberration.radialIntensity = 0.45
  pipe.chromaticAberration.direction = new Vector2(0.92, 0.18)

  if (!software) {
    try {
      pipe.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.Medium
      pipe.depthOfFieldEnabled = true
      pipe.depthOfField.fStop = 2.4
      pipe.depthOfField.focalLength = 85
      pipe.depthOfField.lensSize = 50
      pipe.depthOfField.focusDistance = camera.radius * 1000
    } catch {
      pipe.depthOfFieldEnabled = false
    }
  }

  scene.onBeforeRenderObservable.add(() => {
    if (!pipe.depthOfFieldEnabled) return
    const focus = Vector3.Distance(camera.position, camera.target)
    pipe.depthOfField.focusDistance = Math.max(800, focus * 1000)
  })
}

export function createStudio(canvas: HTMLCanvasElement): {
  engine: Engine
  scene: Scene
  camera: ArcRotateCamera
  tray: Mesh
  software: boolean
  lookTo: (shot: CameraShot) => void
  isSettling: () => boolean
  setToolGhost: (kind: number, pos: Vector3 | null, dir: Vector3) => void
  setLeftOrbit: (on: boolean) => void
  getOrbitButtons: () => number[]
  nudgeOrbit: (dx: number, dy: number) => void
  addShadowCaster: (mesh: Mesh) => void
} {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true,
    adaptToDeviceRatio: true,
    powerPreference: 'high-performance',
    audioEngine: false,
  })
  const software = detectSoftware(engine)
  engine.setHardwareScalingLevel(software ? 1.35 : 0.72)

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.38, 0.34, 0.3, 1)
  scene.ambientColor = new Color3(0.16, 0.15, 0.14)
  scene.collisionsEnabled = false
  scene.imageProcessingConfiguration.toneMappingEnabled = true
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES

  const start = SHOTS[0] ?? { id: 'three', label: '3/4', alpha: -0.88, beta: 0.92, radius: 5.2 }
  const camera = new ArcRotateCamera('cam', start.alpha, start.beta, start.radius, new Vector3(0, 0.26, 0), scene)
  camera.fov = 0.56
  camera.fovMode = Camera.FOVMODE_VERTICAL_FIXED
  camera.lowerRadiusLimit = 1.7
  camera.upperRadiusLimit = 14
  camera.lowerBetaLimit = 0.04
  camera.upperBetaLimit = Math.PI - 0.04
  camera.allowUpsideDown = true
  camera.panningSensibility = 0
  camera.wheelPrecision = 52
  camera.pinchPrecision = 80
  camera.angularSensibilityX = 1180
  camera.angularSensibilityY = 1180
  camera.minZ = 0.06
  camera.maxZ = 80
  camera.inertia = 0.74
  camera.keysUp = [38]
  camera.keysDown = [40]
  camera.keysLeft = [37]
  camera.keysRight = [39]
  camera.attachControl(canvas, true)
  const pointers = camera.inputs.attached.pointers as { buttons?: number[] } | undefined
  const applyOrbitButtons = (left: boolean) => {
    if (!pointers) return
    pointers.buttons = left ? [0, 1, 2] : [1, 2]
  }
  applyOrbitButtons(false)

  const key = new DirectionalLight('key', KEY_DIR, scene)
  key.intensity = software ? 1.05 : 1.22
  key.diffuse = new Color3(1, 0.96, 0.9)
  const fill = new HemisphericLight('fill', new Vector3(0.15, 1, 0.2), scene)
  fill.intensity = 0.28
  fill.diffuse = new Color3(0.92, 0.9, 0.88)
  fill.groundColor = new Color3(0.32, 0.24, 0.18)
  const windowLight = new PointLight('window', new Vector3(4.6, 3.4, -2.4), scene)
  windowLight.intensity = software ? 10 : 16
  windowLight.diffuse = new Color3(0.72, 0.84, 1)
  const bounce = new DirectionalLight('bounce', new Vector3(0.12, 0.95, -0.18), scene)
  bounce.intensity = 0.18
  bounce.diffuse = new Color3(0.62, 0.48, 0.34)

  const table = MeshBuilder.CreateTorus(
    'table',
    { diameter: 8.45, thickness: 3.05, tessellation: software ? 28 : 52 },
    scene,
  )
  table.scaling.y = 0.1
  table.position.y = -0.14
  const wood = new PBRMaterial('wood', scene)
  wood.albedoColor = new Color3(0.24, 0.14, 0.08)
  wood.metallic = 0
  wood.roughness = 0.72
  table.material = wood

  const tray = MeshBuilder.CreateGround('tray', { width: TRAY_R * 2.15, height: TRAY_R * 2.15, subdivisions: software ? 36 : 64 }, scene)
  const pos = tray.getVerticesData(VertexBuffer.PositionKind)
  if (pos) {
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i] ?? 0
      const z = pos[i + 2] ?? 0
      const r = Math.hypot(x, z) / TRAY_R
      const bowl = r * r * 0.2
      pos[i + 1] = 0.04 + bowl
    }
    tray.updateVerticesData(VertexBuffer.PositionKind, pos)
    tray.createNormals(true)
  }
  const dishMat = porcelain(scene, 'dish')
  const bowlMat = porcelain(scene, 'bowl')
  bowlMat.backFaceCulling = true
  tray.material = bowlMat
  tray.alwaysSelectAsActiveMesh = true

  const dishBody = MeshBuilder.CreateCylinder(
    'dishBody',
    { diameter: TRAY_R * 2.18, height: 0.16, tessellation: software ? 28 : 48, cap: Mesh.NO_CAP },
    scene,
  )
  dishBody.position.y = -0.04
  dishBody.material = dishMat
  dishBody.isPickable = false

  const rim = MeshBuilder.CreateTorus('rim', { diameter: TRAY_R * 2.05, thickness: 0.16, tessellation: software ? 32 : 64 }, scene)
  rim.position.y = 0.22
  rim.material = dishMat
  rim.isPickable = false

  const wall = MeshBuilder.CreateBox('room', { width: 28, height: 24, depth: 28 }, scene)
  wall.position.y = 6
  const wallMat = new StandardMaterial('wall', scene)
  wallMat.diffuseColor = new Color3(0.48, 0.44, 0.4)
  wallMat.specularColor = Color3.Black()
  wallMat.backFaceCulling = false
  wall.material = wallMat
  wall.isPickable = false
  wall.scaling.x = -1

  const pit = MeshBuilder.CreateGround('pit', { width: 28, height: 28 }, scene)
  pit.position.y = -5.6
  const pitMat = new StandardMaterial('pit', scene)
  pitMat.diffuseColor = new Color3(0.08, 0.07, 0.06)
  pitMat.specularColor = Color3.Black()
  pit.material = pitMat
  pit.isPickable = false

  const cyc = MeshBuilder.CreatePlane('cyc', { width: 18, height: 10 }, scene)
  cyc.position = new Vector3(-1.2, 3.2, 8.4)
  const cycMat = new StandardMaterial('cycMat', scene)
  cycMat.diffuseColor = new Color3(0.58, 0.54, 0.48)
  cycMat.specularColor = Color3.Black()
  cyc.material = cycMat
  cyc.isPickable = false

  const softbox = MeshBuilder.CreatePlane('softbox', { width: 8.2, height: 4.6 }, scene)
  softbox.position = new Vector3(-3.1, 5.6, 3.8)
  softbox.rotation = new Vector3(0.92, 0.28, 0)
  const emit = new StandardMaterial('emit', scene)
  emit.emissiveColor = new Color3(1.55, 1.42, 1.28)
  emit.disableLighting = true
  emit.backFaceCulling = false
  softbox.material = emit
  softbox.isPickable = false

  const windowPane = MeshBuilder.CreatePlane('windowPane', { width: 3.6, height: 4.8 }, scene)
  windowPane.position = new Vector3(5.8, 3.5, -2.2)
  windowPane.rotation.y = Math.PI / 2
  const winMat = new StandardMaterial('win', scene)
  winMat.emissiveColor = new Color3(2.1, 2.35, 2.7)
  winMat.disableLighting = true
  windowPane.material = winMat
  windowPane.isPickable = false

  if (software) {
    scene.environmentIntensity = 0.55
  } else {
    const probe = new ReflectionProbe('studioProbe', 128, scene, false)
    probe.refreshRate = 24
    probe.renderList = [wall, cyc, softbox, windowPane, table, dishBody, rim, pit]
    scene.environmentTexture = probe.cubeTexture
    scene.environmentIntensity = 0.88
  }

  let shadows: ShadowGenerator | null = null
  if (!software) {
    key.autoCalcShadowZBounds = true
    shadows = new ShadowGenerator(1024, key)
    shadows.useBlurExponentialShadowMap = true
    shadows.blurKernel = 24
    shadows.darkness = 0.42
    shadows.addShadowCaster(tray)
    shadows.addShadowCaster(dishBody)
    shadows.addShadowCaster(rim)
    table.receiveShadows = true
    tray.receiveShadows = true
  }

  attachCinematicLook(scene, camera, software)

  if (!software) {
    try {
      scene.enableDepthRenderer(camera, false)
      const ssao = new SSAO2RenderingPipeline('ssao', scene, 0.5, [camera])
      ssao.totalStrength = 0.62
      ssao.radius = 1.05
      ssao.expensiveBlur = true
    } catch {
      /* missing samples */
    }
    try {
      const ssr = new SSRRenderingPipeline('ssr', scene, [camera])
      ssr.thickness = 0.1
      ssr.selfCollisionNumSkip = 2
      ssr.enableAutomaticThicknessComputation = false
      ssr.environmentTexture = null
      ssr.strength = 0.28
      ssr.reflectionSpecularFalloffExponent = 5
    } catch {
      /* SSR not available */
    }
  }

  let goal: CameraShot | null = null
  scene.onBeforeRenderObservable.add(() => {
    if (!goal) return
    const wantA = shortestAngle(camera.alpha, goal.alpha)
    camera.alpha += (wantA - camera.alpha) * 0.32
    camera.beta += (goal.beta - camera.beta) * 0.32
    camera.radius += (goal.radius - camera.radius) * 0.32
    if (
      Math.abs(shortestAngle(camera.alpha, goal.alpha) - camera.alpha) < 0.004 &&
      Math.abs(camera.beta - goal.beta) < 0.004 &&
      Math.abs(camera.radius - goal.radius) < 0.02
    ) {
      camera.alpha = goal.alpha
      camera.beta = goal.beta
      camera.radius = goal.radius
      goal = null
    }
  })

  const knife = MeshBuilder.CreateBox('knife', { width: 0.9, height: 0.03, depth: 0.16 }, scene)
  const metal = new PBRMaterial('metal', scene)
  metal.albedoColor = new Color3(0.62, 0.63, 0.65)
  metal.metallic = 1
  metal.roughness = 0.18
  knife.material = metal
  knife.isVisible = false
  knife.isPickable = false
  const stick = MeshBuilder.CreateCylinder('stick', { height: 1.1, diameter: 0.07, tessellation: 10 }, scene)
  const stickMat = new PBRMaterial('stickMat', scene)
  stickMat.albedoColor = new Color3(0.42, 0.26, 0.13)
  stickMat.roughness = 0.7
  stickMat.metallic = 0
  stick.material = stickMat
  stick.isVisible = false
  stick.isPickable = false
  const finger = MeshBuilder.CreateSphere('finger', { diameter: 0.38, segments: 12 }, scene)
  const skin = new PBRMaterial('skin', scene)
  skin.albedoColor = new Color3(0.72, 0.48, 0.36)
  skin.roughness = 0.45
  skin.metallic = 0
  skin.subSurface.isTranslucencyEnabled = true
  skin.subSurface.tintColor = new Color3(0.7, 0.2, 0.12)
  finger.material = skin
  finger.isVisible = false
  finger.isPickable = false

  return {
    engine,
    scene,
    camera,
    tray,
    software,
    lookTo(shot) {
      camera.inertialAlphaOffset = 0
      camera.inertialBetaOffset = 0
      camera.inertialRadiusOffset = 0
      camera.alpha = shortestAngle(camera.alpha, shot.alpha)
      camera.beta = shot.beta
      camera.radius = shot.radius
      goal = null
    },
    isSettling() {
      return goal !== null
    },
    setToolGhost(kind, pos, dir) {
      knife.isVisible = false
      stick.isVisible = false
      finger.isVisible = false
      if (!pos) return
      if (kind === 1) {
        finger.isVisible = true
        finger.position.copyFrom(pos)
        finger.position.y += 0.12
      } else if (kind === 2) {
        knife.isVisible = true
        knife.position.copyFrom(pos)
        knife.position.y += 0.04
        const yaw = Math.atan2(dir.x, dir.z)
        knife.rotation.y = yaw
      } else if (kind === 3) {
        stick.isVisible = true
        stick.position.copyFrom(pos)
        stick.position.y += 0.45
        stick.rotation.z = 0.35
      }
    },
    setLeftOrbit(on) {
      applyOrbitButtons(on)
    },
    getOrbitButtons() {
      return pointers?.buttons ? [...pointers.buttons] : []
    },
    nudgeOrbit(dx, dy) {
      camera.alpha -= dx / 480
      camera.beta = Math.min(camera.upperBetaLimit ?? Math.PI, Math.max(camera.lowerBetaLimit ?? 0.04, camera.beta - dy / 480))
    },
    addShadowCaster(mesh) {
      shadows?.addShadowCaster(mesh)
      mesh.receiveShadows = true
    },
  }
}
