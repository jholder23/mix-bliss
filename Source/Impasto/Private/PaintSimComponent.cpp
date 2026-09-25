#include "PaintSimComponent.h"
#include "PaintMaterials.h"
#include "ImpastoPlatform.h"
#include "ProceduralMeshComponent.h"

namespace
{
	FImpastoTube MakeTube(const TCHAR* Name, uint8 R, uint8 G, uint8 B)
	{
		FImpastoTube T;
		T.Name = Name;
		T.Swatch = FColor(R, G, B, 255);
		T.Linear = FLinearColor::FromSRGBColor(T.Swatch);
		return T;
	}
}

UPaintSimComponent::UPaintSimComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.bStartWithTickEnabled = true;
	PrimaryComponentTick.TickGroup = TG_PrePhysics;
	BuildTubes();
	Solver.SetFeel(FPaintMPM::FeelFromSlider(ViscositySlider));

	const int32 Field = MeshRes * MeshRes;
	HeightField.SetNumZeroed(Field);
	ColorW.SetNumZeroed(Field);
	Cr.SetNumZeroed(Field);
	Cg.SetNumZeroed(Field);
	Cb.SetNumZeroed(Field);
}

void UPaintSimComponent::BuildTubes()
{
	Tubes.Reset();
	Tubes.Add(MakeTube(TEXT("Cadmium Red"), 0xd4, 0x2a, 0x1e));
	Tubes.Add(MakeTube(TEXT("Quinacridone Magenta"), 0xc2, 0x18, 0x5b));
	Tubes.Add(MakeTube(TEXT("Naples Yellow"), 0xe8, 0xc5, 0x47));
	Tubes.Add(MakeTube(TEXT("Hansa Yellow"), 0xff, 0xd8, 0x4a));
	Tubes.Add(MakeTube(TEXT("Ultramarine"), 0x2a, 0x4b, 0xd7));
	Tubes.Add(MakeTube(TEXT("Cerulean"), 0x3d, 0x9a, 0xd1));
	Tubes.Add(MakeTube(TEXT("Phthalo Green"), 0x0b, 0x6e, 0x56));
	Tubes.Add(MakeTube(TEXT("Burnt Sienna"), 0xa3, 0x54, 0x2d));
	Tubes.Add(MakeTube(TEXT("Titanium White"), 0xf3, 0xee, 0xe4));
	Tubes.Add(MakeTube(TEXT("Mars Black"), 0x1c, 0x18, 0x16));
}

void UPaintSimComponent::BeginPlay()
{
	Super::BeginPlay();
	if (ImpastoIsMobileTarget())
	{
		MeshRes = 112;
		Solver.SetMobileBudget(true);
		const int32 Field = MeshRes * MeshRes;
		HeightField.SetNumZeroed(Field);
		ColorW.SetNumZeroed(Field);
		Cr.SetNumZeroed(Field);
		Cg.SetNumZeroed(Field);
		Cb.SetNumZeroed(Field);
	}
	if (!OilMaterial)
	{
		SetOilMaterial(FPaintMaterials::GetOil());
	}
	EnsureMesh();
}

void UPaintSimComponent::SetOilMaterial(UMaterialInterface* InMaterial)
{
	OilMaterial = InMaterial;
	if (SurfaceMesh && OilMaterial)
	{
		SurfaceMesh->SetMaterial(0, OilMaterial);
	}
}

void UPaintSimComponent::SetSelectedTube(int32 Index)
{
	if (Tubes.Num() == 0)
	{
		return;
	}
	SelectedTube = FMath::Clamp(Index, 0, Tubes.Num() - 1);
}

void UPaintSimComponent::SetViscositySlider(float T)
{
	ViscositySlider = FMath::Clamp(T, 0.f, 1.f);
	Solver.SetFeel(FPaintMPM::FeelFromSlider(ViscositySlider));
}

FVector UPaintSimComponent::GetTrayCenter() const
{
	return FVector(0.f, 0.f, TrayZ);
}

FVector UPaintSimComponent::GridToWorld(float Gx, float Gy) const
{
	const float U = (Gx / float(FPaintMPM::Grid) - 0.5f) * (TrayExtent * 2.f);
	const float V = (Gy / float(FPaintMPM::Grid) - 0.5f) * (TrayExtent * 2.f);
	return FVector(U, V, TrayZ);
}

