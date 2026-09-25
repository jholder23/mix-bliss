#include "PaintMPM.h"

namespace
{
	FORCEINLINE float Smoothstep(float Edge0, float Edge1, float X)
	{
		const float T = FMath::Clamp((X - Edge0) / (Edge1 - Edge0), 0.f, 1.f);
		return T * T * (3.f - 2.f * T);
	}

	FORCEINLINE float Hash01(int32 N)
	{
		const float X = FMath::Sin(float(N) * 127.1f + 311.7f) * 43758.5453f;
		return X - FMath::FloorToFloat(X);
	}

	FORCEINLINE void Weights(float Fx, float W[3])
	{
		W[0] = 0.5f * (1.5f - Fx) * (1.5f - Fx);
		const float D = Fx - 1.f;
		W[1] = 0.75f - D * D;
		const float E = Fx - 0.5f;
		W[2] = 0.5f * E * E;
	}

	FORCEINLINE void SampleVisc(
		const TArray<float>& Mass,
		const TArray<float>& Vx,
		const TArray<float>& Vy,
		int32 I,
		int32 J,
		float SelfX,
		float SelfY,
		float MassMin,
		float& OutX,
		float& OutY)
	{
		const int32 Nodes = FPaintMPM::Nodes;
		if (I < 0 || J < 0 || I >= Nodes || J >= Nodes)
		{
			OutX = SelfX;
			OutY = SelfY;
			return;
		}
		const int32 Idx = I * Nodes + J;
		if (Mass[Idx] < MassMin)
		{
			OutX = SelfX;
			OutY = SelfY;
			return;
		}
		OutX = Vx[Idx];
		OutY = Vy[Idx];
	}
}

FPaintMPM::FPaintMPM()
{
	Px.SetNumZeroed(MaxParticles);
	Py.SetNumZeroed(MaxParticles);
	Vx.SetNumZeroed(MaxParticles);
	Vy.SetNumZeroed(MaxParticles);
	Mass.SetNumZeroed(MaxParticles);
	C00.SetNumZeroed(MaxParticles);
	C01.SetNumZeroed(MaxParticles);
	C10.SetNumZeroed(MaxParticles);
	C11.SetNumZeroed(MaxParticles);
	Color.SetNum(MaxParticles);

	const int32 N = Nodes * Nodes;
	GMass.SetNumZeroed(N);
	GMx.SetNumZeroed(N);
	GMy.SetNumZeroed(N);
	GVx.SetNumZeroed(N);
	GVy.SetNumZeroed(N);
	GVxB.SetNumZeroed(N);
	GVyB.SetNumZeroed(N);
	GKx.SetNumZeroed(N);
	GKy.SetNumZeroed(N);

	Feel = FeelFromSlider(0.72f);
}

FPaintMPM::FFeel FPaintMPM::FeelFromSlider(float T)
{
	const float X = FMath::Clamp(T, 0.f, 1.f);
	const float Blend = X * X * 0.55f + X * 0.45f;
	FFeel F;
	F.Viscosity = FMath::Lerp(28.f, 420.f, Blend);
	F.Stiffness = FMath::Lerp(22.f, 7.5f, X);
	F.Cohesion = FMath::Lerp(1.8f, 5.4f, X);
	F.RestDensity = FMath::Lerp(4.6f, 5.8f, X);
	F.SleepSpeed = FMath::Lerp(0.55f, 0.22f, X);
	F.Jacobi = FMath::RoundToInt(FMath::Lerp(8.f, 16.f, X));
	F.Damping = FMath::Lerp(0.965f, 0.912f, X);
	return F;
}

void FPaintMPM::Clear()
{
	Count = 0;
	bSleeping = true;
	Settle = 0;
	bDirty = true;
}

void FPaintMPM::Spawn(float X, float Y, const FTubeColor& InColor)
{
	const int32 I = Count++;
	Px[I] = FMath::Clamp(X, Pad, float(Grid) - Pad);
	Py[I] = FMath::Clamp(Y, Pad, float(Grid) - Pad);
	Vx[I] = 0.f;
	Vy[I] = 0.f;
	Mass[I] = 1.f;
	C00[I] = C01[I] = C10[I] = C11[I] = 0.f;
	Color[I] = InColor;
}

