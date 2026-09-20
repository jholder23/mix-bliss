import {
  Color3,
  FresnelParameters,
  StandardMaterial,
  type Scene,
} from '@babylonjs/core'

export function createPaintMaterial(scene: Scene, _software = false): StandardMaterial {
  const mat = new StandardMaterial('impastoPaint', scene)
  mat.diffuseColor = Color3.White()
  mat.specularColor = new Color3(0.95, 0.93, 0.88)
  mat.specularPower = 88
  mat.ambientColor = new Color3(0.55, 0.55, 0.55)
  mat.useAlphaFromDiffuseTexture = true
  mat.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST
  mat.alphaCutOff = 0.05
  mat.backFaceCulling = false
  mat.reflectionTexture = scene.environmentTexture
  mat.reflectionFresnelParameters = new FresnelParameters()
  mat.reflectionFresnelParameters.bias = 0.1
  mat.reflectionFresnelParameters.power = 2.2
  mat.emissiveColor = new Color3(0.06, 0.05, 0.04)
  return mat
}
