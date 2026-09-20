#include "ImpastoHUD.h"
#include "PaintStudioPawn.h"
#include "PaintSimComponent.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"

void AImpastoHUD::DrawHUD()
{
	Super::DrawHUD();
	DrawSwatches();
	DrawHint();
}

void AImpastoHUD::DrawSwatches()
{
	const APaintStudioPawn* Pawn = Cast<APaintStudioPawn>(GetOwningPawn());
	if (!Pawn || !Pawn->GetSim())
	{
		return;
	}
	const UPaintSimComponent* Sim = Pawn->GetSim();
	const TArray<FImpastoTube>& Tubes = Sim->GetTubes();
	const int32 Selected = Sim->GetSelectedTube();
	const float Size = 42.f;
	const float Pad = 8.f;
	const float Y = Canvas->SizeY - Size - 18.f;
	float X = 18.f;
	for (int32 I = 0; I < Tubes.Num(); ++I)
	{
		const FLinearColor Fill = FLinearColor::FromSRGBColor(Tubes[I].Swatch);
		DrawRect(Fill, X, Y, Size, Size);
		if (I == Selected)
		{
			DrawRect(FLinearColor::White, X - 2.f, Y - 2.f, Size + 4.f, 3.f);
			DrawRect(FLinearColor::White, X - 2.f, Y + Size - 1.f, Size + 4.f, 3.f);
		}
		X += Size + Pad;
	}
}

void AImpastoHUD::DrawHint()
{
	const APaintStudioPawn* Pawn = Cast<APaintStudioPawn>(GetOwningPawn());
	if (!Pawn || !Pawn->GetSim() || !GEngine || !GEngine->GetSmallFont())
	{
		return;
	}
	const UPaintSimComponent* Sim = Pawn->GetSim();
	const TArray<FImpastoTube>& Tubes = Sim->GetTubes();
	const FString Tube = Tubes.IsValidIndex(Sim->GetSelectedTube()) ? Tubes[Sim->GetSelectedTube()].Name.ToString() : TEXT("—");
	const FString Feel = Sim->GetViscositySlider() < 0.28f ? TEXT("Soft oil")
		: Sim->GetViscositySlider() < 0.55f ? TEXT("Heavy oil")
		: Sim->GetViscositySlider() < 0.8f ? TEXT("Impasto")
		: TEXT("Tar");
	const FString Line = FString::Printf(
		TEXT("%s   ·   click glop   ·   drag scraper   ·   G dump   ·   R blank   ·   1-0 tubes   ·   [ ] viscosity (%s)   ·   particles %d%s"),
		*Tube,
		*Feel,
		Sim->ParticleCount(),
		Sim->IsSleeping() ? TEXT("   ·   still") : TEXT(""));
	DrawText(Line, FLinearColor(0.95f, 0.93f, 0.88f, 0.9f), 18.f, 16.f, GEngine->GetSmallFont(), 1.15f, false);
}