int32 FPaintMPM::Glop(float Cx, float Cy, float Radius, const FTubeColor& InColor)
{
	const float R = FMath::Max(1.15f, Radius);
	const float X0 = FMath::Clamp(Cx, Pad + R, float(Grid) - Pad - R);
	const float Y0 = FMath::Clamp(Cy, Pad + R, float(Grid) - Pad - R);
	const float Jitter = Spacing * 0.09f;
	int32 Added = 0;
	const int32 Rows = FMath::CeilToInt((2.f * R) / (Spacing * 0.866f)) + 1;
	const int32 Cols = FMath::CeilToInt((2.f * R) / Spacing) + 1;
	for (int32 J = -Rows; J <= Rows; ++J)
	{
		const float Y = float(J) * Spacing * 0.8660254f;
		const float Odd = (J & 1) ? Spacing * 0.5f : 0.f;
		for (int32 I = -Cols; I <= Cols; ++I)
		{
			if (Count >= MaxParticles)
			{
				break;
			}
			const float X = float(I) * Spacing + Odd;
			if (X * X + Y * Y > R * R)
			{
				continue;
			}
			Spawn(
				X0 + X + (Hash01(Count + I * 13 + J * 91) - 0.5f) * Jitter,
				Y0 + Y + (Hash01(Count + I * 7 + J * 17 + 3) - 0.5f) * Jitter,
				InColor);
			++Added;
		}
	}
	if (Added > 0)
	{
		bSleeping = false;
		Settle = 18;
		bDirty = true;
	}
	return Added;
}

void FPaintMPM::Step(float Dt, const FKnife* Knife)
{
	const bool bMoving = Knife && Knife->bActive && (Knife->Dx * Knife->Dx + Knife->Dy * Knife->Dy > 4e-6f);
	if (bMoving)
	{
		bSleeping = false;
		Settle = 22;
	}
	if (bSleeping && Settle <= 0)
	{
		return;
	}
	if (Count == 0)
	{
		bSleeping = true;
		Settle = 0;
		return;
	}
	const int32 Sub = bMobileBudget ? (bMoving ? 2 : 1) : (bMoving ? 3 : 2);
	const float H = FMath::Min(0.02f, Dt / float(Sub));
	for (int32 S = 0; S < Sub; ++S)
	{
		Advance(H, bMoving ? Knife : nullptr);
	}
	MaybeSleep(bMoving ? Knife : nullptr);
	bDirty = true;
}

