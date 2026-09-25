#pragma once

#include "CoreMinimal.h"

/** Quadratic B-spline MLS-MPM (Hu et al. SIGGRAPH 2018) with a Newtonian
 *  Tait EOS and Batty–Bridson implicit viscosity. 2D tray: no in-plane gravity.
 *  Paint sleeps dead-still when the finger / knife is up. Tube colors ride on
 *  particles and are never mixed. */
class FPaintMPM
{
public:
	static constexpr int32 Grid = 80;
	static constexpr int32 Nodes = Grid + 1;
	static constexpr int32 MaxParticles = 24576;
	static constexpr float Pad = 3.4f;
	static constexpr float Spacing = 0.46f;

	struct FFeel
	{
		float Viscosity = 210.f;
		float Stiffness = 12.f;
		float Cohesion = 4.2f;
		float RestDensity = 5.4f;
		float SleepSpeed = 0.28f;
		int32 Jacobi = 14;
		float Damping = 0.93f;
	};

	struct FKnife
	{
		float X = 0.f;
		float Y = 0.f;
		float Dx = 0.f;
		float Dy = 0.f;
		float Length = 7.5f;
		float Width = 1.15f;
		float Strength = 1.f;
		bool bActive = false;
		/** True = fingertip disc. False = palette-knife rectangle. Never dumps color. */
		bool bRound = true;
	};

	struct FTubeColor
	{
		float R = 0.7f;
		float G = 0.1f;
		float B = 0.08f;
	};

	FPaintMPM();

	void Clear();
	int32 Glop(float Cx, float Cy, float Radius, const FTubeColor& Color);
	void Step(float Dt, const FKnife* Knife);
	void SetFeel(const FFeel& InFeel) { Feel = InFeel; }
	void SetMobileBudget(bool bInMobile) { bMobileBudget = bInMobile; }

	int32 NumParticles() const { return Count; }
	bool IsSleeping() const { return bSleeping; }
	bool IsDirty() const { return bDirty; }
	void ClearDirty() { bDirty = false; }
	bool IsFull() const { return Count >= MaxParticles - 64; }

	float GetX(int32 I) const { return Px[I]; }
	float GetY(int32 I) const { return Py[I]; }
	const FTubeColor& GetColor(int32 I) const { return Color[I]; }

	static FFeel FeelFromSlider(float T);

private:
	void Spawn(float X, float Y, const FTubeColor& InColor);
	void Advance(float Dt, const FKnife* Knife);
	void ApplyContact(const FKnife& Knife);
	void ApplyKnife(const FKnife& Knife);
	void ApplyRoundSmear(const FKnife& Tool);
	void ImplicitViscosity(float Dt);
	void SurfaceTension(float Dt);
	void GridBoundaries();
	void MaybeSleep(const FKnife* Knife);

	FFeel Feel;
	int32 Count = 0;
	bool bSleeping = true;
	bool bDirty = true;
	bool bMobileBudget = false;
	int32 Settle = 0;

	TArray<float> Px, Py, Vx, Vy, Mass;
	TArray<float> C00, C01, C10, C11;
	TArray<FTubeColor> Color;

	TArray<float> GMass, GMx, GMy, GVx, GVy, GVxB, GVyB, GKx, GKy;
};
