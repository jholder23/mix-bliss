#include "PaintStudioPawn.h"
#include "PaintSimComponent.h"
#include "PaintMaterials.h"
#include "Camera/CameraComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/RectLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/PostProcessComponent.h"
#include "ProceduralMeshComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "GameFramework/PlayerController.h"
#include "Engine/StaticMesh.h"
#include "UObject/ConstructorHelpers.h"
#include "Engine/LocalPlayer.h"
#include "Materials/MaterialInstanceDynamic.h"

APaintStudioPawn::APaintStudioPawn()
{
	PrimaryActorTick.bCanEverTick = true;
	bFindCameraComponentWhenViewTarget = true;
	AutoPossessPlayer = EAutoReceiveInput::Player0;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Overhead"));
	Camera->SetupAttachment(Root);
	Camera->SetRelativeLocation(FVector(0.f, 0.f, 56.f));
	Camera->SetRelativeRotation(FRotator(-90.f, -90.f, 0.f));
	Camera->SetFieldOfView(24.f);
	Camera->bConstrainAspectRatio = false;
	Camera->SetProjectionMode(ECameraProjectionMode::Perspective);

	Tray = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Tray"));
	Tray->SetupAttachment(Root);
	Tray->SetRelativeLocation(FVector(0.f, 0.f, 1.f));
	Tray->SetRelativeScale3D(FVector(0.38f, 0.38f, 0.02f));
	Tray->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	Tray->SetCollisionResponseToAllChannels(ECR_Ignore);
	Tray->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);

	StudioFloor = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("StudioFloor"));
	StudioFloor->SetupAttachment(Root);
	StudioFloor->SetRelativeLocation(FVector(0.f, 0.f, -4.f));
	StudioFloor->SetRelativeScale3D(FVector(8.f, 8.f, 0.08f));
	StudioFloor->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	Knife = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Knife"));
	Knife->SetupAttachment(Root);
	Knife->SetRelativeScale3D(FVector(0.08f, 0.016f, 0.0014f));
	Knife->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Knife->SetCastShadow(true);

	PaintSurface = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("PaintSurface"));
	PaintSurface->SetupAttachment(Root);
	PaintSurface->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	PaintSurface->SetCastShadow(true);

	Sim = CreateDefaultSubobject<UPaintSimComponent>(TEXT("PaintSim"));
	Sim->SetSurfaceMesh(PaintSurface);

	KeySoftbox = CreateDefaultSubobject<URectLightComponent>(TEXT("KeySoftbox"));
	KeySoftbox->SetupAttachment(Root);
	KeySoftbox->SetRelativeLocation(FVector(6.f, -8.f, 42.f));
	KeySoftbox->SetRelativeRotation(FRotator(-78.f, 40.f, 0.f));
	KeySoftbox->SetIntensity(90000.f);
	KeySoftbox->SetSourceWidth(48.f);
	KeySoftbox->SetSourceHeight(36.f);
	KeySoftbox->SetLightColor(FLinearColor(1.f, 0.985f, 0.96f));
	KeySoftbox->SetSpecularScale(1.f);
	KeySoftbox->SetIndirectLightingIntensity(1.2f);

	FillSoftbox = CreateDefaultSubobject<URectLightComponent>(TEXT("FillSoftbox"));
	FillSoftbox->SetupAttachment(Root);
	FillSoftbox->SetRelativeLocation(FVector(-12.f, 10.f, 34.f));
	FillSoftbox->SetRelativeRotation(FRotator(-62.f, -130.f, 0.f));
	FillSoftbox->SetIntensity(28000.f);
	FillSoftbox->SetSourceWidth(40.f);
	FillSoftbox->SetSourceHeight(28.f);
	FillSoftbox->SetLightColor(FLinearColor(0.92f, 0.95f, 1.f));

	RimSoftbox = CreateDefaultSubobject<URectLightComponent>(TEXT("RimSoftbox"));
	RimSoftbox->SetupAttachment(Root);
	RimSoftbox->SetRelativeLocation(FVector(0.f, 16.f, 22.f));
	RimSoftbox->SetRelativeRotation(FRotator(-40.f, -90.f, 0.f));
	RimSoftbox->SetIntensity(12000.f);
	RimSoftbox->SetSourceWidth(22.f);
	RimSoftbox->SetSourceHeight(10.f);
	RimSoftbox->SetLightColor(FLinearColor(1.f, 0.98f, 0.94f));

	Sky = CreateDefaultSubobject<USkyLightComponent>(TEXT("Sky"));
	Sky->SetupAttachment(Root);
	Sky->SetIntensity(0.45f);
	Sky->bRealTimeCapture = true;
	Sky->SetLowerHemisphereColor(FLinearColor(0.02f, 0.02f, 0.02f));

	Post = CreateDefaultSubobject<UPostProcessComponent>(TEXT("StudioPost"));
	Post->SetupAttachment(Root);
	Post->bUnbound = true;
	ApplyStudioLighting();

	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (Cube.Succeeded())
	{
		Tray->SetStaticMesh(Cube.Object);
		StudioFloor->SetStaticMesh(Cube.Object);
		Knife->SetStaticMesh(Cube.Object);
	}
}