bool UPaintSimComponent::WorldToGrid(const FVector& World, float& Gx, float& Gy) const
{
	const float Span = TrayExtent * 2.f;
	if (Span <= KINDA_SMALL_NUMBER)
	{
		return false;
	}
	Gx = (World.X / Span + 0.5f) * float(FPaintMPM::Grid);
	Gy = (World.Y / Span + 0.5f) * float(FPaintMPM::Grid);
	return Gx >= 0.f && Gy >= 0.f && Gx <= float(FPaintMPM::Grid) && Gy <= float(FPaintMPM::Grid);
}

int32 UPaintSimComponent::GlopWorld(const FVector& WorldPos, float RadiusCm)
{
	float Gx, Gy;
	if (!WorldToGrid(WorldPos, Gx, Gy))
	{
		return 0;
	}
	const FImpastoTube& Tube = Tubes[SelectedTube];
	FPaintMPM::FTubeColor C;
	C.R = Tube.Linear.R;
	C.G = Tube.Linear.G;
	C.B = Tube.Linear.B;
	const float GridRadius = (RadiusCm / (TrayExtent * 2.f)) * float(FPaintMPM::Grid);
	return Solver.Glop(Gx, Gy, GridRadius, C);
}

void UPaintSimComponent::ScrapeWorld(const FVector& WorldPos, const FVector& WorldDelta, float LengthCm, float WidthCm, bool bScraper)
{
	float Gx, Gy;
	if (!WorldToGrid(WorldPos, Gx, Gy))
	{
		bKnifeActive = false;
		Knife.bActive = false;
		return;
	}
	const float Span = TrayExtent * 2.f;
	Knife.X = Gx;
	Knife.Y = Gy;
	Knife.Dx = (WorldDelta.X / Span) * float(FPaintMPM::Grid);
	Knife.Dy = (WorldDelta.Y / Span) * float(FPaintMPM::Grid);
	Knife.Length = (LengthCm / Span) * float(FPaintMPM::Grid);
	Knife.Width = (WidthCm / Span) * float(FPaintMPM::Grid);
	Knife.Strength = 1.f;
	Knife.bRound = !bScraper;
	Knife.bActive = true;
	bKnifeActive = true;
}

void UPaintSimComponent::EndScrape()
{
	bKnifeActive = false;
	Knife.bActive = false;
}

void UPaintSimComponent::BlankTray()
{
	Solver.Clear();
	EndScrape();
	RebuildSurface();
}

void UPaintSimComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	const FPaintMPM::FKnife* K = bKnifeActive ? &Knife : nullptr;
	Solver.Step(DeltaTime, K);
	if (Solver.IsDirty())
	{
		RebuildSurface();
		Solver.ClearDirty();
	}
}

void UPaintSimComponent::EnsureMesh()
{
	if (!SurfaceMesh || bMeshCreated)
	{
		return;
	}

	const int32 Verts = (MeshRes + 1) * (MeshRes + 1);
	Vertices.SetNum(Verts);
	Normals.SetNum(Verts);
	UV0.SetNum(Verts);
	VertColors.SetNum(Verts);
	Tangents.SetNum(Verts);
	Triangles.Reset();
	Triangles.Reserve(MeshRes * MeshRes * 6);

	for (int32 Y = 0; Y <= MeshRes; ++Y)
	{
		for (int32 X = 0; X <= MeshRes; ++X)
		{
			const int32 I = Y * (MeshRes + 1) + X;
			const float U = float(X) / float(MeshRes);
			const float V = float(Y) / float(MeshRes);
			Vertices[I] = FVector((U - 0.5f) * TrayExtent * 2.f, (V - 0.5f) * TrayExtent * 2.f, TrayZ);
			Normals[I] = FVector::UpVector;
			UV0[I] = FVector2D(U, V);
			VertColors[I] = FColor(0, 0, 0, 0);
			Tangents[I] = FProcMeshTangent(1.f, 0.f, 0.f);
		}
	}
	for (int32 Y = 0; Y < MeshRes; ++Y)
	{
		for (int32 X = 0; X < MeshRes; ++X)
		{
			const int32 I0 = Y * (MeshRes + 1) + X;
			const int32 I1 = I0 + 1;
			const int32 I2 = I0 + (MeshRes + 1);
			const int32 I3 = I2 + 1;
			Triangles.Add(I0);
			Triangles.Add(I2);
			Triangles.Add(I1);
			Triangles.Add(I1);
			Triangles.Add(I2);
			Triangles.Add(I3);
		}
	}

	SurfaceMesh->CreateMeshSection(0, Vertices, Triangles, Normals, UV0, VertColors, Tangents, false);
	SurfaceMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	SurfaceMesh->SetCastShadow(true);
	if (OilMaterial)
	{
		SurfaceMesh->SetMaterial(0, OilMaterial);
	}
	bMeshCreated = true;
}

