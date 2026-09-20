import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  DefaultRenderingPipeline,
  SSAO2RenderingPipeline,
  SSRRenderingPipeline,
  ReflectionProbe,
} from '@babylonjs/core'
import { TRAY_R } from './fluid'

export type CameraShot = {
  id: string
  label: string
  alpha: number
  beta: number
  radius: number
}

export const SHOTS: CameraShot[] = [
  { id: 'three', label: '3/4', alpha: -0.95, beta: 1.05, radius: 6.6 },
  { id: 'top', label: 'Top', alpha: -0.95, beta: 0.12, radius: 7.4 },
  { id: 'front', label: 'Front', alpha: -Math.PI / 2, beta: 1.18, radius: 6.5 },
  { id: 'side', label: 'Side', alpha: 0.05, beta: 1.48, radius: 6.8 },
  { id: 'low', label: 'Low', alpha: -0.55, beta: 1.42, radius: 5.7 },
  { id: 'back', label: 'Back', alpha: 2.35, beta: 1.08, radius: 6.7 },
  { id: 'under', label: 'Under', alpha: -0.85, beta: 1.68, radius: 5.5 },
]

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
  mat.albedoColor = new Color3(0.93, 0.9, 0.84)
  mat.metallic = 0.04
  mat.roughness = 0.22
  mat.environmentIntensity = 0.85
  mat.enableSpecularAntiAliasing = true
  mat.backFaceCulling = false
  return mat
}

