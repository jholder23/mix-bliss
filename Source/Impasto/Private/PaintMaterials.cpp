#include "PaintMaterials.h"
#include "Materials/Material.h"
#include "UObject/Package.h"

#if WITH_EDITOR
#include "Materials/MaterialExpressionVertexColor.h"
#include "Materials/MaterialExpressionScalarParameter.h"
#include "Materials/MaterialExpressionVectorParameter.h"
#include "MaterialEditingLibrary.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "FileHelpers.h"
#endif

namespace
{
	UMaterialInterface* LoadIfExists(const TCHAR* Path)
	{
		return LoadObject<UMaterialInterface>(nullptr, Path);
	}

#if WITH_EDITOR
	UMaterial* CreateMaterial(UPackage* Pkg, const FName Name)
	{
		UMaterial* Mat = NewObject<UMaterial>(Pkg, Name, RF_Public | RF_Standalone);
		Mat->MaterialDomain = MD_Surface;
		Mat->BlendMode = BLEND_Opaque;
		Mat->bUsedWithProceduralMesh = true;
		Mat->TwoSided = false;
		return Mat;
	}

	void AddExpr(UMaterial* Mat, UMaterialExpression* Expr)
	{
		if (UMaterialEditorOnlyData* Ed = Mat->GetEditorOnlyData())
		{
			Ed->ExpressionCollection.Expressions.Add(Expr);
		}
	}

	void Finish(UMaterial* Mat)
	{
		Mat->PreEditChange(nullptr);
		Mat->PostEditChange();
		UMaterialEditingLibrary::RecompileMaterial(Mat);
		FAssetRegistryModule::AssetCreated(Mat);
		Mat->MarkPackageDirty();
	}

	void SavePkg(UPackage* Pkg)
	{
		TArray<UPackage*> Packages;
		Packages.Add(Pkg);
		UEditorLoadingAndSavingUtils::SavePackages(Packages, true);
	}
#endif
}

UMaterialInterface* FPaintMaterials::GetOil()
{
	if (UMaterialInterface* Existing = LoadIfExists(TEXT("/Game/Impasto/Materials/M_OilPaint.M_OilPaint")))
	{
		return Existing;
	}
#if WITH_EDITOR
	EnsureSavedAssets();
	if (UMaterialInterface* Existing = LoadIfExists(TEXT("/Game/Impasto/Materials/M_OilPaint.M_OilPaint")))
	{
		return Existing;
	}
#endif
	return UMaterial::GetDefaultMaterial(MD_Surface);
}

UMaterialInterface* FPaintMaterials::GetPorcelain()
{
	if (UMaterialInterface* Existing = LoadIfExists(TEXT("/Game/Impasto/Materials/M_Porcelain.M_Porcelain")))
	{
		return Existing;
	}
#if WITH_EDITOR
	EnsureSavedAssets();
	if (UMaterialInterface* Existing = LoadIfExists(TEXT("/Game/Impasto/Materials/M_Porcelain.M_Porcelain")))
	{
		return Existing;
	}
#endif
	return UMaterial::GetDefaultMaterial(MD_Surface);
}

UMaterialInterface* FPaintMaterials::GetSteel()
{
	if (UMaterialInterface* Existing = LoadIfExists(TEXT("/Game/Impasto/Materials/M_SteelKnife.M_SteelKnife")))
	{
		return Existing;
	}
#if WITH_EDITOR
	EnsureSavedAssets();
	if (UMaterialInterface* Existing = LoadIfExists(TEXT("/Game/Impasto/Materials/M_SteelKnife.M_SteelKnife")))
	{
		return Existing;
	}
#endif
	return UMaterial::GetDefaultMaterial(MD_Surface);
}