void FPaintMPM::Advance(float Dt, const FKnife* Knife)
{
	const int32 N = Nodes * Nodes;
	FMemory::Memzero(GMass.GetData(), N * sizeof(float));
	FMemory::Memzero(GMx.GetData(), N * sizeof(float));
	FMemory::Memzero(GMy.GetData(), N * sizeof(float));

	float Wx[3];
	float Wy[3];

	for (int32 P = 0; P < Count; ++P)
	{
		const float X = Px[P];
		const float Y = Py[P];
		const int32 Bx = FMath::FloorToInt(X - 0.5f);
		const int32 By = FMath::FloorToInt(Y - 0.5f);
		const float Fx = X - float(Bx);
		const float Fy = Y - float(By);
		Weights(Fx, Wx);
		Weights(Fy, Wy);
		const float M = Mass[P];
		for (int32 I = 0; I < 3; ++I)
		{
			const int32 Gi = Bx + I;
			if (Gi < 0 || Gi >= Nodes) { continue; }
			for (int32 J = 0; J < 3; ++J)
			{
				const int32 Gj = By + J;
				if (Gj < 0 || Gj >= Nodes) { continue; }
				GMass[Gi * Nodes + Gj] += Wx[I] * Wy[J] * M;
			}
		}
	}

	for (int32 P = 0; P < Count; ++P)
	{
		const float X = Px[P];
		const float Y = Py[P];
		const int32 Bx = FMath::FloorToInt(X - 0.5f);
		const int32 By = FMath::FloorToInt(Y - 0.5f);
		const float Fx = X - float(Bx);
		const float Fy = Y - float(By);
		Weights(Fx, Wx);
		Weights(Fy, Wy);
		float Density = 0.f;
		for (int32 I = 0; I < 3; ++I)
		{
			const int32 Gi = Bx + I;
			if (Gi < 0 || Gi >= Nodes) { continue; }
			for (int32 J = 0; J < 3; ++J)
			{
				const int32 Gj = By + J;
				if (Gj < 0 || Gj >= Nodes) { continue; }
				Density += GMass[Gi * Nodes + Gj] * Wx[I] * Wy[J];
			}
		}
		Density = FMath::Max(Density, 0.12f);
		const float Volume = 1.f / Density;
		const float Ratio = Density / Feel.RestDensity;
		const float Pressure = FMath::Clamp(
			Feel.Stiffness * (Ratio * Ratio * FMath::Sqrt(FMath::Max(Ratio, 1e-4f)) - 1.f),
			-Feel.Stiffness * 0.45f,
			Feel.Stiffness * 2.2f);

		const float M = Mass[P];
		const float Mu = 0.35f + Feel.Viscosity * 0.002f;
		const float S00 = -Pressure + Mu * 2.f * C00[P];
		const float S01 = Mu * (C01[P] + C10[P]);
		const float S11 = -Pressure + Mu * 2.f * C11[P];
		const float Scale = -Volume * 4.f * Dt;
		const float A00 = Scale * S00 + M * C00[P];
		const float A01 = Scale * S01 + M * C01[P];
		const float A10 = Scale * S01 + M * C10[P];
		const float A11 = Scale * S11 + M * C11[P];
		const float Mvx = Vx[P] * M;
		const float Mvy = Vy[P] * M;

		for (int32 I = 0; I < 3; ++I)
		{
			const int32 Gi = Bx + I;
			if (Gi < 0 || Gi >= Nodes) { continue; }
			const float DposX = float(I) - Fx;
			for (int32 J = 0; J < 3; ++J)
			{
				const int32 Gj = By + J;
				if (Gj < 0 || Gj >= Nodes) { continue; }
				const float W = Wx[I] * Wy[J];
				const float DposY = float(J) - Fy;
				const int32 Idx = Gi * Nodes + Gj;
				GMx[Idx] += W * (Mvx + A00 * DposX + A01 * DposY);
				GMy[Idx] += W * (Mvy + A10 * DposX + A11 * DposY);
			}
		}
	}

	const float MassMin = 1e-5f;
	for (int32 I = 0; I < N; ++I)
	{
		if (GMass[I] > MassMin)
		{
			GVx[I] = GMx[I] / GMass[I];
			GVy[I] = GMy[I] / GMass[I];
		}
		else
		{
			GVx[I] = 0.f;
			GVy[I] = 0.f;
		}
	}

	if (Knife)
	{
		ApplyContact(*Knife);
	}
	ImplicitViscosity(Dt);
	SurfaceTension(Dt);
	GridBoundaries();

	const float Damp = FMath::Pow(Feel.Damping, Dt * 60.f);
	const float VMax = 12.f;
	for (int32 P = 0; P < Count; ++P)
	{
		const float X = Px[P];
		const float Y = Py[P];
		const int32 Bx = FMath::FloorToInt(X - 0.5f);
		const int32 By = FMath::FloorToInt(Y - 0.5f);
		const float Fx = X - float(Bx);
		const float Fy = Y - float(By);
		Weights(Fx, Wx);
		Weights(Fy, Wy);
		float Pvx = 0.f, Pvy = 0.f, Nc00 = 0.f, Nc01 = 0.f, Nc10 = 0.f, Nc11 = 0.f;
		for (int32 I = 0; I < 3; ++I)
		{
			const int32 Gi = Bx + I;
			if (Gi < 0 || Gi >= Nodes) { continue; }
			const float DposX = float(I) - Fx;
			for (int32 J = 0; J < 3; ++J)
			{
				const int32 Gj = By + J;
				if (Gj < 0 || Gj >= Nodes) { continue; }
				const float W = Wx[I] * Wy[J];
				const int32 Idx = Gi * Nodes + Gj;
				const float Gvx = GVx[Idx];
				const float Gvy = GVy[Idx];
				const float DposY = float(J) - Fy;
				Pvx += W * Gvx;
				Pvy += W * Gvy;
				Nc00 += W * Gvx * 4.f * DposX;
				Nc01 += W * Gvx * 4.f * DposY;
				Nc10 += W * Gvy * 4.f * DposX;
				Nc11 += W * Gvy * 4.f * DposY;
			}
		}
		Pvx *= Damp;
		Pvy *= Damp;
		const float Sp2 = Pvx * Pvx + Pvy * Pvy;
		if (Sp2 > VMax * VMax)
		{
			const float Inv = VMax / FMath::Sqrt(Sp2);
			Pvx *= Inv;
			Pvy *= Inv;
		}
		Vx[P] = Pvx;
		Vy[P] = Pvy;
		C00[P] = Nc00;
		C01[P] = Nc01;
		C10[P] = Nc10;
		C11[P] = Nc11;
		float Nx = X + Dt * Pvx;
		float Ny = Y + Dt * Pvy;
		if (Nx < Pad) { Nx = Pad; Vx[P] = FMath::Max(0.f, Pvx); }
		else if (Nx > float(Grid) - Pad) { Nx = float(Grid) - Pad; Vx[P] = FMath::Min(0.f, Pvx); }
		if (Ny < Pad) { Ny = Pad; Vy[P] = FMath::Max(0.f, Pvy); }
		else if (Ny > float(Grid) - Pad) { Ny = float(Grid) - Pad; Vy[P] = FMath::Min(0.f, Pvy); }
		Px[P] = Nx;
		Py[P] = Ny;
	}
}