void APaintStudioPawn::ApplyStudioLighting()
{
	FPostProcessSettings& S = Post->Settings;
	S.bOverride_AutoExposureMethod = true;
	S.AutoExposureMethod = EAutoExposureMethod::AEM_Manual;
	S.bOverride_AutoExposureBias = true;
	S.AutoExposureBias = 0.15f;
	S.bOverride_BloomIntensity = true;
	S.BloomIntensity = 0.18f;
	S.bOverride_MotionBlurAmount = true;
	S.MotionBlurAmount = 0.f;
	S.bOverride_VignetteIntensity = true;
	S.VignetteIntensity = 0.22f;
	S.bOverride_ColorContrast = true;
	S.ColorContrast = FVector4(1.04f, 1.04f, 1.04f, 1.f);
	S.bOverride_ColorSaturation = true;
	S.ColorSaturation = FVector4(1.06f, 1.05f, 1.04f, 1.f);
	S.bOverride_DynamicGlobalIlluminationMethod = true;
	S.DynamicGlobalIlluminationMethod = EDynamicGlobalIlluminationMethod::Lumen;
	S.bOverride_ReflectionMethod = true;
	S.ReflectionMethod = EReflectionMethod::Lumen;
	S.bOverride_LumenFinalGatherQuality = true;
	S.LumenFinalGatherQuality = 1.5f;
	S.bOverride_AmbientOcclusionIntensity = true;
	S.AmbientOcclusionIntensity = 0.55f;
}

void APaintStudioPawn::BeginPlay()
{
	Super::BeginPlay();

	if (UMaterialInterface* Porcelain = FPaintMaterials::GetPorcelain())
	{
		Tray->SetMaterial(0, Porcelain);
		if (UMaterialInstanceDynamic* FloorMat = UMaterialInstanceDynamic::Create(Porcelain, this))
		{
			FloorMat->SetVectorParameterValue(TEXT("Porcelain"), FLinearColor(0.018f, 0.017f, 0.016f));
			StudioFloor->SetMaterial(0, FloorMat);
		}
		else
		{
			StudioFloor->SetMaterial(0, Porcelain);
		}
	}
	if (UMaterialInterface* Steel = FPaintMaterials::GetSteel())
	{
		Knife->SetMaterial(0, Steel);
	}
	Sim->SetOilMaterial(FPaintMaterials::GetOil());

	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (UEnhancedInputLocalPlayerSubsystem* Sub = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			if (Mapping)
			{
				Sub->AddMappingContext(Mapping, 0);
			}
		}
	}
}