export function createStudio(canvas: HTMLCanvasElement): {
  engine: Engine
  scene: Scene
  camera: ArcRotateCamera
  tray: Mesh
  software: boolean
  lookTo: (shot: CameraShot) => void
  setToolGhost: (kind: number, pos: Vector3 | null, dir: Vector3) => void
  setLeftOrbit: (on: boolean) => void
} {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: false,
    antialias: true,
    adaptToDeviceRatio: true,
    powerPreference: 'default',
    audioEngine: false,
  })
  const software = detectSoftware(engine)
  if (software) engine.setHardwareScalingLevel(1.15)

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.12, 0.1, 0.09, 1)
  scene.ambientColor = new Color3(0.18, 0.16, 0.14)
  scene.collisionsEnabled = false

  const camera = new ArcRotateCamera('cam', -0.95, 1.05, 6.6, new Vector3(0, 0.22, 0), scene)
  camera.lowerRadiusLimit = 2.2
  camera.upperRadiusLimit = 16
  camera.lowerBetaLimit = 0.04
  camera.upperBetaLimit = Math.PI - 0.04
  camera.allowUpsideDown = true
  camera.panningSensibility = 0
  camera.wheelPrecision = 38
  camera.pinchPrecision = 70
  camera.angularSensibilityX = 1100
  camera.angularSensibilityY = 1100
  camera.minZ = 0.04
  camera.maxZ = 80
  camera.inertia = 0.72
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

  const key = new DirectionalLight('key', new Vector3(-0.35, -1.15, -0.28), scene)
  key.intensity = software ? 1.15 : 1.45
  key.diffuse = new Color3(1, 0.97, 0.92)
  const fill = new HemisphericLight('fill', new Vector3(0.2, 1, 0.35), scene)
  fill.intensity = 0.35
  fill.groundColor = new Color3(0.28, 0.22, 0.16)
  const windowLight = new PointLight('window', new Vector3(3.4, 3.2, -2.8), scene)
  windowLight.intensity = software ? 12 : 22
  windowLight.diffuse = new Color3(0.95, 0.97, 1)

  const table = MeshBuilder.CreateBox('table', { width: 9, height: 0.28, depth: 9 }, scene)
  table.position.y = -0.16
  const wood = new PBRMaterial('wood', scene)
  wood.albedoColor = new Color3(0.28, 0.17, 0.1)
  wood.metallic = 0
  wood.roughness = 0.62
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
  tray.material = dishMat
  tray.alwaysSelectAsActiveMesh = true

  const dishBody = MeshBuilder.CreateCylinder(
    'dishBody',
    { diameter: TRAY_R * 2.18, height: 0.16, tessellation: software ? 28 : 48 },
    scene,
  )
  dishBody.position.y = -0.04
  dishBody.material = dishMat
  dishBody.isPickable = false

  const rim = MeshBuilder.CreateTorus('rim', { diameter: TRAY_R * 2.05, thickness: 0.16, tessellation: software ? 32 : 64 }, scene)
  rim.position.y = 0.22
  rim.material = dishMat
  rim.isPickable = false

  const wall = MeshBuilder.CreateBox('room', { width: 28, height: 16, depth: 28 }, scene)
  wall.position.y = 6
  const wallMat = new StandardMaterial('wall', scene)
  wallMat.diffuseColor = new Color3(0.18, 0.16, 0.14)
  wallMat.specularColor = Color3.Black()
  wallMat.backFaceCulling = false
  wallMat.disableLighting = false
  wall.material = wallMat
  wall.isPickable = false
  wall.scaling.x = -1

  const softbox = MeshBuilder.CreatePlane('softbox', { width: 6.5, height: 3.4 }, scene)
  softbox.position = new Vector3(-2.4, 5.2, 4.2)
  softbox.rotation = new Vector3(0.85, 0.2, 0)
  const emit = new StandardMaterial('emit', scene)
  emit.emissiveColor = new Color3(2.4, 2.2, 2.0)
  emit.disableLighting = true
  emit.backFaceCulling = false
  softbox.material = emit
  softbox.isPickable = false

  const windowPane = MeshBuilder.CreatePlane('windowPane', { width: 3.2, height: 4.4 }, scene)
  windowPane.position = new Vector3(5.6, 3.4, -2.2)
  windowPane.rotation.y = Math.PI / 2
  const winMat = new StandardMaterial('win', scene)
  winMat.emissiveColor = new Color3(3.2, 3.3, 3.5)
  winMat.disableLighting = true
  windowPane.material = winMat
  windowPane.isPickable = false

  const probe = new ReflectionProbe('studioProbe', software ? 64 : 128, scene, false)
  probe.refreshRate = software ? 90 : 24
  probe.renderList = [wall, softbox, windowPane, table, dishBody, rim]
  scene.environmentTexture = probe.cubeTexture
  scene.environmentIntensity = 0.95

  if (!software) {
    key.autoCalcShadowZBounds = true
    const shadows = new ShadowGenerator(1024, key)
    shadows.useBlurExponentialShadowMap = true
    shadows.blurKernel = 16
    shadows.addShadowCaster(tray)
    table.receiveShadows = true
    tray.receiveShadows = true
  }

  const pipe = new DefaultRenderingPipeline('look', !software, scene, [camera])
  pipe.fxaaEnabled = !software
  pipe.bloomEnabled = true
  pipe.bloomThreshold = 0.82
  pipe.bloomWeight = 0.18
  pipe.bloomKernel = 32
  pipe.imageProcessingEnabled = true
  if (pipe.imageProcessing) {
    pipe.imageProcessing.contrast = 1.08
    pipe.imageProcessing.exposure = 1.05
    pipe.imageProcessing.toneMappingEnabled = true
    pipe.imageProcessing.vignetteEnabled = true
    pipe.imageProcessing.vignetteWeight = 1.6
  }
  pipe.grainEnabled = true
  pipe.grain.intensity = 6.5
  if (!software) {
    try {
      scene.enableDepthRenderer(camera, false)
      const ssao = new SSAO2RenderingPipeline('ssao', scene, 0.55, [camera])
      ssao.totalStrength = 0.7
      ssao.radius = 1.6
    } catch {
      /* missing samples */
    }
    try {
      const ssr = new SSRRenderingPipeline('ssr', scene, [camera])
      ssr.thickness = 0.12
      ssr.selfCollisionNumSkip = 2
      ssr.enableAutomaticThicknessComputation = false
      ssr.environmentTexture = null
      ssr.strength = 0.55
      ssr.reflectionSpecularFalloffExponent = 4
    } catch {
      /* SSR not available */
    }
  }

  let goal: CameraShot | null = null
  scene.onBeforeRenderObservable.add(() => {
    if (!goal) return
    const wantA = shortestAngle(camera.alpha, goal.alpha)
    camera.alpha += (wantA - camera.alpha) * 0.22
    camera.beta += (goal.beta - camera.beta) * 0.22
    camera.radius += (goal.radius - camera.radius) * 0.22
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
      goal = shot
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
  }
}