void FPaintMPM::ApplyContact(const FKnife& Knife)
{
	if (Knife.bRound)
	{
		ApplyRoundSmear(Knife);
	}
	else
	{
		ApplyKnife(Knife);
	}
}

void FPaintMPM::ApplyRoundSmear(const FKnife& Tool)
{
	const float Speed = FMath::Sqrt(Tool.Dx * Tool.Dx + Tool.Dy * Tool.Dy);
	if (Speed < 1e-5f)
	{
		return;
	}
	const float Tx = Tool.Dx / Speed;
	const float Ty = Tool.Dy / Speed;
	const float Radius = FMath::Max(0.55f, FMath::Max(Tool.Width, Tool.Length) * 0.5f);
	const float Reach = Radius * 1.7f;
	const float Kvx = Tool.Dx * Tool.Strength;
	const float Kvy = Tool.Dy * Tool.Strength;

	for (int32 I = 1; I < Nodes - 1; ++I)
	{
		for (int32 J = 1; J < Nodes - 1; ++J)
		{
			const int32 Idx = I * Nodes + J;
			if (GMass[Idx] < 1e-5f)
			{
				continue;
			}
			const float Rx = float(I) - Tool.X;
			const float Ry = float(J) - Tool.Y;
			const float Dist = FMath::Sqrt(Rx * Rx + Ry * Ry);
			if (Dist > Reach)
			{
				continue;
			}
			const float Fall = Smoothstep(Reach, Radius * 0.32f, Dist);
			if (Fall <= 0.f)
			{
				continue;
			}
			const float Mix = FMath::Min(1.f, Fall * 0.9f);
			GVx[Idx] = GVx[Idx] * (1.f - Mix) + Kvx * Mix;
			GVy[Idx] = GVy[Idx] * (1.f - Mix) + Kvy * Mix;
			const float Push = Fall * Speed * 0.4f;
			GVx[Idx] += Tx * Push;
			GVy[Idx] += Ty * Push;
		}
	}
}