void APaintStudioPawn::PossessedBy(AController* NewController)
{
	Super::PossessedBy(NewController);
	if (APlayerController* PC = Cast<APlayerController>(NewController))
	{
		if (UEnhancedInputLocalPlayerSubsystem* Sub = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			if (Mapping)
			{
				Sub->AddMappingContext(Mapping, 0);
			}
		}
	}
}

void APaintStudioPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	Mapping = NewObject<UInputMappingContext>(this, TEXT("ImpastoIMC"));
	PrimaryAction = NewObject<UInputAction>(this, TEXT("Primary"));
	PrimaryAction->ValueType = EInputActionValueType::Boolean;
	DumpAction = NewObject<UInputAction>(this, TEXT("Dump"));
	DumpAction->ValueType = EInputActionValueType::Boolean;
	BlankAction = NewObject<UInputAction>(this, TEXT("Blank"));
	BlankAction->ValueType = EInputActionValueType::Boolean;

	Mapping->MapKey(PrimaryAction, EKeys::LeftMouseButton);
	Mapping->MapKey(DumpAction, EKeys::G);
	Mapping->MapKey(BlankAction, EKeys::R);

	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (UEnhancedInputLocalPlayerSubsystem* Sub = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			Sub->AddMappingContext(Mapping, 0);
		}
	}

	if (UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(PlayerInputComponent))
	{
		EIC->BindAction(PrimaryAction, ETriggerEvent::Started, this, &APaintStudioPawn::OnPrimaryStarted);
		EIC->BindAction(PrimaryAction, ETriggerEvent::Triggered, this, &APaintStudioPawn::OnPrimaryTriggered);
		EIC->BindAction(PrimaryAction, ETriggerEvent::Completed, this, &APaintStudioPawn::OnPrimaryCompleted);
		EIC->BindAction(PrimaryAction, ETriggerEvent::Canceled, this, &APaintStudioPawn::OnPrimaryCompleted);
		EIC->BindAction(DumpAction, ETriggerEvent::Started, this, &APaintStudioPawn::OnDump);
		EIC->BindAction(BlankAction, ETriggerEvent::Started, this, &APaintStudioPawn::OnBlank);
	}
}

void APaintStudioPawn::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	FVector CursorWorld;
	if (CursorOnTray(CursorWorld))
	{
		const FVector Delta = bPrimaryDown ? (CursorWorld - LastWorld) : FVector::ZeroVector;
		UpdateKnifeVisual(CursorWorld, Delta);
		if (!bPrimaryDown)
		{
			LastWorld = CursorWorld;
		}
	}

	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (PC->WasInputKeyJustPressed(EKeys::One)) SelectTube(0);
		if (PC->WasInputKeyJustPressed(EKeys::Two)) SelectTube(1);
		if (PC->WasInputKeyJustPressed(EKeys::Three)) SelectTube(2);
		if (PC->WasInputKeyJustPressed(EKeys::Four)) SelectTube(3);
		if (PC->WasInputKeyJustPressed(EKeys::Five)) SelectTube(4);
		if (PC->WasInputKeyJustPressed(EKeys::Six)) SelectTube(5);
		if (PC->WasInputKeyJustPressed(EKeys::Seven)) SelectTube(6);
		if (PC->WasInputKeyJustPressed(EKeys::Eight)) SelectTube(7);
		if (PC->WasInputKeyJustPressed(EKeys::Nine)) SelectTube(8);
		if (PC->WasInputKeyJustPressed(EKeys::Zero)) SelectTube(9);
		if (PC->WasInputKeyJustPressed(EKeys::LeftBracket))
		{
			SetViscosity(Sim->GetViscositySlider() - 0.08f);
		}
		if (PC->WasInputKeyJustPressed(EKeys::RightBracket))
		{
			SetViscosity(Sim->GetViscositySlider() + 0.08f);
		}
		if (PC->WasInputKeyJustPressed(EKeys::Hyphen))
		{
			SetSize(Sim->GetGlopSize() - 0.1f);
		}
		if (PC->WasInputKeyJustPressed(EKeys::Equals))
		{
			SetSize(Sim->GetGlopSize() + 0.1f);
		}
	}
}

