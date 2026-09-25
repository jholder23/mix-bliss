#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "PaintStudioPawn.generated.h"

class UCameraComponent;
class UStaticMeshComponent;
class URectLightComponent;
class USkyLightComponent;
class UPostProcessComponent;
class UPaintSimComponent;
class UProceduralMeshComponent;
class UInputMappingContext;
class UInputAction;
class APlayerController;

UCLASS()
class IMPASTO_API APaintStudioPawn : public APawn
{
	GENERATED_BODY()

public:
	APaintStudioPawn();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaTime) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
	virtual void PossessedBy(AController* NewController) override;

	UPaintSimComponent* GetSim() const { return Sim; }

	void SelectTube(int32 Index);
	void DumpGlopAtCursor();
	void BlankTray();
	void SetViscosity(float T);
	void SetSize(float T);
	void SetScraperEnabled(bool bEnabled);
	bool IsScraperEnabled() const { return bScraperEnabled; }

protected:
	void OnPrimaryStarted();
	void OnPrimaryTriggered();
	void OnPrimaryCompleted();
	void OnDump();
	void OnBlank();

private:
	bool CursorOnTray(FVector& OutWorld) const;
	bool DeprojectToTray(const APlayerController* PC, float ScreenX, float ScreenY, FVector& OutWorld) const;
	bool IsPrimaryHeld(const APlayerController* PC) const;
	bool IsPointerOverHud() const;
	void UpdateKnifeVisual(const FVector& WorldPos, const FVector& Delta);
	void ApplyStudioLighting();

	UPROPERTY(VisibleAnywhere, Category = "Impasto")
	TObjectPtr<USceneComponent> Root;

	UPROPERTY(VisibleAnywhere, Category = "Impasto")
	TObjectPtr<UCameraComponent> Camera;

	UPROPERTY(VisibleAnywhere, Category = "Impasto")
	TObjectPtr<UStaticMeshComponent> Tray;

	UPROPERTY(VisibleAnywhere, Category = "Impasto")
	TObjectPtr<UStaticMeshComponent> StudioFloor;

	UPROPERTY(VisibleAnywhere, Category = "Impasto")
	TObjectPtr<UStaticMeshComponent> Knife;

	UPROPERTY(VisibleAnywhere, Category = "Impasto")
	TObjectPtr<UProceduralMeshComponent> PaintSurface;

	UPROPERTY(VisibleAnywhere, Category = "Impasto")
	TObjectPtr<UPaintSimComponent> Sim;

	UPROPERTY(VisibleAnywhere, Category = "Impasto")
	TObjectPtr<URectLightComponent> KeySoftbox;

	UPROPERTY(VisibleAnywhere, Category = "Impasto")
	TObjectPtr<URectLightComponent> FillSoftbox;

	UPROPERTY(VisibleAnywhere, Category = "Impasto")
	TObjectPtr<URectLightComponent> RimSoftbox;

	UPROPERTY(VisibleAnywhere, Category = "Impasto")
	TObjectPtr<USkyLightComponent> Sky;

	UPROPERTY(VisibleAnywhere, Category = "Impasto")
	TObjectPtr<UPostProcessComponent> Post;

	UPROPERTY()
	TObjectPtr<UInputMappingContext> Mapping;

	UPROPERTY()
	TObjectPtr<UInputAction> PrimaryAction;

	UPROPERTY()
	TObjectPtr<UInputAction> DumpAction;

	UPROPERTY()
	TObjectPtr<UInputAction> BlankAction;

	bool bPrimaryDown = false;
	bool bScraping = false;
	bool bScraperEnabled = false;
	FVector PressWorld = FVector::ZeroVector;
	FVector LastWorld = FVector::ZeroVector;
	FVector BladeDir = FVector(1.f, 0.f, 0.f);
};
