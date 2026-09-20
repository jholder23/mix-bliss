#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "ProceduralMeshComponent.h"
#include "PaintMPM.h"
#include "PaintSimComponent.generated.h"

class UProceduralMeshComponent;
class UMaterialInterface;

USTRUCT(BlueprintType)
struct FImpastoTube
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Impasto")
	FName Name;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Impasto")
	FLinearColor Linear;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Impasto")
	FColor Swatch;
};

UCLASS(ClassGroup = (Impasto), meta = (BlueprintSpawnableComponent))
class IMPASTO_API UPaintSimComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPaintSimComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	void SetSurfaceMesh(UProceduralMeshComponent* InMesh) { SurfaceMesh = InMesh; }
	void SetOilMaterial(UMaterialInterface* InMaterial);

	int32 GlopWorld(const FVector& WorldPos, float RadiusCm);
	void ScrapeWorld(const FVector& WorldPos, const FVector& WorldDelta, float LengthCm, float WidthCm);
	void EndScrape();
	void BlankTray();

	void SetSelectedTube(int32 Index);
	int32 GetSelectedTube() const { return SelectedTube; }
	const TArray<FImpastoTube>& GetTubes() const { return Tubes; }

	void SetViscositySlider(float T);
	float GetViscositySlider() const { return ViscositySlider; }

	void SetGlopSize(float T) { GlopSize = FMath::Clamp(T, 0.f, 1.f); }
	float GetGlopSize() const { return GlopSize; }

	FVector GridToWorld(float Gx, float Gy) const;
	bool WorldToGrid(const FVector& World, float& Gx, float& Gy) const;
	FVector GetTrayCenter() const;
	float GetTrayZ() const { return TrayZ; }
	float GetTrayExtent() const { return TrayExtent; }

	bool IsSleeping() const { return Solver.IsSleeping(); }
	int32 ParticleCount() const { return Solver.NumParticles(); }

	UPROPERTY(EditAnywhere, Category = "Impasto")
	float TrayExtent = 18.f;

	UPROPERTY(EditAnywhere, Category = "Impasto")
	float TrayZ = 2.05f;

	UPROPERTY(EditAnywhere, Category = "Impasto")
	float HeightCm = 0.55f;

private:
	void BuildTubes();
	void RebuildSurface();
	void EnsureMesh();

	FPaintMPM Solver;
	FPaintMPM::FKnife Knife;

	UPROPERTY()
	TObjectPtr<UProceduralMeshComponent> SurfaceMesh;

	UPROPERTY()
	TObjectPtr<UMaterialInterface> OilMaterial;

	UPROPERTY()
	TArray<FImpastoTube> Tubes;

	int32 SelectedTube = 0;
	float ViscositySlider = 0.72f;
	float GlopSize = 0.52f;
	bool bKnifeActive = false;

	static constexpr int32 MeshRes = 160;
	TArray<FVector> Vertices;
	TArray<int32> Triangles;
	TArray<FVector> Normals;
	TArray<FVector2D> UV0;
	TArray<FColor> VertColors;
	TArray<FProcMeshTangent> Tangents;
	TArray<float> HeightField;
	TArray<float> ColorW;
	TArray<float> Cr, Cg, Cb;
	bool bMeshCreated = false;
};
