#pragma once

#include "CoreMinimal.h"

class UMaterialInterface;

/** Builds dielectric oil / porcelain / steel materials in-editor and saves them under /Game. */
class FPaintMaterials
{
public:
	static UMaterialInterface* GetOil();
	static UMaterialInterface* GetPorcelain();
	static UMaterialInterface* GetSteel();

#if WITH_EDITOR
	static void EnsureSavedAssets();
#endif
};