void FPaintMPM::ApplyKnife(const FKnife& Knife)
{
	const float Speed = FMath::Sqrt(Knife.Dx * Knife.Dx + Knife.Dy * Knife.Dy);
	if (Speed < 1e-5f)
	{
		return;
	}
	const float Tx = Knife.Dx / Speed;
	const float Ty = Knife.Dy / Speed;
	const float Bx = -Ty;
	const float By = Tx;
	const float HalfL = Knife.Length * 0.5f;
	const float HalfW = Knife.Width * 0.5f;
	const float Reach = HalfW * 2.4f;
	const float Kvx = Knife.Dx * Knife.Strength;
	const float Kvy = Knife.Dy * Knife.Strength;

	for (int32 I = 1; I < Nodes - 1; ++I)
	{
		for (int32 J = 1; J < Nodes - 1; ++J)
		{
			const int32 Idx = I * Nodes + J;
			if (GMass[Idx] < 1e-5f)
			{
				continue;
			}
			const float Rx = float(I) - Knife.X;
			const float Ry = float(J) - Knife.Y;
			const float Along = Rx * Bx + Ry * By;
			if (Along < -HalfL || Along > HalfL)
			{
				continue;
			}
			const float Across = Rx * Tx + Ry * Ty;
			const float Ad = FMath::Abs(Across);
			if (Ad > Reach)
			{
				continue;
			}
			const float AlongT = 1.f - FMath::Square(FMath::Abs(Along) / (HalfL + 0.001f));
			const float Fall = Smoothstep(Reach, HalfW * 0.45f, Ad) * AlongT;
			if (Fall <= 0.f)
			{
				continue;
			}
			const float Mix = FMath::Min(1.f, Fall * 0.96f);
			GVx[Idx] = GVx[Idx] * (1.f - Mix) + Kvx * Mix;
			GVy[Idx] = GVy[Idx] * (1.f - Mix) + Kvy * Mix;
			const float Plow = Fall * Speed * 0.55f;
			GVx[Idx] += Tx * Plow;
			GVy[Idx] += Ty * Plow;
			const float Ridge = FMath::Sign(Along == 0.f ? 1.f : Along) * Fall * Speed * 0.22f * (Ad < HalfW ? 1.f : 0.4f);
			GVx[Idx] += Bx * Ridge;
			GVy[Idx] += By * Ridge;
		}
	}
}

void FPaintMPM::ImplicitViscosity(float Dt)
{
	const float Alpha = FMath::Max(0.f, Feel.Viscosity * Dt);
	if (Alpha < 1e-6f)
	{
		return;
	}
	const float MassMin = 1e-5f;
	const int32 Iters = bMobileBudget ? FMath::Min(Feel.Jacobi, 10) : Feel.Jacobi;
	for (int32 It = 0; It < Iters; ++It)
	{
		const TArray<float>& SrcX = (It % 2 == 0) ? GVx : GVxB;
		const TArray<float>& SrcY = (It % 2 == 0) ? GVy : GVyB;
		TArray<float>& DstX = (It % 2 == 0) ? GVxB : GVx;
		TArray<float>& DstY = (It % 2 == 0) ? GVyB : GVy;
		for (int32 I = 0; I < Nodes; ++I)
		{
			for (int32 J = 0; J < Nodes; ++J)
			{
				const int32 Idx = I * Nodes + J;
				if (GMass[Idx] < MassMin)
				{
					DstX[Idx] = 0.f;
					DstY[Idx] = 0.f;
					continue;
				}
				const float SelfX = SrcX[Idx];
				const float SelfY = SrcY[Idx];
				float Sx = 0.f, Sy = 0.f, Nx, Ny;
				SampleVisc(GMass, SrcX, SrcY, I - 1, J, SelfX, SelfY, MassMin, Nx, Ny); Sx += Nx; Sy += Ny;
				SampleVisc(GMass, SrcX, SrcY, I + 1, J, SelfX, SelfY, MassMin, Nx, Ny); Sx += Nx; Sy += Ny;
				SampleVisc(GMass, SrcX, SrcY, I, J - 1, SelfX, SelfY, MassMin, Nx, Ny); Sx += Nx; Sy += Ny;
				SampleVisc(GMass, SrcX, SrcY, I, J + 1, SelfX, SelfY, MassMin, Nx, Ny); Sx += Nx; Sy += Ny;
				const float Denom = 1.f + Alpha * 4.f;
				DstX[Idx] = (SelfX + Alpha * Sx) / Denom;
				DstY[Idx] = (SelfY + Alpha * Sy) / Denom;
			}
		}
	}
	if (Iters % 2 == 1)
	{
		GVx = GVxB;
		GVy = GVyB;
	}
}