void UPaintSimComponent::RebuildSurface()
{
	EnsureMesh();
	if (!SurfaceMesh || !bMeshCreated)
	{
		return;
	}

	const int32 Field = MeshRes * MeshRes;
	FMemory::Memzero(HeightField.GetData(), Field * sizeof(float));
	FMemory::Memzero(ColorW.GetData(), Field * sizeof(float));
	FMemory::Memzero(Cr.GetData(), Field * sizeof(float));
	FMemory::Memzero(Cg.GetData(), Field * sizeof(float));
	FMemory::Memzero(Cb.GetData(), Field * sizeof(float));

	const float Splat = 1.35f;
	const float InvGrid = 1.f / float(FPaintMPM::Grid);
	const int32 Count = Solver.NumParticles();
	for (int32 P = 0; P < Count; ++P)
	{
		const float U = Solver.GetX(P) * InvGrid * float(MeshRes);
		const float V = Solver.GetY(P) * InvGrid * float(MeshRes);
		const FPaintMPM::FTubeColor& C = Solver.GetColor(P);
		const int32 X0 = FMath::Max(0, FMath::FloorToInt(U - Splat * 2.f));
		const int32 Y0 = FMath::Max(0, FMath::FloorToInt(V - Splat * 2.f));
		const int32 X1 = FMath::Min(MeshRes - 1, FMath::CeilToInt(U + Splat * 2.f));
		const int32 Y1 = FMath::Min(MeshRes - 1, FMath::CeilToInt(V + Splat * 2.f));
		for (int32 Y = Y0; Y <= Y1; ++Y)
		{
			for (int32 X = X0; X <= X1; ++X)
			{
				const float Dx = float(X) + 0.5f - U;
				const float Dy = float(Y) + 0.5f - V;
				const float D2 = Dx * Dx + Dy * Dy;
				const float W = FMath::Exp(-D2 / (Splat * Splat));
				if (W < 1e-4f)
				{
					continue;
				}
				const int32 Idx = Y * MeshRes + X;
				HeightField[Idx] += W;
				if (W > ColorW[Idx])
				{
					ColorW[Idx] = W;
					Cr[Idx] = C.R;
					Cg[Idx] = C.G;
					Cb[Idx] = C.B;
				}
			}
		}
	}

	auto SampleH = [&](int32 X, int32 Y) -> float
	{
		X = FMath::Clamp(X, 0, MeshRes - 1);
		Y = FMath::Clamp(Y, 0, MeshRes - 1);
		return HeightField[Y * MeshRes + X];
	};

	const float HeightScale = HeightCm;
	for (int32 Y = 0; Y <= MeshRes; ++Y)
	{
		for (int32 X = 0; X <= MeshRes; ++X)
		{
			const int32 I = Y * (MeshRes + 1) + X;
			const int32 CX = FMath::Clamp(X, 0, MeshRes - 1);
			const int32 CY = FMath::Clamp(Y, 0, MeshRes - 1);
			const int32 Idx = CY * MeshRes + CX;
			const float H = HeightField[Idx];
			const float U = float(X) / float(MeshRes);
			const float V = float(Y) / float(MeshRes);
			Vertices[I] = FVector((U - 0.5f) * TrayExtent * 2.f, (V - 0.5f) * TrayExtent * 2.f, TrayZ + H * HeightScale);

			const float Dhx = SampleH(CX + 1, CY) - SampleH(CX - 1, CY);
			const float Dhy = SampleH(CX, CY + 1) - SampleH(CX, CY - 1);
			const float Cell = (TrayExtent * 2.f) / float(MeshRes);
			FVector N(-Dhx * HeightScale / Cell, -Dhy * HeightScale / Cell, 1.f);
			N.Normalize();
			Normals[I] = N;
			Tangents[I] = FProcMeshTangent(1.f, 0.f, 0.f);

			if (H > 0.08f)
			{
				const FLinearColor Lc(Cr[Idx], Cg[Idx], Cb[Idx], 1.f);
				VertColors[I] = Lc.ToFColor(false);
			}
			else
			{
				VertColors[I] = FColor(0, 0, 0, 0);
			}
		}
	}

	SurfaceMesh->UpdateMeshSection(0, Vertices, Normals, UV0, VertColors, Tangents);
}