bool APaintStudioPawn::CursorOnTray(FVector& OutWorld) const
{
	const APlayerController* PC = Cast<APlayerController>(GetController());
	if (!PC)
	{
		return false;
	}
	FVector Origin;
	FVector Dir;
	if (!PC->DeprojectMousePositionToWorld(Origin, Dir))
	{
		float TouchX, TouchY;
		bool bPressed = false;
		PC->GetInputTouchState(ETouchIndex::Touch1, TouchX, TouchY, bPressed);
		if (!bPressed || !PC->DeprojectScreenPositionToWorld(TouchX, TouchY, Origin, Dir))
		{
			return false;
		}
	}
	if (FMath::Abs(Dir.Z) < KINDA_SMALL_NUMBER)
	{
		return false;
	}
	const float TrayZ = Sim->GetTrayZ();
	const float T = (TrayZ - Origin.Z) / Dir.Z;
	if (T < 0.f)
	{
		return false;
	}
	OutWorld = Origin + Dir * T;
	const float Ext = Sim->GetTrayExtent() + 2.f;
	return FMath::Abs(OutWorld.X) <= Ext && FMath::Abs(OutWorld.Y) <= Ext;
}

void APaintStudioPawn::UpdateKnifeVisual(const FVector& WorldPos, const FVector& Delta)
{
	FVector Flat = Delta;
	Flat.Z = 0.f;
	if (Flat.SizeSquared() > 0.01f)
	{
		BladeDir = Flat.GetSafeNormal();
	}
	const FRotator Rot = BladeDir.Rotation();
	Knife->SetWorldLocation(FVector(WorldPos.X, WorldPos.Y, Sim->GetTrayZ() + 0.35f));
	Knife->SetWorldRotation(FRotator(0.f, Rot.Yaw, 0.f));
}

void APaintStudioPawn::OnPrimaryStarted()
{
	FVector World;
	if (!CursorOnTray(World))
	{
		return;
	}
	bPrimaryDown = true;
	bScraping = false;
	PressWorld = World;
	LastWorld = World;
}

void APaintStudioPawn::OnPrimaryTriggered()
{
	if (!bPrimaryDown)
	{
		return;
	}
	FVector World;
	if (!CursorOnTray(World))
	{
		return;
	}
	const FVector Delta = World - LastWorld;
	if (!bScraping && FVector::Dist2D(World, PressWorld) > 0.45f)
	{
		bScraping = true;
	}
	if (bScraping)
	{
		const float Length = 8.f;
		const float Width = 1.35f + Sim->GetGlopSize() * 0.8f;
		Sim->ScrapeWorld(World, Delta, Length, Width);
	}
	LastWorld = World;
}

void APaintStudioPawn::OnPrimaryCompleted()
{
	if (!bPrimaryDown)
	{
		return;
	}
	if (!bScraping)
	{
		DumpGlopAtCursor();
	}
	Sim->EndScrape();
	bPrimaryDown = false;
	bScraping = false;
}

void APaintStudioPawn::OnDump()
{
	DumpGlopAtCursor();
}

void APaintStudioPawn::OnBlank()
{
	BlankTray();
}

void APaintStudioPawn::DumpGlopAtCursor()
{
	FVector World;
	if (!CursorOnTray(World))
	{
		World = Sim->GetTrayCenter();
	}
	const float Radius = 0.85f + Sim->GetGlopSize() * 2.6f;
	Sim->GlopWorld(World, Radius);
}

void APaintStudioPawn::BlankTray()
{
	Sim->BlankTray();
}

void APaintStudioPawn::SelectTube(int32 Index)
{
	Sim->SetSelectedTube(Index);
}

void APaintStudioPawn::SetViscosity(float T)
{
	Sim->SetViscositySlider(T);
}

void APaintStudioPawn::SetSize(float T)
{
	Sim->SetGlopSize(T);
}