void FPaintMPM::SurfaceTension(float Dt)
{
	const float MassMin = 0.18f;
	FMemory::Memzero(GKx.GetData(), GKx.Num() * sizeof(float));
	FMemory::Memzero(GKy.GetData(), GKy.Num() * sizeof(float));
	for (int32 I = 1; I < Nodes - 1; ++I)
	{
		for (int32 J = 1; J < Nodes - 1; ++J)
		{
			const int32 Idx = I * Nodes + J;
			if (GMass[Idx] < MassMin) { continue; }
			GKx[Idx] = GMass[(I + 1) * Nodes + J] - GMass[(I - 1) * Nodes + J];
			GKy[Idx] = GMass[I * Nodes + J + 1] - GMass[I * Nodes + J - 1];
		}
	}
	for (int32 I = 1; I < Nodes - 1; ++I)
	{
		for (int32 J = 1; J < Nodes - 1; ++J)
		{
			const int32 Idx = I * Nodes + J;
			if (GMass[Idx] < MassMin) { continue; }
			const float Gx = GKx[Idx];
			const float Gy = GKy[Idx];
			const float G = FMath::Sqrt(Gx * Gx + Gy * Gy);
			if (G < 0.22f) { continue; }
			const float Pull = Feel.Cohesion * Dt * Smoothstep(0.22f, 2.4f, G);
			GVx[Idx] -= (Gx / G) * Pull;
			GVy[Idx] -= (Gy / G) * Pull;
		}
	}
}

void FPaintMPM::GridBoundaries()
{
	const int32 Lo = 2;
	const int32 Hi = Nodes - 3;
	for (int32 I = 0; I < Nodes; ++I)
	{
		for (int32 J = 0; J < Nodes; ++J)
		{
			const int32 Idx = I * Nodes + J;
			if (I <= Lo) { GVx[Idx] = FMath::Max(0.f, GVx[Idx]); }
			if (I >= Hi) { GVx[Idx] = FMath::Min(0.f, GVx[Idx]); }
			if (J <= Lo) { GVy[Idx] = FMath::Max(0.f, GVy[Idx]); }
			if (J >= Hi) { GVy[Idx] = FMath::Min(0.f, GVy[Idx]); }
			if (I < 1 || J < 1 || I > Nodes - 2 || J > Nodes - 2)
			{
				GVx[Idx] = 0.f;
				GVy[Idx] = 0.f;
			}
		}
	}
}

void FPaintMPM::MaybeSleep(const FKnife* Knife)
{
	if (Knife) { return; }
	float Vmax2 = 0.f;
	for (int32 P = 0; P < Count; ++P)
	{
		Vmax2 = FMath::Max(Vmax2, Vx[P] * Vx[P] + Vy[P] * Vy[P]);
	}
	if (Vmax2 < Feel.SleepSpeed * Feel.SleepSpeed)
	{
		if (Settle > 0) { --Settle; }
		if (Settle <= 0)
		{
			FMemory::Memzero(Vx.GetData(), Count * sizeof(float));
			FMemory::Memzero(Vy.GetData(), Count * sizeof(float));
			FMemory::Memzero(C00.GetData(), Count * sizeof(float));
			FMemory::Memzero(C01.GetData(), Count * sizeof(float));
			FMemory::Memzero(C10.GetData(), Count * sizeof(float));
			FMemory::Memzero(C11.GetData(), Count * sizeof(float));
			bSleeping = true;
		}
	}
	else
	{
		Settle = FMath::Max(Settle, 4);
	}
}
