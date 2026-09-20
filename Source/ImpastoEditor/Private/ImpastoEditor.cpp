#include "ImpastoEditor.h"
#include "PaintMaterials.h"
#include "Misc/CoreDelegates.h"
#include "Misc/PackageName.h"
#include "FileHelpers.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Editor.h"
#include "Engine/World.h"
#include "UObject/SavePackage.h"

#define LOCTEXT_NAMESPACE "FImpastoEditorModule"

namespace
{
	void EnsurePaintTrayMap()
	{
		const FString Path = TEXT("/Game/Maps/PaintTray");
		if (FPackageName::DoesPackageExist(Path) || FindObject<UWorld>(nullptr, TEXT("/Game/Maps/PaintTray.PaintTray")))
		{
			return;
		}

		UPackage* Package = CreatePackage(*Path);
		UWorld* World = UWorld::CreateWorld(EWorldType::Inactive, false, TEXT("PaintTray"), Package);
		if (!World)
		{
			return;
		}
		World->SetFlags(RF_Public | RF_Standalone);
		FAssetRegistryModule::AssetCreated(World);
		Package->MarkPackageDirty();

		FString Filename;
		if (FPackageName::TryConvertLongPackageNameToFilename(Path, Filename, FPackageName::GetMapPackageExtension()))
		{
			FSavePackageArgs Args;
			Args.TopLevelFlags = RF_Public | RF_Standalone;
			UPackage::SavePackage(Package, World, *Filename, Args);
		}
	}
}

void FImpastoEditorModule::StartupModule()
{
	FCoreDelegates::OnPostEngineInit.AddLambda([]()
	{
		FPaintMaterials::EnsureSavedAssets();
		EnsurePaintTrayMap();
	});
}

void FImpastoEditorModule::ShutdownModule()
{
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FImpastoEditorModule, ImpastoEditor);