#if WITH_EDITOR
void FPaintMaterials::EnsureSavedAssets()
{
	if (!LoadIfExists(TEXT("/Game/Impasto/Materials/M_OilPaint.M_OilPaint")))
	{
		UPackage* Pkg = CreatePackage(TEXT("/Game/Impasto/Materials/M_OilPaint"));
		UMaterial* Mat = CreateMaterial(Pkg, TEXT("M_OilPaint"));
		Mat->SetShadingModel(MSM_ClearCoat);

		UMaterialExpressionVertexColor* VertColor = NewObject<UMaterialExpressionVertexColor>(Mat);
		VertColor->MaterialExpressionEditorX = -600;

		UMaterialExpressionScalarParameter* Spec = NewObject<UMaterialExpressionScalarParameter>(Mat);
		Spec->ParameterName = TEXT("Specular");
		Spec->DefaultValue = 0.5f;
		Spec->MaterialExpressionEditorX = -400;
		Spec->MaterialExpressionEditorY = 160;

		UMaterialExpressionScalarParameter* Rough = NewObject<UMaterialExpressionScalarParameter>(Mat);
		Rough->ParameterName = TEXT("Roughness");
		Rough->DefaultValue = 0.12f;
		Rough->MaterialExpressionEditorX = -400;
		Rough->MaterialExpressionEditorY = 240;

		UMaterialExpressionScalarParameter* Coat = NewObject<UMaterialExpressionScalarParameter>(Mat);
		Coat->ParameterName = TEXT("ClearCoat");
		Coat->DefaultValue = 1.f;
		Coat->MaterialExpressionEditorX = -400;
		Coat->MaterialExpressionEditorY = 320;

		UMaterialExpressionScalarParameter* CoatRough = NewObject<UMaterialExpressionScalarParameter>(Mat);
		CoatRough->ParameterName = TEXT("ClearCoatRoughness");
		CoatRough->DefaultValue = 0.04f;
		CoatRough->MaterialExpressionEditorX = -400;
		CoatRough->MaterialExpressionEditorY = 400;

		AddExpr(Mat, VertColor);
		AddExpr(Mat, Spec);
		AddExpr(Mat, Rough);
		AddExpr(Mat, Coat);
		AddExpr(Mat, CoatRough);

		UMaterialEditorOnlyData* Ed = Mat->GetEditorOnlyData();
		Ed->BaseColor.Expression = VertColor;
		Ed->Specular.Expression = Spec;
		Ed->Roughness.Expression = Rough;
		Ed->ClearCoat.Expression = Coat;
		Ed->ClearCoatRoughness.Expression = CoatRough;
		Finish(Mat);
		SavePkg(Pkg);
	}

	if (!LoadIfExists(TEXT("/Game/Impasto/Materials/M_Porcelain.M_Porcelain")))
	{
		UPackage* Pkg = CreatePackage(TEXT("/Game/Impasto/Materials/M_Porcelain"));
		UMaterial* Mat = CreateMaterial(Pkg, TEXT("M_Porcelain"));
		Mat->SetShadingModel(MSM_DefaultLit);

		UMaterialExpressionVectorParameter* Base = NewObject<UMaterialExpressionVectorParameter>(Mat);
		Base->ParameterName = TEXT("Porcelain");
		Base->DefaultValue = FLinearColor(0.84f, 0.82f, 0.78f);
		Base->MaterialExpressionEditorX = -400;

		UMaterialExpressionScalarParameter* Rough = NewObject<UMaterialExpressionScalarParameter>(Mat);
		Rough->ParameterName = TEXT("Roughness");
		Rough->DefaultValue = 0.38f;
		Rough->MaterialExpressionEditorX = -400;
		Rough->MaterialExpressionEditorY = 120;

		UMaterialExpressionScalarParameter* Spec = NewObject<UMaterialExpressionScalarParameter>(Mat);
		Spec->ParameterName = TEXT("Specular");
		Spec->DefaultValue = 0.5f;
		Spec->MaterialExpressionEditorX = -400;
		Spec->MaterialExpressionEditorY = 200;

		AddExpr(Mat, Base);
		AddExpr(Mat, Rough);
		AddExpr(Mat, Spec);
		UMaterialEditorOnlyData* Ed = Mat->GetEditorOnlyData();
		Ed->BaseColor.Expression = Base;
		Ed->Roughness.Expression = Rough;
		Ed->Specular.Expression = Spec;
		Finish(Mat);
		SavePkg(Pkg);
	}

	if (!LoadIfExists(TEXT("/Game/Impasto/Materials/M_SteelKnife.M_SteelKnife")))
	{
		UPackage* Pkg = CreatePackage(TEXT("/Game/Impasto/Materials/M_SteelKnife"));
		UMaterial* Mat = CreateMaterial(Pkg, TEXT("M_SteelKnife"));
		Mat->SetShadingModel(MSM_DefaultLit);

		UMaterialExpressionVectorParameter* Base = NewObject<UMaterialExpressionVectorParameter>(Mat);
		Base->ParameterName = TEXT("Steel");
		Base->DefaultValue = FLinearColor(0.18f, 0.18f, 0.2f);
		Base->MaterialExpressionEditorX = -400;

		UMaterialExpressionScalarParameter* Metal = NewObject<UMaterialExpressionScalarParameter>(Mat);
		Metal->ParameterName = TEXT("Metallic");
		Metal->DefaultValue = 1.f;
		Metal->MaterialExpressionEditorX = -400;
		Metal->MaterialExpressionEditorY = 120;

		UMaterialExpressionScalarParameter* Rough = NewObject<UMaterialExpressionScalarParameter>(Mat);
		Rough->ParameterName = TEXT("Roughness");
		Rough->DefaultValue = 0.22f;
		Rough->MaterialExpressionEditorX = -400;
		Rough->MaterialExpressionEditorY = 200;

		AddExpr(Mat, Base);
		AddExpr(Mat, Metal);
		AddExpr(Mat, Rough);
		UMaterialEditorOnlyData* Ed = Mat->GetEditorOnlyData();
		Ed->BaseColor.Expression = Base;
		Ed->Metallic.Expression = Metal;
		Ed->Roughness.Expression = Rough;
		Finish(Mat);
		SavePkg(Pkg);
	}
}
#endif
